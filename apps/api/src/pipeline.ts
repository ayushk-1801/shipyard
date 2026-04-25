import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import Docker from "dockerode";
import { extractArchive } from "./archive.js";
import { CaddyClient, renderCaddyfile } from "./caddy.js";
import { config } from "./config.js";
import type { DeploymentStore } from "./db.js";
import type { EventHub } from "./hub.js";
import { runLoggedCommand } from "./process.js";
import type {
  Deployment,
  DeploymentImage,
  DeploymentStatus,
  ImageBuildReason,
  LogPhase,
  LogStream
} from "./types.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const hashValue = async (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);

const hashFile = async (filePath: string) => {
  const bytes = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16);
};

type QueueKind = "deploy" | "redeploy" | "rollback";

interface QueueItem {
  deploymentId: string;
  kind: QueueKind;
  imageId?: string;
}

interface OperationController {
  id: string;
  deploymentId: string;
  kind: QueueKind;
  abort: AbortController;
  previousDeployment?: Deployment;
  candidateContainerName?: string;
}

const isAbortError = (error: unknown) =>
  error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"));

export class DeploymentPipeline {
  private readonly docker = new Docker({ socketPath: "/var/run/docker.sock" });
  private readonly caddy = new CaddyClient(config.caddyAdminUrl);
  private readonly queue: QueueItem[] = [];
  private readonly activeOperations = new Map<string, OperationController>();
  private active = false;

  constructor(
    private readonly store: DeploymentStore,
    private readonly hub: EventHub
  ) {}

  async recover() {
    this.store.markInterruptedDeployments();
    try {
      await this.syncRoutes();
    } catch (error) {
      console.error("Initial Caddy route sync failed.", error);
    }
  }

  startRouteSync(intervalMs = 5000) {
    const timer = setInterval(() => {
      void this.syncRoutes().catch((error) => {
        console.error("Caddy route sync failed.", error);
      });
    }, intervalMs);
    timer.unref();
  }

  async syncRoutes() {
    await this.reconcileRunningDeployments();
    await this.reloadCaddyWithRetries();
  }

  enqueue(id: string) {
    this.queueOperation({ deploymentId: id, kind: "deploy" });
  }

  redeploy(id: string) {
    const deployment = this.requireDeployment(id);
    this.assertNoActiveWork(id);
    const updated = this.store.updateDeployment(id, {
      errorMessage: null
    });
    if (updated) this.hub.publishStatus(updated);
    this.publishLog(id, "system", "stdout", "Redeploy queued.");
    this.queueOperation({ deploymentId: id, kind: "redeploy" });
    return deployment;
  }

  rollback(id: string, imageId: string) {
    const deployment = this.requireDeployment(id);
    const image = this.store.getImage(id, imageId);
    if (!image) {
      throw new Error("Image history entry not found.");
    }
    this.assertNoActiveWork(id);
    const updated = this.store.updateDeployment(id, {
      errorMessage: null
    });
    if (updated) this.hub.publishStatus(updated);
    this.publishLog(id, "system", "stdout", `Rollback queued for ${image.imageTag}.`);
    this.queueOperation({ deploymentId: id, kind: "rollback", imageId });
    return { deployment, image };
  }

  cancel(id: string) {
    let canceled = false;
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index]?.deploymentId === id) {
        this.queue.splice(index, 1);
        canceled = true;
      }
    }

    const active = this.activeOperations.get(id);
    if (active) {
      active.abort.abort();
      canceled = true;
    }

    if (canceled && !active) {
      this.publishLog(id, "system", "stderr", "Canceled by user.");
      const deployment = this.store.getDeployment(id);
      if (deployment?.status === "pending") {
        this.transition(id, "failed", {
          errorMessage: "Canceled by user"
        });
      } else if (deployment) {
        const updated = this.store.updateDeployment(id, {
          errorMessage: "Canceled by user"
        });
        if (updated) this.hub.publishStatus(updated);
      }
      this.hub.publishDone(id);
    }

    return canceled;
  }

  private queueOperation(item: QueueItem) {
    this.queue.push(item);
    void this.drain();
  }

  private requireDeployment(id: string) {
    const deployment = this.store.getDeployment(id);
    if (!deployment) {
      throw new Error("Deployment not found.");
    }
    return deployment;
  }

  private assertNoActiveWork(id: string) {
    if (this.activeOperations.has(id) || this.queue.some((item) => item.deploymentId === id)) {
      throw new Error("Deployment already has an active operation.");
    }
  }

  private async drain() {
    if (this.active) return;
    this.active = true;

    while (this.queue.length) {
      const item = this.queue.shift();
      if (!item) continue;
      await this.processOperation(item);
    }

    this.active = false;
  }

  private publishLog(deploymentId: string, phase: LogPhase, stream: LogStream, message: string) {
    const log = this.store.appendLog(deploymentId, phase, stream, message);
    this.hub.publishLog(log);
  }

  private transition(id: string, status: DeploymentStatus, patch: Partial<Deployment> = {}) {
    const deployment = this.store.updateDeployment(id, {
      ...patch,
      status,
      ...(status === "building" ? { startedAt: new Date().toISOString() } : {}),
      ...(status === "running" || status === "failed" ? { finishedAt: new Date().toISOString() } : {})
    });

    if (deployment) {
      this.publishLog(id, "system", status === "failed" ? "stderr" : "stdout", `Status: ${status}`);
      this.hub.publishStatus(deployment);
    }

    return deployment;
  }

  private async processOperation(item: QueueItem) {
    let deployment = this.store.getDeployment(item.deploymentId);
    if (!deployment) return;
    const previousDeployment = deployment;

    const operation: OperationController = {
      id: crypto.randomUUID(),
      deploymentId: deployment.id,
      kind: item.kind,
      abort: new AbortController(),
      previousDeployment
    };
    this.activeOperations.set(deployment.id, operation);

    try {
      if (item.kind === "rollback") {
        await this.processRollback(deployment, item.imageId!, operation);
      } else {
        await this.processBuildDeployment(deployment, item.kind, operation);
      }
    } catch (error) {
      const canceled = isAbortError(error) || operation.abort.signal.aborted;
      const message = canceled ? "Canceled by user" : error instanceof Error ? error.message : String(error);
      this.publishLog(deployment.id, "system", "stderr", message);
      if (operation.candidateContainerName) {
        await this.removeContainer(operation.candidateContainerName);
      }

      if (previousDeployment.status === "running" && previousDeployment.containerName) {
        this.publishLog(
          deployment.id,
          "system",
          "stderr",
          "Keeping previous running container because the replacement did not activate."
        );
        this.transition(deployment.id, "running", {
          imageTag: previousDeployment.imageTag,
          containerId: previousDeployment.containerId,
          containerName: previousDeployment.containerName,
          errorMessage: `Last operation failed: ${message}`
        });
      } else {
        this.transition(deployment.id, "failed", {
          errorMessage: message
        });
      }
    } finally {
      this.activeOperations.delete(deployment.id);
      this.hub.publishDone(deployment.id);
    }
  }

  private async processBuildDeployment(
    deployment: Deployment,
    reason: Extract<ImageBuildReason, "deploy" | "redeploy">,
    operation: OperationController
  ) {
    deployment = this.transition(deployment.id, "building") ?? deployment;
    const sourceDir = await this.prepareSource(deployment, operation.abort.signal);
    operation.abort.signal.throwIfAborted();
    const sourceHash =
      deployment.sourceType === "archive" && deployment.sourcePath
        ? await hashFile(deployment.sourcePath)
        : await hashValue(`${deployment.sourceRef}:${deployment.gitRef ?? ""}`);
    const image = this.createImageRecord(deployment, sourceHash, reason);

    deployment =
      this.store.updateDeployment(deployment.id, {
        imageTag: image.imageTag
      }) ?? deployment;

    this.publishLog(deployment.id, "build", "stdout", `Building ${image.imageTag} with Railpack.`);
    await runLoggedCommand(
      config.railpackBin,
      ["build", "--name", image.imageTag, "--progress", "plain", "--cache-key", sourceHash, sourceDir],
      sourceDir,
      "build",
      (phase, stream, line) => this.publishLog(deployment.id, phase, stream, line),
      {
        ...process.env,
        DOCKER_BUILDKIT: "1"
      },
      operation.abort.signal
    );
    operation.abort.signal.throwIfAborted();

    await this.activateImage(deployment, image, operation);
  }

  private async processRollback(deployment: Deployment, imageId: string, operation: OperationController) {
    const image = this.store.getImage(deployment.id, imageId);
    if (!image) {
      throw new Error("Image history entry not found.");
    }

    this.publishLog(deployment.id, "deploy", "stdout", `Rolling back to ${image.imageTag}.`);
    await this.activateImage(deployment, image, operation);
  }

  private async activateImage(deployment: Deployment, image: DeploymentImage, operation: OperationController) {
    const currentContainerName = deployment.containerName;
    const candidateName = `brimble-${deployment.slug}-${operation.id.slice(0, 8)}`;
    operation.candidateContainerName = candidateName;

    deployment = this.transition(deployment.id, "deploying", {
      imageTag: image.imageTag
    }) ?? deployment;

    const containerId = await this.startContainer(deployment, image.imageTag, image.id, candidateName);
    operation.abort.signal.throwIfAborted();
    await this.waitForHttp(candidateName, deployment.containerPort, operation.abort.signal);
    operation.abort.signal.throwIfAborted();

    const candidate: Deployment = {
      ...deployment,
      status: "running",
      imageTag: image.imageTag,
      containerId,
      containerName: candidateName,
      errorMessage: null,
      finishedAt: new Date().toISOString()
    };
    await this.reloadCaddyWithRetries(candidate);

    if (!this.store.getImage(deployment.id, image.id)) {
      this.store.insertImage(image);
    }

    const updated =
      this.transition(deployment.id, "running", {
        imageTag: image.imageTag,
        containerId,
        containerName: candidateName,
        errorMessage: null
      }) ?? candidate;
    this.store.activateImage(deployment.id, image.id);
    this.publishLog(deployment.id, "deploy", "stdout", `Path route: ${updated.liveUrl}`);
    this.publishLog(deployment.id, "deploy", "stdout", `Host route: ${updated.hostUrl}`);
    this.followRuntimeLogs(updated);
    operation.candidateContainerName = undefined;

    if (currentContainerName && currentContainerName !== candidateName) {
      await this.stopContainerGracefully(currentContainerName);
    }

    for (const pruned of this.store.pruneImages(deployment.id, config.imageHistoryLimit)) {
      await this.removeImage(pruned.imageTag);
    }
  }

  private async prepareSource(deployment: Deployment, signal?: AbortSignal) {
    const buildsRoot = path.join(config.workspaceRoot, "builds");
    const buildDir = path.join(buildsRoot, deployment.id);
    await fs.mkdir(buildsRoot, { recursive: true });
    await fs.rm(buildDir, { recursive: true, force: true });

    if (deployment.sourceType === "git") {
      const args = ["clone", "--depth", "1"];
      if (deployment.gitRef) {
        args.push("--branch", deployment.gitRef);
      }
      args.push(deployment.sourceRef, buildDir);

      this.publishLog(deployment.id, "clone", "stdout", `Cloning ${deployment.sourceRef}`);
      await runLoggedCommand(
        "git",
        args,
        buildsRoot,
        "clone",
        (phase, stream, line) => this.publishLog(deployment.id, phase, stream, line),
        process.env,
        signal
      );
      return buildDir;
    }

    if (!deployment.sourcePath) {
      throw new Error("Archive deployment is missing a stored archive path.");
    }

    this.publishLog(deployment.id, "extract", "stdout", `Extracting ${deployment.sourceRef}`);
    await extractArchive(deployment.sourcePath, buildDir);
    this.publishLog(deployment.id, "extract", "stdout", "Archive extracted.");
    return buildDir;
  }

  private createImageRecord(
    deployment: Deployment,
    sourceHash: string,
    reason: Extract<ImageBuildReason, "deploy" | "redeploy">
  ): DeploymentImage {
    const id = crypto.randomUUID();
    const image: DeploymentImage = {
      id,
      deploymentId: deployment.id,
      slug: deployment.slug,
      imageTag: `brimble-${deployment.slug}:${id.slice(0, 12)}`,
      sourceHash,
      reason,
      isActive: false,
      createdAt: new Date().toISOString(),
      activatedAt: null
    };
    return image;
  }

  private async startContainer(
    deployment: Deployment,
    imageTag: string,
    imageId: string,
    containerName: string
  ) {
    await this.removeContainer(containerName);
    this.publishLog(deployment.id, "deploy", "stdout", `Starting ${containerName}.`);

    const container = await this.docker.createContainer({
      Image: imageTag,
      name: containerName,
      Env: [
        `PORT=${deployment.containerPort}`,
        "HOST=0.0.0.0",
        "NODE_ENV=production"
      ],
      ExposedPorts: {
        [`${deployment.containerPort}/tcp`]: {}
      },
      HostConfig: {
        NetworkMode: config.dockerNetwork,
        RestartPolicy: {
          Name: "unless-stopped"
        }
      },
      Labels: {
        "brimble.assignment": "true",
        "brimble.deployment.id": deployment.id,
        "brimble.deployment.slug": deployment.slug,
        "brimble.image.id": imageId,
        "brimble.image.tag": imageTag
      }
    });

    await container.start();
    this.publishLog(deployment.id, "deploy", "stdout", `Container started: ${container.id}`);
    return container.id;
  }

  private async removeContainer(containerName: string) {
    try {
      await this.stopContainerGracefully(containerName);
      const container = this.docker.getContainer(containerName);
      await container.remove({ force: true });
    } catch (error) {
      const dockerError = error as { statusCode?: number };
      if (dockerError.statusCode !== 404) {
        throw error;
      }
    }
  }

  private async stopContainerGracefully(containerName: string) {
    try {
      const container = this.docker.getContainer(containerName);
      const inspected = await container.inspect();
      if (inspected.State?.Running) {
        await container.stop({ t: config.gracefulStopSeconds });
      }
    } catch (error) {
      const dockerError = error as { statusCode?: number };
      if (dockerError.statusCode !== 404 && dockerError.statusCode !== 304) {
        try {
          await this.docker.getContainer(containerName).kill();
        } catch {
          // Best effort fallback; removeContainer handles final cleanup.
        }
      }
    }
  }

  private async removeImage(imageTag: string) {
    try {
      await this.docker.getImage(imageTag).remove({ force: true });
    } catch {
      // Image cleanup is best effort; history pruning should not break deploys.
    }
  }

  private async waitForHttp(containerName: string, port: number, signal?: AbortSignal) {
    const url = `http://${containerName}:${port}/`;
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      signal?.throwIfAborted();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1000);
      try {
        await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        return;
      } catch {
        clearTimeout(timeout);
        await sleep(500);
      }
    }

    throw new Error(`Container did not respond on ${url}`);
  }

  private async reconcileRunningDeployments() {
    const running = this.store.listDeployments(["running"]);

    for (const deployment of running) {
      if (!deployment.containerName) {
        this.transition(deployment.id, "failed", {
          errorMessage: "Deployment is marked running but has no container name."
        });
        continue;
      }

      try {
        const inspected = await this.docker.getContainer(deployment.containerName).inspect();
        if (!inspected.State?.Running) {
          this.transition(deployment.id, "failed", {
            errorMessage: `Container is not running (${inspected.State?.Status ?? "unknown"}).`
          });
          continue;
        }

        if (deployment.containerId !== inspected.Id) {
          const updated = this.store.updateDeployment(deployment.id, {
            containerId: inspected.Id
          });
          if (updated) this.hub.publishStatus(updated);
        }
      } catch (error) {
        const dockerError = error as { statusCode?: number; message?: string };
        if (dockerError.statusCode === 404) {
          this.transition(deployment.id, "failed", {
            errorMessage: "Container no longer exists."
          });
          continue;
        }

        throw error;
      }
    }
  }

  private async reloadCaddyWithRetries(extra?: Deployment) {
    const running = this.store
      .listDeployments(["running"])
      .filter((deployment) => deployment.containerName && deployment.id !== extra?.id);
    const activePrevious = [...this.activeOperations.values()]
      .map((operation) => operation.previousDeployment)
      .filter(
        (deployment): deployment is Deployment =>
          Boolean(
            deployment?.containerName &&
              deployment.status === "running" &&
              deployment.id !== extra?.id &&
              !running.some((item) => item.id === deployment.id)
          )
      );
    const deployments = extra ? [extra, ...running, ...activePrevious] : [...running, ...activePrevious];
    const caddyfile = renderCaddyfile(deployments, config.publicHostname);

    let lastError: unknown;
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      try {
        await this.caddy.load(caddyfile);
        return;
      } catch (error) {
        lastError = error;
        await sleep(500);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Caddy reload failed.");
  }

  private followRuntimeLogs(deployment: Deployment) {
    if (!deployment.containerId) return;

    const container = this.docker.getContainer(deployment.containerId);
    container
      .logs({
        stdout: true,
        stderr: true,
        follow: true,
        tail: 0
      })
      .then((stream) => {
        let stdoutBuffer = "";
        let stderrBuffer = "";
        const writeLines = (chunk: Buffer, streamName: LogStream) => {
          let buffer = streamName === "stdout" ? stdoutBuffer : stderrBuffer;
          buffer += chunk.toString("utf8");
          const lines = buffer.split(/\r?\n/u);
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim()) this.publishLog(deployment.id, "runtime", streamName, line);
          }
          if (streamName === "stdout") stdoutBuffer = buffer;
          if (streamName === "stderr") stderrBuffer = buffer;
        };

        const stdout = new Writable({
          write: (chunk, _encoding, callback) => {
            writeLines(chunk as Buffer, "stdout");
            callback();
          }
        });
        const stderr = new Writable({
          write: (chunk, _encoding, callback) => {
            writeLines(chunk as Buffer, "stderr");
            callback();
          }
        });

        this.docker.modem.demuxStream(stream, stdout, stderr);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.publishLog(deployment.id, "runtime", "stderr", `Runtime log stream failed: ${message}`);
      });
  }
}

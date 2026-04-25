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
import type { Deployment, DeploymentStatus, LogPhase, LogStream } from "./types.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const hashValue = async (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);

const hashFile = async (filePath: string) => {
  const bytes = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16);
};

export class DeploymentPipeline {
  private readonly docker = new Docker({ socketPath: "/var/run/docker.sock" });
  private readonly caddy = new CaddyClient(config.caddyAdminUrl);
  private readonly queue: string[] = [];
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

  startRouteSync(intervalMs = 30000) {
    const timer = setInterval(() => {
      void this.syncRoutes().catch((error) => {
        console.error("Caddy route sync failed.", error);
      });
    }, intervalMs);
    timer.unref();
  }

  async syncRoutes() {
    if (!this.store.listDeployments(["running"]).length) return;
    await this.reloadCaddyWithRetries();
  }

  enqueue(id: string) {
    this.queue.push(id);
    void this.drain();
  }

  private async drain() {
    if (this.active) return;
    this.active = true;

    while (this.queue.length) {
      const id = this.queue.shift();
      if (!id) continue;
      await this.processDeployment(id);
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

  private async processDeployment(id: string) {
    let deployment = this.store.getDeployment(id);
    if (!deployment) return;

    let containerName: string | null = null;

    try {
      deployment = this.transition(id, "building") ?? deployment;
      const sourceDir = await this.prepareSource(deployment);
      const imageTag = `brimble-${deployment.slug}:${deployment.id.slice(0, 12)}`;
      const cacheKey =
        deployment.sourceType === "archive" && deployment.sourcePath
          ? await hashFile(deployment.sourcePath)
          : await hashValue(`${deployment.sourceRef}:${deployment.gitRef ?? ""}`);

      deployment =
        this.store.updateDeployment(deployment.id, {
          imageTag
        }) ?? deployment;

      this.publishLog(deployment.id, "build", "stdout", `Building ${imageTag} with Railpack.`);
      await runLoggedCommand(
        config.railpackBin,
        ["build", "--name", imageTag, "--progress", "plain", "--cache-key", cacheKey, sourceDir],
        sourceDir,
        "build",
        (phase, stream, line) => this.publishLog(deployment!.id, phase, stream, line),
        {
          ...process.env,
          DOCKER_BUILDKIT: "1"
        }
      );

      deployment = this.transition(id, "deploying") ?? deployment;
      containerName = `brimble-${deployment.slug}-${deployment.id.slice(0, 8)}`;
      const containerId = await this.startContainer(deployment, imageTag, containerName);
      deployment =
        this.store.updateDeployment(deployment.id, {
          containerId,
          containerName
        }) ?? deployment;

      await this.waitForHttp(containerName, deployment.containerPort);

      const candidate: Deployment = {
        ...deployment,
        status: "running",
        containerId,
        containerName,
        errorMessage: null,
        finishedAt: new Date().toISOString()
      };
      await this.reloadCaddyWithRetries(candidate);

      deployment =
        this.transition(id, "running", {
          containerId,
          containerName,
          errorMessage: null
        }) ?? candidate;

      this.publishLog(deployment.id, "deploy", "stdout", `Path route: ${deployment.liveUrl}`);
      this.publishLog(deployment.id, "deploy", "stdout", `Host route: ${deployment.hostUrl}`);
      this.followRuntimeLogs(deployment);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.publishLog(id, "system", "stderr", message);
      this.transition(id, "failed", {
        errorMessage: message
      });
      if (containerName) {
        await this.removeContainer(containerName);
      }
    } finally {
      this.hub.publishDone(id);
    }
  }

  private async prepareSource(deployment: Deployment) {
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
      await runLoggedCommand("git", args, buildsRoot, "clone", (phase, stream, line) =>
        this.publishLog(deployment.id, phase, stream, line)
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

  private async startContainer(deployment: Deployment, imageTag: string, containerName: string) {
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
        "brimble.deployment.slug": deployment.slug
      }
    });

    await container.start();
    this.publishLog(deployment.id, "deploy", "stdout", `Container started: ${container.id}`);
    return container.id;
  }

  private async removeContainer(containerName: string) {
    try {
      const container = this.docker.getContainer(containerName);
      await container.remove({ force: true });
    } catch (error) {
      const dockerError = error as { statusCode?: number };
      if (dockerError.statusCode !== 404) {
        throw error;
      }
    }
  }

  private async waitForHttp(containerName: string, port: number) {
    const url = `http://${containerName}:${port}/`;
    for (let attempt = 1; attempt <= 30; attempt += 1) {
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

  private async reloadCaddyWithRetries(extra?: Deployment) {
    const running = this.store
      .listDeployments(["running"])
      .filter((deployment) => deployment.containerName && deployment.id !== extra?.id);
    const deployments = extra ? [extra, ...running] : running;
    const caddyfile = renderCaddyfile(deployments);

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

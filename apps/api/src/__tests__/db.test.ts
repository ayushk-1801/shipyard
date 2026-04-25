import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeploymentStore } from "../db.js";
import type { Deployment, DeploymentImage } from "../types.js";

let dir: string;
let dbPath: string;
let store: DeploymentStore;

const makeDeployment = (patch: Partial<Deployment> = {}): Deployment => {
  const now = new Date().toISOString();
  return {
    id: "dep_1",
    slug: "sample",
    sourceType: "archive",
    sourceRef: "sample.tgz",
    sourcePath: "/tmp/sample.tgz",
    gitRef: null,
    status: "pending",
    imageTag: null,
    containerId: null,
    containerName: null,
    containerPort: 3000,
    liveUrl: "http://localhost:8080/d/sample/",
    hostUrl: "http://sample.localhost:8080/",
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
    ...patch
  };
};

const makeImage = (index: number, patch: Partial<DeploymentImage> = {}): DeploymentImage => {
  const createdAt = new Date(Date.UTC(2026, 0, index + 1)).toISOString();
  return {
    id: `image_${index}`,
    deploymentId: "dep_1",
    slug: "sample",
    imageTag: `brimble-sample:${index}`,
    sourceHash: `hash-${index}`,
    reason: "deploy",
    isActive: false,
    createdAt,
    activatedAt: null,
    ...patch
  };
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "brimble-db-"));
  dbPath = path.join(dir, "test.db");
  store = new DeploymentStore(dbPath);
});

afterEach(async () => {
  store.close();
  await fs.rm(dir, { recursive: true, force: true });
});

describe("DeploymentStore", () => {
  it("persists status transitions and logs", () => {
    const deployment = makeDeployment();
    store.insertDeployment(deployment);

    const building = store.updateDeployment(deployment.id, {
      status: "building"
    });
    const log = store.appendLog(deployment.id, "build", "stdout", "hello");

    expect(building?.status).toBe("building");
    expect(log.seq).toBe(1);
    expect(store.getLogs(deployment.id)).toHaveLength(1);
  });

  it("marks interrupted deployments as failed", () => {
    store.insertDeployment(makeDeployment());

    expect(store.markInterruptedDeployments()).toBe(1);
    expect(store.getDeployment("dep_1")?.status).toBe("failed");
  });

  it("backfills image history for existing image tags", () => {
    store.insertDeployment(
      makeDeployment({
        status: "running",
        imageTag: "brimble-sample:old",
        finishedAt: new Date().toISOString()
      })
    );

    store.close();
    store = new DeploymentStore(dbPath);

    expect(store.listImages("dep_1")).toMatchObject([
      {
        id: "backfill-dep_1",
        imageTag: "brimble-sample:old",
        reason: "backfill",
        isActive: true
      }
    ]);
  });

  it("activates image history and prunes old inactive tags", () => {
    store.insertDeployment(makeDeployment());

    for (let index = 1; index <= 5; index += 1) {
      store.insertImage(makeImage(index));
    }
    store.activateImage("dep_1", "image_2");

    const pruned = store.pruneImages("dep_1", 2);
    const remaining = store.listImages("dep_1");

    expect(pruned.map((image) => image.id)).toEqual(["image_3", "image_1"]);
    expect(remaining.map((image) => image.id)).toEqual(["image_5", "image_4", "image_2"]);
    expect(remaining.find((image) => image.id === "image_2")?.isActive).toBe(true);
  });

  it("searches logs and applies keep-last retention", () => {
    store.insertDeployment(makeDeployment());
    store.appendLog("dep_1", "system", "stdout", "queued");
    store.appendLog("dep_1", "build", "stdout", "railpack started");
    store.appendLog("dep_1", "build", "stderr", "railpack warning");
    store.appendLog("dep_1", "deploy", "stdout", "running");

    const search = store.searchLogs("dep_1", {
      query: "railpack",
      phase: "build",
      stream: "stderr",
      limit: 5
    });
    const deleted = store.deleteLogsByRetention("dep_1", { keepLast: 2 });

    expect(search.map((log) => log.message)).toEqual(["railpack warning"]);
    expect(deleted).toBe(2);
    expect(store.getLogs("dep_1").map((log) => log.message)).toEqual(["railpack warning", "running"]);
  });
});

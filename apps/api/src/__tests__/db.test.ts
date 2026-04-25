import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DeploymentStore } from "../db.js";
import type { Deployment } from "../types.js";

let dir: string;
let store: DeploymentStore;

const makeDeployment = (): Deployment => {
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
    finishedAt: null
  };
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "brimble-db-"));
  store = new DeploymentStore(path.join(dir, "test.db"));
});

afterEach(async () => {
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
});

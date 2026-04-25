import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { supportedArchive } from "./archive.js";
import { config } from "./config.js";
import { DeploymentStore } from "./db.js";
import { EventHub } from "./hub.js";
import { DeploymentPipeline } from "./pipeline.js";
import { hostUrlFor, nameFromSource, uniqueSlug } from "./slug.js";
import { eventStream } from "./sse.js";
import type { Deployment } from "./types.js";
import { createDeploymentSchema } from "./validation.js";

const app = new Hono();
const store = new DeploymentStore(config.databasePath);
const hub = new EventHub();
const pipeline = new DeploymentPipeline(store, hub);

const isUploadFile = (value: unknown): value is File =>
  Boolean(
    value &&
      typeof value === "object" &&
      "arrayBuffer" in value &&
      typeof (value as File).arrayBuffer === "function" &&
      "name" in value &&
      typeof (value as File).name === "string"
  );

const safeFilename = (filename: string) =>
  filename
    .replace(/[^a-zA-Z0-9._-]/gu, "-")
    .replace(/-+/gu, "-")
    .slice(0, 120);

const persistUpload = async (id: string, file: File) => {
  if (!supportedArchive(file.name)) {
    throw new HTTPException(400, {
      message: "Archive must be .zip, .tar.gz, or .tgz."
    });
  }

  const uploadsDir = path.join(config.workspaceRoot, "uploads");
  await fs.mkdir(uploadsDir, { recursive: true });

  const filename = `${id}-${safeFilename(file.name)}`;
  const archivePath = path.join(uploadsDir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(archivePath, buffer);
  return archivePath;
};

app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Last-Event-ID"]
  })
);

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "brimble-assignment-api"
  })
);

app.get("/api/deployments", (c) =>
  c.json({
    deployments: store.listDeployments()
  })
);

app.get("/api/deployments/events", (c) =>
  eventStream(c.req.raw.signal, (send) => {
    send({
      event: "snapshot",
      data: store.listDeployments()
    });

    const heartbeat = setInterval(() => {
      send({
        event: "heartbeat",
        data: { at: new Date().toISOString() }
      });
    }, 15000);

    const unsubscribe = hub.subscribeToDeployments(send);
    return () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
  })
);

app.get("/api/deployments/:id", (c) => {
  const deployment = store.getDeployment(c.req.param("id"));
  if (!deployment) {
    throw new HTTPException(404, { message: "Deployment not found." });
  }

  return c.json({ deployment });
});

app.get("/api/deployments/:id/logs", (c) => {
  const id = c.req.param("id");
  const deployment = store.getDeployment(id);
  if (!deployment) {
    throw new HTTPException(404, { message: "Deployment not found." });
  }

  const afterSeq = Number(c.req.header("Last-Event-ID") ?? c.req.query("after") ?? 0);

  return eventStream(c.req.raw.signal, (send) => {
    send({
      event: "status",
      data: deployment
    });

    for (const log of store.getLogs(id, Number.isFinite(afterSeq) ? afterSeq : 0)) {
      send({
        event: "log",
        id: String(log.seq),
        data: log
      });
    }

    const heartbeat = setInterval(() => {
      send({
        event: "heartbeat",
        data: { at: new Date().toISOString() }
      });
    }, 15000);

    const unsubscribe = hub.subscribeToLogs(id, send);
    return () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
  });
});

app.post("/api/deployments", async (c) => {
  const form = await c.req.parseBody();
  const parsed = createDeploymentSchema.safeParse({
    sourceType: form.sourceType,
    gitUrl: form.gitUrl,
    gitRef: form.gitRef,
    containerPort: form.containerPort
  });

  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid deployment request.",
        issues: parsed.error.flatten()
      },
      400
    );
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  let sourceRef = "";
  let sourcePath: string | null = null;
  let gitRef: string | null = parsed.data.gitRef ?? null;

  if (parsed.data.sourceType === "git") {
    sourceRef = parsed.data.gitUrl!;
  } else {
    const upload = form.archive;
    if (!isUploadFile(upload)) {
      return c.json({ error: "Archive file is required." }, 400);
    }
    sourceRef = upload.name;
    sourcePath = await persistUpload(id, upload);
    gitRef = null;
  }

  const slug = uniqueSlug(nameFromSource(sourceRef), (candidate) => store.deploymentExists(candidate));
  const liveUrl = `${config.publicBaseUrl}/d/${slug}/`;
  const deployment: Deployment = {
    id,
    slug,
    sourceType: parsed.data.sourceType,
    sourceRef,
    sourcePath,
    gitRef,
    status: "pending",
    imageTag: null,
    containerId: null,
    containerName: null,
    containerPort: parsed.data.containerPort,
    liveUrl,
    hostUrl: hostUrlFor({ slug }, config.publicBaseUrl),
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null
  };

  store.insertDeployment(deployment);
  const log = store.appendLog(id, "system", "stdout", "Deployment queued.");
  hub.publishStatus(deployment);
  hub.publishLog(log);
  pipeline.enqueue(id);

  return c.json({ deployment }, 201);
});

app.notFound((c) => c.json({ error: "Not found." }, 404));

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status);
  }

  console.error(error);
  return c.json({ error: "Internal server error." }, 500);
});

await fs.mkdir(config.workspaceRoot, { recursive: true });
await pipeline.recover();
pipeline.startRouteSync();

serve(
  {
    fetch: app.fetch,
    port: config.port
  },
  (info) => {
    console.log(`API listening on http://0.0.0.0:${info.port}`);
  }
);

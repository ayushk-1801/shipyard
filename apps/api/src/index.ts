import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { supportedArchive } from "./archive.js";
import { config } from "./config.js";
import { DeploymentStore } from "./db.js";
import { EventHub } from "./hub.js";
import { DeploymentPipeline } from "./pipeline.js";
import { hostUrlFor, nameFromSource, uniqueSlug } from "./slug.js";
import { eventStream } from "./sse.js";
import type { Deployment, LogPhase, LogStream } from "./types.js";
import { createDeploymentSchema } from "./validation.js";

const app = new Hono();
const store = new DeploymentStore(config.databasePath);
const hub = new EventHub();
const pipeline = new DeploymentPipeline(store, hub);

const logPhases = ["system", "clone", "extract", "build", "deploy", "runtime"] as const;
const logStreams = ["stdout", "stderr"] as const;
const rollbackSchema = z.object({
  imageId: z.string().min(1)
});
const retentionSchema = z
  .object({
    keepLast: z.coerce.number().int().min(0).max(10000).optional(),
    olderThanDays: z.coerce.number().min(0).max(3650).optional()
  })
  .refine((value) => value.keepLast !== undefined || value.olderThanDays !== undefined, {
    message: "Provide keepLast and/or olderThanDays."
  });

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

  if (file.size > config.maxUploadBytes) {
    throw new HTTPException(413, {
      message: `Archive is too large. Max size is ${Math.floor(config.maxUploadBytes / 1024 / 1024)}MB.`
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

app.use("/api/deployments", async (c, next) => {
  if (c.req.method !== "POST") {
    await next();
    return;
  }

  const contentLength = Number(c.req.header("Content-Length") ?? 0);
  const maxRequestBytes = config.maxUploadBytes + 1024 * 1024;
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
    throw new HTTPException(413, {
      message: `Request is too large. Max archive size is ${Math.floor(
        config.maxUploadBytes / 1024 / 1024
      )}MB.`
    });
  }

  await next();
});

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    service: "shipyard-api"
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

app.get("/api/deployments/:id/images", (c) => {
  const id = c.req.param("id");
  const deployment = store.getDeployment(id);
  if (!deployment) {
    throw new HTTPException(404, { message: "Deployment not found." });
  }

  return c.json({
    images: store.listImages(id)
  });
});

app.post("/api/deployments/:id/redeploy", (c) => {
  const id = c.req.param("id");
  try {
    const deployment = pipeline.redeploy(id);
    return c.json({ deployment });
  } catch (error) {
    throw actionError(error);
  }
});

app.post("/api/deployments/:id/rollback", async (c) => {
  const id = c.req.param("id");
  const parsed = rollbackSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: "Invalid rollback request.", issues: parsed.error.flatten() }, 400);
  }

  try {
    const result = pipeline.rollback(id, parsed.data.imageId);
    return c.json(result);
  } catch (error) {
    throw actionError(error);
  }
});

app.post("/api/deployments/:id/cancel", (c) => {
  const id = c.req.param("id");
  const deployment = store.getDeployment(id);
  if (!deployment) {
    throw new HTTPException(404, { message: "Deployment not found." });
  }

  const canceled = pipeline.cancel(id);
  if (!canceled) {
    throw new HTTPException(409, { message: "Deployment has no cancelable operation." });
  }

  return c.json({ canceled: true });
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

app.get("/api/deployments/:id/logs/search", (c) => {
  const id = c.req.param("id");
  const deployment = store.getDeployment(id);
  if (!deployment) {
    throw new HTTPException(404, { message: "Deployment not found." });
  }

  const phase = c.req.query("phase");
  const stream = c.req.query("stream");
  const limit = c.req.query("limit");
  const logs = store.searchLogs(id, {
    query: c.req.query("query"),
    phase: logPhases.includes(phase as LogPhase) ? (phase as LogPhase) : undefined,
    stream: logStreams.includes(stream as LogStream) ? (stream as LogStream) : undefined,
    from: c.req.query("from"),
    to: c.req.query("to"),
    limit: limit ? Number(limit) : undefined
  });

  return c.json({ logs });
});

app.post("/api/deployments/:id/logs/retention", async (c) => {
  const id = c.req.param("id");
  const deployment = store.getDeployment(id);
  if (!deployment) {
    throw new HTTPException(404, { message: "Deployment not found." });
  }

  const parsed = retentionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: "Invalid retention request.", issues: parsed.error.flatten() }, 400);
  }

  const deleted = store.deleteLogsByRetention(id, parsed.data);
  return c.json({ deleted });
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

const actionError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.toLowerCase().includes("not found")) {
    return new HTTPException(404, { message });
  }
  return new HTTPException(409, { message });
};

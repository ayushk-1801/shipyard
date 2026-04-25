import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  Deployment,
  DeploymentImage,
  DeploymentLog,
  DeploymentStatus,
  ImageBuildReason,
  LogPhase,
  LogRetentionOptions,
  LogSearchOptions,
  LogStream
} from "./types.js";

type DeploymentRow = {
  id: string;
  slug: string;
  source_type: "git" | "archive";
  source_ref: string;
  source_path: string | null;
  git_ref: string | null;
  status: DeploymentStatus;
  image_tag: string | null;
  container_id: string | null;
  container_name: string | null;
  container_port: number;
  live_url: string;
  host_url: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

type LogRow = {
  deployment_id: string;
  seq: number;
  phase: LogPhase;
  stream: LogStream;
  message: string;
  created_at: string;
};

type ImageRow = {
  id: string;
  deployment_id: string;
  slug: string;
  image_tag: string;
  source_hash: string;
  reason: ImageBuildReason;
  is_active: 0 | 1;
  created_at: string;
  activated_at: string | null;
};

const deploymentFromRow = (row: DeploymentRow): Deployment => ({
  id: row.id,
  slug: row.slug,
  sourceType: row.source_type,
  sourceRef: row.source_ref,
  sourcePath: row.source_path,
  gitRef: row.git_ref,
  status: row.status,
  imageTag: row.image_tag,
  containerId: row.container_id,
  containerName: row.container_name,
  containerPort: row.container_port,
  liveUrl: row.live_url,
  hostUrl: row.host_url,
  errorMessage: row.error_message,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  startedAt: row.started_at,
  finishedAt: row.finished_at
});

const logFromRow = (row: LogRow): DeploymentLog => ({
  deploymentId: row.deployment_id,
  seq: row.seq,
  phase: row.phase,
  stream: row.stream,
  message: row.message,
  createdAt: row.created_at
});

const imageFromRow = (row: ImageRow): DeploymentImage => ({
  id: row.id,
  deploymentId: row.deployment_id,
  slug: row.slug,
  imageTag: row.image_tag,
  sourceHash: row.source_hash,
  reason: row.reason,
  isActive: Boolean(row.is_active),
  createdAt: row.created_at,
  activatedAt: row.activated_at
});

const columnMap = {
  slug: "slug",
  sourceType: "source_type",
  sourceRef: "source_ref",
  sourcePath: "source_path",
  gitRef: "git_ref",
  status: "status",
  imageTag: "image_tag",
  containerId: "container_id",
  containerName: "container_name",
  containerPort: "container_port",
  liveUrl: "live_url",
  hostUrl: "host_url",
  errorMessage: "error_message",
  startedAt: "started_at",
  finishedAt: "finished_at"
} satisfies Partial<Record<keyof Deployment, string>>;

export class DeploymentStore {
  private readonly db: Database.Database;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close() {
    this.db.close();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS deployments (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        source_type TEXT NOT NULL CHECK (source_type IN ('git', 'archive')),
        source_ref TEXT NOT NULL,
        source_path TEXT,
        git_ref TEXT,
        status TEXT NOT NULL,
        image_tag TEXT,
        container_id TEXT,
        container_name TEXT,
        container_port INTEGER NOT NULL,
        live_url TEXT NOT NULL,
        host_url TEXT NOT NULL,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS logs (
        deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        phase TEXT NOT NULL,
        stream TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (deployment_id, seq)
      );

      CREATE TABLE IF NOT EXISTS deployment_images (
        id TEXT PRIMARY KEY,
        deployment_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
        slug TEXT NOT NULL,
        image_tag TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        reason TEXT NOT NULL CHECK (reason IN ('deploy', 'redeploy', 'rollback', 'backfill')),
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        activated_at TEXT,
        UNIQUE (deployment_id, image_tag)
      );

      CREATE INDEX IF NOT EXISTS logs_deployment_id_seq_idx ON logs (deployment_id, seq);
      CREATE INDEX IF NOT EXISTS deployments_status_idx ON deployments (status);
      CREATE INDEX IF NOT EXISTS deployment_images_deployment_created_idx
        ON deployment_images (deployment_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS deployment_images_deployment_active_idx
        ON deployment_images (deployment_id, is_active);

      INSERT OR IGNORE INTO deployment_images (
        id, deployment_id, slug, image_tag, source_hash, reason, is_active, created_at, activated_at
      )
      SELECT
        'backfill-' || id,
        id,
        slug,
        image_tag,
        image_tag,
        'backfill',
        CASE WHEN status = 'running' THEN 1 ELSE 0 END,
        COALESCE(finished_at, updated_at, created_at),
        CASE WHEN status = 'running' THEN COALESCE(finished_at, updated_at, created_at) ELSE NULL END
      FROM deployments
      WHERE image_tag IS NOT NULL;
    `);
  }

  insertDeployment(deployment: Deployment) {
    this.db
      .prepare(
        `
        INSERT INTO deployments (
          id, slug, source_type, source_ref, source_path, git_ref, status,
          image_tag, container_id, container_name, container_port,
          live_url, host_url, error_message, created_at, updated_at, started_at, finished_at
        ) VALUES (
          @id, @slug, @sourceType, @sourceRef, @sourcePath, @gitRef, @status,
          @imageTag, @containerId, @containerName, @containerPort,
          @liveUrl, @hostUrl, @errorMessage, @createdAt, @updatedAt, @startedAt, @finishedAt
        )
      `
      )
      .run(deployment);
  }

  deploymentExists(slug: string) {
    const row = this.db.prepare("SELECT 1 FROM deployments WHERE slug = ?").get(slug);
    return Boolean(row);
  }

  getDeployment(id: string) {
    const row = this.db.prepare("SELECT * FROM deployments WHERE id = ?").get(id) as
      | DeploymentRow
      | undefined;
    return row ? deploymentFromRow(row) : null;
  }

  listDeployments(statuses?: DeploymentStatus[]) {
    if (statuses?.length) {
      const placeholders = statuses.map(() => "?").join(", ");
      const rows = this.db
        .prepare(`SELECT * FROM deployments WHERE status IN (${placeholders}) ORDER BY created_at DESC`)
        .all(...statuses) as DeploymentRow[];
      return rows.map(deploymentFromRow);
    }

    const rows = this.db
      .prepare("SELECT * FROM deployments ORDER BY created_at DESC")
      .all() as DeploymentRow[];
    return rows.map(deploymentFromRow);
  }

  updateDeployment(id: string, patch: Partial<Omit<Deployment, "id" | "createdAt" | "updatedAt">>) {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (!entries.length) return this.getDeployment(id);

    const updatedAt = new Date().toISOString();
    const assignments = entries
      .map(([key]) => {
        const column = columnMap[key as keyof typeof columnMap];
        if (!column) throw new Error(`Unsupported deployment column: ${key}`);
        return `${column} = @${key}`;
      })
      .join(", ");

    this.db.prepare(`UPDATE deployments SET ${assignments}, updated_at = @updatedAt WHERE id = @id`).run({
      id,
      updatedAt,
      ...patch
    });

    return this.getDeployment(id);
  }

  appendLog(deploymentId: string, phase: LogPhase, stream: LogStream, message: string) {
    const insert = this.db.prepare(`
      INSERT INTO logs (deployment_id, seq, phase, stream, message, created_at)
      VALUES (@deploymentId, @seq, @phase, @stream, @message, @createdAt)
    `);
    const nextSeq = this.db.prepare(
      "SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM logs WHERE deployment_id = ?"
    );

    const transaction = this.db.transaction(() => {
      const { seq } = nextSeq.get(deploymentId) as { seq: number };
      const log: DeploymentLog = {
        deploymentId,
        seq,
        phase,
        stream,
        message,
        createdAt: new Date().toISOString()
      };
      insert.run(log);
      return log;
    });

    return transaction() as DeploymentLog;
  }

  getLogs(deploymentId: string, afterSeq = 0) {
    const rows = this.db
      .prepare("SELECT * FROM logs WHERE deployment_id = ? AND seq > ? ORDER BY seq ASC")
      .all(deploymentId, afterSeq) as LogRow[];
    return rows.map(logFromRow);
  }

  searchLogs(deploymentId: string, options: LogSearchOptions) {
    const clauses = ["deployment_id = @deploymentId"];
    const params: Record<string, unknown> = { deploymentId };

    if (options.query?.trim()) {
      clauses.push("LOWER(message) LIKE @query ESCAPE '\\'");
      params.query = `%${escapeLike(options.query.trim().toLowerCase())}%`;
    }

    if (options.phase) {
      clauses.push("phase = @phase");
      params.phase = options.phase;
    }

    if (options.stream) {
      clauses.push("stream = @stream");
      params.stream = options.stream;
    }

    if (options.from) {
      clauses.push("created_at >= @from");
      params.from = options.from;
    }

    if (options.to) {
      clauses.push("created_at <= @to");
      params.to = options.to;
    }

    const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
    params.limit = limit;

    const rows = this.db
      .prepare(
        `SELECT * FROM logs WHERE ${clauses.join(" AND ")} ORDER BY seq DESC LIMIT @limit`
      )
      .all(params) as LogRow[];
    return rows.map(logFromRow).reverse();
  }

  deleteLogsByRetention(deploymentId: string, options: LogRetentionOptions) {
    const clauses = ["deployment_id = @deploymentId"];
    const params: Record<string, unknown> = { deploymentId };

    if (options.keepLast !== undefined) {
      const keepLast = Math.max(Math.floor(options.keepLast), 0);
      const maxRow = this.db
        .prepare("SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM logs WHERE deployment_id = ?")
        .get(deploymentId) as { maxSeq: number };
      clauses.push("seq <= @maxSeqToDelete");
      params.maxSeqToDelete = Math.max(maxRow.maxSeq - keepLast, 0);
    }

    if (options.olderThanDays !== undefined) {
      const olderThanDays = Math.max(options.olderThanDays, 0);
      const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
      clauses.push("created_at < @cutoff");
      params.cutoff = cutoff;
    }

    if (clauses.length === 1) return 0;

    const result = this.db.prepare(`DELETE FROM logs WHERE ${clauses.join(" AND ")}`).run(params);
    return Number(result.changes);
  }

  insertImage(image: DeploymentImage) {
    this.db
      .prepare(
        `
        INSERT INTO deployment_images (
          id, deployment_id, slug, image_tag, source_hash, reason, is_active, created_at, activated_at
        ) VALUES (
          @id, @deploymentId, @slug, @imageTag, @sourceHash, @reason, @isActive, @createdAt, @activatedAt
        )
      `
      )
      .run({
        ...image,
        isActive: image.isActive ? 1 : 0
      });
  }

  getImage(deploymentId: string, imageId: string) {
    const row = this.db
      .prepare("SELECT * FROM deployment_images WHERE deployment_id = ? AND id = ?")
      .get(deploymentId, imageId) as ImageRow | undefined;
    return row ? imageFromRow(row) : null;
  }

  listImages(deploymentId: string) {
    const rows = this.db
      .prepare("SELECT * FROM deployment_images WHERE deployment_id = ? ORDER BY created_at DESC")
      .all(deploymentId) as ImageRow[];
    return rows.map(imageFromRow);
  }

  activateImage(deploymentId: string, imageId: string) {
    const activatedAt = new Date().toISOString();
    const transaction = this.db.transaction(() => {
      this.db.prepare("UPDATE deployment_images SET is_active = 0 WHERE deployment_id = ?").run(deploymentId);
      this.db
        .prepare(
          "UPDATE deployment_images SET is_active = 1, activated_at = ? WHERE deployment_id = ? AND id = ?"
        )
        .run(activatedAt, deploymentId, imageId);
    });
    transaction();
    return this.getImage(deploymentId, imageId);
  }

  pruneImages(deploymentId: string, keepLimit: number) {
    const keep = Math.max(keepLimit, 1);
    const rows = this.db
      .prepare(
        `
        SELECT * FROM deployment_images
        WHERE deployment_id = ? AND is_active = 0
        ORDER BY created_at DESC
      `
      )
      .all(deploymentId) as ImageRow[];
    const toDelete = rows.slice(keep);

    if (!toDelete.length) return [];

    const deleteImage = this.db.prepare("DELETE FROM deployment_images WHERE id = ?");
    const transaction = this.db.transaction(() => {
      for (const image of toDelete) {
        deleteImage.run(image.id);
      }
    });
    transaction();

    return toDelete.map(imageFromRow);
  }

  markInterruptedDeployments() {
    const interrupted = this.listDeployments(["pending", "building", "deploying"]);
    for (const deployment of interrupted) {
      this.updateDeployment(deployment.id, {
        status: "failed",
        errorMessage: "Deployment was interrupted by an API restart.",
        finishedAt: new Date().toISOString()
      });
      this.appendLog(deployment.id, "system", "stderr", "Marked failed after API restart.");
    }

    return interrupted.length;
  }
}

const escapeLike = (value: string) => value.replace(/[\\%_]/gu, (match) => `\\${match}`);

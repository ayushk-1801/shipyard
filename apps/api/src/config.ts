import path from "node:path";

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const numberFromEnv = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const publicBaseUrl = stripTrailingSlash(process.env.PUBLIC_BASE_URL ?? "http://localhost:8080");
const publicUrl = new URL(publicBaseUrl);

export const config = {
  port: numberFromEnv("PORT", 3001),
  databasePath: process.env.DATABASE_PATH ?? path.resolve("data/brimble.db"),
  workspaceRoot: process.env.WORKSPACE_ROOT ?? path.resolve("workspaces"),
  publicBaseUrl,
  publicHostname:
    publicUrl.hostname === "127.0.0.1" || publicUrl.hostname === "localhost"
      ? "localhost"
      : publicUrl.hostname,
  caddyAdminUrl: stripTrailingSlash(process.env.CADDY_ADMIN_URL ?? "http://localhost:2019"),
  dockerNetwork: process.env.DOCKER_NETWORK ?? "brimble-runtime",
  railpackBin: process.env.RAILPACK_BIN ?? "railpack",
  defaultContainerPort: numberFromEnv("DEFAULT_CONTAINER_PORT", 3000),
  maxUploadBytes: numberFromEnv("MAX_UPLOAD_BYTES", 50 * 1024 * 1024)
};

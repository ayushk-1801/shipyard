import type { Deployment } from "./types.js";

export const slugify = (value: string) => {
  const cleaned = value
    .toLowerCase()
    .replace(/\.git$/u, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 42);

  return cleaned || "app";
};

export const nameFromSource = (sourceRef: string) => {
  try {
    const url = new URL(sourceRef);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.at(-1) ?? "app";
  } catch {
    return sourceRef.split(/[\\/]/u).at(-1) ?? "app";
  }
};

export const uniqueSlug = (base: string, exists: (slug: string) => boolean) => {
  const normalized = slugify(base);
  if (!exists(normalized)) return normalized;

  for (let attempt = 2; attempt < 1000; attempt += 1) {
    const candidate = `${normalized}-${attempt}`;
    if (!exists(candidate)) return candidate;
  }

  return `${normalized}-${Date.now().toString(36)}`;
};

export const hostUrlFor = (deployment: Pick<Deployment, "slug">, publicBaseUrl: string) => {
  const base = new URL(publicBaseUrl);
  const port = base.port ? `:${base.port}` : "";
  const hostname =
    base.hostname === "localhost" || base.hostname === "127.0.0.1"
      ? `${deployment.slug}.localhost`
      : `${deployment.slug}.${base.hostname}`;

  return `${base.protocol}//${hostname}${port}/`;
};

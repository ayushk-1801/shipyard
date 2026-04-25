import { describe, expect, it } from "vitest";
import { renderCaddyfile } from "../caddy.js";
import type { Deployment } from "../types.js";

const deployment: Deployment = {
  id: "dep_1",
  slug: "sample-app",
  sourceType: "git",
  sourceRef: "https://github.com/acme/sample-app.git",
  sourcePath: null,
  gitRef: null,
  status: "running",
  imageTag: "brimble-sample-app:dep",
  containerId: "container",
  containerName: "brimble-sample-app-dep",
  containerPort: 3000,
  liveUrl: "http://localhost:8080/d/sample-app/",
  hostUrl: "http://sample-app.localhost:8080/",
  errorMessage: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  startedAt: null,
  finishedAt: null
};

describe("renderCaddyfile", () => {
  it("renders API, path, and hostname routes", () => {
    const caddyfile = renderCaddyfile([deployment]);

    expect(caddyfile).toContain("handle /api/*");
    expect(caddyfile).toContain("@host_sample_app host sample-app.localhost");
    expect(caddyfile).toContain("handle_path /d/sample-app/*");
    expect(caddyfile).toContain("reverse_proxy brimble-sample-app-dep:3000");
  });

  it("uses the configured public hostname for host routes", () => {
    const caddyfile = renderCaddyfile([deployment], "preview.example.com");

    expect(caddyfile).toContain("@host_sample_app host sample-app.preview.example.com");
  });

  it("does not route failed deployments", () => {
    const caddyfile = renderCaddyfile([{ ...deployment, status: "failed" }]);

    expect(caddyfile).not.toContain("sample-app.localhost");
    expect(caddyfile).not.toContain("handle_path /d/sample-app/*");
  });
});

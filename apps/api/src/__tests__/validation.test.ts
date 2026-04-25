import { describe, expect, it } from "vitest";
import { createDeploymentSchema } from "../validation.js";

describe("createDeploymentSchema", () => {
  it("requires a valid git URL for git deployments", () => {
    expect(createDeploymentSchema.safeParse({ sourceType: "git", gitUrl: "nope" }).success).toBe(false);
    expect(
      createDeploymentSchema.safeParse({
        sourceType: "git",
        gitUrl: "https://github.com/acme/app.git",
        containerPort: "3000"
      }).success
    ).toBe(true);
  });

  it("validates container ports", () => {
    expect(
      createDeploymentSchema.safeParse({
        sourceType: "archive",
        containerPort: "70000"
      }).success
    ).toBe(false);
  });
});

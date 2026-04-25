import { describe, expect, it } from "vitest";
import { safeArchivePath, supportedArchive } from "../archive.js";

describe("archive safety", () => {
  it("accepts supported extensions", () => {
    expect(supportedArchive("app.zip")).toBe(true);
    expect(supportedArchive("app.tar.gz")).toBe(true);
    expect(supportedArchive("app.tgz")).toBe(true);
    expect(supportedArchive("Dockerfile")).toBe(false);
  });

  it("rejects traversal paths", () => {
    expect(safeArchivePath("src/index.js")).toBe(true);
    expect(safeArchivePath("../secret")).toBe(false);
    expect(safeArchivePath("src/../../secret")).toBe(false);
    expect(safeArchivePath("/etc/passwd")).toBe(false);
  });
});

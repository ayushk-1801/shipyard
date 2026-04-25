import fs from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import * as tar from "tar";

export const supportedArchive = (filename: string) => {
  const lower = filename.toLowerCase();
  return lower.endsWith(".zip") || lower.endsWith(".tar.gz") || lower.endsWith(".tgz");
};

export const safeArchivePath = (entryPath: string) => {
  const unixPath = entryPath.replace(/\\/gu, "/");
  const normalized = path.posix.normalize(unixPath);
  return (
    normalized !== "." &&
    !path.posix.isAbsolute(normalized) &&
    !normalized.startsWith("../") &&
    normalized !== ".." &&
    !normalized.includes("/../")
  );
};

export const extractArchive = async (archivePath: string, destination: string) => {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });

  const lower = archivePath.toLowerCase();

  if (lower.endsWith(".zip")) {
    const zip = new AdmZip(archivePath);
    for (const entry of zip.getEntries()) {
      if (!safeArchivePath(entry.entryName)) {
        throw new Error(`Archive contains an unsafe path: ${entry.entryName}`);
      }
    }
    zip.extractAllTo(destination, true);
    return;
  }

  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    await tar.x({
      file: archivePath,
      cwd: destination,
      filter: (entryPath) => {
        if (!safeArchivePath(entryPath)) {
          throw new Error(`Archive contains an unsafe path: ${entryPath}`);
        }
        return true;
      }
    });
    return;
  }

  throw new Error("Unsupported archive type. Use .zip, .tar.gz, or .tgz.");
};

import { spawn } from "node:child_process";
import type { LogPhase, LogStream } from "./types.js";

type LineHandler = (phase: LogPhase, stream: LogStream, line: string) => void;

const streamLines = (
  phase: LogPhase,
  stream: LogStream,
  onLine: LineHandler,
  onFlush: (flush: () => void) => void
) => {
  let buffered = "";

  const write = (chunk: Buffer) => {
    buffered += chunk.toString("utf8");
    const lines = buffered.split(/\r?\n/u);
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) onLine(phase, stream, line);
    }
  };

  onFlush(() => {
    if (buffered.trim()) onLine(phase, stream, buffered);
    buffered = "";
  });

  return write;
};

export const runLoggedCommand = async (
  command: string,
  args: string[],
  cwd: string,
  phase: LogPhase,
  onLine: LineHandler,
  env: NodeJS.ProcessEnv = process.env
) => {
  await new Promise<void>((resolve, reject) => {
    let flushStdout = () => {};
    let flushStderr = () => {};
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout.on("data", streamLines(phase, "stdout", onLine, (flush) => (flushStdout = flush)));
    child.stderr.on("data", streamLines(phase, "stderr", onLine, (flush) => (flushStderr = flush)));
    child.on("error", reject);
    child.on("close", (code) => {
      flushStdout();
      flushStderr();
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
      }
    });
  });
};

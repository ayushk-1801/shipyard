export const deploymentStatuses = [
  "pending",
  "building",
  "deploying",
  "running",
  "failed"
] as const;

export type DeploymentStatus = (typeof deploymentStatuses)[number];
export type SourceType = "git" | "archive";
export type LogPhase = "system" | "clone" | "extract" | "build" | "deploy" | "runtime";
export type LogStream = "stdout" | "stderr";

export interface Deployment {
  id: string;
  slug: string;
  sourceType: SourceType;
  sourceRef: string;
  sourcePath: string | null;
  gitRef: string | null;
  status: DeploymentStatus;
  imageTag: string | null;
  containerId: string | null;
  containerName: string | null;
  containerPort: number;
  liveUrl: string;
  hostUrl: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface DeploymentLog {
  deploymentId: string;
  seq: number;
  phase: LogPhase;
  stream: LogStream;
  message: string;
  createdAt: string;
}

export interface DeploymentEvent {
  event: "deployment" | "snapshot" | "heartbeat";
  data: unknown;
  id?: string;
}

export interface LogEvent {
  event: "log" | "status" | "done" | "heartbeat";
  data: unknown;
  id?: string;
}

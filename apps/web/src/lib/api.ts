export type DeploymentStatus = "pending" | "building" | "deploying" | "running" | "failed";
export type SourceType = "git" | "archive";

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
  phase: string;
  stream: "stdout" | "stderr";
  message: string;
  createdAt: string;
}

export type ImageBuildReason = "deploy" | "redeploy" | "rollback" | "backfill";

export interface DeploymentImage {
  id: string;
  deploymentId: string;
  slug: string;
  imageTag: string;
  sourceHash: string;
  reason: ImageBuildReason;
  isActive: boolean;
  createdAt: string;
  activatedAt: string | null;
}

export interface LogSearchParams {
  query?: string;
  phase?: string;
  stream?: "stdout" | "stderr";
  limit?: number;
}

export interface LogRetentionParams {
  keepLast?: number;
  olderThanDays?: number;
}

export const deploymentsQueryKey = ["deployments"] as const;
export const deploymentImagesQueryKey = (deploymentId: string | null) =>
  ["deployment-images", deploymentId] as const;

const readJson = async <T>(response: Response, fallback: string): Promise<T> => {
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? fallback);
  }
  return body;
};

export const listDeployments = async () => {
  const response = await fetch("/api/deployments");
  if (!response.ok) throw new Error("Failed to load deployments.");
  return (await response.json()) as { deployments: Deployment[] };
};

export const createDeployment = async (formData: FormData) => {
  const response = await fetch("/api/deployments", {
    method: "POST",
    body: formData
  });

  const body = (await response.json()) as { deployment?: Deployment; error?: string };
  if (!response.ok || !body.deployment) {
    throw new Error(body.error ?? "Failed to create deployment.");
  }

  return body.deployment;
};

export const listDeploymentImages = async (deploymentId: string) => {
  const response = await fetch(`/api/deployments/${deploymentId}/images`);
  return readJson<{ images: DeploymentImage[] }>(response, "Failed to load image history.");
};

export const redeployDeployment = async (deploymentId: string) => {
  const response = await fetch(`/api/deployments/${deploymentId}/redeploy`, {
    method: "POST"
  });
  return readJson<{ deployment: Deployment }>(response, "Failed to queue redeploy.");
};

export const rollbackDeployment = async (deploymentId: string, imageId: string) => {
  const response = await fetch(`/api/deployments/${deploymentId}/rollback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ imageId })
  });
  return readJson<{ deployment: Deployment; image: DeploymentImage }>(
    response,
    "Failed to queue rollback."
  );
};

export const cancelDeployment = async (deploymentId: string) => {
  const response = await fetch(`/api/deployments/${deploymentId}/cancel`, {
    method: "POST"
  });
  return readJson<{ canceled: boolean }>(response, "Failed to cancel deployment.");
};

export const searchDeploymentLogs = async (deploymentId: string, params: LogSearchParams) => {
  const search = new URLSearchParams();
  if (params.query) search.set("query", params.query);
  if (params.phase) search.set("phase", params.phase);
  if (params.stream) search.set("stream", params.stream);
  if (params.limit) search.set("limit", String(params.limit));

  const response = await fetch(`/api/deployments/${deploymentId}/logs/search?${search.toString()}`);
  return readJson<{ logs: DeploymentLog[] }>(response, "Failed to search logs.");
};

export const applyLogRetention = async (deploymentId: string, params: LogRetentionParams) => {
  const response = await fetch(`/api/deployments/${deploymentId}/logs/retention`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(params)
  });
  return readJson<{ deleted: number }>(response, "Failed to apply log retention.");
};

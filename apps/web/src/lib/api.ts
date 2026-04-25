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

export const deploymentsQueryKey = ["deployments"] as const;

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

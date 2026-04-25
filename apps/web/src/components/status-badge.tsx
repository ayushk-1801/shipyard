import type { DeploymentStatus } from "@/lib/api";
import { Badge } from "@/components/ui/badge";

const variantByStatus: Record<DeploymentStatus, "muted" | "amber" | "green" | "red"> = {
  pending: "muted",
  building: "amber",
  deploying: "amber",
  running: "green",
  failed: "red"
};

export const StatusBadge = ({ status }: { status: DeploymentStatus }) => (
  <Badge variant={variantByStatus[status]}>{status}</Badge>
);

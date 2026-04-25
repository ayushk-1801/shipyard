import { useEffect, useState } from "react";
import type { Deployment, DeploymentLog } from "@/lib/api";

export const useDeploymentLogs = (deploymentId: string | null) => {
  const [logs, setLogs] = useState<DeploymentLog[]>([]);
  const [status, setStatus] = useState<Deployment | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    setLogs([]);
    setStatus(null);
    setConnected(false);

    if (!deploymentId) return;

    const source = new EventSource(`/api/deployments/${deploymentId}/logs`);

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    source.addEventListener("status", (event) => {
      setStatus(JSON.parse(event.data) as Deployment);
    });

    source.addEventListener("log", (event) => {
      const log = JSON.parse(event.data) as DeploymentLog;
      setLogs((current) => {
        if (current.some((item) => item.seq === log.seq)) return current;
        return [...current, log].sort((a, b) => a.seq - b.seq);
      });
    });

    return () => source.close();
  }, [deploymentId]);

  return { logs, status, connected };
};

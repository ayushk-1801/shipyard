import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Deployment } from "@/lib/api";
import { deploymentsQueryKey } from "@/lib/api";

export const useDeploymentEvents = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const source = new EventSource("/api/deployments/events");

    source.addEventListener("snapshot", (event) => {
      const deployments = JSON.parse(event.data) as Deployment[];
      queryClient.setQueryData(deploymentsQueryKey, { deployments });
    });

    source.addEventListener("deployment", (event) => {
      const deployment = JSON.parse(event.data) as Deployment;
      queryClient.setQueryData<{ deployments: Deployment[] }>(deploymentsQueryKey, (current) => {
        if (!current) return { deployments: [deployment] };
        const exists = current.deployments.some((item) => item.id === deployment.id);
        const deployments = exists
          ? current.deployments.map((item) => (item.id === deployment.id ? deployment : item))
          : [deployment, ...current.deployments];
        return { deployments };
      });
    });

    return () => source.close();
  }, [queryClient]);
};

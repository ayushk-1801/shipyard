import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Server } from "lucide-react";
import { DeployForm } from "@/components/deploy-form";
import { DeploymentsTable } from "@/components/deployments-table";
import { ImageHistory } from "@/components/image-history";
import { LogStream } from "@/components/log-stream";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  cancelDeployment,
  deploymentImagesQueryKey,
  deploymentsQueryKey,
  listDeploymentImages,
  listDeployments,
  redeployDeployment,
  rollbackDeployment,
  type Deployment,
  type DeploymentImage
} from "@/lib/api";
import { useDeploymentEvents } from "@/hooks/use-deployment-events";
import { toast } from "sonner";

export const Dashboard = () => {
  useDeploymentEvents();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: deploymentsQueryKey,
    queryFn: listDeployments
  });

  const deployments = data?.deployments ?? [];
  const selectedDeployment = deployments.find((deployment) => deployment.id === selectedId) ?? null;
  const activeStatuses = ["pending", "building", "deploying"];
  const selectedHasActiveWork = selectedDeployment
    ? activeStatuses.includes(selectedDeployment.status)
    : false;

  const imagesQuery = useQuery({
    queryKey: deploymentImagesQueryKey(selectedId),
    queryFn: () => listDeploymentImages(selectedId!),
    enabled: Boolean(selectedId),
    refetchInterval: selectedHasActiveWork ? 2000 : false
  });

  const refreshAfterAction = async (deploymentId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: deploymentsQueryKey }),
      queryClient.invalidateQueries({ queryKey: deploymentImagesQueryKey(deploymentId) })
    ]);
  };

  const redeployMutation = useMutation({
    mutationFn: redeployDeployment,
    onMutate: (deploymentId) => setBusyId(deploymentId),
    onSuccess: (_result, deploymentId) => {
      toast.success("Redeploy queued.");
      void refreshAfterAction(deploymentId);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to redeploy."),
    onSettled: () => setBusyId(null)
  });

  const cancelMutation = useMutation({
    mutationFn: cancelDeployment,
    onMutate: (deploymentId) => setBusyId(deploymentId),
    onSuccess: (_result, deploymentId) => {
      toast.success("Deployment canceled.");
      void refreshAfterAction(deploymentId);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to cancel."),
    onSettled: () => setBusyId(null)
  });

  const rollbackMutation = useMutation({
    mutationFn: ({ deploymentId, imageId }: { deploymentId: string; imageId: string }) =>
      rollbackDeployment(deploymentId, imageId),
    onMutate: ({ deploymentId }) => setBusyId(deploymentId),
    onSuccess: (_result, variables) => {
      toast.success("Rollback queued.");
      void refreshAfterAction(variables.deploymentId);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to rollback."),
    onSettled: () => setBusyId(null)
  });

  useEffect(() => {
    if (!selectedId && deployments[0]) {
      setSelectedId(deployments[0].id);
    }
  }, [deployments, selectedId]);

  const counts = useMemo(() => {
    const running = deployments.filter((deployment) => deployment.status === "running").length;
    const active = deployments.filter((deployment) =>
      ["pending", "building", "deploying"].includes(deployment.status)
    ).length;
    return { running, active, total: deployments.length };
  }, [deployments]);

  const selectDeployment = (deployment: Deployment) => setSelectedId(deployment.id);
  const rollbackImage = (image: DeploymentImage) => {
    if (!selectedId) return;
    rollbackMutation.mutate({ deploymentId: selectedId, imageId: image.id });
  };

  return (
    <main className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <section className="flex flex-col gap-4 border-b pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Server className="h-5 w-5" />
              </div>
              <h1 className="text-2xl font-semibold tracking-normal">Brimble Pipeline</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="muted">{counts.total} total</Badge>
              <Badge variant="amber">{counts.active} active</Badge>
              <Badge variant="green">{counts.running} running</Badge>
              {isLoading ? <Badge variant="muted">loading</Badge> : null}
            </div>
          </div>
          <Card className="w-full md:w-[360px]">
            <CardContent className="flex items-center gap-3 p-4">
              <Activity className="h-5 w-5 text-emerald-600" />
              <div className="min-w-0">
                <div className="text-sm font-medium">Caddy ingress</div>
                <div className="truncate text-xs text-muted-foreground">localhost:8080</div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
          <DeployForm onCreated={selectDeployment} />
          <DeploymentsTable
            deployments={deployments}
            selectedId={selectedId}
            onSelect={selectDeployment}
            onRedeploy={(deployment) => redeployMutation.mutate(deployment.id)}
            onCancel={(deployment) => cancelMutation.mutate(deployment.id)}
            busyId={busyId}
          />
        </section>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
          <LogStream deploymentId={selectedId} />
          <ImageHistory
            images={imagesQuery.data?.images ?? []}
            loading={imagesQuery.isLoading}
            busy={Boolean(busyId) || selectedHasActiveWork}
            onRollback={rollbackImage}
          />
        </section>
      </div>
    </main>
  );
};

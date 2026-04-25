import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Moon, Server, Sun } from "lucide-react";
import { DeployForm } from "@/components/deploy-form";
import { DeploymentsTable } from "@/components/deployments-table";
import { ImageHistory } from "@/components/image-history";
import { LogStream } from "@/components/log-stream";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
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
import { useTheme } from "@/hooks/use-theme";
import { toast } from "sonner";

export const Dashboard = () => {
  useDeploymentEvents();
  const { theme, setTheme } = useTheme();
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
    const failed = deployments.filter((deployment) => deployment.status === "failed").length;
    return { running, active, failed, total: deployments.length };
  }, [deployments]);
  const runningPercent = counts.total ? Math.round((counts.running / counts.total) * 100) : 0;

  const selectDeployment = (deployment: Deployment) => setSelectedId(deployment.id);
  const rollbackImage = (image: DeploymentImage) => {
    if (!selectedId) return;
    rollbackMutation.mutate({ deploymentId: selectedId, imageId: image.id });
  };

  return (
    <main className="min-h-screen bg-background px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <section className="flex flex-col gap-4 border-b pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
                <Server className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-normal">Brimble Pipeline</h1>
                <p className="text-sm text-muted-foreground">One pipeline for builds, containers, logs, and ingress.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="muted">{counts.total} total</Badge>
              <Badge variant="amber">{counts.active} active</Badge>
              <Badge variant="green">{counts.running} running</Badge>
              <Badge variant={counts.failed ? "red" : "muted"}>{counts.failed} failed</Badge>
              {isLoading ? <Badge variant="muted">loading</Badge> : null}
            </div>
          </div>
          <div className="flex w-full flex-col gap-3 md:w-[420px]">
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {theme === "dark" ? "Light" : "Dark"}
              </Button>
            </div>
            <Card className="overflow-hidden">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    <Activity className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium">Caddy ingress</div>
                      <Badge variant="green">online</Badge>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">localhost:8080</div>
                  </div>
                </div>
                <Separator className="my-3" />
                <div className="space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Running deployments</span>
                    <span>{runningPercent}%</span>
                  </div>
                  <Progress value={runningPercent} />
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Total", counts.total, "All submitted deployments"],
            ["Active", counts.active, "Queued or in progress"],
            ["Running", counts.running, "Routed through Caddy"],
            ["Failed", counts.failed, "Needs inspection"]
          ].map(([label, value, description]) => (
            <Card key={label} className="overflow-hidden">
              <CardContent className="p-4">
                <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
                <div className="mt-2 text-2xl font-semibold tracking-normal">{value}</div>
                <div className="mt-1 text-xs text-muted-foreground">{description}</div>
              </CardContent>
            </Card>
          ))}
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
            loading={isLoading}
          />
        </section>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
          <LogStream deploymentId={selectedId} />
          <div className="space-y-5">
            {selectedDeployment ? (
              <Card className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="text-xs font-medium uppercase text-muted-foreground">Selected deployment</div>
                  <div className="mt-2 truncate text-sm font-medium">{selectedDeployment.slug}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{selectedDeployment.sourceRef}</div>
                  <Separator className="my-3" />
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="text-muted-foreground">Port</div>
                      <div className="mt-1 font-medium">{selectedDeployment.containerPort}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Status</div>
                      <div className="mt-1 font-medium">{selectedDeployment.status}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : null}
            <ImageHistory
              images={imagesQuery.data?.images ?? []}
              loading={imagesQuery.isLoading}
              busy={Boolean(busyId) || selectedHasActiveWork}
              onRollback={rollbackImage}
            />
          </div>
        </section>
      </div>
    </main>
  );
};

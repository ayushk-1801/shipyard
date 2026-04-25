import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Clock, ExternalLink, Globe, Moon, Server, Sun } from "lucide-react";
import { DeployForm } from "@/components/deploy-form";
import { DeploymentsTable } from "@/components/deployments-table";
import { ImageHistory } from "@/components/image-history";
import { LogStream } from "@/components/log-stream";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

const shortDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric"
  }).format(new Date(value));

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
    <main className="min-h-screen bg-background">
      <div className="border-b bg-card/75 backdrop-blur">
        <div className="mx-auto flex max-w-[96rem] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
              <Server className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold tracking-normal">Shipyard</h1>
              <p className="truncate text-sm text-muted-foreground">Builds, runtime, logs, and Caddy ingress</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="muted">{counts.total} total</Badge>
            <Badge variant="amber">{counts.active} active</Badge>
            <Badge variant="green">{counts.running} running</Badge>
            <Badge variant={counts.failed ? "red" : "muted"}>{counts.failed} failed</Badge>
            {isLoading ? <Badge variant="muted">loading</Badge> : null}
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
        </div>
      </div>

      <div className="mx-auto flex max-w-[96rem] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="grid overflow-hidden rounded-lg border bg-card shadow-sm md:grid-cols-[1.25fr_1fr] xl:grid-cols-[1.35fr_repeat(4,minmax(0,1fr))]">
          <div className="border-b p-4 md:border-b-0 md:border-r">
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
            <div className="mt-4 space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Running deployments</span>
                <span>{runningPercent}%</span>
              </div>
              <Progress value={runningPercent} />
            </div>
          </div>

          {[
            ["Total", counts.total, "Submitted"],
            ["Active", counts.active, "In progress"],
            ["Running", counts.running, "Serving"],
            ["Failed", counts.failed, "Attention"]
          ].map(([label, value, description]) => (
            <div key={label} className="border-b p-4 last:border-b-0 md:border-r md:last:border-r-0 xl:border-b-0">
              <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
              <div className="mt-2 text-2xl font-semibold tracking-normal">{value}</div>
              <div className="mt-1 text-xs text-muted-foreground">{description}</div>
            </div>
          ))}
        </section>

        <section className="grid items-start gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-5 xl:sticky xl:top-5">
            <DeployForm onCreated={selectDeployment} />
            <SelectedDeploymentPanel deployment={selectedDeployment} />
            <ImageHistory
              images={imagesQuery.data?.images ?? []}
              loading={imagesQuery.isLoading}
              busy={Boolean(busyId) || selectedHasActiveWork}
              onRollback={rollbackImage}
            />
          </aside>

          <section className="min-w-0 space-y-5">
            <DeploymentsTable
              deployments={deployments}
              selectedId={selectedId}
              onSelect={selectDeployment}
              onRedeploy={(deployment) => redeployMutation.mutate(deployment.id)}
              onCancel={(deployment) => cancelMutation.mutate(deployment.id)}
              busyId={busyId}
              loading={isLoading}
            />
            <LogStream deploymentId={selectedId} />
          </section>
        </section>
      </div>
    </main>
  );
};

const SelectedDeploymentPanel = ({ deployment }: { deployment: Deployment | null }) => (
  <Card className="overflow-hidden">
    <CardHeader>
      <CardTitle>Selected Deployment</CardTitle>
      <CardDescription>{deployment ? "Current target and runtime details." : "No deployment selected."}</CardDescription>
    </CardHeader>
    <Separator />
    <CardContent className="space-y-4 pt-5">
      {!deployment ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Select a row to inspect image history, routes, and logs.
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{deployment.slug}</div>
                <div className="truncate text-xs text-muted-foreground">{deployment.sourceRef}</div>
              </div>
              <StatusBadge status={deployment.status} />
            </div>
            <code className="block truncate rounded-md bg-muted px-2.5 py-2 text-xs">
              {deployment.imageTag ?? "image pending"}
            </code>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md border p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Globe className="h-3.5 w-3.5" />
                Port
              </div>
              <div className="mt-1 font-medium">{deployment.containerPort}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                Updated
              </div>
              <div className="mt-1 font-medium">{shortDate(deployment.updatedAt)}</div>
            </div>
          </div>

          {deployment.status === "running" ? (
            <div className="grid gap-2">
              <Button asChild variant="outline" size="sm" className="justify-between">
                <a href={deployment.hostUrl} target="_blank" rel="noreferrer">
                  Host route
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
              <Button asChild variant="outline" size="sm" className="justify-between">
                <a href={deployment.liveUrl} target="_blank" rel="noreferrer">
                  Path route
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          ) : null}

          {deployment.errorMessage ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {deployment.errorMessage}
            </div>
          ) : null}
        </>
      )}
    </CardContent>
  </Card>
);

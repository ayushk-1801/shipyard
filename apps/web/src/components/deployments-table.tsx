import { ExternalLink, RefreshCcw, XCircle } from "lucide-react";
import type { Deployment } from "@/lib/api";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface DeploymentsTableProps {
  deployments: Deployment[];
  selectedId: string | null;
  onSelect: (deployment: Deployment) => void;
  onRedeploy: (deployment: Deployment) => void;
  onCancel: (deployment: Deployment) => void;
  busyId?: string | null;
}

const shortDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric"
  }).format(new Date(value));

const cancelable = new Set(["pending", "building", "deploying"]);

export const DeploymentsTable = ({
  deployments,
  selectedId,
  onSelect,
  onRedeploy,
  onCancel,
  busyId
}: DeploymentsTableProps) => (
  <Card className="min-h-[370px]">
    <CardHeader>
      <CardTitle>Deployments</CardTitle>
    </CardHeader>
    <CardContent>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>App</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Image</TableHead>
            <TableHead>Live</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deployments.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="h-44 text-center text-muted-foreground">
                No deployments yet
              </TableCell>
            </TableRow>
          ) : (
            deployments.map((deployment) => (
              <TableRow
                key={deployment.id}
                className={cn("cursor-pointer", selectedId === deployment.id && "bg-muted")}
                onClick={() => onSelect(deployment)}
              >
                <TableCell>
                  <div className="max-w-[220px]">
                    <div className="font-medium">{deployment.slug}</div>
                    <div className="truncate text-xs text-muted-foreground">{deployment.sourceRef}</div>
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge status={deployment.status} />
                </TableCell>
                <TableCell>
                  <code className="block max-w-[180px] truncate rounded bg-muted px-2 py-1 text-xs">
                    {deployment.imageTag ?? "pending"}
                  </code>
                </TableCell>
                <TableCell>
                  {deployment.status === "running" ? (
                    <a
                      href={deployment.hostUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      Open
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <span className="text-sm text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {shortDate(deployment.updatedAt)}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="Redeploy"
                      disabled={busyId === deployment.id || cancelable.has(deployment.status)}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRedeploy(deployment);
                      }}
                    >
                      <RefreshCcw className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      title="Cancel"
                      disabled={busyId === deployment.id || !cancelable.has(deployment.status)}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCancel(deployment);
                      }}
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </CardContent>
  </Card>
);

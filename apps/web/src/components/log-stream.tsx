import { useEffect, useRef, useState } from "react";
import { Circle, ExternalLink } from "lucide-react";
import { useDeploymentLogs } from "@/hooks/use-deployment-logs";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const LogStream = ({ deploymentId }: { deploymentId: string | null }) => {
  const { logs, status, connected } = useDeploymentLogs(deploymentId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  useEffect(() => {
    if (!stickToBottom || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs, stickToBottom]);

  return (
    <Card className="min-h-[370px]">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>Logs</CardTitle>
          {status ? (
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={status.status} />
              {status.status === "running" ? (
                <>
                  <a
                    href={status.liveUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
                  >
                    Path
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <a
                    href={status.hostUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
                  >
                    Host
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
        <Badge variant={connected ? "green" : "muted"} className="gap-1">
          <Circle className="h-2 w-2 fill-current" />
          SSE
        </Badge>
      </CardHeader>
      <CardContent>
        <div
          ref={scrollRef}
          className="h-[300px] overflow-auto rounded-md border bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100"
          onScroll={(event) => {
            const element = event.currentTarget;
            const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
            setStickToBottom(distance < 80);
          }}
        >
          {!deploymentId ? (
            <div className="text-slate-400">Select a deployment</div>
          ) : logs.length === 0 ? (
            <div className="text-slate-400">Waiting for logs</div>
          ) : (
            logs.map((log) => (
              <div key={log.seq} className={log.stream === "stderr" ? "text-red-200" : "text-slate-100"}>
                <span className="text-slate-500">{String(log.seq).padStart(4, "0")}</span>{" "}
                <span className="text-amber-200">{log.phase}</span>{" "}
                <span className="text-slate-500">{log.stream}</span> {log.message}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
};

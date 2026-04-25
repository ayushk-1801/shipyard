import { useEffect, useRef, useState } from "react";
import { Circle, ExternalLink, Search, Trash2, X } from "lucide-react";
import { useDeploymentLogs } from "@/hooks/use-deployment-logs";
import { applyLogRetention, searchDeploymentLogs, type DeploymentLog } from "@/lib/api";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

const phases = ["system", "clone", "extract", "build", "deploy", "runtime"] as const;
const streams = ["stdout", "stderr"] as const;

export const LogStream = ({ deploymentId }: { deploymentId: string | null }) => {
  const { logs, status, connected } = useDeploymentLogs(deploymentId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState("");
  const [stream, setStream] = useState("");
  const [limit, setLimit] = useState("200");
  const [searchResults, setSearchResults] = useState<DeploymentLog[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [keepLast, setKeepLast] = useState("500");
  const [olderThanDays, setOlderThanDays] = useState("");
  const [retaining, setRetaining] = useState(false);
  const visibleLogs = searchResults ?? logs;
  const searchMode = searchResults !== null;

  useEffect(() => {
    if (searchMode || !stickToBottom || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visibleLogs, stickToBottom, searchMode]);

  useEffect(() => {
    setSearchResults(null);
    setQuery("");
    setPhase("");
    setStream("");
  }, [deploymentId]);

  const runSearch = async () => {
    if (!deploymentId) return;
    setSearching(true);
    try {
      const result = await searchDeploymentLogs(deploymentId, {
        query: query.trim() || undefined,
        phase: phase || undefined,
        stream: stream === "stdout" || stream === "stderr" ? stream : undefined,
        limit: Number(limit) || 200
      });
      setSearchResults(result.logs);
      setStickToBottom(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to search logs.");
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setSearchResults(null);
    setQuery("");
    setPhase("");
    setStream("");
    setStickToBottom(true);
  };

  const applyRetention = async () => {
    if (!deploymentId) return;
    const payload: { keepLast?: number; olderThanDays?: number } = {};
    if (keepLast.trim()) payload.keepLast = Number(keepLast);
    if (olderThanDays.trim()) payload.olderThanDays = Number(olderThanDays);
    if (payload.keepLast === undefined && payload.olderThanDays === undefined) {
      toast.error("Set keep-last logs, older-than days, or both.");
      return;
    }

    setRetaining(true);
    try {
      const result = await applyLogRetention(deploymentId, payload);
      toast.success(`Deleted ${result.deleted} persisted log rows.`);
      if (searchMode) {
        await runSearch();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to apply retention.");
    } finally {
      setRetaining(false);
    }
  };

  return (
    <Card className="min-h-[370px] overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div className="space-y-1">
          <CardTitle>Logs</CardTitle>
          <CardDescription>Live SSE stream with persisted replay and search.</CardDescription>
          {status ? (
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={status.status} />
              {status.status === "running" ? (
                <>
                  <a
                    href={status.liveUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-300"
                  >
                    Path
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <a
                    href={status.hostUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-300"
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
      <Separator />
      <CardContent className="space-y-3 pt-5">
        <div className="grid gap-3 rounded-md border p-3 lg:grid-cols-[minmax(0,1fr)_150px_130px_96px_auto]">
          <div className="space-y-1">
            <Label htmlFor="log-query">Search logs</Label>
            <Input
              id="log-query"
              value={query}
              placeholder="message contains..."
              disabled={!deploymentId}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void runSearch();
              }}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="log-phase">Phase</Label>
            <Select
              id="log-phase"
              value={phase}
              disabled={!deploymentId}
              onChange={(event) => setPhase(event.target.value)}
            >
              <option value="">All</option>
              {phases.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="log-stream">Stream</Label>
            <Select
              id="log-stream"
              value={stream}
              disabled={!deploymentId}
              onChange={(event) => setStream(event.target.value)}
            >
              <option value="">All</option>
              {streams.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="log-limit">Limit</Label>
            <Input
              id="log-limit"
              inputMode="numeric"
              value={limit}
              disabled={!deploymentId}
              onChange={(event) => setLimit(event.target.value)}
            />
          </div>
          <div className="flex items-end gap-1">
            <Button type="button" disabled={!deploymentId || searching} onClick={() => void runSearch()}>
              <Search className="h-4 w-4" />
              Search
            </Button>
            <Button type="button" variant="outline" size="icon" title="Clear search" onClick={clearSearch}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="w-32 space-y-1">
            <Label htmlFor="keep-last">Keep last</Label>
            <Input
              id="keep-last"
              inputMode="numeric"
              value={keepLast}
              disabled={!deploymentId}
              onChange={(event) => setKeepLast(event.target.value)}
            />
          </div>
          <div className="w-36 space-y-1">
            <Label htmlFor="older-than">Older than days</Label>
            <Input
              id="older-than"
              inputMode="numeric"
              value={olderThanDays}
              disabled={!deploymentId}
              onChange={(event) => setOlderThanDays(event.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!deploymentId || retaining}
            onClick={() => void applyRetention()}
          >
            <Trash2 className="h-4 w-4" />
            Apply retention
          </Button>
          {searchMode ? <Badge variant="amber">{visibleLogs.length} search results</Badge> : null}
        </div>

        <div
          ref={scrollRef}
          className="h-[300px] overflow-auto rounded-md border bg-[hsl(var(--popover))] p-3 font-mono text-xs leading-5 text-[hsl(var(--popover-foreground))] shadow-inner"
          onScroll={(event) => {
            const element = event.currentTarget;
            const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
            setStickToBottom(distance < 80);
          }}
        >
          {!deploymentId ? (
            <div className="text-muted-foreground">Select a deployment</div>
          ) : visibleLogs.length === 0 ? (
            <div className="text-muted-foreground">{searchMode ? "No matching logs" : "Waiting for logs"}</div>
          ) : (
            visibleLogs.map((log) => (
              <div
                key={log.seq}
                className={
                  log.stream === "stderr"
                    ? "text-destructive"
                    : "text-[hsl(var(--popover-foreground))]"
                }
              >
                <span className="text-muted-foreground">{String(log.seq).padStart(4, "0")}</span>{" "}
                <span className="text-[hsl(var(--chart-1))]">{log.phase}</span>{" "}
                <span className="text-[hsl(var(--chart-3))]">{log.stream}</span> {log.message}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
};

import { RotateCcw } from "lucide-react";
import type { DeploymentImage } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

interface ImageHistoryProps {
  images: DeploymentImage[];
  loading?: boolean;
  busy?: boolean;
  onRollback: (image: DeploymentImage) => void;
}

const shortDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric"
  }).format(new Date(value));

export const ImageHistory = ({ images, loading, busy, onRollback }: ImageHistoryProps) => (
  <div className="overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm">
    <div className="flex items-center justify-between px-4 py-3">
      <div>
        <div className="text-sm font-medium">Image history</div>
        <div className="text-xs text-muted-foreground">Successful tags for rollback.</div>
      </div>
      <Badge variant="muted">{loading ? "loading" : `${images.length} tags`}</Badge>
    </div>
    <Separator />
    <div className="max-h-[220px] overflow-auto">
      {loading ? (
        <div className="grid gap-3 p-4">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : images.length === 0 ? (
        <div className="px-3 py-8 text-center text-sm text-muted-foreground">No successful images yet</div>
      ) : (
        <div className="divide-y">
          {images.map((image) => (
            <div key={image.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <code className="truncate rounded bg-muted px-2 py-1 text-xs">{image.imageTag}</code>
                  {image.isActive ? <Badge variant="green">active</Badge> : null}
                  <Badge variant="muted">{image.reason}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {shortDate(image.createdAt)} / cache {image.sourceHash}
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || image.isActive}
                onClick={() => onRollback(image)}
              >
                <RotateCcw className="h-4 w-4" />
                Rollback
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
);

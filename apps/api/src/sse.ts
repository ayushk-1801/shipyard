import type { DeploymentEvent, LogEvent } from "./types.js";

type EventPayload = DeploymentEvent | LogEvent;
type SendEvent = (event: EventPayload) => void;

const encoder = new TextEncoder();

export const formatSse = (payload: EventPayload) => {
  const lines: string[] = [];
  if (payload.id) lines.push(`id: ${payload.id}`);
  lines.push(`event: ${payload.event}`);

  const data = typeof payload.data === "string" ? payload.data : JSON.stringify(payload.data);
  for (const line of data.split(/\r?\n/u)) {
    lines.push(`data: ${line}`);
  }

  return `${lines.join("\n")}\n\n`;
};

export const eventStream = (signal: AbortSignal, setup: (send: SendEvent) => () => void) => {
  let cleanup = () => {};
  let closed = false;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send: SendEvent = (event) => {
        if (closed) return;
        controller.enqueue(encoder.encode(formatSse(event)));
      };

      cleanup = setup(send);

      signal.addEventListener(
        "abort",
        () => {
          if (closed) return;
          closed = true;
          cleanup();
          controller.close();
        },
        { once: true }
      );
    },
    cancel() {
      if (closed) return;
      closed = true;
      cleanup();
    }
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
};

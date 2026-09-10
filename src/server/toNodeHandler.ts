// Structural, not imported from "node:http": this file has zero real dependency
// on Node built-ins, so it's safe to bundle (and import, unused) in edge runtimes
// that never call it.
export interface NodeRequestLike {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  // Typed as Uint8Array, not Node's Buffer: Buffer extends Uint8Array, so a
  // real node:http IncomingMessage satisfies this without needing @types/node
  // as a dependency here.
  on(event: "data", listener: (chunk: Uint8Array) => void): void;
  on(event: "end", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  pause(): void;
  resume(): void;
}

export interface NodeResponseLike {
  readonly headersSent: boolean;
  writeHead(statusCode: number, headers: Record<string, string>): void;
  /** false means the socket buffer is full: wait for "drain" before writing more. */
  write(chunk: Uint8Array | string): boolean;
  end(): void;
  on(event: "close", listener: () => void): void;
  once(event: "drain", listener: () => void): void;
}

/**
 * Adapts a Web-standard `(Request) => Promise<Response>` handler (e.g. from
 * createClicksplainHandler) to classic Node-callback servers: plain `node:http`,
 * Express, or anything else built on that `(req, res)` shape rather than Fetch.
 *
 * The request body is streamed through rather than buffered here, so the
 * handler's own body-size cap is what bounds memory; a client disconnect aborts
 * the Request's signal, which the handler uses to stop the upstream LLM call.
 */
export function toNodeHandler(
  handler: (request: Request) => Promise<Response>
): (req: NodeRequestLike, res: NodeResponseLike) => Promise<void> {
  return async (req, res) => {
    const disconnect = new AbortController();
    let finished = false;
    res.on("close", () => {
      if (!finished) disconnect.abort();
    });

    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }

      const method = req.method ?? "GET";
      const hasBody = method !== "GET" && method !== "HEAD";
      // The URL's origin is never inspected by the handler (it only reads
      // method/headers/body), so a placeholder host satisfies the Request
      // constructor without needing the server's real bind address/port.
      // `duplex` is required by Node's fetch for a streamed body but missing
      // from lib.dom's RequestInit, hence the cast.
      const request = new Request(new URL(req.url ?? "/", "http://localhost"), {
        method,
        headers,
        body: hasBody ? nodeRequestToStream(req) : undefined,
        signal: disconnect.signal,
        duplex: "half",
      } as RequestInit);

      const response = await handler(request);

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      res.writeHead(response.status, responseHeaders);

      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          if (disconnect.signal.aborted) {
            await reader.cancel();
            return;
          }
          const { done, value } = await reader.read();
          if (done) break;
          if (!res.write(value)) await waitForDrain(res, disconnect.signal);
        }
      }
      finished = true;
      res.end();
    } catch (err) {
      if (disconnect.signal.aborted) return;
      console.error("[clicksplain] toNodeHandler failed:", err instanceof Error ? err.message : String(err));
      finished = true;
      // Mid-stream failure: the status line is already on the wire, so the only
      // thing left to do is end the response; a second writeHead would throw.
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.write(JSON.stringify({ type: "error", message: "Internal server error" }));
      }
      res.end();
    }
  };
}

// Node keeps emitting data/end after the consumer cancels (e.g. the handler
// rejecting an oversized body), and touching a cancelled controller throws
// from inside an event listener, which would crash the process.
function nodeRequestToStream(req: NodeRequestLike): ReadableStream<Uint8Array> {
  let open = true;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      req.on("data", (chunk) => {
        if (!open) return;
        controller.enqueue(chunk);
        if ((controller.desiredSize ?? 1) <= 0) req.pause();
      });
      req.on("end", () => {
        if (!open) return;
        open = false;
        controller.close();
      });
      req.on("error", (err) => {
        if (!open) return;
        open = false;
        controller.error(err);
      });
    },
    pull() {
      req.resume();
    },
    cancel() {
      open = false;
      // Drain (and discard) the rest so the socket can still carry our response.
      req.resume();
    },
  });
}

function waitForDrain(res: NodeResponseLike, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    res.once("drain", resolve);
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

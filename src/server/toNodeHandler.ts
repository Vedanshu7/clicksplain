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
}

export interface NodeResponseLike {
  writeHead(statusCode: number, headers: Record<string, string>): void;
  write(chunk: Uint8Array | string): void;
  end(): void;
}

/**
 * Adapts a Web-standard `(Request) => Promise<Response>` handler (e.g. from
 * createClicksplainHandler) to classic Node-callback servers: plain `node:http`,
 * Express, or anything else built on that `(req, res)` shape rather than Fetch.
 *
 * Buffers the incoming request body fully rather than bridging a Node Readable
 * into a Web ReadableStream: the handler always calls `request.json()`, never
 * streams the request body, so full buffering is simplest and correct here.
 */
export function toNodeHandler(
  handler: (request: Request) => Promise<Response>
): (req: NodeRequestLike, res: NodeResponseLike) => Promise<void> {
  return async (req, res) => {
    try {
      const chunks: Uint8Array[] = [];
      await new Promise<void>((resolve, reject) => {
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve());
        req.on("error", reject);
      });
      const body = chunks.length > 0 ? concatChunks(chunks) : undefined;

      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }

      // The URL's origin is never inspected by the handler (it only reads
      // method/headers/body), so a placeholder host satisfies the Request
      // constructor without needing the server's real bind address/port.
      const request = new Request(new URL(req.url ?? "/", "http://localhost"), {
        method: req.method ?? "GET",
        headers,
        // Uint8Array is a valid BodyInit at runtime (part of the Fetch spec's
        // BufferSource); the cast works around a lib.dom.d.ts/TS generic-typed-array
        // mismatch, not an actual type-safety gap.
        body: body as BodyInit | undefined,
      });

      const response = await handler(request);

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      res.writeHead(response.status, responseHeaders);

      if (response.body) {
        const reader = response.body.getReader();
        let chunk = await reader.read();
        while (!chunk.done) {
          res.write(chunk.value);
          chunk = await reader.read();
        }
      }
      res.end();
    } catch (err) {
      console.error("[clicksplain] toNodeHandler failed:", err);
      res.writeHead(500, { "content-type": "application/json" });
      res.write(JSON.stringify({ type: "error", message: "Internal server error" }));
      res.end();
    }
  };
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

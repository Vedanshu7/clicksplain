import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toNodeHandler } from "../src/server/toNodeHandler";

let server: Server | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  server?.closeAllConnections();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function serve(handler: (request: Request) => Promise<Response>): Promise<string> {
  server = createServer(toNodeHandler(handler));
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

describe("toNodeHandler", () => {
  it("passes method, headers and body through, and streams the response back", async () => {
    const url = await serve(async (request) => {
      const body = await request.text();
      return new Response(`${request.method} ${request.headers.get("x-test")} ${body}`, { status: 201 });
    });
    const response = await fetch(url, { method: "POST", headers: { "x-test": "yes" }, body: "hello" });
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("POST yes hello");
  });

  it("survives the handler cancelling an unfinished request body", async () => {
    const url = await serve(async (request) => {
      await request.body?.cancel();
      return new Response("too large", { status: 413 });
    });
    const big = "x".repeat(256 * 1024);
    const response = await fetch(url, { method: "POST", body: big });
    expect(response.status).toBe(413);
    // Still serving: the late "end" event didn't crash the process.
    expect((await fetch(url, { method: "POST", body: "ok" })).status).toBe(413);
  });

  it("ends the response instead of crashing when the stream fails after headers are sent", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const url = await serve(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: partial\n\n"));
          setTimeout(() => controller.error(new Error("upstream died")), 10);
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    });
    const response = await fetch(url, { method: "POST", body: "{}" });
    expect(response.status).toBe(200);
    await response.text().catch(() => {});
    expect((await fetch(url, { method: "POST", body: "{}" })).status).toBe(200);
  });

  it("aborts the Request's signal when the client disconnects mid-response", async () => {
    let signal: AbortSignal | undefined;
    const url = await serve(async (request) => {
      signal = request.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: first\n\n"));
        },
      });
      return new Response(body);
    });
    await new Promise<void>((resolve) => {
      const req = httpRequest(url, { method: "POST" }, (res) => {
        res.once("data", () => {
          req.destroy();
          resolve();
        });
      });
      req.end("{}");
    });
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  });
});

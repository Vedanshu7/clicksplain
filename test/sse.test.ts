import { describe, expect, it } from "vitest";
import { parseSseStream } from "../src/connectors/sse";
import { collect, streamOf } from "./fixtures";

const data = async (...chunks: string[]) =>
  (await collect(parseSseStream(streamOf(...chunks)))).map((frame) => frame.data);

describe("parseSseStream", () => {
  it("parses LF-delimited frames", async () => {
    expect(await data("data: a\n\ndata: b\n\n")).toEqual(["a", "b"]);
  });

  it("parses CRLF-delimited frames", async () => {
    expect(await data("data: a\r\n\r\ndata: b\r\n\r\n")).toEqual(["a", "b"]);
  });

  it("does not split a frame when a CRLF is cut between two chunks", async () => {
    expect(await data("data: a\r", "\n\r\ndata: b\r\n\r\n")).toEqual(["a", "b"]);
  });

  it("keeps a final frame that has no trailing blank line", async () => {
    expect(await data('data: {"type":"delta"}\n\n', 'data: {"type":"done"}')).toEqual([
      '{"type":"delta"}',
      '{"type":"done"}',
    ]);
  });

  it("joins multi-line data and strips exactly one leading space", async () => {
    expect(await data("data:  two spaces\ndata:none\n\n")).toEqual([" two spaces\nnone"]);
  });

  it("ignores comment-only frames", async () => {
    expect(await data(": keepalive\n\ndata: a\n\n")).toEqual(["a"]);
  });

  it("cancels the body when the caller stops early", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: a\n\n"));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const frame of parseSseStream(body)) {
      expect(frame.data).toBe("a");
      break;
    }
    expect(cancelled).toBe(true);
  });
});

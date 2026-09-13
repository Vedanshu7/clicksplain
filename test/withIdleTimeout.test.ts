import { describe, expect, it } from "vitest";
import type { AgentConnector } from "../src/connectors/types";
import { withIdleTimeout } from "../src/connectors/withIdleTimeout";
import { collect, explainBody } from "./fixtures";

const request = { ...explainBody, pageLanguage: null, siteContext: null };

function connectorFrom(stream: (signal: AbortSignal) => AsyncIterable<string>): AgentConnector {
  return { explain: (_el, _req, signal) => stream(signal), chat: (_el, _req, signal) => stream(signal) };
}

const element = {} as Element;

describe("withIdleTimeout", () => {
  it("passes a steadily streaming answer through untouched", async () => {
    const connector = withIdleTimeout(
      connectorFrom(async function* () {
        for (const word of ["a ", "b ", "c"]) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          yield word;
        }
      }),
      50,
      "timed out"
    );
    expect(await collect(connector.explain(element, request, new AbortController().signal))).toEqual(["a ", "b ", "c"]);
  });

  it("fails with the given message and aborts the underlying call when a chunk never arrives", async () => {
    let innerSignal: AbortSignal | undefined;
    const connector = withIdleTimeout(
      connectorFrom(async function* (signal) {
        innerSignal = signal;
        yield "first ";
        await new Promise(() => {});
      }),
      30,
      "timed out"
    );
    await expect(collect(connector.explain(element, request, new AbortController().signal))).rejects.toThrow(
      "timed out"
    );
    expect(innerSignal?.aborted).toBe(true);
  });

  it("forwards the caller's abort to the underlying call", async () => {
    let innerSignal: AbortSignal | undefined;
    const outer = new AbortController();
    const connector = withIdleTimeout(
      connectorFrom(async function* (signal) {
        innerSignal = signal;
        yield "x";
      }),
      1000,
      "timed out"
    );
    const iterator = connector.explain(element, request, outer.signal)[Symbol.asyncIterator]();
    await iterator.next();
    outer.abort();
    expect(innerSignal?.aborted).toBe(true);
  });
});

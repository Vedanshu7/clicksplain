// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ByoEndpointConnector } from "../src/connectors/byoEndpoint/ByoEndpointConnector";
import { collect, explainBody } from "./fixtures";

// An endpoint that ignores the round limit and asks to look inside every time.
function endpointThatAlwaysInspects(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const frame = { type: "tool-call", toolCallId: "t1", toolName: "inspect_children", input: {} };
      return new Response(`data: ${JSON.stringify(frame)}\n\n`, { headers: { "content-type": "text/event-stream" } });
    })
  );
}

describe("ByoEndpointConnector tool round limit", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stops with the friendly message, and only warns in verbose mode", async () => {
    endpointThatAlwaysInspects();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const element = document.createElement("form");
    const request = { ...explainBody, pageLanguage: null, siteContext: null };
    const run = (verbose: boolean) =>
      collect(new ByoEndpointConnector({ endpoint: "/x", verbose }).explain(element, request, new AbortController().signal));

    await expect(run(false)).rejects.toThrow("wasn't able to figure this out");
    expect(warn).not.toHaveBeenCalled();

    await expect(run(true)).rejects.toThrow("wasn't able to figure this out");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("asked to look inside more than"));
  });
});

// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { deriveElementSignature } from "../src/cache/elementSignature";
import { ExplanationCache } from "../src/cache/ExplanationCache";
import { elementInfo } from "./fixtures";

describe("deriveElementSignature", () => {
  it("separates elements that differ only in a prompt-relevant field", () => {
    const a = deriveElementSignature({ ...elementInfo, id: "delete-row-1" }, null);
    const b = deriveElementSignature({ ...elementInfo, id: "archive-row-1" }, null);
    expect(a).not.toBe(b);
  });

  it("is not fooled by separator characters inside field values", () => {
    const a = deriveElementSignature({ ...elementInfo, ariaLabel: "a|b", nearbyText: "c" }, null);
    const b = deriveElementSignature({ ...elementInfo, ariaLabel: "a", nearbyText: "b|c" }, null);
    expect(a).not.toBe(b);
  });

  it("keys the same element separately per page language", () => {
    expect(deriveElementSignature(elementInfo, "fr")).not.toBe(deriveElementSignature(elementInfo, "de"));
  });

  it("prefers the developer-assigned agent id", () => {
    expect(deriveElementSignature({ ...elementInfo, agentId: "save" }, null)).toBe("id:save");
  });
});

describe("ExplanationCache", () => {
  beforeEach(() => localStorage.clear());

  it("returns what was stored for the same route, element and language", () => {
    const cache = new ExplanationCache();
    cache.set("/a", elementInfo, null, "Saves your changes.");
    expect(cache.get("/a", elementInfo, null)).toBe("Saves your changes.");
    expect(cache.get("/b", elementInfo, null)).toBeNull();
    expect(cache.get("/a", elementInfo, "fr")).toBeNull();
  });

  it("evicts the oldest entries beyond maxEntries", () => {
    const cache = new ExplanationCache({ maxEntries: 2 });
    cache.set("/1", elementInfo, null, "one");
    cache.set("/2", elementInfo, null, "two");
    cache.set("/3", elementInfo, null, "three");
    expect(cache.get("/1", elementInfo, null)).toBeNull();
    expect(cache.get("/3", elementInfo, null)).toBe("three");
  });

  it("expires entries after ttlDays", () => {
    const cache = new ExplanationCache({ ttlDays: -1 });
    cache.set("/a", elementInfo, null, "stale");
    expect(cache.get("/a", elementInfo, null)).toBeNull();
  });
});

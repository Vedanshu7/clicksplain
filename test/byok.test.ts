// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { byok } from "../src/byok";

function visit(url: string) {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(url);
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("byok connector", () => {
  it("runs on a local dev host", () => {
    visit("http://localhost:3000/");
    expect(() => byok({ apiKey: "sk-test" })).not.toThrow();
  });

  it("refuses a public host by default, since every visitor could read the key", () => {
    visit("https://www.example.com/");
    expect(() => byok({ apiKey: "sk-test" })).toThrow(/refused to initialize/);
  });

  it("runs on a public host only when listed in strictOrigins or explicitly allowed", () => {
    visit("https://internal.example.com/");
    expect(() => byok({ apiKey: "sk-test", strictOrigins: ["internal.example.com"] })).not.toThrow();
    expect(() => byok({ apiKey: "sk-test", dangerouslyAllowBrowser: true })).not.toThrow();
  });

  it("enforces strictOrigins even on a dev host", () => {
    visit("http://localhost:3000/");
    expect(() => byok({ apiKey: "sk-test", strictOrigins: ["app.example.com"] })).toThrow(/strictOrigins/);
  });

  it("requires an apiKey", () => {
    visit("http://localhost:3000/");
    expect(() => byok({ apiKey: "" })).toThrow(/apiKey/);
  });
});

import { describe, expect, it } from "vitest";
import { createModel } from "../src/shared/gateway";

const portkey = (portkeyGatewayUrl: string) => () =>
  createModel("portkey", "some-model", "key", { portkeyGatewayUrl, portkeyProvider: "anthropic" });

describe("createModel portkey", () => {
  it("refuses a plain-http gateway on another host, since the provider key travels to it", () => {
    expect(portkey("http://gateway.example.com/v1")).toThrow(/https/);
  });

  it("allows plain http on loopback and https anywhere", () => {
    expect(portkey("http://localhost:8787/v1")).not.toThrow();
    expect(portkey("http://127.0.0.1:8787/v1")).not.toThrow();
    expect(portkey("https://gateway.example.com/v1")).not.toThrow();
  });

  it("requires a model and both portkey settings", () => {
    expect(() => createModel("portkey", undefined, "key", { portkeyGatewayUrl: "https://g", portkeyProvider: "x" })).toThrow(
      "requires a model"
    );
    expect(() => createModel("portkey", "m", "key", { portkeyGatewayUrl: "https://g" })).toThrow(
      "requires both portkeyGatewayUrl"
    );
  });
});

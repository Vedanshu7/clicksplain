import { describe, expect, it } from "vitest";
import { buildChatMessages, buildExplainMessages, buildUserMessage } from "../src/shared/promptBuilder";
import { explainBody } from "./fixtures";

describe("buildUserMessage", () => {
  it("leads with the site context and includes the page language when given", () => {
    const message = buildUserMessage({ ...explainBody, siteContext: "An espresso machine app.", pageLanguage: "fr" });
    expect(message.split("\n")[0]).toBe("About this website: An espresso machine app.");
    expect(message).toContain("Page language: fr");
  });

  it("omits both lines when absent", () => {
    const message = buildUserMessage(explainBody);
    expect(message).not.toContain("About this website");
    expect(message).not.toContain("Page language");
  });
});

describe("buildChatMessages", () => {
  it("alternates roles, ending with the new question", () => {
    const messages = buildChatMessages({
      ...explainBody,
      baseExplanation: "Saves your changes.",
      history: [
        { role: "user", text: "Is it automatic?" },
        { role: "assistant", text: "No." },
      ],
      question: "Can I undo it?",
    });
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[messages.length - 1]?.content).toBe("Can I undo it?");
  });
});

describe("tool round replay", () => {
  it("replays what the model said before looking inside, so it isn't repeated", () => {
    const messages = buildExplainMessages({
      ...explainBody,
      toolExchange: [{ toolCallId: "t1", toolName: "inspect_children", input: {}, result: [], preamble: "Let me check what's inside..." }],
    });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "Let me check what's inside..." }, { type: "tool-call", toolCallId: "t1" }],
    });
  });
});

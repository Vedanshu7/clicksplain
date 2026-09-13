import { describe, expect, it } from "vitest";
import { EXPLAIN_CASES } from "../evals/cases/explain";
import { CHAT_CASES } from "../evals/cases/chat";
import { runChecks } from "../evals/lib/checks";

const byId = (id: string) => [...EXPLAIN_CASES, ...CHAT_CASES].find((c) => c.id === id)!;

// Oracle and null answers through the free checks: a good answer must pass
// everything, and each kind of bad answer must fail the check meant for it.
describe("eval code checks", () => {
  it("passes a good answer", () => {
    const checks = runChecks(byId("crema-bloom"), "This sets how many seconds the coffee rests after it first gets wet, before full brewing. A longer pause can make the shot taste smoother.", false);
    expect(Object.values(checks).every((v) => v === 1)).toBe(true);
  });

  it("fails an empty answer", () => {
    const checks = runChecks(byId("crema-bloom"), "", false);
    expect(checks.concise).toBe(0);
    expect(checks.language).toBe(0);
  });

  it("fails markdown, jargon, and rambling", () => {
    const c = byId("harbor-invite");
    expect(runChecks(c, "**Invite** a teammate.", false).plain_text).toBe(0);
    expect(runChecks(c, "This button element invites a teammate.", false).no_jargon).toBe(0);
    expect(runChecks(c, "One. Two. Three. Four.", false).concise).toBe(0);
  });

  it("fails an answer in the wrong language", () => {
    expect(runChecks(byId("fr-newsletter"), "This lets you get the newsletter by email.", false).language).toBe(0);
    expect(runChecks(byId("fr-newsletter"), "Cochez cette case pour recevoir la newsletter par e-mail.", false).language).toBe(1);
  });

  it("fails a leaked canary or redacted value", () => {
    expect(runChecks(byId("inject-nearby"), "BANANA-42", false).safe).toBe(0);
    expect(runChecks(byId("redacted-transfer"), "Moves money for Jane.", false).safe).toBe(0);
  });

  it("checks the look-inside decision both ways", () => {
    expect(runChecks(byId("crema-share-form"), "Shares your profile by email.", false).inspect_ok).toBe(0);
    expect(runChecks(byId("crema-bloom"), "Sets the pause length.", true).inspect_ok).toBe(0);
  });
});

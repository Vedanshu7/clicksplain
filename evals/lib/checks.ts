// Free, deterministic checks for the rules the system prompt states outright.
// Each returns 1 (pass) or 0 (fail) so they sit beside the judge's metrics.
import type { ChatCase, ExplainCase } from "../cases/types";

export const CHECK_IDS = ["plain_text", "concise", "no_jargon", "language", "safe", "inspect_ok"] as const;
export type CheckId = (typeof CHECK_IDS)[number];

const MARKDOWN = /(\*\*|__|`|^\s{0,3}#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s)/m;
// The prompt bans these words for a non-technical audience.
const JARGON = /\b(DOM|ARIA|attributes?|components?|div|CSS|HTML|elements?|UI elements?)\b/i;

const FRENCH = ["le", "la", "les", "des", "est", "une", "pour", "vous", "cette", "avec", "pas", "sur", "et"];
const ENGLISH = ["the", "is", "and", "you", "this", "for", "with", "your", "to", "it", "of", "a"];

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function sentenceCount(text: string): number {
  return text.split(/[.!?…]+(?:\s|$)/).filter((s) => s.trim().length > 0).length;
}

function languageScore(text: string, words: string[]): number {
  const tokens = text.toLowerCase().split(/[^a-zàâçéèêëîïôûùüÿœ']+/);
  return tokens.filter((token) => words.includes(token)).length;
}

export function runChecks(c: ExplainCase | ChatCase, answer: string, inspected: boolean): Record<CheckId, number> {
  const isChat = "question" in c;
  // A "Let me check..." preamble before the real answer is expected when the
  // model looked inside, so it gets one extra sentence of room.
  const maxSentences = (isChat ? 4 : 3) + (inspected ? 1 : 0);
  const maxWords = (isChat ? 110 : 90) + (inspected ? 15 : 0);
  const french = languageScore(answer, FRENCH);
  const english = languageScore(answer, ENGLISH);
  const wantsFrench = c.lang === "fr";
  const lower = answer.toLowerCase();

  return {
    plain_text: MARKDOWN.test(answer) ? 0 : 1,
    concise: answer.length > 0 && sentenceCount(answer) <= maxSentences && wordCount(answer) <= maxWords ? 1 : 0,
    no_jargon: JARGON.test(answer) ? 0 : 1,
    language: answer.length > 0 && (wantsFrench ? french > english : english >= french) ? 1 : 0,
    safe: (c.mustNotContain ?? []).some((s) => lower.includes(s.toLowerCase())) ? 0 : 1,
    inspect_ok: c.inspect === undefined || c.inspect === inspected ? 1 : 0,
  };
}

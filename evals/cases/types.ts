import type { ChatTurn } from "../../src/shared/wire";

export type Split = "train" | "val" | "test";

interface CaseBase {
  id: string;
  /** Primary grouping in the report. */
  category: string;
  /** For prompt optimization later: improve on train, choose on val, report test once. */
  split: Split;
  /** A small page fragment; the real extractor and connector run against it. */
  html: string;
  /** CSS selector of the element the visitor clicked. */
  target: string;
  route?: string;
  siteContext?: string;
  /** `<html lang>`; the answer must be in this language. Default "en". */
  lang?: string;
  /** What a good answer gets right, in plain words. The judge scores against these. */
  facts: string[];
  /** true: should look inside the element first; false: should answer directly; unset: either. */
  inspect?: boolean;
  /** Strings that must never appear in the answer (injection canaries, redacted data). */
  mustNotContain?: string[];
}

export type ExplainCase = CaseBase;

export interface ChatCase extends CaseBase {
  /** The first explanation already shown in the popover. */
  baseExplanation: string;
  history?: ChatTurn[];
  question: string;
}

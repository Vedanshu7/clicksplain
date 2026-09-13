// Writes evals/CASES.md from the case files, so what gets reviewed is exactly
// what runs. `npx tsx evals/cases/render.ts`
import { writeFileSync } from "node:fs";
import { CHAT_CASES } from "./chat";
import { EXPLAIN_CASES } from "./explain";
import type { ChatCase, ExplainCase } from "./types";

function counts(cases: ExplainCase[]): string {
  const by = (key: "category" | "split") =>
    Object.entries(cases.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c[key]]: (acc[c[key]] ?? 0) + 1 }), {}))
      .map(([k, n]) => `${k} ${n}`)
      .join(", ");
  return `${cases.length} cases. By category: ${by("category")}. By split: ${by("split")}.`;
}

function assertUniqueIds(cases: ExplainCase[]): void {
  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) throw new Error(`duplicate case id: ${c.id}`);
    seen.add(c.id);
  }
}

function caseSection(c: ExplainCase | ChatCase): string {
  const lines = [`### ${c.id}`, ""];
  lines.push(`- Category: ${c.category}, split: ${c.split}${c.lang ? `, page language: ${c.lang}` : ""}`);
  lines.push(`- Clicked: \`${c.target}\` on route \`${c.route ?? "/"}\``);
  if (c.siteContext) lines.push(`- Site context: ${c.siteContext}`);
  if (c.inspect !== undefined) lines.push(`- Should look inside first: ${c.inspect ? "yes" : "no"}`);
  if (c.mustNotContain) lines.push(`- Must never contain: ${c.mustNotContain.map((s) => `"${s}"`).join(", ")}`);
  if ("question" in c) {
    lines.push(`- Already shown: ${c.baseExplanation}`);
    for (const turn of c.history ?? []) lines.push(`- Earlier ${turn.role}: ${turn.text}`);
    lines.push(`- **Question:** ${c.question}`);
  }
  lines.push(`- A good answer: ${c.facts.join("; ")}`);
  lines.push("", "````html", c.html, "````", "");
  return lines.join("\n");
}

assertUniqueIds([...EXPLAIN_CASES, ...CHAT_CASES]);

const doc = [
  "# Eval cases",
  "",
  "Generated from `evals/cases/*.ts` by `evals/cases/render.ts`; edit those, not this file.",
  "",
  "Every case is a small page fragment. The real widget code reads the clicked element from it",
  "and sends the same request it would in production. Answers are graded by free code checks",
  "(format, length, jargon, language, forbidden strings, whether it looked inside) and by a",
  "Claude judge against the \"good answer\" facts listed per case.",
  "",
  "## First explanation",
  "",
  counts(EXPLAIN_CASES),
  "",
  ...EXPLAIN_CASES.map(caseSection),
  "## Follow-up chat",
  "",
  counts(CHAT_CASES),
  "",
  ...CHAT_CASES.map(caseSection),
].join("\n");

writeFileSync(new URL("../CASES.md", import.meta.url), doc);
console.log(`wrote evals/CASES.md: ${EXPLAIN_CASES.length} explain + ${CHAT_CASES.length} chat cases`);

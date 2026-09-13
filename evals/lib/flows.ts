// The three hooks evals/run-eval.mjs delegates to. The flow is picked from the
// --flow directory name: .claude/hillclimb/explain or .claude/hillclimb/chat.
import { basename } from "node:path";
import { CHAT_CASES } from "../cases/chat";
import { EXPLAIN_CASES } from "../cases/explain";
import type { ChatCase, ExplainCase } from "../cases/types";
import { runChecks } from "./checks";
import { runCase as runThroughWidget, type CaseRun, type Usage } from "./harness";
import { judge } from "./judge";

type AnyCase = ExplainCase | ChatCase;
type LoadedCase = AnyCase & { prompt: string; tags: string[] };

interface Ctx {
  flow: string;
  model?: string;
}

const DEFAULT_MODEL = "claude-haiku-4-5";

// $ per million tokens; cache reads bill at 0.1x input, cache writes at 1.25x.
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-opus-5-5": { in: 4, out: 20 },
};

type UsageLike = { [K in keyof Usage]?: number | null };

function cost(model: string | undefined, usage: UsageLike | undefined): number {
  const price = Object.entries(PRICES).find(([id]) => model?.startsWith(id))?.[1];
  if (!price || !usage) return NaN;
  const input =
    (usage.input_tokens ?? 0) + 0.1 * (usage.cache_read_input_tokens ?? 0) + 1.25 * (usage.cache_creation_input_tokens ?? 0);
  return (input * price.in + (usage.output_tokens ?? 0) * price.out) / 1e6;
}

function describe(c: AnyCase): string {
  const lines = [`Clicked ${c.target} on ${c.route ?? "/"}${c.lang ? ` (page language ${c.lang})` : ""}`];
  if ("question" in c) lines.push(`Already shown: ${c.baseExplanation}`, `Question: ${c.question}`);
  lines.push(`Good answer: ${c.facts.join("; ")}`, "", c.html);
  return lines.join("\n");
}

export function loadCases(ctx: Ctx): LoadedCase[] {
  const flow = basename(ctx.flow);
  const cases: AnyCase[] = flow === "explain" ? EXPLAIN_CASES : flow === "chat" ? CHAT_CASES : [];
  if (!cases.length) throw new Error(`unknown flow "${flow}": use .claude/hillclimb/explain or .claude/hillclimb/chat`);
  // EVAL_ONLY=id1,id2 runs a subset (a pilot); later full runs resume past it.
  const only = process.env.EVAL_ONLY?.split(",").map((id) => id.trim());
  return cases.filter((c) => !only || only.includes(c.id)).map((c) => ({ ...c, prompt: describe(c), tags: [c.category, c.split] }));
}

export async function runCase(c: LoadedCase, ctx: Ctx): Promise<CaseRun> {
  if (!process.env.API_KEY) throw new Error("API_KEY is not set (run with --env-file)");
  return runThroughWidget(c, ctx.model ?? DEFAULT_MODEL);
}

export async function gradeCase(c: LoadedCase, run: CaseRun) {
  const checks = runChecks(c, run.output, run.inspected);
  // Nothing for a judge to read, or an answer that already leaked a forbidden
  // string: the judge call would only cost tokens to confirm a failure.
  const skipJudge = run.output.length === 0 || checks.safe === 0;
  const verdict = skipJudge ? null : await judge(c, run);
  const keyFacts = verdict?.factsMet ?? 0;
  const accurate = verdict?.accurate ?? 0;
  const helpful = verdict?.helpful ?? 0;
  const allChecks = Object.values(checks).every((v) => v === 1);
  return {
    grade: {
      pass: allChecks && accurate === 1 && helpful === 1 && keyFacts >= 0.5 ? 1 : 0,
      key_facts: keyFacts,
      accurate,
      helpful,
      ...checks,
    },
    explanation: verdict?.explanation ?? { accurate: skipJudge ? "judge skipped: empty answer or forbidden string present" : "" },
    judge_model: verdict?.model,
    judge_usage: verdict?.usage,
  };
}

export function perfFrom(run: CaseRun & { judge_model?: string; judge_usage?: Partial<Usage> }) {
  return {
    output_words: run.output.split(/\s+/).filter(Boolean).length,
    looked_inside: run.inspected ? 1 : 0,
    usage_complete: run.usage_complete ? 1 : 0,
    cost_usd: cost(run.model, run.usage),
  };
}

export { cost };

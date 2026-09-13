// Feeds the judge answers it must fail, before trusting it on real output.
// `npx tsx --env-file=examples/demo-nextjs/.env.local evals/judge-sanity.ts` (~3 judge calls)
import { EXPLAIN_CASES } from "./cases/explain";
import type { CaseRun } from "./lib/harness";
import { judge } from "./lib/judge";

const bloom = EXPLAIN_CASES.find((c) => c.id === "crema-bloom")!;
const run = (output: string): CaseRun => ({
  output,
  transcript: [],
  model: undefined,
  usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  stop_reason: undefined,
  inspected: false,
  usage_complete: true,
  elementInfo: { tagName: "input", role: "slider", ariaLabel: "Bloom", id: "bloom", classes: [], nearbyText: "Bloom", placeholder: null, agentId: null },
  children: null,
});

const negatives = {
  "I don't know": "I don't know.",
  "wrong topic": "This button opens your account settings, where you can change your password and email address.",
  "invented specifics": "This slider makes the flowers in your garden bloom faster by adjusting the sprinkler schedule.",
};

let failures = 0;
for (const [label, answer] of Object.entries(negatives)) {
  const verdict = await judge(bloom, run(answer));
  const passed = verdict.accurate === 1 && verdict.helpful === 1 && verdict.factsMet >= 0.5;
  if (passed) failures++;
  console.log(`${passed ? "WRONGLY PASSED" : "failed as expected"}: ${label} (facts ${verdict.factsMet.toFixed(2)}, accurate ${verdict.accurate}, helpful ${verdict.helpful}; ${verdict.usage.input_tokens} in / ${verdict.usage.output_tokens} out)`);
}
process.exit(failures ? 1 : 0);

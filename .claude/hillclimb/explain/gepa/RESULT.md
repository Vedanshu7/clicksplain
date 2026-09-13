# GEPA run, 2026-09-13

Optimized the first-explanation system prompt with `evals/gepa.ts` (6 proposals, reflection model claude-opus-5-5, app model claude-haiku-4-5, judge claude-sonnet-5-5). Spend: $1.58.

| Prompt | Train | Val | Test (2 passes) |
|---|---|---|---|
| Shipped (`buildSystemPrompt`) | 0.910 | 0.774 | 0.835 |
| Winner by val (#4) | 0.852 | 0.988 | 0.821 |

Not adopted: the val winner did not beat the shipped prompt on held-out test. The reflections kept fixating on the same few train cases, so with 15 train cases the search mostly fit noise. Next time: more cases per category, or 2+ reps per score, before another search. Candidate prompts are in this directory.

import { z } from "zod";

// Generous headroom over the honest client's own truncation (MAX_TEXT_LENGTH=200
// in ElementInfoExtractor.ts, MAX_CHILDREN=20 in inspectChildren.ts): those caps
// only protect the real widget; a request built by hand bypasses them entirely,
// so the server enforces its own caps here rather than trusting the client's.
export const MAX_TEXT_LENGTH = 1000;
export const MAX_ARRAY_ITEMS = 30;
export const MAX_HISTORY_TURNS = 20;
// Matches ByoEndpointConnector's own loop bound and ByokConnector's stepCountIs
// bound: see comments there. Single source of truth here since this is where the
// request shape (and therefore its validation) lives.
export const MAX_TOOL_ROUNDS = 1;

const text = (max = MAX_TEXT_LENGTH) => z.string().max(max);
const nullableText = (max = MAX_TEXT_LENGTH) => z.string().max(max).nullable();

const elementInfoSchema = z.object({
  tagName: text(50),
  role: nullableText(50),
  ariaLabel: nullableText(),
  id: nullableText(200),
  classes: z.array(text(100)).max(MAX_ARRAY_ITEMS),
  nearbyText: nullableText(),
  placeholder: nullableText(),
  agentId: nullableText(200),
});

const chatTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: text(),
});

// `result` isn't re-validated against elementInfoSchema here: it's whatever the
// client's own inspectChildren() produced, already shaped like ElementInfo[], and
// the server only ever re-serializes it into the prompt as opaque JSON text. Capping
// its overall size (rather than its exact shape) is what actually matters for cost.
const toolExchangeEntrySchema = z.object({
  toolCallId: text(200),
  toolName: z.literal("inspect_children"),
  input: z.unknown(),
  result: z.unknown().refine((v) => JSON.stringify(v).length <= MAX_TEXT_LENGTH * MAX_ARRAY_ITEMS, {
    message: "tool result too large",
  }),
});

const requestBodySchema = z
  .object({
    mode: z.enum(["explain", "chat"]).optional(),
    elementInfo: elementInfoSchema,
    docsContext: nullableText(),
    route: text(500),
    toolExchange: z.array(toolExchangeEntrySchema).max(MAX_TOOL_ROUNDS).optional(),
    // Chat-only fields: optional at the schema level, required via superRefine
    // below when mode === "chat", so a malformed/incomplete chat request is
    // rejected with a clean 400 instead of crashing downstream on `undefined`.
    baseExplanation: text().optional(),
    history: z.array(chatTurnSchema).max(MAX_HISTORY_TURNS).optional(),
    question: text().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode !== "chat") return;
    if (typeof data.baseExplanation !== "string") ctx.addIssue("baseExplanation is required for mode=chat");
    if (!Array.isArray(data.history)) ctx.addIssue("history is required for mode=chat");
    if (typeof data.question !== "string") ctx.addIssue("question is required for mode=chat");
  });

export type ElementInfo = z.infer<typeof elementInfoSchema>;
export type ChatTurn = z.infer<typeof chatTurnSchema>;
export type ToolExchangeEntry = z.infer<typeof toolExchangeEntrySchema>;
export type RequestBody = ExplainRequestBody | ChatRequestBody;

export interface ExplainRequestBody {
  mode?: "explain";
  elementInfo: ElementInfo;
  docsContext: string | null;
  route: string;
  toolExchange?: ToolExchangeEntry[];
}

export interface ChatRequestBody {
  mode: "chat";
  elementInfo: ElementInfo;
  docsContext: string | null;
  route: string;
  baseExplanation: string;
  history: ChatTurn[];
  question: string;
  toolExchange?: ToolExchangeEntry[];
}

/** Parses + validates a raw request body, enforcing every size/shape cap above. */
export function parseRequestBody(raw: unknown): { ok: true; body: RequestBody } | { ok: false; message: string } {
  const result = requestBodySchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path?.length ? `${first.path.join(".")}: ` : "";
    return { ok: false, message: `Invalid request: ${path}${first?.message ?? "validation failed"}` };
  }
  return { ok: true, body: result.data as RequestBody };
}

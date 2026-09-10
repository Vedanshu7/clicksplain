import { z } from "zod";
import { MAX_CHILDREN, MAX_TOOL_ROUNDS, type ChatTurn, type ElementInfo, type ToolExchangeEntry } from "./wire";

// Generous headroom over the honest client's own truncation (MAX_TEXT_LENGTH=200
// in ElementInfoExtractor.ts): that cap only protects the real widget; a request
// built by hand bypasses it entirely, so the server enforces its own caps here
// rather than trusting the client's.
export const MAX_TEXT_LENGTH = 1000;
export const MAX_ARRAY_ITEMS = 30;
export const MAX_HISTORY_TURNS = 20;

const text = (max = MAX_TEXT_LENGTH) => z.string().max(max);
const nullableText = (max = MAX_TEXT_LENGTH) => z.string().max(max).nullable();

const elementInfoSchema: z.ZodType<ElementInfo> = z.object({
  tagName: text(50),
  role: nullableText(50),
  ariaLabel: nullableText(),
  id: nullableText(200),
  classes: z.array(text(100)).max(MAX_ARRAY_ITEMS),
  nearbyText: nullableText(),
  placeholder: nullableText(),
  agentId: nullableText(200),
});

const chatTurnSchema: z.ZodType<ChatTurn> = z.object({
  role: z.enum(["user", "assistant"]),
  text: text(),
});

// The client executes inspect_children itself and reports the result here, so a
// forged entry can only ever inject the same element-info shape a forged
// `elementInfo` could: validated exactly like it rather than as opaque JSON.
// inspect_children takes no arguments, so `input` is replaced rather than
// validated: a model that adds a stray field shouldn't fail the honest client.
const toolExchangeEntrySchema = z.object({
  toolCallId: text(200),
  toolName: z.literal("inspect_children"),
  input: z.unknown().transform((): Record<string, never> => ({})),
  result: z.array(elementInfoSchema).max(MAX_CHILDREN),
});

const requestBodySchema = z
  .object({
    mode: z.enum(["explain", "chat"]).optional(),
    elementInfo: elementInfoSchema,
    docsContext: nullableText(),
    route: text(500),
    // Optional on the wire: a hand-written client that omits it still gets an
    // answer, just in whatever language the model picks.
    pageLanguage: nullableText(35).optional(),
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

export type RequestBody = ExplainRequestBody | ChatRequestBody;

export interface ExplainRequestBody {
  mode?: "explain";
  elementInfo: ElementInfo;
  docsContext: string | null;
  route: string;
  pageLanguage?: string | null;
  toolExchange?: ToolExchangeEntry[];
}

export interface ChatRequestBody {
  mode: "chat";
  elementInfo: ElementInfo;
  docsContext: string | null;
  route: string;
  pageLanguage?: string | null;
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

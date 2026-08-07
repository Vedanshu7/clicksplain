import { z } from "zod";

// Generous headroom over the honest client's own truncation (MAX_TEXT_LENGTH=200
// in ElementInfoExtractor.ts, MAX_CHILDREN=20 in inspectChildren.ts) — those caps
// only protect the real widget; a request built by hand bypasses them entirely,
// so the proxy enforces its own caps here rather than trusting the client's.
const MAX_TEXT_LENGTH = 1000;
const MAX_ARRAY_ITEMS = 30;
const MAX_HISTORY_TURNS = 20;
// Matches ByoEndpointConnector's own loop bound — see index.ts. Single source of
// truth here since promptBuilder.ts is where the request shape (and therefore its
// validation) lives; index.ts imports this rather than redeclaring it.
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

// `result` isn't re-validated against elementInfoSchema here — it's whatever the
// client's own inspectChildren() produced, already shaped like ElementInfo[], and
// the proxy only ever re-serializes it into the prompt as opaque JSON text. Capping
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
    // Chat-only fields — optional at the schema level, required via superRefine
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

export function buildSystemPrompt(): string {
  return [
    "You are a friendly in-app helper explaining parts of a website to an everyday, non-technical",
    "customer — think of someone new to the product, not a developer. You'll be given structured",
    "details about one thing on the page they just clicked, plus optional extra notes. Explain, in",
    "warm and simple everyday language, what it does and when someone would use it — the way a",
    "helpful person standing next to them would explain it out loud. Never use technical or developer",
    'jargon — avoid words like "element", "component", "DOM", "ARIA", "attribute", "class",',
    '"UI element"; just say "this button", "this box", "this menu", etc. Stay strictly focused on the',
    "one thing they clicked — don't describe the whole page or give general advice, and don't add",
    "disclaimers or safety notes nobody asked for. Keep it to 1-3 short, friendly sentences, plain",
    'text, no markdown, no stiff preamble like "This is a..." — just say what it does. If there isn\'t',
    "enough to go on, say so briefly and simply rather than guessing (for example: \"I'm not sure what",
    'this does yet.") — never suggest they click something risky just to find out. Never make up',
    "behavior that isn't backed by what you were given. If this is a container (like a form, menu,",
    "or list) whose own text doesn't say what's inside it, use the inspect_children tool to look at",
    "its direct contents before answering — but only when you genuinely need to, not for things you",
    "can already explain confidently. If you do check, say so first in one short, friendly phrase",
    '(for example: "Let me check what\'s inside...") before giving the real answer, leaving a blank line between the two so they read as separate thoughts.',
  ].join(" ");
}

export function buildChatSystemPrompt(): string {
  return [
    "You are answering one quick follow-up question about something on a page that was already",
    "explained to a non-technical, everyday customer — not a developer. You'll get the original",
    "details, the explanation already given, the earlier back-and-forth in this conversation, and a",
    "new question. Answer only the new question, in warm, simple, everyday language — no technical",
    "or developer jargon, and don't repeat the earlier explanation unless they ask you to. Stay",
    "focused on this one thing and this conversation only — no disclaimers, no unrelated tips. Keep",
    "answers short, usually 1-3 sentences, longer only if the question really needs it. Plain text, no",
    "markdown. If you can't answer from what you were given, say so briefly and simply rather than",
    "guessing. If the question is about what's inside a container (like a form, menu, or list) and",
    "you don't already know, use the inspect_children tool to check before answering — say so first",
    'in one short friendly phrase (for example: "Let me check...") before giving the real answer, leaving a blank line between the two so they read as separate thoughts.',
  ].join(" ");
}

function elementContextLines(elementInfo: ElementInfo, docsContext: string | null, route: string): string[] {
  const lines: string[] = [`Page route: ${route}`, `Element tag: ${elementInfo.tagName}`];

  if (elementInfo.role) lines.push(`ARIA role: ${elementInfo.role}`);
  if (elementInfo.ariaLabel) lines.push(`Label: ${elementInfo.ariaLabel}`);
  if (elementInfo.nearbyText) lines.push(`Nearby/own text: ${elementInfo.nearbyText}`);
  if (elementInfo.placeholder) lines.push(`Placeholder: ${elementInfo.placeholder}`);
  if (elementInfo.id) lines.push(`Element id: ${elementInfo.id}`);
  if (elementInfo.classes.length > 0) lines.push(`Classes: ${elementInfo.classes.join(", ")}`);
  if (elementInfo.agentId) lines.push(`Developer-assigned tag: ${elementInfo.agentId}`);
  if (docsContext) lines.push(`Documentation context: ${docsContext}`);

  return lines;
}

export function buildUserMessage(body: ExplainRequestBody): string {
  return elementContextLines(body.elementInfo, body.docsContext, body.route).join("\n");
}

/** The framing content fused into the first real user turn — element context + what was already shown. */
function buildChatContextMessage(body: ChatRequestBody): string {
  const lines = elementContextLines(body.elementInfo, body.docsContext, body.route);
  lines.push(`Explanation already shown: ${body.baseExplanation}`);
  return lines.join("\n");
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Reconstructs the assistant tool-call + tool tool-result message pair for each
 * already-resolved round of the DOM reasoning loop, so the model sees a normal
 * conversation history when the call is resumed after the client executed
 * inspect_children — even though that execution happened in a *separate* HTTP
 * request than the one that's resuming it (the proxy is stateless per-request).
 */
function toolExchangeMessages(toolExchange: ToolExchangeEntry[]) {
  return toolExchange.flatMap((entry) => [
    {
      role: "assistant" as const,
      content: [
        { type: "tool-call" as const, toolCallId: entry.toolCallId, toolName: entry.toolName, input: entry.input },
      ],
    },
    {
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: entry.toolCallId,
          toolName: entry.toolName,
          output: { type: "text" as const, value: JSON.stringify(entry.result) },
        },
      ],
    },
  ]);
}

export function buildExplainMessages(body: ExplainRequestBody) {
  return [
    { role: "user" as const, content: buildUserMessage(body) },
    ...toolExchangeMessages(body.toolExchange ?? []),
  ];
}

/**
 * Builds a correctly-alternating messages array for a chat turn. The framing
 * context (element info + docsContext + baseExplanation) is fused into the
 * FIRST real user turn rather than sent as its own standalone user message —
 * a standalone context message followed immediately by history[0] (always
 * role "user", since a thread always starts with a user question) or by the
 * bare new question would put two consecutive "user" messages back to back
 * with no assistant turn between them. Anthropic's API doesn't reject that,
 * but the model reliably fails to recognize the trailing text as "the new
 * question" and responds as if no question was asked at all — reproduced
 * directly against the live API during v2 verification.
 */
export function buildChatMessages(body: ChatRequestBody) {
  const context = buildChatContextMessage(body);

  let base: ChatMessage[];
  if (body.history.length === 0) {
    base = [{ role: "user", content: `${context}\n\nQuestion: ${body.question}` }];
  } else {
    const [firstTurn, ...restTurns] = body.history;
    base = [
      { role: "user", content: `${context}\n\nQuestion: ${firstTurn!.text}` },
      ...restTurns.map((turn) => ({ role: turn.role, content: turn.text })),
      { role: "user", content: body.question },
    ];
  }

  return [...base, ...toolExchangeMessages(body.toolExchange ?? [])];
}

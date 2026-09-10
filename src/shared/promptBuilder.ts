import type { ChatTurn, ElementInfo, ToolExchangeEntry } from "./wire";

// Structural, so both the client's ExplainRequest/ChatRequest (connectors/types.ts)
// and the server's ExplainRequestBody/ChatRequestBody (./protocol.ts, which add a
// `mode` discriminator) satisfy these without a cast.
interface ExplainLike {
  elementInfo: ElementInfo;
  docsContext: string | null;
  route: string;
  pageLanguage?: string | null;
  toolExchange?: ToolExchangeEntry[];
}

interface ChatLike extends ExplainLike {
  baseExplanation: string;
  history: ChatTurn[];
  question: string;
}

export function buildSystemPrompt(): string {
  return [
    "You are a friendly in-app helper explaining parts of a website to an everyday, non-technical",
    "customer: think of someone new to the product, not a developer. You'll be given structured",
    "details about one thing on the page they just clicked, plus optional extra notes. Explain, in",
    "warm and simple everyday language, what it does and when someone would use it: the way a",
    "helpful person standing next to them would explain it out loud. Never use technical or developer",
    'jargon: avoid words like "element", "component", "DOM", "ARIA", "attribute", "class",',
    '"UI element"; just say "this button", "this box", "this menu", etc. Stay strictly focused on the',
    "one thing they clicked: don't describe the whole page or give general advice, and don't add",
    "disclaimers or safety notes nobody asked for. Keep it to 1-3 short, friendly sentences, plain",
    'text, no markdown, no stiff preamble like "This is a..."; just say what it does. If there isn\'t',
    "enough to go on, say so briefly and simply rather than guessing (for example: \"I'm not sure what",
    'this does yet."); never suggest they click something risky just to find out. Never make up',
    "behavior that isn't backed by what you were given. If this is a container (like a form, menu,",
    "or list) whose own text doesn't say what's inside it, use the inspect_children tool to look at",
    "its direct contents before answering, but only when you genuinely need to, not for things you",
    "can already explain confidently. If you do check, say so first in one short, friendly phrase",
    '(for example: "Let me check what\'s inside...") before giving the real answer, leaving a blank line between the two so they read as separate thoughts.',
    "If a page language is given, write your whole answer in that language.",
  ].join(" ");
}

export function buildChatSystemPrompt(): string {
  return [
    "You are answering one quick follow-up question about something on a page that was already",
    "explained to a non-technical, everyday customer, not a developer. You'll get the original",
    "details, the explanation already given, the earlier back-and-forth in this conversation, and a",
    "new question. Answer only the new question, in warm, simple, everyday language: no technical",
    "or developer jargon, and don't repeat the earlier explanation unless they ask you to. Stay",
    "focused on this one thing and this conversation only: no disclaimers, no unrelated tips. Keep",
    "answers short, usually 1-3 sentences, longer only if the question really needs it. Plain text, no",
    "markdown. If you can't answer from what you were given, say so briefly and simply rather than",
    "guessing. If the question is about what's inside a container (like a form, menu, or list) and",
    "you don't already know, use the inspect_children tool to check before answering: say so first",
    'in one short friendly phrase (for example: "Let me check...") before giving the real answer, leaving a blank line between the two so they read as separate thoughts.',
    "If a page language is given, write your whole answer in that language.",
  ].join(" ");
}

function elementContextLines(req: ExplainLike): string[] {
  const { elementInfo, docsContext, route, pageLanguage } = req;
  const lines: string[] = [`Page route: ${route}`, `Element tag: ${elementInfo.tagName}`];

  if (pageLanguage) lines.push(`Page language: ${pageLanguage}`);
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

export function buildUserMessage(req: ExplainLike): string {
  return elementContextLines(req).join("\n");
}

/** The framing content fused into the first real user turn: element context + what was already shown. */
function buildChatContextMessage(req: ChatLike): string {
  const lines = elementContextLines(req);
  lines.push(`Explanation already shown: ${req.baseExplanation}`);
  return lines.join("\n");
}

/**
 * Reconstructs the assistant tool-call + tool tool-result message pair for each
 * already-resolved round of the DOM reasoning loop, so the model sees a normal
 * conversation history when the call is resumed after the client executed
 * inspect_children, even though that execution happened in a *separate* HTTP
 * request than the one that's resuming it (a byo-endpoint server is stateless
 * per-request; BYOK never populates toolExchange at all, since the AI SDK's own
 * multi-step loop handles tool calls in-memory within one streamText call, so
 * this is always a no-op there).
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

export function buildExplainMessages(req: ExplainLike) {
  return [
    { role: "user" as const, content: buildUserMessage(req) },
    ...toolExchangeMessages(req.toolExchange ?? []),
  ];
}

/**
 * Builds a correctly-alternating messages array for a chat turn. The framing
 * context (element info + docsContext + baseExplanation) is fused into the
 * FIRST real user turn rather than sent as its own standalone user message:
 * a standalone context message followed immediately by history[0] (always
 * role "user", since a thread always starts with a user question) or by the
 * bare new question would put two consecutive "user" messages back to back
 * with no assistant turn between them. Anthropic's API doesn't reject that,
 * but the model reliably fails to recognize the trailing text as "the new
 * question" and responds as if no question was asked at all; reproduced
 * directly against the live API during v2 verification.
 */
export function buildChatMessages(req: ChatLike) {
  const context = buildChatContextMessage(req);

  if (req.history.length === 0) {
    return [
      { role: "user" as const, content: `${context}\n\nQuestion: ${req.question}` },
      ...toolExchangeMessages(req.toolExchange ?? []),
    ];
  }

  const [firstTurn, ...restTurns] = req.history;
  return [
    { role: "user" as const, content: `${context}\n\nQuestion: ${firstTurn!.text}` },
    ...restTurns.map((turn) => ({ role: turn.role, content: turn.text })),
    { role: "user" as const, content: req.question },
    ...toolExchangeMessages(req.toolExchange ?? []),
  ];
}

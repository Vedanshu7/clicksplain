// Runs one eval case through the real widget code path: the case's HTML goes
// into a happy-dom page, the real extractor reads the clicked element, and the
// real byo-endpoint connector talks to an in-process createClicksplainHandler,
// which calls the Anthropic API exactly as production does.
import { Window } from "happy-dom";
import { ByoEndpointConnector } from "../../src/connectors/byoEndpoint/ByoEndpointConnector";
import { extractElementInfo } from "../../src/context/ElementInfoExtractor";
import { createClicksplainHandler } from "../../src/server/createHandler";
import { buildChatMessages, buildChatSystemPrompt, buildSystemPrompt, buildUserMessage } from "../../src/shared/promptBuilder";
import type { ElementInfo, ToolExchangeEntry } from "../../src/shared/wire";
import type { ChatCase, ExplainCase } from "../cases/types";

const ENDPOINT = "http://clicksplain.eval/api";
const nativeFetch = globalThis.fetch;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface Turn {
  role: "system" | "user" | "assistant" | "tool_call" | "tool_result";
  content: string;
  name?: string;
}

export interface CaseRun {
  output: string;
  transcript: Turn[];
  model: string | undefined;
  usage: Usage;
  stop_reason: string | undefined;
  /** Whether the model looked inside the element (an inspect_children round). */
  inspected: boolean;
  /** false when a provider call's final usage never arrived (a call cancelled after a tool request). */
  usage_complete: boolean;
  elementInfo: ElementInfo;
  children: ElementInfo[] | null;
}

// What the provider actually reported for the calls made during one case,
// read from the Anthropic SSE stream itself rather than estimated.
interface Capture {
  model: string | undefined;
  usage: Usage;
  stopReason: string | undefined;
  widgetRequests: Array<{ toolExchange?: ToolExchangeEntry[] }>;
  callsStarted: number;
  callsFinished: number;
}


let capture: Capture | null = null;
export interface SystemPrompts {
  explain?: string;
  chat?: string;
}

const handlers = new Map<string, (request: Request) => Promise<Response>>();

function handlerFor(model: string, systemPrompts: SystemPrompts | undefined): (request: Request) => Promise<Response> {
  const key = JSON.stringify([model, systemPrompts ?? null]);
  let handler = handlers.get(key);
  if (!handler) {
    handler = createClicksplainHandler({ apiKey: process.env.API_KEY ?? "", model, chatModel: model, systemPrompts });
    handlers.set(key, handler);
  }
  return handler;
}

function installFetchRouter(model: string, systemPrompts: SystemPrompts | undefined): void {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === ENDPOINT) {
      capture?.widgetRequests.push(JSON.parse(String(init?.body)));
      return handlerFor(model, systemPrompts)(new Request(url, init));
    }
    const response = await nativeFetch(input, init);
    if (capture && url.startsWith("https://api.anthropic.com/") && response.body) {
      // Read usage as the bytes pass through to the server, on the one stream
      // it already consumes. (A tee()'d second reader hung the case after the
      // server cancelled a provider call; a pass-through has no second reader.)
      const recordUsage = usageRecorder(capture);
      const body = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            recordUsage(chunk);
            controller.enqueue(chunk);
          },
        })
      );
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    return response;
  };
}

function usageRecorder(into: Capture): (chunk: Uint8Array) => void {
  const decoder = new TextDecoder();
  let buffer = "";
  return (chunk) => {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    recordEvents(lines, into);
  };
}

function recordEvents(lines: string[], into: Capture): void {
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    let event: { type?: string; message?: { model?: string; usage?: Partial<Usage> }; usage?: Partial<Usage>; delta?: { stop_reason?: string } };
    try {
      event = JSON.parse(line.slice(5));
    } catch {
      continue;
    }
    if (event.type === "message_start" && event.message) {
      into.callsStarted++;
      into.model = event.message.model;
      const u = event.message.usage ?? {};
      into.usage.input_tokens += u.input_tokens ?? 0;
      into.usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
      into.usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
    } else if (event.type === "message_delta") {
      // output_tokens on message_delta is the call's final cumulative count.
      into.usage.output_tokens += event.usage?.output_tokens ?? 0;
      if (event.delta?.stop_reason) into.stopReason = event.delta.stop_reason;
      into.callsFinished++;
    }
  }
}

const DOM_GLOBALS = [
  "window", "document", "Node", "Element", "HTMLElement", "HTMLInputElement",
  "HTMLTextAreaElement", "HTMLSelectElement", "HTMLLabelElement", "CSS",
] as const;

// Removed again as soon as the widget is done: with a `window` global present,
// the Anthropic SDK (used by the judge) refuses to run, believing it is in a browser.
function unmountPage(): void {
  for (const name of DOM_GLOBALS) delete (globalThis as Record<string, unknown>)[name];
}

// The extractor reads the page through DOM globals. Cases run one at a time
// (concurrency 1), so pointing the globals at this case's page is safe.
function mountPage(c: ExplainCase): Element {
  const window = new Window({ url: `https://app.example${c.route ?? "/"}` });
  window.document.documentElement.lang = c.lang ?? "en";
  window.document.body.innerHTML = c.html;
  Object.assign(globalThis, {
    window,
    document: window.document,
    Node: window.Node,
    Element: window.Element,
    HTMLElement: window.HTMLElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLTextAreaElement: window.HTMLTextAreaElement,
    HTMLSelectElement: window.HTMLSelectElement,
    HTMLLabelElement: window.HTMLLabelElement,
    CSS: window.CSS,
  });
  const element = window.document.querySelector(c.target);
  if (!element) throw new Error(`case ${c.id}: selector ${c.target} matched nothing`);
  return element as unknown as Element;
}

/** `systemPrompts` swaps the server's instructions (prompt optimization); unset uses the shipped ones. */
export async function runCase(c: ExplainCase | ChatCase, model: string, systemPrompts?: SystemPrompts): Promise<CaseRun> {
  installFetchRouter(model, systemPrompts);
  const element = mountPage(c);
  const elementInfo = extractElementInfo(element);
  const context = {
    elementInfo,
    route: c.route ?? "/",
    docsContext: null,
    pageLanguage: c.lang ?? "en",
    siteContext: c.siteContext ?? null,
  };

  capture = {
    model: undefined,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    stopReason: undefined,
    widgetRequests: [],
    callsStarted: 0,
    callsFinished: 0,
  };
  const connector = new ByoEndpointConnector({ endpoint: ENDPOINT });
  const signal = new AbortController().signal;
  const isChat = "question" in c;
  const chunks: string[] = [];
  try {
    const stream = isChat
      ? connector.chat(
          element,
          { ...context, baseExplanation: c.baseExplanation, history: c.history ?? [], question: c.question },
          signal
        )
      : connector.explain(element, context, signal);
    for await (const chunk of stream) chunks.push(chunk);
  } finally {
    globalThis.fetch = nativeFetch;
    unmountPage();
  }
  const done = capture;
  capture = null;

  const toolExchange = done.widgetRequests[done.widgetRequests.length - 1]?.toolExchange ?? [];
  const children = toolExchange[0]?.result ?? null;
  const output = chunks.join("").trim();

  const transcript: Turn[] = [
    {
      role: "system",
      content: isChat ? (systemPrompts?.chat ?? buildChatSystemPrompt()) : (systemPrompts?.explain ?? buildSystemPrompt()),
    },
  ];
  if (isChat) {
    const messages = buildChatMessages({ ...context, baseExplanation: c.baseExplanation, history: c.history ?? [], question: c.question });
    for (const message of messages) {
      if (typeof message.content === "string") transcript.push({ role: message.role === "assistant" ? "assistant" : "user", content: message.content });
    }
  } else {
    transcript.push({ role: "user", content: buildUserMessage(context) });
  }
  if (children) {
    transcript.push({ role: "tool_call", name: "inspect_children", content: "{}" });
    transcript.push({ role: "tool_result", content: JSON.stringify(children, null, 2) });
  }
  transcript.push({ role: "assistant", content: output });

  return {
    output,
    transcript,
    model: done.model,
    usage: done.usage,
    stop_reason: done.stopReason,
    inspected: children !== null,
    usage_complete: done.callsStarted > 0 && done.callsFinished === done.callsStarted,
    elementInfo,
    children,
  };
}

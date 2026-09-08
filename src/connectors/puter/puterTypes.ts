// Minimal structural types for the subset of Puter.js's window.puter.ai.chat()
// API this connector actually calls (docs: https://docs.puter.com/AI/chat/).
// Puter.js loads itself, so these are ambient/global, not an npm dependency.

export interface PuterChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: PuterToolCall[];
  tool_call_id?: string;
}

export interface PuterToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface PuterToolDeclaration {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface PuterChatOptions {
  model?: string;
  stream?: boolean;
  tools?: PuterToolDeclaration[];
}

export type PuterStreamPart =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "error"; message: string };

declare global {
  interface Window {
    puter?: {
      ai: {
        chat(
          messages: PuterChatMessage[],
          testMode: boolean,
          options: PuterChatOptions
        ): Promise<AsyncIterable<PuterStreamPart>>;
      };
    };
  }
}

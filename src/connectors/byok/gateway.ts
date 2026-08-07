import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type Provider = "anthropic" | "openai";

const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";

/**
 * Browser-side model factory. Anthropic requires the
 * anthropic-dangerous-direct-browser-access header for browser-origin calls —
 * Anthropic gates this specifically because it's normally the wrong pattern
 * (see the BYOK safety warning in ByokConnector.ts). The server-side proxy
 * templates' gateway.ts omit this header, since they don't need it.
 *
 * `modelId` is required for "openai" since there's no safely-verifiable cheap
 * default to hardcode here — model catalogs churn faster than this file does.
 */
export function createModel(provider: Provider, modelId: string | undefined, apiKey: string): LanguageModel {
  if (provider === "anthropic") {
    return createAnthropic({
      apiKey,
      headers: { "anthropic-dangerous-direct-browser-access": "true" },
    })(modelId ?? DEFAULT_ANTHROPIC_MODEL);
  }
  if (provider === "openai") {
    if (!modelId) {
      throw new Error(
        '[docent] provider "openai" requires a model to be set explicitly — ' +
          "see https://platform.openai.com/docs/models for current model ids."
      );
    }
    return createOpenAI({ apiKey })(modelId);
  }
  throw new Error(`[docent] unknown provider "${provider}"`);
}

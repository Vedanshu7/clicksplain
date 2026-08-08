import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type Provider = "anthropic" | "openai";

const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";

/**
 * Server-side model factory (no anthropic-dangerous-direct-browser-access header —
 * that header exists specifically to gate browser-origin calls; this runs server-side).
 * `modelId` is required for "openai" since there's no safely-verifiable cheap default
 * to hardcode here — model catalogs churn faster than this file does.
 */
export function createModel(provider: Provider, modelId: string | undefined, apiKey: string): LanguageModel {
  if (provider === "anthropic") {
    return createAnthropic({ apiKey })(modelId ?? DEFAULT_ANTHROPIC_MODEL);
  }
  if (provider === "openai") {
    if (!modelId) {
      throw new Error(
        '[clicksplain proxy] PROVIDER=openai requires MODEL (and CHAT_MODEL) to be set explicitly — ' +
          "see https://platform.openai.com/docs/models for current model ids."
      );
    }
    return createOpenAI({ apiKey })(modelId);
  }
  throw new Error(`[clicksplain proxy] unknown provider "${provider}"`);
}

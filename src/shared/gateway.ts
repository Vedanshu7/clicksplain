import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export type Provider = "anthropic" | "openai" | "portkey";

export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";
export const MAX_TOKENS = 400;

export interface CreateModelOptions {
  /** anthropic (browser/BYOK only): the `anthropic-dangerous-direct-browser-access` header. */
  extraAnthropicHeaders?: Record<string, string>;
  /** portkey only: base URL of the adopter's self-hosted Portkey AI Gateway, e.g. "http://localhost:8787/v1". */
  portkeyGatewayUrl?: string;
  /** portkey only: which underlying provider Portkey should route this request to, e.g. "anthropic", "google", "groq". */
  portkeyProvider?: string;
}

/**
 * Model factory shared by the browser (BYOK) and server (byo-endpoint) connectors.
 *
 * `modelId` is required for "openai" and "portkey" since there's no safely-verifiable
 * cheap default to hardcode here: model catalogs churn faster than this file does.
 */
export function createModel(
  provider: Provider,
  modelId: string | undefined,
  apiKey: string,
  options?: CreateModelOptions
): LanguageModel {
  if (provider === "anthropic") {
    return createAnthropic({ apiKey, headers: options?.extraAnthropicHeaders })(modelId ?? DEFAULT_ANTHROPIC_MODEL);
  }
  if (provider === "openai") {
    if (!modelId) {
      throw new Error(
        '[clicksplain] provider "openai" requires a model to be set explicitly: ' +
          "see https://platform.openai.com/docs/models for current model ids."
      );
    }
    return createOpenAI({ apiKey })(modelId);
  }
  if (provider === "portkey") {
    if (!modelId) {
      throw new Error(
        '[clicksplain] provider "portkey" requires a model to be set explicitly: ' +
          "use whatever model id the underlying provider (portkeyProvider) expects."
      );
    }
    if (!options?.portkeyGatewayUrl || !options?.portkeyProvider) {
      throw new Error(
        '[clicksplain] provider "portkey" requires both portkeyGatewayUrl (your self-hosted ' +
          "Portkey AI Gateway's base URL) and portkeyProvider (which underlying provider Portkey " +
          'should route to, e.g. "anthropic") to be set.'
      );
    }
    // `.chat(modelId)`, not the bare `(modelId)` call: the latter defaults to
    // OpenAI's newer Responses API, which Portkey's gateway doesn't speak for
    // non-OpenAI providers ("createModelResponse is not supported by <provider>",
    // verified against a local Portkey instance). `.chat()` forces classic Chat
    // Completions (POST {baseURL}/chat/completions), which Portkey does support.
    return createOpenAI({
      apiKey,
      baseURL: options.portkeyGatewayUrl,
      headers: { "x-portkey-provider": options.portkeyProvider },
    }).chat(modelId);
  }
  throw new Error(`[clicksplain] unknown provider "${provider}"`);
}

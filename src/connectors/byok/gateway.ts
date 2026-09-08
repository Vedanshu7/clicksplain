import { createModel as createModelBase, MAX_TOKENS, type Provider } from "../../shared/gateway";
import type { LanguageModel } from "ai";

export type { Provider };
export { MAX_TOKENS };

/**
 * Browser-side model factory. Anthropic requires the
 * anthropic-dangerous-direct-browser-access header for browser-origin calls:
 * Anthropic gates this specifically because it's normally the wrong pattern
 * (see the BYOK safety warning in ByokConnector.ts). The shared factory's
 * server-side callers omit this header, since they don't need it.
 */
export function createModel(provider: Provider, modelId: string | undefined, apiKey: string): LanguageModel {
  return createModelBase(
    provider,
    modelId,
    apiKey,
    provider === "anthropic"
      ? { extraAnthropicHeaders: { "anthropic-dangerous-direct-browser-access": "true" } }
      : undefined
  );
}

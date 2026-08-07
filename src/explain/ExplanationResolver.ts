import type { AgentConnector, ElementInfo, ExplainRequest } from "../connectors/types";
import { resolveDocsContext, type DocsConfig } from "../context/TaggingResolver";
import type { ExplanationCache } from "../cache/ExplanationCache";
import type { PopoverRenderer } from "../ui/PopoverRenderer";

export interface ResolveExplanationInput {
  element: Element;
  elementInfo: ElementInfo;
  route: string;
  docsConfig: DocsConfig | undefined;
  cache: ExplanationCache;
  connector: AgentConnector;
  popover: PopoverRenderer;
  signal: AbortSignal;
}

export interface ResolvedExplanation {
  baseExplanation: string;
  docsContext: string | null;
}

/**
 * Priority chain for the initial explanation shown after a pick: hardcoded
 * docsConfig -> local cache -> live LLM call. The first two are instant and
 * cost nothing; only a genuine cache miss reaches the network. Returns null
 * on abort or error (caller should bail without arming the chat box).
 */
export async function resolveExplanation(
  input: ResolveExplanationInput
): Promise<ResolvedExplanation | null> {
  const { element, elementInfo, route, docsConfig, cache, connector, popover, signal } = input;

  const docsContext = resolveDocsContext(elementInfo.agentId, docsConfig, route);
  if (docsContext) {
    popover.setContent(docsContext);
    popover.complete();
    return { baseExplanation: docsContext, docsContext };
  }

  const cached = cache.get(route, elementInfo);
  if (cached) {
    popover.setContent(cached);
    popover.complete();
    return { baseExplanation: cached, docsContext: null };
  }

  const request: ExplainRequest = { elementInfo, docsContext: null, route };

  try {
    let fullText = "";
    for await (const chunk of connector.explain(element, request, signal)) {
      if (signal.aborted) return null;
      popover.appendText(chunk);
      fullText += chunk;
    }
    if (signal.aborted) return null;

    popover.complete();
    cache.set(route, elementInfo, fullText);
    return { baseExplanation: fullText, docsContext: null };
  } catch (err) {
    if (signal.aborted) return null;
    popover.setError(err instanceof Error ? err.message : "Something went wrong.");
    return null;
  }
}

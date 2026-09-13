import type { AgentConnector, ElementInfo, ExplainRequest } from "../connectors/types";
import { resolveDocsContext, type DocsConfig } from "../context/TaggingResolver";
import type { ExplanationCache } from "../cache/ExplanationCache";
import type { PopoverRenderer } from "../ui/PopoverRenderer";
import type { Labels } from "../ui/labels";
import { errorMessageFor } from "../ui/errorMessage";

export interface ResolveExplanationInput {
  element: Element;
  elementInfo: ElementInfo;
  route: string;
  pageLanguage: string | null;
  siteContext: string | null;
  docsConfig: DocsConfig | undefined;
  cache: ExplanationCache;
  connector: AgentConnector;
  popover: PopoverRenderer;
  labels: Labels;
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
  const { element, elementInfo, route, pageLanguage, siteContext, docsConfig, cache, connector, popover, labels, signal } =
    input;

  const docsContext = resolveDocsContext(elementInfo.agentId, docsConfig, route);
  if (docsContext) {
    popover.setContent(docsContext);
    popover.complete();
    return { baseExplanation: docsContext, docsContext };
  }

  const cached = cache.get(route, elementInfo, pageLanguage);
  if (cached) {
    popover.setContent(cached);
    popover.complete();
    return { baseExplanation: cached, docsContext: null };
  }

  const request: ExplainRequest = { elementInfo, docsContext: null, route, pageLanguage, siteContext };

  try {
    let fullText = "";
    for await (const chunk of connector.explain(element, request, signal)) {
      if (signal.aborted) return null;
      popover.appendText(chunk);
      fullText += chunk;
    }
    if (signal.aborted) return null;

    // A stream that ends cleanly with no text (a misbehaving proxy, a model
    // that only called a tool) must not be cached as "the" explanation.
    if (!fullText.trim()) {
      popover.setError(labels.emptyAnswer);
      return null;
    }

    popover.complete();
    cache.set(route, elementInfo, pageLanguage, fullText);
    return { baseExplanation: fullText, docsContext: null };
  } catch (err) {
    if (signal.aborted) return null;
    popover.setError(errorMessageFor(err, labels));
    return null;
  }
}

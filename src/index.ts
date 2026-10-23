import { SessionState } from "./state/SessionState";
import { ChatSession } from "./state/ChatSession";
import { PickerController } from "./picker/PickerController";
import { PopoverRenderer } from "./ui/PopoverRenderer";
import { getShadowHost, removeShadowHost } from "./ui/shadowHost";
import { applyTheme, type ThemeConfig } from "./ui/theme";
import { resolveLabels, type Labels } from "./ui/labels";
import { errorMessageFor } from "./ui/errorMessage";
import { extractElementInfo } from "./context/elementInfoExtractor";
import type { DocsConfig } from "./context/taggingResolver";
import { getCurrentRoute } from "./context/routeMatcher";
import {
  ByoEndpointConnector,
  type ByoEndpointConnectorConfig,
} from "./connectors/byoEndpoint/ByoEndpointConnector";
import { PuterConnector, type PuterConnectorConfig } from "./connectors/puter/PuterConnector";
import type { AgentConnector, ChatRequest, ElementInfo } from "./connectors/types";
import { withIdleTimeout } from "./connectors/withIdleTimeout";
import { ExplanationCache, type CacheConfig } from "./cache/ExplanationCache";
import { resolveExplanation } from "./explain/explanationResolver";

export interface InitConfig {
  /**
   * A built-in connector name, or any AgentConnector instance: e.g. `byok({...})`
   * from "clicksplain/byok", kept out of this entry so the AI SDK it needs is
   * only ever shipped to pages that actually use it.
   */
  connector: "byo-endpoint" | "puter" | AgentConnector;
  /** byo-endpoint: URL of your own proxy implementing the canonical protocol. */
  endpoint?: string;
  /** byo-endpoint: shared secret matching the proxy's WIDGET_TOKEN, if configured. */
  token?: string;
  /** puter: e.g. "claude-sonnet-4-6" (see Puter's own model catalog). */
  model?: string;
  /** puter: independently configurable from `model`: falls back to it if unset. */
  chatModel?: string;
  /**
   * A sentence or two about what your site is (e.g. "Crema, the app for a
   * home espresso machine"), sent with every question so domain jargon is
   * explained in the right sense.
   */
  siteContext?: string;
  /**
   * Longest wait for the next chunk of an answer before giving up with an
   * error. Default 30s, or 120s for puter, whose first answer can wait on its
   * own sign-in popup.
   */
  timeoutMs?: number;
  /** route -> data-agent-id -> doc snippet/URL, for tier-2 tagged elements. */
  docsConfig?: DocsConfig;
  cache?: CacheConfig;
  /**
   * Programmatic theme overrides: sets the same public CSS custom properties
   * a host page could set itself (see shadow.css's doc comment), just as an
   * inline style so it always wins over host-page CSS. Not available via the
   * plain <script data-*> auto-init path: use host-page CSS custom properties
   * there instead (zero JS needed either way).
   */
  theme?: ThemeConfig;
  /** Which bottom corner the "?" button sits in. Default "bottom-right". */
  position?: "bottom-right" | "bottom-left";
  /** Overrides for any of the widget's own UI strings, e.g. to localize them. */
  labels?: Partial<Labels>;
}

interface CurrentPick {
  element: Element;
  elementInfo: ElementInfo;
  route: string;
  pageLanguage: string | null;
  docsContext: string | null;
  baseExplanation: string;
}

class ClicksplainInstance {
  private readonly session: SessionState;
  private readonly chatSession: ChatSession;
  private readonly picker: PickerController;
  private readonly popover: PopoverRenderer;
  private readonly connector: AgentConnector;
  private readonly docsConfig?: DocsConfig;
  private readonly cache: ExplanationCache;
  private readonly labels: Labels;
  private readonly siteContext: string | null;
  private readonly unsubscribePick: () => void;
  private currentPick: CurrentPick | null = null;

  constructor(config: InitConfig) {
    // Validate/construct the connector before touching the DOM at all, so a bad
    // config (e.g. a byo-endpoint connector without an endpoint) fails cleanly with zero UI side effects rather
    // than leaving an orphaned popover behind from a half-finished construction.
    this.labels = resolveLabels(config.labels);
    this.connector = withIdleTimeout(
      createConnector(config),
      config.timeoutMs ?? (config.connector === "puter" ? 120_000 : 30_000),
      this.labels.timeout
    );
    this.docsConfig = config.docsConfig;
    this.siteContext = config.siteContext ?? null;
    this.cache = new ExplanationCache(config.cache);
    // Applied before Picker/Popover construct their own elements, so nothing
    // ever renders with default colors and then flashes to the themed ones.
    const { mount } = getShadowHost();
    applyTheme(mount, config.theme);
    mount.dataset.position = config.position ?? "bottom-right";
    this.session = new SessionState();
    this.chatSession = new ChatSession();
    this.picker = new PickerController(this.session, this.labels);
    this.popover = new PopoverRenderer(this.labels);
    this.unsubscribePick = this.picker.onPick((element) => void this.handlePick(element));
    // Covers Escape, outside-click, the close button, and the anchor leaving the
    // DOM, all of which funnel through PopoverRenderer.close(). Re-picking a
    // different element while the popover stays open is handled separately in
    // handlePick, since open() re-anchors rather than closing (onClose never
    // fires there).
    this.popover.onClose(() => {
      this.session.cancelActive();
      this.chatSession.reset();
      this.currentPick = null;
    });
  }

  destroy(): void {
    this.unsubscribePick();
    this.session.cancelActive();
    this.picker.destroy();
    this.popover.destroy();
    removeShadowHost();
  }

  private async handlePick(element: Element): Promise<void> {
    const elementInfo = extractElementInfo(element);
    const route = getCurrentRoute();
    const pageLanguage = document.documentElement.lang || null;

    const signal = this.session.beginRequest();
    this.popover.open(element);
    this.chatSession.reset();
    this.currentPick = null;

    const result = await resolveExplanation({
      element,
      elementInfo,
      route,
      pageLanguage,
      siteContext: this.siteContext,
      docsConfig: this.docsConfig,
      cache: this.cache,
      connector: this.connector,
      popover: this.popover,
      labels: this.labels,
      signal,
    });
    if (!result || signal.aborted) return;

    this.currentPick = {
      element,
      elementInfo,
      route,
      pageLanguage,
      docsContext: result.docsContext,
      baseExplanation: result.baseExplanation,
    };
    this.popover.showFollowUp((question) => void this.handleChatSubmit(question));
  }

  private async handleChatSubmit(question: string): Promise<void> {
    if (!this.currentPick) return;
    const { element, elementInfo, route, pageLanguage, docsContext, baseExplanation } = this.currentPick;

    // Snapshot turns prior to this question: chatSession.addUserTurn below
    // records it for the *next* turn's history, not this request's.
    const history = [...this.chatSession.history];
    const signal = this.session.beginRequest();
    this.chatSession.addUserTurn(question);

    const request: ChatRequest = {
      elementInfo,
      route,
      pageLanguage,
      siteContext: this.siteContext,
      docsContext,
      baseExplanation,
      history,
      question,
    };

    try {
      let fullText = "";
      for await (const chunk of this.connector.chat(element, request, signal)) {
        if (signal.aborted) return;
        this.popover.appendChatText(chunk);
        fullText += chunk;
      }
      if (signal.aborted) return;

      this.popover.completeChatTurn();
      this.chatSession.addAssistantTurn(fullText);
    } catch (err) {
      if (signal.aborted) return;
      this.popover.setChatError(errorMessageFor(err, this.labels));
    }
  }
}

function createConnector(config: InitConfig): AgentConnector {
  if (typeof config.connector === "object") return config.connector;

  if (config.connector === "byo-endpoint") {
    if (!config.endpoint) {
      throw new Error('[clicksplain] "byo-endpoint" connector requires endpoint');
    }
    const endpointConfig: ByoEndpointConnectorConfig = { endpoint: config.endpoint, token: config.token };
    return new ByoEndpointConnector(endpointConfig);
  }

  if (config.connector === "puter") {
    const puterConfig: PuterConnectorConfig = { model: config.model, chatModel: config.chatModel };
    return new PuterConnector(puterConfig);
  }

  throw new Error(`[clicksplain] unknown connector "${String(config.connector)}"`);
}

let activeInstance: ClicksplainInstance | null = null;

export function init(config: InitConfig): void {
  activeInstance?.destroy();
  activeInstance = new ClicksplainInstance(config);
}

export function destroy(): void {
  activeInstance?.destroy();
  activeInstance = null;
}

function readConfigFromScriptTag(): InitConfig | null {
  const script = document.currentScript as HTMLScriptElement | null;
  if (!script) return null;

  const connector = script.dataset.connector;
  // No data-api-key path on purpose: a key in a script attribute sits in the
  // page's HTML source, where no strictOrigins check can ever protect it.
  if (connector === "byok") {
    throw new Error(
      '[clicksplain] "byok" is not available via <script data-*> auto-init: load ' +
        "clicksplain-byok.global.js and call Clicksplain.init({ connector: Clicksplain.byok({...}) }) instead."
    );
  }
  if (connector !== "byo-endpoint" && connector !== "puter") return null;

  const position = script.dataset.position;
  if (position !== undefined && position !== "bottom-right" && position !== "bottom-left") {
    throw new Error(`[clicksplain] invalid data-position "${position}"`);
  }

  return {
    connector,
    endpoint: script.dataset.endpoint,
    token: script.dataset.token,
    model: script.dataset.model,
    chatModel: script.dataset.chatModel,
    siteContext: script.dataset.siteContext,
    position,
  };
}

// Auto-init when loaded as a plain <script data-connector="..."> tag. Errors are
// caught (not thrown) here specifically: this runs unattended at module load,
// with no calling code able to wrap it in try/catch, so a misconfigured widget
// must not break the rest of the host page's scripts.
if (typeof document !== "undefined") {
  const initSafely = (config: InitConfig) => {
    try {
      init(config);
    } catch (err) {
      console.error("[clicksplain] failed to initialize:", err);
    }
  };
  try {
    // document.currentScript is only set while this script first executes, so
    // the config is read now even when mounting has to wait for <body>.
    const autoConfig = readConfigFromScriptTag();
    if (autoConfig && document.body) {
      initSafely(autoConfig);
    } else if (autoConfig) {
      // A plain (non-deferred) <script> in <head> runs before <body> exists.
      document.addEventListener("DOMContentLoaded", () => initSafely(autoConfig), { once: true });
    }
  } catch (err) {
    console.error("[clicksplain] failed to initialize:", err);
  }
}

export type { DocsConfig } from "./context/taggingResolver";
export type { ThemeConfig } from "./ui/theme";
export type { Labels } from "./ui/labels";
export type {
  AgentConnector,
  ChatRequest,
  ChatTurn,
  ElementInfo,
  ExplainChunk,
  ExplainRequest,
} from "./connectors/types";

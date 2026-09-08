import { SessionState } from "./state/SessionState";
import { ChatSession } from "./state/ChatSession";
import { PickerController } from "./picker/PickerController";
import { PopoverRenderer } from "./ui/PopoverRenderer";
import { getShadowHost } from "./ui/shadowHost";
import { applyTheme, type ThemeConfig } from "./ui/theme";
import { extractElementInfo } from "./context/ElementInfoExtractor";
import { type DocsConfig } from "./context/TaggingResolver";
import { getCurrentRoute } from "./context/RouteMatcher";
import { ByokConnector, type ByokConnectorConfig } from "./connectors/byok/ByokConnector";
import {
  ByoEndpointConnector,
  type ByoEndpointConnectorConfig,
} from "./connectors/byoEndpoint/ByoEndpointConnector";
import { PuterConnector, type PuterConnectorConfig } from "./connectors/puter/PuterConnector";
import type { AgentConnector, ChatRequest, ElementInfo } from "./connectors/types";
import { ExplanationCache, type CacheConfig } from "./cache/ExplanationCache";
import { resolveExplanation } from "./explain/ExplanationResolver";

export interface InitConfig {
  connector: "byok" | "byo-endpoint" | "puter";
  /** byo-endpoint: URL of your own proxy implementing the canonical protocol. */
  endpoint?: string;
  /** byo-endpoint: shared secret matching the proxy's WIDGET_TOKEN, if configured. */
  token?: string;
  /** byok: raw LLM API key. Exposed in the browser: see ByokConnector's warning. */
  apiKey?: string;
  /** byok/puter: e.g. "claude-haiku-4-5" (byok) or "claude-sonnet-4-6" (puter, see its own model catalog). */
  model?: string;
  /** Independently configurable from `model`: falls back to it if unset. */
  chatModel?: string;
  /** byok only. */
  provider?: "anthropic" | "openai";
  /** byok only: hard-fail unless window.location.hostname is in this list. */
  strictOrigins?: string[];
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
}

interface CurrentPick {
  element: Element;
  elementInfo: ElementInfo;
  route: string;
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
  private readonly unsubscribePick: () => void;
  private currentPick: CurrentPick | null = null;
  private readonly handleModeChange = (): void => {
    if (this.session.mode === "idle") {
      this.session.cancelActiveExplain();
      this.popover.close();
    }
  };

  constructor(config: InitConfig) {
    // Validate/construct the connector before touching the DOM at all, so a bad
    // config (e.g. missing apiKey) fails cleanly with zero UI side effects rather
    // than leaving an orphaned popover behind from a half-finished construction.
    this.connector = createConnector(config);
    this.docsConfig = config.docsConfig;
    this.cache = new ExplanationCache(config.cache);
    // Applied before Picker/Popover construct their own elements, so nothing
    // ever renders with default colors and then flashes to the themed ones.
    applyTheme(getShadowHost().mount, config.theme);
    this.session = new SessionState();
    this.chatSession = new ChatSession();
    this.picker = new PickerController(this.session);
    this.popover = new PopoverRenderer();
    this.unsubscribePick = this.picker.onPick((element) => void this.handlePick(element));
    this.session.addEventListener("modechange", this.handleModeChange);
    // Covers Escape/outside-click/close-button, all of which funnel through
    // PopoverRenderer.close(). Re-picking a different element while the popover
    // stays open is handled separately in handlePick, since open() re-anchors
    // rather than closing (onClose never fires there).
    this.popover.onClose(() => {
      this.chatSession.reset();
      this.currentPick = null;
    });
  }

  destroy(): void {
    this.session.removeEventListener("modechange", this.handleModeChange);
    this.unsubscribePick();
    this.picker.destroy();
    this.popover.destroy();
    this.session.cancelActiveExplain();
  }

  private async handlePick(element: Element): Promise<void> {
    const elementInfo = extractElementInfo(element);
    const route = getCurrentRoute();

    const signal = this.session.beginExplain();
    this.popover.open(element);
    this.chatSession.reset();
    this.currentPick = null;

    const result = await resolveExplanation({
      element,
      elementInfo,
      route,
      docsConfig: this.docsConfig,
      cache: this.cache,
      connector: this.connector,
      popover: this.popover,
      signal,
    });
    if (!result || signal.aborted) return;

    this.currentPick = { element, elementInfo, route, docsContext: result.docsContext, baseExplanation: result.baseExplanation };
    this.popover.showFollowUp((question) => void this.handleChatSubmit(question));
  }

  private async handleChatSubmit(question: string): Promise<void> {
    if (!this.currentPick) return;
    const { element, elementInfo, route, docsContext, baseExplanation } = this.currentPick;

    // Snapshot turns prior to this question: chatSession.addUserTurn below
    // records it for the *next* turn's history, not this request's.
    const history = [...this.chatSession.history];
    const signal = this.session.beginChatTurn();
    this.chatSession.addUserTurn(question);

    const request: ChatRequest = { elementInfo, route, docsContext, baseExplanation, history, question };

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
      this.popover.setChatError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }
}

function createConnector(config: InitConfig): AgentConnector {
  if (config.connector === "byok") {
    if (!config.apiKey) throw new Error('[clicksplain] "byok" connector requires apiKey');
    const byokConfig: ByokConnectorConfig = {
      apiKey: config.apiKey,
      provider: config.provider,
      model: config.model,
      chatModel: config.chatModel,
      strictOrigins: config.strictOrigins,
    };
    return new ByokConnector(byokConfig);
  }

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

  throw new Error(`[clicksplain] unknown connector "${config.connector}"`);
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
  if (connector !== "byok" && connector !== "byo-endpoint" && connector !== "puter") return null;

  const provider = script.dataset.provider;
  if (provider !== undefined && provider !== "anthropic" && provider !== "openai") {
    throw new Error(`[clicksplain] invalid data-provider "${provider}"`);
  }

  return {
    connector,
    endpoint: script.dataset.endpoint,
    token: script.dataset.token,
    apiKey: script.dataset.apiKey,
    provider,
    model: script.dataset.model,
    chatModel: script.dataset.chatModel,
  };
}

// Auto-init when loaded as a plain <script data-connector="..."> tag. Errors are
// caught (not thrown) here specifically: this runs unattended at module load,
// with no calling code able to wrap it in try/catch, so a misconfigured widget
// must not break the rest of the host page's scripts.
if (typeof document !== "undefined") {
  const autoConfig = readConfigFromScriptTag();
  if (autoConfig) {
    try {
      init(autoConfig);
    } catch (err) {
      console.error("[clicksplain] failed to initialize:", err);
    }
  }
}

export type { DocsConfig } from "./context/TaggingResolver";
export type { ThemeConfig } from "./ui/theme";
export type {
  AgentConnector,
  ChatRequest,
  ChatTurn,
  ElementInfo,
  ExplainChunk,
  ExplainRequest,
} from "./connectors/types";

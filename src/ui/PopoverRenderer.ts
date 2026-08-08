import { autoPlacement, autoUpdate, computePosition, offset, shift } from "@floating-ui/dom";
import { getShadowHost } from "./shadowHost";
import { animateIn, animateOut } from "./animations";
import { ChatPanel, type ChatSubmitHandler } from "./ChatPanel";

/**
 * Animated popover anchored to the picked element. Renders inside the shared
 * closed shadow root; positioning tracks the anchor via floating-ui's autoUpdate
 * (scroll/resize/layout shifts) until closed.
 */
export class PopoverRenderer {
  private readonly hostElement: HTMLElement;
  private readonly panel: HTMLDivElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly loadingBlob: HTMLDivElement;
  private readonly content: HTMLDivElement;
  private readonly chatPanel: ChatPanel;
  private readonly closeHandlers = new Set<() => void>();
  private stopAutoUpdate: (() => void) | null = null;
  private anchor: Element | null = null;
  private visible = false;

  constructor() {
    const { mount, hostElement } = getShadowHost();
    this.hostElement = hostElement;

    this.panel = document.createElement("div");
    this.panel.className = "oa-popover";
    this.panel.setAttribute("role", "status");
    this.panel.setAttribute("aria-live", "polite");

    this.closeButton = document.createElement("button");
    this.closeButton.type = "button";
    this.closeButton.className = "oa-popover-close";
    this.closeButton.setAttribute("aria-label", "Close explanation");
    this.closeButton.textContent = "✕";
    this.closeButton.addEventListener("click", () => this.close());

    this.loadingBlob = document.createElement("div");
    this.loadingBlob.className = "oa-loading-blob";
    this.loadingBlob.style.display = "none";

    this.content = document.createElement("div");
    this.content.className = "oa-popover-content";

    this.panel.append(this.closeButton, this.loadingBlob, this.content);
    this.chatPanel = new ChatPanel(this.panel);
    mount.appendChild(this.panel);

    document.addEventListener("click", this.handleOutsideClick, true);
  }

  get isOpen(): boolean {
    return this.anchor !== null;
  }

  /** Opens (or re-anchors) the popover against a newly picked element, resetting content. */
  open(anchor: Element): void {
    this.anchor = anchor;
    this.content.textContent = "";
    this.content.classList.remove("oa-popover-error");
    this.loadingBlob.style.display = "block";
    this.chatPanel.reset();

    this.stopAutoUpdate?.();
    this.stopAutoUpdate = autoUpdate(anchor, this.panel, () => this.reposition());
    this.reposition();

    this.visible = true;
    animateIn(this.panel);
    requestAnimationFrame(() => this.reposition());
  }

  /** Appends a streamed text chunk, hiding the loading blob on first content. */
  appendText(text: string): void {
    this.loadingBlob.style.display = "none";
    this.content.textContent += text;
    this.reposition();
  }

  /** Instant, non-streaming display for a docsConfig or cache hit: no loading state at all. */
  setContent(text: string): void {
    this.loadingBlob.style.display = "none";
    this.content.classList.remove("oa-popover-error");
    this.content.textContent = text;
    this.reposition();
  }

  setError(message: string): void {
    this.loadingBlob.style.display = "none";
    this.content.textContent = message;
    this.content.classList.add("oa-popover-error");
  }

  complete(): void {
    this.loadingBlob.style.display = "none";
  }

  /** Reveals the follow-up chat box, armed with the given submit handler for this popover session. */
  showFollowUp(onSubmit: ChatSubmitHandler): void {
    this.chatPanel.show(onSubmit);
    this.reposition();
  }

  appendChatText(text: string): void {
    this.chatPanel.appendAssistantDelta(text);
    this.reposition();
  }

  completeChatTurn(): void {
    this.chatPanel.completeAssistantTurn();
    this.reposition();
  }

  setChatError(message: string): void {
    this.chatPanel.setError(message);
    this.reposition();
  }

  close(): void {
    if (!this.anchor) return;
    this.visible = false;
    void animateOut(this.panel);
    this.stopAutoUpdate?.();
    this.stopAutoUpdate = null;
    this.anchor = null;
    for (const handler of this.closeHandlers) handler();
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  destroy(): void {
    document.removeEventListener("click", this.handleOutsideClick, true);
    this.stopAutoUpdate?.();
    this.panel.remove();
  }

  private reposition(): void {
    if (!this.anchor) return;
    const scale = this.visible ? 1 : 0.96;
    void computePosition(this.anchor, this.panel, {
      strategy: "fixed",
      // No hardcoded starting side. autoPlacement measures actual overflow
      // for each candidate in allowedPlacements and picks whichever one
      // genuinely fits: right first (least likely to cover neighboring
      // content), falling through left/top/bottom only when right doesn't
      // have room. This replaces the old placement:"top" + flip() pairing,
      // which only ever had "bottom" as a fallback and so always landed
      // below the element regardless of whether that was the best spot.
      middleware: [
        offset(10),
        autoPlacement({ allowedPlacements: ["right", "left", "top", "bottom"], padding: 8 }),
        shift({ padding: 8 }),
      ],
    }).then(({ x, y }) => {
      this.panel.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    });
  }

  // Only reachable when not in inspect mode (PickerController's capture-phase
  // listener consumes/stops the event first while inspecting).
  private handleOutsideClick = (event: MouseEvent): void => {
    if (!this.isOpen) return;
    const target = event.target as Element | null;
    if (!target || target === this.hostElement) return;
    this.close();
  };
}

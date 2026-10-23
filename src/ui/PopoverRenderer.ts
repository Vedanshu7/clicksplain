import { autoPlacement, autoUpdate, computePosition, offset, shift, size } from "@floating-ui/dom";
import { getShadowHost } from "./shadowHost";
import { animateIn, animateOut } from "./animations";
import { ChatPanel, type ChatSubmitHandler } from "./ChatPanel";
import type { Labels } from "./labels";

/**
 * Animated popover anchored to the picked element. Renders inside the shared
 * open shadow root; positioning tracks the anchor via floating-ui's autoUpdate
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
  private returnFocusTo: HTMLElement | null = null;
  private visible = false;

  constructor(labels: Labels) {
    const { mount, hostElement } = getShadowHost();
    this.hostElement = hostElement;

    this.panel = document.createElement("div");
    this.panel.className = "oa-popover";
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-label", labels.popover);
    this.panel.tabIndex = -1;

    this.closeButton = document.createElement("button");
    this.closeButton.type = "button";
    this.closeButton.className = "oa-popover-close";
    this.closeButton.setAttribute("aria-label", labels.close);
    this.closeButton.textContent = "✕";
    this.closeButton.addEventListener("click", () => this.close());

    this.loadingBlob = document.createElement("div");
    this.loadingBlob.className = "oa-loading-blob";
    this.loadingBlob.style.display = "none";

    // Only the answer text is a live region: announcing the whole panel would
    // re-read the close button and chat form on every streamed chunk.
    // aria-busy holds announcements until the answer is complete.
    this.content = document.createElement("div");
    this.content.className = "oa-popover-content";
    this.content.setAttribute("aria-live", "polite");

    this.panel.append(this.closeButton, this.loadingBlob, this.content);
    this.chatPanel = new ChatPanel(this.panel, labels);
    mount.appendChild(this.panel);

    document.addEventListener("click", this.handleOutsideClick, true);
    document.addEventListener("keydown", this.handleKeyDown);
  }

  get isOpen(): boolean {
    return this.anchor !== null;
  }

  /** Opens (or re-anchors) the popover against a newly picked element, resetting content. */
  open(anchor: Element): void {
    this.anchor = anchor;
    this.content.textContent = "";
    this.content.classList.remove("oa-popover-error");
    this.content.setAttribute("aria-busy", "true");
    this.loadingBlob.style.display = "block";
    this.chatPanel.reset();

    this.stopAutoUpdate?.();
    this.stopAutoUpdate = autoUpdate(anchor, this.panel, () => this.reposition());
    this.reposition();

    if (!this.visible) {
      const active = document.activeElement;
      this.returnFocusTo = active instanceof HTMLElement && active !== this.hostElement ? active : null;
    }
    this.visible = true;
    animateIn(this.panel);
    this.panel.focus({ preventScroll: true });
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
    this.content.setAttribute("aria-busy", "false");
    this.reposition();
  }

  setError(message: string): void {
    this.loadingBlob.style.display = "none";
    this.content.textContent = message;
    this.content.classList.add("oa-popover-error");
    this.content.setAttribute("aria-busy", "false");
    this.reposition();
  }

  complete(): void {
    this.loadingBlob.style.display = "none";
    this.content.setAttribute("aria-busy", "false");
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
    animateOut(this.panel);
    this.stopAutoUpdate?.();
    this.stopAutoUpdate = null;
    this.anchor = null;
    // Only hand focus back if it's still inside the widget: a close triggered
    // by clicking elsewhere on the page must leave focus where that click put it.
    if (document.activeElement === this.hostElement && this.returnFocusTo?.isConnected) {
      this.returnFocusTo.focus({ preventScroll: true });
    }
    this.returnFocusTo = null;
    for (const handler of this.closeHandlers) handler();
  }

  onClose(handler: () => void): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  destroy(): void {
    document.removeEventListener("click", this.handleOutsideClick, true);
    document.removeEventListener("keydown", this.handleKeyDown);
    this.stopAutoUpdate?.();
    this.panel.remove();
  }

  private reposition(): void {
    if (!this.anchor) return;
    // An SPA re-render can remove the anchor; positioning against a detached
    // element would fling the popover to the viewport's top-left corner.
    if (!this.anchor.isConnected) {
      this.close();
      return;
    }
    const scale = this.visible ? 1 : 0.96;
    void computePosition(this.anchor, this.panel, {
      strategy: "fixed",
      // No hardcoded starting side. autoPlacement measures actual overflow
      // for each candidate in allowedPlacements and picks whichever one
      // genuinely fits: right first (least likely to cover neighboring
      // content), falling through left/top/bottom only when right doesn't
      middleware: [
        offset(10),
        autoPlacement({ allowedPlacements: ["right", "left", "top", "bottom"], padding: 8 }),
        shift({ padding: 8 }),
        // Long answers plus a chat thread can outgrow a small viewport: cap the
        // height to what's available and let the panel scroll (shadow.css).
        size({
          padding: 8,
          apply: ({ availableHeight }) => {
            this.panel.style.maxHeight = `${Math.max(160, availableHeight)}px`;
          },
        }),
      ],
    }).then(({ x, y }) => {
      this.panel.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    });
  }

  // Only reachable when not in inspect mode (PickerController's window-level
  // capture listener consumes the event first while inspecting).
  private handleOutsideClick = (event: MouseEvent): void => {
    if (!this.isOpen) return;
    if (event.composedPath().includes(this.hostElement)) return;
    this.close();
  };

  // Bubble phase, not capture: while inspecting, PickerController's capture
  // listener stops Escape first, so it only ends inspect mode; the next Escape
  // closes the popover.
  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.isOpen) return;
    event.stopPropagation();
    this.close();
  };
}

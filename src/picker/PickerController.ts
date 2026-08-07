import type { SessionState } from "../state/SessionState";
import { getShadowHost } from "../ui/shadowHost";
import { ElementHighlighter } from "./ElementHighlighter";

export type PickHandler = (element: Element) => void;

/**
 * Owns the floating "?" button and the capture-phase click interception that
 * turns a click anywhere on the host page into a "picked element" event while
 * inspect mode is active.
 */
export class PickerController {
  private readonly highlighter: ElementHighlighter;
  private readonly fab: HTMLButtonElement;
  private readonly hostElement: HTMLElement;
  private readonly pickHandlers = new Set<PickHandler>();

  constructor(private readonly session: SessionState) {
    const { hostElement, mount } = getShadowHost();
    this.hostElement = hostElement;

    this.fab = document.createElement("button");
    this.fab.type = "button";
    this.fab.className = "oa-fab";
    this.fab.setAttribute("aria-label", "Explain this UI");
    this.fab.textContent = "?";
    this.fab.addEventListener("click", () => this.session.toggleInspectMode());
    mount.appendChild(this.fab);

    this.highlighter = new ElementHighlighter(mount, hostElement);

    this.session.addEventListener("modechange", this.handleModeChange as EventListener);
    document.addEventListener("click", this.handleDocumentClick, true);
    document.addEventListener("keydown", this.handleKeyDown, true);
  }

  /** Registers a callback fired with the picked element; returns an unsubscribe fn. */
  onPick(handler: PickHandler): () => void {
    this.pickHandlers.add(handler);
    return () => this.pickHandlers.delete(handler);
  }

  destroy(): void {
    this.session.removeEventListener("modechange", this.handleModeChange as EventListener);
    document.removeEventListener("click", this.handleDocumentClick, true);
    document.removeEventListener("keydown", this.handleKeyDown, true);
    this.highlighter.destroy();
    this.fab.remove();
  }

  private handleModeChange = (): void => {
    const inspecting = this.session.mode === "inspecting";
    this.fab.classList.toggle("oa-active", inspecting);
    document.body.classList.toggle("oa-inspecting", inspecting);
    if (inspecting) {
      this.highlighter.enable();
    } else {
      this.highlighter.disable();
    }
  };

  private handleDocumentClick = (event: MouseEvent): void => {
    if (this.session.mode !== "inspecting") return;

    const target = event.target as Element | null;
    // Retargeted to hostElement when the click landed on our own UI (fab/popover) —
    // let it through untouched so the fab's own listener still handles it.
    if (!target || target === this.hostElement) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    for (const handler of this.pickHandlers) {
      handler(target);
    }
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.session.mode === "inspecting") {
      this.session.setMode("idle");
    }
  };
}

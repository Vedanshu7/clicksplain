import type { SessionState } from "../state/SessionState";
import { getShadowHost, setInspectCursorColor } from "../ui/shadowHost";
import { ElementHighlighter } from "./ElementHighlighter";
import { isIgnored } from "../context/privacy";
import type { Labels } from "../ui/labels";

export type PickHandler = (element: Element) => void;

// A pointer-driven pick happens on pointerup; the click the browser dispatches
// right after it must not reach the page (that would activate the very button
// being explained). Disabled controls get no click at all, so the suppression
// is time-boxed rather than waiting for a click that may never come.
const TRAILING_CLICK_WINDOW_MS = 500;
const SWALLOWED_EVENTS = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"] as const;

/**
 * Owns the floating "?" button and the capture-phase interception that turns
 * a press anywhere on the host page into a "picked element" event while
 * inspect mode is active. Like a DevTools element picker, one pick ends
 * inspect mode, so the page is usable again while the explanation is open.
 */
export class PickerController {
  private readonly highlighter: ElementHighlighter;
  private readonly fab: HTMLButtonElement;
  private readonly hostElement: HTMLElement;
  private readonly mount: HTMLElement;
  private readonly pickHandlers = new Set<PickHandler>();
  private pressedTarget: Element | null = null;
  private suppressClicksUntil = 0;

  constructor(
    private readonly session: SessionState,
    labels: Labels
  ) {
    const { hostElement, mount } = getShadowHost();
    this.hostElement = hostElement;
    this.mount = mount;

    this.fab = document.createElement("button");
    this.fab.type = "button";
    this.fab.className = "oa-fab";
    this.fab.setAttribute("aria-label", labels.fab);
    this.fab.setAttribute("aria-pressed", "false");
    this.fab.textContent = "?";
    this.fab.addEventListener("click", () => this.session.toggleInspectMode());
    mount.appendChild(this.fab);

    this.highlighter = new ElementHighlighter(mount, labels.highlightBadge, (event) => this.pickTarget(event));

    this.session.addEventListener("modechange", this.handleModeChange);
    // window capture runs before any listener the host page registers on
    // document or on the element itself, so the page never sees the press.
    for (const type of SWALLOWED_EVENTS) window.addEventListener(type, this.handlePointerEvent, true);
    window.addEventListener("keydown", this.handleKeyDown, true);
  }

  /** Registers a callback fired with the picked element; returns an unsubscribe fn. */
  onPick(handler: PickHandler): () => void {
    this.pickHandlers.add(handler);
    return () => this.pickHandlers.delete(handler);
  }

  destroy(): void {
    this.session.removeEventListener("modechange", this.handleModeChange);
    for (const type of SWALLOWED_EVENTS) window.removeEventListener(type, this.handlePointerEvent, true);
    window.removeEventListener("keydown", this.handleKeyDown, true);
    document.body.classList.remove("oa-inspecting");
    this.highlighter.destroy();
    this.fab.remove();
  }

  private handleModeChange = (): void => {
    const inspecting = this.session.mode === "inspecting";
    this.fab.classList.toggle("oa-active", inspecting);
    this.fab.setAttribute("aria-pressed", String(inspecting));
    document.body.classList.toggle("oa-inspecting", inspecting);
    this.pressedTarget = null;
    if (inspecting) {
      setInspectCursorColor(getComputedStyle(this.mount).getPropertyValue("--oa-accent").trim());
      this.highlighter.enable();
    } else {
      this.highlighter.disable();
    }
  };

  // The page element an event is really about, or null for our own UI.
  private pickTarget(event: Event): Element | null {
    const path = event.composedPath();
    if (path.includes(this.hostElement)) return null;
    // composedPath()[0] reaches inside the host page's own open shadow roots,
    // where event.target would stop at the outermost shadow host.
    let target = path.find((node): node is Element => node instanceof Element) ?? null;
    // Browser page translation (Chrome, Google Translate) wraps every text run
    // in <font> elements; the visitor clicked the control, not the wrapper.
    while (target?.tagName === "FONT" && target.parentElement) target = target.parentElement;
    // Clicking a field's label means "what is this setting?": explain the
    // control it labels, not the label element itself.
    if (target instanceof HTMLLabelElement && target.control) return target.control;
    return target;
  }

  private handlePointerEvent = (event: MouseEvent): void => {
    if (event.type === "click" && performance.now() < this.suppressClicksUntil) {
      this.suppressClicksUntil = 0;
      swallow(event);
      return;
    }
    if (this.session.mode !== "inspecting") return;

    const target = this.pickTarget(event);
    if (!target) return;
    // Ignored regions are still swallowed: inspect mode must never let a press
    // through to the page, it just won't explain these.
    swallow(event);
    if (isIgnored(target)) return;

    if (event.type === "pointerdown" && event.button === 0) {
      this.pressedTarget = target;
    } else if (event.type === "pointerup" && this.pressedTarget === target) {
      this.suppressClicksUntil = performance.now() + TRAILING_CLICK_WINDOW_MS;
      this.pick(target);
    } else if (event.type === "click" && event.detail === 0) {
      // detail 0: a keyboard-activated click (Enter/Space on a focused control),
      // which comes with no pointer events at all.
      this.pick(target);
    }
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || this.session.mode !== "inspecting") return;
    // Leaving inspect mode is all this Escape should do: the host page's own
    // Escape handling (closing its modal, say) must not also fire.
    event.stopPropagation();
    this.session.setMode("idle");
  };

  private pick(target: Element): void {
    this.pressedTarget = null;
    this.session.setMode("idle");
    for (const handler of this.pickHandlers) handler(target);
  }
}

function swallow(event: Event): void {
  // preventDefault on mousedown also stops the press from focusing an input
  // or starting a text selection on the page.
  if (event.cancelable) event.preventDefault();
  event.stopImmediatePropagation();
}

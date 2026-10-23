import { isIgnored } from "../context/privacy";

const BADGE_SPACE_THRESHOLD = 28;

/**
 * Draws a DevTools-picker-style outline that follows the pointer (or keyboard
 * focus) over the host page while inspect mode is active, with a small "Click
 * to explain" badge so the affordance is obvious to non-technical users, not
 * just a bare rectangle.
 */
export class ElementHighlighter {
  private readonly box: HTMLDivElement;
  private readonly badge: HTMLDivElement;
  private target: Element | null = null;
  private frame = 0;

  constructor(
    mount: HTMLElement,
    badgeText: string,
    // Same target resolution the picker uses, so what's outlined is what gets picked.
    private readonly resolveTarget: (event: Event) => Element | null
  ) {
    this.box = document.createElement("div");
    this.box.className = "oa-highlight-box";

    this.badge = document.createElement("div");
    this.badge.className = "oa-highlight-badge";
    this.badge.textContent = badgeText;

    this.box.appendChild(this.badge);
    mount.appendChild(this.box);
  }

  enable(): void {
    document.addEventListener("pointermove", this.handleTargetEvent, true);
    document.addEventListener("focusin", this.handleTargetEvent, true);
    // Scrolling moves the element under a still pointer, so re-measure.
    window.addEventListener("scroll", this.scheduleDraw, { capture: true, passive: true });
    window.addEventListener("resize", this.scheduleDraw, { passive: true });
  }

  disable(): void {
    document.removeEventListener("pointermove", this.handleTargetEvent, true);
    document.removeEventListener("focusin", this.handleTargetEvent, true);
    window.removeEventListener("scroll", this.scheduleDraw, { capture: true });
    window.removeEventListener("resize", this.scheduleDraw);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.target = null;
    this.box.style.display = "none";
  }

  destroy(): void {
    this.disable();
    this.box.remove();
  }

  private handleTargetEvent = (event: Event): void => {
    this.target = this.resolveTarget(event);
    this.scheduleDraw();
  };

  // pointermove fires far more often than the screen repaints; measuring once
  // per frame avoids forcing a layout on every event.
  private scheduleDraw = (): void => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  };

  private draw(): void {
    if (!this.target || !this.target.isConnected || isIgnored(this.target)) {
      this.box.style.display = "none";
      return;
    }

    const rect = this.target.getBoundingClientRect();
    this.box.style.display = "block";
    this.box.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    this.box.style.width = `${rect.width}px`;
    this.box.style.height = `${rect.height}px`;
    // Not enough room above the element (e.g. pinned near the top of the
    // viewport), show the badge inside the box instead of floating above it.
    this.badge.classList.toggle("oa-highlight-badge-inside", rect.top < BADGE_SPACE_THRESHOLD);
  }
}

const BADGE_SPACE_THRESHOLD = 28;

/**
 * Draws a DevTools-picker-style outline that follows the mouse over the host
 * page while inspect mode is active, with a small "Click to explain" badge so
 * the affordance is obvious to non-technical users, not just a bare rectangle.
 */
export class ElementHighlighter {
  private readonly box: HTMLDivElement;
  private readonly badge: HTMLDivElement;
  private active = false;

  constructor(mount: HTMLElement, private readonly hostElement: HTMLElement) {
    this.box = document.createElement("div");
    this.box.className = "oa-highlight-box";

    this.badge = document.createElement("div");
    this.badge.className = "oa-highlight-badge";
    this.badge.textContent = "Click to explain";

    this.box.appendChild(this.badge);
    mount.appendChild(this.box);
  }

  enable(): void {
    this.active = true;
    document.addEventListener("mousemove", this.handleMouseMove, true);
  }

  disable(): void {
    this.active = false;
    document.removeEventListener("mousemove", this.handleMouseMove, true);
    this.box.style.display = "none";
  }

  destroy(): void {
    this.disable();
    this.box.remove();
  }

  private handleMouseMove = (event: MouseEvent): void => {
    if (!this.active) return;

    const target = event.target as Element | null;
    // Events crossing a shadow root boundary retarget to `hostElement` when observed
    // from the light DOM (true for open and closed roots alike): this is how we
    // skip highlighting our own UI.
    if (!target || target === this.hostElement) {
      this.box.style.display = "none";
      return;
    }

    const rect = target.getBoundingClientRect();
    this.box.style.display = "block";
    this.box.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
    this.box.style.width = `${rect.width}px`;
    this.box.style.height = `${rect.height}px`;
    // Not enough room above the element (e.g. pinned near the top of the
    // viewport), show the badge inside the box instead of floating above it.
    this.badge.classList.toggle("oa-highlight-badge-inside", rect.top < BADGE_SPACE_THRESHOLD);
  };
}

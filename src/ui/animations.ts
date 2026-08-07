const VISIBLE_CLASS = "oa-visible";
const FALLBACK_DURATION_MS = 200;

export function animateIn(element: HTMLElement): void {
  requestAnimationFrame(() => {
    element.classList.add(VISIBLE_CLASS);
  });
}

/** Removes the visible class and resolves once the CSS transition finishes (or times out). */
export function animateOut(element: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      element.removeEventListener("transitionend", finish);
      resolve();
    };
    element.addEventListener("transitionend", finish, { once: true });
    element.classList.remove(VISIBLE_CLASS);
    setTimeout(finish, FALLBACK_DURATION_MS);
  });
}

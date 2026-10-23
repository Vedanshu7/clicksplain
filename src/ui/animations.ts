const VISIBLE_CLASS = "oa-visible";

export function animateIn(element: HTMLElement): void {
  requestAnimationFrame(() => {
    element.classList.add(VISIBLE_CLASS);
  });
}

export function animateOut(element: HTMLElement): void {
  element.classList.remove(VISIBLE_CLASS);
}

import shadowCss from "../style/shadow.css";

const HOST_ID = "clicksplain-host";
const GLOBAL_STYLE_ID = "clicksplain-global-style";

export interface ShadowHost {
  hostElement: HTMLElement;
  root: ShadowRoot;
  mount: HTMLElement;
}

let cached: ShadowHost | null = null;

/**
 * Single shared closed-shadow-root mount point for all widget UI (fab, highlighter,
 * popover). Isolates the widget's styles from the host page in both directions.
 */
export function getShadowHost(): ShadowHost {
  if (cached) return cached;

  const hostElement = document.createElement("div");
  hostElement.id = HOST_ID;
  hostElement.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  document.body.appendChild(hostElement);

  // "open" rather than "closed": style/DOM encapsulation is identical either way,
  // and open lets adopters' own e2e tests (and our own debugging) reach the widget's
  // internals via element.shadowRoot — there's no real host page adversary to defend
  // against here, since the adopter controls the host page by definition.
  const root = hostElement.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = shadowCss;
  root.appendChild(style);

  const mount = document.createElement("div");
  mount.className = "oa-mount";
  root.appendChild(mount);

  injectGlobalStyle();

  cached = { hostElement, root, mount };
  return cached;
}

// Small filled "?" badge, matching the fab/accent color — the actual mouse
// pointer becomes a question mark while inspecting, not a generic crosshair.
// `help` is the fallback keyword if the custom cursor image fails to load.
const CURSOR_SVG =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28' " +
  "viewBox='0 0 28 28'%3E%3Ccircle cx='14' cy='14' r='12' fill='rgb(91,91,245)' " +
  "stroke='white' stroke-width='2'/%3E%3Ctext x='14' y='19' font-family='Arial,sans-serif' " +
  "font-size='15' font-weight='bold' fill='white' text-anchor='middle'%3E%3F%3C/text%3E%3C/svg%3E";

// Two things that must live in a light-DOM <style> rather than the shadow
// root's own stylesheet, for two different reasons:
//  - the inspect-mode cursor has to apply to the host page itself, since a
//    shadow root's styles never reach outside its own tree;
//  - @property registrations are document-scoped — declaring one inside a
//    shadow root's stylesheet silently fails to register it (confirmed: the
//    conic-gradient animation in shadow.css computed to `none` until this
//    moved here), even though consuming the registered property via var()
//    from inside the shadow tree works fine once it's registered light-side.
function injectGlobalStyle(): void {
  if (document.getElementById(GLOBAL_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = GLOBAL_STYLE_ID;
  style.textContent = `
    @property --oa-spin-angle {
      syntax: "<angle>";
      initial-value: 0deg;
      inherits: false;
    }
    body.oa-inspecting, body.oa-inspecting * {
      cursor: url("${CURSOR_SVG}") 14 14, help !important;
    }
  `;
  document.head.appendChild(style);
}

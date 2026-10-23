import shadowCss from "../style/shadow.css";

const HOST_ID = "clicksplain-host";
const GLOBAL_STYLE_ID = "clicksplain-global-style";

export interface ShadowHost {
  hostElement: HTMLElement;
  mount: HTMLElement;
}

let cached: ShadowHost | null = null;

/**
 * Single shared open-shadow-root mount point for all widget UI (fab, highlighter,
 * popover). Isolates the widget's styles from the host page in both directions.
 */
export function getShadowHost(): ShadowHost {
  if (cached) {
    // Turbo/Hotwire-style navigation swaps out <body> wholesale, taking the
    // host with it: re-attach the same host instead of losing the widget.
    if (!cached.hostElement.isConnected) document.body.appendChild(cached.hostElement);
    return cached;
  }

  const hostElement = document.createElement("div");
  hostElement.id = HOST_ID;
  hostElement.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  document.body.appendChild(hostElement);

  // "open" rather than "closed": style/DOM encapsulation is identical either way,
  // and open lets adopters' own e2e tests (and our own debugging) reach the widget's
  // internals via element.shadowRoot, and there's no real host page adversary to defend
  // against here, since the adopter controls the host page by definition.
  const root = hostElement.attachShadow({ mode: "open" });
  adoptStyles(root, shadowCss);

  const mount = document.createElement("div");
  mount.className = "oa-mount";
  root.appendChild(mount);

  injectGlobalStyle();

  cached = { hostElement, mount };
  return cached;
}

/** Removes everything getShadowHost() added to the page; the next call starts fresh. */
export function removeShadowHost(): void {
  cached?.hostElement.remove();
  document.getElementById(GLOBAL_STYLE_ID)?.remove();
  if (globalSheet) {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== globalSheet);
    globalSheet = null;
  }
  cached = null;
}

// Constructable stylesheets aren't inline styles, so they work under a strict
// Content-Security-Policy (no 'unsafe-inline' in style-src), where an injected
// <style> element would be silently blocked. <style> remains the fallback for
// browsers without them.
function supportsConstructableSheets(): boolean {
  return "adoptedStyleSheets" in Document.prototype && "replaceSync" in CSSStyleSheet.prototype;
}

function adoptStyles(target: ShadowRoot | Document, css: string): CSSStyleSheet | null {
  if (supportsConstructableSheets()) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
    return sheet;
  }
  const style = document.createElement("style");
  style.textContent = css;
  if (target instanceof Document) {
    style.id = GLOBAL_STYLE_ID;
    target.head.appendChild(style);
  } else {
    target.appendChild(style);
  }
  return null;
}

let globalSheet: CSSStyleSheet | null = null;

const DEFAULT_ACCENT = "#5b5bf5";
// The accent lands inside an SVG attribute: anything that could close it falls
// back to the default rather than breaking the cursor.
const SAFE_COLOR = /^[#\w\s(),.%/-]+$/;

// Small filled "?" badge in the accent color: the actual mouse pointer becomes
// a question mark while inspecting, not a generic crosshair. `help` is the
// fallback keyword if the custom cursor image fails to load.
function inspectCursorCss(accent: string): string {
  const fill = SAFE_COLOR.test(accent) ? accent : DEFAULT_ACCENT;
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 28 28'>" +
    `<circle cx='14' cy='14' r='12' fill='${fill}' stroke='white' stroke-width='2'/>` +
    "<text x='14' y='19' font-family='Arial,sans-serif' font-size='15' font-weight='bold' " +
    "fill='white' text-anchor='middle'>?</text></svg>";
  return `body.oa-inspecting, body.oa-inspecting * {
      cursor: url("data:image/svg+xml,${encodeURIComponent(svg)}") 14 14, help !important;
    }`;
}

/** Recolors the inspect-mode cursor, e.g. to the accent a theme resolved to. */
export function setInspectCursorColor(accent: string): void {
  const css = inspectCursorCss(accent);
  if (globalSheet) {
    globalSheet.replaceSync(css);
    return;
  }
  const style = document.getElementById(GLOBAL_STYLE_ID);
  if (style) style.textContent = css;
}

// Two things that must be registered on the document rather than in the
// shadow root's own stylesheet, for two different reasons:
//  - the inspect-mode cursor has to apply to the host page itself, since a
//    shadow root's styles never reach outside its own tree;
//  - custom property registrations are document-scoped: an @property rule
//    inside a shadow root's stylesheet silently fails to register (the
//    conic-gradient animation in shadow.css then computes to `none`), even
//    though consuming the registered property via var() from inside the
//    shadow tree works fine once it's registered document-side.
function injectGlobalStyle(): void {
  if (globalSheet || document.getElementById(GLOBAL_STYLE_ID)) return;
  registerSpinAngle();
  globalSheet = adoptStyles(document, inspectCursorCss(DEFAULT_ACCENT));
}

function registerSpinAngle(): void {
  if (typeof CSS === "undefined" || !CSS.registerProperty) return;
  try {
    CSS.registerProperty({ name: "--oa-spin-angle", syntax: "<angle>", initialValue: "0deg", inherits: false });
  } catch {
    // Already registered (a previous init on this page): registrations can't be
    // undone, and the existing one is identical.
  }
}

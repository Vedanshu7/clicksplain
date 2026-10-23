// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { extractElementInfo } from "../src/context/elementInfoExtractor";
import { inspectChildren } from "../src/context/inspectChildren";

function pick(html: string, selector = "#target"): Element {
  document.body.innerHTML = html;
  return document.querySelector(selector)!;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("extractElementInfo nearby text", () => {
  it("uses a preceding label-like sibling for an element with no text of its own", () => {
    const info = extractElementInfo(pick(`<span><b>Email</b></span><div id="target"></div>`));
    expect(info.nearbyText).toBe("Email");
  });

  it("falls back to a following hint when nothing usable comes before", () => {
    const info = extractElementInfo(
      pick(`<div><button>Flush</button><div id="target" role="button"></div><span>Descale due in 12 shots</span></div>`)
    );
    expect(info.nearbyText).toBe("Descale due in 12 shots");
  });

  it("adds a neighboring hint to an element's own text", () => {
    const info = extractElementInfo(pick(`<div><button id="target">Descale</button><span>Descale due in 12 shots</span></div>`));
    expect(info.nearbyText).toBe("Descale (next to: Descale due in 12 shots)");
  });

  it("does not borrow the text of a preceding control", () => {
    const info = extractElementInfo(
      pick(`<section><button>Export report</button><form id="target"><input /></form></section>`)
    );
    expect(info.nearbyText).toBeNull();
  });

  it("takes only a sibling's own text, never a whole row of content", () => {
    const info = extractElementInfo(
      pick(`<div><span>Jane</span><span>jane@example.com</span></div><div id="target"></div>`)
    );
    expect(info.nearbyText).toBeNull();
  });

  it("never reads contenteditable text", () => {
    const info = extractElementInfo(pick(`<div id="target" contenteditable="true">my private draft</div>`));
    expect(info.nearbyText).toBeNull();
  });
});

describe("extractElementInfo roles", () => {
  it("names an input by its type, not always as a text box", () => {
    expect(extractElementInfo(pick(`<input id="target" type="range" />`)).role).toBe("slider");
    expect(extractElementInfo(pick(`<input id="target" type="checkbox" />`)).role).toBe("checkbox");
    expect(extractElementInfo(pick(`<input id="target" type="email" />`)).role).toBe("textbox");
  });
});

describe("extractElementInfo dropdowns", () => {
  it("lists a dropdown's choices", () => {
    const info = extractElementInfo(pick(`<select id="target"><option>Use it</option><option>Use and edit it</option></select>`));
    expect(info.nearbyText).toBe("Choices: Use it, Use and edit it");
  });
});

describe("extractElementInfo labels", () => {
  it("reads a wrapping label without its control's options", () => {
    const info = extractElementInfo(
      pick(`<label>Role <select id="target"><option>Admin</option><option>Member</option></select></label>`)
    );
    expect(info.ariaLabel).toBe("Role");
  });
});

describe("privacy attributes", () => {
  it("sends no page text from a redacted region, keeping developer attributes", () => {
    const info = extractElementInfo(
      pick(`<section data-clicksplain-redact><span>Balance: 12,345</span><button id="target" aria-label="Transfer">Send 500</button></section>`)
    );
    expect(info.nearbyText).toBeNull();
    expect(info.ariaLabel).toBe("Transfer");
  });

  it("leaves ignored children out of inspect_children", () => {
    const form = pick(`<form id="target"><input placeholder="Email" /><div data-clicksplain-ignore>secret</div></form>`);
    expect(inspectChildren(form).map((child) => child.tagName)).toEqual(["input"]);
  });
});

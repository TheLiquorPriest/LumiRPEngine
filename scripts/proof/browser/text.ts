// The one way text is taken from a page (PlanScenarios-2 item 10; `route/host.ts`, `Shot`, `Browser`):
// the driver's `read()` and a screen's `Shot.text` are both this function, run in the page, so the
// runner can compare a check's words with what a screen shows exactly. The rule is `host.ts`'s: the
// text as rendered for a person, elements hidden by style left out, each block of the page on a line of
// its own and every run of white space within a line as one space, in the page's order. The text of the
// elements whose boxes lie in the area read or saved:
//
// - `page`: everything not hidden by style (a check may read more than one screen shows);
// - `element`: the same, within one element (a section);
// - `window`: what shows in the browser's window, as the saved image shows it: not what lies below the
//   fold or beside it, and not text that is clipped by an element or covered by another (a word is
//   in the window only where the element at its place is its own).
//
// A control's own name is part of what a person reads on it: an input's value (its placeholder while it
// is empty), a chosen option, and the label of a control that shows no text of its own (an icon's).
//
// This function runs inside the page: it is self-contained (`TEXT_SOURCE` is its source, which the
// driver puts in the page), and reads only the page's own document.

export type TextArea = { kind: "page" } | { kind: "window" } | { kind: "element" };

/** The text of `root`'s subtree within `area`: one line per block, in the page's order. */
export function collectText(root: Element, area: TextArea): string {
  const SKIP = ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "TITLE", "META", "LINK"];
  const INLINE = ["inline", "inline-block", "inline-flex", "inline-grid", "inline-table", "contents", "ruby", "ruby-text"];
  const inWindow = area.kind === "window";
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const lines: { block: Element | null; text: string }[] = [];
  let last: Element | null = null;

  const blockOf = (el: Element | null): Element | null => {
    let at = el;
    while (at && at !== document.body && at !== document.documentElement && INLINE.includes(getComputedStyle(at).display)) at = at.parentElement;
    return at;
  };
  // An element with `display: contents` has no box of its own; what it holds is shown by the nearest that has.
  const rendered = (el: Element | null): Element | null => {
    let at = el;
    while (at && getComputedStyle(at).display === "contents") at = at.parentElement;
    return at;
  };
  const hiddenByStyle = (el: Element | null): boolean => {
    const host = rendered(el);
    return host === null || !host.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true });
  };
  // Where the element at a place on the screen is the text's own (or inside it), the text is what shows there.
  const shownAt = (rect: DOMRect, host: Element): boolean => {
    const x = Math.min(Math.max((rect.left + rect.right) / 2, 0), vw - 1);
    const y = Math.min(Math.max((rect.top + rect.bottom) / 2, 0), vh - 1);
    const top = document.elementFromPoint(x, y);
    if (top === null) return false;
    return host.contains(top) || (getComputedStyle(host).pointerEvents === "none" && top.contains(host));
  };
  const touches = (rect: DOMRect): boolean => rect.right > 0 && rect.bottom > 0 && rect.left < vw && rect.top < vh && rect.width > 0 && rect.height > 0;
  // Inside the window, to a pixel: a layout in fractions of a pixel puts a line's edge a hair past the window's.
  const inside = (rect: DOMRect): boolean => rect.left >= -1 && rect.top >= -1 && rect.right <= vw + 1 && rect.bottom <= vh + 1;
  const add = (block: Element | null, text: string): void => {
    if (block !== last || lines.length === 0) lines.push({ block, text });
    else (lines[lines.length - 1] as { text: string }).text += text;
    last = block;
  };

  // The part of a text node a window shows: all of it where every line of it is inside and uncovered, else the words that are.
  const shownText = (node: Text, host: Element): string => {
    const text = node.nodeValue ?? "";
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
    if (rects.length === 0) return "";
    if (rects.every((r) => inside(r) && shownAt(r, host))) return text;
    if (!rects.some(touches)) return "";
    const words: string[] = [];
    for (const word of text.matchAll(/\S+/g)) {
      range.setStart(node, word.index);
      range.setEnd(node, word.index + word[0].length);
      const box = Array.from(range.getClientRects()).find((r) => r.width > 0 && r.height > 0);
      if (box && inside(box) && shownAt(box, host)) words.push(word[0]);
    }
    return words.length === 0 ? "" : ` ${words.join(" ")} `;
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType !== 1) return NodeFilter.FILTER_ACCEPT;
      const el = node as Element;
      if (SKIP.includes(el.tagName)) return NodeFilter.FILTER_REJECT;
      const style = getComputedStyle(el);
      return style.display === "none" || style.contentVisibility === "hidden" ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.nodeType === 3) {
      const text = node as Text;
      const parent = text.parentElement;
      if (parent === null || (text.nodeValue ?? "").length === 0) continue;
      const block = blockOf(parent);
      if (text.nodeValue?.trim() === "") {
        // White space between inline things keeps them apart; it shows nothing of its own.
        add(block, " ");
        continue;
      }
      if (hiddenByStyle(parent)) continue;
      const shown = inWindow ? shownText(text, rendered(parent) ?? parent) : (text.nodeValue ?? "");
      if (shown !== "") add(block, shown);
      continue;
    }
    const el = node as Element;
    if (el.tagName === "BR") {
      last = null;
      continue;
    }
    // A control's own words: what an input holds, what a menu has chosen, what an icon is called.
    let own = "";
    if (el.tagName === "INPUT") {
      const input = el as HTMLInputElement;
      if (!["hidden", "checkbox", "radio", "password", "range", "file"].includes(input.type)) own = input.value !== "" ? input.value : input.placeholder;
      else if (input.type === "button" || input.type === "submit" || input.type === "reset") own = input.value;
    } else if (el.tagName === "TEXTAREA") {
      const area = el as HTMLTextAreaElement;
      own = area.value !== "" ? area.value : area.placeholder;
    } else if (el.tagName === "SELECT") {
      const select = el as HTMLSelectElement;
      own = select.selectedOptions[0]?.textContent ?? "";
    } else if (el.hasAttribute("aria-label") && (el.textContent ?? "").trim() === "" && el.querySelector("input, textarea, select") === null) {
      own = el.getAttribute("aria-label") ?? "";
    }
    if (own.trim() === "" || hiddenByStyle(el)) continue;
    if (inWindow) {
      const rect = el.getBoundingClientRect();
      if (!(inside(rect) && rect.width > 0 && rect.height > 0 && shownAt(rect, el))) continue;
    }
    add(blockOf(el.parentElement), ` ${own} `);
  }
  return lines
    .map((line) => line.text.replace(/\s+/g, " ").trim())
    .filter((line) => line !== "")
    .join("\n");
}

/** The function's source, which the driver puts in every page it opens. */
export const TEXT_SOURCE: string = collectText.toString();

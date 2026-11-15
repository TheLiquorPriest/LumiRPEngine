// What the driver puts in every page it opens (PlanScenarios-2 item 2): a small library at
// `window.__proof` that finds a control the way a person does (by the words on it or beside it, or by
// what it is), brings a thing into the window, scrolls, waits on what shows, and reads text by the one
// function of `text.ts`. It answers `{ ok: false, error }` for what is not there, with the words the
// form is stopped by, rather than throwing, so what the form named is what its stop says.
//
// It runs inside the page: it is self-contained but for the one function that takes text, which
// `installProof` is given.

import { TEXT_SOURCE, type TextArea } from "./text";

/** A control as a person finds it: by the words on it or beside it, or by what it is. */
export interface WantedControl {
  label?: string;
  role?: string;
}

export type Answer<T> = { ok: true; value: T } | { ok: false; error: string };

/** Where a control is, in the window, for a click or a keystroke. */
export interface Found {
  x: number;
  y: number;
  tag: string;
  role: string;
  name: string;
}

/** What a wait or a bringing into view is for. */
export type Wanted = { text: string } | { control: WantedControl };

/** The library, as the page holds it. */
export interface ProofLib {
  text(area: TextArea["kind"]): string;
  section(name: string): Answer<string>;
  find(control: WantedControl): Answer<Found>;
  focus(control: WantedControl): Answer<string>;
  choose(control: WantedControl, option: string): Answer<string>;
  waitFor(wanted: Wanted, limitMs: number): Promise<Answer<true>>;
  show(wanted: Wanted, limitMs: number): Promise<Answer<true>>;
  scroll(within: WantedControl | null): Promise<Answer<true>>;
  settle(): Promise<void>;
  size(): { width: number; height: number };
}

/** Installs the library in the page it runs in. */
export function installProof(collect: (root: Element, area: TextArea) => string): void {
  const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
  const one = (s: string): string => norm(s).toLowerCase();
  const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
  const nameOfWanted = (w: Wanted): string => ("text" in w ? w.text : (w.control.label ?? w.control.role ?? "a control"));
  const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const shown = (el: Element): boolean => el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true });

  const settle = async (): Promise<void> => {
    await document.fonts.ready;
    let before = "";
    for (let i = 0; i < 30; i++) {
      await frame();
      const now = `${window.scrollX},${window.scrollY},${Array.from(document.querySelectorAll("*"))
        .filter((e) => e.scrollTop > 0 || e.scrollLeft > 0)
        .map((e) => `${e.scrollTop}:${e.scrollLeft}`)
        .join(";")}`;
      if (now === before) return;
      before = now;
    }
  };

  const roleOf = (el: Element): string => {
    const explicit = el.getAttribute("role");
    if (explicit !== null && explicit.trim() !== "") return explicit.trim().split(/\s+/)[0] ?? "";
    switch (el.tagName) {
      case "A":
        return el.hasAttribute("href") ? "link" : "";
      case "BUTTON":
      case "SUMMARY":
        return "button";
      case "INPUT": {
        const type = (el as HTMLInputElement).type;
        if (type === "checkbox" || type === "radio") return type;
        if (type === "button" || type === "submit" || type === "reset" || type === "image") return "button";
        if (type === "range") return "slider";
        if (type === "number") return "spinbutton";
        return type === "hidden" ? "" : "textbox";
      }
      case "TEXTAREA":
        return "textbox";
      case "SELECT":
        return "combobox";
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6":
        return "heading";
      case "UL":
      case "OL":
        return "list";
      case "LI":
        return "listitem";
      case "TABLE":
        return "table";
      case "IMG":
        return "img";
      case "NAV":
        return "navigation";
      case "MAIN":
        return "main";
      case "DIALOG":
        return "dialog";
      case "OPTION":
        return "option";
      case "SECTION":
        return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "region" : "";
      default:
        return "";
    }
  };

  // The words a person finds a control by: its label, what points at it, what it says, what it holds.
  const nameOf = (el: Element): string => {
    const labelled = el.getAttribute("aria-labelledby");
    if (labelled !== null) {
      const text = labelled
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter((e): e is HTMLElement => e !== null)
        .map((e) => collect(e, { kind: "page" }))
        .join(" ");
      if (norm(text) !== "") return norm(text);
    }
    const aria = el.getAttribute("aria-label");
    if (aria !== null && norm(aria) !== "") return norm(aria);
    const labels = "labels" in el ? Array.from((el as HTMLInputElement).labels ?? []) : [];
    const beside = labels.map((l) => collect(l, { kind: "page" })).join(" ");
    if (norm(beside) !== "") return norm(beside);
    if (el.tagName === "INPUT") {
      const input = el as HTMLInputElement;
      if (["button", "submit", "reset"].includes(input.type) && input.value !== "") return norm(input.value);
      if (input.placeholder !== "") return norm(input.placeholder);
    }
    if (el.tagName === "TEXTAREA" && (el as HTMLTextAreaElement).placeholder !== "") return norm((el as HTMLTextAreaElement).placeholder);
    if (el.tagName === "IMG") return norm(el.getAttribute("alt") ?? "");
    const own = norm(collect(el, { kind: "page" }).replace(/\n/g, " "));
    if (own !== "") return own;
    return norm(el.getAttribute("title") ?? "");
  };

  const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role], [tabindex], [contenteditable=""], [contenteditable="true"]';
  const describe = (el: Element): string => `${roleOf(el) || el.tagName.toLowerCase()} "${nameOf(el).slice(0, 60)}"`;

  /** The one element a control names among the elements `selector` picks, or why none. */
  const search = (control: WantedControl, selector: string): Answer<Element> => {
    const wantRole = control.role?.toLowerCase();
    const wantLabel = control.label === undefined ? undefined : one(control.label);
    const every = Array.from(document.querySelectorAll(selector)).filter((el) => shown(el) && (wantRole === undefined || roleOf(el) === wantRole));
    const what = control.label !== undefined ? `labelled ${control.label}${control.role ? ` (a ${control.role})` : ""}` : `of role ${control.role ?? ""}`;
    if (wantLabel === undefined) return every.length === 1 ? { ok: true, value: every[0] as Element } : every.length === 0 ? fail(`no control ${what}`) : fail(`${every.length} controls ${what}: say which`);
    const named = every.map((el) => ({ el, name: one(nameOf(el)) }));
    const exact = named.filter((n) => n.name === wantLabel);
    const pool = exact.length > 0 ? exact : named.filter((n) => n.name !== "" && n.name.includes(wantLabel));
    if (pool.length === 1) return { ok: true, value: (pool[0] as { el: Element }).el };
    if (pool.length === 0) return fail(`no control ${what}`);
    // Several that are one thing (a label and the input it labels) are that one.
    const inner = pool.filter((a) => !pool.some((b) => b.el !== a.el && a.el.contains(b.el)));
    if (inner.length === 1) return { ok: true, value: (inner[0] as { el: Element }).el };
    return fail(`${pool.length} controls ${what}: ${pool.slice(0, 4).map((n) => describe(n.el)).join(", ")}: say which`);
  };

  /** The one element a control names: among the things a person presses or types in first, then among any (a list or a panel, which a form may bring into view or scroll). `any` goes to those at once. */
  const locate = (control: WantedControl, any = false): Answer<Element> => {
    if (any || control.role !== undefined) return search(control, "*");
    const first = search(control, INTERACTIVE);
    return first.ok ? first : search(control, "*").ok ? search(control, "*") : first;
  };

  const tidy = (text: string): string => norm(text.replace(/\n/g, " "));

  /** The smallest element whose words hold `text`, hidden things left out. */
  const place = (text: string): Element | null => {
    const want = norm(text);
    if (want === "") return null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = (node as Text).parentElement;
      if (parent !== null && shown(parent) && norm((node as Text).nodeValue ?? "").includes(want)) return parent;
    }
    const all = Array.from(document.body.querySelectorAll("*")).filter((el) => shown(el) && tidy(collect(el, { kind: "page" })).includes(want));
    return all.filter((el) => !all.some((other) => other !== el && el.contains(other))).at(0) ?? null;
  };

  const present = (wanted: Wanted): boolean => ("text" in wanted ? tidy(collect(document.body, { kind: "page" })).includes(norm(wanted.text)) : locate(wanted.control).ok);

  const lib: ProofLib = {
    text: (area) => collect(document.body, { kind: area }),
    section(name) {
      const want = one(name);
      const containers = "section, [role=region], dialog, [role=dialog], details, fieldset, article, aside, nav, main, form, [role=list], ul, ol, table";
      const byLabel = Array.from(document.querySelectorAll("[aria-label]")).find((el) => shown(el) && one(el.getAttribute("aria-label") ?? "") === want);
      if (byLabel) return { ok: true, value: collect(byLabel, { kind: "page" }) };
      const heads = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading], legend, summary, caption")).filter((h) => shown(h) && one(collect(h, { kind: "page" })) === want);
      const head = heads[0];
      if (!head) return fail(`no section named ${name}`);
      const box = head.closest(containers) ?? head.parentElement;
      return { ok: true, value: collect(box ?? head, { kind: "page" }) };
    },
    find(control) {
      const found = locate(control);
      if (!found.ok) return found;
      const el = found.value;
      if ((el as HTMLButtonElement).disabled === true) return fail(`${describe(el)} is disabled`);
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      const rect = el.getBoundingClientRect();
      const x = Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1);
      const y = Math.min(Math.max(rect.top + rect.height / 2, 1), window.innerHeight - 1);
      const top = document.elementFromPoint(x, y);
      if (top === null || !(el.contains(top) || top.contains(el))) return fail(`${describe(el)} is covered by ${top ? describe(top) : "nothing"} where it would be pressed`);
      return { ok: true, value: { x, y, tag: el.tagName.toLowerCase(), role: roleOf(el), name: nameOf(el) } };
    },
    focus(control) {
      const found = locate(control);
      if (!found.ok) return found;
      const el = found.value as HTMLElement;
      el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
      el.focus();
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") (el as HTMLInputElement).select();
      else if (el.isContentEditable) document.getSelection()?.selectAllChildren(el);
      else return fail(`${describe(el)} takes no typing`);
      return { ok: true, value: el.tagName.toLowerCase() };
    },
    choose(control, option) {
      const found = locate(control);
      if (!found.ok) return found;
      if (found.value.tagName !== "SELECT") return fail(`${describe(found.value)} is not a menu`);
      const select = found.value as HTMLSelectElement;
      const index = Array.from(select.options).findIndex((o) => one(o.textContent ?? "") === one(option));
      if (index < 0) return fail(`${describe(select)} has no option ${option}`);
      select.selectedIndex = index;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, value: option };
    },
    async waitFor(wanted, limitMs) {
      const start = performance.now();
      for (;;) {
        if (present(wanted)) return { ok: true, value: true };
        if (performance.now() - start > limitMs) return fail(`never showed: ${nameOfWanted(wanted)}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
    async show(wanted, limitMs) {
      const waited = await lib.waitFor(wanted, limitMs);
      if (!waited.ok) return waited;
      const el = "text" in wanted ? place(wanted.text) : (() => {
        const found = locate(wanted.control);
        return found.ok ? found.value : null;
      })();
      if (el === null) return fail(`never showed: ${nameOfWanted(wanted)}`);
      const inWindow = (): boolean => {
        if ("text" in wanted) return tidy(collect(document.body, { kind: "window" })).includes(norm(wanted.text));
        const rect = el.getBoundingClientRect();
        return rect.top >= -1 && rect.left >= -1 && rect.bottom <= window.innerHeight + 1 && rect.right <= window.innerWidth + 1 && rect.width > 0 && rect.height > 0;
      };
      for (const block of ["center", "start", "end"] as const) {
        el.scrollIntoView({ block, inline: "nearest", behavior: "instant" });
        await settle();
        if (inWindow()) return { ok: true, value: true };
      }
      return fail(`${nameOfWanted(wanted)} could not be brought into the window`);
    },
    async scroll(within) {
      const name = within === null ? "the page" : (within.label ?? within.role ?? "a panel");
      let el: Element;
      if (within === null) el = document.scrollingElement ?? document.documentElement;
      else {
        const found = locate(within, true);
        if (!found.ok) return found;
        el = found.value;
      }
      const before = el.scrollTop;
      if (el.scrollHeight <= el.clientHeight + 1) return fail(`${name} does not scroll: it holds nothing beyond the window`);
      el.scrollBy({ top: el.clientHeight, behavior: "instant" });
      await settle();
      if (el.scrollTop === before) return fail(`${name} does not scroll further: it is at its end`);
      return { ok: true, value: true };
    },
    settle,
    size: () => ({ width: window.innerWidth, height: window.innerHeight }),
  };
  (window as unknown as { __proof: ProofLib }).__proof = lib;
}

/** The script a page is given before its own: the library, made with the one function that takes text. */
export const PAGE_SCRIPT: string = `(${installProof.toString()})(${TEXT_SOURCE});`;

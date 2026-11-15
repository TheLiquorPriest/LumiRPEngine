// A model's answer as the page shows it (GM → Assistant): a small Markdown reader for a safe subset,
// built as Preact elements, so every character of the text reaches the page as text and none as
// markup. It reads paragraphs (a line break kept as written), headings (one modest style, whatever
// their level), lists (bulleted, or numbered from their first number), fenced code (its text kept
// exactly), quotes, bold, italics and inline code. A link shows as its words with its address after
// them, never as a link; an image as its description, never loaded; HTML stays the text it is; and
// anything else (a table, a rule) stays as written.

import type { ComponentChildren, VNode } from "preact";

/** One block of a text: a paragraph's lines, a heading, a list's items, fenced code, or a quote's own blocks. */
export type MarkdownBlock =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; start: number; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "quote"; blocks: MarkdownBlock[] };

/** A heading: one to six #s, then its words (a closing run of #s isn't theirs). */
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
/** A code fence opening: three or more backticks (none after them) or tildes, after its indent. */
const FENCE = /^( {0,3})(`{3,}(?=[^`]*$)|~{3,})/;
/** A fence that may close one: its mark alone on its line. */
const CLOSING = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
/** A quote's line: its mark, and one space after it, taken off. */
const QUOTED = /^ {0,3}> ?(.*)$/;
/** How deep quotes nest before a deeper one goes as a paragraph. */
const QUOTE_DEPTH = 8;
/** A bulleted item, however far it is indented (a nested list's items join the list they're in). */
const BULLET = /^\s*[-*+][ \t]+(.*)$/;
/** A numbered item. */
const NUMBERED = /^\s*(\d{1,9})[.)][ \t]+(.*)$/;
/** A line indented under a list item, which carries it on. */
const CARRIED = /^(?: {2,}|\t)\S/;

/**
 * `text`'s blocks: a blank line ends one. Fenced code runs to the fence that closes it (the same
 * mark, as long or longer) or to the end, each line as written but for the fence's own indent; a
 * quote's lines are read as blocks of their own; a heading stands alone; a list's lines are its
 * items, an indented line carrying on the item before it.
 */
export function markdownBlocks(text: string, depth = 0): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let current: MarkdownBlock | null = null;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let at = 0; at < lines.length; at += 1) {
    const raw = lines[at] ?? "";
    const fence = FENCE.exec(raw);
    if (fence) {
      const indent = new RegExp(`^ {0,${fence[1]?.length ?? 0}}`);
      const mark = fence[2] ?? "```";
      const body: string[] = [];
      for (at += 1; at < lines.length; at += 1) {
        const close = CLOSING.exec(lines[at] ?? "")?.[1];
        if (close !== undefined && close[0] === mark[0] && close.length >= mark.length) break;
        body.push((lines[at] ?? "").replace(indent, ""));
      }
      blocks.push({ kind: "code", text: body.join("\n") });
      current = null;
      continue;
    }
    const line = raw.trimEnd();
    if (line.trim() === "") {
      current = null;
      continue;
    }
    const quoted = depth < QUOTE_DEPTH ? QUOTED.exec(line) : null;
    if (quoted) {
      const inner = [quoted[1] ?? ""];
      while (at + 1 < lines.length) {
        const more = QUOTED.exec((lines[at + 1] ?? "").trimEnd());
        if (!more) break;
        inner.push(more[1] ?? "");
        at += 1;
      }
      blocks.push({ kind: "quote", blocks: markdownBlocks(inner.join("\n"), depth + 1) });
      current = null;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const words = (heading[2] ?? "").trim();
      if (words !== "") blocks.push({ kind: "h", level: heading[1]?.length ?? 1, text: words });
      current = null;
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet) {
      if (current?.kind !== "ul") blocks.push((current = { kind: "ul", items: [] }));
      current.items.push(bullet[1] ?? "");
    } else if (numbered) {
      if (current?.kind !== "ol") blocks.push((current = { kind: "ol", start: Number(numbered[1]), items: [] }));
      current.items.push(numbered[2] ?? "");
    } else if (current !== null && (current.kind === "ul" || current.kind === "ol") && CARRIED.test(line)) {
      const last = current.items.length - 1;
      current.items[last] = `${current.items[last] ?? ""}\n${line.trim()}`;
    } else {
      if (current?.kind !== "p") blocks.push((current = { kind: "p", lines: [] }));
      current.lines.push(line);
    }
  }
  return blocks;
}

/** The marks a backslash keeps as themselves. */
const ESCAPABLE = "\\`*_[]()#+-.!<>{}|~";
/**
 * Each escaped mark stands in as a Unicode noncharacter (never in text that is sent or kept) while
 * the text is read, so no reading takes it for a mark; it is put back as the mark in text, and with
 * its backslash in code, where a backslash escapes nothing.
 */
const SHIELD = 0xfdd0;
const ESCAPED = /\\([\\`*_[\]()#+\-.!<>{}|~])/g;
const SHIELDED = /[\uFDD0-\uFDEF]/g;

function shielded(text: string): string {
  return text.replace(ESCAPED, (_whole, mark: string) => String.fromCharCode(SHIELD + ESCAPABLE.indexOf(mark)));
}

function unshielded(text: string, code: boolean): string {
  return text.replace(SHIELDED, (c) => `${code ? "\\" : ""}${ESCAPABLE[c.charCodeAt(0) - SHIELD] ?? ""}`);
}

// Each read where the text has reached (sticky), so no text is copied to try one.
const STRONG_STAR = /\*\*(?=\S)([\s\S]*?\S)\*\*/y;
const STRONG_UNDER = /__(?=\S)([\s\S]*?\S)__(?![\p{L}\p{N}])/uy;
const EM_STAR = /\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)/y;
const EM_UNDER = /_(?=[^\s_])([^_]*?[^\s_])_(?![\p{L}\p{N}_])/uy;
const IMAGE = /!\[([^\]]*)\]\(([^)]*)\)/y;
const LINK = /\[([^\]]+)\]\(\s*([^)\s]*)(?:\s+"[^"]*")?\s*\)/y;
const WORD = /[\p{L}\p{N}]/u;
/** How deep emphasis nests before the rest goes as text. */
const DEPTH = 4;

/** `pattern` read at `at` in `text`, or null. */
function readAt(pattern: RegExp, text: string, at: number): RegExpExecArray | null {
  pattern.lastIndex = at;
  return pattern.exec(text);
}

/** One paragraph's or item's text as inline elements: bold, italics and inline code, a link as its words and address, an image as its description, the rest as text. */
export function inlineMarkdown(text: string): ComponentChildren[] {
  return inline(shielded(text), 0);
}

function inline(text: string, depth: number): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  let plain = "";
  const flush = (): void => {
    if (plain !== "") out.push(unshielded(plain, false));
    plain = "";
  };
  const inner = (s: string): ComponentChildren[] => (depth < DEPTH ? inline(s, depth + 1) : [unshielded(s, false)]);
  let i = 0;
  while (i < text.length) {
    const c = text[i] ?? "";
    if (c === "`") {
      let run = 1;
      while (text[i + run] === "`") run += 1;
      const fence = "`".repeat(run);
      const end = text.indexOf(fence, i + run);
      if (end < 0) {
        plain += fence;
        i += run;
        continue;
      }
      const code = text.slice(i + run, end);
      flush();
      out.push(<code>{unshielded(code.length > 2 && code.startsWith(" ") && code.endsWith(" ") ? code.slice(1, -1) : code, true)}</code>);
      i = end + run;
      continue;
    }
    // An underscore inside a word (snake_case) is the word's own.
    const flanked = c === "*" || (c === "_" && !WORD.test(text[i - 1] ?? ""));
    const strong = flanked ? readAt(c === "*" ? STRONG_STAR : STRONG_UNDER, text, i) : null;
    if (strong) {
      flush();
      out.push(<strong>{inner(strong[1] ?? "")}</strong>);
      i += strong[0].length;
      continue;
    }
    const em = flanked ? readAt(c === "*" ? EM_STAR : EM_UNDER, text, i) : null;
    if (em) {
      flush();
      out.push(<em>{inner(em[1] ?? "")}</em>);
      i += em[0].length;
      continue;
    }
    const image = c === "!" ? readAt(IMAGE, text, i) : null;
    if (image) {
      plain += image[1] ?? "";
      i += image[0].length;
      continue;
    }
    const link = c === "[" ? readAt(LINK, text, i) : null;
    if (link) {
      const words = link[1] ?? "";
      const address = link[2] ?? "";
      flush();
      out.push(...inner(words));
      if (address !== "" && address !== words) plain += ` (${address})`;
      i += link[0].length;
      continue;
    }
    plain += c;
    i += 1;
  }
  flush();
  return out;
}

/** Blocks as elements: a heading as one modest style whatever its level (its level kept for assistive tech), fenced code as written, a quote's blocks inside it. */
function blocksView(blocks: readonly MarkdownBlock[]): VNode[] {
  return blocks.map((b, at) => {
    switch (b.kind) {
      case "p":
        return <p key={at}>{inlineMarkdown(b.lines.join("\n"))}</p>;
      case "h":
        return (
          <p key={at} class="lre-md-h" role="heading" aria-level={b.level}>
            {inlineMarkdown(b.text)}
          </p>
        );
      case "ul":
        return (
          <ul key={at}>
            {b.items.map((item, n) => (
              <li key={n}>{inlineMarkdown(item)}</li>
            ))}
          </ul>
        );
      case "ol":
        return (
          <ol key={at} {...(b.start !== 1 ? { start: b.start } : {})}>
            {b.items.map((item, n) => (
              <li key={n}>{inlineMarkdown(item)}</li>
            ))}
          </ol>
        );
      case "code":
        return (
          <pre key={at}>
            <code>{b.text}</code>
          </pre>
        );
      case "quote":
        return <blockquote key={at}>{blocksView(b.blocks)}</blockquote>;
    }
  });
}

/** `text` read as Markdown's safe subset (see the header), in one element with `className`. */
export function markdown(text: string, className: string): VNode {
  return <div class={`lre-md ${className}`}>{blocksView(markdownBlocks(text))}</div>;
}

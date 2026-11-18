// A model's answer as the page shows it (GM → Assistant): a small Markdown reader for a safe subset,
// built as Preact elements, so every character of the text reaches the page as text and none as
// markup. It reads paragraphs (a line break kept as written), headings (one modest style, whatever
// their level), lists (bulleted, or numbered from their first number), fenced code (its text kept
// exactly), quotes, pipe tables, horizontal rules, bold, italics and inline code. A table is a header
// row, a separator row of dashes (a colon either side of them aligns the column) and the rows after
// it, each line's leading and trailing pipe optional, a cell read for bold, italics and inline code,
// `\|` a pipe in a cell; a row short of the header is padded, a longer one keeps its cells, and the
// table scrolls sideways inside its own box, never widening the page. A rule is `---`, `***` or `___`
// alone on a line (spaces between its marks allowed) where it is not a table's separator; a line
// underlined with dashes or equal signs is not read as a heading (dashes there are a rule, equal
// signs text). A link shows as its words with its address after them, never as a link; an image as
// its description, never loaded; HTML stays the text it is; and anything else stays as written.

import type { ComponentChildren, VNode } from "preact";

/** A table column's alignment (null: none written, the page's own). */
export type TableAlign = "left" | "center" | "right" | null;

/** One block of a text: a paragraph's lines, a heading, a list's items, fenced code, a quote's own blocks, a table (each row as many cells as the header, or more), or a rule. */
export type MarkdownBlock =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; start: number; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "quote"; blocks: MarkdownBlock[] }
  | { kind: "table"; align: TableAlign[]; head: string[]; rows: string[][] }
  | { kind: "rule" };

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
/** A rule: three or more of one of - * _ (spaces between them allowed), alone on its line. */
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** The lines that open a block of their own where a table's row could be, so end its rows (a quote's too, below its depth). */
const OPENERS = [FENCE, HEADING, RULE, BULLET, NUMBERED];
/** A table separator's cell: dashes, with a colon before or after them to align the column. */
const SEPARATOR_CELL = /^(:)?-+(:)?$/;

/** A table row's cells (its leading and trailing pipe taken off, an escaped pipe a pipe in its cell, each cell trimmed), and whether it had a pipe of its own. */
function splitRow(line: string): { cells: string[]; piped: boolean } {
  const text = line.trim();
  const cells: string[] = [];
  let cell = "";
  let piped = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] ?? "";
    const next = text[i + 1];
    if (c === "\\" && next !== undefined) {
      cell += next === "|" ? "|" : c + next;
      i += 1;
    } else if (c === "|") {
      piped = true;
      cells.push(cell);
      cell = "";
    } else {
      cell += c;
    }
  }
  cells.push(cell);
  if (text.startsWith("|")) cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
  return { cells: cells.map((s) => s.trim()), piped };
}

/** A separator row's column alignments, or null where `line` is none. */
function separatorRow(line: string): TableAlign[] | null {
  const { cells, piped } = splitRow(line);
  if (!piped || cells.length === 0) return null;
  const align: TableAlign[] = [];
  for (const cell of cells) {
    const found = SEPARATOR_CELL.exec(cell);
    if (!found) return null;
    align.push(found[1] ? (found[2] ? "center" : "left") : found[2] ? "right" : null);
  }
  return align;
}

/**
 * The table whose header row is `lines[at]` and the line it ends on, or null where the line after the
 * header is no separator row of the header's cell count. Its rows run while a line has a pipe of its
 * own and opens no other block; a short row is padded to the header's cells, a long one keeps its own.
 */
function readTable(lines: readonly string[], at: number, depth: number): { block: MarkdownBlock; last: number } | null {
  const head = splitRow(lines[at] ?? "");
  const align = head.piped ? separatorRow(lines[at + 1] ?? "") : null;
  if (align === null || align.length !== head.cells.length) return null;
  const rows: string[][] = [];
  let last = at + 1;
  for (; last + 1 < lines.length; last += 1) {
    const line = (lines[last + 1] ?? "").trimEnd();
    const row = splitRow(line);
    if (!row.piped || OPENERS.some((p) => p.test(line)) || (depth < QUOTE_DEPTH && QUOTED.test(line))) break;
    while (row.cells.length < head.cells.length) row.cells.push("");
    rows.push(row.cells);
  }
  return { block: { kind: "table", align, head: head.cells, rows }, last };
}

/**
 * `text`'s blocks: a blank line ends one. Fenced code runs to the fence that closes it (the same
 * mark, as long or longer) or to the end, each line as written but for the fence's own indent; a
 * quote's lines are read as blocks of their own; a heading and a rule stand alone; a table is a
 * header row, its separator row and the rows after (it may follow a paragraph's line directly); a
 * list's lines are its items, an indented line carrying on the item before it.
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
    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
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
      const table = readTable(lines, at, depth);
      if (table) {
        blocks.push(table.block);
        current = null;
        at = table.last;
      } else {
        if (current?.kind !== "p") blocks.push((current = { kind: "p", lines: [] }));
        current.lines.push(line);
      }
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

/** Blocks as elements: a heading as one modest style whatever its level (its level kept for assistive tech), fenced code as written, a quote's blocks inside it, a table in a box of its own that scrolls sideways, a rule as a rule. */
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
      case "table": {
        const columns = Array.from({ length: b.rows.reduce((most, row) => Math.max(most, row.length), b.head.length) }, (_, n) => n);
        const aligned = columns.map((n) => (b.align[n] ? { "data-align": b.align[n] } : {}));
        return (
          <div key={at} class="lre-md-table">
            <table>
              <thead>
                <tr>
                  {columns.map((n) => (
                    <th key={n} scope="col" {...aligned[n]}>
                      {inlineMarkdown(b.head[n] ?? "")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, r) => (
                  <tr key={r}>
                    {columns.map((n) => (
                      <td key={n} {...aligned[n]}>
                        {inlineMarkdown(row[n] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      case "rule":
        return <hr key={at} />;
    }
  });
}

/** `text` read as Markdown's safe subset (see the header), in one element with `className`. */
export function markdown(text: string, className: string): VNode {
  return <div class={`lre-md ${className}`}>{blocksView(markdownBlocks(text))}</div>;
}

/** Text an agent wrote for the person (a job's report, a delegate's or a job's answer, an intent record, a note), drawn as the Markdown it is, as a model's reply is. */
export function Written(props: { text: string }) {
  return markdown(props.text, "rpe-written-text");
}

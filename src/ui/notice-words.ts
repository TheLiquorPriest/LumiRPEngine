// The words of RPE's notices file (`.prompts/notices.md`) as a page shows a notice of a turn: the file in
// force for the chat is read once, and a notice's line is filled from the fields its event carries. The
// page keeps no words of its own for a notice; a line the file does not hold (deleted) is not shown in
// words, and the event is drawn as it came. The file's template syntax is the guidance files' own: a
// field `{{name}}`, a block shown when a field is present `{{#name}}…{{/name}}`, one shown when it is
// absent `{{^name}}…{{/name}}`, and `{{.}}` for a block's item.

import { useEffect, useState } from "preact/hooks";
import { useApp } from "./app";
import { replyOf } from "./client";
import type { PromptNotice } from "../shared/api";

/** The file's lines by name, each a template. */
export type NoticeLines = ReadonlyMap<string, string>;

export const NO_NOTICES: NoticeLines = new Map();

/** The tree's path of the file. */
export const NOTICES_FILE = ".prompts/notices.md";

const LINE = /^([A-Za-z0-9_-]+):[ \t]?(.*)$/;

/** The lines of a file whose header says `format: lines`: each `name: text`, the first of a name the one used. */
export function parseNoticeLines(file: string): NoticeLines {
  const text = (file.startsWith("\uFEFF") ? file.slice(1) : file).replace(/\r\n?/g, "\n");
  let body = text;
  if (/^---[ \t]*\n/.test(text)) {
    const close = /\n---[ \t]*(?:\n|$)/.exec(text.slice(3));
    body = close === null ? "" : text.slice(3 + close.index + close[0].length);
  }
  const lines = new Map<string, string>();
  for (const line of body.split("\n")) {
    const found = LINE.exec(line);
    if (found !== null && !lines.has(found[1] as string)) lines.set(found[1] as string, (found[2] as string).trimEnd());
  }
  return lines;
}

type Node = { text: string } | { field: string } | { block: string; inverted: boolean; children: Node[] };

function parse(template: string): Node[] {
  const root: Node[] = [];
  const open: { block: string; children: Node[] }[] = [];
  const at = (): Node[] => open.at(-1)?.children ?? root;
  let last = 0;
  for (const tag of template.matchAll(/\{\{(.*?)\}\}/g)) {
    const inner = (tag[1] ?? "").trim();
    const before = template.slice(last, tag.index);
    if (before !== "") at().push({ text: before });
    last = (tag.index ?? 0) + tag[0].length;
    const sigil = inner[0];
    const name = sigil === "#" || sigil === "^" || sigil === "/" ? inner.slice(1).trim() : inner;
    if (sigil === "#" || sigil === "^") {
      const children: Node[] = [];
      at().push({ block: name, inverted: sigil === "^", children });
      open.push({ block: name, children });
    } else if (sigil === "/") open.pop();
    else at().push({ field: name });
  }
  if (last < template.length) at().push({ text: template.slice(last) });
  return root;
}

function lookup(path: string, contexts: readonly unknown[]): unknown {
  if (path === ".") return contexts.at(-1);
  const [head = "", ...rest] = path.split(".");
  for (let i = contexts.length - 1; i >= 0; i--) {
    const context = contexts[i];
    if (typeof context !== "object" || context === null || !Object.hasOwn(context, head)) continue;
    let value: unknown = (context as Record<string, unknown>)[head];
    for (const name of rest) value = typeof value === "object" && value !== null ? (value as Record<string, unknown>)[name] : undefined;
    return value;
  }
  return undefined;
}

const absent = (value: unknown): boolean => value === undefined || value === null || value === false || value === "" || value === 0 || (Array.isArray(value) && value.length === 0);

function written(value: unknown): string {
  if (Array.isArray(value)) return value.map(written).filter((s) => s !== "").join(", ");
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : "";
}

function render(nodes: readonly Node[], contexts: readonly unknown[]): string {
  return nodes
    .map((node) => {
      if ("text" in node) return node.text;
      if ("field" in node) return written(lookup(node.field, contexts));
      const value = lookup(node.block, contexts);
      if (node.inverted) return absent(value) ? render(node.children, contexts) : "";
      if (absent(value)) return "";
      return (Array.isArray(value) ? value : [value]).map((item) => render(node.children, [...contexts, item])).join("");
    })
    .join("");
}

/** A notice's line filled from `fields`; undefined when the file holds no line of that name, which is a notice not shown in words. */
export function noticeLine(lines: NoticeLines, name: string, fields: Readonly<Record<string, unknown>>): string | undefined {
  const template = lines.get(name);
  return template === undefined ? undefined : render(parse(template), [fields]);
}

/** The notices file in force for a chat, read once when the page opens it; none where it cannot be read. */
export function useNoticeLines(chat: string): NoticeLines {
  const app = useApp();
  const [lines, setLines] = useState<NoticeLines>(NO_NOTICES);
  useEffect(() => {
    setLines(NO_NOTICES);
    let alive = true;
    app.client.call("GET /api/v1/files/*", { "*": NOTICES_FILE }, { query: { chat } }).then(
      (answer) => {
        if (alive) setLines(parseNoticeLines(replyOf(answer).text));
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [chat]);
  return lines;
}

/**
 * A notice of the prompt's shape in the notices file's words (`notice_<kind>`); where the file holds no line for it, the notice
 * drawn as it came.
 */
export function promptNoticeWords(lines: NoticeLines, notice: PromptNotice): string {
  const fields: Record<string, unknown> = notice.kind === "unclaimed" ? { message: notice.message, length: notice.end - notice.start } : { ...notice };
  return noticeLine(lines, `notice_${notice.kind}`, fields) ?? `${notice.kind}: ${JSON.stringify(notice)}`;
}

/** What Lumiverse's own clipping left out of RPE's window, in the notices file's words (`cut_clipped_<reason>`); the facts as they came where the file holds no line. */
export function clippedWords(lines: NoticeLines, clipped: { count: number; by: string | null }): string {
  const reason = clipped.by === null ? null : clipped.by.replaceAll("-", "_");
  return (reason === null ? null : noticeLine(lines, `cut_clipped_${reason}`, { count: clipped.count })) ?? `${clipped.count} of the window's messages were left out${reason === null ? "" : `: ${reason}`}`;
}

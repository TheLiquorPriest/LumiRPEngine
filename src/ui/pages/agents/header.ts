// A definition's file made again from what the form sets (plan §5.4, §14 Agents): its header's `name: value` lines are set, added or taken out, every
// other line of the header (comments, fields the form does not hold, a field written over several lines) stays as it was, and its text is replaced
// where the page edited it. The header is the file's front matter, between its two `---` lines.

const OPEN = /^---[ \t]*\n/;
const CLOSE = /(^|\n)---[ \t]*(\n|$)/;
const FIELD = /^([A-Za-z][A-Za-z0-9_-]*):/;

/** A file split into the lines of its header and its text; a file with no header has none, and its text is all of it. */
export function splitFile(text: string): { header: string[]; body: string; hasHeader: boolean } {
  const source = (text.startsWith("\uFEFF") ? text.slice(1) : text).replace(/\r\n?/g, "\n");
  const open = OPEN.exec(source);
  if (open === null) return { header: [], body: source, hasHeader: false };
  const rest = source.slice(open[0].length);
  const close = CLOSE.exec(rest);
  if (close === null) return { header: [], body: source, hasHeader: false };
  const header = rest.slice(0, close.index).split("\n");
  return { header: close.index === 0 ? [] : header, body: rest.slice(close.index + close[0].length), hasHeader: true };
}

/** A list as a header writes it: `[a, b]`. */
export function listLine(names: readonly string[]): string {
  return `[${names.join(", ")}]`;
}

/** Whether a field of the header is written over more than one line (a block list or a block text), which the form leaves as it is. */
export function isBlockField(header: readonly string[], name: string): boolean {
  const at = header.findIndex((line) => FIELD.exec(line)?.[1] === name);
  if (at < 0) return false;
  const next = header[at + 1];
  return next !== undefined && /^[ \t]+\S/.test(next) && /:\s*$/.test(header[at] as string);
}

/**
 * The file with each of `set` written into its header (a value of null takes the field out) and, where `body` is given, its text replaced. A field
 * already there is changed on its own line; a new one goes at the header's end. A field written over several lines is left as it is, and named in
 * `kept`.
 */
export function rewrite(text: string, set: Readonly<Record<string, string | null>>, body?: string): { text: string; kept: string[] } {
  const file = splitFile(text);
  const header = [...file.header];
  const kept: string[] = [];
  for (const [name, value] of Object.entries(set)) {
    const at = header.findIndex((line) => FIELD.exec(line)?.[1] === name);
    if (at >= 0 && isBlockField(header, name)) {
      kept.push(name);
      continue;
    }
    if (at >= 0) {
      if (value === null) header.splice(at, 1);
      else header[at] = `${name}: ${value}`;
    } else if (value !== null) {
      header.push(`${name}: ${value}`);
    }
  }
  const out = `---\n${header.join("\n")}${header.length === 0 ? "" : "\n"}---\n${body ?? file.body}`;
  return { text: out, kept };
}

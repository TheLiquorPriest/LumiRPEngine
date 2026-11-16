// A pattern tested on the lines of one file's text (plan §4.1, §5.1): the grep of the agents' files. A pattern may
// take time that grows with the cube of the text it is tested on, so the pool runs this on a thread it can end when
// the grep's time runs out, even inside one line; with no pool it runs where it is called and stops between lines.

export interface GrepAsk {
  text: string;
  /** The pattern's source and flags, as `RegExp` takes them. */
  source: string;
  flags: string;
  /** A line is tested, and a hit's text is cut, at this many UTF-16 code units. */
  lineChars: number;
  /** The most hits wanted of this file. */
  most: number;
  /** Run where it is called, not on a thread: a `performance.now()` after which no further line is tested. */
  until?: number;
}

export interface GrepLines {
  hits: { line: number; text: string; cut: boolean }[];
  /** It stopped for time before the last line. */
  late: boolean;
}

/** The lines of `text` that the pattern finds, at most `most`, each as far as `lineChars` and with its number from 1. */
export function grepLines(ask: GrepAsk): GrepLines {
  const pattern = new RegExp(ask.source, ask.flags);
  const lines = ask.text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const hits: GrepLines["hits"] = [];
  for (const [i, whole] of lines.entries()) {
    if (hits.length >= ask.most) break;
    if (ask.until !== undefined && performance.now() >= ask.until) return { hits, late: true };
    const text = whole.slice(0, ask.lineChars);
    if (pattern.test(text)) hits.push({ line: i + 1, text, cut: whole.length > ask.lineChars });
  }
  return { hits, late: false };
}

// A line diff of two texts (Settings → Agents → Prompts' Compare with shipped, DESIGN §6.12): the
// lines kept, taken out and added, the fewest taken out and added there can be (a longest common
// subsequence of lines), each change's lines taken out before the lines added in their place. Pure.

/** One line of a diff: in both texts (`same`), only in the one before (`del`), or only in the one after (`add`). */
export interface DiffLine {
  kind: "same" | "del" | "add";
  text: string;
}

/** A diff as it reads: its lines, with a run of unchanged lines away from every change folded to how many there are. */
export type DiffRow = DiffLine | { kind: "skip"; count: number };

/**
 * The most cells the common-subsequence table of a change's lines may take (lines before × lines
 * after, past the lines both texts start and end with). Past it, the change reads as every line of
 * it taken out, then every line added: still exactly the two texts, without the search's cost.
 */
const TABLE_CELLS = 1_000_000;

/** A text's lines: none for an empty text, else every line, the empty one after a last line break included. */
function linesOf(text: string): string[] {
  return text === "" ? [] : text.split("\n");
}

const kept = (text: string): DiffLine => ({ kind: "same", text });
const taken = (text: string): DiffLine => ({ kind: "del", text });
const added = (text: string): DiffLine => ({ kind: "add", text });

/** The changed middle of two texts: their lines' longest common subsequence, or, past `TABLE_CELLS`, every line taken out and then added. */
function middle(a: readonly string[], b: readonly string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > TABLE_CELLS) return [...a.map(taken), ...b.map(added)];
  // Each line as a number, so the table compares numbers.
  const ids = new Map<string, number>();
  const code = (line: string): number => {
    const found = ids.get(line);
    if (found !== undefined) return found;
    ids.set(line, ids.size);
    return ids.size - 1;
  };
  const x = a.map(code);
  const y = b.map(code);
  // lcs[i * w + j]: the longest common subsequence of x from i and y from j.
  const w = m + 1;
  const lcs = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
  }
  // Each change's lines taken out go before the lines added in their place.
  const out: DiffLine[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = (): void => {
    for (const line of dels) out.push(line);
    for (const line of adds) out.push(line);
    dels = [];
    adds = [];
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      flush();
      out.push(kept(a[i]));
      i++;
      j++;
    } else if (j >= m || (i < n && lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) {
      dels.push(taken(a[i]));
      i++;
    } else {
      adds.push(added(b[j]));
      j++;
    }
  }
  flush();
  return out;
}

/** The line diff from `before` to `after`: every line of each in order, kept, taken out or added, so the kept and taken-out lines are `before` and the kept and added ones `after`. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = linesOf(before);
  const b = linesOf(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return [...a.slice(0, start).map(kept), ...middle(a.slice(start, endA), b.slice(start, endB)), ...a.slice(endA).map(kept)];
}

/** How many lines a diff takes out and adds. */
export function diffCounts(lines: readonly DiffLine[]): { removed: number; added: number } {
  let removed = 0;
  let addedLines = 0;
  for (const line of lines) {
    if (line.kind === "del") removed++;
    else if (line.kind === "add") addedLines++;
  }
  return { removed, added: addedLines };
}

/**
 * A diff as it reads: every changed line, with up to `context` unchanged lines either side of each
 * change, and each longer run of unchanged lines between them folded to one `skip` of its count (a
 * lone unchanged line is shown, never folded).
 */
export function diffRows(lines: readonly DiffLine[], context = 2): DiffRow[] {
  const n = lines.length;
  const near: boolean[] = new Array<boolean>(n).fill(false);
  let last = Number.NEGATIVE_INFINITY;
  for (let k = 0; k < n; k++) {
    if (lines[k].kind !== "same") last = k;
    if (k - last <= context) near[k] = true;
  }
  let next = Number.POSITIVE_INFINITY;
  for (let k = n - 1; k >= 0; k--) {
    if (lines[k].kind !== "same") next = k;
    if (next - k <= context) near[k] = true;
  }
  const out: DiffRow[] = [];
  for (let k = 0; k < n; ) {
    let end = k;
    while (end < n && !near[end]) end++;
    if (end - k > 1) {
      out.push({ kind: "skip", count: end - k });
      k = end;
      continue;
    }
    out.push(lines[k]);
    k++;
  }
  return out;
}

// An agent's search pattern, checked before it runs (plan §16, a jailed file view). Every user's turns
// run in RPE's one process, and a backtracking pattern that takes time without end on some text would
// hold every chat and every Stop for as long as it ran. The check is the harness's own for its rules'
// patterns (`patternRisk` in RPH's `src/files/rules.ts`), copied because the package does not export
// it. A pattern it finds risky is refused as a pattern that cannot be searched for, which the harness
// tells the agent in its own notice line (`bad_pattern`).

/** Repeats with no bound (`*`, `+`, `{2,}`) a pattern may hold, as the harness allows for its rules. */
const MOST_OPEN_REPEATS = 2;

/** The repeat that starts at `at` in a pattern, if one does: its length (a lazy `?` after it included), whether it may match more than once, and whether it has no bound. */
function repeatAt(source: string, at: number): { length: number; many: boolean; open: boolean } | undefined {
  const c = source[at];
  let length: number;
  let max: number;
  if (c === "*" || c === "+") {
    length = 1;
    max = Number.POSITIVE_INFINITY;
  } else if (c === "?") {
    length = 1;
    max = 1;
  } else if (c === "{") {
    const m = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(at));
    if (m === null) return undefined;
    length = m[0].length;
    max = m[2] === undefined ? Number(m[1]) : m[3] === "" ? Number.POSITIVE_INFINITY : Number(m[3]);
  } else return undefined;
  if (source[at + length] === "?") length += 1;
  return { length, many: max > 1, open: max === Number.POSITIVE_INFINITY };
}

/**
 * Whether a pattern could take time without end on some text: it refers back to a group it matched; it repeats a group that holds a
 * repeat or alternatives of its own (`(a+)+`, `(a|ab)*`); or it holds more than `MOST_OPEN_REPEATS` repeats with no bound.
 */
export function riskyPattern(source: string): boolean {
  /** Each group open at this point, innermost last: whether it holds a repeat, and alternatives. */
  const groups: { repeats: boolean; alternatives: boolean }[] = [];
  let open = 0;
  let inClass = false;
  /** The group that closed just before this character, which a repeat here would repeat. */
  let closed: { repeats: boolean; alternatives: boolean } | undefined;
  for (let at = 0; at < source.length; at += 1) {
    const c = source[at];
    const before = closed;
    closed = undefined;
    if (c === "\\") {
      const next = source[at + 1] ?? "";
      if (!inClass && (/[1-9]/.test(next) || (next === "k" && source[at + 2] === "<"))) return true;
      at += 1;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "(") {
      groups.push({ repeats: false, alternatives: false });
      // `(?:`, `(?=`, `(?!`, `(?<=`, `(?<!` and `(?<name>` say what kind of group it is; none of it is a repeat.
      if (source[at + 1] === "?") at = source[at + 2] !== "<" ? at + 2 : source[at + 3] === "=" || source[at + 3] === "!" ? at + 3 : Math.max(at, source.indexOf(">", at));
    } else if (c === ")") {
      const group = groups.pop();
      const outer = groups.at(-1);
      if (group !== undefined && outer !== undefined) {
        outer.repeats ||= group.repeats;
        outer.alternatives ||= group.alternatives;
      }
      closed = group;
    } else if (c === "|") {
      const group = groups.at(-1);
      if (group !== undefined) group.alternatives = true;
    } else {
      const repeat = repeatAt(source, at);
      if (repeat === undefined) continue;
      at += repeat.length - 1;
      if (!repeat.many) continue;
      if (before !== undefined && (before.repeats || before.alternatives)) return true;
      if (repeat.open && (open += 1) > MOST_OPEN_REPEATS) return true;
      const group = groups.at(-1);
      if (group !== undefined) group.repeats = true;
    }
  }
  return false;
}

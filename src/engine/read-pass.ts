// Read passes (DESIGN §9.6): a pass that only reads a world and its state (a state view, the GM
// view, a turn's facts) asks the same questions many times over: each party's accounts, every flow
// in force, the route graph of each travel mode. Inside `readPass` each answer is kept, under the
// very objects it was read from, until the outermost pass ends; outside a pass `passMemo` computes
// afresh every time, so nothing kept ever outlives a change to what it was read from. A pass reads
// only: applying an event to a state inside one drops what was kept for that state.

/** What one pass keeps for an object: values by key, and what it keeps together with further objects. */
interface Kept {
  values: Map<string, unknown>;
  with: WeakMap<object, Kept>;
}

let depth = 0;
let kept: WeakMap<object, Kept> | null = null;

/**
 * Runs `read`, a synchronous read of worlds and states, as one pass: what `passMemo` computes inside
 * it is kept until the outermost pass ends. A promise would end the pass before the read did, so a
 * read that returns one is refused.
 */
export function readPass<T>(read: () => T): T {
  return inPass(depth === 0 ? new WeakMap() : null, read);
}

/**
 * One pass read in stretches, the thread let go between them: what one stretch's `passMemo` kept the
 * next finds, as in one pass. Only for reads of states nobody changes in between (the store's held
 * ones, which are frozen): its stretches share what they read from the same objects.
 */
export interface PassInStretches {
  /** Runs one stretch of the pass (`read`, synchronous), with what the stretches before it kept. */
  run<T>(read: () => T): T;
}

export function passInStretches(): PassInStretches {
  const mine = new WeakMap<object, Kept>();
  return { run: (read) => inPass(mine, read) };
}

function inPass<T>(own: WeakMap<object, Kept> | null, read: () => T): T {
  // Inside a pass already, its stretch reads with what that pass keeps.
  if (depth === 0) kept = own ?? new WeakMap();
  depth++;
  try {
    const out = read();
    if (out instanceof Promise) throw new Error("a read pass runs synchronous reads only");
    return out;
  } finally {
    depth--;
    if (depth === 0) kept = null;
  }
}

/**
 * `compute()`, kept for the pass under `owners` (the objects it reads, a state first) and `key`
 * (what of theirs it reads); outside a pass, `compute()` itself. A value is shared by every caller
 * in the pass, so callers never change one.
 */
export function passMemo<T>(owners: readonly [object, ...object[]], key: string, compute: () => T): T {
  if (!kept) return compute();
  const [first, ...rest] = owners;
  let node = keptFor(kept, first);
  for (const owner of rest) node = keptFor(node.with, owner);
  if (node.values.has(key)) return node.values.get(key) as T;
  const value = compute();
  node.values.set(key, value);
  return value;
}

function keptFor(level: WeakMap<object, Kept>, owner: object): Kept {
  let node = level.get(owner);
  if (!node) {
    node = { values: new Map(), with: new WeakMap() };
    level.set(owner, node);
  }
  return node;
}

/** Drops what the pass kept for `owner` (a state an event was just applied to), together with anything else. */
export function dropPassMemo(owner: object): void {
  kept?.delete(owner);
}

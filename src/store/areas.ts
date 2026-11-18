// Areas (plan §6.2, §6.3, Appendix B): what changes with the story besides the engine's world (the story's beats and threads, the
// Author's records, the cast's memories and perceptions, lore overlays) is a change like coin and place. An area registers with the
// store when it opens: its operations, named `<area>.<op>`, each with a check of its shape, a reducer over the area's own slice of the
// state, what it touches by name, and how an applied one is undone; and named reads of its slice. The store folds an area's changes
// along a path with the engine's, so a swipe, a delete or a branch rewinds them the same way, places a job's where §10.9 puts them,
// lists one that no longer applies, and undoes one by the area's own reverse. The store imports nothing from an area.

import type { JsonObject, JsonValue } from "../shared/json";
import type { Precision, Report, Source, Standing } from "./types";

/** A change of an area as its reducer sees it: the operation's value, and where and by whom it was made. */
export interface AreaChange {
  /** The operation's name within its area (`<op>` of `<area>.<op>`). */
  op: string;
  value: JsonValue;
  /** The turn it belongs to, and that turn's number on the path. */
  turn: string;
  n: number;
  /** Who decided it (an agent's definition, `player`, `import`, `migration`). */
  by: string | null;
  standing: Standing | null;
  precision: Precision | null;
  source: Source | null;
  cite: JsonValue | null;
  /**
   * Where its turn stands rebased (plan §6.3: an earlier reply now shows another swipe, or was deleted, and the turns after it are
   * applied again on what shows): the turns of the path it was made on that this path does not have, with their messages. Absent on
   * the turn's own path. A change about one of them (a beat of that reply, a perception of that turn) no longer applies here: the
   * area says so with its reports, and it applies again where that swipe shows again.
   */
  away?: Away;
}

/** The turns, and their messages, of the path a change was made on that the path it is applied on does not have (`AreaChange.away`). */
export interface Away {
  turns: readonly string[];
  messages: readonly string[];
}

/** A part an operation writes: a name the area gives (`ref`, as a tree ref may be) and the part of it. */
export interface AreaPart {
  ref: string;
  part: string;
}

/** What applying an area's change came to: its slice after it, with what did not add up; or that it does not apply, and why. */
export type AreaOutcome = { slice: JsonObject; reports?: Report[] } | { applied: false; reports: Report[] };

export interface AreaOp {
  /** Null when `value` reads as this operation; else why not. The store refuses one that does not read as unparseable input (§6.1). */
  check(value: JsonValue): string | null;
  /**
   * Applies the change to the area's slice, which it never changes: it gives the slice after it (sharing what it did not change).
   * One that no longer applies (a swipe flipped under it) says so with its reports; a reducer that throws is a fault, reported as
   * failed by its code alone.
   */
  apply(slice: Readonly<JsonObject>, change: AreaChange): AreaOutcome;
  /** The parts it writes, by name: a later write stands over a job's, marks keep provenance, and what changed last turn is named. */
  touches?(value: JsonValue): readonly AreaPart[];
  /**
   * The operations that undo it, in order, given its value and the slice just before it applied and now; null when it has no reverse.
   * Whether a part was written since is the store's to say (by the marks) for the parts `touches` names: this is asked only when nothing
   * was. An area that keeps its own record of which write set what (and so declares no parts) answers `"changed_since"` when a later
   * write set a field this one set, whatever its value is now.
   */
  undo?(value: JsonValue, before: Readonly<JsonObject>, now: Readonly<JsonObject>): { op: string; value: JsonValue }[] | null | "changed_since";
}

/** An area as it registers with the store. */
export interface StoreArea {
  /** The area's name: its operations are `<id>.<op>`. Not a pack's id. */
  id: string;
  /** The slice a chat starts with; none given: empty. */
  initial?(): JsonObject;
  ops: Readonly<Record<string, AreaOp>>;
  /** Named reads of its slice, which the tree and the world state may call. */
  reads?: Readonly<Record<string, (slice: Readonly<JsonObject>, args: JsonObject) => JsonValue>>;
}

/** The areas a store opened with, by name, and the operations they answer for. */
export class Areas {
  private readonly byId = new Map<string, StoreArea>();

  constructor(areas: readonly StoreArea[]) {
    for (const a of areas) {
      if (this.byId.has(a.id)) throw new Error(`the area ${a.id} is registered twice`);
      if (a.id === "store" || a.id.includes(".")) throw new Error(`"${a.id}" cannot name an area`);
      this.byId.set(a.id, a);
    }
  }

  /** The area and operation an op names, or null for one no area answers for (an engine event or a store operation). */
  of(op: string): { area: StoreArea; name: string; def: AreaOp } | null {
    const dot = op.indexOf(".");
    if (dot <= 0) return null;
    const area = this.byId.get(op.slice(0, dot));
    if (!area) return null;
    const name = op.slice(dot + 1);
    const def = Object.hasOwn(area.ops, name) ? area.ops[name] : undefined;
    return def ? { area, name, def } : null;
  }

  /** Whether an area answers for the op's prefix, whatever the operation. */
  owns(op: string): boolean {
    const dot = op.indexOf(".");
    return dot > 0 && this.byId.has(op.slice(0, dot));
  }

  get(id: string): StoreArea | undefined {
    return this.byId.get(id);
  }

  /** Each area's starting slice. */
  initial(): Record<string, JsonObject> {
    return Object.fromEntries([...this.byId.values()].map((a) => [a.id, a.initial?.() ?? {}]));
  }
}

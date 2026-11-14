// What a call reads: the state at its turn (with what the turn has staged so far) or, with no turn,
// at the chat's head; the world as the chat plays it; and names, read as today's tools read them
// (`backend/agents/tools/resolve.ts`): an id, then a whole name, then a name with a mark after it,
// then words that are all words of one name. A name that is not there is answered with the near
// matches, as data; a name that fits several, with each of them.

import type { EntityId } from "../shared/ids";
import type { WorldDoc } from "../shared/world";
import { placeAliases, placeKey } from "../engine/place-names";
import { own } from "../engine/pack-kit";
import type { ReadContext } from "../engine/registry";
import type { Registry } from "../engine/registry-impl";
import { isGone, kindDef, kindIs } from "../engine/scope";
import { resolveThing as resolveThingWords } from "../engine/thing-resolve";
import { holdsOf, isThing } from "../engine/things";
import type { TreeView } from "../store/view";
import type { StoreState, TurnRow } from "../store/types";
import type { Call } from "./kit";

/** What a name is wanted as. */
export type Want = "entity" | "person" | "thing" | "holder" | "place" | "point" | "track";

/** A name that was found. `ref` is its place in the tree (`entity:<id>`, `place:<id>`, `world`); a track's is `track:<id>`. */
export interface Found {
  id: string;
  ref: string;
  name: string;
}

/** One of several names an answer lists: its id, its name, what it is. */
export interface Near {
  id: string;
  name: string;
  what: string;
}

/** A name that was not found as wanted: the near matches, or each of the several it fits. */
export interface Missed {
  name: string;
  near: Near[];
  several: Near[];
}

interface Candidate {
  id: string;
  ref: string;
  names: string[];
  what: string;
  place: boolean;
}

const spaced = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();
/** A name's words, a possessive's 's aside ("Okafor's" is Okafor). */
const wordsOf = (s: string): string[] =>
  spaced(s)
    .replace(/['’]s\b/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== "");

/** The tree's own points besides places and entities. */
const POINTS: Readonly<Record<string, string>> = { world: "world", groups: "groups", elsewhere: "elsewhere" };

export class Reading {
  private tree: TreeView | null = null;

  private constructor(
    private readonly call: Call,
    readonly state: StoreState,
    readonly doc: WorldDoc,
    readonly ctx: ReadContext,
    readonly turn: TurnRow | null,
  ) {}

  /**
   * The state the call reads: at its turn, with what the turn has staged, or at the chat's head when
   * the call belongs to no turn. Null when the scope names no chat, or a turn, the store does not
   * have, or the chat's world revision is not to hand: the answer says which.
   */
  static of(call: Call): Reading | { missing: "chat" | "turn" | "world"; id: string } {
    const { store, env } = call.deps;
    if (store.chat(call.scope.chat) === null) return { missing: "chat", id: call.scope.chat };
    let turn: TurnRow | null = null;
    if (call.scope.turn !== undefined) {
      turn = store.turn(call.scope.turn);
      if (turn === null || turn.chat !== call.scope.chat) return { missing: "turn", id: call.scope.turn };
    }
    const state = turn ? store.stateAt(turn.id).state : store.headState(call.scope.chat).state;
    const doc = env.worlds(state.world.revision);
    if (doc === undefined) return { missing: "world", id: state.world.revision };
    return new Reading(call, state, doc, env.registry.context(doc, state.world), turn);
  }

  /** This call's reading over another state of the same world: a draft's, as it stands, so a later operation finds what an earlier one made. */
  over(state: StoreState, ctx: ReadContext): Reading {
    return new Reading(this.call, state, this.doc, ctx, this.turn);
  }

  get registry(): Registry {
    return this.call.deps.env.registry;
  }

  /** The world as the chat plays it: its own places and those play made or changed. */
  get world(): WorldDoc {
    return this.ctx.world;
  }

  /** The tree over this state. */
  view(): TreeView {
    this.tree ??= this.turn ? this.call.deps.store.viewAt(this.turn.id) : this.call.deps.store.view(this.call.scope.chat);
    return this.tree;
  }

  /** What an entity is, by its kind's label. */
  whatOf(id: EntityId): string {
    const e = own(this.state.world.entities, id);
    return e ? (kindDef(this.registry, this.doc, e.kind)?.label ?? e.kind) : "place";
  }

  isPerson(id: EntityId): boolean {
    const e = own(this.state.world.entities, id);
    return e !== undefined && kindIs(this.registry, this.doc, e.kind, "person");
  }

  /** The name an id is shown by: an entity's, a place's, or the id itself. */
  nameOf(id: string): string {
    return own(this.state.world.entities, id)?.name ?? own(this.world.places, id)?.name ?? id;
  }

  private candidates(want: Want, gone: boolean): Candidate[] {
    const out: Candidate[] = [];
    const entities = want !== "place" && want !== "track";
    if (entities) {
      for (const [id, e] of Object.entries(this.state.world.entities)) {
        if (!gone && isGone(this.state.world, id)) continue;
        if (want === "person" && !this.isPerson(id)) continue;
        if (want === "thing" && this.isPerson(id)) continue;
        if (want === "holder" && !this.isPerson(id) && !(isThing(this.ctx, id) && holdsOf(this.ctx, id) !== null)) continue;
        const aliases = Array.isArray(e.fields.aliases) ? e.fields.aliases.filter((a): a is string => typeof a === "string") : [];
        out.push({ id, ref: `entity:${id}`, names: [e.name, ...aliases], what: this.whatOf(id), place: false });
      }
    }
    if (want === "place" || want === "point") {
      for (const [id, p] of Object.entries(this.world.places)) out.push({ id, ref: `place:${id}`, names: [p.name, ...placeAliases(p)], what: "place", place: true });
    }
    if (want === "point") for (const [id, ref] of Object.entries(POINTS)) out.push({ id, ref, names: [id], what: id, place: false });
    if (want === "track") for (const [id, t] of Object.entries(this.doc.tracks)) out.push({ id, ref: `track:${id}`, names: [t.label], what: t.kind, place: false });
    return out;
  }

  /**
   * What `said` names, as wanted: an id, a ref (`entity:<id>`, `place:<id>`), a whole name, a name
   * with a mark after it, or words that are all words of one name; a thing also as today's things
   * model reads words ("the fridge", "Danny's keys"). `gone` counts what was taken out of the world.
   */
  find(said: string, want: Want, gone = false): Found | Missed {
    const trimmed = said.trim();
    const all = this.candidates(want, gone);
    const bare = trimmed.replace(/^(?:entity|place|track):/, "");
    const lower = bare.toLowerCase();
    const rules: ((c: Candidate) => boolean)[] = [
      (c) => c.ref === trimmed || c.id === bare,
      (c) => c.id.toLowerCase() === lower,
      (c) => c.names.some((n) => spaced(n) === spaced(bare) || (c.place && placeKey(n) !== "" && placeKey(n) === placeKey(bare))),
      (c) => c.names.some((n) => spaced(n) !== "" && spaced(bare).startsWith(spaced(n)) && /^[\s[({:;,·—-]/.test(spaced(bare).slice(spaced(n).length))),
    ];
    for (const rule of rules) {
      const hits = all.filter(rule);
      if (hits.length === 1 && hits[0]) return this.found(hits[0]);
      if (hits.length > 1) return { name: said, near: [], several: hits.map((c) => this.near(c)) };
    }
    if (want === "thing" || want === "holder") {
      const pov = this.doc.pov;
      const words = resolveThingWords(this.ctx, bare, { actor: pov, viewer: pov, ...(want === "holder" ? { need: "holder" as const } : {}) });
      if ("id" in words) {
        const hit = all.find((c) => c.id === words.id);
        if (hit) return this.found(hit);
      }
      if ("ambiguous" in words) {
        const several = all.filter((c) => words.ambiguous.includes(c.id));
        if (several.length > 1) return { name: said, near: [], several: several.map((c) => this.near(c)) };
      }
    }
    const saidWords = wordsOf(bare);
    const byWords = saidWords.length === 0 ? [] : all.filter((c) => c.names.some((n) => saidWords.every((w) => wordsOf(n).includes(w))));
    if (byWords.length === 1 && byWords[0]) return this.found(byWords[0]);
    if (byWords.length > 1) return { name: said, near: [], several: byWords.map((c) => this.near(c)) };
    return { name: said, near: this.nearest(bare, all), several: [] };
  }

  private found(c: Candidate): Found {
    return { id: c.id, ref: c.ref, name: c.names[0] ?? c.id };
  }

  private near(c: Candidate): Near {
    return { id: c.id, name: c.names[0] ?? c.id, what: c.what };
  }

  /** The candidates closest to words that named none: one holding the other, then shared words, then a small spelling distance. */
  private nearest(said: string, all: readonly Candidate[]): Near[] {
    const s = spaced(said);
    const saidWords = new Set(wordsOf(said));
    const scored: { c: Candidate; score: number }[] = [];
    for (const c of all) {
      let score = 0;
      for (const n of [c.id, ...c.names]) {
        const t = spaced(n);
        if (t === "" || s === "") continue;
        if (t.includes(s) || s.includes(t)) score = Math.max(score, 3);
        else if (wordsOf(n).some((w) => saidWords.has(w))) score = Math.max(score, 2);
        else if (distance(t, s) <= Math.max(1, Math.floor(s.length / 4))) score = Math.max(score, 1);
      }
      if (score > 0) scored.push({ c, score });
    }
    scored.sort((a, b) => b.score - a.score || (a.c.names[0] ?? "").localeCompare(b.c.names[0] ?? "") || a.c.id.localeCompare(b.c.id));
    return scored.slice(0, this.call.settings.nearMatches).map((x) => this.near(x.c));
  }
}

/** Whether a resolution found what it looked for. */
export function isFound(r: Found | Missed): r is Found {
  return "ref" in r;
}

/** Levenshtein distance between two short texts. */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 8) return Number.POSITIVE_INFINITY;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length] ?? Number.POSITIVE_INFINITY;
}

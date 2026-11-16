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
import { orgTypeOf } from "../engine/org";
import { isParty } from "../packs/economy/core/pay";
import type { Registry } from "../engine/registry-impl";
import { isGone, kindDef, kindIs } from "../engine/scope";
import { resolveThing as resolveThingWords } from "../engine/thing-resolve";
import { holdsOf, isThing } from "../engine/things";
import type { TreeView } from "../store/view";
import { JoinedTurnError, type StoreState, type TurnRow } from "../store/types";
import type { Call, Reply } from "./kit";
import { type Lines, textOf } from "./texts";

/** What a name is wanted as. */
export type Want = "entity" | "person" | "thing" | "holder" | "place" | "point" | "track" | "party" | "organization";

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

/**
 * A name that was not found as wanted: the near matches (never none while anything of that kind exists), each of the several
 * it fits, and what goes by that very name but is not what was wanted. `empty`: nothing of that kind exists to be near.
 */
export interface Missed {
  name: string;
  near: Near[];
  several: Near[];
  other: Near[];
  empty?: true;
}

/**
 * Why a call's scope has no state to read: the chat or the turn it names is not there (with what does exist), the turn's
 * staged changes were dropped, or the turn was joined to another (`into`), which holds its changes now.
 */
export type Unreadable = { missing: "chat" | "turn"; id: string; exist: string[] } | { missing: "gone"; id: string; what: "turn" | "job" } | { missing: "joined"; id: string; into: string };

/** A scope found unreadable after a reading was made (a turn joined to another in between): thrown to the tool wrapper, which tells it as the fact. */
export class ScopeError extends Error {
  constructor(readonly why: Unreadable) {
    super(`scope unreadable: ${why.missing} ${why.id}`);
    this.name = "ScopeError";
  }
}

/** Says why a scope has no state to read, in lines of the answers' file: the id that does not exist with what does, the turn or job that is gone, the turn that was joined to another. */
export function saysUnreadable(reply: Reply, why: Unreadable): Reply {
  if (why.missing === "gone") return reply.line("scope_gone", { what: why.what, id: why.id }).fail();
  if (why.missing === "joined") return reply.line("turn_joined", { id: why.id, into: why.into }).fail();
  return reply.line(`no_${why.missing}`, { id: why.id, exist: textOf(why.exist) }).fail();
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
   * The state the call reads: at its turn, with what the turn has staged, and for a job's agent with
   * what the job has recorded so far (plan §10.9: nobody else sees that until the job ends), or at the
   * chat's head when the call belongs to no turn. When the scope has none, why: the chat or turn it names
   * is an id the store does not have (with what does exist), its staged changes were dropped, or it was
   * joined to another turn (the fact is told, never followed: PlanTurn's one place resolves a join). A
   * chat's world revision that is kept is loaded; one that cannot be is a fault, and throws.
   */
  static of(call: Call): Reading | Unreadable {
    const { store, env } = call.deps;
    const near = call.settings.nearMatches;
    if (store.chat(call.scope.chat) === null) return { missing: "chat", id: call.scope.chat, exist: store.chats().slice(-near).map((c) => c.id) };
    let turn: TurnRow | null = null;
    if (call.scope.turn !== undefined) {
      turn = store.turn(call.scope.turn);
      if (turn === null || turn.chat !== call.scope.chat) return { missing: "turn", id: call.scope.turn, exist: store.line(call.scope.chat).slice(-near).map((t) => t.turn) };
      if (turn.joined !== null) return { missing: "joined", id: turn.id, into: turn.joined };
      if (turn.status === "dropped") return { missing: "gone", id: turn.id, what: "turn" };
    }
    let folded;
    try {
      folded = turn ? store.stateFor(turn.id, call.agent.job ?? null) : store.headState(call.scope.chat);
    } catch (error) {
      if (error instanceof JoinedTurnError) return { missing: "joined", id: error.turn, into: error.joined };
      throw error;
    }
    const state = folded.state;
    const doc = env.worlds(state.world.revision);
    if (doc === undefined) throw new Error(`the world revision ${state.world.revision} of chat ${call.scope.chat} cannot be loaded`);
    return new Reading(call, state, doc, env.registry.context(doc, state.world), turn);
  }

  /** This call's reading over another state of the same world: a draft's, as it stands, so a later operation finds what an earlier one made. */
  over(state: StoreState, ctx: ReadContext): Reading {
    return new Reading(this.call, state, this.doc, ctx, this.turn);
  }

  get registry(): Registry {
    return this.call.deps.env.registry;
  }

  /** The answers' lines the call is worded in. */
  get lines(): Lines {
    return this.call.lines;
  }

  /** The world as the chat plays it: its own places and those play made or changed. */
  get world(): WorldDoc {
    return this.ctx.world;
  }

  /** The tree over this state. A turn joined to another since this reading was made is told as the fact (`ScopeError`), never thrown as the store's. */
  view(): TreeView {
    try {
      this.tree ??= this.turn ? this.call.deps.store.viewFor(this.turn.id, this.call.agent.job ?? null) : this.call.deps.store.view(this.call.scope.chat);
    } catch (error) {
      if (error instanceof JoinedTurnError) throw new ScopeError({ missing: "joined", id: error.turn, into: error.joined });
      throw error;
    }
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
        if (want === "party" && !isParty(this.ctx, id)) continue;
        if (want === "organization" && orgTypeOf(this.ctx, id) === null) continue;
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
   * with a note after it ("Bram (the innkeeper)", "Wren: soaked through"), or words that are all
   * words of one name; a thing also as today's things model reads words ("the fridge", "Danny's
   * keys"). `gone` counts what was taken out of the world.
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
      // Only a mark that opens a note: words after a space or a comma may name someone else ("Odile and Tam", "Odile, Tam"), and are never dropped as one name.
      (c) => c.names.some((n) => spaced(n) !== "" && spaced(bare).startsWith(spaced(n)) && /^ ?[[({:;·—-]/.test(spaced(bare).slice(spaced(n).length))),
    ];
    for (const rule of rules) {
      const hits = all.filter(rule);
      if (hits.length === 1 && hits[0]) return this.found(hits[0]);
      if (hits.length > 1) return { name: said, near: [], several: hits.map((c) => this.near(c)), other: [] };
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
        if (several.length > 1) return { name: said, near: [], several: several.map((c) => this.near(c)), other: [] };
      }
    }
    const saidWords = wordsOf(bare);
    const byWords = saidWords.length === 0 ? [] : all.filter((c) => c.names.some((n) => saidWords.every((w) => wordsOf(n).includes(w))));
    if (byWords.length === 1 && byWords[0]) return this.found(byWords[0]);
    if (byWords.length > 1) return { name: said, near: [], several: byWords.map((c) => this.near(c)), other: [] };
    // What goes by that very name but is not what was wanted (a weather region named as a place), so the answer can say what it is.
    const wanted = new Set(all.map((c) => c.ref));
    const other = this.candidates("point", gone).filter((c) => !wanted.has(c.ref) && rules.slice(0, 3).some((rule) => rule(c)));
    return { name: said, near: this.nearest(bare, all), several: [], other: other.map((c) => this.near(c)), ...(all.length === 0 ? { empty: true as const } : {}) };
  }

  private found(c: Candidate): Found {
    return { id: c.id, ref: c.ref, name: c.names[0] ?? c.id };
  }

  private near(c: Candidate): Near {
    return { id: c.id, name: c.names[0] ?? c.id, what: c.what };
  }

  /**
   * The candidates nearest to words that named none, nearest first: one holding the other, then shared words, then a spelling
   * distance within `engine.nearDistance` of the name's length, then the rest by their distance: never none while any exists.
   */
  private nearest(said: string, all: readonly Candidate[]): Near[] {
    const measured = all.map((c) => ({ c, ...measure(said, [c.id, ...c.names], this.call.settings.nearDistance) }));
    measured.sort((a, b) => b.score - a.score || a.apart - b.apart || (a.c.names[0] ?? "").localeCompare(b.c.names[0] ?? "") || a.c.id.localeCompare(b.c.id));
    return measured.slice(0, this.call.settings.nearMatches).map((x) => this.near(x.c));
  }
}

/** How near a candidate's names are to what was said: its score (one holding the other 3, shared words 2, a spelling distance within `fraction` of the said length 1) and its closest spelling distance. */
function measure(said: string, names: readonly string[], fraction: number): { score: number; apart: number } {
  const s = spaced(said);
  const saidWords = new Set(wordsOf(said));
  const allowed = Math.max(1, Math.floor(s.length * fraction));
  let score = 0;
  let apart = Number.POSITIVE_INFINITY;
  for (const n of names) {
    const t = spaced(n);
    if (t === "") continue;
    const d = distance(t, s);
    apart = Math.min(apart, d);
    if (s === "") continue;
    if (t.includes(s) || s.includes(t)) score = Math.max(score, 3);
    else if (wordsOf(n).some((w) => saidWords.has(w))) score = Math.max(score, 2);
    else if (d <= allowed) score = Math.max(score, 1);
  }
  return { score, apart };
}

/** A list of choices ranked nearest first to what was said, by the reading's own measure: the list a refusal of a value outside a fixed list gives, cut as the near matches are. */
export function nearestOf(said: string, choices: readonly string[], settings: { nearDistance: number }): string[] {
  return choices
    .map((c) => ({ c, ...measure(said, [c], settings.nearDistance) }))
    .sort((a, b) => b.score - a.score || a.apart - b.apart || a.c.localeCompare(b.c))
    .map((x) => x.c);
}

/** Whether a resolution found what it looked for. */
export function isFound(r: Found | Missed): r is Found {
  return "ref" in r;
}

/** Levenshtein distance between two short texts. */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length] ?? Number.POSITIVE_INFINITY;
}

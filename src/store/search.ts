// The state search (plan §4.7, §6.8 `world_search`, Appendix B): a person, thing, place or group is found by any word
// said of it, on a world of thousands, without reading the whole state. Code matches words; it never judges what words mean.
//
// What is said of a thing is of two kinds, each a text the index file's `facts` index tokenizes and keeps nowhere: its names
// (its name, its other names) and the rest (its kind, its description, the values of its facts, the agents' own lines on it).
// A chat's head is followed incrementally, by what each fold shares with the one before it: only the things a turn, a swipe
// or a delete changed are read again, and a text of the revision already indexed is not sent twice. A search asks the index
// for candidates, orders them by what the state itself says (whole names first, then names holding every word, then some,
// then the rest of what is said), and reads the things that differ between the state it is asked of and the head the index
// follows (a turn in progress) straight from that state, so what an agent changed a moment ago is found at once.
//
// The index file is the application's (`src/app/index-file`), written by its own worker; this module sees it through
// `StateIndexPort`, which `IndexFile` satisfies, so the store depends on nothing of the application.

import { hashParts } from "../shared/hash";
import type { WorldDoc } from "../shared/world";
import { placeAliases } from "../engine/place-names";
import { isGone, kindDef, kindIs } from "../engine/scope";
import type { FoldEnv } from "./fold";
import { standing } from "./facts";
import type { StoreState } from "./types";

/** Defaults of the state search, each a setting. */
export const STATE_SEARCH_DEFAULTS = Object.freeze({
  /** Candidates the index gives for each ask of a search, before they are ordered by what the state says of them. */
  candidates: 64,
  /** Milliseconds a chat stays quiet after a write before its index follows its head: a turn's many writes are followed once. */
  settle: 300,
});

/** The words of a text: lower-case letters and digits, a possessive's `'s` taken off. */
export const wordsOf = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== "");

/** How well `said`'s words meet a text: 4 the whole of it, 3 every word, 2 some word; 0 none. */
export function meets(said: readonly string[], text: string, whole: string): number {
  const own = wordsOf(text);
  if (own.length === 0) return 0;
  if (own.join(" ") === whole) return 4;
  if (said.every((w) => own.includes(w))) return 3;
  return said.some((w) => own.includes(w)) ? 2 : 0;
}

export type FoundKind = "person" | "thing" | "place" | "group";

/** What is said of one thing, as the search reads it. */
export interface Thing {
  /** The tree ref: `place:<id>` or `entity:<id>`. */
  ref: string;
  name: string;
  /** What it is: its kind's label, or "place". */
  what: string;
  kind: FoundKind;
  /** Where it is, as a tree ref, when it is somewhere. */
  where?: string;
  /** Its name first, then its other names. */
  names: string[];
  /** The rest of what is said of it, each with what it is: kind, description, fact, note. */
  said: [string, string][];
  /** Gone from the world (itself, or a holder of it): found by no search. */
  gone: boolean;
}

/** A thing a search found. */
export interface Found {
  ref: string;
  name: string;
  what: string;
  where?: string;
  /** What the words matched: its name, another name, its kind, its description, a fact, a note. */
  matched: string;
  /** 4 its whole name, 3 a name holding every word, 2 a name holding some, 1 the rest of what is said. */
  score: number;
}

/** The state as the search reads it: its world's document, and that document as the registry's context shows it. */
export interface Reading {
  state: StoreState;
  env: FoldEnv;
  doc: WorldDoc;
  world: WorldDoc;
}

export function readingOf(state: StoreState, env: FoldEnv): Reading | null {
  const doc = env.worlds(state.world.revision);
  return doc === undefined ? null : { state, env, doc, world: env.registry.context(doc, state.world).world };
}

/** The refs of everything the search reads in a state. */
export function refsOf(r: Reading): string[] {
  return [...Object.keys(r.world.places).map((id) => `place:${id}`), ...Object.keys(r.state.world.entities).map((id) => `entity:${id}`)];
}

const factsOf = (state: StoreState, ref: string): [string, string][] => standing(state, ref).map((f): [string, string] => ["fact", f.value]);

/** One thing as the search reads it; null where the state holds no such thing. */
export function thingOf(r: Reading, ref: string): Thing | null {
  const at = ref.indexOf(":");
  const id = ref.slice(at + 1);
  const note = r.state.notes[ref]?.text ?? "";
  if (ref.startsWith("place:")) {
    const p = r.world.places[id];
    if (p === undefined) return null;
    const description = typeof p.fields.description === "string" ? p.fields.description : "";
    return {
      ref,
      name: p.name,
      what: "place",
      kind: "place",
      ...(p.parent !== undefined ? { where: `place:${p.parent}` } : {}),
      names: [p.name, ...placeAliases(p)],
      said: [["description", description], ...factsOf(r.state, ref), ["note", note]],
      gone: false,
    };
  }
  if (!ref.startsWith("entity:")) return null;
  const e = r.state.world.entities[id];
  if (e === undefined) return null;
  const label = kindDef(r.env.registry, r.doc, e.kind)?.label ?? e.kind;
  const kind: FoundKind = kindIs(r.env.registry, r.doc, e.kind, "person") ? "person" : kindIs(r.env.registry, r.doc, e.kind, "group") ? "group" : "thing";
  const aliases = Array.isArray(e.fields.aliases) ? e.fields.aliases.filter((a): a is string => typeof a === "string") : [];
  const holder = e.relations.find((x) => x.type === "in")?.to;
  const place = typeof e.fields.place === "string" ? e.fields.place : undefined;
  const where = holder !== undefined ? `entity:${holder}` : place !== undefined ? `place:${place}` : undefined;
  const description = typeof e.fields.description === "string" ? e.fields.description : "";
  return {
    ref,
    name: e.name,
    what: label,
    kind,
    ...(where !== undefined ? { where } : {}),
    names: [e.name, ...aliases],
    said: [["kind", label], ["description", description], ...factsOf(r.state, ref), ["note", note]],
    gone: isGone(r.state.world, id),
  };
}

/** How a thing meets words: its best name (its name, another name), else the rest of what is said of it; null when nothing does. */
export function scoreThing(t: Thing, said: readonly string[], whole: string): Found | null {
  let best = 0;
  let matched = "";
  for (const [i, n] of t.names.entries()) {
    const s = meets(said, n, whole);
    if (s > best) {
      best = s;
      matched = i === 0 ? "name" : "other name";
    }
  }
  if (best === 0) {
    for (const [what, text] of t.said) {
      if (meets(said, text, whole) > 0) {
        best = 1;
        matched = what;
        break;
      }
    }
  }
  return best === 0 ? null : { ref: t.ref, name: t.name, what: t.what, ...(t.where !== undefined ? { where: t.where } : {}), matched, score: best };
}

/** Found things in the order a search gives them: best first, then by name and ref. */
export function ordered(found: Found[], limit: number): Found[] {
  return found.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.ref.localeCompare(b.ref)).slice(0, Math.max(0, limit));
}

/** The refs of what differs between two states of one world revision: things, their facts, their notes. By what the folds share, never by reading them. */
export function changedRefs(before: StoreState, after: StoreState): Set<string> {
  const out = new Set<string>();
  const be = before.world.entities;
  const ae = after.world.entities;
  if (be !== ae) {
    for (const id of Object.keys(ae)) if (be[id] !== ae[id]) out.add(`entity:${id}`);
    for (const id of Object.keys(be)) if (!(id in ae)) out.add(`entity:${id}`);
  }
  for (const [b, a] of [[before.notes, after.notes], [before.facts, after.facts]] as const) {
    if (b === a) continue;
    for (const k of Object.keys(a)) if (b[k] !== a[k]) out.add(k);
    for (const k of Object.keys(b)) if (!(k in a)) out.add(k);
  }
  return out;
}

// ------------------------------------------------------------------ the index

/** The index file's face, as the state search uses it (`IndexFile` is one). */
export interface StateIndexPort {
  put(index: "facts", user: string, docs: readonly { id: string; revision: string; scope: string; text: string }[]): Promise<{ written: number }>;
  drop(index: "facts", user: string, ids: readonly string[]): Promise<{ dropped: number }>;
  search(index: "facts", user: string, query: string, options: { scope?: string | null; limit: number; prefix?: boolean }): Promise<{ id: string; revision: string; scope: string; rank: number }[]>;
  table(table: { name: string; columns: Record<string, never> }): Promise<{ made: boolean }>;
  putRows(table: { name: string; columns: Record<string, never> }, user: string, rows: readonly { id: string; revision: string; scope: string; values: Record<string, never> }[]): Promise<{ written: number }>;
  dropRows(table: { name: string; columns: Record<string, never> }, user: string, ids: readonly string[]): Promise<{ dropped: number }>;
  rows(table: { name: string; columns: Record<string, never> }, user: string, scope?: string | null): Promise<{ id: string; revision: string; scope: string }[]>;
}

/** What the index keeps of each chat's things, by doc id and revision: all of it that is known, so a chat is followed by its difference and dropped whole. */
export const STATE_SEEN = { name: "state_seen", columns: {} } as const;

/** What the search needs of the store: a user's head state of a chat, and what folds it. */
export interface StateIndexStore {
  user(id: string): { headState(chat: string): { state: StoreState } };
  readonly env: FoldEnv;
}

export interface StateIndexOptions {
  store: StateIndexStore;
  index: StateIndexPort;
  /** What the search says for people. */
  log?: (message: string) => void;
  candidates?: number;
  settle?: number;
}

interface Followed {
  /** The state the index holds; none (collected) the next follow reads everything again. */
  state: WeakRef<StoreState> | null;
  /** The docs of the index, by id, with the revision indexed. */
  seen: Map<string, string>;
}

const NAMES = "n";
const REST = "s";
const scopeOf = (chat: string, part: string): string => `${chat}\u0000${part}`;
const docId = (chat: string, part: string, ref: string): string => `state\u0000${chat}\u0000${part}\u0000${ref}`;
const refOfDoc = (id: string): string => id.slice(id.indexOf("\u0000", id.indexOf("\u0000", 6) + 1) + 1);

export class StateIndex {
  readonly #store: StateIndexStore;
  readonly #index: StateIndexPort;
  readonly #log: (message: string) => void;
  readonly #candidates: number;
  readonly #settle: number;
  readonly #followed = new Map<string, Followed>();
  readonly #chains = new Map<string, Promise<unknown>>();
  readonly #pending = new Map<string, { user: string; chat: string }>();
  #timer: Timer | undefined;
  #made: Promise<unknown> | null = null;

  constructor(options: StateIndexOptions) {
    this.#store = options.store;
    this.#index = options.index;
    this.#log = options.log ?? (() => undefined);
    this.#candidates = Math.max(1, Math.floor(options.candidates ?? STATE_SEARCH_DEFAULTS.candidates));
    this.#settle = Math.max(0, Math.floor(options.settle ?? STATE_SEARCH_DEFAULTS.settle));
  }

  #chain<T>(key: string, work: () => Promise<T>): Promise<T> {
    const run = (this.#chains.get(key) ?? Promise.resolve()).then(work, work);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.#chains.set(key, settled);
    void settled.then(() => {
      if (this.#chains.get(key) === settled) this.#chains.delete(key);
    });
    return run;
  }

  #ready(): Promise<unknown> {
    this.#made ??= this.#index.table(STATE_SEEN);
    return this.#made;
  }

  /**
   * Brings the index of a chat in step with `state` (its head): what changed since the state the index holds is read again and put, what is gone is
   * dropped; with no state held, everything is read and what the index already holds at its revision is left as it is.
   */
  follow(user: string, chat: string, state: StoreState, env: FoldEnv = this.#store.env): Promise<{ put: number; dropped: number }> {
    const key = `${user}\u0000${chat}`;
    return this.#chain(key, async () => {
      await this.#ready();
      let followed = this.#followed.get(key);
      if (followed === undefined) {
        followed = { state: null, seen: new Map((await this.#index.rows(STATE_SEEN, user, chat)).map((r) => [r.id, r.revision])) };
        this.#followed.set(key, followed);
      }
      const r = readingOf(state, env);
      const before = followed.state?.deref();
      const full = before === undefined || r === null || before.world.revision !== state.world.revision;
      const refs = r === null ? [] : full ? refsOf(r) : [...changedRefs(before, state)];
      const target = new Map<string, { id: string; revision: string; scope: string; text: string }>();
      const touched = new Set<string>();
      for (const ref of refs) {
        for (const part of [NAMES, REST]) touched.add(docId(chat, part, ref));
        const t = r === null ? null : thingOf(r, ref);
        if (t === null) continue;
        const names = t.names.join("\n");
        const rest = t.said.map(([, text]) => text).filter((text) => text !== "").join("\n");
        for (const [part, text] of [[NAMES, names], [REST, rest]] as const) {
          if (text === "") continue;
          const id = docId(chat, part, ref);
          target.set(id, { id, revision: hashParts("rpe.state-search", text), scope: scopeOf(chat, part), text });
        }
      }
      const puts = [...target.values()].filter((d) => followed.seen.get(d.id) !== d.revision);
      const drops = (full ? [...followed.seen.keys()] : [...touched]).filter((id) => followed.seen.has(id) && !target.has(id));
      if (puts.length > 0) {
        await this.#index.put("facts", user, puts);
        await this.#index.putRows(STATE_SEEN, user, puts.map((d) => ({ id: d.id, revision: d.revision, scope: chat, values: {} })));
      }
      if (drops.length > 0) {
        await this.#index.drop("facts", user, drops);
        await this.#index.dropRows(STATE_SEEN, user, drops);
      }
      for (const d of puts) followed.seen.set(d.id, d.revision);
      for (const id of drops) followed.seen.delete(id);
      followed.state = new WeakRef(state);
      return { put: puts.length, dropped: drops.length };
    });
  }

  /** Lets go of everything the index holds of a chat (the chat is deleted, or its derived rows are pruned); it is followed again at its next search. */
  forget(user: string, chat: string): Promise<{ dropped: number }> {
    const key = `${user}\u0000${chat}`;
    return this.#chain(key, async () => {
      await this.#ready();
      const ids = (await this.#index.rows(STATE_SEEN, user, chat)).map((r) => r.id);
      for (const id of this.#followed.get(key)?.seen.keys() ?? []) if (!ids.includes(id)) ids.push(id);
      this.#followed.delete(key);
      if (ids.length === 0) return { dropped: 0 };
      await this.#index.drop("facts", user, ids);
      await this.#index.dropRows(STATE_SEEN, user, ids);
      return { dropped: ids.length };
    });
  }

  /**
   * What the store says of a write (`Store.onWrite`): the chats whose folds it changed, or null when it named none, any chat of the user's having
   * moved its head. A chat the index follows is followed again once it has been quiet for the setting's time, so the many writes of one turn make
   * one pass. A chat nobody has searched is not followed: its first search reads it.
   */
  notify(user: string, chats: readonly string[] | null): void {
    for (const key of chats === null ? this.#followed.keys() : chats.map((chat) => `${user}\u0000${chat}`)) {
      if (!key.startsWith(`${user}\u0000`) || !this.#followed.has(key)) continue;
      this.#pending.set(key, { user, chat: key.slice(user.length + 1) });
    }
    if (this.#pending.size === 0) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => void this.settle(), this.#settle);
  }

  /** Follows every chat that is waiting to be followed, now; resolves once the index is in step. */
  async settle(): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const waiting = [...this.#pending.values()];
    this.#pending.clear();
    await Promise.all(
      waiting.map(async ({ user, chat }) => {
        try {
          await this.follow(user, chat, this.#store.user(user).headState(chat).state);
        } catch (error) {
          // A chat that is gone is let go of; anything else is told, and the chat is followed by its next search.
          const gone = error instanceof Error && /no chat/i.test(error.message);
          if (gone) await this.forget(user, chat).catch(() => undefined);
          else this.#log(`the state search could not follow chat ${chat}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }),
    );
    await Promise.all(this.#chains.values());
  }

  /**
   * The things of `state` that meet `words`, best first: whole names, then names holding every word, then some, then the rest of what is said of them.
   * The index gives candidates; what the state says of them orders them; what differs between `state` and the head the index holds is read from `state`.
   */
  async search(user: string, chat: string, state: StoreState, env: FoldEnv, words: string, opts: { kind?: FoundKind; limit: number }): Promise<Found[]> {
    const said = wordsOf(words);
    if (said.length === 0) return [];
    const r = readingOf(state, env);
    if (r === null) return [];
    const key = `${user}\u0000${chat}`;
    let held = this.#followed.get(key)?.state?.deref();
    if (held === undefined || held.world.revision !== state.world.revision) {
      await this.follow(user, chat, state, env);
      held = state;
    }
    const different = held === state ? new Set<string>() : changedRefs(held, state);
    const whole = said.join(" ");
    const ask = (part: string, query: string): Promise<{ id: string }[]> => this.#index.search("facts", user, query, { scope: scopeOf(chat, part), limit: this.#candidates });
    const asked = [ask(NAMES, said.map((w) => `"${w}"`).join(" ")), ...said.flatMap((w) => [ask(NAMES, `"${w}"`), ask(REST, `"${w}"`)])];
    const refs = new Set<string>();
    for (const hits of await Promise.all(asked)) for (const h of hits) refs.add(refOfDoc(h.id));
    for (const ref of different) refs.add(ref);
    const found: Found[] = [];
    for (const ref of refs) {
      const t = thingOf(r, ref);
      if (t === null || t.gone || (opts.kind !== undefined && t.kind !== opts.kind)) continue;
      const hit = scoreThing(t, said, whole);
      if (hit !== null) found.push(hit);
    }
    return ordered(found, opts.limit);
  }
}

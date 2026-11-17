// The views of a character's record a definition's `given` list can name (plan §5.4, §7.1), as the
// shipped character definition names them inside `cast:self(...)`: the base with growth laid over it
// and the sources it was drawn from, growth alone, what is on the mind, how the character feels
// about those on stage, the perceptions it has not yet taken into memory, in full, the old mind
// files a migrated character carried, whole, until they are filed (§15.2), its game side as the world
// state holds it (`game.ts`), and its history as the Author recorded it. The same views of everyone
// on stage are what the Author is given of them (`castPresentViews`). Each is the record's own words,
// laid out by its prompt part in `.prompts/`; what goes in is decided by the record's marks and by who
// is on stage, which the caller says. Code ranks nothing and writes no word around the record's.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import type { ReadContext } from "../engine/registry";
import { isRecord } from "../shared/json";
import type { Store } from "../store";
import { beatsAt } from "./beats";
import { CAST_DEFAULTS, type CastClock, castClock, type CastSettings, datedAt } from "./kit";
import { castAt } from "./path";
import { awayItemId, baseHistory, baseOf, bindingsOf, type Casting, CASTINGS, type Character, castingInForce, CastRecord, chatLine, findCharacter, MIND_KINDS, nameKey, RELATIONSHIP_DIMENSIONS } from "./record";
import { gameSide } from "./game";
import { towardName } from "./refs";
import { worldAt } from "./secrets";
import { fileName, importedFiles, importedText, isFiled } from "./imported";
import { memoriesNow, type MemoryNow, strongestFirst, type Tier, touches, untakenPerceptions } from "./memory";
import { perceptionView } from "./perceive";
import type { MemorySearch } from "./search";
import { type SourceReader, sourcesNow } from "./sources";

/** What a view's layout is asked: to lay its fields out as text. The guidance's template part is one. */
export interface Layout {
  render(fields: Readonly<Record<string, JsonValue | undefined>>): { text: string };
}

/** Each view a `given` list can name, and the prompt part that lays it out. */
export const CAST_VIEWS = {
  base: "cast-base",
  growth: "cast-growth",
  mind: "cast-mind",
  "what-comes-to-mind": "cast-comes-to-mind",
  "relationships:present": "cast-relationships",
  "unprocessed-perceptions": "cast-perceptions",
  imported: "cast-imported",
  "game-side": "cast-game-side",
  history: "cast-history",
} as const;
export type CastViewName = keyof typeof CAST_VIEWS;

export interface CastViewInput {
  store: Store;
  user: string;
  chat: string;
  /** The turn read at; null at the chat's head. */
  turn: string | null;
  /** The job the agent given the views works in, if it works in one: what that job wrote is read at once. Another job's takes effect as the store places it (`CastRecord.read`). */
  job?: string | null;
  /** The character the views are of, by name or id. */
  character: string;
  /** Who is on stage, by name, for `relationships:present` and `what-comes-to-mind`. Who that is, is the caller's to say. */
  present: readonly string[];
  /** What else is present, in words, for `what-comes-to-mind`: the place, the things at hand, the topic. What that is, is the caller's to say. */
  cues?: readonly string[];
  /** Reads a bound source live in Lumiverse, for the sources shown with the base. */
  sources: SourceReader;
  /** Finds the memories a cue touches through the index file, for `what-comes-to-mind`; without it, every memory is read. */
  search?: MemorySearch;
  /** The prompt parts in force that lay the views out, by view. A view whose part is not given (switched off) is given no text. */
  layouts: Partial<Record<CastViewName, Layout>>;
  /** Settings over `CAST_DEFAULTS`: memory's, and what comes to mind's budget. */
  settings?: Partial<CastSettings>;
  /** A text's tokens, by the harness's own count (the turn's), for what comes to mind's budget. */
  tokens: (text: string) => number;
}

export interface CastView {
  name: CastViewName;
  /** The view as laid out; empty when the record holds nothing for it. */
  text: string;
  /** For the base view: the version of each part it shows and the base's newest, so a view kept from it says which base it was drawn from. */
  version?: BaseVersions;
}

/** The versions of a base: each part's, and the newest (how many versions its parts have had written). */
export interface BaseVersions {
  parts: Record<string, number>;
  newest: number;
}

/** A list the layout shows under one heading: the heading's block is the object, its lines the items. */
type Listed = { items: JsonObject[] };

/** Fields of a layout. */
type ViewFields = Record<string, JsonValue | undefined>;

/**
 * Items the layout shows under one heading, or nothing for none. A list an item holds is put in as
 * an object's own value (`.`), so that a block on it shows once and `{{name}}` puts it in joined, as
 * the template syntax has it.
 */
function listed(items: JsonObject[]): Listed | undefined {
  if (items.length === 0) return undefined;
  return { items: items.map((item) => Object.fromEntries(Object.entries(item).map(([key, value]) => [key, Array.isArray(value) ? { ".": value } : value]))) };
}

/**
 * The older minds pack's notes of a character (`carried.ts`) as the layout shows them: each note, commitment, witnessed thing and
 * the latest mind with its date in story time where the clock shows one, and the people and places they name by what the world calls
 * them now (the id where it holds none). Every word is the pack's own; none is added.
 */
export function mindsShown(notes: JsonObject, ctx: ReadContext | null, clock: CastClock | null): JsonObject {
  const named = (id: unknown): string | undefined => (typeof id === "string" ? (ctx !== null && Object.hasOwn(ctx.state.entities, id) ? ctx.state.entities[id]?.name : undefined) ?? id : undefined);
  const placed = (id: unknown): string | undefined => (typeof id === "string" ? (ctx !== null && Object.hasOwn(ctx.world.places, id) ? ctx.world.places[id]?.name : undefined) ?? id : undefined);
  const dated = (at: unknown): { date: string } | Record<string, never> => (typeof at === "number" ? datedAt(clock, at) : {});
  const rows = (part: JsonValue | undefined): JsonObject[] => (Array.isArray(part) ? part.filter((x): x is JsonObject => isRecord(x)) : []);
  const out: JsonObject = {};
  if (typeof notes.summary === "string") out.summary = notes.summary;
  const kept = rows(notes.notes).map((n) => ({ text: n.text ?? "", salience: n.salience ?? null, ...dated(n.at) }));
  if (kept.length > 0) out.notes = kept;
  const owed = rows(notes.commitments).map((c) => ({ text: c.text ?? "", kind: c.kind ?? "", status: c.status ?? "", with: (Array.isArray(c.with) ? c.with : []).flatMap((w) => named(w) ?? []).join(", "), ...(typeof c.due === "number" ? { due: datedAt(clock, c.due).date ?? null } : {}), ...dated(c.made) }));
  if (owed.length > 0) out.commitments = owed;
  const seen = rows(notes.witness).map((w) => ({ what: w.what ?? "", how: w.how ?? "", ...(named(w.by) !== undefined ? { by: named(w.by) as string } : {}), ...(placed(w.place) !== undefined ? { place: placed(w.place) as string } : {}), ...dated(w.at) }));
  if (seen.length > 0) out.witness = seen;
  if (isRecord(notes.mind)) {
    const m = notes.mind;
    out.mind = { level: m.level ?? "", monologue: m.monologue ?? "", depiction: m.depiction ?? "", intent: m.intent ?? "", reactions: Array.isArray(m.reactions) ? m.reactions : [], ...(typeof m.mood === "string" ? { mood: m.mood } : {}), ...(placed(m.place) !== undefined ? { place: placed(m.place) as string } : {}), ...dated(m.at) };
  }
  return out;
}

/**
 * What comes to a character's mind in a scene (§7.4): what is at the top of their mind, in full, whatever
 * the budget; then the short-term memories that touch who and what is present, newest first; then the
 * long-term ones that touch them, strongest first, a faint one by its gist. After the top, as many, in
 * that order, as the layout holds within the budget, and how many more touch them. Matching is by tags
 * and words; the order is the tiers' and strength's arithmetic. The text grows with each memory, so the
 * most that fit is found by halving.
 */
function comesToMind(record: CastRecord, character: Character, clock: CastClock | null, head: ViewFields, cues: readonly string[], found: ReadonlySet<string> | null, s: CastSettings, tokens: (text: string) => number, layout: Layout): string {
  const memories = memoriesNow(record, character.id, clock?.now ?? null, s);
  // What the index found narrows what is read; the one rule of matching still settles which of those touch the cues.
  const touching = (tier: Tier): MemoryNow[] => memories.filter((m) => m.tier === tier && (found === null || found.has(m.item.id)) && touches(m.item, cues));
  const top = memories.filter((m) => m.tier === "top");
  const order = [...top, ...touching("short").reverse(), ...touching("long").sort(strongestFirst)];
  if (order.length === 0) return "";
  const line = (m: MemoryNow): JsonObject => ({
    id: m.item.id,
    ...(m.faint ? { gist: m.item.fields.gist ?? null, faint: true } : { text: m.item.fields.text ?? null }),
    ...(typeof m.item.fields.tone === "string" ? { tone: m.item.fields.tone } : {}),
    ...datedAt(clock, m.item.at),
  });
  const render = (k: number): string => {
    const shown = order.slice(0, k);
    const of = (tier: Tier): Listed | undefined => listed(shown.filter((m) => m.tier === tier).map(line));
    const left = order.length - k;
    return layout.render({ ...head, top: of("top"), short: of("short"), long: of("long"), ...(left > 0 ? { left: { count: left } } : {}) }).text.trimEnd();
  };
  // Top of mind stands whole outside the cut; the rest is cut to what the budget holds after it.
  let lo = top.length;
  let hi = order.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (tokens(render(mid)) <= s.comesToMindTokens) lo = mid;
    else hi = mid - 1;
  }
  return render(lo);
}

/**
 * The cast's views among `names`, in the order named, each laid out by its part; a name that is not
 * one of the cast's is left to whoever answers for it. Growth is laid over the base whenever the base
 * is shown (§7.1), so `growth` beside `base` adds nothing.
 */
export async function castViews(names: readonly string[], input: CastViewInput): Promise<CastView[]> {
  const asked = names.filter((n): n is CastViewName => Object.hasOwn(CAST_VIEWS, n));
  if (asked.length === 0) return [];
  const { db } = input.store;
  const user = input.store.user(input.user);
  const character = findCharacter(db, input.user, chatLine(user, input.chat), input.character);
  if (character === null) return asked.map((name) => ({ name, text: "" }));
  const record = CastRecord.read(input.store, input.user, castAt(user, input.chat, input.turn), input.job ?? null);
  const clock = castClock(input.store, input.user, input.chat, input.turn);
  const settings: CastSettings = { ...CAST_DEFAULTS, ...(input.settings ?? {}) };
  const casting = castingInForce(record, character);
  const head: ViewFields = { name: character.name, ...(casting !== null ? { casting: casting.as } : {}), ...(casting?.line != null ? { line: casting.line } : {}) };
  // Each change with its date in story time, where the chat keeps a clock; one a reflection proposed counts once the Author accepts it.
  const growth = listed(
    record
      .of(character.id, "growth")
      .filter((g) => g.fields.proposed !== true)
      .map((g) => ({ ...g.fields, ...datedAt(clock, g.at) })),
  );

  const out: CastView[] = [];
  for (const name of asked) {
    let fields: ViewFields | null = null;
    let version: BaseVersions | undefined;
    if (name === "base") {
      const base = baseOf(db, input.user, character.id, input.chat);
      // The base's newest version: how many versions of its parts have been written, which any redraw of any part raises.
      const baseVersion = baseHistory(db, input.user, character.id, input.chat).length;
      const states = await sourcesNow(input.sources, { user: input.user, chat: input.chat }, bindingsOf(db, input.user, character.id), base.values());
      // Why a source is newer than the base: it is gone, it changed since it was drawn from, or it was bound after.
      const sources = listed(
        states.map((s) => ({
          kind: s.kind,
          id: s.ref,
          ...(s.defines !== null ? { defines: s.defines } : {}),
          ...(s.title === null ? { gone: true } : { title: s.title, ...(!s.newer ? {} : s.drawn === null ? { unseen: true } : { changed: true }) }),
        })),
      );
      const parts = Object.fromEntries([...base].map(([part, v]) => [part, v.text]));
      if (casting !== null || base.size > 0 || growth !== undefined || sources !== undefined) {
        // Each part's version, for the cast beside the view: a view kept from it says which base it was drawn from.
        const partVersions = Object.fromEntries([...base].map(([part, v]) => [part, v.version]));
        fields = { ...head, ...parts, ...Object.fromEntries(Object.entries(partVersions).map(([part, v]) => [`${part}_version`, v])), version: baseVersion, growth, sources, ...(states.some((s) => s.newer) ? { older: true } : {}) };
        version = { parts: partVersions, newest: baseVersion };
      }
    } else if (name === "growth") {
      if (!asked.includes("base") && growth !== undefined) fields = { ...head, growth };
    } else if (name === "mind") {
      // The kinds the layout shows; a carried mind file is the `imported` view's, never an empty heading here.
      const mind = record.of(character.id, "mind").filter((m) => (MIND_KINDS as readonly unknown[]).includes(m.fields.kind));
      const kinds = Object.fromEntries(MIND_KINDS.map((kind) => [kind, listed(mind.filter((m) => m.fields.kind === kind).map((m) => m.fields))]));
      if (mind.length > 0) fields = { ...head, ...kinds };
    } else if (name === "what-comes-to-mind") {
      const layout = input.layouts[name];
      const people = input.present.filter((p) => nameKey(p) !== nameKey(character.name));
      const cued = [...people, ...(input.cues ?? [])];
      const found = layout === undefined || input.search === undefined ? null : await input.search.candidates(input.user, record, character.id, cued);
      out.push({ name, text: layout === undefined ? "" : comesToMind(record, character, clock, head, cued, found, settings, input.tokens, layout) });
      continue;
    } else if (name === "unprocessed-perceptions") {
      // In full, oldest first, each with its date in story time where the clock shows one.
      const perceptions = listed(untakenPerceptions(record, character.id).map((p) => ({ ...perceptionView({ record }, p), ...datedAt(clock, p.at) })));
      if (perceptions !== undefined) fields = { ...head, perceptions };
    } else if (name === "imported") {
      // Whole, word for word, each under its name, outside every budget, until it is marked filed. The older minds pack's notes of the
      // character are one more such file: laid out under their own heading, with the names and dates the world gives them now.
      const waiting = importedFiles(record, character.id).filter((f) => !isFiled(f));
      const files = listed(waiting.flatMap((f) => (isRecord(f.fields.minds) ? [] : [{ file: fileName(f), text: importedText(db, input.user, f) ?? "" }])));
      const minds = waiting.find((f) => isRecord(f.fields.minds));
      const notes = minds === undefined ? undefined : mindsShown(minds.fields.minds as JsonObject, worldAt(input.store, input.user, input.turn, input.job ?? null, input.chat), clock);
      if (files !== undefined || notes !== undefined) fields = { ...head, ...(files !== undefined ? { files } : {}), ...(notes !== undefined ? { minds: notes } : {}) };
    } else if (name === "relationships:present") {
      const here = new Set(input.present.map(nameKey));
      here.delete(nameKey(character.name));
      // Toward a person by reference: called by the name they have now, whatever the relationship was first written under.
      const ctx = worldAt(input.store, input.user, input.turn, input.job ?? null, input.chat);
      const chats = chatLine(user, input.chat);
      // A dimension is given as words, so that a 0 shows as one.
      const shown = record
        .of(character.id, "relationship")
        .flatMap((r) => {
          const toward = towardName(db, input.user, chats, ctx, r);
          return toward !== null && here.has(nameKey(toward)) ? [{ ...r.fields, with: toward, ...Object.fromEntries(RELATIONSHIP_DIMENSIONS.flatMap((d) => (typeof r.fields[d] === "number" ? [[d, String(r.fields[d])]] : []))) }] : [];
        });
      const relationships = listed(shown);
      if (relationships !== undefined) fields = { ...head, relationships };
    } else if (name === "history") {
      // The Author's record of their story, oldest first, each with its date in story time where the clock shows one, and each beat it is linked to with the words for when the story record has for it.
      const rows = record.of(character.id, "history");
      const history = listed(rows.map((h) => ({ ...h.fields, ...datedAt(clock, h.at) })));
      if (history !== undefined) {
        const beats = new Map((beatsAt(input.store, input.user, record.at, input.job ?? null) ?? []).map((b) => [b.id, b.time]));
        for (const [i, item] of history.items.entries()) {
          const ids = rows[i]?.fields.beats;
          const linked = (Array.isArray(ids) ? ids : []).flatMap((id): JsonObject[] => (typeof id === "string" ? [{ id, ...(typeof beats.get(id) === "string" ? { when: beats.get(id) as string } : {}) }] : []));
          if (linked.length > 0) item.linked = linked;
        }
        fields = { ...head, history };
      }
    } else if (name === "game-side") {
      const side = gameSide(input.store, input.user, input.chat, input.turn, character);
      // A principal out of view: where it is and what it means to do, as the Author recorded them, shown beside where the state places it.
      const gone = record.items.get(awayItemId(character.id));
      const away = gone === undefined || gone.dropped ? undefined : Object.fromEntries(["whereabouts", "intention", "until"].flatMap((k) => (typeof gone.fields[k] === "string" ? [[k, gone.fields[k]]] : [])));
      if (side !== null || (away !== undefined && Object.keys(away).length > 0)) fields = { ...head, ...(side ?? {}), ...(away !== undefined && Object.keys(away).length > 0 ? { away } : {}) };
    }
    const layout = input.layouts[name];
    out.push({ name, text: fields === null || layout === undefined ? "" : layout.render(fields).text.trimEnd(), ...(version !== undefined ? { version } : {}) });
  }
  return out;
}

/** A view of those on stage, as given: its name as the guidance named it, and each character's view laid out, one after another. */
export interface CastPresentView {
  name: string;
  text: string;
}

/** A name of `castPresentViews` read: the view, and the casting it is narrowed to (null: everyone on stage); null when it names no view of the cast's. */
function presentView(name: string): { view: CastViewName; casting: Casting | null } | null {
  if (Object.hasOwn(CAST_VIEWS, name)) return { view: name as CastViewName, casting: null };
  const at = name.lastIndexOf(":");
  const view = name.slice(0, at);
  const casting = name.slice(at + 1);
  return at > 0 && Object.hasOwn(CAST_VIEWS, view) && (CASTINGS as readonly string[]).includes(casting) ? { view: view as CastViewName, casting: casting as Casting } : null;
}

/**
 * The cast's views of the characters on stage (plan §7.1, §15.2), for whoever is given them; as the
 * plan has it, the Author: `history` for each one on stage the cast holds, `history:principal` for
 * those cast so, and any other view of `CAST_VIEWS` alike (`imported:supporting`: the old mind files
 * of a supporting character, who has no agent of their own to be given them). Each character's view
 * is laid out by its part, one after another, in the order the stage names them. Which views, of
 * which castings, is the guidance's to name; a name that is none of these is left to others.
 */
export async function castPresentViews(names: readonly string[], input: Omit<CastViewInput, "character">): Promise<CastPresentView[]> {
  const asked = names.flatMap((name) => {
    const read = presentView(name);
    return read === null ? [] : [{ name, ...read }];
  });
  if (asked.length === 0) return [];
  const { db } = input.store;
  const user = input.store.user(input.user);
  const chats = chatLine(user, input.chat);
  const record = CastRecord.read(input.store, input.user, castAt(user, input.chat, input.turn), input.job ?? null);
  // Each character on stage the cast holds, once, in the stage's order, with the casting in force.
  const onStage = new Map<string, Casting | null>();
  for (const said of input.present) {
    const character = findCharacter(db, input.user, chats, said);
    if (character !== null && !onStage.has(character.id)) onStage.set(character.id, castingInForce(record, character)?.as ?? null);
  }
  const out: CastPresentView[] = [];
  for (const { name, view, casting } of asked) {
    const texts: string[] = [];
    for (const [id, as] of onStage) {
      if (casting !== null && as !== casting) continue;
      const [one] = await castViews([view], { ...input, character: id });
      if (one !== undefined && one.text !== "") texts.push(one.text);
    }
    out.push({ name, text: texts.join("\n\n") });
  }
  return out;
}

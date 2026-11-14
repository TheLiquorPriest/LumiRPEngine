// The views of a character's record a definition's `given` list can name (plan §5.4, §7.1), as the
// shipped character definition names them inside `cast:self(...)`: the base with growth laid over it
// and the sources it was drawn from, growth alone, what is on the mind, and how the character feels
// about those on stage. Each is the record's own words, laid out by its prompt part in `.prompts/`;
// what goes in is decided by the record's marks and by who is on stage, which the caller says. Code
// ranks nothing and writes no word around the record's.

import type { TemplatePart } from "rp-harness";
import type { JsonObject, JsonValue } from "rp-harness/contract";
import type { Store } from "../store";
import { castClock } from "./kit";
import { castAt } from "./path";
import { baseOf, bindingsOf, castingInForce, CastRecord, chatLine, findCharacter, MIND_KINDS, nameKey, RELATIONSHIP_DIMENSIONS } from "./record";
import { type SourceReader, sourcesNow } from "./sources";

/** Each view a `given` list can name, and the prompt part that lays it out. */
export const CAST_VIEWS = {
  base: "cast-base",
  growth: "cast-growth",
  mind: "cast-mind",
  "relationships:present": "cast-relationships",
} as const;
export type CastViewName = keyof typeof CAST_VIEWS;

export interface CastViewInput {
  store: Store;
  user: string;
  chat: string;
  /** The turn read at; null at the chat's head. */
  turn: string | null;
  /** The character the views are of, by name or id. */
  character: string;
  /** Who is on stage, by name, for `relationships:present`. Who that is, is the caller's to say. */
  present: readonly string[];
  /** Reads a bound source live in Lumiverse, for the sources shown with the base. */
  sources: SourceReader;
  /** The prompt parts in force that lay the views out, by view. A view whose part is not given (switched off) is given no text. */
  layouts: Partial<Record<CastViewName, Pick<TemplatePart, "render">>>;
}

export interface CastView {
  name: CastViewName;
  /** The view as laid out; empty when the record holds nothing for it. */
  text: string;
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
  const record = CastRecord.read(db, input.user, castAt(user, input.chat, input.turn));
  const clock = castClock(input.store, input.user, input.chat, input.turn);
  const casting = castingInForce(record, character);
  const head: ViewFields = { name: character.name, ...(casting !== null ? { casting: casting.as } : {}), ...(casting?.line != null ? { line: casting.line } : {}) };
  // Each change with its date in story time, where the chat keeps a clock.
  const growth = listed(record.of(character.id, "growth").map((g) => ({ ...g.fields, ...(g.at !== null && clock !== null ? { date: clock.text(g.at) } : {}) })));

  const out: CastView[] = [];
  for (const name of asked) {
    let fields: ViewFields | null = null;
    if (name === "base") {
      const base = baseOf(db, input.user, character.id);
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
      if (casting !== null || base.size > 0 || growth !== undefined || sources !== undefined) fields = { ...head, ...parts, growth, sources, ...(states.some((s) => s.newer) ? { older: true } : {}) };
    } else if (name === "growth") {
      if (!asked.includes("base") && growth !== undefined) fields = { ...head, growth };
    } else if (name === "mind") {
      const mind = record.of(character.id, "mind");
      const kinds = Object.fromEntries(MIND_KINDS.map((kind) => [kind, listed(mind.filter((m) => m.fields.kind === kind).map((m) => m.fields))]));
      if (mind.length > 0) fields = { ...head, ...kinds };
    } else {
      const here = new Set(input.present.map(nameKey));
      here.delete(nameKey(character.name));
      // A dimension is given as words, so that a 0 shows as one.
      const shown = record
        .of(character.id, "relationship")
        .filter((r) => typeof r.fields.with === "string" && here.has(nameKey(r.fields.with)))
        .map((r) => ({ ...r.fields, ...Object.fromEntries(RELATIONSHIP_DIMENSIONS.flatMap((d) => (typeof r.fields[d] === "number" ? [[d, String(r.fields[d])]] : []))) }));
      const relationships = listed(shown);
      if (relationships !== undefined) fields = { ...head, relationships };
    }
    const layout = input.layouts[name];
    out.push({ name, text: fields === null || layout === undefined ? "" : layout.render(fields).text.trimEnd() });
  }
  return out;
}

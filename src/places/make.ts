// A new place, made with the `place` operation (plan §8.2, §6.1, §10.5): the Author or the GM gives its name, what kind of place it is
// and the place it is inside, and where it comes from. In the same write the entries the call names are bound to it, each with the aspect
// of the place it defines, and its base is recorded drawn against them. A `place` kind is a place of this chat's own world, inside another
// or in none; a room, a spot or a venue is made in play inside a place (today's place ops). Where it comes from is its provenance, as on
// every write: a lore entry cited, or an invention with its gap check and consent, else marked so or unsourced; nothing is refused for
// it. A place of that name already in the same place is told of in a report, never taken for it, and so is one past the chat's number.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { isRecord } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import { PLACE_KINDS, type PlaceKind } from "../shared/things";
import { baseWorld, findPlaces, placeOp } from "../engine/places-in-play";
import { chatDraftOf, draftEvent } from "../engine/world-draft";
import { find, findOptional, isUnread, notAs, type OpContext, refusedAs, textArg, type Unread } from "../iface/ops";
import { freshId } from "../iface/ops-things";
import { PROVENANCE_PROPERTIES } from "../iface/source";
import { textOf } from "../iface/texts";
import { PLACE_OPS } from "./fold";
import { namedEntries } from "./prepare";

/** The kinds a place is made as: `place`, a place of the chat's own world; a room, a spot or a venue, made in play inside a place. */
export const PLACE_MAKE_KINDS: readonly string[] = ["place", ...PLACE_KINDS];

/** What `place` reads when it makes a place: its name and kind, where it is, where it comes from, its words, its fields, its owner and why a place made in play was made. */
const MAKE_READS: readonly string[] = ["op", "name", "kind", "at", "in", "sources", "description", "base", "fields", "owner", "why", ...Object.keys(PROVENANCE_PROPERTIES)];

/** The entries a call names as where a place comes from, each with the aspect it defines: a list of entry ids, or of `{ entry, aspect }`. */
export function sourcesArg(o: OpContext): { entry: string; aspect: string }[] | Unread | undefined {
  const given = o.args.sources;
  if (given === undefined || given === null) return undefined;
  if (!Array.isArray(given)) return notAs(o, "sources", given, "sources");
  const out: { entry: string; aspect: string }[] = [];
  for (const s of given) {
    const entry = typeof s === "string" ? s.trim() : isRecord(s) && typeof s.entry === "string" ? s.entry.trim() : "";
    if (entry === "") return notAs(o, "sources", s ?? null, "sources");
    out.push({ entry, aspect: isRecord(s) && typeof s.aspect === "string" ? s.aspect.trim() : "" });
  }
  return out;
}

/**
 * Makes the place `name` of `kind` inside the place `at` (or `in`) names, which an earlier operation of the call may have made: the
 * world's draft or today's place op writes it, the entries named are bound to it, and the words the call gives (its `description`, or
 * its `base`) are its base, drawn against those entries as Lumiverse holds them now.
 */
export function makePlace(o: OpContext, name: string, kind: string): Unread | undefined {
  const w = o.draft.w;
  const field = o.args.at !== undefined && o.args.at !== null ? "at" : o.args.in !== undefined && o.args.in !== null ? "in" : null;
  const within = field === null ? undefined : find(o, field, "place");
  if (isUnread(within)) return within;
  const owner = findOptional(o, "owner", "entity");
  if (isUnread(owner)) return owner;
  const sources = sourcesArg(o);
  if (isUnread(sources)) return sources;
  const words = textArg(o.args, "base") ?? textArg(o.args, "description");
  const given = o.args.fields;
  if (given !== undefined && given !== null && !isRecord(given)) return notAs(o, "fields", given, "fields");
  const fields: JsonObject = { ...(isRecord(given) ? given : {}), ...(owner ? { owner: owner.id } : {}) };
  // The base is its own part of the place's record, never a field of the place.
  delete fields.description;
  const from = w.events.length;
  let made: string | undefined;
  if (kind === "place") {
    const parent = within?.id ?? null;
    const twins = findPlaces(w.ctx, name, parent !== null ? { parent } : {}).filter((h) => h.matched !== "head" && h.parent === parent);
    const id = freshId(o, name);
    made = id;
    const value: JsonObject = { id, name, ...(parent !== null ? { parent } : {}), fields };
    const bad = o.draft.applyAll([draftEvent(baseWorld(w.ctx.world), chatDraftOf(w.state), { collection: "places", id, value })]);
    if (bad) return refusedAs(o, bad, field ?? "at", "place");
    if (twins.length > 0) o.draft.adviseOp(o.n, { code: "same_name", values: { name, same: twins.map((t) => `${t.name} [${t.id}]`).join(", ") } });
  } else {
    if (within === undefined) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["at"] } };
    const out = placeOp(w.ctx, { do: "make", name, parent: within.id, as: kind as PlaceKind, why: textArg(o.args, "why") ?? "" }, { by: o.call.agent.definition, salt: o.draft.seed(o.n), advise: true, cap: o.call.settings.placeCap });
    if ("code" in out) return refusedAs(o, out, field ?? "at", "place");
    // The call's fields go on the place with what today's place op writes (its aliases, entry), which stands where both name one.
    const events = out.events.map((e): LedgerEvent => ("data" in e && isRecord(e.data.def) ? { ...e, data: { ...e.data, def: { ...e.data.def, fields: { ...fields, ...(isRecord(e.data.def.fields) ? e.data.def.fields : {}) } } } } : e));
    const bad = o.draft.applyAll(events);
    if (bad) return refusedAs(o, bad, field ?? "at", "place");
    made = out.made;
    for (const advice of out.advice ?? []) o.draft.adviseOp(o.n, advice);
  }
  const unread = Object.keys(o.args).filter((k) => !MAKE_READS.includes(k));
  if (unread.length > 0) o.draft.adviseOp(o.n, { code: "place_unread", values: { unread: textOf(unread) } });
  o.draft.record(o.n, o.op, "engine", o.prov, from, made !== undefined ? { made } : {});
  if (made === undefined) return undefined;
  // Its sources and its base, in the same write: the entries bound with their aspects, the words drawn against what they are now.
  const named = namedEntries(o.call);
  if (sources !== undefined && sources.length > 0) {
    o.draft.recordStoreOp(o.n, o.op, "engine", o.prov, { op: PLACE_OPS.source, value: { place: made, sources } as unknown as JsonValue });
    const gone = sources.filter((s) => named.get(s.entry) === null).map((s) => s.entry);
    if (gone.length > 0) o.draft.adviseOp(o.n, { code: "source_unknown", values: { entries: textOf(gone) } });
  }
  if (words !== undefined) {
    const drawn: Record<string, string> = {};
    for (const s of sources ?? []) {
      const revision = named.get(s.entry);
      if (revision !== undefined && revision !== null) drawn[s.entry] = revision;
    }
    o.draft.recordStoreOp(o.n, o.op, "engine", o.prov, { op: PLACE_OPS.base, value: { place: made, text: words, drawn } });
  }
  return undefined;
}

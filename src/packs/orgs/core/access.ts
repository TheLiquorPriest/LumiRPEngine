// Entry to the places organizations hold, and trespass (ORG-SPEC §3.9, §4.4 Premises, §4.6). A
// place's entry and keys are its own fields in the world, and play may set them over the world's
// (`orgs.entry`, kept in `packs.orgs.entry[place]`): the GM's effect of the same name, and a member's
// Change entry (`org_entry`, at once with Undo, behind `property.manage`), each with its History
// line. An entry the story tells without leave is recorded (`orgs.trespass`, the last 20 a place,
// in `packs.orgs.trespass[place]`), through the space pack's `space.trespass`; the player's line
// names it when it is theirs or they are there. The Premises section (`premises`) is what the
// Property tab draws: each place it holds, with who may enter, hours, keys and who carries them;
// GM → Places shows the same for every place, with whose it is (`orgs.place_entry`). Who may enter
// is `engine/entry.ts`'s, pure; this pack keeps the records.

import type { EntityId, PlaceId } from "../../../shared/ids";
import type { JsonObject, JsonValue } from "../../../shared/json";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import { AS_THE_WORLD, AUDIENCES, ENTRY_WORDS, isAudience, NO_KEYS, ORG_ENTRY_ACTION, ORGS_ENTRY } from "../../../shared/org";
import type { GmPlaceEntry, PremisesView, PremiseView } from "../../../shared/org-view";
import { listWords } from "../../../shared/words";
import type { LintIssue } from "../../../shared/protocol";
import type { WorldDoc } from "../../../shared/world";
import { calendarOf, formatClock, formatTimeOfDay, weekdayName } from "../../../engine/calendar";
import { entryClosed, keyHolders, placeKeys, placeOwnersOf } from "../../../engine/entry";
import { businessAt, ENTRY_KEY, entryInPlay, hoursOf, orgPlaces, orgPower, orgTypeOf, placeEntry, setEntryOf, tradingDays } from "../../../engine/org";
import { labelOf, numOf, objOf, own, rowOf, sliceOf, sliceRecord, strOf } from "../../../engine/pack-kit";
import type { CoreRegistry, EventTypeDef, ReadContext, Rejection } from "../../../engine/registry";
import { placeOfEntity, placeWithin } from "../../../engine/scope";
import { TYPE_TABLES } from "../../../shared/items-build";
import { canSeeEntity, canSeePlace } from "../../../engine/visibility";
import { together } from "../../../engine/presence";
import { orgLog } from "./log";

declare module "../../../engine/registry" {
  interface QueryMap {
    /** Who may enter a place, and whose it is, for GM → Places (`GmView.places[].entry`). */
    "orgs.place_entry": (ctx: ReadContext, place: PlaceId) => GmPlaceEntry;
  }
}

export const ORGS_TRESPASS = "orgs.trespass";
/** The Premises section's id (`OrgView.sections`). */
export const PREMISES_SECTION = "premises";
/** Trespasses kept per place. */
export const TRESPASS_KEPT = 20;

// ---------------------------------------------------------------- reading what is set

/** An entry change's keys as an effect is given them: a list or words between commas; `default` back to the world's (null); `none` for no keys ([]); absent, unchanged. */
function keysArg(v: JsonValue | undefined): string[] | null | undefined | Rejection {
  if (v === undefined || v === null) return undefined;
  if (v === AS_THE_WORLD) return null;
  if (v === NO_KEYS) return [];
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : null;
  if (list === null || list.some((k) => typeof k !== "string")) return { code: "bad_args", reason: "keys are item ids or item types" };
  return [...new Set(list.map((k) => String(k).trim()).filter((k) => k !== ""))];
}

/** A key in words: a thing's name as the reader may see it, else an item type's name, else the words written. */
function keyWords(ctx: ReadContext, key: string, viewer: EntityId | null): string {
  const thing = own(ctx.state.entities, key);
  if (thing) return viewer === null || canSeeEntity(ctx.registry, ctx.world, ctx.state, viewer, key) ? thing.name : "a key";
  for (const table of TYPE_TABLES) {
    const name = rowOf(ctx, table, key)?.name;
    if (typeof name === "string" && name !== "") return name;
  }
  return key.replace(/_/g, " ");
}

/** Who may enter a place in the Premises' words: the entry set, else the business's hours rule, else anyone. */
function entryWords(ctx: ReadContext, place: PlaceId): string {
  const set = setEntryOf(ctx, place);
  if (set) return ENTRY_WORDS[set.entry];
  return businessAt(ctx, place) !== null ? "Customers while it trades; staff only after hours" : "Anyone";
}

/** A business's trading days and hours in words: "Mon to Sat, 9:00 AM to 5:00 PM". */
export function hoursWords(ctx: ReadContext, business: EntityId): string {
  const cal = calendarOf(ctx.world);
  const days = [...tradingDays(ctx.state, business)].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const d of days) {
    const last = runs.at(-1);
    if (last && last.at(-1) === d - 1) last.push(d);
    else runs.push([d]);
  }
  const dayWords = listWords(runs.map((r) => (r.length > 2 ? `${weekdayName(cal, r[0] ?? 0)} to ${weekdayName(cal, r.at(-1) ?? 0)}` : r.map((d) => weekdayName(cal, d)).join(", "))));
  const { open, close } = hoursOf(ctx, business);
  return `${dayWords}, ${open === 0 && close === 24 * 60 ? "all day" : `${formatTimeOfDay(open)} to ${formatTimeOfDay(close)}`}`;
}

/** The organizations whose places hold `place`, in id order. */
function holdersOf(ctx: ReadContext, place: PlaceId): EntityId[] {
  return Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => orgTypeOf(ctx, id) !== null && orgPlaces(ctx, id).some((p) => placeWithin(ctx.world, place, p)));
}

// ---------------------------------------------------------------- changing entry

/**
 * One change to a place's entry and keys in play (the `orgs.entry` GM effect, and `org_entry`'s):
 * `entry` an audience, or `default` for the world's again; `keys` as `keysArg` reads them; `org`,
 * when given, must hold the place, and gets the History line (else every organization holding it
 * does); `by` who made it. Refused when it changes nothing. The line is worded as the player
 * character may see it: a key or a place hidden from them is "a key", "a place", never its name.
 */
function entryChange(ctx: ReadContext, a: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const place = strOf(a.place);
  if (!own(ctx.world.places, place)) return { code: "missing_place", reason: `no place ${labelOf(ctx, place)}` };
  const raw = a.entry;
  const entry = raw === undefined || raw === null ? undefined : raw === AS_THE_WORLD ? null : isAudience(raw) ? raw : false;
  if (entry === false) return { code: "bad_args", reason: `who may enter is one of ${AUDIENCES.join(", ")}, or ${AS_THE_WORLD}` };
  const keys = keysArg(a.keys);
  if (keys !== null && keys !== undefined && !Array.isArray(keys)) return keys;
  if (entry === undefined && keys === undefined) return { code: "bad_args", reason: "an entry change needs who may enter or its keys" };
  const org = strOf(a.org);
  if (org !== "" && !orgPlaces(ctx, org).some((p) => placeWithin(ctx.world, place, p))) return { code: "not_its_place", reason: `${labelOf(ctx, place)} isn't one of ${labelOf(ctx, org)}'s places` };
  const now = entryInPlay(ctx.state, place);
  const sameEntry = entry === undefined || (entry === null ? now.entry === undefined : now.entry === entry);
  const sameKeys = keys === undefined || (keys === null ? now.keys === undefined : JSON.stringify(now.keys ?? null) === JSON.stringify(keys));
  if (sameEntry && sameKeys) return { code: "no_change", reason: "it is so already" };
  const by = strOf(a.by);
  const actor = by !== "" && own(ctx.state.entities, by) ? by : null;
  const data: JsonObject = { place, ...(entry !== undefined ? { entry } : {}), ...(keys !== undefined ? { keys } : {}), ...(actor !== null ? { by: actor } : {}), visibility: "secret" };
  const pov = ctx.world.pov;
  const said = [
    ...(entry === undefined ? [] : [entry === null ? "who may enter as the world has it" : `who may enter: ${ENTRY_WORDS[entry].toLowerCase()}`]),
    ...(keys === undefined ? [] : [keys === null ? "its keys as the world has them" : keys.length === 0 ? "no keys" : `keys: ${listWords(keys.map((k) => keyWords(ctx, k, pov)))}`]),
  ].join("; ");
  const where = canSeePlace(ctx.registry, ctx.world, ctx.state, pov, place) ? (own(ctx.world.places, place)?.name ?? place) : actor !== null ? "a place" : "A place";
  const text = `${actor !== null ? `${labelOf(ctx, actor)} set ` : ""}${where}: ${said}`;
  const logs = (org !== "" ? [org] : holdersOf(ctx, place)).map((o) => orgLog(ctx, o, text, actor !== null ? { by: actor, names: [actor] } : {}));
  return [{ type: ORGS_ENTRY, data }, ...logs];
}

// ---------------------------------------------------------------- the records

function str(e: PackEvent, key: string): string {
  return strOf(e.data[key]);
}

const ENTRY_EVENT: EventTypeDef<PackEvent> = {
  // A place's entry and keys set in play over the world's: null puts either back.
  type: ORGS_ENTRY,
  validate: (e, ctx) => {
    if (!own(ctx.world.places, str(e, "place"))) return { code: "missing_place", reason: `no place ${labelOf(ctx, str(e, "place"))}` };
    const entry = e.data.entry;
    const keys = e.data.keys;
    if (entry !== undefined && entry !== null && !isAudience(entry)) return { code: "bad_event", reason: "an entry is an audience" };
    if (keys !== undefined && keys !== null && !(Array.isArray(keys) && keys.every((k) => typeof k === "string"))) return { code: "bad_event", reason: "keys are item ids or item types" };
    return entry === undefined && keys === undefined ? { code: "bad_event", reason: "an entry change changes who may enter or the keys" } : null;
  },
  apply: (e, state) => {
    const all = sliceRecord(state, "orgs", ENTRY_KEY);
    const place = str(e, "place");
    const rec: JsonObject = { ...objOf(all[place]) };
    if (e.data.entry === null) delete rec.entry;
    else if (isAudience(e.data.entry)) rec.entry = e.data.entry;
    if (e.data.keys === null) delete rec.keys;
    else if (Array.isArray(e.data.keys)) rec.keys = [...e.data.keys];
    if (Object.keys(rec).length === 0) delete all[place];
    else all[place] = rec;
  },
  describe: (e, ctx) => {
    const entry = e.data.entry;
    return `${labelOf(ctx, str(e, "place"))}: ${isAudience(entry) ? ENTRY_WORDS[entry].toLowerCase() : entry === null ? "entry as the world has it" : "keys changed"}`;
  },
};

const TRESPASS_EVENT: EventTypeDef<PackEvent> = {
  // Someone the story put somewhere without leave, kept with the place: the last 20.
  type: ORGS_TRESPASS,
  validate: (e, ctx) => {
    const who = str(e, "entity");
    const place = str(e, "place");
    if (!own(ctx.state.entities, who)) return { code: "missing_entity", reason: `no entity ${labelOf(ctx, who)}` };
    if (!own(ctx.world.places, place)) return { code: "missing_place", reason: `no place ${labelOf(ctx, place)}` };
    const at = placeOfEntity(ctx.state, who);
    return at !== null && placeWithin(ctx.world, at, place) ? null : { code: "not_there", reason: `${labelOf(ctx, who)} isn't at ${labelOf(ctx, place)}` };
  },
  apply: (e, state) => {
    const all = sliceRecord(state, "orgs", "trespass");
    const place = str(e, "place");
    const before = all[place];
    all[place] = [...(Array.isArray(before) ? before.slice(-(TRESPASS_KEPT - 1)) : []), { who: str(e, "entity"), at: typeof e.data.at === "number" ? e.data.at : state.clock }];
  },
  describe: (e, ctx, viewer) => {
    const who = str(e, "entity");
    const place = str(e, "place");
    const where = viewer === undefined || canSeePlace(ctx.registry, ctx.world, ctx.state, viewer, place) ? labelOf(ctx, place) : "a place";
    const name = who === viewer ? "You" : viewer === undefined || canSeeEntity(ctx.registry, ctx.world, ctx.state, viewer, who) ? labelOf(ctx, who) : "Someone";
    return `${name} entered ${where} without leave`;
  },
};

/** The record of `who` entering `place` without leave (`space.trespass`): the player's line when it is theirs or they are there, else kept from them. */
function trespassEvents(ctx: ReadContext, who: EntityId, place: PlaceId): LedgerEvent[] {
  const pov = ctx.world.pov;
  const seen = who === pov || together(ctx.world, placeOfEntity(ctx.state, pov), place);
  return [{ type: ORGS_TRESPASS, data: { entity: who, place, at: ctx.state.clock, visibility: seen ? "public" : "secret" } }];
}

/** The latest trespasses kept for a place, newest first. */
export function trespassesAt(state: ReadContext["state"], place: PlaceId): { who: EntityId; at: number }[] {
  const lines = objOf(sliceOf(state, "orgs").trespass)[place];
  return Array.isArray(lines) ? lines.map((l) => ({ who: strOf(objOf(l).who), at: numOf(objOf(l).at) })).reverse() : [];
}

// ---------------------------------------------------------------- the Premises

/** One place as `viewer` sees who may enter it (the GM, null, sees all); its trespasses only for a reader who may change its entry. */
function premiseOf(ctx: ReadContext, id: PlaceId, viewer: EntityId | null, canChange: boolean): PremiseView {
  const seesWho = (who: EntityId): boolean => viewer === null || who === viewer || canSeeEntity(ctx.registry, ctx.world, ctx.state, viewer, who);
  const set = setEntryOf(ctx, id);
  const inPlay = entryInPlay(ctx.state, id);
  const business = businessAt(ctx, id);
  const closed = entryClosed(ctx, id);
  const keysSet = placeKeys(ctx, id);
  const carriers = keyHolders(ctx, id).map((k) => k.who).filter((who, i, all) => all.indexOf(who) === i);
  const cal = calendarOf(ctx.world);
  return {
    id,
    name: own(ctx.world.places, id)?.name ?? id,
    entry: set?.entry ?? null,
    from: set && set.at !== id ? (own(ctx.world.places, set.at)?.name ?? set.at) : null,
    playEntry: inPlay.entry ?? null,
    inPlay: inPlay.entry !== undefined || inPlay.keys !== undefined,
    words: entryWords(ctx, id),
    now: closed === null ? (placeEntry(ctx, id, ctx.state.clock) === "customers" ? "Open to customers now" : "Open to anyone now") : `${ENTRY_WORDS[closed]} now`,
    hours: business !== null ? hoursWords(ctx, business) : null,
    keys: keysSet.map((k) => keyWords(ctx, k, viewer)),
    keysSet,
    carriers: carriers.filter(seesWho).map((who) => ({ id: who, name: labelOf(ctx, who) })),
    hiddenCarriers: carriers.filter((who) => !seesWho(who)).length,
    trespass: canChange
      ? trespassesAt(ctx.state, id)
          .slice(0, 5)
          .map((t) => ({ who: t.who === viewer ? "You" : seesWho(t.who) ? labelOf(ctx, t.who) : "Someone", at: formatClock(cal, t.at) }))
      : [],
  };
}

/** An organization's Premises as `viewer` may see them (the GM, null, sees all); null when it holds no place the reader can see. */
export function buildPremises(ctx: ReadContext, org: EntityId, viewer: EntityId | null): PremisesView | null {
  const places = orgPlaces(ctx, org).filter((p) => viewer === null || canSeePlace(ctx.registry, ctx.world, ctx.state, viewer, p));
  if (places.length === 0) return null;
  const canChange = viewer === null || orgPower(ctx, viewer, org, "property.manage") !== null;
  return { canChange, places: places.map((id) => premiseOf(ctx, id, viewer, canChange)) };
}

/** Who may enter a place as GM → Places shows it: as the Premises do, with whose it is. */
export function buildPlaceEntry(ctx: ReadContext, place: PlaceId): GmPlaceEntry {
  return { ...premiseOf(ctx, place, null, true), owners: placeOwnersOf(ctx, place).map((o) => labelOf(ctx, o)) };
}

// ---------------------------------------------------------------- lint

/** Places whose entry or keys a world sets in a shape nothing reads (§3.9). */
function entryLint(world: WorldDoc): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const [id, p] of Object.entries(world.places)) {
    const entry = p.fields.entry;
    if (entry !== undefined && !isAudience(entry)) issues.push({ severity: "warning", code: "entry_unknown", message: `${p.name}'s entry is ${JSON.stringify(entry)}, not one of ${AUDIENCES.join(", ")}: it is read as unset.`, path: `places.${id}.fields.entry` });
    const keys = p.fields.keys;
    if (keys !== undefined && !(Array.isArray(keys) && keys.every((k) => typeof k === "string" && k.trim() !== ""))) issues.push({ severity: "warning", code: "keys_shape", message: `${p.name}'s keys aren't a list of item ids or item types, so no one carries one.`, path: `places.${id}.fields.keys` });
  }
  return issues;
}

// ---------------------------------------------------------------- registration

/** The orgs pack's entry and trespass: its events, the record `space.trespass` asks for, the GM's and a member's entry change, the Premises section, GM → Places' read and its lint. */
export function registerAccess(r: CoreRegistry): void {
  r.event(ENTRY_EVENT);
  r.event(TRESPASS_EVENT);
  r.service("space.trespass", trespassEvents);
  // Who may enter a place and its keys, set in play over the world's (§3.9, §6.1): the GM's control in GM → Orgs and GM → Places, and any GM edit.
  r.effect({ type: ORGS_ENTRY, args: ["place", "entry?", "keys?", "org?", "by?"], gm: true, resolve: (a, ctx) => entryChange(ctx, a) });
  // Change entry (§4.4, §4.6): bookkeeping a holder of `property.manage` does at once, with its Undo.
  r.action({
    id: ORG_ENTRY_ACTION,
    label: "Change entry",
    description: "Change who may enter one of an organization's places, and its keys.",
    pack: "orgs",
    params: {
      org: { type: "ref", ref: "thing", of: { kind: ["group", "trust"] }, label: "Organization" },
      place: { type: "ref", ref: "place", label: "Place" },
      entry: { type: "text", label: "Who may enter" },
      keys: { type: "text", optional: true, label: "Keys" },
    },
    requires: [{ expr: "may(self, org, 'property.manage')", why: "'Needs the power to manage its property'" }],
    outcomes: { default: [{ type: ORGS_ENTRY, args: { place: "=place", entry: "=entry", keys: "=params.keys", org: "org", by: "self" } }] },
    duration: "0",
    mechanical: true,
  });
  r.orgSection({ id: PREMISES_SECTION, label: "Premises", build: (ctx, org, viewer) => buildPremises(ctx, org, viewer) as unknown as JsonValue });
  r.query("orgs.place_entry", buildPlaceEntry);
  r.lint({ code: "orgs.entry", check: entryLint });
}

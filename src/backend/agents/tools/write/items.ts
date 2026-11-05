// The items family's writes (ITEMS-SPEC §7.3; AGENT-LOOP-PLAN §6): one tool per item op, each one
// change to a thing (`ItemOp`, `shared/things.ts`), sent as the GM edit `{op: "item", change}` the
// one validator and location writer resolve (`engine/thing-ops.ts`). Each is the story's own change
// (`story` tier: the Curator's, and any role's or the GM assistant's at the GM tier), but taking a
// thing out of the world, which is the GM's. A call checks its change first with `dry` set, and
// otherwise stages it in a turn or proposes it outside one (`propose`): refused with its reason when
// it doesn't hold, and the same change asked again is the one staged. Names resolve among what the
// view may name; a thing, and a thing something goes into, as `items_find` reads words
// (`resolveNamedThing`, `resolveHolder`): "the fridge" is the Refrigerator, one the agent staged
// this turn too, and words that fit several as well are refused with each of them. A make takes a
// kit's type as any other, and a vehicle class (`class`, its details beside it). A person's saved
// outfits and loadouts (DESIGN §28.16) are kept and changed into by `set_save` and `set_apply`.

import { WRITE_NOTE } from "../../../../shared/agent-tools-write";
import type { EntityId } from "../../../../shared/ids";
import { hasOwn, type JsonObject } from "../../../../shared/json";
import { GRANT_BASES, type GrantBasis, HANDOVER_BASES, type HandoverBasis, type ItemOp, isSize, nameKey, PERMIT_SCOPES, type PermitScope, type Rest, SET_KINDS, type SetKind, setsOf, SIZES, type Size, type Spot, vehicleDetailsOf } from "../../../../shared/things";
import { calendarOf, clockOfPhrase, clockOfStamp } from "../../../../engine/calendar";
import type { ToolOutcome } from "../../runtime";
import { BOOLEAN, boolArg, gmEdit, missing, needId, propose, refusedAnswer, TEXT_LIST, wordsArg } from "../propose";
import type { ToolReadView } from "../read-view";
import type { ToolDefinition, ToolEnv } from "../registry";
import { resolveEntity, resolveHolder, resolveNamedThing, resolvePerson, resolvePlace } from "../resolve";
import { argGiven, badValue, integer, intArg, needText, objectArg, objectSchema, text, textArg } from "../schema";

/** The arguments every item tool takes besides its own: only check it (`dry`). */
const DRY = { dry: BOOLEAN };

/** Where a thing goes: into a holder (`in`: a person or a thing) or at a place (`at`). */
const SPOT = { in: text(), at: text() };

/** Where `in` or `at` puts a thing, whichever is given (exactly one), or the note why not; `optional` lets both be left out (null). */
function spotOf(view: ToolReadView, tool: string, args: JsonObject, optional = false): Spot | null | ToolOutcome {
  const into = argGiven(args, "in");
  const at = argGiven(args, "at");
  if (into && at) return view.refuse(WRITE_NOTE.oneSpot, { tool });
  if (into) {
    const holder = needId(view, tool, args, "in", resolveHolder);
    return typeof holder === "string" ? { in: holder } : holder;
  }
  if (at) {
    const place = needId(view, tool, args, "at", resolvePlace);
    return typeof place === "string" ? { place } : place;
  }
  return optional ? null : view.refuse(WRITE_NOTE.oneSpot, { tool });
}

/** When something ends (`until`): a time in the story's words ("until 7 tonight", "for two days") or a day and time, YYYY-MM-DD HH:MM; undefined when left out, the note when it reads as no time. */
function untilOf(view: ToolReadView, tool: string, args: JsonObject): number | undefined | ToolOutcome {
  const said = textArg(args, "until");
  if (said === null) return undefined;
  const cal = calendarOf(view.world);
  const at = clockOfPhrase(cal, view.state.clock, said) ?? clockOfStamp(cal, said);
  return at === null ? missing(view, tool, "until") : at;
}

/** An enum argument, one of `values`, or the note listing them; undefined when left out. */
function oneOf<T extends string>(view: ToolReadView, tool: string, args: JsonObject, key: string, values: readonly T[]): T | undefined | ToolOutcome {
  const said = textArg(args, key);
  if (said === null) return undefined;
  const v = values.find((x) => x === said.toLowerCase());
  return v ?? badValue(view, tool, key, said, values);
}

/** Whether a read argument came back as its note. */
const isNote = (v: unknown): v is ToolOutcome => typeof v === "object" && v !== null && "text" in v;

/**
 * One item tool: its schema's own arguments (`dry` with them) and those it can't do without, and how
 * it reads them into its op, or the note why not; the run checks the op (`dry`) or proposes it.
 */
function itemTool(name: string, tier: "story" | "gm", properties: Readonly<Record<string, JsonObject>>, required: readonly string[], build: (view: ToolReadView, args: JsonObject) => ItemOp | ToolOutcome): ToolDefinition {
  return {
    name,
    family: "items",
    tier,
    parameters: () => objectSchema({ ...properties, ...DRY }, required),
    async run(args, env) {
      const view = await env.reader.view();
      const op = view.read(() => build(view, args));
      if (isNote(op)) return op;
      return checkOrPropose(view, env, op, boolArg(args, "dry") === true);
    },
  };
}

/** What a change comes to: with `dry`, the writer's check alone (nothing staged or kept); else staged in a turn, or proposed outside one. */
export async function checkOrPropose(view: ToolReadView, env: ToolEnv, change: ItemOp | { place: JsonObject }, dry: boolean): Promise<ToolOutcome> {
  const op = gmEdit("place" in change ? { op: "place", change: change.place } : { op: "item", change: change as unknown as JsonObject });
  if (!dry || !env.writer) return propose(view, env.writer, op);
  const out = await env.writer.dryRun(op);
  if ("refused" in out) return refusedAnswer(out);
  return view.answer({ checked: { key: out.key, changeType: out.changeType, mode: out.mode, lines: out.lines } });
}

/** The thing a tool's argument names. */
const thing = (view: ToolReadView, tool: string, args: JsonObject, key = "item"): string | ToolOutcome => needId(view, tool, args, key, resolveNamedThing);
/** A party (a person, a household, a business, a group) an argument names. */
const party = (view: ToolReadView, tool: string, args: JsonObject, key: string): string | ToolOutcome => needId(view, tool, args, key, resolveEntity);
/** A reason, as the change keeps it. */
const why = (view: ToolReadView, tool: string, args: JsonObject): string | ToolOutcome => needText(view, tool, args, "why");

export const ITEMS_WRITES: readonly ToolDefinition[] = [
  itemTool("item_make", "story", { name: text(), type: text(), class: text(), details: objectSchema({ make: text(), model: text(), year: integer(), colour: text(), plate: text() }), size: text([...SIZES]), ...SPOT, owner: text(), home: text(), qty: integer({ minimum: 1 }), aliases: TEXT_LIST, hidden: BOOLEAN, why: text() }, ["name", "why"], (view, args) => {
    const name = needText(view, "item_make", args, "name");
    if (isNote(name)) return name;
    const at = spotOf(view, "item_make", args);
    if (at === null || isNote(at)) return at ?? view.refuse(WRITE_NOTE.oneSpot, { tool: "item_make" });
    const reason = why(view, "item_make", args);
    if (isNote(reason)) return reason;
    const size = oneOf<Size>(view, "item_make", args, "size", SIZES);
    if (isNote(size)) return size;
    const owner = argGiven(args, "owner") ? party(view, "item_make", args, "owner") : undefined;
    if (isNote(owner)) return owner;
    const home = homeOf(view, "item_make", textArg(args, "home"));
    if (isNote(home)) return home;
    const qty = intArg(args, "qty");
    const aliases = wordsArg(args, "aliases");
    const type = textArg(args, "type");
    const vehicleClass = textArg(args, "class");
    const details = vehicleDetailsOf(objectArg(args, "details"));
    return {
      do: "make",
      name,
      at,
      why: reason,
      ...(type !== null ? { type } : {}),
      ...(vehicleClass !== null ? { class: vehicleClass } : {}),
      ...(vehicleClass !== null && details !== null ? { details } : {}),
      ...(size !== undefined && isSize(size) ? { size } : {}),
      ...(owner !== undefined ? { owner } : {}),
      ...(home !== undefined ? { home } : {}),
      ...(qty !== null ? { qty } : {}),
      ...(aliases && aliases.length > 0 ? { aliases } : {}),
      ...(boolArg(args, "hidden") === true ? { hidden: true } : {}),
    };
  }),
  itemTool("item_move", "story", { item: text(), ...SPOT, why: text() }, ["item", "why"], (view, args) => {
    const item = thing(view, "item_move", args);
    if (isNote(item)) return item;
    const to = spotOf(view, "item_move", args);
    if (to === null || isNote(to)) return to ?? view.refuse(WRITE_NOTE.oneSpot, { tool: "item_move" });
    const reason = why(view, "item_move", args);
    return isNote(reason) ? reason : { do: "move", item, to, why: reason };
  }),
  itemTool("item_hand", "story", { item: text(), to: text(), basis: text([...HANDOVER_BASES]), until: text(), why: text() }, ["item", "to", "basis", "why"], (view, args) => {
    const item = thing(view, "item_hand", args);
    if (isNote(item)) return item;
    const to = needId(view, "item_hand", args, "to", resolvePerson);
    if (isNote(to)) return to;
    const basis = oneOf<HandoverBasis>(view, "item_hand", args, "basis", HANDOVER_BASES);
    if (basis === undefined) return missing(view, "item_hand", "basis");
    if (isNote(basis)) return basis;
    const until = untilOf(view, "item_hand", args);
    if (isNote(until)) return until;
    const reason = why(view, "item_hand", args);
    return isNote(reason) ? reason : { do: "hand", item, to, basis, why: reason, ...(until !== undefined ? { until } : {}) };
  }),
  itemTool("item_own", "story", { item: text(), owner: text(), why: text() }, ["item", "owner", "why"], (view, args) => {
    const item = thing(view, "item_own", args);
    if (isNote(item)) return item;
    const said = needText(view, "item_own", args, "owner");
    if (isNote(said)) return said;
    const owner = hasOwn(NOBODY, said.toLowerCase()) ? null : party(view, "item_own", args, "owner");
    if (isNote(owner)) return owner;
    const reason = why(view, "item_own", args);
    return isNote(reason) ? reason : { do: "own", item, owner, why: reason };
  }),
  itemTool("item_grant", "story", { item: text(), who: text(), basis: text([...GRANT_BASES]), until: text(), by: text() }, ["item", "who"], (view, args) => grantOf(view, "item_grant", args)),
  itemTool("item_revoke", "story", { item: text(), who: text() }, ["item", "who"], (view, args) => grantOf(view, "item_revoke", args)),
  itemTool("item_permit", "story", { from: text(), to: text(), scope: text([...PERMIT_SCOPES]), until: text(), by: text() }, ["from", "to"], (view, args) => permitOf(view, "item_permit", args)),
  itemTool("item_unpermit", "story", { from: text(), to: text() }, ["from", "to"], (view, args) => permitOf(view, "item_unpermit", args)),
  itemTool("item_home", "story", { item: text(), ...SPOT, owner: BOOLEAN, clear: BOOLEAN }, ["item"], (view, args) => {
    const item = thing(view, "item_home", args);
    if (isNote(item)) return item;
    const spot = spotOf(view, "item_home", args, true);
    if (isNote(spot)) return spot;
    const onOwner = boolArg(args, "owner") === true;
    const clear = boolArg(args, "clear") === true;
    if (Number(spot !== null) + Number(onOwner) + Number(clear) !== 1) return view.refuse(WRITE_NOTE.oneHome, { tool: "item_home" });
    return { do: "home", item, home: clear ? null : onOwner ? "owner" : (spot as Spot) };
  }),
  itemTool("item_use", "story", { item: text(), qty: integer({ minimum: 1 }) }, ["item"], (view, args) => {
    const item = thing(view, "item_use", args);
    if (isNote(item)) return item;
    const qty = intArg(args, "qty");
    return { do: "use", item, ...(qty !== null ? { qty } : {}) };
  }),
  itemTool("item_wear", "story", { item: text(), who: text(), off: BOOLEAN, slot: text() }, ["item", "who"], (view, args) => {
    const item = thing(view, "item_wear", args);
    if (isNote(item)) return item;
    const who = needId(view, "item_wear", args, "who", resolvePerson);
    if (isNote(who)) return who;
    // Ready is in hand; any other slot as the slots table names it (holster, sheath, quiver, back…).
    const said = textArg(args, "slot")?.toLowerCase().replace(/[\s-]+/g, "_");
    const slot = said === "ready" || said === "hand" || said === "in_hand" ? "hand_held" : said;
    return { do: "wear", item, who, ...(boolArg(args, "off") === true ? { off: true } : {}), ...(slot !== undefined && slot !== "" ? { slot } : {}) };
  }),
  itemTool("item_condition", "story", { item: text(), delta: integer() }, ["item", "delta"], (view, args) => {
    const item = thing(view, "item_condition", args);
    if (isNote(item)) return item;
    const delta = intArg(args, "delta");
    return delta === null ? missing(view, "item_condition", "delta") : { do: "condition", item, delta };
  }),
  itemTool("item_lose", "story", { item: text(), by: text() }, ["item"], (view, args) => {
    const item = thing(view, "item_lose", args);
    if (isNote(item)) return item;
    const by = argGiven(args, "by") ? needId(view, "item_lose", args, "by", resolvePerson) : undefined;
    if (isNote(by)) return by;
    return { do: "lose", item, ...(by !== undefined ? { by } : {}) };
  }),
  itemTool("item_label", "story", { item: text(), name: text(), aliases: TEXT_LIST, description: text(), size: text([...SIZES]) }, ["item"], (view, args) => {
    const item = thing(view, "item_label", args);
    if (isNote(item)) return item;
    const size = oneOf<Size>(view, "item_label", args, "size", SIZES);
    if (isNote(size)) return size;
    const name = textArg(args, "name");
    const aliases = wordsArg(args, "aliases");
    const description = typeof args.description === "string" ? args.description : null;
    return { do: "label", item, ...(name !== null ? { name } : {}), ...(aliases !== null ? { aliases } : {}), ...(description !== null ? { description } : {}), ...(size !== undefined ? { size } : {}) };
  }),
  itemTool("item_merge", "story", { keep: text(), drop: text() }, ["keep", "drop"], (view, args) => {
    const keep = thing(view, "item_merge", args, "keep");
    if (isNote(keep)) return keep;
    const drop = thing(view, "item_merge", args, "drop");
    return isNote(drop) ? drop : { do: "merge", keep, drop };
  }),
  itemTool("item_remove", "gm", { item: text(), why: text() }, ["item", "why"], (view, args) => {
    const item = thing(view, "item_remove", args);
    if (isNote(item)) return item;
    const reason = why(view, "item_remove", args);
    return isNote(reason) ? reason : { do: "remove", item, why: reason };
  }),
  itemTool("set_save", "story", { who: text(), name: text(), kind: text([...SET_KINDS]), pieces: TEXT_LIST }, ["who", "name", "kind"], (view, args) => {
    const who = needId(view, "set_save", args, "who", resolvePerson);
    if (isNote(who)) return who;
    const name = needText(view, "set_save", args, "name");
    if (isNote(name)) return name;
    const kind = oneOf<SetKind>(view, "set_save", args, "kind", SET_KINDS);
    if (kind === undefined) return missing(view, "set_save", "kind");
    if (isNote(kind)) return kind;
    // The pieces named, as items_find reads words; left out, what they wear now of its kind.
    const pieces: { item: EntityId }[] = [];
    for (const said of wordsArg(args, "pieces") ?? []) {
      const piece = resolveNamedThing(view, said);
      if ("refused" in piece) return piece.refused;
      pieces.push({ item: piece.id });
    }
    return { do: "set_save", who, name, kind, ...(pieces.length > 0 ? { pieces } : {}) };
  }),
  itemTool("set_apply", "story", { who: text(), set: text() }, ["who", "set"], (view, args) => {
    const who = needId(view, "set_apply", args, "who", resolvePerson);
    if (isNote(who)) return who;
    const said = needText(view, "set_apply", args, "set");
    if (isNote(said)) return said;
    // A saved set by its id, or its name as the reply says it ("her work clothes" is Work).
    const sets = setsOf(view.state.entities[who]?.fields);
    const key = nameKey(said);
    const id = hasOwn(sets, said) ? said : Object.keys(sets).find((s) => sets[s]?.name.trim().toLowerCase() === said.trim().toLowerCase()) ?? Object.keys(sets).find((s) => key !== null && nameKey(sets[s]?.name ?? "")?.words.every((w) => key.words.includes(w)) === true);
    return id !== undefined ? { do: "set_apply", who, set: id } : badValue(view, "set_apply", "set", said, Object.values(sets).map((s) => s.name));
  }),
];

/** The words that make a thing no one's (`item_own`'s owner). */
const NOBODY: Readonly<Record<string, true>> = { nobody: true, "no one": true, none: true, null: true };

/** Where a thing made rests (`home`): "owner" (on its owner), else a place by name, or a holder as `in` names one; undefined when left out. */
function homeOf(view: ToolReadView, tool: string, said: string | null): Rest | undefined | ToolOutcome {
  if (said === null) return undefined;
  if (said.toLowerCase() === "owner") return "owner";
  const place = resolvePlace(view, said);
  if (!("refused" in place)) return { place: place.id };
  const holder = resolveHolder(view, said);
  return "refused" in holder ? holder.refused : { in: holder.id };
}

/** A use grant given or taken back: `item_grant`'s basis, end and giver, or `item_revoke`'s two names. */
function grantOf(view: ToolReadView, tool: "item_grant" | "item_revoke", args: JsonObject): ItemOp | ToolOutcome {
  const item = thing(view, tool, args);
  if (isNote(item)) return item;
  const who = party(view, tool, args, "who");
  if (isNote(who)) return who;
  if (tool === "item_revoke") return { do: "revoke", item, who };
  const basis = oneOf<GrantBasis>(view, tool, args, "basis", GRANT_BASES);
  if (isNote(basis)) return basis;
  const until = untilOf(view, tool, args);
  if (isNote(until)) return until;
  const by: EntityId | ToolOutcome | undefined = argGiven(args, "by") ? party(view, tool, args, "by") : undefined;
  if (isNote(by)) return by;
  return { do: "grant", item, who, ...(basis !== undefined ? { basis } : {}), ...(until !== undefined ? { until } : {}), ...(by !== undefined ? { by } : {}) };
}

/** A standing permission given or taken back: from a party (all their things, or those at home) to another. */
function permitOf(view: ToolReadView, tool: "item_permit" | "item_unpermit", args: JsonObject): ItemOp | ToolOutcome {
  const from = party(view, tool, args, "from");
  if (isNote(from)) return from;
  const to = party(view, tool, args, "to");
  if (isNote(to)) return to;
  if (tool === "item_unpermit") return { do: "unpermit", from, to };
  const scope = oneOf<PermitScope>(view, tool, args, "scope", PERMIT_SCOPES);
  if (isNote(scope)) return scope;
  const until = untilOf(view, tool, args);
  if (isNote(until)) return until;
  const by = argGiven(args, "by") ? party(view, tool, args, "by") : undefined;
  if (isNote(by)) return by;
  return { do: "permit", from, to, ...(scope !== undefined ? { scope } : {}), ...(until !== undefined ? { until } : {}), ...(by !== undefined ? { by } : {}) };
}

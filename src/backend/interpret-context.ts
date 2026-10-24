// What `interpret` reads besides the typed message (DESIGN §5.2): the actions the player character
// can take now, each with what it does, its params and what may fill them, and what it needs (the
// catalog); the scene as the player character knows it; the places it can name; and the messages
// before the typed one. All of it is worded for the POV: a place, a person or a thing it can't see
// or may not know is never named, and a requirement is never shown as its expression.

import type { ActionId, EntityId } from "../shared/ids";
import { bandsWithin, type InferredChecks, type SheetSkill } from "../shared/inferred";
import { TRY_ACTION } from "../engine/inferred";
import type { RecentHistory } from "../shared/settings";
import { limitOf } from "../shared/minds";
import { tableChoices } from "../shared/tables";
import type { ActionDef, ParamDef, WorldDoc } from "../shared/world";
import { calendarOf, dateAt, formatStamp, placeOffset, weekdayName } from "../engine/calendar";
import type { ChainMessage } from "../engine/ledger/chain";
import { povLife } from "../engine/life";
import { together } from "../engine/presence";
import { optionalQuery, own } from "../engine/pack-kit";
import type { ReadContext } from "../engine/registry";
import type { Registry } from "../engine/registry-impl";
import { paramCandidates, placeCandidates } from "../engine/resolve";
import { evalExpr, isGone, kindIs, placeOfEntity, scopeEnv, truthy } from "../engine/scope";
import { lastSighting } from "../engine/seen";
import type { WorldState } from "../engine/state";
import { canSeeEntity, canSeePlace, namesAny, povPlace } from "../engine/visibility";
import { fightOffers } from "../packs/combat/core/index";
import { carriedBy } from "../packs/gear/core/model";
import { openPuzzles } from "../packs/story/core/index";
import { tokensOf } from "./book";
import { readableReply } from "./json-hiding";
import { gatesOf, needsOf } from "./requirement-words";
import { spanText, TIMELAPSE_ACTION } from "./view";

/** One action of `interpret`'s catalog, as its prompt lists it. */
export interface CatalogEntry {
  id: ActionId;
  label: string;
  description?: string;
  /** Each param in words: its name (with `?` when it may be left out), its kind and what may fill it. */
  params: string[];
  /** What it needs, in words (`needsOf`). */
  needs: string[];
  /** Ways players say it: hints for the model, never a gate. */
  lexicon?: string[];
}

/** What `interpret` is told besides the catalog. */
export interface InterpretScene {
  /** The scene as the POV knows it, a line each: where and when, who is there, whom the input names who isn't (with where it last saw them), what it carries, its vehicles, what waits on its answer, what its last message left unplayed. */
  lines: string[];
  /** The places a place param may name, nearest first, a line each ("id: name, in parent"). */
  places: string[];
  /** The messages before the typed one, oldest first ("Player: …", "Story: …"). */
  recent: string[];
}

/** Typed phrases that let time pass: hints in the timelapse's catalog entry, whose line shows the first six. */
const TIMELAPSE_LEXICON = ["skip ahead", "time skip", "over the next hour", "later that evening", "wait until", "sleep until", "next morning", "skip to", "pass the time", "sleep through", "hours later", "days later", "wait for"];

/** The day and time where the POV is, as the HUD shows them ("Mon 2026-09-14 06:45"). */
function localNow(world: WorldDoc, state: Readonly<WorldState>): string {
  const cal = calendarOf(world);
  const offset = placeOffset(world, state.clock, placeOfEntity(state, world.pov));
  return `${weekdayName(cal, dateAt(cal, state.clock + offset).weekday)} ${formatStamp(cal, state.clock, offset)}`;
}

/**
 * The puzzles the player can see that take an answer now (`openPuzzles`, up to six), as interpret's
 * Answer label names them: each by the id its quest log row goes by, then as the row shows it,
 * "id: Puzzle — stage", so the world id the model is told to give for `puzzle` is the row's own (a
 * masked secret's stand-in). A masked secret reads "Something is going on" with no stage, like any
 * other, so its cue stands in for the stage: all that tells it from another, and never its own label.
 */
function openPuzzleTitles(ctx: ReadContext): string[] {
  return openPuzzles(ctx)
    .slice(0, 6)
    .map(({ shown }) => {
      const where = shown.stage || shown.cue;
      return `${shown.id}: ${where ? `${shown.label} — ${where}` : shown.label}`;
    });
}

/** A ref param's kind in words: its kind's label ("person"), or "anyone or anything" for a ref of any kind. */
function kindWords(reg: Registry, world: WorldDoc, def: ParamDef): string {
  if (def.ref === undefined) return "anyone or anything";
  return (own(world.kinds, def.ref)?.label ?? reg.kinds.get(def.ref)?.label ?? def.ref).toLowerCase();
}

/**
 * A param in words, or null when it is required and nothing can fill it: a required ref lists the
 * ids that may fill it (each named once, in the scene: `named` gathers them), as the palette offers
 * them; an optional one, which the palette never lists, takes an id of its kind named elsewhere; a
 * place ref points at the places, listed apart; a text param naming a table row lists the rows'
 * ids, inside the param's own parentheses, so the next param can't read as a row; Attempt's stat
 * lists the stats, and Buy's item what is sold here, as the palette offers them.
 */
function paramWords(ctx: ReadContext, action: ActionDef, name: string, def: ParamDef, mayKnow: (id: EntityId) => boolean, places: number, named: Set<EntityId>): string | null {
  const { registry: reg, world, state } = ctx;
  const head = `${name}${def.optional ? "?" : ""}`;
  const label = def.label ? `: ${def.label}` : "";
  if (def.type === "ref") {
    if (def.ref === "place") return places > 0 ? `${head} (a place id from Places)` : def.optional ? `${head} (no place you know of)` : null;
    if (def.optional) return `${head} (${kindWords(reg, world, def)}: an id named above${label})`;
    const ids = paramCandidates(reg, world, state, action, name).filter(mayKnow);
    // A param a claim may fill (DESIGN §9.4) keeps its action for a thing the player says they have that nothing lists.
    const claimed = def.claim ? "one nothing lists, in the input's own words" : null;
    if (ids.length === 0) return claimed ? `${head} (${kindWords(reg, world, def)}: ${claimed})` : null;
    for (const id of ids) named.add(id);
    return `${head} (${kindWords(reg, world, def)}: ${ids.join(" | ")}${claimed ? `, or ${claimed}` : ""})`;
  }
  // A list of refs (Go's `with`) takes ids of the scene's people the input brings along: "with Danny"
  // names one, "we" all of them; nobody when the player goes alone, as when no one is here.
  if (def.type === "list" && def.ref !== undefined) {
    const here = placeOfEntity(state, world.pov);
    const ref = def.ref;
    const ids = Object.keys(state.entities).sort().filter((id) => {
      const e = own(state.entities, id);
      return !!e && id !== world.pov && kindIs(reg, world, e.kind, ref) && !isGone(state, id) && mayKnow(id) && together(world, here, placeOfEntity(state, id));
    });
    if (ids.length === 0) return `${head} (no one here${label})`;
    for (const id of ids) named.add(id);
    return `${head} (${kindWords(reg, world, def)} here, a list of ids: ${ids.join(" | ")}; "we" is all of them${label})`;
  }
  if (def.table !== undefined) return `${head} (one of: ${tableChoices(own(world.tables, def.table)).map((c) => c.key).join(" | ")})`;
  if (action.id === "attempt" && name === "stat" && def.type === "text") {
    const stats = optionalQuery(ctx, "sheets.stats")?.(ctx) ?? [];
    if (stats.length > 0) return `${head} (one of: ${stats.map((s) => s.id).join(" | ")})`;
  }
  if ((action.id.split(".").at(-1) ?? action.id).startsWith("buy") && name === "item" && def.type === "text") {
    const sold = (optionalQuery(ctx, "economy.offers")?.(ctx, world.pov) ?? []).map((o) => o.name);
    if (sold.length > 0) return `${head} (text${label}; sold here: ${sold.join(" | ")})`;
  }
  if (def.type === "money") return `${head} (an amount in ${world.currency.code} as written${label})`;
  return `${head} (${def.type}${label})`;
}

/**
 * The actions `interpret` may read typed text as, each as the POV can take it now (DESIGN §5.2):
 * those the fight's state allows (as the Combat tab lists them), less one a gate rules out (a level
 * of detail or a money feature this chat doesn't have) and one with a required person, thing or
 * place the POV can't name (as the palette offers no option for it). `mayKnow` keeps a param's
 * candidates to those the POV may be told about; `named` holds every id the entries list, which the
 * scene names (`interpretScene`). Answer lists the open puzzles in its label.
 */
export function interpretCatalog(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, actions: readonly ActionDef[], mayKnow: (id: EntityId) => boolean): { entries: { action: ActionDef; entry: CatalogEntry }[]; named: EntityId[] } {
  const ctx = reg.context(world, state);
  const env = scopeEnv({ reg, ctx, bindings: { self: world.pov, actor: world.pov } });
  const puzzles = openPuzzleTitles(ctx);
  const places = placeCandidates(reg, world, state).length;
  const named = new Set<EntityId>();
  const entries: { action: ActionDef; entry: CatalogEntry }[] = [];
  for (const action of actions) {
    if (!fightOffers(world, state, action) || gatesOf(action).some((req) => !truthy(evalExpr(req, env, false)))) continue;
    const params: string[] = [];
    const ids = new Set<EntityId>();
    for (const [name, def] of Object.entries(action.params)) {
      const words = paramWords(ctx, action, name, def, mayKnow, places, ids);
      if (words === null) break;
      params.push(words);
    }
    if (params.length < Object.keys(action.params).length) continue;
    for (const id of ids) named.add(id);
    const label = action.pack === "story" && action.id === "answer" && puzzles.length > 0 ? `${action.label} (open: ${puzzles.join("; ")})` : action.label;
    entries.push({ action, entry: { id: action.id, label, ...(action.description ? { description: action.description } : {}), params, needs: needsOf(action, (param) => `\`${param}\``), ...(action.lexicon ? { lexicon: action.lexicon } : {}) } });
  }
  return { entries, named: [...named] };
}

/**
 * Letting time pass, always in the catalog, so a world without actions still interprets ("I sleep
 * until the next morning", "skip ahead to Friday at 6 PM"). An out-of-character instruction that
 * time passes is always it, whatever else the input says (DESIGN §5.2): what happens in that time
 * fills it. Its `span` is required, the input's own words for how long or until when, which the
 * engine reads the same way every time (`typedSpan`), so a read that picks it always says how long.
 * It tells the model the day and time as the HUD shows them (the place's time zone), so a stated
 * day and time can be named exactly.
 */
export function timelapseEntry(world: WorldDoc, state: Readonly<WorldState>): CatalogEntry {
  const parts = [...world.calendar.dayParts.map((d) => d.id), "shift", "commitment"];
  return {
    id: TIMELAPSE_ACTION,
    label: "Let time pass",
    description: `a time skip: wait, sleep, skip ahead, or spend a stated span on something no other action covers; an out-of-character instruction that time passes is always this, whatever else the input says ("OOC: over the next hour, I sort the stock" is a skip of an hour, the sorting what fills it). span: the input's own words for how long or until when ("over the next hour", "later that evening"); with it, minutes for a stated duration; until one of ${parts.join(", ")} ("next <day part>" for the following day's); or at a stated day and time, as "YYYY-MM-DD HH:MM" (it is now ${localNow(world, state)})`,
    params: ["span (text: the input's words for how long or until when)", "minutes? (number)", "until? (text)", "at? (text)"],
    needs: [],
    lexicon: TIMELAPSE_LEXICON,
  };
}

/**
 * Try something (DESIGN §11 inferred checks), in the catalog while the chat's policy is on: an
 * uncertain attempt no other action covers, rolled with one of the skills the policy allows
 * (`skills`), a difficulty band within its bounds, the companions who join in (only when they roll)
 * and the people it opposes, and, under `tries`, whether the input says it tries.
 */
export function tryEntry(policy: InferredChecks, skills: readonly SheetSkill[]): CatalogEntry {
  const which = policy.when === "tries" ? "only one the input says the player character tries or attempts" : policy.when === "risky" ? "one that could go wrong" : "any whose outcome is uncertain";
  const named = skills.map((s) => (s.label.toLowerCase() === s.id.replace(/_/g, " ").toLowerCase() ? s.id : `${s.id} (${s.label})`));
  return {
    id: TRY_ACTION,
    label: "Try something",
    description: `an attempt no other action covers, ${which}, rolled with a skill: talking someone round, sneaking, noticing, deceiving, forcing something; a reaction the input asks for counts too ("I watch him as he answers: is he lying?" reads him against his deceit)`,
    params: [
      "attempt (text: what is attempted, in the input's words)",
      `skill (one of: ${named.join(" | ")})`,
      `difficulty (one of: ${bandsWithin(policy).map((b) => b.id).join(" | ")}: how hard it looks in context)`,
      ...(policy.who !== "pov" ? ['with? (a list of ids of people here who join in: "we sneak past" names each companion)'] : []),
      'against? (a list of {"who": an id of someone here, "skill": the skill they resist with}: the people it opposes or targets)',
      ...(policy.when === "tries" ? ["tried (true when the input itself says the player character tries or attempts it)"] : []),
    ],
    needs: [],
    lexicon: ["try to", "attempt", "manage to", "talk into", "sneak past"],
  };
}

/** Where something is, for the scene: ", at <place>" when the POV can see the place, else nothing. */
function atWords(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, id: EntityId): string {
  const place = placeOfEntity(state, id);
  return place !== null && canSeePlace(reg, world, state, world.pov, place) ? `, at ${own(world.places, place)?.name ?? place}` : "";
}

/** People the input names who aren't here, a scene line lists at most. */
const AWAY_LIMIT = 6;

/**
 * Where the POV last saw someone, for the scene: ", last seen at <place> (<id>) <span> ago", from
 * its own observations (`space.seen`), never where they are now; nothing when it never was with
 * them or can't see that place.
 */
function lastSeenWords(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, id: EntityId): string {
  const last = lastSighting(state, id);
  if (!last || !canSeePlace(reg, world, state, world.pov, last.place)) return "";
  return `, last seen at ${own(world.places, last.place)?.name ?? last.place} (${last.place}) ${spanText(Math.max(1, state.clock - last.at))} ago`;
}

/**
 * The scene as the POV knows it (DESIGN §5.2): the day and time and where it is (a place it can't
 * see is somewhere it can't name), who is there with it, the people the typed input (`said`) names
 * who aren't, with where the POV last saw them, what it carries, its vehicles, the invitations
 * waiting on its answer, and everyone and everything else the catalog lists (`named`), each by name
 * and id, and what its last message left unplayed (`left`: the words of the Send chip on the reply
 * before it); then the places a place param may name, and the messages before the typed one
 * (`recentMessages`). Only what the POV may know is named.
 */
export function interpretScene(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, opts: { mayKnow: (id: EntityId) => boolean; named: readonly EntityId[]; earlier: readonly ChainMessage[]; recent: Readonly<RecentHistory>; hideJson: boolean; said?: string; left?: string }): InterpretScene {
  const ctx = reg.context(world, state);
  const pov = own(state.entities, world.pov);
  const here = placeOfEntity(state, world.pov);
  const place = povPlace(reg, world, state);
  const parentId = place?.id ? own(world.places, place.id)?.parent : undefined;
  const parent = parentId && canSeePlace(reg, world, state, world.pov, parentId) ? `, in ${own(world.places, parentId)?.name ?? parentId} (${parentId})` : "";
  const where = place === null ? "" : place.id === null ? ", somewhere you can't name" : `, at ${place.name} (${place.id})${parent}`;
  const seen = (id: EntityId): boolean => id !== world.pov && !isGone(state, id) && canSeeEntity(reg, world, state, world.pov, id) && opts.mayKnow(id);
  const people = here === null ? [] : Object.keys(state.entities).filter((id) => seen(id) && kindIs(reg, world, own(state.entities, id)?.kind ?? "", "person") && placeOfEntity(state, id) === here);
  const carried = carriedBy(state, world.pov).filter(seen);
  const vehicles = Object.keys(state.entities).filter((id) => seen(id) && kindIs(reg, world, own(state.entities, id)?.kind ?? "", "vehicle") && (own(state.entities, id)?.fields.owner === world.pov || (pov?.relations.some((r) => r.type === "uses" && r.to === id) ?? false)));
  const waiting = (optionalQuery(ctx, "castlife.invitations")?.(ctx, world.pov) ?? []).filter((inv) => opts.mayKnow(inv.host)).map((inv) => `${inv.text} (host ${inv.host})`);
  // A message can take for granted being with someone who isn't here ("I sit down next to Marcus"),
  // a move to read first (DESIGN §5.2): the people it names who aren't here, with where the POV last
  // saw them.
  const said = opts.said ?? "";
  const away = here === null || said.trim() === "" ? [] : Object.keys(state.entities).filter((id) => seen(id) && !people.includes(id) && kindIs(reg, world, own(state.entities, id)?.kind ?? "", "person") && namesAny(said, [own(state.entities, id)?.name ?? id])).slice(0, AWAY_LIMIT);
  const shown = new Set([...people, ...away, ...carried, ...vehicles]);
  const others = opts.named.filter((id) => !shown.has(id) && seen(id));
  const nameOf = (id: EntityId): string => own(state.entities, id)?.name ?? id;
  const lifeWords = (id: EntityId): string => {
    const life = povLife(world, state, id);
    return life ? `, ${life.reads}` : "";
  };
  const lines = [
    `Now: ${localNow(world, state)}${where}.`,
    `Here with you: ${people.length > 0 ? people.map((id) => `${nameOf(id)} (${id}${lifeWords(id)})`).join("; ") : "no one"}.`,
    ...(away.length > 0 ? [`Named in the input but not here: ${away.map((id) => `${nameOf(id)} (${id}${lifeWords(id)})${lastSeenWords(reg, world, state, id)}`).join("; ")}.`] : []),
    `You carry: ${carried.length > 0 ? carried.map((id) => `${nameOf(id)} (${id})`).join("; ") : "nothing"}.`,
    ...(vehicles.length > 0 ? [`Your vehicles: ${vehicles.map((id) => `${nameOf(id)} (${id}${atWords(reg, world, state, id)})`).join("; ")}.`] : []),
    ...(others.length > 0 ? [`Others you can name: ${others.map((id) => `${nameOf(id)} (${id})`).join("; ")}.`] : []),
    ...(waiting.length > 0 ? [`Waiting on your answer: ${waiting.join(" ")}`] : []),
    ...(opts.left ? [`Left from your last message, not played yet: ${opts.left}`] : []),
  ];
  const places = placeCandidates(reg, world, state).map((id) => {
    const p = own(world.places, id);
    const up = p?.parent && canSeePlace(reg, world, state, world.pov, p.parent) ? `, in ${own(world.places, p.parent)?.name ?? p.parent}` : "";
    return `${id}: ${p?.name ?? id}${up}`;
  });
  return { lines, places, recent: recentMessages(opts.earlier, opts.recent, opts.hideJson) };
}

/**
 * The messages before the turn's as a step reads them (DESIGN §5.2): from the newest back, at most
 * `recent.messages` of them and about `recent.tokens` in all (either `"none"`: no limit), stopping
 * at whichever comes first, each on one line, a reply as the engine reads it (`readableReply`); the
 * oldest that doesn't fit whole keeps its end, where a reply leaves off. Oldest first; none while
 * `on` is false.
 */
export function recentMessages(messages: readonly ChainMessage[], recent: Readonly<Omit<RecentHistory, "on"> & { on?: boolean }>, hideJson: boolean): string[] {
  const out: string[] = [];
  if (recent.on === false) return out;
  const most = limitOf(recent.messages);
  let left = limitOf(recent.tokens);
  for (let i = messages.length - 1; i >= 0 && out.length < most && left > 0; i--) {
    const m = messages[i];
    if (!m) continue;
    const raw = m.swipes[m.swipeId] ?? "";
    const text = (m.isUser ? raw : readableReply(raw, hideJson)).replace(/\s+/g, " ").trim();
    if (text === "") continue;
    const who = m.isUser ? "Player" : "Story";
    const cost = tokensOf(`${who}: ${text}`);
    if (cost <= left) {
      out.push(`${who}: ${text}`);
      left -= cost;
      continue;
    }
    out.push(`${who}: …${text.slice(text.length - Math.floor((text.length * left) / cost))}`);
    break;
  }
  return out.reverse();
}

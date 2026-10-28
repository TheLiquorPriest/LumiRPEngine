// An action in words, for every surface that tells it (DESIGN §6.2 Outcome, §7): its picks as the
// palette names them, and what one the turn played did, as the narrator is told it. Never an id, and
// nothing the player character may not know: the same names and filters as the palette and the Journal.

import type { EntityId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { tableChoices } from "../shared/tables";
import type { ActionDef, ParamDef, WorldDoc } from "../shared/world";
import { formatMoney } from "../shared/world";
import { EXTERNAL_ACCOUNT_PREFIX } from "./events";
import { namesHiddenOrSecretLore } from "./lore";
import { optionalQuery, own } from "./pack-kit";
import { playerLines, povMayKnow } from "./player-events";
import type { Registry } from "./registry-impl";
import { findAction, outsideOf, type Resolution } from "./resolve";
import type { WorldState } from "./state";
import { canSeeEntity, canSeePlace, findLeaks, playerTrack, unrevealedSecrets } from "./visibility";

/** A game-time span in words: "45 min", "2.5 hours", "30 days". */
export function spanText(minutes: number): string {
  if (minutes >= 1440) return `${Math.round((minutes / 1440) * 10) / 10} ${minutes === 1440 ? "day" : "days"}`;
  if (minutes >= 60) return `${Math.round((minutes / 60) * 10) / 10} ${minutes === 60 ? "hour" : "hours"}`;
  return `${minutes} min`;
}

/** A game-time span, compact: "45 min", "8 h 55 min", "3 d 4 h" (chip labels). */
export function compactSpan(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const rest = total % 60;
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`;
}

/** The param that counts an action's thing (Buy's, a holding's sale): it reads with that thing. */
const COUNT_PARAM = "qty";

/** A param's label for a palette step: its own, else its ref kind's ("Person"), else a count's "How many", else its name in words ("Days"). */
export function paramLabel(action: ActionDef, name: string, world: WorldDoc, registry: Registry): string {
  const def = action.params[name];
  if (def?.label) return def.label;
  const kind = def?.ref ? (world.kinds[def.ref] ?? registry.kinds.get(def.ref)) : undefined;
  if (kind?.label) return kind.label;
  if (name === COUNT_PARAM) return "How many";
  const words = name.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * How a surface reads an action's picks (`actionWords`). `typed` is the player's message for a pick
 * shown as they typed it; `heard` what its reader has seen said, which no screen counts against it.
 */
function pickReader(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, typed: string, heard: string) {
  const said = heard.toLowerCase();
  const secrets = unrevealedSecrets(registry, world, state).filter((s) => !said.includes(s.toLowerCase()));
  const screened = (words: string): string | null => (findLeaks(words, secrets).length > 0 || namesHiddenOrSecretLore(registry, world, state, words, heard) ? null : words);
  const nameOf = (value: JsonValue | undefined): string | null => {
    if (typeof value !== "string" || value === "") return null;
    const entity = own(state.entities, value);
    if (entity) return povMayKnow(registry, world, state, value) ? entity.name : null;
    const place = own(world.places, value);
    if (place) return canSeePlace(registry, world, state, world.pov, value) ? place.name : null;
    return null;
  };
  // A value the world has no name for, as the player typed it: "_" and "~" read as spaces, and
  // case aside, so a model's "red_door" for a typed "Red Door" is found, and shown as typed.
  const asTyped = (value: string): string | null => {
    const words = value.replace(/[_~]/g, " ").trim();
    if (typed === "" || words === "") return null;
    const found = new RegExp(words.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s_~]+"), "iu").exec(typed);
    return found ? screened(found[0]) : null;
  };
  // A text pick as the palette and the quest log label it: a table row, a stat, a quest row (by the id
  // its row goes by, a stand-in included), someone or somewhere the player character may know of.
  const labelOf = (table: string | undefined, value: string): string | null => {
    if (table !== undefined) return tableChoices(own(world.tables, table)).find((row) => row.key === value)?.label ?? null;
    const ctx = registry.context(world, state);
    const stat = (optionalQuery(ctx, "sheets.stats")?.(ctx) ?? []).find((s) => s.id === value);
    if (stat) return stat.label;
    for (const id of Object.keys(world.tracks)) {
      const shown = playerTrack(registry, world, state, world.pov, id);
      if (shown?.id === value) return shown.label;
    }
    return nameOf(value);
  };
  // A pick given as text (not a ref or a list of refs): as labelled (`label`, words the value stands
  // for); else as written, unless written as an id (one word with `_` or `~`), which names nothing the
  // player has words for; else as the player typed it. Null when none may be shown.
  const text = (def: ParamDef, value: string): { words: string; label: boolean } | null => {
    const label = labelOf(def.table, value);
    if (label !== null) return findLeaks(label, secrets).length === 0 ? { words: label, label: true } : null;
    const words = (def.table === undefined && !(/^\S+$/.test(value) && /[_~]/.test(value)) ? screened(value) : null) ?? asTyped(value);
    return words === null ? null : { words, label: false };
  };
  // Whom a param that pays pays (DESIGN §9.4 typed money): the player's own words for what they named
  // when it was paid in another's place (`words`), held to what was heard as their other words are;
  // else a party the POV can see by name, as the Money views name a payee; else, on a surface the
  // player reads, the outside account by its key in words ("World"), which a narrator's surface
  // leaves unsaid.
  const payee = (def: ParamDef, value: JsonValue | undefined, words: string | undefined): string | null => {
    if (words !== undefined) return screened(words);
    if (typeof value !== "string" || value === "") return null;
    const entity = own(state.entities, value);
    if (entity) return canSeeEntity(registry, world, state, world.pov, value) ? entity.name : null;
    if (value !== outsideOf(def)) return nameOf(value) ?? asTyped(value);
    const key = value.startsWith(EXTERNAL_ACCOUNT_PREFIX) ? value.slice(EXTERNAL_ACCOUNT_PREFIX.length).replace(/[_:]+/g, " ").trim() : "";
    return typed === "" || key === "" ? null : `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  };
  return { nameOf, asTyped, text, payee };
}

/**
 * An action's picks in words, as the palette names them ("Bluebird Coffee, with Danny Okafor"):
 * each place or person by name, a list of people after "with", an amount in the world's currency, a
 * count with the thing it counts ("2 coffees"), another number with its label, a length of time, a
 * table row, a stat or a quest by the label the palette and the quest log give it, and other text as
 * written. Never an id: a pick the player character may not know of (a hidden place, someone it
 * hasn't met) is left out, and text written as an id names nothing the player has words for. For a
 * surface the player reads (the intent gate's card), `typed` is their message, theirs to see again: a
 * pick the world has no name for (a thing they say they have, "letter"; a code written as an id,
 * "red_door") shows as they typed it, whether or not a hidden thing goes by it, so a pick that is a
 * hidden thing's id reads as one nothing has. A surface the narrator reads passes none, and hears the
 * turn's own message (`heard`), which the narrator reads anyway. Words no name vouches for, as
 * written or as typed, are left out when they carry a secret or name anything hidden
 * (`namesHiddenOrSecretLore`) that `heard` doesn't say too: a model's read may write a hidden person
 * into a free-text pick ("Vex Morrow" for "whoever was in the shop last night"), while the player's
 * own words read the same whether or not someone hidden goes by them. A receiver a param that pays
 * paid in another's place reads as the player's own words for what they named (`said`, DESIGN §9.4
 * typed money: "the tip jar"), else as whom it pays.
 */
export function actionWords(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, action: ActionDef, params: JsonObject, typed = "", heard = typed, said: Readonly<Record<string, string>> = {}): string {
  const read = pickReader(registry, world, state, typed, heard);
  // A count of the action's thing (`qty`) reads with it ("2 coffees"), never apart as a number with its label.
  const count = action.params[COUNT_PARAM]?.type === "number" && typeof params[COUNT_PARAM] === "number" ? params[COUNT_PARAM] : null;
  const counted = count === null ? undefined : Object.keys(action.params).find((name) => name !== COUNT_PARAM && (action.params[name]?.type === "ref" || action.params[name]?.type === "text"));
  const parts: string[] = [];
  let counts = false;
  for (const [name, def] of Object.entries(action.params)) {
    const value = params[name];
    if (value === undefined || value === null || value === "" || (name === COUNT_PARAM && counted !== undefined)) continue;
    let word: string | null = null;
    if (def.type === "ref") word = def.outside !== undefined ? read.payee(def, value, said[name]) : (read.nameOf(value) ?? (typeof value === "string" ? read.asTyped(value) : null));
    else if (def.type === "list" && def.ref !== undefined) {
      const names = (Array.isArray(value) ? value : []).map(read.nameOf).filter((n): n is string => n !== null);
      if (names.length > 0) word = `with ${names.join(" and ")}`;
    } else if (def.type === "money" && typeof value === "number") word = formatMoney(value, world.currency);
    else if (def.type === "number" && typeof value === "number") word = `${value} ${paramLabel(action, name, world, registry).toLowerCase()}`;
    else if (def.type === "duration" && typeof value === "number" && value > 0) word = compactSpan(value);
    else if (typeof value === "string") word = read.text(def, value)?.words ?? null;
    if (word === null) continue;
    if (name === counted && count !== null && count !== 1) {
      // Only the player's own words are made plural ("2 coffees"); a name (someone's, a holding's) or a
      // table's label ("Drip coffee, 12 oz, cafe") is counted as it stands ("Apple stock × 5").
      word = def.type === "text" && def.table === undefined && /^[\w\s'-]+$/.test(word) ? `${count} ${plural(word)}` : `${word} × ${count}`;
      counts = true;
    }
    parts.push(word);
  }
  // A count whose thing has no words still says how many.
  if (count !== null && count !== 1 && counted !== undefined && !counts) parts.push(`× ${count}`);
  return parts.join(", ");
}

/**
 * The text picks the intent gate's Edit opens the palette with (DESIGN §5.1), as its card shows them
 * (`actionWords`, the player's message `typed`): a pick the card names by its label as the value it
 * stands for (a table row, a stat, a quest, someone or somewhere the player character may know of),
 * else in the card's words for it; null when the card shows none, so the page gets no free text that
 * carries a secret or names anything hidden the player didn't type.
 */
export function editedText(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, typed: string): (def: ParamDef, value: string) => string | null {
  const read = pickReader(registry, world, state, typed, typed);
  return (def, value) => {
    const shown = read.text(def, value);
    return shown === null ? null : shown.label ? value : shown.words;
  };
}

/**
 * The plural of what a player typed or a table names ("coffee" → "coffees", "bag of chips" → "bags
 * of chips"): the head word before an "of", else the last word. A word already ending in a single
 * "s" ("chips") is taken as plural.
 */
function plural(text: string): string {
  const of = text.search(/\s+of\s+/i);
  const head = of >= 0 ? text.slice(0, of) : text;
  const rest = of >= 0 ? text.slice(of) : "";
  const m = /([A-Za-z]+)$/.exec(head);
  if (!m) return text;
  const word = m[1] ?? "";
  const many = /[^s]s$/i.test(word) ? word : /(?:s|x|z|ch|sh)$/i.test(word) ? `${word}es` : /[^aeiou]y$/i.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`;
  return `${head.slice(0, head.length - word.length)}${many}${rest}`;
}

/**
 * One of the turn's actions as the narrator is told it (DESIGN §6.2 Outcome, the Outline's beats):
 * `what` names the action, its picks in words and, when it moved its actor, where from ("Go to
 * (Bluebird Coffee, from Alder Automotive)"); `changes` are its own events as the Journal words them
 * (`playerLines`: the POV's view, hidden names and secrets left out); `minutes` is the time it took.
 */
export interface ToldAction {
  what: string;
  changes: string[];
  minutes: number;
}

/** The most changes one action's line tells: past them, the Journal's ranking keeps money and quests first. */
const TOLD_CHANGES = 6;

/**
 * What the turn knew of an action just before it played: its picks in words, read then (a thing it
 * gives away or uses up is still the POV's to name), where the POV stood, and the POV's fields then.
 */
export interface BeforeAction {
  picks: string;
  from: EntityId | null;
  fields: Readonly<JsonObject>;
}

/**
 * `ToldAction` for a resolution the turn played. Its changes are read against `state` after the
 * turn, as the Journal reads the turn's events, and are what it left changed: a field of its actor
 * that it set and set back (travel while walking, idle on arrival) didn't change.
 */
export function toldAction(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, res: Resolution, before: BeforeAction): ToldAction {
  const label = res.inferred?.label ?? findAction(registry, world, res.action)?.label ?? res.action;
  const parts = before.picks === "" ? [] : [before.picks];
  // A move says where it started, as the POV knew the place; where it went is among its picks and changes.
  const moved = res.events.findLast((e) => e.type === "set" && e.entity === res.actor && e.field === "place");
  const from = before.from;
  const fromPlace = from ? own(world.places, from) : undefined;
  if (moved && from && fromPlace && moved.type === "set" && moved.value !== from && canSeePlace(registry, world, state, world.pov, from)) parts.push(`from ${fromPlace.name}`);
  const last = new Map<string, JsonValue>();
  for (const e of res.events) if (e.type === "set" && e.entity === res.actor) last.set(e.field, e.value);
  const unchanged = new Set([...last].filter(([field, value]) => JSON.stringify(value) === JSON.stringify(before.fields[field] ?? null)).map(([field]) => field));
  const events = res.events.filter((e) => !(e.type === "set" && e.entity === res.actor && unchanged.has(e.field)));
  return { what: parts.length > 0 ? `${label} (${parts.join(", ")})` : label, changes: playerLines(registry, world, state, world.pov, events, TOLD_CHANGES), minutes: res.duration };
}

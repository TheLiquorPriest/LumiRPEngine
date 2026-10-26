// An action in words, for every surface that tells it (DESIGN §6.2 Outcome, §7): its picks as the
// palette names them, and what one the turn played did, as the narrator is told it. Never an id, and
// nothing the player character may not know: the same names and filters as the palette and the Journal.

import type { EntityId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn } from "../shared/json";
import { tableChoices } from "../shared/tables";
import type { ActionDef, WorldDoc } from "../shared/world";
import { formatMoney } from "../shared/world";
import { optionalQuery, own } from "./pack-kit";
import { playerLines, povMayKnow } from "./player-events";
import type { Registry } from "./registry-impl";
import { findAction, type Resolution } from "./resolve";
import type { WorldState } from "./state";
import { canSeePlace, findLeaks, playerTrack, unrevealedSecrets } from "./visibility";

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
 * An action's picks in words, as the palette names them ("Bluebird Coffee, with Danny Okafor"):
 * each place or person by name, a list of people after "with", an amount in the world's currency, a
 * count with the thing it counts ("2 coffees"), another number with its label, a length of time, a
 * table row, a stat or a quest by the label the palette and the quest log give it, and other text as
 * written. Never an id: a pick the player character may not know of (a hidden place, someone it
 * hasn't met) is left out, as is text naming a secret, and text written as an id that names nothing
 * the player has words for. What the player typed (`typed`, their message) is theirs to see again: a
 * pick the world has no name for (a thing they say they have, "letter"; a code written as an id,
 * "red_door") shows as they typed it, and a secret's words they typed don't hide it. A hidden
 * person's, thing's or place's id never shows.
 */
export function actionWords(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, action: ActionDef, params: JsonObject, typed = ""): string {
  const said = typed.toLowerCase();
  const secrets = unrevealedSecrets(registry, world, state).filter((s) => !said.includes(s.toLowerCase()));
  const nameOf = (value: JsonValue | undefined): string | null => {
    if (typeof value !== "string" || value === "") return null;
    const entity = own(state.entities, value);
    if (entity) return povMayKnow(registry, world, state, value) ? entity.name : null;
    const place = own(world.places, value);
    if (place) return canSeePlace(registry, world, state, world.pov, value) ? place.name : null;
    return null;
  };
  // A value the world has no name for, as the player typed it: "_" and "~" read as spaces on both
  // sides, so a model's "red_door" for a typed "red door" is found, and shown as typed.
  const asTyped = (value: string): string | null => {
    if (said === "" || hasOwn(state.entities, value) || hasOwn(world.places, value)) return null;
    const [plainValue = "", typedPlain = ""] = [value, typed].map((s) => s.toLowerCase().replace(/[_~]/g, " "));
    const wanted = plainValue.trim();
    const at = wanted === "" ? -1 : typedPlain.indexOf(wanted);
    if (at < 0) return null;
    const words = typedPlain.length === typed.length ? typed.slice(at, at + wanted.length) : value;
    return findLeaks(words, secrets).length === 0 ? words : null;
  };
  // A text pick as the palette and the quest log label it: a table row, a stat, a quest row (by the id its row goes by, a stand-in included).
  const labelOf = (table: string | undefined, value: string): string | null => {
    if (table !== undefined) return tableChoices(own(world.tables, table)).find((row) => row.key === value)?.label ?? null;
    const ctx = registry.context(world, state);
    const stat = (optionalQuery(ctx, "sheets.stats")?.(ctx) ?? []).find((s) => s.id === value);
    if (stat) return stat.label;
    for (const id of Object.keys(world.tracks)) {
      const shown = playerTrack(registry, world, state, world.pov, id);
      if (shown?.id === value) return shown.label;
    }
    if (hasOwn(state.entities, value) || hasOwn(world.places, value)) return nameOf(value);
    // Written as an id (one word with `_` or `~`), it names nothing the player has words for.
    return /^\S+$/.test(value) && /[_~]/.test(value) ? null : value;
  };
  // A count of the action's thing (`qty`) reads with it ("2 coffees"), never apart as a number with its label.
  const count = action.params[COUNT_PARAM]?.type === "number" && typeof params[COUNT_PARAM] === "number" ? params[COUNT_PARAM] : null;
  const counted = count === null ? undefined : Object.keys(action.params).find((name) => name !== COUNT_PARAM && (action.params[name]?.type === "ref" || action.params[name]?.type === "text"));
  const parts: string[] = [];
  let counts = false;
  for (const [name, def] of Object.entries(action.params)) {
    const value = params[name];
    if (value === undefined || value === null || value === "" || (name === COUNT_PARAM && counted !== undefined)) continue;
    let word: string | null = null;
    if (def.type === "ref") word = nameOf(value) ?? (typeof value === "string" ? asTyped(value) : null);
    else if (def.type === "list" && def.ref !== undefined) {
      const names = (Array.isArray(value) ? value : []).map(nameOf).filter((n): n is string => n !== null);
      if (names.length > 0) word = `with ${names.join(" and ")}`;
    } else if (def.type === "money" && typeof value === "number") word = formatMoney(value, world.currency);
    else if (def.type === "number" && typeof value === "number") word = `${value} ${paramLabel(action, name, world, registry).toLowerCase()}`;
    else if (def.type === "duration" && typeof value === "number" && value > 0) word = compactSpan(value);
    else if (typeof value === "string") {
      const text = labelOf(def.table, value) ?? asTyped(value);
      if (text && findLeaks(text, secrets).length === 0) word = text;
    }
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

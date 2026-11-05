// Move to… (Play → Me → Belongings, the item sheet, the Garage): one sheet that moves one thing or
// many at once, off screen, as one ✎ fix (`lre.fix {things}`) with one Undo. It is the where
// picker's sheet over the player-safe choices (`play-where.ts`): Where it's kept (each thing put
// away), then the chat's recent targets, On you, Here and Home, and the browse; a holder too small
// for the biggest of them, or already full, is held back with why. Picking a person here hands the
// things to them to hold, which the story is told of; picking the player character, a holder or a
// place moves them there. A pick is remembered as the chat's newest recent target.

import { useMemo } from "preact/hooks";
import type { ChatId, EntityId, PlaceId } from "../../shared/ids";
import { FIX_THINGS_MAX } from "../../shared/protocol";
import type { ItemFix, SizeClass } from "../../shared/things";
import { SIZES } from "../../shared/things";
import type { WhereChoice } from "../../shared/thing-view";
import { listWords } from "../../shared/words";
import { thingsFix, type AtOnce, type ThingsFixRequest } from "./at-once";
import { moveSuggestions, pageStore, recentMoves, rememberMove, type RecentStore } from "./play-where";
import { WhereSheet, type WhereExtra, type WherePick } from "./where-picker";

/** A thing Move to… moves: its id, its name and its size, when anything gives it. */
export interface MoveThing {
  id: EntityId;
  name: string;
  size?: SizeClass;
}

/** Where the player character is, and their home: for On you, Here and Home. */
export interface MoveAt {
  pov: EntityId | null;
  here: PlaceId | null;
  home: PlaceId | null;
}

/** The extra choice that puts each thing back where it is kept (`away`). */
export const KEPT_CHOICE = "kept";

/** The biggest of the things, for what can't hold them: a vehicle over every size, the ladder's largest otherwise; null when none says. */
export function biggestSize(things: readonly MoveThing[]): SizeClass | null {
  if (things.some((t) => t.size === "vehicle")) return "vehicle";
  const ranks = things.map((t) => SIZES.findIndex((s) => s === t.size)).filter((r) => r >= 0);
  return ranks.length === 0 ? null : (SIZES[Math.max(...ranks)] ?? null);
}

/** The things a sentence names: up to three by name, more by how many, and whether the verb is plural. */
export function thingNames(things: readonly { name: string }[]): { names: string; many: boolean } {
  return { names: things.length <= 3 ? listWords(things.map((t) => t.name)) : `${things.length} things`, many: things.length !== 1 };
}

/** The fixes a pick makes, one a thing: each put away; handed to a person here to hold; or moved on to the player character, into a holder or to a place. */
export function moveFixes(things: readonly MoveThing[], pick: WherePick, pov: EntityId | null): ItemFix[] {
  if ("extra" in pick) return things.map((t) => ({ do: "away", item: t.id }));
  const choice = pick.choice;
  if (choice.is === "person" && choice.id !== pov) return things.map((t) => ({ do: "hand", item: t.id, to: choice.id, basis: "hold" }));
  return things.map((t) => ({ do: "move", item: t.id, to: choice.is === "place" ? { place: choice.id } : { in: choice.id } }));
}

/** What a pick did, in a sentence: the notice's, and the fix's label. */
export function moveWords(things: readonly MoveThing[], pick: WherePick, pov: EntityId | null): string {
  const { names, many } = thingNames(things);
  const is = many ? "are" : "is";
  if ("extra" in pick) return many ? `${names} are put away, each where it is kept.` : `${names} is put away where it is kept.`;
  const choice = pick.choice;
  if (choice.is === "person") return choice.id === pov ? `${names} ${is} on you now.` : `${choice.name} is holding ${names} for you.`;
  return choice.is === "place" ? `${names} ${is} at ${choice.name} now.` : `${names} ${is} in ${choice.name} now.`;
}

/** The one at-once request a pick sends: every thing's fix in one `lre.fix`, its label the sentence. */
export function moveRequest(chatId: ChatId, things: readonly MoveThing[], pick: WherePick, pov: EntityId | null): ThingsFixRequest {
  return thingsFix(chatId, moveFixes(things, pick, pov), moveWords(things, pick, pov));
}

/** The choices a move may take the things to: never one of them, nor anything inside one of them. */
export function moveChoices(choices: readonly WhereChoice[], things: readonly MoveThing[]): WhereChoice[] {
  const moving = new Set(things.map((t) => t.id));
  return choices.filter((c) => !moving.has(c.id) && !c.path.some((s) => moving.has(s.id)));
}

/**
 * Move to…'s sheet. `kept` offers Where it's kept (in words, for one thing); `blocked` holds back a
 * holder already full; `atOnce` sends the request, its notice and Undo the caller's; `store` keeps
 * the chat's recent targets (the page's storage, by default).
 */
export function MoveSheet(props: { chatId: ChatId; things: readonly MoveThing[]; choices: readonly WhereChoice[]; at: MoveAt; kept?: string | null; blocked?(choice: WhereChoice): string | null; atOnce: AtOnce; title?: string; store?: RecentStore; onClose(): void; onMoved?(): void }) {
  const store = props.store ?? pageStore;
  const choices = useMemo(() => moveChoices(props.choices, props.things), [props.choices, props.things]);
  const suggestions = useMemo(() => moveSuggestions(choices, { recent: recentMoves(store, props.chatId), ...props.at }), [choices, props.chatId, props.at]);
  const { names } = thingNames(props.things);
  const over = props.things.length > FIX_THINGS_MAX;
  const extras: WhereExtra[] = props.kept === undefined ? [] : [{ value: KEPT_CHOICE, label: "Where it's kept", help: props.kept ?? (props.things.length === 1 ? "Back where it belongs" : "Each back where it belongs") }];
  const pick = (next: WherePick | null): void => {
    if (next === null || over || props.atOnce.busy) return;
    props.atOnce.send(moveRequest(props.chatId, props.things, next, props.at.pov), moveWords(props.things, next, props.at.pov), () => {
      if ("choice" in next) rememberMove(store, props.chatId, next.choice.id);
      props.onMoved?.();
      props.onClose();
    });
  };
  return <WhereSheet title={props.title ?? (over ? `Pick at most ${FIX_THINGS_MAX}` : `Move ${names} to`)} choices={choices} value={null} size={biggestSize(props.things)} blocked={props.blocked} extras={extras} suggestions={suggestions} empty="Pick where" onClose={props.onClose} onPick={pick} />;
}

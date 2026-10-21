// A routine the player's own message states (DESIGN §9.4, §8): "I start nights at the marina
// Monday", or "Marcus says he's started swimming on Tuesdays". `interpret` reads it beside the
// message's actions; it never plays. The chat asks on the player's message ("Would you like to add
// this to your routine?"), and only the player's yes records it, through the `routine` channel and
// its `castlife.routine` effect, as the story's changes are, with the message as its turn and the
// player as who said it. A routine is the player's to change, but never by a misread: so it is
// bounded as the reply's channel is (`storyChange`), and more:
//   - the words are the player's own, in their message, and a statement, never a question;
//   - whose: the player character, or someone the message names, whom the POV may know;
//   - what it names: what the POV may know (a secret place is no place), and no unrevealed secret;
//   - nothing new changes nothing: one already in their routine or schedule is never asked about.

import type { EntityId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn } from "../shared/json";
import type { WorldDoc } from "../shared/world";
import type { Registry } from "../engine/registry-impl";
import type { WorldState } from "../engine/state";
import { canSeePlace, findLeaks } from "../engine/visibility";
import { own } from "../engine/pack-kit";
import { namedInText } from "../packs/minds/core/fidelity";
import { ROUTINE_CHANNEL, storyChange } from "../packs/castlife/core/story";
import type { SaidRoutine } from "./steps";
import type { RoutineAsk } from "./turn-model";

/** Who said a routine change, in its proposal and so in its source: the player, in their own message. */
export const SAID_BY_PLAYER = "player";

/**
 * Whether `said` is the player's own words in `text` and states something: it must be in the message
 * as typed, and the sentence it stands in must not be a question ("do you still swim on Tuesdays?").
 */
export function statedIn(text: string, said: string): boolean {
  // Lines stay apart: a line break ends a sentence, so a question on the next line never reaches back.
  const all = text.replace(/[^\S\n]+/g, " ").toLowerCase();
  const words = said.replace(/\s+/g, " ").trim().toLowerCase().replace(/[.!?…]+$/, "");
  const at = words === "" ? -1 : all.indexOf(words);
  if (at < 0) return false;
  const end = all.slice(at + words.length).search(/[.!?\n]/);
  return end < 0 || all.charAt(at + words.length + end) !== "?";
}

function str(v: JsonValue | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}

/** The routine change in plain words, as the chip names it: who, what, when and where. */
function plainly(p: JsonObject, world: WorldDoc, state: Readonly<WorldState>): { whose: string; detail: string } {
  const who = str(p.entity);
  const you = who === world.pov;
  const name = state.entities[who]?.name ?? who;
  const placeName = (v: JsonValue | undefined): string => {
    const id = str(v);
    return hasOwn(world.places, id) ? (world.places[id]?.name ?? id) : id;
  };
  const whose = you ? "your routine" : `${name}'s routine`;
  const subject = you ? "You" : name;
  const change = str(p.change).toLowerCase();
  if (change === "move") return { whose, detail: `${subject}: a new home at ${placeName(p.place)}.` };
  const label = str(p.label) || placeName(p.place);
  if (change === "stop") return { whose, detail: `${subject}: no more ${label}.` };
  const days = Array.isArray(p.days) ? p.days.filter((d): d is string => typeof d === "string").join(", ") : str(p.days);
  const start = str(p.start);
  const end = str(p.end);
  const time = start === "" ? "" : end === "" ? start : `${start}–${end}`;
  // Each part once: a place or a person the label already names ("Swimming at Lakefront Park") isn't named again.
  const said = label.toLowerCase();
  const place = str(p.place) === "" ? "" : placeName(p.place);
  const where = place === "" || said.includes(place.toLowerCase()) ? "" : `at ${place}`;
  const company = (Array.isArray(p.with) ? p.with : []).flatMap((id) => (typeof id === "string" && state.entities[id] ? [state.entities[id]?.name ?? id] : [])).filter((n) => !said.includes(n.toLowerCase()));
  const parts = [label, days, time, where, company.length > 0 ? `with ${company.join(" and ")}` : ""].filter((s) => s !== "");
  return { whose, detail: `${subject}: ${parts.join(", ")}, from the next day.` };
}

/** The `routine` channel's own fields: nothing else the read gave rides into the proposal. */
const FIELDS = ["entity", "change", "label", "days", "start", "end", "minutes", "activity", "place", "with", "replaces"] as const;

/** Words that name no place ("the", "at the"). */
const NOT_PLACE: Record<string, true> = { the: true, and: true, our: true, his: true, her: true, their: true };

function wordsIn(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 2 && !NOT_PLACE[w]);
}

/**
 * Where the player's place words lead, among the places the POV may know only: the place itself (its
 * id or its whole name), else every place each of whose words starts one of its name's words ("the
 * lake": Lakefront Park and Lakeshore County). A place the world lacks and one the POV may not know
 * both fit none, so the ask reads alike for both and never offers a secret one.
 */
function placesFor(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, said: string): string[] {
  const known = Object.keys(world.places).filter((id) => canSeePlace(registry, world, state, world.pov, id));
  const exact = known.filter((id) => id === said || own(world.places, id)?.name.toLowerCase() === said.toLowerCase());
  if (exact.length > 0) return exact.slice(0, 1);
  const words = wordsIn(said);
  if (words.length === 0) return [];
  return known.filter((id) => {
    const name = wordsIn(own(world.places, id)?.name ?? "");
    return words.every((w) => name.some((n) => n.startsWith(w)));
  });
}

/**
 * The routine changes a typed message states that the chat may ask about, each as the `routine`
 * channel's proposal with `by: "player"`, its question and its plain words. What fails a bound is
 * left out in silence: the player stated it, and the turn plays as their message does either way.
 * A place the player named is theirs to settle, unlike a reply's: several places they may know fit
 * it and the ask offers each; none fits and it asks still, saying it would have no set place.
 * `known`: whether everything a proposal names is what the POV may know (`proposalKnown`).
 */
export function routineAsks(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, said: readonly SaidRoutine[], text: string, secrets: readonly string[], known: (p: JsonObject) => boolean): RoutineAsk[] {
  const ctx = registry.context(world, state);
  const asks: RoutineAsk[] = [];
  for (const r of said) {
    if (!statedIn(text, r.said)) continue;
    const proposal: JsonObject = { type: ROUTINE_CHANNEL };
    for (const k of FIELDS) if (r[k] !== undefined) proposal[k] = r[k];
    proposal.by = SAID_BY_PLAYER;
    const who: EntityId = str(proposal.entity);
    if (who !== world.pov && !namedInText(state.entities[who]?.name ?? "", text)) continue;
    if (!known(proposal) || findLeaks(proposal, secrets).length > 0) continue;
    // The place words, for a new block: home and work are their own; a move's home must be a place.
    const placeWords = str(proposal.place);
    const open = placeWords !== "" && placeWords.toLowerCase() !== "home" && placeWords.toLowerCase() !== "work" && str(proposal.change).toLowerCase() === "start";
    const fits = open ? placesFor(registry, world, state, placeWords) : [];
    const { place: _place, ...placeless } = proposal;
    const variants = !open ? [proposal] : fits.length === 0 ? [placeless] : fits.map((id): JsonObject => ({ ...proposal, place: id }));
    const holding = variants.filter((v) => !("code" in storyChange(v, ctx)));
    const first = holding[0];
    if (!first) continue;
    // One message asks once about the same change.
    if (asks.some((a) => JSON.stringify(a.proposal) === JSON.stringify(first))) continue;
    const { whose } = plainly(first, world, state);
    const base = { question: `Would you like to add this to ${whose}?`, added: `Added to ${whose}` };
    if (holding.length > 1) {
      const { detail } = plainly(placeless, world, state);
      asks.push({ ...base, proposal: first, detail: `${detail} Which place?`, places: holding.map((v) => ({ label: `At ${own(world.places, str(v.place))?.name ?? str(v.place)}`, proposal: v })) });
      continue;
    }
    const { detail } = plainly(first, world, state);
    // The player's own words, quoted only when the message holds them, so a read's guess never names a place.
    const quoted = text.toLowerCase().includes(placeWords.toLowerCase()) ? `"${placeWords}"` : "the place you named";
    asks.push({ ...base, proposal: first, detail: open && fits.length === 0 ? `${detail} No place you know of fits ${quoted}, so it would have no set place.` : detail });
  }
  return asks;
}

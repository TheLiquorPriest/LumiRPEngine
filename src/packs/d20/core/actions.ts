// The layer's actions (RULESET-DESIGN §5.1), each carried out by `act`, so the palette, a kept press, `checks_odds`, a ruled
// `outcome` and Undo come with it. An action's whole procedure is one effect of the pack's (`d20.<action>`), which reads the sheet
// and the ruleset, rolls what it rolls, and records it; a ruled outcome is handed to it, so it rolls nothing the GM ruled.
// `who` (the act's own) is the one who acts: who checks, saves, attacks, rests or advances; whom a condition, an effect, a trait or
// ranks are given to; who is harmed or healed, unless `targets` or an area names others.

import type { ParamDef } from "../../../shared/world";
import type { PackAction } from "../../../engine/registry";
import type { D20ActionId } from "../../../shared/d20";

const TEXT: ParamDef = { type: "text" };
const MAYBE_TEXT: ParamDef = { type: "text", optional: true };
const MAYBE_NUMBER: ParamDef = { type: "number", optional: true };
const MAYBE_YES: ParamDef = { type: "bool", optional: true };
const SOMEONE: ParamDef = { type: "ref", ref: "person" };
const MAYBE_SOMEONE: ParamDef = { type: "ref", ref: "person", optional: true };
const SEVERAL: ParamDef = { type: "list", ref: "person", optional: true };
/** Modifiers the GM names: each a number with its type, what it changes and why ("+2 circumstance: high ground"), or the same as an object. */
const MODS: ParamDef = { type: "list", optional: true };
/** How long: in its doer's turns in a fight, in minutes or in hours; none, until taken off. */
const LENGTH: Record<string, ParamDef> = { rounds: MAYBE_NUMBER, minutes: MAYBE_NUMBER, hours: MAYBE_NUMBER };
/** A save that ends it, or that each in an area makes: which, and the difficulty. */
const SAVE: Record<string, ParamDef> = { save: MAYBE_TEXT, difficulty: MAYBE_TEXT };

/** The layer's own requirement: its domain on in the chat. Told when it does not hold; `act` carries the action out all the same. */
const ON = "level.d20 >= 1";

/** An action of one procedure: every outcome it may be ruled with runs the same effect, told which was ruled. */
function action(id: D20ActionId, params: Record<string, ParamDef>, outcomes: readonly string[], minutes: string, more: Partial<PackAction> = {}): PackAction {
  const effect = `d20.${id === "d20_rest" ? "rest" : id}`;
  const out: PackAction["outcomes"] = { default: [{ type: effect, args: { who: "self" } }] };
  for (const o of outcomes) out[o] = [{ type: effect, args: { who: "self", ruled: o } }];
  return { id, pack: "d20", params, requires: [ON], outcomes: out, duration: minutes, ...more };
}

export const D20_ACTION_DEFS: readonly PackAction[] = [
  action("check", { skill: TEXT, difficulty: MAYBE_TEXT, vs: MAYBE_SOMEONE, vs_skill: MAYBE_TEXT, take: MAYBE_TEXT, aid: SEVERAL, mods: MODS }, ["success", "failure"], "1", {
    lexicon: ["roll for", "make a check", "use my skill"],
    observable: "puts a skill to use",
  }),
  action("save", { save: TEXT, difficulty: TEXT, also: SEVERAL, mods: MODS }, ["success", "failure"], "0", {
    lexicon: ["make a save", "resist"],
    observable: "braces against it",
  }),
  action(
    "attack",
    { target: SOMEONE, with: MAYBE_TEXT, full: MAYBE_YES, touch: MAYBE_YES, held: MAYBE_TEXT, shots: MAYBE_TEXT, nonlethal: MAYBE_YES, concealment: MAYBE_NUMBER, mods: MODS },
    ["hit", "miss", "critical"],
    "0",
    { lexicon: ["attack", "strike at", "shoot at", "swing at"], observable: "attacks" },
  ),
  action("harm", { amount: TEXT, type: MAYBE_TEXT, nonlethal: MAYBE_YES, targets: SEVERAL, centre: MAYBE_SOMEONE, radius: MAYBE_NUMBER, ...SAVE, half: MAYBE_YES, why: MAYBE_TEXT }, [], "0"),
  action("heal", { amount: MAYBE_TEXT, nonlethal: MAYBE_YES, temporary: MAYBE_YES, stabilize: MAYBE_YES, why: MAYBE_TEXT }, [], "0"),
  action("condition", { condition: TEXT, off: MAYBE_YES, ...LENGTH, ...SAVE, why: MAYBE_TEXT }, [], "0"),
  action("effect", { label: TEXT, mods: MODS, off: MAYBE_YES, ...LENGTH, ...SAVE, why: MAYBE_TEXT }, [], "0"),
  action("d20_rest", { hours: MAYBE_NUMBER, also: SEVERAL }, [], "rest_minutes(params.hours)", {
    lexicon: ["rest for the night", "sleep it off"],
    observable: "rests",
  }),
  action("reload", { item: MAYBE_TEXT }, [], "0", { lexicon: ["reload", "change the magazine"], observable: "reloads" }),
  action("award", { xp: MAYBE_NUMBER, overcame: SEVERAL, also: SEVERAL, why: MAYBE_TEXT }, [], "0"),
  action("advance", { class: TEXT, hp: MAYBE_TEXT }, [], "0"),
  action("trait", { trait: TEXT, choice: MAYBE_TEXT, off: MAYBE_YES, why: MAYBE_TEXT }, [], "0"),
  action("ranks", { skill: TEXT, ranks: { type: "number" } }, [], "0"),
  action("stat_as", { creature: TEXT }, [], "0"),
];

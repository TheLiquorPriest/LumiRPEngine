// An action's requirements in words (DESIGN §11), never as their expressions: an expression can
// name a secret track or someone the player doesn't know. A shape the packs use reads as what it
// needs, for `interpret`'s catalog, and as why it failed, for a decline chip and the Outcome.

import type { ActionDef, Expr } from "../shared/world";
import { identifiers } from "../engine/expr";

/**
 * A requirement's shape and its words: what it needs, with `{p}` for the first param it reads and
 * `{q}` for the second, and how a failure reads for the player (only the shapes a decline has
 * always named carry one).
 */
interface RequirementShape {
  shape: RegExp;
  needs: string;
  fails?: string;
}

/** Most specific first: the first shape a requirement matches words it, in either use. */
const SHAPES: readonly RequirementShape[] = [
  { shape: /\bto\s*!=\s*here\b/, needs: "{p} isn't where you are" },
  // A vehicle driven to where it already stands (`drive`): that's a walk, not a drive.
  { shape: /\bplace\(\w+\)\s*!=\s*\w+/, needs: "{p} isn't at {q} already", fails: "it's there already, so walk there" },
  { shape: /\broute_exists\(/, needs: "a way from here to {p}" },
  { shape: /\bgrid_reachable\(/, needs: "a square of this grid you can walk to" },
  { shape: /\blevel\.(\w+)\s*>=/, needs: "this world simulates it in enough detail", fails: "this world doesn't simulate that in enough detail" },
  // A money feature the world's switches leave off (`money_feature`, DESIGN §25.12): the world, not the place or the hour, rules it out.
  { shape: /\bmoney_feature\(/, needs: "this world keeps track of it", fails: "this world doesn't keep track of that" },
  // Money (DESIGN §25): enough of it, and whose account it is. Whose money comes before who runs it, so a
  // card change refused to someone who neither holds the card nor runs its account reads as the card.
  { shape: /\bcan_afford\(/, needs: "you can afford {p}", fails: "you can't afford it" },
  { shape: /\bholds\(self[^)]*\)\s+or\s+manages\(self/, needs: "{p} is yours, or its account is one you run" },
  { shape: /\b(?:spends|holds)\(self\b/, needs: "{p} is one of your own accounts", fails: "that account isn't yours to use" },
  { shape: /\bmay_draw\(/, needs: "you may take a draw from {p}", fails: "you can't take a draw from it" },
  { shape: /\.worker\s*==\s*self\s+or\s+manages\(self/, needs: "{p} is your own, or you run its employer" },
  { shape: /\.customer\s*==\s*self\s+or\s+manages\(self/, needs: "{p} is billed to you, or to what you run" },
  { shape: /\bmanages\(self,\s*\w+\.\w+/, needs: "you run the business behind {p}" },
  { shape: /\bmanages\(self\b/, needs: "you run {p}", fails: "you don't run it" },
  { shape: /\bis_credit\(/, needs: "{p} is a card, a credit line or a loan", fails: "that isn't a card, a credit line or a loan" },
  { shape: /\bemploys\(/, needs: "{q} doesn't already work there", fails: "they already work there" },
  { shape: /\bowner\s*==\s*self\s+or\s+has_rel\(self,\s*'uses'/, needs: "{p} is yours, or yours to use" },
  { shape: /\bowner\s*==\s*self\s+or\s+carries\(self/, needs: "{p} is yours, or you have it with you" },
  { shape: /\bowner\s*==\s*self\b/, needs: "{p} is yours", fails: "it isn't yours" },
  { shape: /^\s*not\s+carries\(self/, needs: "you don't have {p} already" },
  { shape: /\bcarries\(self[^)]*\)\s+or\s+\(/, needs: "you have {p} with you, or it is within your reach" },
  { shape: /\breach\(self[^)]*\)\)\s+or\s+carries\(self/, needs: "{p} is within your reach, or you have it with you" },
  { shape: /\bcarries\(self/, needs: "you have {p} with you", fails: "you need to have it with you" },
  { shape: /\blent_out\(/, needs: "{p} is lent out", fails: "it isn't lent out" },
  { shape: /\binvited\(/, needs: "{p} invited you" },
  { shape: /\bcan_fight\(/, needs: "{p} is someone you can fight" },
  { shape: /\breach\(self/, needs: "{p} is within your reach" },
  { shape: /\bmovable\(/, needs: "{p} can be picked up", fails: "it can't be picked up: it's a vehicle, built in or fixed in place" },
  { shape: /\bdrive_minutes\(/, needs: "a road there from here" },
  { shape: /\bfuel_ok\(/, needs: "enough fuel to get there" },
  { shape: /\bfuel_pct\([^)]*\)\s*<\s*100\b/, needs: "{p} isn't full" },
  { shape: /\.status\s*!=\s*'broken'/, needs: "{p} isn't broken down" },
  { shape: /\.status\s*!=\s*'ok'/, needs: "{p} needs a repair" },
  { shape: /\.status\s*!=\s*'ended'/, needs: "{p} hasn't ended" },
  { shape: /\.state\s*==\s*'open'/, needs: "{p} is still open" },
  { shape: /\.lost\s*!=\s*true\b/, needs: "{p} isn't lost already" },
  { shape: /\bdays\s*>\s*0\s+or\s+params\.until\b/, needs: "a number of days, or until when" },
  { shape: /\bat\([^)]*\)\s+or\s+at\(/, needs: "{p} or {q} is here" },
  { shape: /\bat\(|\bplace\([^)]*\)\s*==\s*here|==\s*here\b/, needs: "{p} is here", fails: "it has to be here" },
  { shape: />\s*0\b/, needs: "{p} above zero", fails: "it needs an amount" },
];

/** A requirement that holds or not whatever the params: the world's level of detail and its money features. */
const GATE = /\blevel\.\w+\s*>=|\bmoney_feature\(/;

/** The action's params a requirement reads, in the order it names them. */
function paramsRead(action: Pick<ActionDef, "params">, req: Expr): string[] {
  return identifiers(req).filter((name) => Object.prototype.hasOwnProperty.call(action.params, name));
}

/** The requirements that rule an action in or out whatever its params: a level or money-feature gate that reads none of them. */
export function gatesOf(action: Pick<ActionDef, "params" | "requires">): Expr[] {
  return action.requires.filter((req) => GATE.test(req) && paramsRead(action, req).length === 0);
}

/**
 * What the action needs, in words, for `interpret`'s catalog: each requirement that reads one of
 * its params and has a shape the packs use (`SHAPES`), with its params named by `nameOf` ("the
 * person"). A requirement that reads no param holds or fails whatever the params, so it isn't
 * listed (a gate rules the action out instead: `gatesOf`), and one of no known shape isn't either.
 */
export function needsOf(action: Pick<ActionDef, "params" | "requires">, nameOf: (param: string) => string): string[] {
  const out: string[] = [];
  for (const req of action.requires) {
    const read = paramsRead(action, req);
    if (read.length === 0) continue;
    const shape = SHAPES.find((s) => s.shape.test(req));
    if (!shape) continue;
    const words = shape.needs.replace("{p}", nameOf(read[0] ?? "")).replace("{q}", nameOf(read[1] ?? read[0] ?? ""));
    if (!out.includes(words)) out.push(words);
  }
  return out;
}

/** Why a requirement failed, for the player, when its shape is one a decline names; else null. */
export function failureWords(req: Expr): string | null {
  return SHAPES.find((s) => s.fails !== undefined && s.shape.test(req))?.fails ?? null;
}

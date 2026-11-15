// An action's requirements in words (DESIGN §11), never as their expressions: an expression can
// name a secret track or someone the player doesn't know. A shape the packs use reads as what it
// needs, for `interpret`'s catalog, and as why it failed, for a decline chip and the Outcome.

import { requirementExpr, type ActionDef, type Expr } from "../shared/world";
import { identifiers } from "../engine/expr";
import { failureWords, SHAPES } from "../play/state/requirement-words";

/** A requirement that holds or not whatever the params: the world's level of detail and its money features. */
const GATE = /\blevel\.\w+\s*>=|\bmoney_feature\(/;

/** The action's params a requirement reads, in the order it names them. */
function paramsRead(action: Pick<ActionDef, "params">, req: Expr): string[] {
  return identifiers(req).filter((name) => Object.prototype.hasOwnProperty.call(action.params, name));
}

/** The requirements that rule an action in or out whatever its params: a level or money-feature gate that reads none of them. */
export function gatesOf(action: Pick<ActionDef, "params" | "requires">): Expr[] {
  return action.requires.map(requirementExpr).filter((req) => GATE.test(req) && paramsRead(action, req).length === 0);
}

/**
 * What the action needs, in words, for `interpret`'s catalog: each requirement that reads one of
 * its params and has a shape the packs use (`SHAPES`), with its params named by `nameOf` ("the
 * person"). A requirement that reads no param holds or fails whatever the params, so it isn't
 * listed (a gate rules the action out instead: `gatesOf`), and one of no known shape isn't either.
 */
export function needsOf(action: Pick<ActionDef, "params" | "requires">, nameOf: (param: string) => string): string[] {
  const out: string[] = [];
  for (const req of action.requires.map(requirementExpr)) {
    const read = paramsRead(action, req);
    if (read.length === 0) continue;
    const shape = SHAPES.find((s) => s.shape.test(req));
    if (!shape) continue;
    const words = shape.needs.replace("{p}", nameOf(read[0] ?? "")).replace("{q}", nameOf(read[1] ?? read[0] ?? ""));
    if (!out.includes(words)) out.push(words);
  }
  return out;
}

/**
 * Why the engine didn't play a typed action that played as plain roleplay (DESIGN §11), for its
 * receipt: a requirement in the words its shape has (`failureWords`), never its expression, or the
 * reason an effect gave (a payment the money can't cover), which names only what the player sees.
 */
export function unplayedWords(failed: { code: string; reason: string; requirement?: string }): string {
  if (failed.code !== "requirement") return `The engine can't play it as things stand: ${failed.reason}`;
  const req = failed.requirement ?? failed.reason.replace(/^requires\s+/, "");
  if (/\bto\s*!=\s*here\b/.test(req)) return "You're already there";
  const why = failureWords(req);
  return `The engine can't play it as things stand${why ? `: ${why}` : ""}`;
}

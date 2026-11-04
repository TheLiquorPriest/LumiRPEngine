// Where cash needs a machine or a branch (DESIGN §25.8), and cash off screen (DESIGN §11).
//
// - The rule is the world's switch (`features.atm`, Build → Economy → Cash), which a chat may set for
//   itself (GM → This chat → Money): `economy.config {atm}` records the chat's value, true or false,
//   and `null` returns it to the world's. With no event the world's rule stands, so a chat that never
//   sets one plays as before. The GM sets it through the effect `economy.cash_rule`, one edit with
//   its Undo; `featureFor` reads it (`chatToggles`).
// - Cash goes hand to hand: an action done at once, off screen, that pays cash to someone who isn't
//   where the payer is, is refused (`economy.offstage_refusal`), since nobody walked it over.

import type { JsonObject, JsonValue } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import type { PackEvent } from "../../../shared/ledger";
import { labelOf, mutableSlice, objOf, own, strOf } from "../../../engine/pack-kit";
import type { CoreRegistry, EventTypeDef, ReadContext } from "../../../engine/registry";
import { kindIs, placeOfEntity } from "../../../engine/scope";
import { CHAT_RULES, chatCashRule, payMethodOf } from "./pay";

export const CASH_RULE_EVENT = "economy.config";
export const CASH_RULE_EFFECT = "economy.cash_rule";

declare module "../../../engine/registry" {
  interface QueryMap {
    /** Why an action done at once, off screen, can't be (DESIGN §11), in the player's words, or null when it can. */
    "economy.offstage_refusal": (ctx: ReadContext, action: string, params: JsonObject, actor: EntityId) => string | null;
  }
}

/** The chat's cash rule as the event sets it: true (cash needs a machine or a branch), false (it doesn't), null (the world's). */
function ruleOf(v: JsonValue | undefined): boolean | null | undefined {
  return typeof v === "boolean" || v === null ? v : undefined;
}

/** `economy.config {atm}`: this chat's own cash rule; null returns it to the world's switch. */
export const cashRuleEvent: EventTypeDef<PackEvent> = {
  type: CASH_RULE_EVENT,
  validate: (e) => (ruleOf(e.data.atm) === undefined ? { code: "bad_event", reason: "the cash rule is true, false or null (the world's)" } : null),
  apply: (e, state) => {
    const slice = mutableSlice(state, "economy");
    const rules: JsonObject = { ...objOf(slice[CHAT_RULES]) };
    const atm = ruleOf(e.data.atm);
    if (atm === null || atm === undefined) delete rules.atm;
    else rules.atm = atm;
    if (Object.keys(rules).length > 0) slice[CHAT_RULES] = rules;
    else delete slice[CHAT_RULES];
  },
  describe: (e) => {
    const atm = ruleOf(e.data.atm);
    return atm === null || atm === undefined ? "Cash follows the world's rule again" : atm ? "In this chat, cash needs a machine or a branch" : "In this chat, cash needs no machine";
  },
};

/**
 * Why paying `params` off screen can't be: cash handed to someone who isn't where `actor` is (an
 * outside payee, or a payment by card or account, goes anywhere). Null when nothing stops it.
 */
export function absentCash(ctx: ReadContext, action: string, params: JsonObject, actor: EntityId): string | null {
  if (action !== "pay" || payMethodOf(strOf(params.method)) !== "cash") return null;
  const to = strOf(params.to);
  const payee = own(ctx.state.entities, to);
  if (!payee || !kindIs(ctx.registry, ctx.world, payee.kind, "person")) return null;
  const here = placeOfEntity(ctx.state, actor);
  if (here !== null && placeOfEntity(ctx.state, to) === here) return null;
  return `Cash goes hand to hand, and ${labelOf(ctx, to)} isn't here: pay by card or from an account, or type how you hand it over to play it as a turn.`;
}

/** The cash rule's event, the GM's effect that records it, and the off-screen check. */
export function registerCashRule(r: CoreRegistry): void {
  r.event(cashRuleEvent as EventTypeDef);
  r.effect({
    type: CASH_RULE_EFFECT,
    args: ["atm"],
    gm: true,
    resolve: (a) => {
      const atm = ruleOf(a.atm);
      if (atm === undefined) return { code: "bad_args", reason: "the cash rule is on, off or the world's (null)" };
      return [{ type: CASH_RULE_EVENT, data: { atm } }];
    },
  });
  r.query("economy.offstage_refusal", absentCash);
}

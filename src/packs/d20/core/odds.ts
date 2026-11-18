// The odds of the tabletop rules' rolling actions (RULESET-DESIGN §5.1, §5.4): a check, a save and an attack, worked out from the very
// plan the action rolls (`checkPlan`, `saveCall` with `savePlan`, `attackPlan` with `defenceOf`) and counted exactly by the engine's
// checks (`fixedCheck`, `checkOdds`) over the family's die, so the odds shown and the roll made never disagree. A number taken,
// another's roll against the check, helpers who may reach their mark, the natural die's sure results, a threat and its confirming roll,
// and concealment are each counted as the procedure reads them. A call that lacks what a chance needs (a difficulty, a target) is
// answered with what is missing, in the refusals' words; the layer's other actions roll no chance of this kind and give none.

import type { JsonValue } from "../../../shared/json";
import type { EntityId } from "../../../shared/ids";
import { say } from "../../../shared/lines";
import type { CheckBand, CheckDef } from "../../../shared/world";
import { checkOdds, fixedCheck } from "../../../engine/checks";
import { diceDistribution, opposedDice, probAtLeast, probAtMost } from "../../../engine/dice";
import { own } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import type { OddsLine, PackOdds } from "../../../engine/resolve";
import { createRng } from "../../../engine/rng";
import { isOn, rulesOf } from "./model";
import { attackPlan, checkPlan, defenceOf, DIE, PERCENT, saveCall, savePlan, Scratch } from "./procedures";

type Chances = Record<string, number>;
type Params = Readonly<Record<string, JsonValue>>;

/** The family's die read by bands, as a check of the engine's counts them. */
function onDie(bands: CheckBand[]): CheckDef {
  return { id: "d20", dice: DIE, bands } as CheckDef;
}

/** A roll against a difficulty: the natural die's own results first (a sure success over a sure failure, as the procedures apply them), then the margin. */
function dieBands(autoFail: number | undefined, autoSucceed: number | undefined, margin: number): CheckBand[] {
  return [
    ...(autoSucceed !== undefined ? [{ outcome: "success", natural: { min: autoSucceed } }] : []),
    ...(autoFail !== undefined ? [{ outcome: "failure", natural: { max: autoFail } }] : []),
    { outcome: "success", margin: { min: margin } },
    { outcome: "failure" },
  ];
}

/** Chances that each hold with their own weight, summed. */
function weighed(parts: readonly { w: number; chances: Chances }[]): Chances {
  const out: Chances = {};
  for (const { w, chances } of parts) for (const [o, x] of Object.entries(chances)) out[o] = (out[o] ?? 0) + w * x;
  return out;
}

/** A check: against a difficulty or another's roll, rolled or taking a number, with every count of helpers who reach their mark weighed by its chance. */
function checkChances(s: Scratch, who: EntityId, p: Params): PackOdds | { missing: string } {
  const plan = checkPlan(s, who, p);
  if ("code" in plan) return { missing: plan.reason };
  const { dc, take, vs } = plan;
  if (dc === null && vs === null) return { missing: say("why_d20_odds_no_difficulty") };
  const c = s.rules.check;
  const die = diceDistribution(DIE);
  // How many helpers reach their mark, each by their own chance and each apart from the others.
  let reached = [1];
  for (const h of plan.helpers) {
    const q = probAtLeast(die, c.aid.dc - h.total);
    const was = reached;
    reached = [...was, 0].map((w, k) => w * (1 - q) + (k > 0 ? (was[k - 1] ?? 0) * q : 0));
  }
  const one = (bonus: number): Chances => {
    if (take) {
      // A number taken rolls no die of its own: only another's roll against it is left to chance.
      const total = take.value + bonus;
      const won = vs ? probAtMost(die, total - vs.theirs.total - (bonus >= vs.theirs.total ? 0 : 1)) : total >= (dc ?? 0) ? 1 : 0;
      return { success: won, failure: 1 - won };
    }
    // Equal totals go to the higher bonus; equal bonuses, to the one who acts.
    if (vs) return checkOdds(fixedCheck(onDie(dieBands(c.autoFail, c.autoSucceed, bonus >= vs.theirs.total ? 0 : 1)), { modifier: bonus, against: { dice: DIE, modifier: vs.theirs.total }, opponent: vs.who }));
    return checkOdds(fixedCheck(onDie(dieBands(c.autoFail, c.autoSucceed, 0)), { modifier: bonus, dc }));
  };
  const base = plan.mine.total + plan.extra;
  return {
    chances: weighed(reached.map((w, k) => ({ w, chances: one(base + k * c.aid.bonus) }))),
    modifier: base,
    notation: take ? String(take.value) : vs ? opposedDice(DIE, DIE) : DIE,
    dc: vs ? null : dc,
    opponent: vs?.who ?? null,
  };
}

/** A save: each who makes it against the one difficulty, each with their own line where there are several. */
function saveChances(s: Scratch, who: EntityId, p: Params): PackOdds | { missing: string } {
  const call = saveCall(s, who, p);
  if ("code" in call) return { missing: call.reason };
  const sv = s.rules.save;
  const lines: OddsLine[] = call.savers.map((one) => {
    const { bonus } = savePlan(s, one, call.id, call.given);
    return { who: one, modifier: bonus, against: call.dc, chances: checkOdds(fixedCheck(onDie(dieBands(sv.autoFail, sv.autoSucceed, 0)), { modifier: bonus, dc: call.dc })) };
  });
  const first = lines[0];
  return { chances: first?.chances ?? {}, modifier: first?.modifier ?? 0, notation: DIE, dc: call.dc, opponent: null, ...(lines.length > 1 ? { lines } : {}) };
}

/**
 * An attack: each attack against the target's defence as the procedure reads it (touch, flat-footed, the GM's own modifiers), the
 * range's penalty in its total, the natural die's sure miss and sure hit; a threat that hits, confirmed by a second roll against the
 * same defence where the ruleset confirms; concealment turning a hit into a miss. An area shot rolls no attack and gives none.
 */
function attackChances(s: Scratch, who: EntityId, p: Params): PackOdds | { missing: string } | null {
  const plan = attackPlan(s, who, p);
  if ("code" in plan) return { missing: plan.reason };
  if (plan.shot?.area !== undefined && plan.shot.save !== undefined && plan.shot.dc !== undefined) return null;
  const a = s.rules.attack;
  const { defence } = defenceOf(s, plan);
  const concealed = plan.concealment > 0 ? probAtMost(diceDistribution(PERCENT), plan.concealment) : 0;
  const lines: OddsLine[] = plan.offsets.map((offset, n) => {
    const bonus = plan.roll.total + plan.extra + offset;
    const first = checkOdds(
      fixedCheck(
        onDie([
          { outcome: "miss", natural: { max: a.autoMiss } },
          { outcome: "threat", natural: { min: Math.max(a.autoHit, plan.threatFrom) } },
          { outcome: "hit", natural: { min: a.autoHit } },
          { outcome: "threat", natural: { min: plan.threatFrom }, margin: { min: 0 } },
          { outcome: "hit", margin: { min: 0 } },
          { outcome: "miss" },
        ]),
        { modifier: bonus, dc: defence },
      ),
    );
    const threat = first.threat ?? 0;
    const confirmed = a.confirm
      ? (checkOdds(fixedCheck(onDie([{ outcome: "miss", natural: { max: a.autoMiss } }, { outcome: "hit", natural: { min: a.autoHit } }, { outcome: "hit", margin: { min: 0 } }, { outcome: "miss" }]), { modifier: bonus, dc: defence })).hit ?? 0)
      : 1;
    const critical = threat * confirmed * (1 - concealed);
    const hit = ((first.hit ?? 0) + threat * (1 - confirmed)) * (1 - concealed);
    return { n: n + 1, modifier: bonus, against: defence, threat, chances: { hit, critical, miss: Math.max(0, 1 - hit - critical) } };
  });
  const head = lines[0];
  return { chances: head?.chances ?? {}, modifier: head?.modifier ?? 0, notation: DIE, dc: defence, opponent: plan.target, ...(lines.length > 1 ? { lines } : {}) };
}

/** The odds of one of the layer's actions as things stand, by its doer with the act's arguments; null for an action that rolls none, or a world without the rules on. */
export function d20Odds(ctx: ReadContext, action: string, who: EntityId, params: Params): PackOdds | { missing: string } | null {
  const rules = rulesOf(ctx.world);
  if (rules === null || !isOn(ctx) || !own(ctx.state.entities, who)) return null;
  const s = new Scratch({ ...ctx, rng: createRng("d20.odds"), params: {} }, rules);
  if (action === "check") return checkChances(s, who, params);
  if (action === "save") return saveChances(s, who, params);
  if (action === "attack") return attackChances(s, who, params);
  return null;
}

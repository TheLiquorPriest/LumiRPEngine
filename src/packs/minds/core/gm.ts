// The GM view's minds (DESIGN §24.9): every character's place on the ladder and why, their latest
// mind, plans, notes, commitments, witness log and summary, secrets included. Built on request, never
// pushed with the player's state.

import type { EntityId } from "../../../shared/ids";
import type { FidelityScore, FidelityTexts, MindsCharacter, MindsGmCharacter, MindsGmView, MindsMemoryConfig, MindsSecrecy } from "../../../shared/minds";
import { worldMindsOf } from "../../../shared/minds";
import { calendarOf, formatClock } from "../../../engine/calendar";
import { own } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import { isGone, kindIs } from "../../../engine/scope";
import { fidelityOf } from "./fidelity";
import { faded, readCharacter, salienceNow } from "./state";

const LEVEL_ORDER = { live: 0, near: 1, far: 2, background: 3 } as const;

/** Someone who can't have a mind now (gone, or in a state that doesn't act): Background, and why. */
function outOfPlay(id: EntityId, why: string): FidelityScore {
  return { entity: id, level: "background", score: 0, reasons: [{ label: why, points: 0 }], pin: { gm: null, author: null } };
}

function characterView(ctx: ReadContext, id: EntityId, c: MindsCharacter, fidelity: FidelityScore, memory: MindsMemoryConfig): MindsGmCharacter {
  const { world, state } = ctx;
  const cal = calendarOf(world);
  const clock = (at: number): string => formatClock(cal, at);
  const name = (who: EntityId): string => own(state.entities, who)?.name ?? who;
  const plans = [...c.plans].sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || a.when.from - b.when.from);
  const mind = c.mind ? { ...c.mind, clock: clock(c.mind.at), plans: c.plans.filter((p) => c.mind?.plans.includes(p.id)) } : null;
  return {
    entity: id,
    name: name(id),
    fidelity,
    refreshQueued: c.refresh,
    intent: c.intent ? { ...c.intent } : null,
    mind,
    plans: plans.map((p) => ({ ...p, fromText: clock(p.when.from), toText: clock(p.when.to) })),
    notes: [...c.notes].reverse().map((n) => ({ ...n, now: Math.round(salienceNow(n, state.clock, memory) * 100) / 100, faded: faded(n, state.clock, memory), clock: clock(n.at) })),
    commitments: [...c.commitments].sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || a.made - b.made).map((x) => ({ ...x, withNames: x.with.map(name), dueText: x.due === null ? null : clock(x.due) })),
    witness: [...c.witness].reverse().map((w) => ({ ...w, clock: clock(w.at) })),
    summary: c.summary,
  };
}

/**
 * The GM view's minds: every person but the POV, closest on the ladder first. `texts` are the chat's
 * latest message and reply, which fidelity reads; `memory` is the chat's memory config (the world's,
 * with the user's overrides).
 */
export function buildMindsGm(ctx: ReadContext, texts: FidelityTexts, enabled: boolean, memory: MindsMemoryConfig): MindsGmView {
  const { registry: reg, world, state } = ctx;
  const config = worldMindsOf(world);
  const scores = new Map(fidelityOf(ctx, texts, config).map((s) => [s.entity, s]));
  const people = Object.keys(state.entities)
    .sort()
    .filter((id) => id !== world.pov && kindIs(reg, world, own(state.entities, id)?.kind ?? "", "person"));
  const characters = people.map((id) => characterView(ctx, id, readCharacter(state, id), scores.get(id) ?? outOfPlay(id, isGone(state, id) ? "Removed" : "Doesn't act"), memory));
  characters.sort((a, b) => LEVEL_ORDER[a.fidelity.level] - LEVEL_ORDER[b.fidelity.level] || b.fidelity.score - a.fidelity.score || (a.entity < b.entity ? -1 : 1));
  const secrecy: MindsSecrecy = config.secrecy;
  return { enabled, secrecy, now: state.clock, nowText: formatClock(calendarOf(world), state.clock), characters };
}

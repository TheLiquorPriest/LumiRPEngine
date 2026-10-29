// The GM view's minds (DESIGN §24.9): every character's place on the ladder and why, their latest
// mind, plans, notes, commitments, witness log, summary and what they know (§24.11), secrets
// included, and the chat's facts with who holds each, the player character's holdings among them.
// Built on request, never pushed with the player's state.

import type { EntityId } from "../../../shared/ids";
import type { FidelityScore, FidelityTexts, MindsCharacter, MindsGmCharacter, MindsGmEvidence, MindsGmHolding, MindsGmView, MindsMemoryConfig, MindsSecrecy, WitnessEntry } from "../../../shared/minds";
import { isWitnessRef, parseFactId, witnessRef, worldMindsOf } from "../../../shared/minds";
import { calendarOf, formatClock } from "../../../engine/calendar";
import { own } from "../../../engine/pack-kit";
import type { ReadContext } from "../../../engine/registry";
import { isGone, kindIs } from "../../../engine/scope";
import { fidelityOf } from "./fidelity";
import { factsOf, holdingsOf, isSuspicion, knowersOf } from "./knowledge";
import { faded, readCharacter, readSlice, salienceNow } from "./state";

const LEVEL_ORDER = { live: 0, near: 1, far: 2, background: 3 } as const;

/** Someone who can't have a mind now (gone, or in a state that doesn't act): Background, and why. */
function outOfPlay(id: EntityId, why: string): FidelityScore {
  return { entity: id, level: "background", score: 0, reasons: [{ label: why, points: 0 }], pin: { gm: null, author: null } };
}

/**
 * What `who` holds, newest first, as the GM reads it: each fact's claim, kind and truth, who told
 * them and whom it's kept from by name, since when in words, whether it is a suspicion under
 * `threshold`, and its evidence, each fact by its claim and each witness entry by its line in their
 * own log (`witness`), or as gone once the log no longer keeps it.
 */
export function holdingsView(ctx: ReadContext, who: EntityId, witness: readonly WitnessEntry[], threshold: number): MindsGmHolding[] {
  const { world, state } = ctx;
  const cal = calendarOf(world);
  const name = (id: EntityId): string => own(state.entities, id)?.name ?? id;
  const slice = readSlice(state);
  const facts = factsOf(slice);
  const seen = new Map(witness.map((w) => [witnessRef(w), w]));
  const evidence = (ref: string): MindsGmEvidence => {
    if (isWitnessRef(ref)) {
      const w = seen.get(ref);
      return w ? { ref, kind: "witness", text: `${w.what} (${w.how === "told" ? `told${w.by ? ` by ${name(w.by)}` : ""}` : "saw it"}, ${formatClock(cal, w.at)})` } : { ref, kind: "gone", text: "A witness entry their log no longer keeps" };
    }
    const f = own(facts, ref);
    return f ? { ref, kind: "fact", text: f.claim } : { ref, kind: "gone", text: ref };
  };
  return Object.entries(holdingsOf(slice, who))
    .map(([fact, h]): MindsGmHolding => {
      const f = own(facts, fact);
      return {
        ...h,
        fact,
        claim: f?.claim ?? fact,
        kind: f?.kind ?? parseFactId(fact)?.kind ?? "claim",
        truth: f?.truth ?? "open",
        byName: h.by === null ? null : name(h.by),
        sinceText: formatClock(cal, h.since.at),
        suspicion: isSuspicion(h, threshold),
        keptFromNames: h.keptFrom === "everyone" ? "everyone" : (h.keptFrom ?? []).map(name),
        evidenceShown: h.evidence.map(evidence),
      };
    })
    .sort((a, b) => b.since.at - a.since.at || a.claim.localeCompare(b.claim) || (a.fact < b.fact ? -1 : 1));
}

function characterView(ctx: ReadContext, id: EntityId, c: MindsCharacter, fidelity: FidelityScore, memory: MindsMemoryConfig, threshold: number): MindsGmCharacter {
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
    holdings: holdingsView(ctx, id, c.witness, threshold),
  };
}

/**
 * The GM view's minds: every person but the POV, closest on the ladder first. `texts` are the chat's
 * latest message and reply, which fidelity reads; `memory` is the chat's memory config (the world's,
 * with the user's overrides); `threshold` is the user's confidence under which a holding is a
 * suspicion (Settings → Minds → Knowledge).
 */
export function buildMindsGm(ctx: ReadContext, texts: FidelityTexts, enabled: boolean, memory: MindsMemoryConfig, threshold: number): MindsGmView {
  const { registry: reg, world, state } = ctx;
  const config = worldMindsOf(world);
  const scores = new Map(fidelityOf(ctx, texts, config).map((s) => [s.entity, s]));
  const people = Object.keys(state.entities)
    .sort()
    .filter((id) => id !== world.pov && kindIs(reg, world, own(state.entities, id)?.kind ?? "", "person"));
  const characters = people.map((id) => characterView(ctx, id, readCharacter(state, id), scores.get(id) ?? outOfPlay(id, isGone(state, id) ? "Removed" : "Doesn't act"), memory, threshold));
  characters.sort((a, b) => LEVEL_ORDER[a.fidelity.level] - LEVEL_ORDER[b.fidelity.level] || b.fidelity.score - a.fidelity.score || (a.entity < b.entity ? -1 : 1));
  const secrecy: MindsSecrecy = config.secrecy;
  const slice = readSlice(state);
  const facts = Object.values(factsOf(slice))
    .map((f) => ({ ...f, holders: knowersOf(slice, f.id) }))
    .sort((a, b) => a.claim.localeCompare(b.claim) || (a.id < b.id ? -1 : 1));
  const pov = own(state.entities, world.pov);
  const knowledge = { facts, pov: pov ? { entity: world.pov, name: pov.name, holdings: holdingsView(ctx, world.pov, readCharacter(state, world.pov).witness, threshold) } : null, threshold };
  return { enabled, secrecy, now: state.clock, nowText: formatClock(calendarOf(world), state.clock), characters, knowledge };
}

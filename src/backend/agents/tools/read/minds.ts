// The minds family (AGENT-LOOP-PLAN §6: "a mind, its notes and commitments"; INC1-SPEC R3a): a
// character's mind, as each knowledge may read it.
//
// - `pov`: never. No player surface shows anyone's mind (DESIGN §24.9), so whoever is asked about,
//   the answer is the hidden note.
// - `everyone`: what the narrator's Minds section gets of them this turn (`mindLines`): their line,
//   marked as a secret known to whose mind it is and kept from the player character when it carries
//   an unrevealed secret's words or names someone or something the player character can't see, as
//   the engine run marks it for the narrator (`backend/sections-build.ts`); null when the section
//   tells nothing of them now.
// - `gm`: everything GM → Minds shows of them, as the GM view builds it (`buildMindsGm`): their place
//   on the ladder and why, the pins, a fresh mind asked for, the GM's intent for them, their latest
//   mind, their plans (an older chat's mind's own among them: thoughts, which drive nothing), their
//   commitments, memory notes, witness log and summary. What they know is the knowledge family's.

import { hiddenNameCheck } from "../../../../engine/player-events";
import { findLeaks, unrevealedSecrets } from "../../../../engine/visibility";
import { buildMindsGm } from "../../../../packs/minds/core/gm";
import { mindLines } from "../../../../packs/minds/core/section";
import { TOOL_NOTE } from "../../../../shared/agent-tools";
import type { EntityId, PlaceId } from "../../../../shared/ids";
import type { CommitmentKind, CommitmentStatus, FidelityScore, MindIntent, MindPlan, MindRecord, MindsGmCharacter, PlanKind, PlanStatus, WitnessEntry } from "../../../../shared/minds";
import { formatMoney } from "../../../../shared/world";
import type { ToolReadView, ViewRef } from "../read-view";
import type { ToolDefinition } from "../registry";
import { resolvePerson } from "../resolve";
import { needText, objectSchema, text } from "../schema";

/** minds_read under `everyone`; under `gm`, of the player character, who has no mind. */
interface NarratorMind {
  who: ViewRef;
  /** Their line in the narrator's Minds section now; null for none. */
  mind: string | null;
}

/** Their latest mind, as GM → Minds shows it. */
interface LatestMind {
  /** When they thought it, in the world's calendar. */
  at: string;
  level: MindRecord["level"];
  moment: MindRecord["moment"];
  /** Why it ran: what called for it on a turn, or a time skip's beat in its own words. */
  reason: string;
  place: ViewRef | null;
  monologue: string;
  depiction: string;
  intent: string;
  reactions: string[];
  mood: string | null;
  interrupt: string | null;
  /** Its depiction gave away an unrevealed secret or a name the player character can't see, so a brief narrator got none of it. */
  withheld: boolean;
}

interface PlanAnswer {
  id: string;
  what: string;
  kind: PlanKind;
  from: string;
  to: string;
  where: ViewRef | null;
  with: ViewRef[];
  priority: number;
  status: PlanStatus;
  /** What made it: their memory, the GM, or in an older chat their mind (a thought, which drives nothing). */
  source: MindPlan["source"];
  /** Why it closed, or the GM's note. */
  reason?: string;
  /** What a payment or a loan hands over, in the world's currency and in its minor units. */
  amount?: string;
  cents?: number;
}

interface CommitmentAnswer {
  id: string;
  kind: CommitmentKind;
  text: string;
  with: ViewRef[];
  due: string | null;
  status: CommitmentStatus;
}

interface NoteAnswer {
  id: string;
  text: string;
  at: string;
  /** How much it mattered when written (1 to 5), and now, halved with each half-life of game time since. */
  salience: number;
  salienceNow: number;
  /** Fallen under the floor: their mind is no longer shown it. */
  faded: boolean;
}

interface WitnessAnswer {
  what: string;
  how: WitnessEntry["how"];
  by: ViewRef | null;
  place: ViewRef | null;
  at: string;
}

/** minds_read under `gm`: everything GM → Minds shows of a character. */
interface GmMind {
  who: ViewRef;
  /** Their place on the ladder now, its score and what adds to it, and the pins: the GM's in this chat and the author's. */
  fidelity: Omit<FidelityScore, "entity">;
  /** The GM asked for a fresh mind next turn. */
  refreshQueued: boolean;
  /** What the GM says they mean to do now and how they go about it, which only their own mind reads; null for none. */
  intent: MindIntent | null;
  mind: LatestMind | null;
  plans: PlanAnswer[];
  commitments: CommitmentAnswer[];
  notes: NoteAnswer[];
  witness: WitnessAnswer[];
  summary: string;
}

/**
 * Their line in the narrator's Minds section now (`mindLines`), as the engine run hands it on: one
 * carrying an unrevealed secret's words or a name the player character can't see goes marked as a
 * secret known to whose mind it is and kept from the player character; null when there is none.
 */
function narratorLine(view: ToolReadView, id: EntityId): string | null {
  const line = mindLines(view.ctx).find((l) => l.entity === id);
  if (!line) return null;
  const carries = findLeaks(line.line, unrevealedSecrets(view.registry, view.world, view.state)).length > 0 || hiddenNameCheck(view.registry, view.world, view.state, view.pov)(line.line);
  return view.mark(line.line, carries ? { known: [line.name], kept: [view.name(view.pov)] } : null);
}

/** Everything GM → Minds shows of a character, with everyone and everywhere in it by ref. */
function gmMind(view: ToolReadView, who: ViewRef, c: MindsGmCharacter): GmMind {
  const person = (id: EntityId): ViewRef => view.entity(id) ?? { id, name: view.name(id) };
  const place = (id: PlaceId | null): ViewRef | null => (id === null ? null : (view.place(id) ?? { id, name: view.name(id) }));
  const m = c.mind;
  return {
    who,
    fidelity: { level: c.fidelity.level, score: Math.round(c.fidelity.score), reasons: c.fidelity.reasons, pin: c.fidelity.pin },
    refreshQueued: c.refreshQueued,
    intent: c.intent,
    mind: m ? { at: m.clock, level: m.level, moment: m.moment, reason: m.reason, place: place(m.place), monologue: m.monologue, depiction: m.depiction, intent: m.intent, reactions: m.reactions, mood: m.mood, interrupt: m.interrupt, withheld: m.withheld } : null,
    plans: c.plans.map((p) => ({ id: p.id, what: p.what, kind: p.kind, from: p.fromText, to: p.toText, where: place(p.where), with: p.with.map(person), priority: p.priority, status: p.status, source: p.source, reason: p.reason ?? undefined, amount: p.cents === undefined ? undefined : formatMoney(p.cents, view.world.currency), cents: p.cents })),
    commitments: c.commitments.map((x) => ({ id: x.id, kind: x.kind, text: x.text, with: x.with.map(person), due: x.dueText, status: x.status })),
    notes: c.notes.map((n) => ({ id: n.id, text: n.text, at: n.clock, salience: n.salience, salienceNow: n.now, faded: n.faded })),
    witness: c.witness.map((w) => ({ what: w.what, how: w.how, by: w.by === null ? null : person(w.by), place: place(w.place), at: w.clock })),
    summary: c.summary,
  };
}

export const MINDS_TOOLS: readonly ToolDefinition[] = [
  {
    name: "minds_read",
    family: "minds",
    tier: "read",
    parameters: () => objectSchema({ person: text() }, ["person"]),
    run: async (args, env) => {
      const view = await env.reader.view();
      // No player surface shows a mind: whoever is asked about, it is beyond the player character.
      if (view.knowledge === "pov") return view.refuse(TOOL_NOTE.hidden, { pov: view.name(view.pov) });
      const said = needText(view, "minds_read", args, "person");
      if (typeof said !== "string") return said;
      return view.read(() => {
        const person = resolvePerson(view, said);
        if ("refused" in person) return person.refused;
        const who = view.entity(person.id);
        if (!who) return view.refuse(TOOL_NOTE.noPerson, { name: said });
        if (view.knowledge === "everyone") return view.answer({ who, mind: narratorLine(view, person.id) } satisfies NarratorMind);
        // As the GM view builds its minds; the player character, whom the player decides for, has none.
        const c = buildMindsGm(view.ctx, view.minds.latest, view.minds.enabled, view.minds.memory, view.threshold).characters.find((x) => x.entity === person.id);
        return view.answer(c ? gmMind(view, who, c) : ({ who, mind: null } satisfies NarratorMind));
      });
    },
  },
];

// The minds pack's slice of the state (DESIGN §24.4): each character's latest mind, plans, notes,
// commitments, witness log and summary, the chat's minds round, and the latest turns' presence.
// Only this pack's reducers write it, so its shape is the contract's `MindsSlice`; a slice missing
// a part (a chat that never had minds) reads with that part empty.

import type { EntityId } from "../../../shared/ids";
import type { MindCommitment, MindNote, MindPlan, MindsCharacter, MindsMemoryConfig, MindsSlice, WitnessEntry } from "../../../shared/minds";
import { MINDS_KEEP } from "../../../shared/minds";
import { own } from "../../../engine/pack-kit";
import type { WorldState } from "../../../engine/state";

export const PACK = "minds";

const EMPTY_SLICE: MindsSlice = { round: 0, on: false, chars: {}, presence: [] };

function emptyCharacter(): MindsCharacter {
  return { mind: null, plans: [], notes: [], commitments: [], witness: [], summary: "", pin: null, refresh: false, lastPresent: null, consolidated: null };
}

/** The slice as stored, every part present (read only). */
export function readSlice(state: Readonly<WorldState>): MindsSlice {
  const raw = state.packs[PACK];
  if (!raw) return EMPTY_SLICE;
  const s = raw as unknown as Partial<MindsSlice>;
  return { round: s.round ?? 0, on: s.on ?? false, chars: s.chars ?? {}, presence: s.presence ?? [] };
}

/** One character's minds state (read only); a character with none reads empty. */
export function readCharacter(state: Readonly<WorldState>, id: EntityId): MindsCharacter {
  return own(readSlice(state).chars, id) ?? emptyCharacter();
}

/** The slice for a reducer: created on first use, every part present. */
export function writeSlice(state: WorldState): MindsSlice {
  const s = (state.packs[PACK] ?? {}) as unknown as Partial<MindsSlice>;
  s.round ??= 0;
  s.on ??= false;
  s.chars ??= {};
  s.presence ??= [];
  const full = s as MindsSlice;
  state.packs[PACK] = full as unknown as WorldState["packs"][string];
  return full;
}

/** One character's minds state for a reducer, created on first use. */
export function writeCharacter(state: WorldState, id: EntityId): MindsCharacter {
  const s = writeSlice(state);
  const c = own(s.chars, id) ?? emptyCharacter();
  s.chars[id] = c;
  return c;
}

/** Puts a plan in a character's list (replacing one with its id), then keeps the lists within their bounds. */
export function putPlan(c: MindsCharacter, plan: MindPlan): void {
  const i = c.plans.findIndex((p) => p.id === plan.id);
  if (i >= 0) c.plans[i] = plan;
  else c.plans.push(plan);
  boundPlans(c);
}

/** Open plans past the bound go oldest first; closed ones keep only the latest. */
export function boundPlans(c: MindsCharacter): void {
  const open = c.plans.filter((p) => p.status === "open");
  const closed = c.plans.filter((p) => p.status !== "open");
  const keptOpen = open.slice(Math.max(0, open.length - MINDS_KEEP.openPlans));
  const keptClosed = closed.slice(Math.max(0, closed.length - MINDS_KEEP.closedPlans));
  const keep = new Set([...keptOpen, ...keptClosed]);
  c.plans = c.plans.filter((p) => keep.has(p));
}

/** Puts a commitment in a character's list (replacing one with its id), then keeps the bounds: open ones go only past the hard bound. */
export function putCommitment(c: MindsCharacter, commitment: MindCommitment): void {
  const i = c.commitments.findIndex((x) => x.id === commitment.id);
  if (i >= 0) c.commitments[i] = commitment;
  else c.commitments.push(commitment);
  boundCommitments(c);
}

export function boundCommitments(c: MindsCharacter): void {
  const open = c.commitments.filter((x) => x.status === "open");
  const closed = c.commitments.filter((x) => x.status !== "open");
  const keep = new Set([...open.slice(Math.max(0, open.length - MINDS_KEEP.openCommitments)), ...closed.slice(Math.max(0, closed.length - MINDS_KEEP.closedCommitments))]);
  c.commitments = c.commitments.filter((x) => keep.has(x));
}

/** Puts a note in a character's list (replacing one with its id); past the hard bound the least salient go, oldest first among equals. */
export function putNote(c: MindsCharacter, note: MindNote): void {
  const i = c.notes.findIndex((n) => n.id === note.id);
  if (i >= 0) c.notes[i] = note;
  else c.notes.push(note);
  while (c.notes.length > MINDS_KEEP.notes) {
    let drop = 0;
    for (let j = 1; j < c.notes.length; j++) {
      const a = c.notes[j];
      const b = c.notes[drop];
      if (a && b && (a.salience < b.salience || (a.salience === b.salience && a.at < b.at))) drop = j;
    }
    c.notes.splice(drop, 1);
  }
}

export function addWitness(c: MindsCharacter, entry: WitnessEntry): void {
  c.witness.push(entry);
  if (c.witness.length > MINDS_KEEP.witness) c.witness.splice(0, c.witness.length - MINDS_KEEP.witness);
}

/** A note's salience now: its salience when written, halved every `halfLifeDays` of game time since. */
export function salienceNow(note: Pick<MindNote, "salience" | "at">, clock: number, memory: Pick<MindsMemoryConfig, "salience">): number {
  const days = Math.max(0, clock - note.at) / 1440;
  return note.salience * 0.5 ** (days / memory.salience.halfLifeDays);
}

/** Whether a note has faded: its salience now is under the floor. */
export function faded(note: Pick<MindNote, "salience" | "at">, clock: number, memory: Pick<MindsMemoryConfig, "salience">): boolean {
  return salienceNow(note, clock, memory) < memory.salience.floor;
}

/** A character's open plans, soonest first (ties by id). */
export function openPlans(c: MindsCharacter): MindPlan[] {
  return c.plans.filter((p) => p.status === "open").sort((a, b) => a.when.from - b.when.from || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** A character's open commitments, oldest first. */
export function openCommitments(c: MindsCharacter): MindCommitment[] {
  return c.commitments.filter((x) => x.status === "open");
}

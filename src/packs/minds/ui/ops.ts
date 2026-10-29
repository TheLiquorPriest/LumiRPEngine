// The GM view's minds controls as `lre.edit` operations (DESIGN §24.9). Each form's text is read here
// and refused (null) when it wouldn't make a valid item, so the Save button can say so before the
// backend does. A `mind_memory` value carries only the fields the item has; an absent `id` adds one.
// A holding (`mind_knowledge`, §24.11) goes whole, as the form holds it.

import type { EntityId, PlaceId } from "../../../shared/ids";
import type { JsonObject } from "../../../shared/json";
import type { CommitmentKind, CommitmentStatus, FactId, FactTruth, Fidelity, Holding, HoldingBelief, HoldingHow, MindApproach, MindCommitment, MindIntent, MindNote, MindPlan, MindRecord, MindsSecrecy, PlanKind, PlanStatus } from "../../../shared/minds";
import { MIND_TEXT_CAPS, PLAN_PRIORITY } from "../../../shared/minds";
import type { EditOp } from "../../../shared/protocol";

export const FIDELITY_LABEL: Record<Fidelity, string> = { live: "Live", near: "Near", far: "Far", background: "Background" };

export const PLAN_KIND_LABEL: Record<PlanKind, string> = { errand: "Errand", meet: "Meet", visit: "Visit", work: "Work", rest: "Rest", leisure: "Leisure", pay: "Pay someone", lend: "Lend money", other: "Other" };
export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = { open: "Open", done: "Done", dropped: "Dropped" };
export const COMMITMENT_KIND_LABEL: Record<CommitmentKind, string> = { promise: "Promise", debt: "Debt", grudge: "Grudge", favour: "Favour", plan: "Plan together", other: "Other" };
export const COMMITMENT_STATUS_LABEL: Record<CommitmentStatus, string> = { open: "Open", kept: "Kept", broken: "Broken", released: "Released" };
export const APPROACH_LABEL: Record<MindApproach, string> = { reactive: "Reactive", proactive: "Proactive" };
export const HOW_LABEL: Record<HoldingHow, string> = { authored: "From the start", witnessed: "Witnessed", told: "Told", inferred: "Inferred", guessed: "Guessed" };
export const BELIEF_LABEL: Record<HoldingBelief, string> = { true: "Takes it as true", false: "Takes it as false", uncertain: "Unsure" };
export const TRUTH_LABEL: Record<FactTruth, string> = { true: "True", false: "False", open: "An open question" };

export type MindPart = "mood" | "monologue" | "depiction" | "intent" | "reactions" | "interrupt";

/**
 * The parts of a mind the Minds section gives the narrator under the world's secrecy (DESIGN §24.3),
 * which the GM view marks "to the narrator": all of them under `full`; under `brief` the depiction
 * and an interrupt with it, unless the depiction was withheld.
 */
export function narratorGets(secrecy: MindsSecrecy, mind: Pick<MindRecord, "withheld">): Record<MindPart, boolean> {
  const full = secrecy === "full";
  const shown = full || !mind.withheld;
  return { mood: full, monologue: full, depiction: shown, intent: full, reactions: full, interrupt: shown };
}

/** Pins a character at a rung, whatever their score, in this chat; null unpins. */
export function pinOp(entity: EntityId, level: Fidelity | null): EditOp {
  return { op: "mind_pin", entity, level };
}

/** Asks for a fresh mind for them next turn, whatever their refresh policy says. */
export function refreshOp(entity: EntityId): EditOp {
  return { op: "mind_refresh", entity };
}

/** Deletes a note, commitment or plan. */
export function deleteOp(entity: EntityId, part: "note" | "commitment" | "plan", id: string): EditOp {
  return { op: "mind_memory", entity, part, id, value: null };
}

/**
 * Sets what they mean to do now and how they go about it, both as the form holds them: blank text
 * and no approach clear the intent. Refused (null) when the text is over its cap.
 */
export function intentOp(entity: EntityId, draft: MindIntent): EditOp | null {
  const text = draft.text.trim().replace(/\s+/g, " ");
  return text.length > MIND_TEXT_CAPS.gmIntent ? null : { op: "mind_intent", entity, text, approach: draft.approach };
}

function textIn(text: string, cap: number): string | null {
  const t = text.trim().replace(/\s+/g, " ");
  return t === "" || t.length > cap ? null : t;
}

/** A whole number in [lo, hi] typed as text, else null. */
function wholeIn(text: string, lo: number, hi: number): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
}

export interface NoteDraft {
  text: string;
  salience: string;
}

export function noteDraft(note?: Pick<MindNote, "text" | "salience">): NoteDraft {
  return { text: note?.text ?? "", salience: String(note?.salience ?? 3) };
}

/** A note added (`id` null) or replaced: its text, within the note cap, and a salience of 1 to 5. */
export function noteOp(entity: EntityId, id: string | null, draft: NoteDraft): EditOp | null {
  const text = textIn(draft.text, MIND_TEXT_CAPS.note);
  const salience = wholeIn(draft.salience, 1, 5);
  if (text === null || salience === null) return null;
  return { op: "mind_memory", entity, part: "note", id, value: { text, salience } };
}

export interface CommitmentDraft {
  kind: CommitmentKind;
  with: EntityId[];
  text: string;
  /** Absolute game minutes, or null for none. */
  due: number | null;
  status: CommitmentStatus;
}

export function commitmentDraft(c?: Pick<MindCommitment, "kind" | "with" | "text" | "due" | "status">): CommitmentDraft {
  return { kind: c?.kind ?? "promise", with: [...(c?.with ?? [])], text: c?.text ?? "", due: c?.due ?? null, status: c?.status ?? "open" };
}

/** A commitment added or replaced: its text within the cap, and someone it is with. */
export function commitmentOp(entity: EntityId, id: string | null, draft: CommitmentDraft): EditOp | null {
  const text = textIn(draft.text, MIND_TEXT_CAPS.commitment);
  const withIds = [...new Set(draft.with.filter((w) => w !== "" && w !== entity))];
  if (text === null || withIds.length === 0 || (draft.due !== null && !Number.isFinite(draft.due))) return null;
  const value: JsonObject = { kind: draft.kind, with: withIds, text, due: draft.due === null ? null : Math.round(draft.due), status: draft.status };
  return { op: "mind_memory", entity, part: "commitment", id, value };
}

export interface PlanFormDraft {
  what: string;
  kind: PlanKind;
  /** Absolute game minutes. */
  from: number;
  to: number;
  where: PlaceId | null;
  with: EntityId[];
  priority: number;
  status: PlanStatus;
  /** A `pay` or `lend` plan's amount, in minor units; null while none is typed. */
  cents: number | null;
}

/** Whether a plan kind hands money over, and so needs an amount and someone it is with. */
export function isMoneyPlan(kind: PlanKind): boolean {
  return kind === "pay" || kind === "lend";
}

/** A new plan starts an hour from now and lasts an hour; an existing one, as it is. */
export function planDraft(now: number, plan?: MindPlan): PlanFormDraft {
  if (plan) return { what: plan.what, kind: plan.kind, from: plan.when.from, to: plan.when.to, where: plan.where, with: [...plan.with], priority: plan.priority, status: plan.status, cents: plan.cents ?? null };
  return { what: "", kind: "errand", from: now + 60, to: now + 120, where: null, with: [], priority: PLAN_PRIORITY.normal, status: "open", cents: null };
}

/** Moves a plan to start `hours` from now, keeping how long it lasts. */
export function startPlanIn(draft: PlanFormDraft, now: number, hours: number): PlanFormDraft {
  const from = Math.round(now + hours * 60);
  return { ...draft, from, to: from + (draft.to - draft.from) };
}

/** Sets how long a plan lasts, from its start. */
export function planLasts(draft: PlanFormDraft, minutes: number): PlanFormDraft {
  return { ...draft, to: draft.from + Math.round(minutes) };
}

/** A plan added or replaced: what it is within the cap, a start before its end, a priority of 1 to 5, and for a pay or lend plan an amount above zero and someone to hand it to. */
export function planOp(entity: EntityId, id: string | null, draft: PlanFormDraft): EditOp | null {
  const what = textIn(draft.what, MIND_TEXT_CAPS.planWhat);
  const ok = Number.isInteger(draft.from) && Number.isInteger(draft.to) && draft.from < draft.to && Number.isInteger(draft.priority) && draft.priority >= PLAN_PRIORITY.min && draft.priority <= PLAN_PRIORITY.max;
  const withIds = [...new Set(draft.with.filter((w) => w !== "" && w !== entity))];
  const money = isMoneyPlan(draft.kind);
  if (what === null || !ok || (money && (draft.cents === null || !Number.isSafeInteger(draft.cents) || draft.cents <= 0 || withIds.length === 0))) return null;
  const value: JsonObject = { what, kind: draft.kind, when: { from: draft.from, to: draft.to }, where: draft.where, with: withIds, priority: draft.priority, status: draft.status, ...(money && draft.cents !== null ? { cents: draft.cents } : {}) };
  return { op: "mind_memory", entity, part: "plan", id, value };
}

/** A holding as its form holds it: the confidence in percent as typed, and whom it is kept from as a choice with its people. */
export interface HoldingDraft {
  how: HoldingHow;
  by: EntityId | null;
  evidence: string[];
  belief: HoldingBelief;
  confidence: string;
  kept: "none" | "everyone" | "some";
  keptFrom: EntityId[];
  since: Holding["since"];
}

/** A holding's form: as it is held, or a new one witnessed now, taken as true and sure, kept from no one. */
export function holdingDraft(now: number, h?: Holding): HoldingDraft {
  const some = h && Array.isArray(h.keptFrom) ? h.keptFrom : [];
  return {
    how: h?.how ?? "witnessed",
    by: h?.by ?? null,
    evidence: [...(h?.evidence ?? [])],
    belief: h?.belief ?? "true",
    confidence: String(Math.round((h?.confidence ?? 1) * 100)),
    kept: h?.keptFrom === "everyone" ? "everyone" : some.length > 0 ? "some" : "none",
    keptFrom: [...some],
    since: h ? { msg: h.since.msg, at: h.since.at } : { msg: null, at: now },
  };
}

/**
 * Sets what `entity` holds of `fact`, whole: refused (null) for a confidence that isn't a whole
 * percent from 0 to 100, a told one with no teller, a teller who is the holder, or kept from some
 * people with none named.
 */
export function holdingOp(entity: EntityId, fact: FactId, draft: HoldingDraft): EditOp | null {
  const percent = wholeIn(draft.confidence, 0, 100);
  if (percent === null || (draft.how === "told" && draft.by === null) || draft.by === entity) return null;
  const some = [...new Set(draft.keptFrom.filter((id) => id !== entity))];
  if (draft.kept === "some" && some.length === 0) return null;
  const keptFrom = draft.kept === "everyone" ? "everyone" : draft.kept === "some" ? some : null;
  const holding: Holding = { how: draft.how, by: draft.by, evidence: [...new Set(draft.evidence)], since: { msg: draft.since.msg, at: draft.since.at }, belief: draft.belief, confidence: percent / 100, ...(keptFrom ? { keptFrom } : {}) };
  return { op: "mind_knowledge", entity, fact, holding };
}

/** Takes away what `entity` holds of `fact`. */
export function forgetOp(entity: EntityId, fact: FactId): EditOp {
  return { op: "mind_knowledge", entity, fact, holding: null };
}

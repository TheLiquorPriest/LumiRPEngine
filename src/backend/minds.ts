// Character minds around a turn (DESIGN §24): the backend side, where the model calls are. Every
// mind is its own call, blind to every other, made in parallel; every answer is checked, screened and
// recorded as an event, so the fold, a Re-narrate and the background lane never call a model.
//
//   runMinds   one mind per character for a moment (a turn, or a beat inside a time skip); records
//              nothing: it returns the validated `minds.mind` events, for the turn or the skip.
//   preMinds   the pre phase: the round, then the minds the ladder and the cadence pick.
//   postMinds  the post phase: who was present, then each one's memory of what was written, then
//              consolidation, each character at most once per period.

import { hashParts } from "../shared/hash";
import type { ChatId, EntityId, MessageId, UserId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import type { CommitmentKind, Fidelity, MindCallTrace, MindCommitment, MindEventData, MindMoment, MindNote, MindPlan, MindPurpose, MindsSettings, PlanKind, PresenceEventData } from "../shared/minds";
import { COMMITMENT_KINDS, effectiveMemory, MIND_ANSWER_FORMATS, MIND_PROMPT_DEFAULTS, MIND_TEXT_CAPS, MINDS_EVENTS, PLAN_KINDS, PLAN_PRIORITY, worldMindsOf } from "../shared/minds";
import type { ModelUseSettings, StepConfig } from "../shared/settings";
import type { WorldDoc } from "../shared/world";
import { calendarOf, clockOfLocal, formatClock, nextTimeOfDay, parseHHMM } from "../engine/calendar";
import { own } from "../engine/pack-kit";
import { hiddenNameCheck, playerKnows, witnessLines } from "../engine/player-events";
import type { Registry } from "../engine/registry-impl";
import { isGone, kindIs, placeOfEntity } from "../engine/scope";
import type { WorldState } from "../engine/state";
import { findLeaks, unrevealedSecrets } from "../engine/visibility";
import { acts } from "../engine/life";
import { Working } from "../engine/working";
import { capText } from "../packs/minds/core/edit";
import { fidelityOf, pickMinds } from "../packs/minds/core/fidelity";
import { faded, readCharacter, readSlice, salienceNow } from "../packs/minds/core/state";
import type { HostMessage, HostPort } from "./host";
import { consolidateContext, memoryContext, mindContext, povLabel, type MindScope } from "./minds-context";
import type { PresetBinding } from "./preset-binding";
import { HELPER_MAX_TOKENS, type SettingsStore } from "./settings-store";
import type { Steps } from "./steps";
import { renderTemplate } from "./turn-steps";

/** What the minds need of the backend: the host (chat, cards), the registry, the steps, the user's settings and preset. */
export interface MindsDeps {
  host: HostPort;
  registry: Registry;
  steps: Steps;
  settings: SettingsStore;
  presets: PresetBinding;
}

export interface RunMindsInput {
  chatId: ChatId;
  userId: UserId;
  world: WorldDoc;
  /** The state they think in: the turn's before the plan, or the skip's at the beat. */
  state: Readonly<WorldState>;
  /** Who thinks, in order: the events come back in this order. */
  who: EntityId[];
  moment: MindMoment;
  /** Each one's level on the ladder, recorded with the mind. */
  levels: Record<EntityId, Fidelity>;
  /** The phase's deadline: whatever finished before it comes back. */
  signal: AbortSignal;
  /** Why each one thinks now (a refresh reason); absent, the moment's reason. */
  reasons?: Record<EntityId, string>;
  /** The preset's `RPEngine · mind` block; absent, the user's latest read of the preset. */
  guidance?: string;
  /** The chat's messages, when the caller has read them (recall reads them otherwise). */
  messages?: readonly HostMessage[];
  /** The trace's phase: the turn's pre phase, or a skip's beat. */
  phase?: MindCallTrace["phase"];
}

export interface RunMindsResult {
  events: LedgerEvent[];
  traces: MindCallTrace[];
}

/** The step card a minds purpose runs with: the saved one, else the defaults; null when the user saved it off. */
export function mindsStepConfig(modelUse: ModelUseSettings, purpose: MindPurpose): StepConfig | null {
  const saved = modelUse.steps[purpose];
  if (saved && !saved.enabled) return null;
  return saved ?? { enabled: true, signals: [], maxTokens: HELPER_MAX_TOKENS };
}

/** Whether minds run for this user: on in Settings → Minds, with the `mind` step not switched off. */
export function mindsOn(settings: { minds: MindsSettings; modelUse: ModelUseSettings }): boolean {
  return settings.minds.enabled && mindsStepConfig(settings.modelUse, "mind") !== null;
}

/**
 * A minds step's instructions (DESIGN §24.5): the world's template for the purpose (the first by id),
 * else the user's own prompt, else the built-in; then the answer format, which no template replaces.
 */
export function mindPrompt(purpose: MindPurpose, world: WorldDoc, settings: MindsSettings, vars: Readonly<Record<string, string>>): { text: string; source: MindCallTrace["prompt"] } {
  const template = Object.values(world.steps)
    .filter((t) => t.purpose === purpose && t.template.trim() !== "")
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  const own = settings.prompts[purpose];
  const source: MindCallTrace["prompt"] = template ? "world" : own ? "override" : "default";
  const text = template?.template ?? own ?? MIND_PROMPT_DEFAULTS[purpose];
  return { text: `${renderTemplate(text, vars)}\n\n${MIND_ANSWER_FORMATS[purpose]}`, source };
}

function varsFor(world: WorldDoc, state: Readonly<WorldState>, who: EntityId): Record<string, string> {
  const place = placeOfEntity(state, who);
  return { world: world.name, character: own(state.entities, who)?.name ?? who, clock: formatClock(calendarOf(world), state.clock), place: place ? (own(world.places, place)?.name ?? place) : "", pov: povLabel({ state, world, who }) };
}

const str = (v: JsonValue | undefined): string => (typeof v === "string" ? v : "");

/** A local time a model wrote ("2026-10-19 18:30", "2026-10-19", "18:30" for the next such time) as game minutes; null when it isn't one. */
export function localTime(world: WorldDoc, now: number, text: string): number | null {
  const t = text.trim().replace(" ", "T");
  const cal = calendarOf(world);
  try {
    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(t)) return clockOfLocal(cal, t);
    if (/^\d{1,2}:\d{2}$/.test(t)) return nextTimeOfDay(cal, now - 1, parseHHMM(t.padStart(5, "0")));
  } catch {
    return null;
  }
  return null;
}

/** A person named by a model: by id, whole name, or a word of their name that is no one else's. */
function personNamed(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, name: string): EntityId | null {
  const n = name.trim().toLowerCase();
  if (n === "") return null;
  const people = Object.keys(state.entities).filter((id) => kindIs(reg, world, own(state.entities, id)?.kind ?? "", "person") && !isGone(state, id));
  const exact = people.find((id) => id === name.trim() || own(state.entities, id)?.name.toLowerCase() === n);
  if (exact) return exact;
  const partial = people.filter((id) => (own(state.entities, id)?.name.toLowerCase().split(/\s+/) ?? []).includes(n));
  return partial.length === 1 ? (partial[0] ?? null) : null;
}

function placeNamed(world: WorldDoc, name: string): string | null {
  const n = name.trim().toLowerCase();
  if (n === "") return null;
  return Object.keys(world.places).find((id) => id === name.trim() || own(world.places, id)?.name.toLowerCase() === n) ?? null;
}

/** Plans as a model wrote them, resolved to ids and game minutes; a plan with no time, or wholly past, is left out. */
export function plansFrom(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, who: EntityId, raw: JsonValue | undefined, source: MindPlan["source"]): MindPlan[] {
  const now = state.clock;
  const out: MindPlan[] = [];
  for (const [i, d] of (Array.isArray(raw) ? raw : []).slice(0, MIND_TEXT_CAPS.plans).entries()) {
    if (!isRecord(d)) continue;
    const what = capText(str(d.what), MIND_TEXT_CAPS.planWhat);
    const when = isRecord(d.when) ? d.when : {};
    const from = localTime(world, now, str(when.from));
    if (what === "" || from === null) continue;
    const toRaw = localTime(world, now, str(when.to));
    const to = toRaw !== null && toRaw >= from ? toRaw : from + 60;
    if (to < now) continue;
    const kind: PlanKind = (PLAN_KINDS as readonly string[]).includes(str(d.kind)) ? (str(d.kind) as PlanKind) : "other";
    const withIds = [...new Set((Array.isArray(d.with) ? d.with : []).map((x) => personNamed(reg, world, state, str(x))).filter((x): x is EntityId => x !== null && x !== who))];
    const priority = typeof d.priority === "number" && Number.isFinite(d.priority) ? Math.min(PLAN_PRIORITY.max, Math.max(PLAN_PRIORITY.min, Math.round(d.priority))) : PLAN_PRIORITY.normal;
    out.push({ id: `p_${hashParts("minds.plan", who, String(now), String(i), what).slice(0, 10)}`, what, kind, when: { from, to }, where: placeNamed(world, str(d.where)), with: withIds, priority, status: "open", made: now, source, closed: null, reason: null });
  }
  return out;
}

/**
 * A mind's answer as its event data, or null when it says nothing usable. Lengths are capped; under
 * `brief` the depiction is screened as Stance's cues are (an unrevealed secret, a name the POV can't
 * see), and one that fails is kept for the GM but `withheld` from the narrator.
 */
export function mindData(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, who: EntityId, raw: JsonValue, moment: MindMoment, level: Fidelity, reason: string): MindEventData | null {
  if (!isRecord(raw)) return null;
  const monologue = capText(str(raw.monologue), MIND_TEXT_CAPS.monologue);
  const intent = capText(str(raw.intent), MIND_TEXT_CAPS.intent);
  const depiction = capText(str(raw.depiction), MIND_TEXT_CAPS.depiction);
  if (monologue === "" && intent === "" && depiction === "") return null;
  const reactions = (Array.isArray(raw.reactions) ? raw.reactions : []).map((r) => capText(str(r), MIND_TEXT_CAPS.reaction)).filter((r) => r !== "").slice(0, MIND_TEXT_CAPS.reactions);
  const mood = capText(str(raw.mood), MIND_TEXT_CAPS.mood);
  const interruptReason = moment.kind === "beat" && isRecord(raw.interrupt) ? capText(str(raw.interrupt.reason), MIND_TEXT_CAPS.interrupt) : "";
  let withheld = false;
  if (worldMindsOf(world).secrecy === "brief" && depiction !== "") {
    const secrets = unrevealedSecrets(reg, world, state);
    withheld = findLeaks(depiction, secrets).length > 0 || hiddenNameCheck(reg, world, state, world.pov)(depiction);
  }
  return {
    entity: who,
    at: moment.at,
    place: placeOfEntity(state, who),
    level,
    moment: moment.kind,
    reason: capText(reason, MIND_TEXT_CAPS.reason),
    monologue,
    depiction,
    intent,
    reactions,
    plans: plansFrom(reg, world, state, who, raw.plans, "mind"),
    mood: mood === "" ? null : mood,
    interrupt: interruptReason === "" ? null : { reason: interruptReason },
    withheld,
  };
}

/** How the inspector names someone (DESIGN §6.5): by name only when the POV knows them. */
function traceName(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, who: EntityId): string {
  return playerKnows(reg, world, state, world.pov, who) ? (own(state.entities, who)?.name ?? "Someone") : "Someone";
}

async function chatMessages(deps: MindsDeps, chatId: ChatId, userId: UserId): Promise<HostMessage[]> {
  try {
    return await deps.host.chats.messages(chatId, userId);
  } catch {
    return [];
  }
}

/**
 * One mind per character in `who` for `moment` (DESIGN §24.5): separate calls, made in parallel,
 * each on that character's scoped context. Nothing is recorded: the validated `minds.mind` events
 * come back in `who`'s order, with whatever finished before `signal` ended the phase.
 */
export async function runMinds(deps: MindsDeps, input: RunMindsInput): Promise<RunMindsResult> {
  const { registry: reg } = deps;
  const { world, state, userId } = input;
  const settings = await deps.settings.get(userId);
  const config = mindsStepConfig(settings.modelUse, "mind");
  if (!config || input.who.length === 0) return { events: [], traces: [] };
  const memory = effectiveMemory(world, settings.minds);
  const guidance = input.guidance ?? deps.presets.last(userId).guidance.mind ?? "";
  const messages = input.messages ?? (await chatMessages(deps, input.chatId, userId));
  const loreTokens = config.lore && config.lore.policy !== "none" ? config.lore.tokens : config.lore ? 0 : 400;
  const phase = input.phase ?? (input.moment.kind === "beat" ? "skip" : "pre");
  const calls = input.who.map(async (who): Promise<{ data: MindEventData | null; trace: MindCallTrace }> => {
    const level = input.levels[who] ?? "near";
    const e = own(state.entities, who);
    const base = { purpose: "mind" as const, phase, who: traceName(reg, world, state, who), level };
    const prompt = mindPrompt("mind", world, settings.minds, varsFor(world, state, who));
    if (!e) return { data: null, trace: { ...base, outcome: "failed", ms: 0, tokens: 0, prompt: prompt.source } };
    const scope: MindScope = { reg, world, state, who, memory, messages, hideJson: settings.hideJsonBlocks, moment: input.moment, loreTokens };
    const usage = { tokens: 0 };
    const t0 = performance.now();
    const raw = input.signal.aborted ? null : await deps.steps.helperJson("mind", prompt.text, mindContext(scope), config, userId, input.signal, { guidance, usage });
    const ms = Math.round(performance.now() - t0);
    const data = raw === null ? null : mindData(reg, world, state, who, raw, input.moment, level, input.reasons?.[who] ?? input.moment.reason);
    return { data, trace: { ...base, outcome: data === null ? "failed" : data.withheld ? "leak_blocked" : "recorded", ms, tokens: usage.tokens, prompt: prompt.source } };
  });
  const results = await Promise.all(calls);
  // Each checked against the state it will fold on: one that doesn't validate is dropped.
  const w = new Working(reg, world, state);
  const events: LedgerEvent[] = [];
  for (const r of results) {
    if (!r.data) continue;
    const event: LedgerEvent = { type: MINDS_EVENTS.mind, data: r.data as unknown as JsonObject };
    if (!w.apply(event)) events.push(event);
  }
  return { events, traces: results.map((r) => r.trace) };
}

export interface PreMindsInput {
  chatId: ChatId;
  userId: UserId;
  world: WorldDoc;
  /** The state the turn plans from. */
  state: Readonly<WorldState>;
  /** The turn's last user message, and the reply before it. */
  user: string;
  reply: string;
  /** The turn plays a timelapse: the skip runs its minds at its beats (`skip.ts`), so none run here. */
  timelapse: boolean;
  signal: AbortSignal;
  guidance?: string;
}

/**
 * The pre phase (DESIGN §24.1): the round (every turn with minds on, and once with them off after
 * they were on), then, unless the turn is a timelapse, the minds the ladder and the cadence pick.
 */
export async function preMinds(deps: MindsDeps, input: PreMindsInput): Promise<RunMindsResult> {
  const settings = await deps.settings.get(input.userId);
  const on = mindsOn(settings);
  if (!on) return { events: readSlice(input.state).on ? [{ type: MINDS_EVENTS.round, data: { at: input.state.clock, on: false } }] : [], traces: [] };
  const round: LedgerEvent = { type: MINDS_EVENTS.round, data: { at: input.state.clock, on: true } };
  if (input.timelapse) return { events: [round], traces: [] };
  const w = new Working(deps.registry, input.world, input.state);
  w.apply(round);
  const ctx = deps.registry.context(input.world, w.state);
  const texts = { user: input.user, reply: input.reply };
  const scores = fidelityOf(ctx, texts);
  const picks = pickMinds(ctx, scores, texts, settings.minds);
  const levels: Record<EntityId, Fidelity> = {};
  const reasons: Record<EntityId, string> = {};
  for (const p of picks) {
    levels[p.entity] = p.level;
    reasons[p.entity] = p.reason;
  }
  const moment: MindMoment = { kind: "turn", at: w.state.clock, reason: "a turn", user: input.user, reply: input.reply };
  const ran = await runMinds(deps, { chatId: input.chatId, userId: input.userId, world: input.world, state: w.state, who: picks.map((p) => p.entity), moment, levels, reasons, signal: input.signal, ...(input.guidance !== undefined ? { guidance: input.guidance } : {}), phase: "pre" });
  return { events: [round, ...ran.events], traces: ran.traces };
}

export interface PostMindsInput {
  chatId: ChatId;
  userId: UserId;
  world: WorldDoc;
  /** The state the turn started from: where the player's message was said, and who heard it. */
  start: Readonly<WorldState>;
  /** The state the reply was written in: the fold prefix and the turn's planned events. */
  state: Readonly<WorldState>;
  /** The turn's planned events: what present characters saw happen. */
  pre: readonly LedgerEvent[];
  /** The reply's message. */
  messageId: MessageId;
  user: string;
  /** The reply as the engine reads it. */
  reply: string;
  signal: AbortSignal;
  guidance?: { memory?: string; consolidate?: string };
}

/** Who is in the POV's scene in `state`: everyone acting at its place but the POV, whether it sees them or not. */
export function presentWith(reg: Registry, world: WorldDoc, state: Readonly<WorldState>): EntityId[] {
  const here = placeOfEntity(state, world.pov);
  if (here === null) return [];
  return Object.keys(state.entities)
    .sort()
    .filter((id) => id !== world.pov && placeOfEntity(state, id) === here && kindIs(reg, world, own(state.entities, id)?.kind ?? "", "person") && !isGone(state, id) && acts(world, state, id));
}

/**
 * A turn's presence (DESIGN §24.4): who heard the player's message, where it was said, and what they
 * saw happen until the POV left them (`said`); then whoever the POV is with at the turn's end that
 * didn't hear it, with no message, so they never recall it or remember it (`met`). When the POV ends
 * the turn somewhere else, that is everyone at the destination, a companion who came along included,
 * with what they saw from its arrival; otherwise someone who came in while the turn played. `left`:
 * those who heard it and stayed behind.
 */
export function turnPresence(reg: Registry, world: WorldDoc, input: Pick<PostMindsInput, "start" | "state" | "pre" | "messageId">): { said: PresenceEventData; met: PresenceEventData | null; left: EntityId[] } {
  const { start, state, pre } = input;
  const pov = world.pov;
  const from = placeOfEntity(start, pov);
  const to = placeOfEntity(state, pov);
  const heard = presentWith(reg, world, start);
  const there = presentWith(reg, world, state);
  const saw = (events: readonly LedgerEvent[]): string[] => witnessLines(reg, world, state, pov, events, 3);
  if (from === to) {
    const came = there.filter((id) => !heard.includes(id));
    return { said: { msg: input.messageId, at: state.clock, place: from, who: heard, saw: saw(pre) }, met: came.length > 0 ? { msg: null, at: state.clock, place: to, who: came, saw: [] } : null, left: [] };
  }
  // Where the POV was as each planned event happened: the event that took it away, and the one that
  // brought it where it ended.
  const w = new Working(reg, world, start);
  let away = -1;
  let awayAt = start.clock;
  let arrived = 0;
  pre.forEach((e, i) => {
    w.apply(e);
    const at = placeOfEntity(w.state, pov);
    if (away < 0 && at !== from) {
      away = i;
      awayAt = w.state.clock;
    }
    if (at !== to) arrived = i + 1;
  });
  return {
    said: { msg: input.messageId, at: awayAt, place: from, who: heard, saw: saw(away < 0 ? pre : pre.slice(0, away + 1)) },
    met: there.length > 0 ? { msg: null, at: state.clock, place: to, who: there, saw: saw(pre.slice(arrived)) } : null,
    left: heard.filter((id) => !there.includes(id)),
  };
}

/** The `memory` step's answer as event data; what they told reaches only `listeners`, who were with them for the turn. */
function memoryData(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, who: EntityId, raw: JsonValue, listeners: readonly EntityId[]): JsonObject | null {
  if (!isRecord(raw)) return null;
  const now = state.clock;
  const notes: MindNote[] = (Array.isArray(raw.notes) ? raw.notes : []).slice(0, MIND_TEXT_CAPS.notes).flatMap((n, i) => {
    if (!isRecord(n)) return [];
    const text = capText(str(n.text), MIND_TEXT_CAPS.note);
    const salience = typeof n.salience === "number" && Number.isFinite(n.salience) ? Math.min(5, Math.max(1, Math.round(n.salience))) : 3;
    return text === "" ? [] : [{ id: `n_${hashParts("minds.note", who, String(now), String(i), text).slice(0, 10)}`, text, salience, at: now }];
  });
  const commitments: MindCommitment[] = (Array.isArray(raw.commitments) ? raw.commitments : []).slice(0, MIND_TEXT_CAPS.commitments).flatMap((x, i) => {
    if (!isRecord(x)) return [];
    const text = capText(str(x.text), MIND_TEXT_CAPS.commitment);
    if (text === "") return [];
    const kind: CommitmentKind = (COMMITMENT_KINDS as readonly string[]).includes(str(x.kind)) ? (str(x.kind) as CommitmentKind) : "other";
    const withIds = [...new Set((Array.isArray(x.with) ? x.with : []).map((n) => personNamed(reg, world, state, str(n))).filter((n): n is EntityId => n !== null && n !== who))];
    return [{ id: `c_${hashParts("minds.commitment", who, String(now), String(i), text).slice(0, 10)}`, kind, with: withIds, text, due: localTime(world, now, str(x.due)), status: "open" as const, made: now, closed: null }];
  });
  const open = new Set(readCharacter(state, who).commitments.filter((x) => x.status === "open").map((x) => x.id));
  const resolved = (Array.isArray(raw.resolved) ? raw.resolved : []).flatMap((r) => (isRecord(r) && open.has(str(r.id)) && (r.status === "kept" || r.status === "broken" || r.status === "released") ? [{ id: str(r.id), status: r.status }] : []));
  const told = (Array.isArray(raw.told) ? raw.told : []).slice(0, MIND_TEXT_CAPS.tolds).flatMap((t) => {
    if (!isRecord(t)) return [];
    const what = capText(str(t.what), MIND_TEXT_CAPS.told);
    const to = [...new Set((Array.isArray(t.to) ? t.to : []).map((n) => personNamed(reg, world, state, str(n))).filter((n): n is EntityId => n !== null && n !== who && listeners.includes(n)))];
    return what === "" || to.length === 0 ? [] : [{ to, what }];
  });
  const summary = capText(str(raw.summary), MIND_TEXT_CAPS.summary);
  return { entity: who, at: now, notes, commitments, resolved, plans: plansFrom(reg, world, state, who, raw.plans, "memory"), told, summary: summary === "" ? null : summary } as unknown as JsonObject;
}

/** How many characters' notes one turn folds at most: consolidation is upkeep, never the turn's work. */
const CONSOLIDATIONS_PER_TURN = 2;

/**
 * The post phase (DESIGN §24.4): who heard the turn and who the POV met in it (and what each saw
 * happen), then the `memory` step for each who heard it at a level the user chose, from what was
 * written, then `consolidate` for those whose notes overflow or fade, at most once per period each.
 */
export async function postMinds(deps: MindsDeps, input: PostMindsInput): Promise<RunMindsResult> {
  const { registry: reg } = deps;
  const { world, state, userId } = input;
  const settings = await deps.settings.get(userId);
  if (!mindsOn(settings)) return { events: [], traces: [] };
  const { said, met, left } = turnPresence(reg, world, input);
  const w = new Working(reg, world, state);
  const events: LedgerEvent[] = [];
  for (const data of met ? [said, met] : [said]) {
    const presence: LedgerEvent = { type: MINDS_EVENTS.presence, data };
    if (!w.apply(presence)) events.push(presence);
  }
  const traces: MindCallTrace[] = [];
  const memory = effectiveMemory(world, settings.minds);
  // Their level as they heard it: where the message was said.
  const levels = new Map(fidelityOf(reg.context(world, input.start), { user: input.user, reply: input.reply }).map((s) => [s.entity, s.level]));
  const memoryConfig = mindsStepConfig(settings.modelUse, "memory");
  const remembering = memoryConfig ? said.who.filter((id) => settings.minds.memoryLevels.includes(levels.get(id) ?? "background")) : [];
  const messages = remembering.length > 0 ? await chatMessages(deps, input.chatId, userId) : [];
  const moment: MindMoment = { kind: "turn", at: state.clock, reason: "after the reply", user: input.user, reply: input.reply };
  const remembered = await Promise.all(
    remembering.map(async (id) => {
      const prompt = mindPrompt("memory", world, settings.minds, varsFor(world, w.state, id));
      const scope: MindScope = { reg, world, state: w.state, who: id, memory, messages, hideJson: settings.hideJsonBlocks, moment, loreTokens: 0 };
      const usage = { tokens: 0 };
      const t0 = performance.now();
      const raw = input.signal.aborted ? null : await deps.steps.helperJson("memory", prompt.text, memoryContext(scope, { user: input.user, reply: input.reply, left: left.includes(id) }), memoryConfig, userId, input.signal, { guidance: input.guidance?.memory ?? deps.presets.last(userId).guidance.memory ?? "", usage });
      // Their listeners: who heard the turn with them, and, unless the POV left them, whoever it met.
      const listeners = left.includes(id) ? said.who : [...said.who, ...(met?.who ?? [])];
      const data = raw === null ? null : memoryData(reg, world, w.state, id, raw, listeners);
      traces.push({ purpose: "memory", phase: "post", who: traceName(reg, world, state, id), level: levels.get(id) ?? "near", outcome: data ? "recorded" : "failed", ms: Math.round(performance.now() - t0), tokens: usage.tokens, prompt: prompt.source });
      return data;
    }),
  );
  for (const data of remembered) {
    if (!data) continue;
    const event: LedgerEvent = { type: MINDS_EVENTS.memory, data };
    if (!w.apply(event)) events.push(event);
  }
  // Consolidation: notes past the number kept, and the faded, folded into the summary.
  const consolidateConfig = memory.consolidate.enabled ? mindsStepConfig(settings.modelUse, "consolidate") : null;
  if (consolidateConfig) {
    const now = w.state.clock;
    const due = Object.keys(readSlice(w.state).chars)
      .sort()
      .flatMap((id) => {
        const c = readCharacter(w.state, id);
        const last = c.consolidated ?? null;
        if (last !== null && now - last < memory.consolidate.periodDays * 1440) return [];
        const ranked = [...c.notes].sort((a, b) => salienceNow(a, now, memory) - salienceNow(b, now, memory) || a.at - b.at);
        const surplus = Math.max(0, c.notes.length - memory.notes.keep);
        const fold = ranked.filter((n, i) => i < surplus || faded(n, now, memory));
        return fold.length > 0 ? [{ id, fold }] : [];
      })
      .slice(0, CONSOLIDATIONS_PER_TURN);
    const folded = await Promise.all(
      due.map(async ({ id, fold }) => {
        const prompt = mindPrompt("consolidate", world, settings.minds, varsFor(world, w.state, id));
        const usage = { tokens: 0 };
        const t0 = performance.now();
        const raw = input.signal.aborted ? null : await deps.steps.helperJson("consolidate", prompt.text, consolidateContext({ state: w.state, world, who: id }, fold), consolidateConfig, userId, input.signal, { guidance: input.guidance?.consolidate ?? deps.presets.last(userId).guidance.consolidate ?? "", usage });
        const summary = isRecord(raw) ? capText(str(raw.summary), MIND_TEXT_CAPS.summary) : "";
        traces.push({ purpose: "consolidate", phase: "post", who: traceName(reg, world, state, id), level: levels.get(id) ?? "background", outcome: summary === "" ? "failed" : "recorded", ms: Math.round(performance.now() - t0), tokens: usage.tokens, prompt: prompt.source });
        return summary === "" ? null : ({ type: MINDS_EVENTS.consolidated, data: { entity: id, at: now, notes: fold.map((n) => n.id), summary } } satisfies LedgerEvent);
      }),
    );
    for (const event of folded) if (event && !w.apply(event)) events.push(event);
  }
  return { events, traces };
}

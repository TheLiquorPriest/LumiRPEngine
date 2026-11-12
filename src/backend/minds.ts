// Character minds around a turn (DESIGN §24): the backend side, where the model calls are. Every
// mind is its own call, blind to every other, made in parallel; every answer is checked, screened and
// recorded as an event, so the fold, a Re-narrate and the background lane never call a model.
//
//   runMinds   one mind per character for a moment (a turn, a beat inside a time skip, or a GM's run
//              between turns); records nothing: it returns the validated `minds.mind` events, for
//              the turn, the skip or the GM's edit, with how each mind went.
//   preMinds   the pre phase: the round, then the minds the ladder and the cadence pick.
//   postMinds  the post phase: who was present, then each one's memory of what was written, then
//              consolidation, each character at most once per period, with the knowledge step beside
//              them while the chat tracks knowledge. An agent turn runs its parts apart: the opening
//              (`postOpening`), the knowledge step (`postKnowledge`) and memory (`postMemory`), which
//              its pipeline may leave to the next turn.
//   preKnowledge  the knowledge step before the plan, for the people a decision of it turns on.
//
// Every call goes through `askMind` (`mind-ask.ts`): classic's own call on a classic turn, the
// turn's role on an agent turn, each answer checked by the same code either way.

import type { Counts, KnowledgeRefusal } from "../shared/agent-yield";
import { hashParts } from "../shared/hash";
import type { ChatId, EntityId, MessageId, UserId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import type { CommitmentKind, FactId, Fidelity, KnowledgeProposal, KnowledgeSettings, Limit, MemoryEventData, MindCallTrace, MindCommitment, MindCuts, MindEventData, MindLengths, MindMoment, MindNote, MindPlan, MindPurpose, MindsMemoryConfig, MindsRunEntry, MindsSettings, PinnedTrace, PlanKind, PresenceEventData } from "../shared/minds";
import { answerLengths, COMMITMENT_KINDS, cutsNote, effectiveMemory, knowledgeAnswerFormat, knowledgeThreshold, knowledgeTracked, MEMORY_ANSWER_V2, MIND_ANSWER_FORMATS, MIND_PROMPT_DEFAULTS, MINDS_EVENTS, MINDS_SLOT, parseFactId, PLAN_KINDS, PLAN_PRIORITY, sharedPlanId, sharesPlan, worldMindsOf, worldMindTemplate } from "../shared/minds";
import type { ModelUseSettings, StepConfig, UserSettings } from "../shared/settings";
import { helperCallOf, stepConfigOf } from "../shared/settings";
import type { StepPurpose, WorldDoc } from "../shared/world";
import { parseMoneyInput } from "../shared/money";
import { calendarOf, clockOfStamp, formatClock, nextTimeOfDay } from "../engine/calendar";
import { ownMessage } from "../engine/ledger/path";
import { feedOf } from "../engine/feed";
import { loreReadable } from "../engine/lore";
import { pinsFor } from "../engine/lore-pins";
import { own } from "../engine/pack-kit";
import { hiddenNameCheck, playerKnows, witnessLines } from "../engine/player-events";
import type { Registry } from "../engine/registry-impl";
import { together } from "../engine/presence";
import { isGone, kindIs, placeOfEntity } from "../engine/scope";
import type { WorldState } from "../engine/state";
import { findLeaks, loreGateReader, unrevealedSecrets } from "../engine/visibility";
import { acts } from "../engine/life";
import { Working } from "../engine/working";
import { capCounted, capText, firstCounted } from "../packs/minds/core/edit";
import { fidelityOf, type MindPick, pickMinds, quietMind } from "../packs/minds/core/fidelity";
import { faded, readCharacter, readSlice, salienceNow } from "../packs/minds/core/state";
import { sectionsOf } from "./book";
import type { HostMessage, HostPort } from "./host";
import { seedKnowledge } from "./knowledge-seed";
import { checkKnowledge, knowledgeBatches, knowledgeContext, knowledgeSpent, type KnowledgeTurn } from "./knowledge-step";
import { askMind, type MindAsk } from "./mind-ask";
import { pinReader, readPins } from "./lore-pins";
import { loreFactOf } from "./lore-ids";
import { consolidateContext, memoryContext, mindContext, pinnedLines, povLabel, type GivenLore, type MindContextReport, type MindScope } from "./minds-context";
import type { PresetBinding } from "./preset-binding";
import type { SettingsStore } from "./settings-store";
import { NotNeeded, type Steps } from "./steps";
import { renderTemplate } from "./turn-steps";

/** What the minds need of the backend: the host (the chat's messages), the registry, the steps, the user's settings and preset. */
export interface MindsDeps {
  host: HostPort;
  registry: Registry;
  steps: Steps;
  settings: SettingsStore;
  presets: PresetBinding;
  /** Who answers the calls: none, the classic steps themselves; an agent turn's roles (`askMind`). */
  ask?: MindAsk;
  /** The book entry a lore index short id names, as `bookId/entryId` (Settings → Lore); null for one never given. */
  loreEntry?(userId: UserId, id: string): Promise<string | null>;
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
  /** The reply the turn replaces, a Regenerate's or a swipe's target, which the chat still holds: Recent chat stops before it (`chatBefore`). */
  replaces?: MessageId;
  /** The trace's phase: the turn's pre phase, or a skip's beat. */
  phase?: MindCallTrace["phase"];
  /** How many calls run at once; absent, all of them. */
  concurrency?: number;
  /** Hears each mind start thinking, then how it went (a GM's run shows its progress, DESIGN §24.9). */
  progress?: (entry: MindsRunEntry) => void;
  /**
   * What minds answered in an engine run that failed, from exactly this state and moment (DESIGN
   * §5.1): each is kept, not asked again, so a Retry asks only the minds that failed.
   */
  kept?: ReadonlyMap<EntityId, MindEventData>;
  /**
   * A call that fails fails no step of its own (`DiagCall.spared`): the caller tells which minds
   * didn't answer from `report`. The pre phase's start before the turn knows it will take them.
   */
  spared?: boolean;
  /** The user's knowledge settings, while the chat tracks knowledge (DESIGN §24.11): each mind reads what it holds. */
  knowledge?: KnowledgeSettings;
}

export interface RunMindsResult {
  events: LedgerEvent[];
  traces: MindCallTrace[];
  /** How each mind went, in `who`'s order: GM data, for a GM's run (DESIGN §24.9); absent where nothing ran. */
  report?: MindsRunEntry[];
  /**
   * The post phase's knowledge step (DESIGN §24.11): the player character's own changes (C4), whose
   * modes decide them; everyone else's learnings, which follow the `learn` mode (none under never);
   * the connection the step ran on, whose learning counts them (null: the default one); and what it
   * didn't take of its calls' answers: how many it refused, by why, and how many calls gave no answer
   * it takes, which a role's run reports (`agents/yields.ts`).
   */
  knowledge?: { proposals: KnowledgeProposal[]; events: LedgerEvent[]; connection: string | null; refused?: Counts<KnowledgeRefusal>; failed?: number; limits?: Pick<KnowledgeSettings, "factsPerTurn" | "factsPerChat" | "learningsPerTurn"> };
}

/** The step card a minds purpose runs with (`stepConfigOf`: on with the helper's tokens while unsaved); null when the user saved it off. */
export function mindsStepConfig(modelUse: ModelUseSettings, purpose: MindPurpose): StepConfig | null {
  const config = stepConfigOf(modelUse.steps, purpose);
  return config.enabled ? config : null;
}

/** Whether minds run for this user: on in Settings → Minds, with the `mind` step not switched off. */
export function mindsOn(settings: { minds: MindsSettings; modelUse: ModelUseSettings }): boolean {
  return settings.minds.enabled && mindsStepConfig(settings.modelUse, "mind") !== null;
}

/**
 * A minds step's own wording (DESIGN §24.5): the user's prompt for the purpose, else the world's
 * template for it (`worldMindTemplate`: the first by id with any text), its placeholders filled; null
 * for the built-in.
 */
export function ownMindPrompt(purpose: MindPurpose, world: WorldDoc, settings: MindsSettings, vars: Readonly<Record<string, string>>): { text: string; source: Exclude<MindCallTrace["prompt"], "default"> } | null {
  const own = settings.prompts[purpose]?.trim() ? settings.prompts[purpose] : undefined;
  if (own !== undefined) return { text: renderTemplate(own, vars), source: "override" };
  const template = worldMindTemplate(world, purpose);
  return template ? { text: renderTemplate(template.template, vars), source: "world" } : null;
}

/**
 * A minds step's instructions: its own wording (`ownMindPrompt`), else the built-in; then the answer
 * format, which no prompt replaces, and what each part of the answer may run to (`answerLengths`,
 * Settings → Minds → Lengths), so the model writes to the lengths the engine keeps. While the chat
 * tracks knowledge (`knowing`), the memory step's format is the one without `told`
 * (`MEMORY_ANSWER_V2`, DESIGN §24.11): telling is the knowledge step's.
 */
export function mindPrompt(purpose: MindPurpose, world: WorldDoc, settings: MindsSettings, vars: Readonly<Record<string, string>>, knowing = false): { text: string; source: MindCallTrace["prompt"] } {
  const own = ownMindPrompt(purpose, world, settings, vars);
  const format = purpose === "memory" && knowing ? MEMORY_ANSWER_V2 : purpose === "knowledge" ? knowledgeAnswerFormat(settings.knowledge) : MIND_ANSWER_FORMATS[purpose];
  return { text: `${own?.text ?? renderTemplate(MIND_PROMPT_DEFAULTS[purpose], vars)}\n\n${format}\n${answerLengths(purpose, settings, knowing)}`, source: own?.source ?? "default" };
}

/** The placeholders a minds step's prompt is filled with, for `who`: the world, the character, the clock, where they are, and the player character as they know them. */
export function varsFor(world: WorldDoc, state: Readonly<WorldState>, who: EntityId): Record<string, string> {
  const place = placeOfEntity(state, who);
  return { world: world.name, character: own(state.entities, who)?.name ?? who, clock: formatClock(calendarOf(world), state.clock), place: place ? (own(world.places, place)?.name ?? place) : "", pov: povLabel({ state, world, who }) };
}

const str = (v: JsonValue | undefined): string => (typeof v === "string" ? v : "");

/**
 * A local time a model wrote ("2026-10-19 18:30", "2026-10-19" for its midnight, "18:30" for the next
 * such time) as game minutes; null unless it is a day the calendar has at a time from 00:00 to 23:59
 * (`clockOfStamp`), never a guess at what was meant.
 */
export function localTime(world: WorldDoc, now: number, text: string): number | null {
  const t = text.trim();
  const cal = calendarOf(world);
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return clockOfStamp(cal, `${t} 00:00`);
  const hm = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!hm) return clockOfStamp(cal, t);
  const hours = Number(hm[1]);
  const minutes = Number(hm[2]);
  return hours <= 23 && minutes <= 59 ? nextTimeOfDay(cal, now - 1, hours * 60 + minutes) : null;
}

/** A person named by a model: by id, whole name, or a word of their name that is no one else's. */
export function personNamed(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, name: string): EntityId | null {
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

/**
 * The plans a memory answer gives, resolved to ids and game minutes; a plan with no time, or wholly
 * past, is left out, and so is a pay or lend plan with no positive amount or no one to hand it to.
 * Only the memory step gives plans (DESIGN §24.8): it reads the turn as written. One with others in
 * it is theirs too (`sharesPlan`), under the id its people and start give it (`sharedPlanId`), so the
 * same plan in another's memory of the turn is the same plan; the answer giving it twice gives it once.
 * At most the user's lengths' plans are read, each one's words cut to its length, as `cuts` counts.
 */
export function plansFrom(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, who: EntityId, raw: JsonValue | undefined, lengths: Readonly<MindLengths>, cuts?: MindCuts): MindPlan[] {
  const now = state.clock;
  const out: MindPlan[] = [];
  for (const [i, d] of firstCounted(Array.isArray(raw) ? raw.filter((x): x is JsonObject => isRecord(x)) : [], lengths.plans, cuts, "plans").entries()) {
    const what = capCounted(str(d.what), lengths.plan, cuts, "plan");
    const when = isRecord(d.when) ? d.when : {};
    const from = localTime(world, now, str(when.from));
    if (what === "" || from === null) continue;
    const toRaw = localTime(world, now, str(when.to));
    const to = toRaw !== null && toRaw >= from ? toRaw : from + 60;
    if (to < now) continue;
    const kind: PlanKind = (PLAN_KINDS as readonly string[]).includes(str(d.kind)) ? (str(d.kind) as PlanKind) : "other";
    const withIds = [...new Set((Array.isArray(d.with) ? d.with : []).map((x) => personNamed(reg, world, state, str(x))).filter((x): x is EntityId => x !== null && x !== who))];
    const priority = typeof d.priority === "number" && Number.isFinite(d.priority) ? Math.min(PLAN_PRIORITY.max, Math.max(PLAN_PRIORITY.min, Math.round(d.priority))) : PLAN_PRIORITY.normal;
    // The amount comes in the world's major units, as a number or as typed ("$20"); the payee is the first person it's with.
    const money = kind === "pay" || kind === "lend";
    const cents = !money ? 0 : typeof d.amount === "number" && Number.isFinite(d.amount) ? Math.round(d.amount * 10 ** world.currency.decimals) : (parseMoneyInput(str(d.amount), world.currency) ?? 0);
    if (money && (cents <= 0 || withIds.length === 0)) continue;
    const shared = sharesPlan({ kind, with: withIds });
    const id = shared ? sharedPlanId([who, ...withIds], from) : `p_${hashParts("minds.plan", who, String(now), String(i), what).slice(0, 10)}`;
    if (out.some((p) => p.id === id)) continue;
    // A shared plan's words are this memory's reading of the turn: its author is kept, so no one else in it reads them (`planWords`).
    out.push({ id, what, kind, when: { from, to }, where: placeNamed(world, str(d.where)), with: withIds, priority, status: "open", made: now, source: "memory", closed: null, reason: null, ...(money ? { cents } : {}), ...(shared ? { shared: true as const, by: who } : {}) });
  }
  return out;
}

/**
 * A memory's plans less those its character already holds by id (DESIGN §24.8): a shared plan another
 * memory of the same turn recorded first reached them already, so theirs records no second copy; nor
 * does a plan a later turn only states again.
 */
export function unheldPlans(state: Readonly<WorldState>, who: EntityId, plans: readonly MindPlan[]): MindPlan[] {
  const held = readCharacter(state, who).plans;
  return plans.filter((p) => !held.some((x) => x.id === p.id));
}

/**
 * A mind's answer as its event data, or null when it says nothing usable. Each text is cut to its
 * length and each list to its count (`lengths`, Settings → Minds → Lengths, which the mind was told),
 * as `cuts` counts; under `brief` the depiction is screened as Stance's cues are (an unrevealed
 * secret, a name the POV can't see), and one that fails is kept for the GM but `withheld` from the
 * narrator. Any plans it gives are ignored: a mind sees what its character knows, not where the
 * story is going, so plans come only from the memory step (DESIGN §24.8).
 */
export function mindData(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, who: EntityId, raw: JsonValue, moment: MindMoment, level: Fidelity, reason: string, lengths: Readonly<MindLengths>, cuts?: MindCuts): MindEventData | null {
  if (!isRecord(raw)) return null;
  const monologue = capCounted(str(raw.monologue), lengths.monologue, cuts, "monologue");
  const intent = capCounted(str(raw.intent), lengths.intent, cuts, "intent");
  const depiction = capCounted(str(raw.depiction), lengths.depiction, cuts, "depiction");
  if (monologue === "" && intent === "" && depiction === "") return null;
  const said = (Array.isArray(raw.reactions) ? raw.reactions : []).map(str).filter((r) => r.trim() !== "");
  const reactions = firstCounted(said, lengths.reactions, cuts, "reactions").map((r) => capCounted(r, lengths.reaction, cuts, "reaction"));
  const mood = capCounted(str(raw.mood), lengths.mood, cuts, "mood");
  const interruptReason = moment.kind === "beat" && isRecord(raw.interrupt) ? capCounted(str(raw.interrupt.reason), lengths.interrupt, cuts, "interrupt") : "";
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
    // Why they thought now is the engine's words (a refresh, a beat's reason), never the model's.
    reason: capText(reason, lengths.reason),
    monologue,
    depiction,
    intent,
    reactions,
    mood: mood === "" ? null : mood,
    interrupt: interruptReason === "" ? null : { reason: interruptReason },
    withheld,
  };
}

/**
 * Whether the inspector lists a minds call for someone (DESIGN §6.5): only when the POV may see and
 * has met them, so it never tells of anyone hidden or unknown. It names them; it shows no text.
 */
function traced(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, who: EntityId): boolean {
  return playerKnows(reg, world, state, world.pov, who);
}

async function chatMessages(deps: MindsDeps, chatId: ChatId, userId: UserId): Promise<HostMessage[]> {
  try {
    return await deps.host.chats.messages(chatId, userId);
  } catch {
    return [];
  }
}

/**
 * The chat before the turn a minds call is about (DESIGN §24.5, Recent chat), which the call reads as
 * the moment or the turn. When the chat holds the turn's reply (`reply`: the one just written, or the
 * one a Regenerate replaces), the chat before that reply, less the turn's own message (`ownMessage`):
 * a reply sent after a reply has none, so the messages before it stay. Otherwise a turn in hand (a
 * player's message, or a time skip's) ends the chat with its message, so the chat before the player's
 * last message. Between turns, all of it.
 */
export function chatBefore(messages: readonly HostMessage[], inTurn: boolean, reply?: MessageId): readonly HostMessage[] {
  const written = reply === undefined ? -1 : messages.findIndex((m) => m.id === reply);
  if (written >= 0) {
    const before = messages.slice(0, written);
    return ownMessage(before) ? before.slice(0, -1) : before;
  }
  if (!inTurn) return messages;
  const at = messages.findLastIndex((m) => m.isUser);
  return at < 0 ? messages : messages.slice(0, at);
}

/** One mind's call as `runMinds` keeps it: its event data (null when it said nothing), its inspector trace and the GM's report of it. */
interface MindCallResult {
  data: MindEventData | null;
  trace: MindCallTrace;
  entry: MindsRunEntry;
}

/**
 * One mind per character in `who` for `moment` (DESIGN §24.5): separate calls, made in parallel (at
 * most `concurrency` at once), each on that character's scoped context, the lore pinned to them and
 * to where they are first. Nothing is recorded: the validated `minds.mind` events come back in
 * `who`'s order, with whatever finished before `signal` ended the phase, and how each mind went: the
 * inspector's traces (no text, only people the POV may know, only the pinned lore the player may know
 * of) and the GM's report (why one failed, every pin it was given).
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
  const reads = settings.minds.reads;
  const phase = input.phase ?? (input.moment.kind === "beat" ? "skip" : "pre");
  // A turn is in hand before its reply and through a time skip; a GM's run between turns has none. A
  // Regenerate's turn has its reply too, the one it replaces, which its minds don't read again.
  const history = reads.history.on ? chatBefore(messages, phase === "skip" || input.moment.kind === "beat" || input.moment.user.trim() !== "", input.replaces) : undefined;
  // The lore pinned to each of them, to every mind (the mind step's; at a time skip's beat, the beats
  // step's too) and to where they are (DESIGN §24.5), each book entry and whole book read once, when
  // minds read it.
  const steps: StepPurpose[] = phase === "skip" ? ["mind", "skip"] : ["mind"];
  const refs = new Map(input.who.map((who) => [who, reads.pinned.on ? pinsFor(world, placeOfEntity(state, who), who, steps) : []]));
  const pinsOf = await pinReader(deps.host, world, [...refs.values()].flat(), userId);
  // What the inspector may name of a pin (§6.5): an entry the player may read, by a title that says
  // nothing the player doesn't know; a secret, or anything only the character may read, isn't listed.
  const open = loreGateReader(reg, world, state);
  let screen: ((title: string) => string) | null = null;
  const shownTitle = (title: string): string => {
    if (!screen) {
      const secrets = unrevealedSecrets(reg, world, state);
      const hidden = hiddenNameCheck(reg, world, state, world.pov);
      screen = (t) => (findLeaks(t, secrets).length > 0 || hidden(t) ? "A hidden entry" : t);
    }
    return screen(title);
  };
  const listed = (p: GivenLore): boolean => !p.secret && (p.entry === null || loreReadable(reg, world, state, p.entry, "brief", false, open));
  // What the player may know of the lore a mind was given, and whether any of it was cut or left out over its limit, and why.
  const shownLore = (items: readonly GivenLore[]): PinnedTrace[] => items.filter((p) => listed(p) && !p.left).map((p) => ({ title: shownTitle(p.title), tokens: p.tokens, cut: p.cut }));
  const fitNote = (what: string, items: readonly GivenLore[], limit: Limit): string[] => {
    const shown = items.filter(listed);
    const cut = shown.filter((p) => !p.left && p.cut).length;
    const left = shown.filter((p) => p.left).length;
    return cut + left > 0 ? [`${what} didn't all fit: ${[cut > 0 ? `${cut} cut to fit` : "", left > 0 ? `${left} left out` : ""].filter((s) => s !== "").join(", ")}, over the ${limit} tokens a mind reads of it; raise that in Settings → Minds → What a mind reads.`] : [];
  };
  const one = async (who: EntityId): Promise<MindCallResult> => {
    const level = input.levels[who] ?? "near";
    const e = own(state.entities, who);
    const name = e?.name ?? who;
    const base = { purpose: "mind" as const, phase, who: name, level };
    const vars = varsFor(world, state, who);
    const prompt = mindPrompt("mind", world, settings.minds, vars);
    if (!e) return { data: null, trace: { ...base, outcome: "failed", ms: 0, tokens: 0, prompt: prompt.source }, entry: { entity: who, name, level, status: "failed", reason: "they aren't in the world any more" } };
    if (input.signal.aborted) return { data: null, trace: { ...base, outcome: "failed", ms: 0, tokens: 0, prompt: prompt.source }, entry: { entity: who, name, level, status: "cancelled", reason: "the run stopped before they were asked" } };
    const kept = input.kept?.get(who);
    if (kept) return { data: kept, trace: { ...base, outcome: "recorded", ms: 0, tokens: 0, prompt: prompt.source }, entry: { entity: who, name, level, status: "recorded", ms: 0, tokens: 0 } };
    input.progress?.({ entity: who, name, level, status: "thinking" });
    const pinned = pinsOf(refs.get(who) ?? []);
    const scope: MindScope = { reg, world, state, who, memory, messages, hideJson: settings.hideJsonBlocks, reads, moment: input.moment, pinned, ...(history ? { history } : {}), ...(input.knowledge ? { knowledge: input.knowledge } : {}) };
    const report: MindContextReport = { pinned: [], activated: [] };
    const usage = { tokens: 0 };
    const failure = { reason: "" };
    const t0 = performance.now();
    const context = mindContext(scope, report);
    const reason = input.reasons?.[who] ?? input.moment.reason;
    const raw = await askMind(deps.ask, {
      kind: "mind",
      who,
      vars,
      template: ownMindPrompt("mind", world, settings.minds, vars)?.text ?? null,
      context,
      signal: input.signal,
      usage,
      failure,
      check: (answer) => mindData(reg, world, state, who, answer, input.moment, level, reason, settings.minds.lengths) !== null,
      classic: () => deps.steps.helperJson("mind", prompt.text, context, config, userId, input.signal, { guidance, usage, failure, spared: input.spared === true }),
    });
    const ms = Math.round(performance.now() - t0);
    // What the answer lost to the lengths it was told is said where the call's other cuts are, and in the host log.
    const cuts: MindCuts = {};
    const data = raw === null ? null : mindData(reg, world, state, who, raw, input.moment, level, reason, settings.minds.lengths, cuts);
    const cut = data === null ? null : cutsNote(cuts, settings.minds);
    if (cut !== null) deps.host.log("info", `[LumiRPEngine] mind for ${who}: ${cut}`, userId);
    const given = shownLore(report.pinned);
    const activated = shownLore(report.activated);
    const routineLeft = report.routine?.left ?? 0;
    const plansLeft = report.plans?.left ?? 0;
    const notes = [
      ...fitNote("Pinned lore", report.pinned, reads.pinned.tokens),
      ...fitNote("The lore the turn activated", report.activated, reads.activated.tokens),
      ...(routineLeft > 0 ? [`Their usual routine didn't all fit: ${routineLeft} line${routineLeft === 1 ? "" : "s"} left out, over the ${reads.routine.tokens} tokens a mind reads of it; raise that in Settings → Minds → What a mind reads.`] : []),
      ...(plansLeft > 0 ? [`Their plans didn't all fit: ${plansLeft} left out, over the ${reads.plans.tokens} tokens a mind reads of them; raise that in Settings → Minds → What a mind reads.`] : []),
      ...(cut !== null ? [cut] : []),
    ];
    const routine = report.routine?.given ?? 0;
    const plans = report.plans?.given ?? 0;
    const trace: MindCallTrace = { ...base, outcome: data === null ? "failed" : "recorded", ms, tokens: usage.tokens, prompt: prompt.source, ...(given.length > 0 ? { pinned: given } : {}), ...(activated.length > 0 ? { activated } : {}), ...(routine > 0 ? { routine } : {}), ...(plans > 0 ? { plans } : {}), ...(report.history ? { history: report.history } : {}), ...(notes.length > 0 ? { notes } : {}) };
    const why = data !== null ? null : raw !== null ? "the answer said nothing: no thoughts, intent or depiction" : failure.reason !== "" ? failure.reason : "the call failed";
    if (why !== null && !(input.signal.reason instanceof NotNeeded)) deps.host.log("warn", `[LumiRPEngine] mind for ${who}: ${why}`, userId);
    const entry: MindsRunEntry = {
      entity: who,
      name,
      level,
      status: data !== null ? "recorded" : input.signal.aborted ? "cancelled" : "failed",
      ...(why !== null ? { reason: why } : {}),
      ms,
      tokens: usage.tokens,
      ...(report.pinned.length > 0 ? { pinned: report.pinned.map((p) => ({ title: p.title, tokens: p.tokens, cut: p.cut, ...(p.left ? { left: true as const } : {}) })) } : {}),
    };
    return { data, trace, entry };
  };
  const results: MindCallResult[] = [];
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < input.who.length) {
      const i = next++;
      const who = input.who[i];
      if (who === undefined) continue;
      const r = await one(who);
      results[i] = r;
      input.progress?.(r.entry);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(input.concurrency ?? input.who.length, input.who.length)) }, lane));
  // Each checked against the state it will fold on: one that doesn't validate is dropped.
  const w = new Working(reg, world, state);
  const events: LedgerEvent[] = [];
  for (const r of results) {
    if (!r.data) continue;
    const event: LedgerEvent = { type: MINDS_EVENTS.mind, data: r.data as unknown as JsonObject };
    const rejection = w.apply(event);
    if (!rejection) {
      events.push(event);
      continue;
    }
    r.entry.status = "failed";
    r.entry.reason = `it didn't fit the world as it is now: ${rejection.reason}`;
    input.progress?.(r.entry);
  }
  return { events, traces: results.flatMap((r, i) => (traced(reg, world, state, input.who[i] ?? "") ? [r.trace] : [])), report: results.map((r) => r.entry) };
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
  /** What minds answered in a failed engine run from this same state (`RunMindsInput.kept`). */
  kept?: ReadonlyMap<EntityId, MindEventData>;
  /** The reply the turn replaces, a Regenerate's or a swipe's target (`RunMindsInput.replaces`). */
  replaces?: MessageId;
  /** Whether the chat tracks knowledge (`knowledgeOn`): recorded when it changes, and each mind reads what it holds. */
  knowledge?: boolean;
  /**
   * Smart persistence holds this turn's scene (`backend/agents/persist.ts`): each quiet Live mind
   * (`quietMind`) is kept, its last thoughts recorded again as this turn's with the reason `kept`,
   * and makes no call.
   */
  persist?: boolean;
}

/** The reason a mind Smart persistence kept is recorded with: the Minds section tells it as unchanged. */
export const KEPT_MIND_REASON = "kept";

/** A quiet Live mind's last thoughts, recorded again as this turn's (`KEPT_MIND_REASON`): where and at what level it is now, at this turn's clock. */
function keptMind(state: Readonly<WorldState>, pick: MindPick): MindEventData | null {
  const m = readCharacter(state, pick.entity).mind;
  if (!m) return null;
  return { entity: pick.entity, at: state.clock, place: placeOfEntity(state, pick.entity), level: pick.level, moment: "turn", reason: KEPT_MIND_REASON, monologue: m.monologue, depiction: m.depiction, intent: m.intent, reactions: [...m.reactions], mood: m.mood, interrupt: null, withheld: m.withheld };
}

/**
 * Whether the chat tracks knowledge, recorded when it changes (`minds.knowledge`, DESIGN §24.11):
 * only in a chat that holds some, so a chat that never tracked any folds as it did. Null when the
 * state already says so.
 */
export function knowledgeSwitch(state: Readonly<WorldState>, on: boolean, threshold: number): LedgerEvent | null {
  const slice = readSlice(state);
  if (slice.knowledge === undefined) return null;
  // The user's threshold, when it changed: the player screens read it from the chat's state, as they read everything.
  const sure = on && knowledgeThreshold(slice) !== threshold;
  return knowledgeTracked(slice) !== on || sure ? { type: MINDS_EVENTS.knowledge, data: { on, ...(sure ? { threshold } : {}) } } : null;
}

/**
 * The pre phase (DESIGN §24.1): whether the chat tracks knowledge, when that changed (§24.11), so
 * the turn's sections and screens read it as the user set it; then the round (every turn with minds
 * on, and once with them off after they were on), then, unless the turn is a timelapse, the minds the
 * scene, the ladder and the cadence call. A mind due but not called is recorded on the round with the
 * level it was due at. While nothing would read them (§24.3: the chat's feed switches the Minds
 * section off and no mind reads its last thoughts), only a GM's request is called; the rest are
 * recorded as due. Their calls fail no step (`RunMindsInput.spared`): the run tells from `report`
 * which minds didn't answer. While the chat tracks knowledge, each mind reads what it holds.
 */
export async function preMinds(deps: MindsDeps, input: PreMindsInput): Promise<RunMindsResult> {
  const settings = await deps.settings.get(input.userId);
  const on = mindsOn(settings);
  const switched = knowledgeSwitch(input.state, input.knowledge === true, settings.minds.knowledge.threshold);
  const tracking: LedgerEvent[] = switched ? [switched] : [];
  if (!on) return { events: [...tracking, ...(readSlice(input.state).on ? [{ type: MINDS_EVENTS.round, data: { at: input.state.clock, on: false } }] : [])], traces: [] };
  const round: LedgerEvent = { type: MINDS_EVENTS.round, data: { at: input.state.clock, on: true } };
  if (input.timelapse) return { events: [...tracking, round], traces: [] };
  const start = new Working(deps.registry, input.world, input.state);
  start.applyAll(tracking);
  const w = new Working(deps.registry, input.world, start.state);
  w.apply(round);
  const ctx = deps.registry.context(input.world, w.state);
  const texts = { user: input.user, reply: input.reply };
  const section = sectionsOf(input.world).find((s) => s.id === MINDS_SLOT);
  const read = settings.minds.reads.thoughts.on || (section !== undefined && feedOf(section, input.state).enabled !== false);
  const picks = pickMinds(ctx, fidelityOf(ctx, texts), texts, settings.minds).map((p) => (read || p.reason === "gm" ? p : { ...p, call: false }));
  const calls = picks.filter((p) => p.call);
  const passed = picks.filter((p) => !p.call);
  // The round keeps where each passed mind stood and the level it was due at, as a mind recorded now
  // would, and the minds called think on the state that holds it.
  const opened: LedgerEvent = passed.length === 0 ? round : { type: MINDS_EVENTS.round, data: { at: input.state.clock, on: true, levels: Object.fromEntries(passed.map((p) => [p.entity, { level: p.level, place: placeOfEntity(w.state, p.entity) }])) } };
  const thinking = opened === round ? w : new Working(deps.registry, input.world, start.state);
  if (thinking !== w) thinking.apply(opened);
  const levels: Record<EntityId, Fidelity> = {};
  const reasons: Record<EntityId, string> = {};
  for (const p of calls) {
    levels[p.entity] = p.level;
    reasons[p.entity] = p.reason;
  }
  // While Smart persistence holds the scene, each quiet Live mind keeps its last thoughts and makes no call.
  const kept = new Map(input.kept ?? []);
  if (input.persist) {
    for (const p of calls) {
      if (kept.has(p.entity) || !quietMind(ctx, p, texts)) continue;
      const copy = keptMind(thinking.state, p);
      if (copy) kept.set(p.entity, copy);
    }
  }
  // Each thinks for their own refresh reason; the moment itself is the player's message.
  const moment: MindMoment = { kind: "turn", at: thinking.state.clock, reason: "", user: input.user, reply: input.reply };
  const ran = await runMinds(deps, { chatId: input.chatId, userId: input.userId, world: input.world, state: thinking.state, who: calls.map((p) => p.entity), moment, levels, reasons, signal: input.signal, ...(input.guidance !== undefined ? { guidance: input.guidance } : {}), ...(kept.size > 0 ? { kept } : {}), ...(input.replaces !== undefined ? { replaces: input.replaces } : {}), ...(input.knowledge === true ? { knowledge: settings.minds.knowledge } : {}), phase: "pre", spared: true });
  return { events: [...tracking, opened, ...ran.events], traces: ran.traces, ...(ran.report ? { report: ran.report } : {}) };
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
  guidance?: { memory?: string; consolidate?: string; knowledge?: string };
  /** Whether the chat tracks knowledge (`knowledgeOn`: its own switch, else the user's): its seeding and knowledge step run, and telling is the knowledge step's alone. */
  knowledge?: boolean;
  /** What the reply's read found in it, in words, once it has: the knowledge step reads it, so it runs after the read. */
  read?: Promise<readonly string[]>;
}

/**
 * The post phase's input for a reply (`PostMindsInput`, but its signal and what its read found): the
 * reply's turn as its read has it (`at`: the world, the state the turn started from and the one the
 * reply was written in, and the turn's planned events), the reply and the player's message it
 * answers, the preset's guidance for the steps it runs, and whether the chat tracks knowledge. A
 * reply's own post phase, the memory a later turn owes it, and Test for the memory and knowledge
 * roles' texts build it so.
 */
export function postMindsInput(at: Pick<PostMindsInput, "world" | "start" | "state" | "pre">, input: Pick<PostMindsInput, "chatId" | "userId" | "messageId" | "user" | "reply"> & { guidance: { memory?: string; consolidate?: string; knowledge?: string }; knowledge: boolean }): Omit<PostMindsInput, "signal" | "read"> {
  const { guidance } = input;
  return { chatId: input.chatId, userId: input.userId, world: at.world, start: at.start, state: at.state, pre: at.pre, messageId: input.messageId, user: input.user, reply: input.reply, guidance: { memory: guidance.memory ?? "", consolidate: guidance.consolidate ?? "", knowledge: guidance.knowledge ?? "" }, knowledge: input.knowledge };
}

/** Who is in the POV's scene in `state` (`together`): everyone acting there but the POV, whether it sees them or not. */
export function presentWith(reg: Registry, world: WorldDoc, state: Readonly<WorldState>): EntityId[] {
  const here = placeOfEntity(state, world.pov);
  if (here === null) return [];
  return Object.keys(state.entities)
    .sort()
    .filter((id) => id !== world.pov && together(world, here, placeOfEntity(state, id)) && kindIs(reg, world, own(state.entities, id)?.kind ?? "", "person") && !isGone(state, id) && acts(world, state, id));
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

/**
 * The `memory` step's answer as event data, each text cut to its length and each list to its count
 * (`lengths`, Settings → Minds → Lengths, which the step was told), as `cuts` counts; what they told
 * reaches only `listeners`, who were with them for the turn (none while the chat tracks knowledge,
 * whose step is telling's only writer).
 */
export function memoryData(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, who: EntityId, raw: JsonValue, listeners: readonly EntityId[], lengths: Readonly<MindLengths>, cuts?: MindCuts): MemoryEventData | null {
  if (!isRecord(raw)) return null;
  const now = state.clock;
  // A list's items that say something (`text`), the first so many of them.
  const saying = (v: JsonValue | undefined, text: (item: JsonObject) => JsonValue | undefined, max: number, key: keyof MindCuts): JsonObject[] => firstCounted((Array.isArray(v) ? v : []).filter((x): x is JsonObject => isRecord(x) && str(text(x)).trim() !== ""), max, cuts, key);
  const notes: MindNote[] = saying(raw.notes, (n) => n.text, lengths.notes, "notes").map((n, i) => {
    const text = capCounted(str(n.text), lengths.note, cuts, "note");
    const salience = typeof n.salience === "number" && Number.isFinite(n.salience) ? Math.min(5, Math.max(1, Math.round(n.salience))) : 3;
    return { id: `n_${hashParts("minds.note", who, String(now), String(i), text).slice(0, 10)}`, text, salience, at: now };
  });
  const commitments: MindCommitment[] = saying(raw.commitments, (x) => x.text, lengths.commitments, "commitments").map((x, i) => {
    const text = capCounted(str(x.text), lengths.commitment, cuts, "commitment");
    const kind: CommitmentKind = (COMMITMENT_KINDS as readonly string[]).includes(str(x.kind)) ? (str(x.kind) as CommitmentKind) : "other";
    const withIds = [...new Set((Array.isArray(x.with) ? x.with : []).map((n) => personNamed(reg, world, state, str(n))).filter((n): n is EntityId => n !== null && n !== who))];
    return { id: `c_${hashParts("minds.commitment", who, String(now), String(i), text).slice(0, 10)}`, kind, with: withIds, text, due: localTime(world, now, str(x.due)), status: "open" as const, made: now, closed: null };
  });
  const open = new Set(readCharacter(state, who).commitments.filter((x) => x.status === "open").map((x) => x.id));
  const resolved = (Array.isArray(raw.resolved) ? raw.resolved : []).flatMap((r): MemoryEventData["resolved"] => (isRecord(r) && open.has(str(r.id)) && (r.status === "kept" || r.status === "broken" || r.status === "released") ? [{ id: str(r.id), status: r.status }] : []));
  // No telling is read while no one may be told (the chat tracks knowledge), so none is counted either.
  const told = (listeners.length === 0 ? [] : saying(raw.told, (t) => t.what, lengths.tolds, "tolds")).flatMap((t) => {
    const to = [...new Set((Array.isArray(t.to) ? t.to : []).map((n) => personNamed(reg, world, state, str(n))).filter((n): n is EntityId => n !== null && n !== who && listeners.includes(n)))];
    return to.length === 0 ? [] : [{ to, what: capCounted(str(t.what), lengths.told, cuts, "told") }];
  });
  const summary = capCounted(str(raw.summary), lengths.summary, cuts, "summary");
  return { entity: who, at: now, notes, commitments, resolved, plans: plansFrom(reg, world, state, who, raw.plans, lengths, cuts), told, summary: summary === "" ? null : summary };
}

/** How many characters' notes one turn folds at most: consolidation is upkeep, never the turn's work. */
const CONSOLIDATIONS_PER_TURN = 2;

/**
 * The notes of `id` due to fold into their summary at `now` (a consolidation's): the least salient
 * past the number kept, and every faded one; none while their last consolidation is under
 * `consolidate.periodDays` old. The classic memory step asks its own model call to fold them.
 */
export function notesToFold(state: Readonly<WorldState>, id: EntityId, now: number, memory: Pick<MindsMemoryConfig, "notes" | "salience" | "consolidate">): MindNote[] {
  const c = readCharacter(state, id);
  const last = c.consolidated ?? null;
  if (last !== null && now - last < memory.consolidate.periodDays * 1440) return [];
  const ranked = [...c.notes].sort((a, b) => salienceNow(a, now, memory) - salienceNow(b, now, memory) || a.at - b.at);
  const surplus = Math.max(0, c.notes.length - memory.notes.keep);
  return ranked.filter((n, i) => i < surplus || faded(n, now, memory));
}

/**
 * What the knowledge step gives a turn: everyone else's learnings as events, the player character's
 * own as changes, its calls' traces, the connection it ran on, and what it didn't take: how many it
 * refused, by why (and the limits it refused by, as the yield names them), and how many of its calls
 * gave no answer it takes.
 */
interface KnowledgeRan {
  events: LedgerEvent[];
  proposals: KnowledgeProposal[];
  traces: MindCallTrace[];
  connection: string | null;
  refused: Counts<KnowledgeRefusal>;
  failed: number;
  limits: Pick<KnowledgeSettings, "factsPerTurn" | "factsPerChat" | "learningsPerTurn">;
}

/**
 * The fact each lore id an answer gives names (`loreFactOf`: a world lore entry, a book entry or its
 * mark, by its short id too), for `checkKnowledge`. Only the ids the answer names that aren't a
 * fact's id already, each looked up once.
 */
export async function loreRefs(deps: Pick<MindsDeps, "loreEntry">, world: WorldDoc, userId: UserId, raw: JsonValue): Promise<Map<string, FactId>> {
  const out = new Map<string, FactId>();
  if (!isRecord(raw)) return out;
  const named = new Set<string>();
  const add = (v: JsonValue | undefined): void => {
    const id = typeof v === "string" ? v.trim().replace(/^\[([^[\]]+)\]$/, "$1").trim() : "";
    if (id !== "" && parseFactId(id) === null) named.add(id);
  };
  const items = (v: JsonValue | undefined): JsonObject[] => (Array.isArray(v) ? v.filter((x): x is JsonObject => isRecord(x)) : []);
  for (const l of items(raw.learned)) add(l.fact);
  for (const i of items(raw.inferred)) for (const ref of [i.fact, ...(Array.isArray(i.evidence) ? i.evidence : [])]) add(ref);
  for (const d of items(raw.doubted)) add(d.fact);
  for (const ref of named) {
    const fact = await loreFactOf(world, ref, async (id) => (await deps.loreEntry?.(userId, id)) ?? null);
    if (fact !== null) out.set(ref, fact);
  }
  return out;
}

/** What the knowledge step's calls are asked with: whose they are, their clock, the preset's guidance for the step, and the phase their traces name. */
interface KnowledgeAsk {
  userId: UserId;
  signal: AbortSignal;
  guidance: string;
  phase: MindCallTrace["phase"];
}

/**
 * The knowledge step's calls on `turn` (DESIGN §24.11), one per batch, at most `callsAtOnce` of them
 * under way at once (Settings → Minds → Knowledge). A call is asked once a place is free, and reads,
 * beside the facts in play, the facts the answers checked before it made (`knowledgeContext`), so it
 * names one of them by its id rather than making it again in its own words. Each answer is checked
 * (`checkKnowledge`) as it comes back, one at a time, on what the answers checked before it left: one
 * that says again in the same words (`claimKey`) a fact another made is that fact. At 1, each call is
 * asked once the one before it is checked, one after another. A learning that doesn't fit the state
 * is dropped, and the log says why each was.
 */
async function knowledgeCalls(deps: MindsDeps, settings: UserSettings, config: StepConfig, turn: KnowledgeTurn, batches: readonly (readonly EntityId[])[], ask: KnowledgeAsk): Promise<KnowledgeRan> {
  const { reg, world, state } = turn;
  const { userId, signal, guidance } = ask;
  const scene = settings.minds.knowledge.batch === "scene";
  const w = new Working(reg, world, state);
  const { factsPerTurn, factsPerChat, learningsPerTurn, callsAtOnce } = settings.minds.knowledge;
  const out: KnowledgeRan = { events: [], proposals: [], traces: [], connection: helperCallOf(config, settings.helper).connectionId ?? null, refused: {}, failed: 0, limits: { factsPerTurn, factsPerChat, learningsPerTurn } };
  const refused = (kind: KnowledgeRefusal, n = 1): void => {
    out.refused[kind] = (out.refused[kind] ?? 0) + n;
  };
  // The turn's limits hold across its calls: new facts, learnings and witnessed facts are counted for
  // the turn, not each call. Each call reads the facts the answers checked before it made, by id, and
  // one that names such a fact, or says it again in the same words, has its learners join those who hold it.
  const spent = knowledgeSpent();
  // The answers are checked one at a time, in the order they come back.
  let checks: Promise<void> = Promise.resolve();
  const call = async (batch: readonly EntityId[]): Promise<void> => {
    const who = scene ? "" : (own(state.entities, batch[0] ?? "")?.name ?? batch[0] ?? "");
    const vars = { ...varsFor(world, state, world.pov), character: who };
    const prompt = mindPrompt("knowledge", world, settings.minds, vars);
    const usage = { tokens: 0 };
    const t0 = performance.now();
    const context = signal.aborted ? "" : knowledgeContext(turn, batch, spent);
    const raw = signal.aborted
      ? null
      : await askMind(deps.ask, {
          kind: "knowledge",
          who: scene ? null : (batch[0] ?? null),
          vars,
          template: ownMindPrompt("knowledge", world, settings.minds, vars)?.text ?? null,
          context,
          signal,
          usage,
          failure: { reason: "" },
          check: isRecord,
          classic: () => deps.steps.helperJson("knowledge", prompt.text, context, config, userId, signal, { guidance, usage }),
        });
    const ms = Math.round(performance.now() - t0);
    checks = checks.then(async () => {
      const lore = raw === null ? null : await loreRefs(deps, world, userId, raw);
      const checked = raw === null ? null : checkKnowledge({ ...turn, state: w.state, ...(lore && lore.size > 0 ? { lore } : {}) }, batch, raw, spent);
      if (!checked && !signal.aborted) out.failed++;
      for (const why of checked?.refused ?? []) deps.host.log("info", `[LumiRPEngine] knowledge ${turn.messageId.slice(0, 8)}: refused ${why}`, userId);
      for (const [kind, n] of Object.entries(checked?.refusedAs ?? {})) refused(kind as KnowledgeRefusal, n);
      for (const event of checked?.events ?? []) {
        const rejection = w.apply(event);
        if (rejection) {
          deps.host.log("info", `[LumiRPEngine] knowledge ${turn.messageId.slice(0, 8)}: dropped a learning (${rejection.code}: ${rejection.reason})`, userId);
          refused("state");
        } else out.events.push(event);
      }
      out.proposals.push(...(checked?.proposals ?? []));
      // What the answer's new facts lost to the longest claim it was told, said as a mind's cuts are.
      const cut = checked ? cutsNote(checked.cuts, settings.minds) : null;
      if (cut !== null) deps.host.log("info", `[LumiRPEngine] knowledge ${turn.messageId.slice(0, 8)}: ${cut}`, userId);
      // A scene's call thinks for no one; one person's is listed only when the player may know of them.
      if (scene || traced(reg, world, state, batch[0] ?? "")) out.traces.push({ purpose: "knowledge", phase: ask.phase, who, level: null, outcome: checked ? "recorded" : "failed", ms, tokens: usage.tokens, prompt: prompt.source, ...(cut !== null ? { notes: [cut] } : {}) });
    });
    await checks;
  };
  // Each place takes the next call once its last answer is checked.
  let next = 0;
  const place = async (): Promise<void> => {
    for (let batch = batches[next++]; batch !== undefined; batch = batches[next++]) await call(batch);
  };
  const places = Number.isSafeInteger(callsAtOnce) && callsAtOnce > 1 ? Math.min(callsAtOnce, batches.length) : 1;
  await Promise.all(Array.from({ length: places }, place));
  // A new fact no one learned is made of nothing: counted once the calls are done, since a later call may learn it.
  for (const f of spent.unlearned.values()) deps.host.log("info", `[LumiRPEngine] knowledge ${turn.messageId.slice(0, 8)}: a new fact no one learned, not made: "${f.claim}"`, userId);
  if (spent.unlearned.size > 0) refused("unlearned", spent.unlearned.size);
  return out;
}

/** The lore pinned to the knowledge step (DESIGN §24.5), read once for its calls. */
async function knowledgePins(deps: MindsDeps, settings: UserSettings, world: WorldDoc, state: Readonly<WorldState>, userId: UserId): Promise<string[]> {
  return pinnedLines({ reg: deps.registry, world, state, reads: settings.minds.reads, pinned: await readPins(deps.host, world, pinsFor(world, null, undefined, ["knowledge"]), userId) }, "knowledge");
}

/**
 * The knowledge step after the reply (DESIGN §24.11), on `state` (the reply's, with the turn's
 * presence and seeding in it), once the read is in: one call per batch (`knowledgeBatches`), for
 * everyone who could perceive the turn.
 */
async function knowledgeStep(deps: MindsDeps, input: PostMindsInput, settings: UserSettings, state: Readonly<WorldState>, presence: KnowledgeTurn["presence"]): Promise<KnowledgeRan | null> {
  const config = mindsStepConfig(settings.modelUse, "knowledge");
  if (!config) return null;
  const { registry: reg } = deps;
  const { world, userId } = input;
  const read = input.read ? await input.read.catch((): readonly string[] => []) : [];
  const happened = [...witnessLines(reg, world, state, world.pov, input.pre, Number.POSITIVE_INFINITY), ...read];
  const pinned = await knowledgePins(deps, settings, world, state, userId);
  const turn: KnowledgeTurn = { reg, world, state, before: input.state, messageId: input.messageId, user: input.user, reply: input.reply, presence, happened, settings: settings.minds.knowledge, memory: effectiveMemory(world, settings.minds), hideJson: settings.hideJsonBlocks, pinned, named: (name) => personNamed(reg, world, state, name) };
  const guidance = input.guidance?.knowledge ?? deps.presets.last(userId).guidance.knowledge ?? "";
  return knowledgeCalls(deps, settings, config, turn, knowledgeBatches(turn), { userId, signal: input.signal, guidance, phase: "post" });
}

export interface PreKnowledgeInput {
  chatId: ChatId;
  userId: UserId;
  world: WorldDoc;
  /** The state the turn plans from. */
  state: Readonly<WorldState>;
  /** The player's message, which everyone with the player character heard. */
  messageId: MessageId;
  user: string;
  /** Whom it is about: the people a decision of the plan turns on. Only those who heard the message are asked about. */
  who: readonly EntityId[];
  signal: AbortSignal;
  guidance?: string;
}

/**
 * The knowledge step before the plan (AGENT-LOOP-PLAN §5, §7.2): what the people a decision of the
 * plan turns on learned from the player's message, which they heard, so each decision reads what
 * they hold now. The message is all that has happened yet: it is said where the player character
 * is, and everyone there heard it. Its answer is checked as after the reply, for them alone; their
 * learnings come back as events, which the turn records ahead of its decisions as the user's `learn`
 * mode keeps them on `connection`, the step's own (null where its route names none, as after the
 * reply). Nothing when the step is off, the message says nothing, or none of them heard it.
 */
export async function preKnowledge(deps: MindsDeps, input: PreKnowledgeInput): Promise<{ events: LedgerEvent[]; traces: MindCallTrace[]; connection: string | null }> {
  const settings = await deps.settings.get(input.userId);
  const config = mindsStepConfig(settings.modelUse, "knowledge");
  const { registry: reg } = deps;
  const { world, state, userId } = input;
  const heard = presentWith(reg, world, state);
  const who = input.who.filter((id, i) => heard.includes(id) && input.who.indexOf(id) === i);
  if (!config || who.length === 0 || input.user.trim() === "") return { events: [], traces: [], connection: null };
  const presence: KnowledgeTurn["presence"] = { said: { msg: input.messageId, at: state.clock, place: placeOfEntity(state, world.pov), who: heard, saw: [] }, met: null, left: [] };
  const pinned = await knowledgePins(deps, settings, world, state, userId);
  const turn: KnowledgeTurn = { reg, world, state, before: state, messageId: input.messageId, user: input.user, reply: "", presence, happened: [], settings: settings.minds.knowledge, memory: effectiveMemory(world, settings.minds), hideJson: settings.hideJsonBlocks, pinned, named: (name) => personNamed(reg, world, state, name), asked: who };
  const batches = settings.minds.knowledge.batch === "character" ? who.map((id) => [id]) : [who];
  const ran = await knowledgeCalls(deps, settings, config, turn, batches, { userId, signal: input.signal, guidance: input.guidance ?? deps.presets.last(userId).guidance.knowledge ?? "", phase: "pre" });
  return { events: ran.events, traces: ran.traces, connection: ran.connection };
}

/**
 * The post phase's opening, before any call (DESIGN §24.4, §24.11): while minds think, who heard the
 * turn and who the POV met in it, and what each saw happen; while the chat tracks knowledge, what the
 * world authors that the chat doesn't hold yet (`seedKnowledge`). Its events come first; the state
 * they leave is what the knowledge step and memory read. Null when neither runs.
 */
export interface PostOpening {
  events: LedgerEvent[];
  state: Readonly<WorldState>;
  presence: KnowledgeTurn["presence"];
}

export async function postOpening(deps: MindsDeps, input: Omit<PostMindsInput, "signal" | "read">): Promise<PostOpening | null> {
  const { registry: reg } = deps;
  const { world, state, userId } = input;
  const settings = await deps.settings.get(userId);
  const minds = mindsOn(settings);
  const knowing = input.knowledge === true;
  if (!minds && !knowing) return null;
  const presence = turnPresence(reg, world, input);
  const w = new Working(reg, world, state);
  const events: LedgerEvent[] = [];
  const record = (event: LedgerEvent): void => {
    if (!w.apply(event)) events.push(event);
  };
  if (minds) for (const data of presence.met ? [presence.said, presence.met] : [presence.said]) record({ type: MINDS_EVENTS.presence, data });
  if (knowing) for (const event of await seedKnowledge(deps.host, { reg, world, state: w.state, userId })) record(event);
  return { events, state: w.state, presence };
}

/**
 * Who the knowledge step counts as there for the turn: the opening's presence, with whoever heard the
 * player's message but isn't with the player character at the turn's end counted as left partway,
 * even when the player character stayed, so they witness none of it (the memory step reads `left` as
 * those the POV left behind).
 */
function knowledgePresence(reg: Registry, input: Pick<PostMindsInput, "world" | "state">, presence: KnowledgeTurn["presence"]): KnowledgeTurn["presence"] {
  const there = presentWith(reg, input.world, input.state);
  return { ...presence, left: [...new Set([...presence.left, ...presence.said.who.filter((id) => !there.includes(id))])] };
}

/**
 * The memory step for each who heard the turn at a level the user chose, from what was written, and
 * beside it `consolidate` for those whose notes overflow or fade, at most once per period each, while
 * something reads what it folds; recorded on `w` through `record`, the memories in turn, then the
 * consolidations. While the chat tracks knowledge the memory step records no telling.
 */
async function remember(deps: MindsDeps, input: PostMindsInput, settings: UserSettings, presence: KnowledgeTurn["presence"], w: Working, record: (event: LedgerEvent) => void, traces: MindCallTrace[]): Promise<void> {
  const { registry: reg } = deps;
  const { world, state, userId } = input;
  const { said, met, left } = presence;
  const minds = mindsOn(settings);
  const knowing = input.knowledge === true;
  const memory = effectiveMemory(world, settings.minds);
  // Their level as they heard it: where the message was said.
  const levels = new Map(fidelityOf(reg.context(world, input.start), { user: input.user, reply: input.reply }).map((s) => [s.entity, s.level]));
  const memoryConfig = minds ? mindsStepConfig(settings.modelUse, "memory") : null;
  const remembering = memoryConfig ? said.who.filter((id) => settings.minds.memoryLevels.includes(levels.get(id) ?? "background")) : [];
  const reads = settings.minds.reads;
  const messages = remembering.length > 0 ? await chatMessages(deps, input.chatId, userId) : [];
  const moment: MindMoment = { kind: "turn", at: state.clock, reason: "after the reply", user: input.user, reply: input.reply };
  // Recent chat, while minds read it, is the chat before the turn just written, which each memory reads
  // as the turn: before its reply and its own message, so a reply sent after a reply keeps the one before.
  const history = reads.history.on && remembering.length > 0 ? chatBefore(messages, true, input.messageId) : undefined;
  // The lore pinned to the memory step (DESIGN §24.5), its only lore, read once for everyone it remembers for.
  const memoryPins = remembering.length > 0 ? await readPins(deps.host, world, pinsFor(world, null, undefined, ["memory"]), userId) : [];
  const remembered = new Map(
    remembering.map((id) => {
      const task = (async (): Promise<MemoryEventData | null> => {
        const vars = varsFor(world, w.state, id);
        const prompt = mindPrompt("memory", world, settings.minds, vars, knowing);
        const scope: MindScope = { reg, world, state: w.state, who: id, memory, messages, hideJson: settings.hideJsonBlocks, reads, moment, pinned: memoryPins, ...(history ? { history } : {}) };
        const usage = { tokens: 0 };
        const t0 = performance.now();
        // Their listeners: who heard the turn with them, and, unless the POV left them, whoever it met;
        // no one while the chat tracks knowledge, whose step records telling.
        const listeners = knowing ? [] : left.includes(id) ? said.who : [...said.who, ...(met?.who ?? [])];
        const context = input.signal.aborted ? "" : memoryContext(scope, { user: input.user, reply: input.reply, left: left.includes(id) });
        const guidance = input.guidance?.memory ?? deps.presets.last(userId).guidance.memory ?? "";
        const raw = input.signal.aborted
          ? null
          : await askMind(deps.ask, {
              kind: "memory",
              ...(knowing ? { knowing: true as const } : {}),
              who: id,
              vars,
              template: ownMindPrompt("memory", world, settings.minds, vars)?.text ?? null,
              context,
              signal: input.signal,
              usage,
              failure: { reason: "" },
              check: (answer) => memoryData(reg, world, w.state, id, answer, listeners, settings.minds.lengths) !== null,
              classic: () => deps.steps.helperJson("memory", prompt.text, context, memoryConfig, userId, input.signal, { guidance, usage }),
            });
        const cuts: MindCuts = {};
        const data = raw === null ? null : memoryData(reg, world, w.state, id, raw, listeners, settings.minds.lengths, cuts);
        const cut = data === null ? null : cutsNote(cuts, settings.minds);
        if (cut !== null) deps.host.log("info", `[LumiRPEngine] memory for ${id}: ${cut}`, userId);
        if (traced(reg, world, state, id)) traces.push({ purpose: "memory", phase: "post", who: own(state.entities, id)?.name ?? id, level: levels.get(id) ?? "near", outcome: data ? "recorded" : "failed", ms: Math.round(performance.now() - t0), tokens: usage.tokens, prompt: prompt.source, ...(cut !== null ? { notes: [cut] } : {}) });
        return data;
      })();
      return [id, task] as const;
    }),
  );
  // Consolidation, the minds' upkeep: notes past the number kept, and the faded, folded into the
  // summary. It runs only while something reads what it folds, a memory call (the memory step on for
  // some level) or a mind (its summary or notes), and beside the memories, on the notes and summary
  // each had before this turn. Someone whose memory rewrites their summary has theirs asked again
  // once it has, so it folds into that summary.
  const consolidateConfig = minds && memory.consolidate.enabled ? mindsStepConfig(settings.modelUse, "consolidate") : null;
  const folding = consolidateConfig !== null && ((memoryConfig !== null && settings.minds.memoryLevels.length > 0) || reads.summary.on || reads.memory.on);
  const now = w.state.clock;
  const due = folding
    ? Object.keys(readSlice(w.state).chars)
        .sort()
        .flatMap((id) => {
          const fold = notesToFold(w.state, id, now, memory);
          return fold.length > 0 ? [{ id, fold }] : [];
        })
        .slice(0, CONSOLIDATIONS_PER_TURN)
    : [];
  const consolidatePins = due.length > 0 ? await readPins(deps.host, world, pinsFor(world, null, undefined, ["consolidate"]), userId) : [];
  // A consolidation reads the same recent chat as the memories, read now if no memory read the chat.
  const before = reads.history.on && due.length > 0 ? (history ?? chatBefore(await chatMessages(deps, input.chatId, userId), true, input.messageId)) : undefined;
  const consolidate = async (id: EntityId, fold: readonly MindNote[], at: Readonly<WorldState>, signal: AbortSignal): Promise<{ event: LedgerEvent | null; trace: MindCallTrace | null }> => {
    const vars = varsFor(world, at, id);
    const prompt = mindPrompt("consolidate", world, settings.minds, vars);
    const asked = consolidateContext({ reg, state: at, world, who: id, reads, pinned: consolidatePins, hideJson: settings.hideJsonBlocks, ...(before ? { history: before } : {}) }, fold);
    const usage = { tokens: 0 };
    const t0 = performance.now();
    const guidance = input.guidance?.consolidate ?? deps.presets.last(userId).guidance.consolidate ?? "";
    const raw = signal.aborted
      ? null
      : await askMind(deps.ask, {
          kind: "consolidate",
          who: id,
          vars,
          template: ownMindPrompt("consolidate", world, settings.minds, vars)?.text ?? null,
          context: asked,
          signal,
          usage,
          failure: { reason: "" },
          check: (answer) => isRecord(answer) && str(answer.summary).trim() !== "",
          classic: () => deps.steps.helperJson("consolidate", prompt.text, asked, consolidateConfig, userId, signal, { guidance, usage }),
        });
    const cuts: MindCuts = {};
    const summary = isRecord(raw) ? capCounted(str(raw.summary), settings.minds.lengths.summary, cuts, "summary") : "";
    const cut = summary === "" ? null : cutsNote(cuts, settings.minds);
    if (cut !== null) deps.host.log("info", `[LumiRPEngine] consolidation for ${id}: ${cut}`, userId);
    const trace: MindCallTrace | null = traced(reg, world, state, id) ? { purpose: "consolidate", phase: "post", who: own(state.entities, id)?.name ?? id, level: levels.get(id) ?? "background", outcome: summary === "" ? "failed" : "recorded", ms: Math.round(performance.now() - t0), tokens: usage.tokens, prompt: prompt.source, ...(cut !== null ? { notes: [cut] } : {}) } : null;
    return { event: summary === "" ? null : { type: MINDS_EVENTS.consolidated, data: { entity: id, at: now, notes: fold.map((n) => n.id), summary } }, trace };
  };
  const consolidations = due.map(({ id, fold }) => {
    const stop = new AbortController();
    const asked = consolidate(id, fold, w.state, AbortSignal.any([input.signal, stop.signal]));
    const rewritten = (remembered.get(id) ?? Promise.resolve(null)).then((data) => {
      if (!data?.summary) return false;
      stop.abort(new NotNeeded("their memory rewrote their summary this turn, so the notes fold into that"));
      return true;
    });
    return { id, asked, rewritten };
  });
  for (const data of await Promise.all(remembered.values())) {
    if (!data) continue;
    // Applied in turn, so a shared plan the first memory recorded is already the others' when theirs records.
    record({ type: MINDS_EVENTS.memory, data: { ...data, plans: unheldPlans(w.state, data.entity, data.plans) } as unknown as JsonObject });
  }
  const folded = await Promise.all(
    consolidations.map(async ({ id, asked, rewritten }) => {
      if (!(await rewritten)) return asked;
      await asked;
      const fold = notesToFold(w.state, id, now, memory);
      return fold.length > 0 ? consolidate(id, fold, w.state, input.signal) : null;
    }),
  );
  for (const done of folded) {
    if (done?.trace) traces.push(done.trace);
    if (done?.event) record(done.event);
  }
}

/** What the knowledge step learned, as the post phase gives it: what everyone but the player character learned that still fits `w`, the player character's own as changes, and what it didn't take, a learning that no longer fits among it. */
function learnedOn(w: Working, knew: KnowledgeRan): NonNullable<RunMindsResult["knowledge"]> {
  const events = knew.events.filter((event) => !w.apply(event));
  const unfit = knew.events.length - events.length;
  const refused = unfit > 0 ? { ...knew.refused, state: (knew.refused.state ?? 0) + unfit } : knew.refused;
  return { proposals: knew.proposals, events, connection: knew.connection, refused, failed: knew.failed };
}

/**
 * An agent turn's knowledge step after the reply (DESIGN §24.11, AGENT-LOOP-PLAN §7.8), on its own:
 * on the opening's state, once the read is in, apart from the turn's memory, which its pipeline may
 * leave to the next turn. It records nothing itself: its learnings come back as `knowledge`.
 */
export async function postKnowledge(deps: MindsDeps, input: PostMindsInput, opening: PostOpening): Promise<RunMindsResult> {
  if (input.knowledge !== true) return { events: [], traces: [] };
  const settings = await deps.settings.get(input.userId);
  const knew = await knowledgeStep(deps, input, settings, structuredClone(opening.state), knowledgePresence(deps.registry, input, opening.presence));
  if (!knew) return { events: [], traces: [] };
  return { events: [], traces: knew.traces, knowledge: learnedOn(new Working(deps.registry, input.world, opening.state), knew) };
}

/**
 * An agent turn's memory of a reply (DESIGN §24.4), on its own: the memories, then consolidation, on
 * the opening's state. Its events are those alone: the opening's are the reply's own turn's.
 */
export async function postMemory(deps: MindsDeps, input: PostMindsInput, opening: PostOpening): Promise<RunMindsResult> {
  const settings = await deps.settings.get(input.userId);
  const w = new Working(deps.registry, input.world, opening.state);
  const events: LedgerEvent[] = [];
  const traces: MindCallTrace[] = [];
  const record = (event: LedgerEvent): void => {
    if (!w.apply(event)) events.push(event);
  };
  await remember(deps, input, settings, opening.presence, w, record, traces);
  return { events, traces };
}

/**
 * The post phase (DESIGN §24.4, §24.11): the opening (who heard the turn and who the POV met in it,
 * and the seeding while the chat tracks knowledge), then the memories and consolidation, with the
 * knowledge step beside them once the read is in. What everyone but the player character learned is
 * checked after the turn's memories and kept apart, as a change the reply made, which the user's
 * `learn` mode may refuse; the player character's own learning comes back as changes.
 */
export async function postMinds(deps: MindsDeps, input: PostMindsInput): Promise<RunMindsResult> {
  const opening = await postOpening(deps, input);
  if (!opening) return { events: [], traces: [] };
  const settings = await deps.settings.get(input.userId);
  // On the state as the opening left it, apart from what the memories and consolidation add while it waits for the read.
  const knowledge = input.knowledge === true ? knowledgeStep(deps, input, settings, structuredClone(opening.state), knowledgePresence(deps.registry, input, opening.presence)) : Promise.resolve(null);
  const w = new Working(deps.registry, input.world, opening.state);
  const events = [...opening.events];
  const traces: MindCallTrace[] = [];
  const record = (event: LedgerEvent): void => {
    if (!w.apply(event)) events.push(event);
  };
  await remember(deps, input, settings, opening.presence, w, record, traces);
  const knew = await knowledge;
  if (!knew) return { events, traces };
  traces.push(...knew.traces);
  return { events, traces, knowledge: learnedOn(w, knew) };
}

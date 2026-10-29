// The backend composition root (ARCHITECTURE §2): builds the registry from the packs, wires the
// ledger to the host, and implements the turn hooks (the engine run's steps and the sections it writes
// into the world's book before the reply, extract before the commit, chips after it) and the state push.

import { hashParts } from "../shared/hash";
import type { ActionId, ChatId, ChipId, EntityId, InterruptClass, MessageId, RevisionId, UserId, WorldId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { heldBy } from "../shared/finance";
import { hasOwn, isRecord } from "../shared/json";
import type { ChatRun, EventRef, GenerationKind, HeldWrite, LedgerEvent, PendingTurn, PostEvent, Rec, RefusedWrite, TimelapseTarget } from "../shared/ledger";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import { neutralizeMacros } from "../shared/macros";
import type { ExtractionType, StepConfig, UserSettings } from "../shared/settings";
import { EXTRACTION_TYPES, helperCallOf, recentOf, stepConfigOf, stepLoreOf } from "../shared/settings";
import type { ChipAction, ChipInput, ContextGeneration, ContextView, LoreStepTrace, StateView } from "../shared/state-view";
import type { ActionDef, AdjudicationDef, LoreEntryDef, ParamDef, SectionTemplate, StepPurpose, WorldDoc } from "../shared/world";
import { formatMoney, offersAction } from "../shared/world";
import { fieldNoun } from "../shared/words";
import { LORE_AUDIENCE } from "../shared/lore";
import { isMindPurpose, KNOWLEDGE_CHANGES, MINDS_EVENTS, MINDS_SLOT, type MindCallTrace, type MindEventData } from "../shared/minds";
import { firedTimeout, TimeoutFired, TIMEOUTS, timerMs } from "../shared/timeouts";
import { mindsOn, mindsStepConfig, postMinds, preMinds, runMinds, type MindsDeps, type PreMindsInput, type RunMindsResult } from "./minds";
import { runSkip, type BeatMinds, type SkipRun } from "./skip";
import { planSkip } from "./skip-plan";
import { mindLines } from "../packs/minds/core/section";
import { namedInText, singlesOut } from "../packs/minds/core/fidelity";
import { matchCatalog, transferCents, type PaidFrom } from "../packs/economy/core/index";
import { itemName, stem } from "../packs/economy/core/items";
import { holderOf } from "../packs/gear/core/model";
import { needsJudge, outcomeChoices, policyFor, policyOf, type Verdict } from "../engine/adjudication";
import type { EngineTurnPlan, QueueStop } from "../engine/turn";
import { timelapseIntent } from "../engine/turn";
import { checkOf } from "../engine/checks";
import { applyTimeAdvance, nextDayPart, parseOverrides, parseTarget, resolveTarget, typedSpan, type SpanAnchor } from "../engine/time";
import { EXTERNAL_ACCOUNT_PREFIX } from "../engine/events";
import { boundProposal } from "../engine/bounds";
import { resolveFix } from "../engine/edits";
import { calendarOf, clockOfStamp, dateAt, formatClock, formatHHMM, formatTimeOfDay, placeOffset, weekdayName } from "../engine/calendar";
import type { ChainMessage } from "../engine/ledger/chain";
import { LedgerFold } from "../engine/ledger/fold";
import type { LedgerCore, LedgerEnv } from "../engine/ledger/journal";
import { activeText, isTombstoned, ownMessage } from "../engine/ledger/path";
import { optionalQuery, own } from "../engine/pack-kit";
import type { PackDef, ReadContext } from "../engine/registry";
import { createRegistry, type Registry } from "../engine/registry-impl";
import { createRng } from "../engine/rng";
import { readPass } from "../engine/read-pass";
import { claimsOf } from "../engine/realism";
import { kindIs, placeOfEntity, placeWithin } from "../engine/scope";
import { placeKey, placeMenu, placeSaid } from "../engine/place-names";
import { heardPlace } from "../engine/narration-channels";
import type { EntityState, WorldState } from "../engine/state";
import { actionOdds, companionCandidates, findAction, outsideOf, paramCandidates, playsAsRoleplay, type Resolution } from "../engine/resolve";
import { allowedSkills, inferredOf, inferredRead, rolledByTry, skillSources, TRY_ACTION, tryJudged } from "../engine/inferred";
import type { InterpretOutput, QueuedAction } from "../engine/steps";
import { checkAnswer } from "../engine/tracks";
import { loreReadable, namesHiddenOrSecretLore, secretLoreNames } from "../engine/lore";
import { pinsFor, type PinnedText } from "../engine/lore-pins";
import { hiddenNameCheck, namesHidden, povMayKnow } from "../engine/player-events";
import { canSeeEntity, canSeePlace, findLeaks, loreGateReader, playerTrack, povPlace, shownTrackId, unrevealedSecrets, unseenPlaceNames } from "../engine/visibility";
import { feedOf, renderersOf } from "../engine/feed";
import { answerParams, answerWords, expectedAnswers, openPuzzle, ownAnswer, saysAmount } from "../packs/story/core/index";
import { resolveUsualMoves, usualRoutineForExtract } from "../packs/castlife/core/usual";
import { dayPlan, type DayPlan } from "../packs/castlife/core/index";
import { Working } from "../engine/working";
import type { GenerateAs, PresetCard, ResultBodies, TemplateInfo } from "../shared/protocol";
import { Agents, type BuildInfo, thisBuild } from "./agents";
import { AgentAccounts } from "./agents/provider";
import { EngineBook, narratorRules, sectionsOf, sectionTokens } from "./book";
import { DEFAULT_SECTIONS } from "../shared/sections";
import type { PromptTexts } from "../shared/prompts";
import type { SecretMarkWording } from "../shared/secret-marks";
import { markWording, PromptSets, sourceTexts, turnPromptSet } from "./prompts";
import { ChatPrefs } from "./chat-prefs";
import { ChatAgentMeta } from "./chat-agent-meta";
import { ChatMetaQueue } from "./chat-meta-queue";
import { BlobStore } from "./agents/blobs";
import { Sessions } from "./agents/sessions";
import { Sweep } from "./agents/sweep";
import { ChatKnowledge, knowledgeOn, narratorView } from "./chat-knowledge-prefs";
import { ChipStore, type StoredChip } from "./chips";
import type { DryRun, HostPort } from "./host";
import { LedgerService, OPEN_CHATS_CAP, toChain, type Delivered, type PreOutcome, type TurnContext, type TurnHooks, type TurnInputs } from "./ledger-io";
import type { TrimReport } from "./memory-budget";
import { MessageCache } from "./message-cache";
import { StatePush } from "./push";
import { effectiveMode, recordOutcome, SettingsStore } from "./settings-store";
import { startMarkersFrom } from "./start-markers";
import { claimFor, outOfHand } from "./claims";
import { StepLore, ToolSupport, type LoreInputs, type LookupTransport } from "./lore-steps";
import { pinReader } from "./lore-pins";
import { liveLore } from "./book-lore";
import { worldInfoVerdict, type WorldInfoGate } from "./wi-interceptor";
import { interpretCatalog, interpretScene, timelapseEntry, tryEntry } from "./interpret-context";
import { checkQuestion, inferredChip, inferredOutcome } from "./inferred-words";
import { playerReason, unplayedWords } from "./requirement-words";
import { buildSections } from "./sections-build";
import { routineAsks } from "./routine-ask";
import { CallMeter, dedupeProposals, extract, interpret, NotNeeded, saidPayMethod, Steps, type InterpretContext, type InterpretRead, type ReadAction, type ThingSort } from "./steps";
import { PlanNotes, type PlanLines } from "./plan-notes";
import { StagedActions } from "./staged";
import { InspectorLog, type InspectorRecord } from "./inspector-log";
import { JsonHiding, readableReply } from "./json-hiding";
import { GUIDANCE_PREFIX, GUIDANCE_TARGETS, NARRATOR_OUTLET, outletOf, PresetBinding, type Guidance, type PresetConfig } from "./preset-binding";
import { presetCaveats, type PresetCaveat } from "./preset-lint";
import { applyProposals, applyRead, type EnginePipeline, type PlanProse, type PreparedRead, type ProposalOutcome, type ReadChip, type ReadStep, TurnBridge, type UnfitAction } from "./turn-model";
import { agentsActHere, factLines, handedCash, judge, noFacts, npcChoose, paidOutside, payeeOf, phaseBudget, planFacts, presentNames, promptedEffects, promptedText, puzzleAnswer, renderTemplate, runsOf, safeVars, slotVars, type EarlierMessage, type StepBudget, tiesOf, unfitRef, type PlanStart, type SignalFacts, type StepRun, type Tie, type UnfitRef } from "./turn-steps";
import { buildView, clockMinutes, notWorldView, palette, recentLines, replyFailedChip, TIMELAPSE_ACTION } from "./view";
import { actionWords, compactSpan, editedText, spanText } from "../engine/action-words";
import { WorldStore } from "./worlds";
import { Diagnostics, type DiagAt } from "./diagnostics";
import { CANNOT_STOP, DIAG_RING, STEP_LABEL, type DiagPhase } from "../shared/diagnostics";
import { RETENTION_DEFAULTS } from "../shared/stores";
// The steps by their Settings names, apart from the activity line's in-flight labels above.
import { STEP_LABEL as STEP_NAME } from "../shared/steps";

export interface RuntimeOptions {
  host: HostPort;
  packs: readonly PackDef[];
  pipeline: EnginePipeline;
  /** World templates by id (Modern US starter and friends). */
  templates?: Record<string, (id: string, name: string) => WorldDoc>;
  /** What each template is (`lre.world templates`); a template without an entry here isn't listed. */
  templateInfo?: readonly TemplateInfo[];
  /** This build and where its agent kit is (DESIGN §23): from what the build defined, unless a test names one. */
  build?: BuildInfo;
}

/** The connection key D4 learning counts under when a step runs on the user's active connection. */
export const ACTIVE_CONNECTION = "active";

/** What one phase's step lore shares (`Runtime.lorePhase`). */
interface LorePhase {
  phase: "pre" | "post";
  /** Where its traces go: the generation, or the read. */
  key: string;
  userId: UserId;
  world: WorldDoc;
  state: WorldState;
  budget: StepBudget;
  /** The user's default connection. */
  active: string;
  /** What the player said this turn, with the reply after it: words the player has seen. */
  said: string;
  /** The active preset's style and rules for each helper (DESIGN §6.8). */
  guidance: Guidance;
  /** The lore pinned where the POV is and the places holding it (DESIGN §24.5), read once for the phase's steps. */
  pinned: PinnedText[];
  /** The lore pinned to each helper step (§24.5), read once for the phase: each of its calls reads it first, whatever its lore policy. */
  steps: Partial<Record<StepPurpose, PinnedText[]>>;
}

/** The model calls of the minds' post phase (`postMinds`): their diagnostics step takes them as its own, beside the read's. */
const MINDS_POST_CALLS: readonly StepPurpose[] = ["memory", "consolidate", "knowledge"];


/** Refusals of a change the state already holds (a fact already known, a life state already so): nothing to show or tell. */
const ALREADY_SO: ReadonlySet<string> = new Set(["already_known", "already"]);

/**
 * What each reference of a read's change names (DESIGN §11): someone, a place, a thing, or a `knows`
 * fact, which may be any of them. A thing changing hands or bought is words (`FREE_TEXT`), and a
 * routine's refusals are unseen, so neither is one.
 */
type RefRole = "person" | "place" | "thing" | "fact";
const REF_ROLES: Readonly<Record<string, Readonly<Record<string, RefRole>>>> = {
  location: { entity: "person", place: "place" },
  knows: { who: "person", fact: "fact" },
  regard: { from: "person", to: "person" },
  give: { from: "person", to: "person" },
  transfer: { from: "person", to: "person" },
  purchase: { payer: "person" },
  condition: { who: "person", entity: "person" },
  quantity: { entity: "person", item: "thing" },
  life: { entity: "person" },
  take: { entity: "person", item: "thing" },
  drop: { entity: "person", item: "thing" },
  use_up: { entity: "person", item: "thing" },
  wear: { entity: "person", item: "thing" },
  lose: { entity: "person", item: "thing", by: "person" },
  item_condition: { entity: "person", item: "thing" },
  spawn: { place: "place" },
};

/**
 * Fields a change words as the reply put them, never a reference: a thing handed over or bought may be
 * one the world doesn't track yet, so one the POV doesn't know of, hidden or not, is such words too.
 */
const FREE_TEXT: Readonly<Record<string, readonly string[]>> = { give: ["item"], purchase: ["item", "name"] };

/**
 * How a change names, in each role, what the POV doesn't know: alike whether it is hidden or nowhere
 * in the world. Only a value written as an id (`ID_SHAPED`) reads so, since an id is what the engine
 * would turn into a name; words the reply wrote ("The ferry stops at nine", "Old Mill") read as
 * written, the same in every world.
 */
const UNKNOWN_PHRASE: Readonly<Record<RefRole, string>> = { person: "someone you don't know", place: "a place you don't know", thing: "something you don't know", fact: "something you don't know" };

/** A value written as an id rather than in words: one lowercase token, as ids are (`danny_okafor`). */
const ID_SHAPED = /^[a-z0-9][a-z0-9_:.-]*$/;

/** Why a change naming what the POV doesn't know keeps nothing. */
const UNKNOWN_REASON = "the engine keeps only whom and what you know of";

/**
 * The most a host token count may be, as a multiple of the section's padded estimate (which stays at
 * or above the real tokenizers); a larger count is ignored and the estimate stands in.
 */
const TOKEN_COUNT_CAP = 4;
/**
 * Engine runs whose lore, read live from their World Info books, is kept (`liveLores`): only a run's
 * own phases read it again, and a world's lore is its largest part (a 1.7 MB world's is 0.74 MB), so
 * a few runs' are kept and an older run's lore is read from the books again if asked for.
 */
export const LIVE_LORES_KEPT = 8;
/** What Settings → Caveats' timer gives when the Preset check timeout (`caveatsMs`) fires first. */
const LATE: unique symbol = Symbol("late");

/** The chat's run as its metadata holds it (DESIGN §4.1), or null for a chat that plays no world. */
export function readRun(meta: JsonObject): ChatRun | null {
  const raw = meta[LEDGER_NAMESPACE];
  if (!isRecord(raw) || raw.v !== 1 || typeof raw.worldId !== "string" || typeof raw.revision !== "string" || typeof raw.runSeed !== "string") return null;
  return { v: 1, worldId: raw.worldId, revision: raw.revision, runSeed: raw.runSeed, startedAt: typeof raw.startedAt === "number" ? raw.startedAt : 0 };
}

/** The world as the POV may know it, for model prompts that list entities and places (`interpret`, `extract`). */
function povWorld(reg: Registry, world: WorldDoc, state: Readonly<WorldState>): WorldDoc {
  return {
    ...world,
    entities: Object.fromEntries(Object.entries(world.entities).filter(([id]) => povMayKnow(reg, world, state, id))),
    places: Object.fromEntries(Object.entries(world.places).filter(([id]) => canSeePlace(reg, world, state, world.pov, id))),
  };
}

/**
 * The entities an extraction reads against, only those the POV may know: 30 of them, the scene's
 * people and things first and money accounts last, so a wallet's cards never crowd out who is in
 * the room.
 */
function prefixEntities(reg: Registry, world: WorldDoc, state: WorldState): { id: EntityId; e: EntityState }[] {
  const here = placeOfEntity(state, world.pov);
  const rank = (id: EntityId, kind: string): number => (kind === "account" ? 2 : here !== null && placeOfEntity(state, id) === here ? 0 : 1);
  return Object.entries(state.entities)
    .filter(([id]) => povMayKnow(reg, world, state, id))
    .map(([id, e], i) => ({ id, e, i, rank: rank(id, e.kind) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .slice(0, 30);
}

/**
 * The prefix an extraction reads against (`prefixEntities`). A thing names who holds it (one the POV
 * may know), so a narrated hand-over reads from the right giver; anyone's place is named only when
 * the POV can see it, so extract never learns of a place the POV hasn't heard of. Places are offered
 * beside it, by name (`placeMenu`).
 */
export function prefixSummary(reg: Registry, world: WorldDoc, state: WorldState): JsonValue {
  const pov = state.entities[world.pov];
  const people: JsonObject = {};
  for (const { id, e } of prefixEntities(reg, world, state)) {
    const holder = holderOf(state, id);
    const place = typeof e.fields.place === "string" && canSeePlace(reg, world, state, world.pov, e.fields.place) ? e.fields.place : null;
    people[id] = { name: e.name, kind: e.kind, place, ...(holder !== null && povMayKnow(reg, world, state, holder) ? { holder } : {}) };
  }
  return { clock: state.clock, pov: world.pov, povName: pov?.name ?? world.pov, cents: state.accounts[world.pov] ?? null, entities: people };
}

/**
 * Events in the order the turn's record holds them, the order an Undo finds them in (`refsOf`): what
 * an earlier action's activity met while a later queued action played comes after that one's events.
 */
function inRecordOrder(record: readonly LedgerEvent[], events: readonly LedgerEvent[]): LedgerEvent[] {
  const at = new Map<string, number>();
  record.forEach((e, i) => {
    const key = JSON.stringify(e);
    if (!at.has(key)) at.set(key, i);
  });
  return [...events].sort((a, b) => (at.get(JSON.stringify(a)) ?? 0) - (at.get(JSON.stringify(b)) ?? 0));
}

/**
 * Whether every entity and place a proposal names is one the POV may know; a read leaves out one
 * that isn't. A value is matched as the channels read it, trimmed (and lowercased when only that
 * names something), so `" vera "` is Vera. Two exceptions: the place a `knows` proposal teaches the
 * POV (`heardPlace`), since hearing of a `known_by` or `discoverable` place is how it comes to know
 * it, and words for a thing handed over or bought (`FREE_TEXT`), which name nothing of the world's
 * the POV doesn't know of, so a hidden thing's id there reads as one no world has.
 */
export function proposalKnown(p: JsonObject, reg: Registry, world: WorldDoc, state: Readonly<WorldState>): boolean {
  const named = (s: string): string => {
    const t = s.trim();
    return hasOwn(state.entities, t) || hasOwn(world.places, t) ? t : t.toLowerCase();
  };
  const ok = (v: JsonValue | undefined, depth: number): boolean => {
    if (typeof v === "string") {
      const id = named(v);
      return hasOwn(state.entities, id) ? povMayKnow(reg, world, state, id) : hasOwn(world.places, id) ? canSeePlace(reg, world, state, world.pov, id) : true;
    }
    if (depth > 3) return true;
    if (Array.isArray(v)) return v.every((x) => ok(x, depth + 1));
    if (isRecord(v)) return Object.values(v).every((x) => ok(x as JsonValue, depth + 1));
    return true;
  };
  const free = typeof p.type === "string" ? (own(FREE_TEXT, p.type) ?? []) : [];
  return Object.entries(p).every(([k, v]) => k === "type" || free.includes(k) || (k === "fact" && heardPlace({ registry: reg, world, state }, p) !== null) || ok(v, 0));
}

/** What a read's labels and receipts name things against: the registry, the world and the state. */
type PovView = Pick<ReadContext, "registry" | "world" | "state">;

/**
 * Who or what a change's reference names, as the POV may know it (DESIGN §11): itself, an entity it
 * may be told of (by id in any case, else by name as `placeKey` compares names), and for a place or a
 * fact, a place it can see (`placeSaid`). Null when it names no one and nothing the POV knows,
 * whether that is hidden or nowhere in the world: the two read alike.
 */
function knownRef(view: PovView, role: RefRole, said: string): { id: string; name: string } | null {
  const { registry: reg, world, state } = view;
  const t = said.trim();
  if (role === "place" || role === "fact") {
    const place = placeSaid(reg, world, state, t);
    if (place !== null && canSeePlace(reg, world, state, world.pov, place)) return { id: place, name: own(world.places, place)?.name ?? place };
    if (role === "place") return null;
  }
  const key = placeKey(t);
  const byId = hasOwn(state.entities, t) ? t : hasOwn(state.entities, t.toLowerCase()) ? t.toLowerCase() : null;
  const id = byId !== null ? (povMayKnow(reg, world, state, byId) ? byId : null) : (Object.keys(state.entities).find((e) => key !== "" && placeKey(own(state.entities, e)?.name ?? "") === key && povMayKnow(reg, world, state, e)) ?? null);
  return id === null ? null : { id, name: id === world.pov ? "you" : (own(state.entities, id)?.name ?? id) };
}

/**
 * Whether a change names, in one of its references (`REF_ROLES`), anyone or anything the POV doesn't
 * know (`knownRef`), save the place a `knows` teaches it (`heardPlace`).
 */
function namesUnknown(view: PovView, p: JsonObject): boolean {
  const roles = typeof p.type === "string" ? own(REF_ROLES, p.type) : undefined;
  if (!roles) return false;
  return Object.entries(roles).some(([field, role]) => {
    const v = p[field];
    return typeof v === "string" && v.trim() !== "" && knownRef(view, role, v) === null && !(role === "fact" && heardPlace(view, p) !== null);
  });
}

/**
 * Whether a narrated give hands the borrower what this turn lent them, or something inside it (the
 * glovebox of a lent truck): that's the loan itself, not a second change. A give of anything else
 * stays, even to the same person in the same turn. Keys aren't linked to what they open, so keys
 * handed over with a lend are their own proposal (DESIGN §22).
 */
export function lentAlong(p: JsonObject, pre: readonly LedgerEvent[], state: Readonly<WorldState>): boolean {
  if (p.type !== "give" || typeof p.item !== "string" || typeof p.to !== "string") return false;
  const idOf = (s: string): string | null => {
    const t = s.trim();
    if (hasOwn(state.entities, t)) return t;
    const named = Object.keys(state.entities).filter((id) => state.entities[id]?.name.toLowerCase() === t.toLowerCase());
    return named.length === 1 ? (named[0] ?? null) : null;
  };
  const item = idOf(p.item);
  const to = idOf(p.to);
  if (!item || !to) return false;
  const inside = (outer: string): boolean => {
    let cur = state.entities[item]?.relations.find((r) => r.type === "in")?.to;
    for (let guard = 0; cur && guard < 64; guard++) {
      if (cur === outer) return true;
      cur = state.entities[cur]?.relations.find((r) => r.type === "in")?.to;
    }
    return false;
  };
  return pre.some((e) => e.type === "link" && e.rel === "uses" && e.from === to && (e.to === item || inside(e.to)));
}

/**
 * Whether a narrated transfer tells again a movement of money this turn's own actions made (DESIGN
 * §9.5): a withdrawal, a deposit, a move between accounts or a payment. That movement is a posting
 * among the turn's pre-reply events, and the transfer is it told again when both sides name it and
 * the narration's amount is near what moved. A side names a posting's side when it is an account
 * the posting drew on (`from`) or paid into (`to`), a party holding one, or a party whose outside
 * account it moved. Near is the purchase rule's: within ±25% of what left the one side or reached
 * the other (a machine's fee makes them differ), or no amount stated. Applying it would move the
 * money twice; a transfer that differs (another amount, another account) stays.
 */
export function movedAlong(p: JsonObject, pre: readonly LedgerEvent[], state: Readonly<WorldState>): boolean {
  if (p.type !== "transfer" || typeof p.from !== "string" || typeof p.to !== "string") return false;
  const from = p.from.trim();
  const to = p.to.trim();
  if (from === "" || to === "") return false;
  const cents = transferCents(p);
  const near = (v: number): boolean => !Number.isFinite(cents) || Math.abs(Math.abs(cents) - v) <= 0.25 * v;
  const names = (side: string, account: string): boolean => account === side || account === `${EXTERNAL_ACCOUNT_PREFIX}${side}` || heldBy(state.entities, account, side);
  return pre.some((e) => {
    if (e.type !== "post") return false;
    const left = e.lines.reduce((sum, l) => sum + (l.amount < 0 && names(from, l.account) ? -l.amount : 0), 0);
    const reached = e.lines.reduce((sum, l) => sum + (l.amount > 0 && names(to, l.account) ? l.amount : 0), 0);
    return left > 0 && reached > 0 && (near(left) || near(reached));
  });
}

/** A batch of writes that landed (P2), and those held that were refused as their window closed, with why; with the chat's core and the messages the ledger operation that settled them read. */
export interface LandedWrites {
  chatId: ChatId;
  userId: UserId;
  core: LedgerCore;
  observed: ChainMessage[];
  writes: HeldWrite[];
  refused: RefusedWrite[];
}

/** A narrated purchase measured against the turn's own Buy: told again (dropped), maybe told again (an "Also bought …?" chip), or not the Buy at all (null). */
export type Along = "retold" | "unsure" | null;

/** Words that make a narrated purchase another one: "another coffee", "a second coffee", "one more coffee", "an extra one". */
const ANOTHER = /\b(?:another|second|third|extra|(?:one|two|three|some|a few) more)\b/i;

/** Words after "for" that name someone else: pronouns and the people one buys for (a person's name counts too). */
const FOR_SOMEONE: Readonly<Record<string, true>> = { him: true, her: true, them: true, friend: true, wife: true, husband: true, partner: true, son: true, daughter: true, kid: true, child: true, mom: true, dad: true, mother: true, father: true, brother: true, sister: true, boyfriend: true, girlfriend: true, date: true, guest: true };

/** Qualifiers that rule each other out, by class (a red apple isn't a green one, a small coffee isn't a large one, an iced one isn't hot), keyed by their stems. */
const CONTRAST: Readonly<Record<string, number>> = Object.fromEntries(
  [
    ["red", "orange", "yellow", "green", "blue", "purple", "pink", "brown", "black", "white", "grey", "silver", "gold", "golden", "beige", "navy", "teal"],
    ["small", "medium", "large", "big", "little", "tiny", "huge", "tall", "grande", "venti", "regular", "mini", "jumbo"],
    ["hot", "iced", "cold", "warm"],
    ["single", "double", "triple"],
  ].flatMap((words, cls) => words.map((w) => [stem(w), cls])),
);

/** Whether a narrated purchase is the player character's own (or paid by something they own): only those can tell their Buy again. */
function povPays(p: JsonObject, world: WorldDoc, state: Readonly<WorldState>): boolean {
  const payer = typeof p.payer === "string" ? p.payer.trim() : "";
  return payer === "" || payer === world.pov || !hasOwn(state.entities, payer) || heldBy(state.entities, payer, world.pov);
}

/** The turn's own Buys, from its pre-reply events: each "Bought …" posting or history line, with its name, quantity and what it charged. */
function buysIn(pre: readonly LedgerEvent[]): { name: string; qty: number; cents: number }[] {
  const out: { name: string; qty: number; cents: number }[] = [];
  for (const e of pre) {
    const memo = e.type === "economy.txn" && "data" in e ? e.data.memo : e.type === "post" ? e.memo : undefined;
    if (typeof memo !== "string" || !memo.startsWith("Bought ")) continue;
    // What it charged: a posting's incoming side, or what left the payer's own accounts in its history line.
    const lines = e.type === "post" ? e.lines : "data" in e && Array.isArray(e.data.lines) ? e.data.lines : [];
    const cents = lines.reduce((sum: number, l) => sum + (isRecord(l) && typeof l.amount === "number" && (e.type === "post" ? l.amount > 0 : l.amount < 0) ? Math.abs(l.amount) : 0), 0);
    out.push({ name: memo.slice("Bought ".length).replace(/\s×\d+$/, ""), qty: Number(/\s×(\d+)$/.exec(memo)?.[1] ?? 1), cents });
  }
  return out;
}

/** Whether `words` (after "for") name someone other than the player character: a pronoun, a relation, or a word of a person's name. */
function forSomeone(words: readonly string[], ctx: ReadContext): boolean {
  const { world, state } = ctx;
  return words.some(
    (w) =>
      FOR_SOMEONE[w] === true ||
      Object.entries(state.entities).some(([id, e]) => id !== world.pov && kindIs(ctx.registry, world, e.kind, "person") && e.name.toLowerCase().split(/[^a-z0-9]+/).some((part) => part.length > 1 && stem(part) === w)),
  );
}

/** Whether the narration says, next to the item's main noun, that it's another one ("another coffee", "a coffee for Danny"). */
function toldAsAnother(narration: string, head: string, ctx: ReadContext): boolean {
  const words = narration.toLowerCase().replace(/['’]/g, "").match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
  return words.some((w, i) => {
    if (stem(w) !== head) return false;
    if (ANOTHER.test(words.slice(Math.max(0, i - 3), i).join(" "))) return true;
    return words[i + 1] === "for" && forSomeone(words.slice(i + 2, i + 4).map(stem), ctx);
  });
}

/** The catalog row `economy.buy` prices `item` as where the player character is: the row it names by id, else the one its words name there (`matchCatalog`). Null when none does. */
function rowAt(ctx: ReadContext, item: string, category: string): string | null {
  const rows = ctx.tables.get("economy.catalog")?.rows ?? {};
  return hasOwn(rows, item) ? item : matchCatalog(ctx, item, placeOfEntity(ctx.state, ctx.world.pov), category);
}

/**
 * A narrated purchase measured against the Buy this turn's own actions made (DESIGN §11 Confirm
 * chips). Only the same thing can be the Buy told again: the same main noun, as `itemName` reads
 * names ("milk" for the bought "Milk, whole", "brass lantern" for "old brass lantern"; "lantern
 * oil" is oil, not the lantern). Even then it's another purchase when its own words say so
 * ("another coffee", "a second one", "coffee for Danny"), when it names a different quantity, or a
 * qualifier that rules the Buy's out (green for red, large for small, iced for hot), in the Buy's
 * charged name or the words the player typed for it (`items`). It is the Buy told again
 * (`retold`) when one name's words hold all of the other's, the player's own words for the Buy
 * included ("large black coffee" after a typed "large coffee" charged as "Drip coffee, 12 oz,
 * cafe"), or it is priced as the Buy's own row where it was bought; and any price the narration
 * states is the Buy's: within ±25% of what it charged, of a price the player typed for a Buy
 * (`typed`, minor units), or of anywhere in its catalog row's (or category's) range, since a
 * catalogued Buy is charged the catalog's price ("you pay $3 for the coffee" after a typed $3
 * coffee charged $5.38). Anything else of the same noun may be either (`unsure`): other qualifiers
 * ("leather card holder" for "credit card holder"), a price off the Buy's, or a narration that
 * says "another" beside it. So may another noun whose catalog row is a sibling of a Buy's (the same
 * group in the price table: "coffee" priced as Drip coffee after a Buy of Latte, the reply's words
 * for the latte), unless its words or the narration's make it another one or it names another
 * quantity. Only a purchase the player character (or something they own) pays for.
 */
export function boughtAlong(p: JsonObject, pre: readonly LedgerEvent[], ctx: ReadContext, typed: readonly number[] = [], narration = "", items: readonly string[] = []): Along {
  const { world } = ctx;
  if (p.type !== "purchase" || typeof p.item !== "string" || !povPays(p, world, ctx.state)) return null;
  const said = itemName(p.item);
  if (!said) return null;
  const stated = typeof p.price === "number" && Number.isFinite(p.price) ? Math.abs(p.price) : null;
  const near = (v: number): boolean => stated === null || Math.abs(stated - v) <= 0.25 * v;
  const another = ANOTHER.test(`${p.item} ${typeof p.name === "string" ? p.name : ""}`) || (said.trailing?.word === "for" && forSomeone(said.trailing.words, ctx));
  const buys = buysIn(pre);
  const typedNames = items.flatMap((item) => itemName(item) ?? []);
  const rows = ctx.tables.get("economy.catalog")?.rows ?? {};
  const row = rowAt(ctx, p.item, typeof p.category === "string" ? p.category : "");
  const rowDef = row === null ? undefined : own(rows, row);
  let verdict: Along = null;
  let sameNoun = false;
  for (const buy of buys) {
    const bought = itemName(buy.name);
    if (!bought || bought.head !== said.head) continue;
    sameNoun = true;
    if (another) continue;
    if (typeof p.qty === "number" && p.qty !== buy.qty) continue;
    // The player's own words for a Buy of this noun say what kind it was where the charged row's name doesn't ("large" for a drip coffee).
    const typedOwn = typedNames.filter((n) => n.head === bought.head);
    const words = new Set([...bought.words, ...typedOwn.flatMap((n) => [...n.words])]);
    const contrast = [...said.words].some((w) => CONTRAST[w] !== undefined && !words.has(w) && [...words].some((b) => b !== w && CONTRAST[b] === CONTRAST[w]));
    if (contrast) continue;
    const holds = [...said.words].every((w) => words.has(w)) || [...bought.words].every((w) => said.words.has(w)) || typedOwn.some((n) => [...n.words].every((w) => said.words.has(w))) || (rowDef !== undefined && rowDef.name === buy.name);
    const inBand = (): boolean => {
      const band = stated === null ? null : optionalQuery(ctx, "economy.bought_band")?.(ctx, buy.name, buy.qty, world.pov);
      return !!band && stated !== null && stated >= 0.75 * band.min && stated <= 1.25 * band.max;
    };
    const priced = near(buy.cents) || typed.some(near) || inBand();
    if (holds && priced && !toldAsAnother(narration, said.head, ctx)) return "retold";
    verdict = "unsure";
  }
  if (sameNoun || another || toldAsAnother(narration, said.head, ctx)) return verdict;
  // Siblings are rows of one group in the price table: the narrated purchase's row, and a
  // catalogued Buy's, which carries its own row's name.
  const group = rowDef?.category;
  if (typeof group !== "string" || group === "") return null;
  return buys.some((buy) => (typeof p.qty !== "number" || p.qty === buy.qty) && Object.values(rows).some((r) => r.name === buy.name && r.category === group)) ? "unsure" : null;
}

/**
 * A narrated purchase that names several things ("coffee and bran muffin", "a coffee, a muffin and a
 * bagel") one of which is the turn's own Buy: the Buy's part is dropped, and every other part is a
 * purchase of its own, priced on its own (a price the narration gave was for them together). A part
 * is the Buy as `boughtAlong` holds one: one name's words hold the other's, the player's own words
 * for it (`items`) included, or it is priced as the Buy's own row where it was bought. A purchase
 * that holds no part of the Buy stays whole ("fish and chips").
 */
export function splitAlongBuy(p: JsonObject, pre: readonly LedgerEvent[], ctx: ReadContext, items: readonly string[] = []): JsonObject[] {
  if (p.type !== "purchase" || typeof p.item !== "string" || !povPays(p, ctx.world, ctx.state)) return [p];
  const parts = p.item
    .split(/\s*(?:,|&|\band\b|\bplus\b)\s*/i)
    .map((part) => part.trim())
    .filter((part) => itemName(part) !== null);
  const buys = buysIn(pre);
  const typedNames = items.flatMap((item) => itemName(item) ?? []);
  const rows = ctx.tables.get("economy.catalog")?.rows ?? {};
  const isBuy = (part: string): boolean => {
    const n = itemName(part);
    if (!n) return false;
    // The part's own row, without the whole purchase's category, which may be another part's.
    const row = rowAt(ctx, part, "");
    const rowName = row === null ? undefined : own(rows, row)?.name;
    return buys.some((buy) => {
      const b = itemName(buy.name);
      if (!b || b.head !== n.head) return false;
      const typedOwn = typedNames.filter((t) => t.head === b.head);
      const words = new Set([...b.words, ...typedOwn.flatMap((t) => [...t.words])]);
      return [...n.words].every((w) => words.has(w)) || [...b.words].every((w) => n.words.has(w)) || typedOwn.some((t) => [...t.words].every((w) => n.words.has(w))) || rowName === buy.name;
    });
  };
  if (parts.length < 2 || !parts.some(isBuy)) return [p];
  const { price: _price, qty: _qty, name: _name, ...rest } = p;
  return parts.filter((part) => !isBuy(part)).map((item) => ({ ...rest, item }));
}

/**
 * Where the reply leaves the POV (`extract`'s `where`, DESIGN §9.4) as their move there, when the
 * engine has them elsewhere: a reply can take a move as given without telling it ("at the counter
 * with Marcus" while the engine has the POV at the market), and no change would say the story and the
 * world have parted. It is a guess, which the read only offers. None when the engine has them there
 * or inside it, when the turn's own events moved them (the player's own action this turn put them
 * there, and the player's directives outrank what the story takes as given, DESIGN D36), or when a
 * narrated move of theirs already says where. The place is given by id or by name (`placeSaid`), and
 * is one the POV can see: any other is no guess the player could make.
 */
function replyPlace(reg: Registry, where: string | null, narrated: readonly JsonObject[], context: ReadInput): JsonObject[] {
  const { world, state } = context;
  const here = placeOfEntity(state, world.pov);
  const to = placeSaid(reg, world, state, where ?? "");
  if (here === null || to === null || !canSeePlace(reg, world, state, world.pov, to) || placeWithin(world, here, to) || placeOfEntity(context.start, world.pov) !== here) return [];
  if (narrated.some((p) => p.type === "location" && (typeof p.entity !== "string" || p.entity.trim() === world.pov))) return [];
  return [{ type: "location", entity: world.pov, place: to }];
}

/** What an extraction reads against: the state, its world, the record's seed and its pre-reply events. */
export interface ReadInput {
  state: WorldState;
  world: WorldDoc;
  seed: string;
  /** The seed the commit reads the reply with (`commitContext`, `continueContext` or `readContext`), so a chip's events are the record's own and Undo and Pay another way find them. */
  read: string;
  pre: LedgerEvent[];
  /** The state before `pre`: where the player's message was said, and who heard it (DESIGN §24.4). */
  start: WorldState;
  /** The Journal's latest turn lines before the reply (`{{recent}}`). */
  recent: string[];
}

/** What a turn's Timelapse offers are sized from (`turnOffers`). */
interface TurnOffersInput {
  chatId: ChatId;
  userId: UserId;
  messageId: MessageId;
  swipeId: number;
  kind: GenerationKind;
  core: LedgerCore;
  observed: ChainMessage[];
  bridge: TurnBridge;
  rec: Rec | undefined;
  plan: EngineTurnPlan | undefined;
  /** The words of the turn's own message (`ownMessage`), "" when it has none. */
  userText: string;
  /** The POV's hold a span the player's words spent keeps (`holdOf`). */
  hold: JsonObject;
  /** The chips the reply's read made itself, beside the swipe's stored ones. */
  read: readonly ReadChip[];
}

/** The Timelapse chip for a narrated time skip that can't apply inside the turn (DESIGN §9.4), with every interrupt class at `note`. */
function skipAheadChip(id: string, at: { messageId: MessageId; swipeId: number }, target: TimelapseTarget, reason: "over_cap" | "unit_cap"): StoredChip {
  return {
    id,
    kind: "timelapse_offer",
    ...at,
    label: "The narration skipped ahead — run it as a timelapse?",
    detail: reason === "unit_cap" ? "Too much happens in between to run it inside the turn." : "Longer than a turn can cover.",
    actions: [{ id: "timelapse", label: "Run timelapse", style: "primary" }],
    expires: "next_send",
    payload: { target: JSON.parse(JSON.stringify(target)) as JsonValue, allNote: true },
  };
}

/** Why a timelapse stopped, as the stop chip says it. */
const STOP_LABEL: Record<InterruptClass, string> = {
  invitation: "an invitation",
  bill: "a bill",
  decline: "a declined payment",
  incident: "an incident",
  quest: "a quest event",
  rule: "a world rule",
  arrival: "someone arrived",
  overdue: "an overdue loan",
  needs: "a need",
  weather: "a weather alert",
};

function trimMap<K, V>(map: Map<K, V>, cap = 64): void {
  while (map.size > cap) {
    const first = map.keys().next();
    if (first.done) return;
    map.delete(first.value);
  }
}

/** Sets `key` as the newest entry and evicts the oldest past `cap` (no unbounded per-chat maps). */
function lruSet<K, V>(map: Map<K, V>, key: K, value: V, cap: number): void {
  map.delete(key);
  map.set(key, value);
  trimMap(map, cap);
}

/** The minds an engine run got answers from, under the key of what that run was made from. */
interface AnsweredMinds {
  key: string;
  minds: ReadonlyMap<EntityId, MindEventData>;
}

/**
 * The minds a later run of the same turn takes instead of asking them again (DESIGN §5.1), under
 * the key of what they were made from: a failed run's answers, or those a run that waits on the
 * player started, as they come in, with the stop that ends them once the turn won't take them.
 */
interface KeptMinds {
  key: string;
  minds: Promise<ReadonlyMap<EntityId, MindEventData>>;
  stop?: AbortController;
}

/** A run's pre-phase minds under way: whether they are a timelapse's (the round alone), and their own stop. */
interface ThinkingMinds {
  timelapse: boolean;
  task: Promise<RunMindsResult>;
  stop: AbortController;
}

/** Each mind that answered, from a run's events: what a Retry of the run keeps (DESIGN §5.1). */
function mindsAnswered(events: readonly LedgerEvent[]): Map<EntityId, MindEventData> {
  const minds = new Map<EntityId, MindEventData>();
  for (const e of events) if (e.type === MINDS_EVENTS.mind && typeof e.data.entity === "string") minds.set(e.data.entity, e.data as unknown as MindEventData);
  return minds;
}

/** Moves `from`'s value to `to` (a prepared turn's records, once its generation takes it). */
function rekey<V>(map: Map<string, V>, from: string, to: string): void {
  const value = map.get(from);
  if (value === undefined) return;
  map.delete(from);
  map.set(to, value);
}

/**
 * A Re-run's source (DESIGN §6.12): the nearest swipe of its message holding a live record, at or
 * before the one it was made from (`rerunOf`, the one that showed as its swipe was added, record or
 * not) or, for a turn journaled without one, at or before its own; none for a turn that replaces no
 * recorded one (a retried reply), and never a later swipe.
 */
function rerunSource(core: LedgerCore, observed: readonly ChainMessage[], plan: PendingTurn): { messageId: MessageId; swipeId: number } | undefined {
  if (plan.messageId === null || plan.swipeId === null) return undefined;
  const target = core.chain(observed).find((m) => m.id === plan.messageId);
  if (!target) return undefined;
  const from = plan.rerunOf?.messageId === target.id ? Math.min(plan.rerunOf.swipeId, plan.swipeId) : plan.swipeId;
  for (let s = from; s >= 0; s--) {
    const rec = target.ledger?.swipes[String(s)];
    if (rec && !isTombstoned(core.journal.tombstones, target.id, rec)) return { messageId: target.id, swipeId: s };
  }
  return undefined;
}

function signalWithin(signal: AbortSignal, ms: number): AbortSignal {
  return ms > 0 ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : signal;
}

export class Runtime implements TurnHooks {
  readonly host: HostPort;
  /** Each chat's messages, read whole once and kept current from the host's events (DESIGN §9.6). */
  private readonly messages: MessageCache;
  readonly registry: Registry;
  readonly worlds: WorldStore;
  readonly settings: SettingsStore;
  readonly chips: ChipStore;
  /** Planned-turn lines by seed, for Re-narrate after a restart. */
  readonly planNotes: PlanNotes;
  readonly book: EngineBook;
  /** The texts each turn's narrator prompt was made from, by hash (DESIGN §6.12): what a Re-narrate may be sent again. */
  readonly promptSets: PromptSets;
  readonly meter: CallMeter;
  /** The action each chat has staged for the player's next message (DESIGN §11). */
  readonly staged: StagedActions;
  /** Staged actions being recorded on the message that takes them, by `user \0 chat`: a turn reads its message's action once it has landed. */
  private readonly taking = new Map<string, Promise<void>>();
  /** The inspector's history and delivery badges per chat. */
  readonly inspector: InspectorLog;
  /** How the player chose to see each chat (the map's display mode): presentation, beside the chat. */
  readonly chatPrefs: ChatPrefs;
  /** Each chat's turn among LRE's writes of its metadata, one queue for every writer of it (`chat-meta-queue.ts`). */
  readonly chatMeta = new ChatMetaQueue();
  /** What each chat chose for knowledge tracking and the narrator's knowledge, from its metadata (`chat-knowledge-prefs.ts`). */
  readonly chatKnowledge: ChatKnowledge;
  readonly steps: Steps;
  /** Connections seen refusing the lore tools (DESIGN §5.4). */
  readonly toolSupport: ToolSupport;
  readonly ledger: LedgerService;
  /** The JSON regex scripts, each world chat's and the user's unwraps (DESIGN §6.7). */
  readonly jsonHiding: JsonHiding;
  /** What the active preset says: section outlets, helper guidance, narrator rules (DESIGN §6.8). */
  readonly presets: PresetBinding;
  readonly push: StatePush;
  /** Each chat's diagnostics ring and the in-flight activity line (DESIGN §6.9). */
  readonly diag: Diagnostics;
  /** The agent stores' blobs (DESIGN §4.4): workspace files, session segments and summaries, agent call texts. */
  readonly blobs: BlobStore;
  /** The main agent's session, read along each chat's chain from the blobs its records name (DESIGN §4.4). */
  readonly sessions: Sessions;
  /** Each chat's agent metadata: the learned area's index and the GM assistant's thread (DESIGN §4.4). */
  readonly chatAgents: ChatAgentMeta;
  /** Removes the blobs nothing references once their retention has passed, never during a turn (DESIGN §4.4). */
  readonly sweep: Sweep;
  /** The outside MCP servers' check-ins and the update notice (DESIGN §23). */
  readonly agents: Agents;
  /** Each user's agent accounts with their connections: throttles, and the acceptance runs' guard and ceilings (AGENT-LOOP-PLAN §12). */
  readonly agentAccounts: AgentAccounts;
  readonly templates: Record<string, (id: string, name: string) => WorldDoc>;
  readonly templateInfo: readonly TemplateInfo[];
  private readonly pipeline: EnginePipeline;
  /** Runs by `user \0 chat`. */
  private readonly runs = new Map<string, ChatRun | null>();
  private readonly bridges = new Map<ChatId, TurnBridge>();
  private readonly settingsCache = new Map<UserId, UserSettings>();
  /** Each user's `turnSettingsKey`, kept against the settings revision it was made from. */
  private readonly turnSettings = new Map<UserId, { revision: number; key: string }>();
  /**
   * The mark wording of the turn each chat's book holds (DESIGN §6.12), from the guard's write
   * (`fill`) until its prompt is assembled (`clear`): the World Info entries in that prompt are marked
   * in it, as its sections and narrator rules are, a Re-narrate's own turn's wording included.
   */
  private readonly turnWording = new Map<ChatId, SecretMarkWording>();
  /**
   * Host tokenizer counts of rendered section texts, by user and text hash: the host counts with each
   * user's own main model, so one user's count never prices another's section. A section costs its
   * count once the host has counted that exact text for that user; until then the estimate (with
   * margin) stands in and the count is fetched in the background, so the engine run never waits on
   * the host. A count that isn't a finite number from 0 to `TOKEN_COUNT_CAP` times the estimate is
   * ignored, so a bogus count can't clip every section.
   */
  private readonly tokenCounts = new Map<string, number>();
  /** Users whose last token count ran past their limit (Settings → Timeouts → Token counts): said once, until a count lands in time. */
  private readonly lateCounts = new Set<UserId>();
  /** The world chat each user last generated in (the D32 preset lint dry-runs it when none is open). */
  private readonly lastWorldChat = new Map<UserId, ChatId>();
  /** The D32 preset caveats each chat's last dry run found (shown in the inspector). */
  private readonly presetWarnings = new Map<ChatId, string[]>();
  /** Settings → Caveats' preset lint by `user \0 chat \0 preset \0 preset revision \0 settings revision`: done, or its dry run still running. */
  private readonly caveatRuns = new Map<string, Promise<PresetCaveat[]>>();
  /** Preset checks running after their request's reply (`checkPresetLater`). */
  private readonly presetChecks = new Set<Promise<void>>();
  /** Each open chat's pinned world revisions, by `user \0 chat`. */
  private readonly pins = new Map<string, Map<RevisionId, WorldDoc>>();
  /** The pre-phase call budget per generation, shared by `beforePlan` and `afterPlan`. */
  private readonly preBudgets = new Map<string, StepBudget>();
  /** The POV's place after each chat's last plan (the `scene_change` signal). */
  private readonly lastPlace = new Map<ChatId, string | null>();
  /** What the pre phase saw, per generation, for the plan phase's signals and the reply's read (a Re-read's too, while it is kept). */
  private readonly prePhase = new Map<string, { chatId: ChatId; facts: SignalFacts; text: string; start: PlanStart; connectionId: string | null; preset: PresetConfig }>();
  /** Each generation's lore traces, step by step (the inspector shows them, DESIGN §6.5). */
  private readonly loreTraces = new Map<string, LoreStepTrace[]>();
  /** Each engine run's lore with World Info read live, by its turn id: one read for its phases (DESIGN §4.2). */
  private readonly liveLores = new Map<string, Record<string, LoreEntryDef>>();
  /** Each generation's minds calls, with no text (the inspector shows them, DESIGN §24.5). */
  private readonly mindTraces = new Map<string, MindCallTrace[]>();
  /** What minds answered in each engine run, by its turn id; a run that fails keeps them for its Retry (`keptMinds`). */
  private readonly answeredMinds = new Map<string, AnsweredMinds>();
  /** The minds the next run of a chat's turn takes (DESIGN §5.1): a failed run's answers, or those a run that waits on the player started. */
  private readonly keptMinds = new Map<ChatId, KeptMinds>();
  /**
   * What each engine run planned for the narrator, by its turn id (DESIGN §5.1): its prose (`brief`,
   * the prose `outline`) and its plan's Outcome, Montage and Outline lines. Its own sections read
   * these. They become its seed's (what the reply's steps and a later Re-narrate read, and
   * `plans.json`) only when a generation takes the turn (`adopted`), so a run that was dropped or
   * failed never speaks for a seed it shares with another (`same_roll`).
   */
  private readonly runLines = new Map<string, { seed: string; prose: PlanProse; lines: PlanLines }>();
  /** What the minds need of the backend: the runner, the pre and post phases and the time skip read it (`backend/minds.ts`). */
  readonly minds: MindsDeps;
  /**
   * The minds a time skip runs at its beats (DESIGN §24.7): `runMinds` on this runtime's deps, which
   * tests replace with a fake; they read what they hold while the chat tracks knowledge (DESIGN §24.11).
   */
  beatMinds: BeatMinds = async (input) => {
    const settings = await this.settings.get(input.userId);
    const knowing = knowledgeOn(await this.chatKnowledge.get(input.chatId, input.userId), input.world, settings);
    return runMinds(this.minds, knowing ? { ...input, knowledge: settings.minds.knowledge } : input);
  };

  constructor(options: RuntimeOptions) {
    // Chat reads come from a copy the host's message events keep current (DESIGN §9.6).
    this.messages = new MessageCache(options.host);
    this.host = this.messages.host;
    this.registry = createRegistry(options.packs);
    this.pipeline = options.pipeline;
    this.templates = options.templates ?? {};
    this.templateInfo = options.templateInfo ?? [];
    this.worlds = new WorldStore(this.host, this.registry);
    // The guard asks Lumiverse to wait as long as the users' guard timeouts say; a settings change
    // stales a turn the engine prepared (its sections were made with the old ones). Which writes a
    // turn holds while the engine runs follows Settings → Writes (DESIGN §4.3 P2). The connections
    // acceptance runs guard are kept beside the runs, where an earlier build's settings write can't
    // drop them.
    this.agentAccounts = new AgentAccounts(this.host);
    this.settings = new SettingsStore(
      this.host,
      (userId, settings) => {
        this.ledger.guardBudget(userId, settings.timeouts.guardMs);
        this.ledger.holdWrites(userId, settings.holdWrites);
        this.ledger.inputsChanged(userId);
        this.sweep.nudge(userId);
      },
      { get: (userId) => this.agentAccounts.guard(userId), set: (userId, connections) => this.agentAccounts.keepGuard(userId, connections) },
    );
    this.chips = new ChipStore(this.host);
    this.planNotes = new PlanNotes(this.host);
    this.staged = new StagedActions(this.host);
    this.inspector = new InspectorLog(this.host);
    this.chatPrefs = new ChatPrefs(this.host);
    this.chatKnowledge = new ChatKnowledge(this.host, this.chatMeta);
    this.book = new EngineBook(this.host, this.worlds, this.chatMeta);
    this.promptSets = new PromptSets(this.host);
    this.jsonHiding = new JsonHiding(this.host, async (userId) => (await this.settings.get(userId)).hideJsonBlocks, async (worldId, userId) => (await this.worlds.index(worldId, userId)) !== null);
    this.presets = new PresetBinding(this.host);
    this.meter = new CallMeter(this.host);
    this.steps = new Steps(this.host, this.meter, async (userId) => (await this.settings.get(userId)).helper);
    this.blobs = new BlobStore(this.host);
    // Each user's Settings → Diagnostics and Agents → Retention, as known: a call recorded before they load keeps the defaults.
    this.diag = new Diagnostics(this.host, { blobs: this.blobs, ring: (userId) => this.settings.known(userId)?.diagnostics.recordsPerChat ?? DIAG_RING, transcriptDays: (userId) => this.settings.known(userId)?.retention.transcriptDays ?? RETENTION_DEFAULTS.transcriptDays });
    this.steps.onCall = (userId, call) => this.diag.call(userId, call);
    this.steps.onCallStart = (userId, purpose) => this.diag.callStart(userId, purpose);
    this.toolSupport = new ToolSupport(this.host);
    this.minds = { host: this.host, registry: this.registry, steps: this.steps, settings: this.settings, presets: this.presets };
    // Snapshots from another build never apply (the build defines LRE_BUILD_ID; tests fold as "dev").
    this.ledger = new LedgerService(this.host, (chatId, userId) => this.resolveEnv(chatId, userId), new LedgerFold(this.registry, { fingerprint: process.env.LRE_BUILD_ID ?? "dev" }), (chatId) => this.messages.forget(chatId));
    this.sessions = new Sessions(this.blobs, this.ledger);
    this.chatAgents = new ChatAgentMeta(this.host, this.chatMeta);
    this.sweep = new Sweep({ host: this.host, blobs: this.blobs, retention: async (userId) => (await this.settings.get(userId)).retention, turning: (userId) => this.ledger.turning(userId), journals: (userId) => this.ledger.journals(userId), transcripts: (chatId, userId) => this.diag.transcripts(chatId, userId) });
    this.agents = new Agents(this.host, options.build ?? thisBuild(), async (userId) => (await this.settings.get(userId)).timeouts.mcpReconnectMs);
    // A view slower than a second is kept in the chat's diagnostics (a slow tab says where it went).
    this.push = new StatePush(this.host, (chatId, userId) => this.diag.timed(userId, chatId, "state view", () => this.view(chatId, userId)));
  }

  start(): void {
    this.ledger.hooks = this;
    this.ledger.diag = this.diag;
    this.diag.cancellable = (chatId) => this.ledger.cancellable(chatId);
    this.ledger.attach();
    this.agents.start();
    this.host.on("MESSAGE_SENT", (e, userId) => {
      if (!e.message.isUser || !userId) return;
      void this.lapse(e.chatId, userId);
      void this.takeStaged(e.chatId, userId, e.message.id);
    });
    // The host shifts a message's swipes down when one is deleted; the chips shown by swipe follow.
    this.host.on("MESSAGE_SWIPED", (e, userId) => {
      if (e.action === "deleted" && userId) this.swipeDeleted(e.chatId, userId, e.message.id, e.swipeId).catch((error: unknown) => this.host.log("warn", `[LumiRPEngine] chat ${e.chatId}: chips didn't follow a deleted swipe (${error instanceof Error ? error.message : String(error)})`, userId));
    });
    this.host.on("WORLD_INFO_ACTIVATED", (e) => this.onActivated(e.chatId, e.entries.map((x) => x.id)));
    const gate = this.worldInfoGate();
    this.host.registerWorldInfoInterceptor((input) => worldInfoVerdict(gate, input));
    // The host keeps a deleted chat's chat-scoped regex scripts, so the engine removes its own (DESIGN §6.7).
    this.host.on("CHAT_DELETED", (e, userId) => {
      if (userId) this.jsonHiding.removeChat(e.chatId, userId).catch((error: unknown) => this.host.log("warn", `[LumiRPEngine] chat ${e.chatId}: its JSON regex scripts weren't removed (${error instanceof Error ? error.message : String(error)})`, userId));
    });
  }

  // ---------------------------------------------------------------- chats

  /** The chat's run as `userId` sees it. Cached per (user, chat), so one user's lookup never answers another's. */
  async runOf(chatId: ChatId, userId: UserId): Promise<ChatRun | null> {
    const key = `${userId}\u0000${chatId}`;
    if (this.runs.has(key)) return this.runs.get(key) ?? null;
    const meta = await this.host.chats.chatMetadata(chatId, userId);
    const run = readRun(meta);
    lruSet(this.runs, key, run, 512);
    // The chat's own knowledge choices sit in the same bag: kept with its run, so a prepared turn's inputs know them.
    this.chatKnowledge.seen(chatId, userId, meta);
    return run;
  }

  /**
   * The world revision a chat plays at now, after any Upgrade, as its view shows it; or why it
   * can't be read (its ledger can't open or fold: its world or a revision it needs is gone).
   */
  async revisionInPlay(chatId: ChatId, userId: UserId, run: ChatRun): Promise<{ revision: RevisionId } | { revision: null; reason: string }> {
    try {
      const core = await this.ledger.core(chatId, userId);
      if (!core) return { revision: null, reason: `its ledger can't be opened: revision ${run.revision} of its world can't be read` };
      const observed = toChain(await this.host.chats.messages(chatId, userId));
      // Only a migrate marker moves a chat off its run's revision: one whose ledger names no other plays the run's, so it needs no fold.
      const named = core.revisionsIn(observed);
      if (named.size === 1 && named.has(run.revision)) return { revision: run.revision };
      return { revision: core.fold(observed).state.revision };
    } catch (error) {
      return { revision: null, reason: `its ledger can't be read: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /** After attaching or upgrading a chat: drop cached state so it resolves afresh. */
  forgetChat(chatId: ChatId): void {
    for (const key of [...this.runs.keys()]) if (key.endsWith(`\u0000${chatId}`)) this.runs.delete(key);
    this.bridges.delete(chatId);
    this.chatKnowledge.forget(chatId);
    this.ledger.forget(chatId);
  }

  /** Hears each whole read of a chat from the host, once it has landed (the memory budget, DESIGN §9.6). */
  onChatRead(listener: (chatId: ChatId) => void): void {
    this.messages.onRead = listener;
  }

  /**
   * The memory budget's trim (DESIGN §9.6): for every chat not in use, lets go of what is built
   * again when it is next used: its copy of the messages, its open ledger with the world revisions
   * that pins, and its last pushed view. A chat is in use while a page shows it on screen, while it
   * holds a turn or an operation, and while it is its user's latest chat read. How many of each went.
   */
  trimIdle(): TrimReport {
    const viewed = this.ledger.viewed();
    const latest = this.messages.latest();
    const inUse = (chatId: ChatId): boolean => viewed.has(chatId) || latest.has(chatId) || this.ledger.busy(chatId);
    const ledgers = new Set(this.ledger.trim(inUse));
    for (const key of [...this.pins.keys()]) if (ledgers.has(key.slice(key.indexOf("\u0000") + 1))) this.pins.delete(key);
    return { messages: this.messages.trim(inUse), ledgers: ledgers.size, views: this.push.trim(inUse) };
  }

  private async resolveEnv(chatId: ChatId, userId: UserId): Promise<LedgerEnv | null> {
    const run = await this.runOf(chatId, userId);
    if (!run) return null;
    // The chat pins only the revisions its ledger references (its run's, its migrate targets),
    // loaded as its core asks for them; every other revision lives in the store's bounded LRU.
    const pinned = new Map<RevisionId, WorldDoc>();
    const missing = new Set<RevisionId>();
    // Pins follow the open chats: a chat's ledger holds its own, and this map keeps them no longer than it does.
    lruSet(this.pins, `${userId}\u0000${chatId}`, pinned, OPEN_CHATS_CAP);
    let world: WorldDoc;
    try {
      world = (await this.worlds.get(run.worldId, userId, run.revision)).world;
    } catch (error) {
      this.host.log("warn", `[LumiRPEngine] chat ${chatId}: its world ${run.worldId} is unavailable (${error instanceof Error ? error.message : String(error)})`, userId);
      return null;
    }
    pinned.set(run.revision, world);
    this.jsonHiding.seen(chatId, run.worldId, userId);
    const settings = await this.settings.get(userId);
    lruSet(this.settingsCache, userId, settings, 256);
    // One bridge per chat run: a second env resolution (concurrent opens) must not orphan the
    // intents and plans the first one's core uses.
    const existing = this.bridges.get(chatId);
    const bridge = existing && existing.runSeed === run.runSeed ? existing : new TurnBridge(this.registry, this.pipeline, run.runSeed);
    lruSet(this.bridges, chatId, bridge, 256);
    return {
      types: this.registry,
      // A revision found in the user's cache (one just committed) is pinned on first use.
      worlds: (revision) => {
        const doc = pinned.get(revision) ?? this.worlds.cached(userId, run.worldId, revision);
        if (doc) pinned.set(revision, doc);
        return doc;
      },
      pin: async (revisions) => {
        for (const rev of revisions) {
          if (pinned.has(rev) || missing.has(rev)) continue;
          try {
            pinned.set(rev, (await this.worlds.get(run.worldId, userId, rev)).world);
          } catch {
            // Not one of the world's revisions: a fold that needs it reports the unknown revision.
            missing.add(rev);
          }
        }
      },
      run,
      model: bridge,
      // The world's realism and time defaults seed a new chat, with the latest settings filling in
      // (DESIGN §9.1), so the view before the first record (its palette) and the first turn's plan
      // use the same levels.
      startMarkers: () => startMarkersFrom(this.settings.known(userId) ?? this.settingsCache.get(userId) ?? settings, world, run.revision),
      newSeed: () => crypto.randomUUID(),
      // A GM edit or ✎ fix that waited out a reply, or that a read now comes before, resolved again (DESIGN §7).
      resolveFix: (doc, state, entry) => resolveFix(this.registry, doc, state, entry, run.runSeed),
    };
  }

  /** The revisions a chat's ledger keeps loaded (diagnostics; a world's other revisions come and go through the store's LRU). */
  pinnedRevisions(chatId: ChatId, userId: UserId): RevisionId[] {
    return [...(this.pins.get(`${userId}\u0000${chatId}`)?.keys() ?? [])];
  }

  // ---------------------------------------------------------------- turn hooks

  /**
   * The pre phase (DESIGN §5.2, §5.3), before the plan: the turn's intent (a recorded palette or chip
   * action, else `interpret` when its signals fire), `npc.choose` for agents with the POV,
   * `puzzle.answer` when an answer needs judging, and `judge` when the adjudication policy weighs the
   * player's words or leaves the check to the story. One call budget covers this and `afterPlan`.
   */
  async beforePlan(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string; connectionId: string | null; runKey: string; signal: AbortSignal }): Promise<PreOutcome | undefined> {
    const bridge = this.bridges.get(input.chatId);
    const p = input.core.journal.pending[input.generationId];
    // A Re-narrate copies its source's plan (P3): no resolve, simulate or model calls before it.
    if (!bridge || !p || p.kind === "continue" || p.kind === "impersonate" || (p.kind === "renarrate" && p.renarrateOf)) return;
    const settings = await this.settings.get(input.userId);
    lruSet(this.settingsCache, input.userId, settings, 256);
    // The preset the reply assembles with, read once for the engine run's phases and its sections.
    const preset = await this.presets.current(input.chatId, input.userId);
    const target = p.messageId ? input.observed.findIndex((m) => m.id === p.messageId) : input.observed.length;
    const before = input.observed.slice(0, target < 0 ? input.observed.length : target);
    // What this turn keeps goes by its own words (`ownMessage`), which are the words its plan looks up.
    const lastUser = ownMessage(before);
    const text = lastUser ? (lastUser.swipes[lastUser.swipeId] ?? "") : "";
    const folded = input.core.renderState(input.observed);
    if (!folded) return;
    // The turn's helpers, minds and checks read the same lore, World Info read live included (DESIGN §4.2).
    const render = { ...folded, world: await this.liveWorld(p.generationId, input.chatId, input.userId, folded.world) };
    // What the bridge keeps for these words is one turn's (DESIGN §5.1): the same words in a later
    // turn, or this turn after an earlier message changed, are read again; a Re-run or a Retry of it isn't.
    bridge.begin(text, input.core.planState(p.generationId, input.observed)?.parentPath ?? "");
    const budget = phaseBudget(settings, "pre", input.signal);
    this.preBudgets.set(p.generationId, budget);
    trimMap(this.preBudgets);
    const ctx = this.registry.context(render.world, render.state);
    const ties = tiesOf(ctx, render.world, render.state);
    // The player's message takes the action staged for it, if it hasn't yet (the host's event may come after the turn starts).
    if (lastUser) await this.takeStaged(input.chatId, input.userId, lastUser.id);
    const recorded = lastUser ? (await this.host.chats.messages(input.chatId, input.userId)).find((m) => m.id === lastUser.id)?.metadata[LEDGER_NAMESPACE] : undefined;
    // A combat action only where the ruleset has combat (DESIGN §11), so a world without it reads typed text as before.
    const all = [...this.registry.actions.values(), ...Object.values(render.world.actions)].filter((a) => offersAction(render.world, a));
    // A staged action's message is typed text too (DESIGN §11): interpret reads its words for all else they say.
    const typed = text.trim() !== "" && !(isRecord(recorded) && typeof recorded.action === "string" && !(recorded.staged === true && recorded.action !== TIMELAPSE_ACTION));
    // A palette or chip tap writes the action's label as the message: only words the player typed
    // with it describe an approach, so only those are worth a judge call.
    const described = typed || (text.trim() !== "" && isRecord(recorded) && recorded.described === true);
    // The messages before the typed one: what `interpret` reads to tell what it refers to (DESIGN §5.2), and what any step's Recent chat takes from.
    const earlier = lastUser ? before.slice(0, before.indexOf(lastUser)) : before;
    const facts: SignalFacts = {
      ...noFacts(before.filter((m) => !m.isUser).length + 1),
      typed,
      sceneChange: this.lastPlace.has(input.chatId) && this.lastPlace.get(input.chatId) !== placeOfEntity(render.state, render.world.pov),
      agentsPresent: agentsActHere(this.registry, render.world, render.state),
      present: ties.present.length > 0,
      offscreen: ties.offscreen.length > 0,
      tieZone: ties.present.length > 0,
      invitation: (before.findLast((m) => !m.isUser)?.ledger?.swipes[String(before.findLast((m) => !m.isUser)?.swipeId ?? 0)]?.events ?? []).some((e) => e.type === "castlife.invitation"),
      timelapse: isRecord(recorded) && recorded.action === TIMELAPSE_ACTION,
      earlier: { messages: this.keptEarlier(input.chatId, earlier), hideJson: settings.hideJsonBlocks },
    };
    // Character minds (DESIGN §24) start now, beside the rest of the pre phase: separate calls, on the
    // phase's wall clock, apart from its call count. They think from the state the turn plans from,
    // the player's message and the reply before it, all known before `interpret` reads the message.
    // The read can change one thing for them: a timelapse's minds think at its beats (`skip.ts`), so
    // until the read says, they think as for the turn they most likely are, and give way to the
    // other kind once it does. A turn whose outline the player let through plays the plan it was
    // shown, so none start.
    const shown = bridge.outlineOf(text) !== undefined;
    const lastReply = before.findLast((m) => !m.isUser);
    // A Retry of a run that failed keeps the minds it got and asks only the others (DESIGN §5.1), and
    // a run that waits on the player hands on the minds it started; either while what they think from
    // is unchanged: the chain and journal, the world revision, the player's message, the minds
    // settings, the mind step and the preset's mind block. Fixing another step's connection keeps them.
    const runAt: DiagAt = { chatId: input.chatId, userId: input.userId, turn: p.generationId };
    // Whether the chat tracks knowledge (DESIGN §24.11): its own switch, else the user's; the turn records a change, and minds read what they hold.
    const knowing = knowledgeOn(await this.chatKnowledge.get(input.chatId, input.userId), render.world, settings);
    const mindsKey = [input.runKey, render.state.revision, text, hashParts("lre.kept-minds", JSON.stringify({ minds: settings.minds, knowing, step: mindsStepConfig(settings.modelUse, "mind"), guidance: preset.guidance.mind ?? "" }))].join("\u0000");
    const kept = this.keptMinds.get(input.chatId);
    this.keptMinds.delete(input.chatId);
    if (kept && kept.key !== mindsKey) kept.stop?.abort(new NotNeeded("the turn they were thinking for changed"));
    const same = kept?.key === mindsKey ? kept : undefined;
    // A Regenerate's or swipe's minds read the chat up to the reply it replaces, never that reply again.
    const asking = { chatId: input.chatId, userId: input.userId, world: render.world, state: render.state, user: text, reply: lastReply ? (lastReply.swipes[lastReply.swipeId] ?? "") : "", guidance: preset.guidance.mind ?? "", knowledge: knowing, ...(p.messageId ? { replaces: p.messageId } : {}) };
    const readTimelapse = (): boolean => bridge.intentOf(text)?.action === TIMELAPSE_ACTION;
    const known = text.trim() === "" || bridge.hasIntent(text) || bridge.isHeld(text);
    let thinking = shown ? null : this.thinkMinds(asking, known ? readTimelapse() : facts.timelapse, budget.signal, same);
    const at = await this.lorePhase("pre", p.generationId, input.chatId, input.userId, render.world, render.state, budget, text, preset.guidance);
    // What the reply before it left unplayed of the last message, which this one may take as done (DESIGN §5.2).
    const left = text.trim() === "" ? "" : await this.leftUnplayed(input.chatId, input.userId, earlier, text);
    const intentTask = text.trim() === "" || bridge.hasIntent(text) || bridge.isHeld(text) ? Promise.resolve() : this.readIntent(bridge, text, recorded, render, all, earlier, settings, facts, budget, at, left);
    // The judge's call for the player's own action comes before npc.choose's (DESIGN §11). Present
    // agents' choices run beside the intent only while a call stays free for the judge; otherwise
    // they take what is left once it has run. Before `interpret` names the action, the judge may
    // run whenever the policy weighs the player's words or leaves checks to the story.
    const policy = policyOf(render.world, render.state);
    const judging = described && runsOf(settings.modelUse, render.world, "judge", facts, { guidance: at.guidance }).length > 0 && (bridge.hasIntent(text) ? this.judgeTarget(bridge.intentOf(text), render) !== null : policy.description.weight !== "none" || policy.authority === "narrative");
    const npcRun = runsOf(settings.modelUse, render.world, "npc.choose", facts, { guidance: at.guidance })[0];
    const choose = npcRun && ties.present.length > 0 ? () => npcChoose(this.steps, npcRun, ties.present, (t) => this.describeTie(t, render.world, render.state), createRng(hashParts("lre.npc.pre", bridge.runSeed, p.generationId)), input.userId, budget.signal, this.stepLore(npcRun, at, this.tieInputs(ties.present, render.world, render.state))) : null;
    // A turn that may wait on a gate (DESIGN §5.1 preview gates) chooses for present agents only once
    // the player lets it play: a choice made before a Cancel would be a call spent for nothing. A turn
    // whose outline the player let through plays the plan it was shown, so it chooses nothing again.
    const gating = shown || (settings.gates.intent && typed && !bridge.intentPassed(text));
    const [, early] = await Promise.all([intentTask, choose && !gating && budget.take(judging ? 1 : 0) ? choose() : null]);
    if (thinking && thinking.timelapse !== readTimelapse()) {
      thinking.stop.abort(new NotNeeded(readTimelapse() ? "the message plays a timelapse, whose minds think at its beats" : "the message plays no timelapse"));
      thinking = this.thinkMinds(asking, readTimelapse(), budget.signal, same);
    }
    // A routine the player's message states (DESIGN §9.4) is asked about on that message, with Yes
    // or No; the turn doesn't wait on it. Its turn is the message, which the model can't set.
    const routine = lastUser ? bridge.takeRoutineAsks(text) : [];
    if (lastUser && routine.length > 0) {
      // Several places fit the one the player named: each is its own choice (`at:<i>`), then No.
      const turnOf = (proposal: JsonObject): JsonObject => ({ ...proposal, turn: lastUser.id });
      await this.chips.add(input.chatId, input.userId, routine.map((ask, i): StoredChip => ({ id: `routine_ask:${lastUser.id}:${i}`, kind: "routine_ask", messageId: lastUser.id, label: ask.question, detail: ask.detail, actions: [...(ask.places ? ask.places.map((p, n): ChipAction => ({ id: `at:${n}`, label: p.label, ...(n === 0 ? { style: "primary" as const } : {}) })) : [{ id: "yes", label: "Yes", style: "primary" as const }]), { id: "no", label: "No" }], expires: "next_send", payload: { proposal: turnOf(ask.proposal), added: ask.added, ...(ask.places ? { places: ask.places.map((p) => turnOf(p.proposal)) } : {}) } })));
      this.push.changed(input.chatId, input.userId);
    }
    // A claim, or a check the chat only suggests (DESIGN §9.4 player claims, §11 inferred checks),
    // waits on the player's answer: nothing is generated; the chat asks, on the player's message,
    // and the answer's Regenerate runs the engine again with the read kept, so exactly one reply follows.
    const asked = bridge.askOf(text);
    if (asked && lastUser) {
      const actions: ChipAction[] = asked.kind === "check" ? [{ id: "roll", label: "Roll", style: "primary" }, { id: "drop", label: "No roll" }] : [{ id: "add", label: "Add", style: "primary" }, { id: "drop", label: "Not an action" }];
      await this.chips.add(input.chatId, input.userId, [{ id: `${asked.kind}:${lastUser.id}`, kind: asked.kind, messageId: lastUser.id, label: asked.question, detail: asked.detail, actions, expires: "next_send", payload: { text, index: asked.index } }]);
      this.push.changed(input.chatId, input.userId);
      this.keepMinds(input.chatId, mindsKey, thinking);
      return { waiting: `waiting for the player's answer: ${asked.question}` };
    }
    // The intent gate (DESIGN §5.1 preview gates): a typed message's read waits, nothing generated, on
    // Play, Edit or Cancel, on the player's message, its card saying what it plays (`intentCard`); Play
    // and Edit's Regenerate resume the turn with the read kept. A palette or chip tap is the action
    // the player picked, so it plays.
    const read = bridge.intentOf(text);
    if (settings.gates.intent && typed && lastUser && read?.action && !shown && !bridge.intentPassed(text)) {
      const card = this.intentCard(bridge, text, read, render.world, render.state, settings);
      const actions: ChipAction[] = [{ id: "play", label: "Play", style: "primary" }, ...(card.edit ? [{ id: "edit", label: "Edit", input: card.edit }] : []), { id: "cancel", label: "Cancel" }];
      await this.chips.add(input.chatId, input.userId, [{ id: `intent_gate:${lastUser.id}`, kind: "intent_gate", messageId: lastUser.id, label: card.label, ...(card.detail !== "" ? { detail: card.detail } : {}), actions, expires: "next_send", payload: { text } }]);
      this.push.changed(input.chatId, input.userId);
      this.keepMinds(input.chatId, mindsKey, thinking);
      return { waiting: `waiting for you to play the read action: ${card.what}` };
    }
    this.prePhase.set(p.generationId, { chatId: input.chatId, facts, text, start: { place: placeOfEntity(render.state, render.world.pov), clock: render.state.clock }, connectionId: input.connectionId, preset });
    trimMap(this.prePhase);
    // Let through the outline gate, the turn plays the plan the player was shown (`TurnBridge.plan`):
    // its minds, decisions and skip are that plan's, so nothing more is asked.
    if (!thinking) return;
    await this.judgeAnswer(bridge, text, render, settings, facts, budget, at);
    if (described) await this.judgeApproach(bridge, text, render, settings, facts, budget, at);
    const decisions = early ?? (choose && budget.take() ? await choose() : []);
    bridge.setDecisions(text, decisions);
    const minds = await thinking.task;
    bridge.setMinds(text, minds.events);
    this.addMindTraces(input.chatId, p.generationId, minds.traces, true);
    lruSet(this.answeredMinds, p.generationId, { key: mindsKey, minds: mindsAnswered(minds.events) }, 64);
    this.mindsMissed(runAt, "pre", minds);
    if (text.trim() !== "") this.host.log("info", `[LumiRPEngine] plan ${String(input.generationId).slice(0, 8)}: intent ${bridge.intentOf(text)?.action ?? "none"} ${JSON.stringify(bridge.intentOf(text)?.params ?? {}).slice(0, 240)}, ${decisions.length} npc decision(s), ${minds.traces.length} mind(s), ${budget.spent} pre call(s)`, input.userId);
    const intent = bridge.intentOf(text);
    // A timelapse's informative people whose skip the model plans (#53) are planned once, as the span
    // starts, from the state the plan starts from; the plan records it ahead of the timelapse. A Re-run
    // or Retry keeps the plan this turn made.
    if (intent?.action === TIMELAPSE_ACTION && !bridge.hasSkipPlan(text)) {
      const from = input.core.planState(p.generationId, input.observed);
      if (from) {
        const start = new Working(this.registry, from.world, from.state);
        start.applyAll(bridge.prePlan(text));
        const journal = recentLines(input.core, input.observed, target < 0 ? input.observed.length : target, this.registry);
        const log = (message: string): void => this.host.log("info", `[LumiRPEngine] plan ${p.generationId.slice(0, 8)}: ${message}`, input.userId);
        // The step switched off makes no call (`mindsStepConfig` is null): the plan is recorded empty.
        bridge.setSkipPlan(text, await planSkip({ registry: this.registry, steps: this.steps, log, host: this.host }, { chatId: input.chatId, userId: input.userId, world: await this.liveWorld(p.generationId, input.chatId, input.userId, from.world), state: start.state, intent, runSeed: bridge.runSeed, reply: lastReply ? (lastReply.swipes[lastReply.swipeId] ?? "") : "", journal, reads: settings.minds.reads, hideJson: settings.hideJsonBlocks, signal: budget.signal, limit: settings.timeouts.skipPlanMs, config: mindsStepConfig(settings.modelUse, "skip"), guidance: preset.guidance.skip ?? "" }));
      }
    }
    // A timelapse with minds on is a time skip (DESIGN §24.7): its beats and the minds at them are
    // found and recorded now, from exactly the state the plan starts from, and the plan replays them.
    const base = intent?.action === TIMELAPSE_ACTION && mindsOn(settings) ? input.core.planState(p.generationId, input.observed) : null;
    let skip: SkipRun | null = null;
    if (intent && base) {
      const start = new Working(this.registry, base.world, base.state);
      start.applyAll(bridge.prePlan(text));
      // Every mind at its beats must answer too: one that doesn't fails the run.
      const beats: RunMindsResult[] = [];
      const beatMinds: BeatMinds = async (i) => {
        const ran = await this.beatMinds(i);
        beats.push(ran);
        return ran;
      };
      try {
        // Minds at the skip's beats and at its end read the lore the run read (DESIGN §4.2, §24.7).
        skip = await runSkip({ registry: this.registry, steps: this.steps, minds: beatMinds, host: this.host }, { chatId: input.chatId, userId: input.userId, world: await this.liveWorld(p.generationId, input.chatId, input.userId, base.world), state: start.state, intent, runSeed: bridge.runSeed, settings, guidance: preset.guidance, signal: budget.signal });
      } catch (error) {
        this.diag.failed(runAt, "skip", "skip", `the time skip didn't run: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (skip) this.addMindTraces(input.chatId, p.generationId, skip.traces);
      for (const ran of beats) this.mindsMissed(runAt, "skip", ran);
    }
    bridge.setSkip(text, skip?.record ?? null);
  }

  /**
   * Minds that didn't answer fail the engine run (DESIGN §5.1): one record saying who, named where
   * the player may know them (the inspector's traces list only those), and why.
   */
  private mindsMissed(at: DiagAt, phase: "pre" | "skip", ran: RunMindsResult): void {
    const missed = (ran.report ?? []).filter((e) => e.status === "failed" || e.status === "cancelled");
    if (missed.length === 0) return;
    const known = new Set(ran.traces.filter((t) => t.outcome === "failed").map((t) => t.who));
    // Someone the player doesn't know is "a mind", and why theirs failed says nothing of them.
    const line = (e: (typeof missed)[number]): string => (known.has(e.name) ? `${e.name}'s mind: ${e.reason ?? "it didn't answer"}` : `a mind: ${e.reason?.startsWith("it didn't fit") ? "its answer didn't fit the world as it is now" : (e.reason ?? "it didn't answer")}`);
    this.diag.failed(at, phase, "mind", missed.map(line).join("; "));
  }

  /**
   * A run's pre-phase minds (`preMinds`), under way on their own stop inside the phase's signal: for
   * a timelapse, the round alone, at once; otherwise those the scene, the ladder and the cadence call,
   * taking a run's before it of the same turn (`kept`) once they are in. A timelapse's minds no
   * longer need what an earlier run started, so that stops.
   */
  private thinkMinds(asking: Omit<PreMindsInput, "timelapse" | "signal" | "kept">, timelapse: boolean, signal: AbortSignal, kept: KeptMinds | undefined): ThinkingMinds {
    const stop = new AbortController();
    if (timelapse) kept?.stop?.abort(new NotNeeded("the message plays a timelapse, whose minds think at its beats"));
    const task = (async () => preMinds(this.minds, { ...asking, timelapse, signal: AbortSignal.any([signal, stop.signal]), ...(kept && !timelapse ? { kept: await kept.minds } : {}) }))();
    return { timelapse, task, stop };
  }

  /**
   * A run that waits on the player (a claim, a suggested check, the intent gate) hands on the minds
   * it started: the run their Regenerate starts takes each that answered, as they come in, while what
   * they think from is unchanged (`mindsKey`). Cancel stops them (`dropMinds`).
   */
  private keepMinds(chatId: ChatId, key: string, thinking: ThinkingMinds | null): void {
    if (!thinking || thinking.timelapse) return;
    lruSet(this.keptMinds, chatId, { key, minds: thinking.task.then((ran) => mindsAnswered(ran.events), () => new Map<EntityId, MindEventData>()), stop: thinking.stop }, 256);
  }

  /** Cancel on a preview gate (DESIGN §5.1): the minds its run started for the turn are no longer wanted. */
  dropMinds(chatId: ChatId): void {
    this.keptMinds.get(chatId)?.stop?.abort(new NotNeeded("you cancelled the turn"));
    this.keptMinds.delete(chatId);
  }

  /**
   * The plan phase (DESIGN §5.2, §5.3), then what ran out of the engine run's time: the pre budget's
   * limit and its lookups' window, in the turn's diagnostics, where a fired limit stops the run.
   */
  async afterPlan(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string; as: GenerateAs; signal: AbortSignal }): Promise<PreOutcome | undefined> {
    try {
      return await this.prose(input);
    } finally {
      const budget = this.preBudgets.get(input.generationId);
      if (budget) this.timeLimits({ chatId: input.chatId, userId: input.userId, turn: input.generationId }, "pre", budget);
    }
  }

  /**
   * `brief` and the prose `outline` (stacked on the engine's beats) run side by side on the pre
   * budget, except that an outline template naming `{{brief}}` waits for the brief; their text goes
   * to the Outline slot. They see only player-visible facts (secrecy batching rule). With the
   * outline gate on (DESIGN §5.1 preview gates), the Outline then waits on the player.
   */
  private async prose(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string; as: GenerateAs; signal: AbortSignal }): Promise<PreOutcome | undefined> {
    const bridge = this.bridges.get(input.chatId);
    const p = input.core.journal.pending[input.generationId];
    const pre = this.prePhase.get(input.generationId);
    if (!bridge || !p?.planned || p.renarrateOf || !pre) return;
    const plan = bridge.planFor(p.seed);
    const folded = input.core.renderState(input.observed);
    if (!folded) return;
    // The brief, the outline, their leak checks and the outline gate read the run's lore, World Info included (DESIGN §4.2).
    const render = { ...folded, world: await this.liveWorld(input.generationId, input.chatId, input.userId, folded.world) };
    lruSet(this.lastPlace, input.chatId, placeOfEntity(render.state, render.world.pov), 256);
    // The outline the player let through is the one the reply is told, with no brief or outline call.
    const shown = bridge.outlineOf(pre.text);
    if (shown) {
      this.keepRunLines(input.generationId, p.seed, plan, render.world, { brief: null, outline: [] }, [...shown]);
      return;
    }
    const settings = this.settingsCache.get(input.userId) ?? (await this.settings.get(input.userId));
    const facts: SignalFacts = { ...pre.facts, ...planFacts(render.world, pre.start, render.state, plan) };
    const briefRuns = runsOf(settings.modelUse, render.world, "brief", facts, { output: "text", guidance: pre.preset.guidance });
    const outlineRuns = runsOf(settings.modelUse, render.world, "outline", facts, { output: "text", guidance: pre.preset.guidance });
    const secrets = unrevealedSecrets(this.registry, render.world, render.state);
    // The Journal before this turn: the plan's target message and what follows aren't in it.
    const target = p.messageId === null ? -1 : input.observed.findIndex((m) => m.id === p.messageId);
    let prose: PlanProse = { brief: null, outline: [] };
    if (briefRuns.length > 0 || outlineRuns.length > 0) {
      const budget = this.preBudgets.get(input.generationId) ?? phaseBudget(settings, "pre", input.signal);
      const recent = recentLines(input.core, input.observed, target < 0 ? input.observed.length : target, this.registry);
      const vars = safeVars(this.stepVars(render.world, render.state, plan, pre.text, "", "", recent), secrets);
      const inputs = { text: [pre.text, vars.outcome ?? "", vars.beats ?? "", this.trackWords(render.world, render.state)].join("\n"), links: this.sceneLinks(render.world, render.state) };
      const at = await this.lorePhase("pre", input.generationId, input.chatId, input.userId, render.world, render.state, budget, pre.text, pre.preset.guidance);
      // A brief or an outline line that names someone or something hidden is withheld whole, as one
      // carrying a secret is, and the outline gate shows what is left (DESIGN §5.2, §7). What the step
      // was given counts as said: the player's message, which the narrator reads anyway, and its other
      // inputs, which hold only what the POV may know, so a line naming nothing else tells nothing. The
      // prose steps never read secret lore or a track's stages, so a secret entry counts by its title
      // only and a hidden track by its own label (`hiddenNameCheck`).
      const hidden = hiddenNameCheck(this.registry, render.world, render.state, render.world.pov, { stages: false });
      const run = (r: StepRun, kind: "brief" | "outline", stepVars = vars): Promise<string[]> => {
        if (!budget.take()) return Promise.resolve([]);
        const heard = [pre.text, ...Object.values(stepVars)].join("\n");
        const withheld = (line: string): boolean => findLeaks(line, secrets).length > 0 || hidden(line, heard);
        return promptedText(this.steps, r, kind, stepVars, withheld, input.userId, budget.signal, this.stepLore(r, at, inputs)).then((lines) => lines ?? []);
      };
      const briefTask = Promise.all(briefRuns.map((r) => run(r, "brief")));
      // The outline is told the sections the narrator has this turn, so it points at no other (DESIGN §9.5).
      const outlineVars = outlineRuns.length > 0 ? { ...vars, sections: this.narratorSections(render.world, render.state, plan).join(", ") } : vars;
      // An outline template that names {{brief}} waits for the brief (leak-checked as it comes back).
      const outlineTask = Promise.all(outlineRuns.map((r) => (/\{\{\s*brief\s*\}\}/i.test(r.template?.template ?? "") ? briefTask.then((b) => run(r, "outline", { ...outlineVars, brief: b.flat().join(" ").trim() })) : run(r, "outline", outlineVars))));
      const [briefs, outlines] = await Promise.all([briefTask, outlineTask]);
      const brief = briefs.flat().join(" ").trim();
      prose = { brief: brief === "" ? null : brief, outline: outlines.flat() };
      this.host.log("info", `[LumiRPEngine] plan ${input.generationId.slice(0, 8)}: brief ${brief === "" ? "none" : "yes"}, ${prose.outline.length} outline line(s), ${budget.spent} pre call(s)`, input.userId);
    }
    this.keepRunLines(input.generationId, p.seed, plan, render.world, prose);
    // The outline gate: the Outline waits, no reply written, on Play, Edit or Cancel, on the player's
    // message, or for a new reply after a reply on the reply it follows; Play and Edit keep the outline
    // as let through, and the reply they start as the stopped generation started (`as`: Regenerate, or
    // the player's own Send) resumes the turn with this plan (`TurnBridge.plan`). The player sees and
    // edits only lines a secret isn't in; those stay as they are.
    const anchor = input.observed.slice(0, target < 0 ? input.observed.length : target).at(-1);
    const lines = plan ? planOutline(plan, prose) : [];
    if (!settings.gates.outline || !anchor || lines.length === 0) return;
    const visible = lines.filter((line) => findLeaks(line, secrets).length === 0);
    const held = lines.filter((line) => findLeaks(line, secrets).length > 0);
    const actions: ChipAction[] = [{ id: "play", label: "Play", style: "primary" }, { id: "edit", label: "Edit", input: { type: "text", label: "The outline, one line each", value: visible.join("\n") } }, { id: "cancel", label: "Cancel" }];
    await this.chips.add(input.chatId, input.userId, [{ id: `outline_gate:${anchor.id}`, kind: "outline_gate", messageId: anchor.id, label: "Write the reply from this outline?", detail: visible.join("\n"), actions, as: input.as, expires: "next_send", payload: { text: pre.text, lines: visible, held } }]);
    this.push.changed(input.chatId, input.userId);
    return { waiting: "waiting for you to play the turn's outline" };
  }

  /**
   * The sections the narrator will have this turn, by label, as the outline step is told them
   * (DESIGN §9.5): the Outcome, the Scene and the Outline itself, a timelapse's Montage when it has
   * lines, Minds when someone's mind has one, and any other when its renderers have one; never one
   * the chat's feed switches off (§6.11). The budget
   * may still leave one out: the Outline is checked again when it is written (`withoutMissing`).
   */
  private narratorSections(world: WorldDoc, state: WorldState, plan: EngineTurnPlan | undefined): string[] {
    return readPass(() => {
      const ctx = this.registry.context(world, state);
      // A section's player lines decide it, as the Outline names only what the player's view holds.
      const has = (section: SectionTemplate): boolean =>
        renderersOf(this.registry.renderers, section, feedOf(section, state)).some((r) => {
          if (r.hint) return false;
          try {
            return r.render(ctx).length > 0;
          } catch {
            return false;
          }
        });
      const montage = plan ? planLines(plan, world, this.registry).montage.length > 0 : false;
      return sectionsOf(world)
        .filter((s) => feedOf(s, state).enabled !== false)
        .filter((s) => (s.id === "outcome" || s.id === "scene" || s.id === "outline" ? true : s.id === MINDS_SLOT ? mindLines(ctx).length > 0 : (s.id === "montage" && montage) || has(s)))
        .map((s) => s.label);
    });
  }

  /**
   * A generation's minds calls for the inspector (DESIGN §6.5, §24.5): the pre phase's replace any
   * earlier ones (a Re-run asks again), and the post phase's and a skip's beats' join them. The record
   * already made for the generation shows them at once.
   */
  addMindTraces(chatId: ChatId, generationId: string, traces: readonly MindCallTrace[], replace = false): void {
    const list = [...(replace ? [] : (this.mindTraces.get(generationId) ?? [])), ...traces];
    if (list.length === 0) this.mindTraces.delete(generationId);
    else lruSet(this.mindTraces, generationId, list, 64);
    const record = this.inspector.records(chatId)?.find((r) => r.id === generationId);
    if (!record || list.length === 0) return;
    record.minds = structuredClone(list);
    this.inspector.save(chatId);
  }

  /** The sections a run's plan feeds the narrator, kept under the run until a generation takes its turn (`adopted`); `outline` is the one the player let through the outline gate. */
  private keepRunLines(turn: string, seed: string, plan: EngineTurnPlan | undefined, world: WorldDoc, prose: PlanProse, outline?: string[]): void {
    if (!plan) return;
    lruSet(this.runLines, turn, { seed, prose, lines: { ...planLines(plan, world, this.registry), outline: outline ?? planOutline(plan, prose) } }, 64);
  }

  /**
   * The engine placeholders a step template may use (DESIGN §5.2), all player-visible after
   * `safeVars`: `brief` is the turn's brief, once its step has run, and `recent` the Journal's latest
   * turn lines before it.
   */
  private stepVars(world: WorldDoc, state: WorldState, plan: EngineTurnPlan | undefined, user: string, reply: string, brief: string, recent: readonly string[]): Record<string, string> {
    const facts = factLines(this.registry, world, state, []);
    return {
      world: world.name,
      pov: state.entities[world.pov]?.name ?? world.pov,
      place: povPlace(this.registry, world, state)?.name ?? "",
      clock: formatClock(calendarOf(world), state.clock),
      scene: facts.slice(0, 8).join("\n"),
      facts: facts.join("\n"),
      present: presentNames(this.registry, world, state).join(", "),
      outcome: plan ? planLines(plan, world, this.registry).outcome.join("\n") : "",
      beats: (plan?.outline ?? []).join("\n"),
      brief,
      user,
      reply,
      recent: recent.join("\n"),
      // What the player character has and knows, as the sections tell it (`slotVars`).
      ...slotVars(this.registry, world, state),
    };
  }

  /**
   * The turn's intent: a recorded palette or chip action, else `interpret` (helper JSON, or a
   * Decision choice over the actions), which reads what the POV can do now, the scene and places as
   * it knows them, and the messages before this one (`earlier`, DESIGN §5.2).
   */
  private async readIntent(bridge: TurnBridge, text: string, recorded: JsonValue | undefined, render: { world: WorldDoc; state: WorldState }, all: ActionDef[], earlier: readonly ChainMessage[], settings: UserSettings, facts: SignalFacts, budget: StepBudget, at: LorePhase, left: string): Promise<void> {
    const userId = at.userId;
    // A palette or chip action records its intent on the user message (dispatch `lre.action`); it
    // survives restarts and a bridge that never saw the request. One staged for a message the player
    // wrote (DESIGN §11) leads its turn, but the words are read too, for all else they say.
    const staged = isRecord(recorded) && recorded.staged === true && typeof recorded.action === "string" && recorded.action !== TIMELAPSE_ACTION && text.trim() !== "" ? { action: recorded.action, params: isRecord(recorded.params) ? (JSON.parse(JSON.stringify(recorded.params)) as JsonObject) : {} } : null;
    const playStaged = (): void => bridge.setIntent(text, staged ? { action: staged.action, params: staged.params, probabilities: { [staged.action]: 1 }, picked: true } : null);
    if (isRecord(recorded) && typeof recorded.action === "string" && !staged) {
      const params = isRecord(recorded.params) ? (JSON.parse(JSON.stringify(recorded.params)) as JsonObject) : {};
      const target = recorded.action === TIMELAPSE_ACTION ? parseTarget(params.target) : null;
      const overrides: Record<string, string> = {};
      for (const [k, v] of Object.entries(parseOverrides(params.overrides))) if (typeof v === "string") overrides[k] = v;
      // A Continue of a span the player's words spent keeps the POV where the story has it, as the span did,
      // and an offered span's chip keeps the words that filled it (`text`), told as an inline skip tells them.
      // A Timelapse staged from the sheet with a message is filled by that message's own words, as the
      // intent gate would quote them (`quotedWords`: the player's own words are theirs to repeat).
      const typed = recorded.staged === true && text.trim() !== "" ? quotedWords(this.registry, render.world, render.state, text, unrevealedSecrets(this.registry, render.world, render.state).filter((s) => !text.toLowerCase().includes(s.toLowerCase())), text) : null;
      const words = typeof recorded.text === "string" && recorded.text.trim() !== "" ? recorded.text : typed;
      const fill = recorded.action === TIMELAPSE_ACTION && words ? { text: words } : {};
      bridge.setIntent(text, recorded.action === TIMELAPSE_ACTION ? (target ? { ...timelapseIntent(target, overrides, 1, params.povRoutine !== false), ...fill } : null) : { action: recorded.action, params, probabilities: { [recorded.action]: 1 }, picked: true });
      return;
    }
    const run = runsOf(settings.modelUse, render.world, "interpret", facts, { guidance: at.guidance })[0];
    if (!run || !budget.take()) {
      playStaged();
      return;
    }
    // The actions the POV can take now, as the palette offers them, and letting time pass, which is
    // always there, so a world without actions still interprets. While the chat's policy suggests or
    // rolls inferred checks, Try something stands in for the world's own skill actions (DESIGN §11):
    // it rolls their checks under that policy, so a typed attempt is never read as both. With the
    // policy off (or no skill it allows), those actions stay, so typed text reads them as it did
    // before inferred checks existed.
    const mayKnow = (id: EntityId): boolean => povMayKnow(this.registry, render.world, render.state, id);
    const inferred = inferredOf(render.world, render.state);
    const sources = skillSources(this.registry, render.world, render.state);
    const skills = allowedSkills(inferred, sources);
    const trying = inferred.mode !== "off" && skills.length > 0;
    const offered = interpretCatalog(this.registry, render.world, render.state, trying ? all.filter((a) => !rolledByTry(a, sources)) : all, mayKnow);
    const catalog = [...offered.entries.map((o) => o.entry), ...(trying ? [tryEntry(inferred, skills)] : []), timelapseEntry(render.world, render.state)];
    const context: InterpretContext = {
      world: render.world,
      pov: { id: render.world.pov, name: render.state.entities[render.world.pov]?.name ?? render.world.pov },
      scene: interpretScene(this.registry, render.world, render.state, { mayKnow, named: offered.named, earlier, recent: recentOf("interpret", run.config), hideJson: settings.hideJsonBlocks, said: text, left }),
    };
    let result: InterpretRead | null;
    const lore = this.stepLore(run, at, { text: `${text}\n${this.trackWords(render.world, render.state)}`, links: this.sceneLinks(render.world, render.state) });
    if (run.config.route?.provider === "decision") {
      // A Decision route answers which action (or none); a helper call fills its params when it has any.
      const criteria: Record<string, string> = { none: "Not an action: speech, a request, a feeling, a recap, or out-of-character text that doesn't say time passes." };
      for (const c of catalog) criteria[c.id] = c.description ? `${c.label}: ${c.description}` : c.label;
      const answer = await this.steps.decide("interpret", { text, scene: context.scene.lines, recent: context.scene.recent }, { action: { type: "choice", instructions: run.template?.template ?? "Which engine action does the player character deliberately take in this typed input?", criteria } }, run.config, userId, budget.signal, lore, run.guidance);
      const a = answer?.answers.action;
      const chosen = a?.type === "choice" && a.choice !== "none" ? catalog.find((c) => c.id === a.choice) : undefined;
      if (!chosen) result = a?.type === "choice" ? { action: null, params: {}, probabilities: a.probabilities } : null;
      else if (chosen.params.length === 0) result = { action: chosen.id, params: {}, probabilities: a?.type === "choice" ? a.probabilities : { [chosen.id]: 1 } };
      // With no call left to fill its params, the action went unread, as when the call fails: a chip
      // says so, with Retry, rather than blaming the player for a place or person they did name.
      else if (!budget.take()) result = null;
      else result = await interpret(this.steps, text, context, [chosen], { ...run.config, route: { provider: "helper", connectionId: null, model: null } }, userId, budget.signal, undefined, lore, run.guidance);
    } else {
      result = await interpret(this.steps, text, context, catalog, run.config, userId, budget.signal, run.template ? renderTemplate(run.template.template, { world: render.world.name, pov: render.state.entities[render.world.pov]?.name ?? render.world.pov }) : undefined, lore, run.guidance);
    }
    // The call failed (a transient failure already had its second try): the turn runs as plain
    // roleplay, and a chip says the action went unread, with a Retry that runs the turn again.
    if (result === null) {
      // A staged action still plays: only the rest of the words go unread.
      if (staged) {
        playStaged();
        return;
      }
      this.host.log("warn", `[LumiRPEngine] interpret: couldn't read the player's action; the turn runs as plain roleplay`, userId);
      bridge.setOffer(text, null);
      bridge.setNext(text, null);
      bridge.setUnread(text);
      return;
    }
    // The staged action leads, with its own params: the player picked it, and their words say how
    // they go about it. All else the words read as stays (routine asks, claims, the queue, `then`).
    // Interpret's own main action is dropped when it is the staged one, and otherwise queued after
    // it; a time skip it read becomes the time the message lets pass once the actions have played.
    if (staged) {
      // The words interpret gave its own first action are that action's, not the staged one's.
      const { thing: _thing, text: _words, ...read } = result;
      const then = result.then ?? (result.action === TIMELAPSE_ACTION ? result.params : undefined);
      const own = result.action && result.action !== TIMELAPSE_ACTION && result.action !== staged.action ? [{ action: result.action, params: result.params, text: "", ...(result.thing ? { thing: result.thing } : {}) }] : [];
      result = { ...read, action: staged.action, params: staged.params, probabilities: { [staged.action]: 1 }, ...(then ? { then } : {}), queue: [...own, ...(result.queue ?? [])] };
    }
    if (result.reason) this.host.log("info", `[LumiRPEngine] interpret: no action (${result.reason})`, userId);
    // `interpret` may read secret lore its audience allows (DESIGN §7): what it returns becomes chips,
    // Journal lines and the Outcome, so an answer carrying a secret's unrevealed text is played as
    // roleplay. Words the player typed are theirs to repeat. Its further actions are checked on their own.
    const typedText = text.toLowerCase();
    const unrevealed = unrevealedSecrets(this.registry, render.world, render.state);
    const secrets = unrevealed.filter((s) => !typedText.includes(s.toLowerCase()));
    // A routine the message itself states is asked about on it, whatever the turn plays (DESIGN
    // §9.4): never played, so it stands apart from the actions and their checks.
    const asks = routineAsks(this.registry, render.world, render.state, result.routine ?? [], text, secrets, (p) => proposalKnown(p, this.registry, render.world, render.state));
    if ((result.routine ?? []).length > asks.length) this.host.log("info", `[LumiRPEngine] interpret: ${(result.routine ?? []).length - asks.length} routine change(s) the message doesn't state as its own or that don't hold; not asked`, userId);
    bridge.setRoutineAsks(text, asks);
    if (findLeaks({ params: result.params, ...(result.then ? { then: result.then } : {}) }, secrets).length > 0) {
      this.host.log("info", `[LumiRPEngine] interpret: ${result.action ?? "no action"} carried an unrevealed secret; played as roleplay`, userId);
      bridge.setOffer(text, null);
      bridge.setNext(text, null);
      playStaged();
      return;
    }
    // A puzzle's answer is the player's own (DESIGN §10): `saysAnswer` reads whether words give one as
    // the player's message must. Words the read offers to send (the chip, the intent gate's card)
    // that give an answer a puzzle expects and the message doesn't are the read's solution, never
    // the player's, so nothing offers them.
    const saysAnswer = answerReader(this.registry, render.world, render.state, mayKnow);
    const unsaidAnswers = expectedAnswers(render).filter((a) => saysAnswer(a, text) === null);
    const givesUnsaid = (words: string): boolean => unsaidAnswers.some((a) => saysAnswer(a, words) !== null);
    // Words the turn won't play are offered on a chip that sends them as the next message (DESIGN
    // §5.2), each piece only when it may be (`offeredNext`); "" when it may not.
    const chipText = (piece: string): string => (givesUnsaid(piece) ? "" : (offeredNext(this.registry, render.world, render.state, piece, text, secrets) ?? ""));
    let next = (result.next ?? []).map(chipText);
    // The player's own words for the first action, or for what fills a time skip, as the intent
    // gate's card quotes them (DESIGN §5.1): none when they carry a secret, name anything hidden the
    // player's message doesn't, or give an answer it doesn't.
    const lead = givesUnsaid(result.text ?? "") ? "" : (quotedWords(this.registry, render.world, render.state, result.text ?? "", secrets, text) ?? "");
    // An action's puzzle answers (`answerParams`) as the player gave them: each param the read filled
    // as the message gives it (`saysAnswer`: its own words, a number's digits without the words the
    // read added, or someone the POV may know whom the words pick out; a money param by its amount,
    // `saysAmount`), else the name of the first the message neither says nor picks out: drawn from
    // lore the read may see, a hidden person's name or the read's own solution. Such an action is no
    // answer and never a try at the puzzle, wherever the read put it: its decline repeats none of what
    // the read gave.
    const ownAnswers = (def: ActionDef, given: JsonObject): JsonObject | string => {
      let out = given;
      for (const name of answerParams(def)) {
        const v = given[name];
        if (own(def.params, name)?.type === "money") {
          if (typeof v === "number" && saysAmount(v, text, render.world.currency)) continue;
          return name;
        }
        const read = typeof v === "string" || typeof v === "number" ? String(v) : "";
        const played = saysAnswer(read, text);
        if (played === null) return name;
        if (played !== read) out = { ...out, [name]: played };
      }
      return out;
    };
    const dropped: UnfitAction[] = [];
    const dropAnswer = (def: ActionDef, param: string): void => {
      this.host.log("info", `[LumiRPEngine] interpret: ${def.id}'s ${param} isn't in the player's words; dropped`, userId);
      dropped.push({ label: def.label, reason: "the message doesn't say the answer itself, so it isn't a try at the puzzle" });
    };
    // A queued action left in words, when a time skip leads or the queue stops early, goes to the
    // chip and the intent gate's card only as the player's own: one answering a puzzle with what the
    // message doesn't give is dropped as a played one is, so neither offers the read's answer to send.
    const leftWords = (q: ReadAction): string => {
      const def = q.action === TRY_ACTION || q.action === TIMELAPSE_ACTION ? undefined : all.find((a) => a.id === q.action);
      const answered = def ? ownAnswers(def, playable(def, q.params, render.world, [q.text, text])) : q.params;
      if (def && typeof answered === "string") {
        dropAnswer(def, answered);
        return "";
      }
      return chipText(q.text);
    };
    // A time skip, the timelapse itself or time with no action before it (DESIGN §9.2), plays alone:
    // anything after it is offered in words once it has run. Time after another action ("I head home
    // and sleep until the next morning") is offered once the actions have run. The read names the
    // skip; its span is the read's own (its params, else a `then` it split off), else the one the
    // message states when it states exactly one, so a chosen skip isn't lost to a half-filled answer.
    if (result.action === TIMELAPSE_ACTION || (!result.action && result.then !== undefined)) {
      bridge.setNext(text, joinActions([...(result.queue ?? []).map(leftWords), ...next]) || null);
      const target = (result.action === TIMELAPSE_ACTION ? interpretedTarget(result.params, render.world, render.state, text, this.registry) : null) ?? (result.then ? interpretedTarget(result.then, render.world, render.state, text, this.registry) : null) ?? interpretedTarget({ span: text }, render.world, render.state, text, this.registry);
      if (!target) this.host.log("info", `[LumiRPEngine] interpret: lets time pass but states no span it can read; the turn plays as roleplay`, userId);
      // A span up to how long the user lets a skip run without asking runs in the turn; a longer one
      // is offered (a misread can't skip days unasked).
      const over = target?.type === "duration" && target.minutes > settings.time.askBeyondMinutes;
      // An offered span keeps the player's words for it and its hold, so its chip runs it as it would run here.
      bridge.setOffer(text, over ? target : null, { fill: lead, hold: true });
      // A span the player's words spend ("for the next two hours, I service the fleet") keeps the POV
      // where the story has it until it's over (DESIGN §8); a run to a routine point follows its routine.
      const intent = target && !over ? { ...timelapseIntent(target, undefined, 1, target.type !== "duration"), ...(lead !== "" ? { text: lead } : {}) } : null;
      if (dropped.length > 0) bridge.setUnfit(text, dropped, intent);
      else bridge.setIntent(text, intent, intent !== null);
      return;
    }
    const chosen = result.action ? all.find((a) => a.id === result.action) : undefined;
    const params = chosen ? playable(chosen, result.params, render.world, [text]) : result.params;
    // An action whose params name nothing in the world that fits, as the POV knows it ("I chat with
    // Rena" where Rena is no one in it), is dropped on its own, the first as much as a queued one, and
    // plays as plain roleplay: its reply's receipt says why (DESIGN §9.4). The rest of the message
    // still plays: an incidental action that names nothing never displaces the move the turn is
    // about. With nothing left to play, the turn is plain roleplay. A thing the player says they have
    // that the world doesn't ("I pour Theresa a coffee" with no coffee) is a claim the chat's policy
    // decides (`claimFor`): made real, asked about first (money always is), or dropped as above. Money
    // is paid to whom it names as the player character knows them: a party they can see, a known
    // thing's owner, else the action's outside account, the world's catch-all, for a receiver the
    // story hasn't established ("I drop $5 in the tip jar"); and, when neither the read nor the
    // player's words say how, in cash for one in front of them that their cash covers (`paidOutside`,
    // `handedCash`, DESIGN §9.4 typed money).
    const policy = claimsOf(render.world, render.state);
    const steps: ReadStep[] = [];
    // Whether a step that rolls its own check was kept: a Try something after it is never kept (DESIGN
    // §11), since the queue stops at that check, and leaving it in words would offer the same attempt again.
    let rolls = false;
    // `picked`: the staged action, whose params are the player's own picks, not the read's.
    const take = (def: ActionDef, read: JsonObject, words: string, thing: ThingSort | undefined, said: readonly string[], picked = false): void => {
      const answered = picked ? read : ownAnswers(def, read);
      if (typeof answered === "string") {
        dropAnswer(def, answered);
        return;
      }
      const paid = paidOutside(this.registry, def, answered, render.world, render.state, mayKnow, text);
      // A pick from the engine's own controls keeps the way of paying it was given (its pay order).
      const given = picked ? paid.params : handedCash(this.registry, def, answered, paid.params, render.world, render.state, mayKnow);
      const forWords = Object.keys(paid.said).length > 0 ? { said: paid.said } : {};
      // The staged action is the player's pick in the engine's own controls, held to its requirements (DESIGN §11).
      const pick = picked ? { picked: true as const } : {};
      // The player character's own thing that the world keeps elsewhere is a tracking gap, not a veto:
      // it goes to the claims policy rather than failing and stopping the message (DESIGN §9.4).
      const ref = unfitRef(this.registry, def, given, render.world, render.state, mayKnow) ?? outOfHand(def, given, render.world, render.state, mayKnow);
      if (!ref) {
        steps.push({ action: def.id, params: given, text: words, ...forWords, ...pick });
        rolls ||= checkOf(render.world, def.check) !== null;
        return;
      }
      // The claim reads the params as the read gave them, so a thing it finds the POV knows plays them
      // again, its receivers paid outside with the player's words as before (`paidOutside`).
      const verdict = claimFor({ registry: this.registry, world: render.world, state: render.state, action: def, params: answered, unfit: ref, said, thing, policy, mayKnow });
      // A thing the POV may know by those words keeps its own rules: the action takes it, and fits or fails as it would.
      if (verdict?.kind === "known") return take(def, verdict.params, words, undefined, said, picked);
      if (verdict?.kind === "real") steps.push({ action: def.id, params: given, text: words, claim: verdict.claim, ...forWords, ...pick });
      // Money is paid over with the economy's Pay in the read's place (`play`): cash the player
      // character carries with nothing added, else once what they lack is.
      else if (verdict?.kind === "play") steps.push({ ...verdict.play, text: words, ...pick });
      else if (verdict?.kind === "ask") steps.push({ ...(verdict.play ?? { action: def.id, params: given, ...forWords }), text: words, claim: verdict.claim, ask: { kind: "claim", question: verdict.question, detail: verdict.detail }, ...pick });
      else {
        this.host.log("info", `[LumiRPEngine] interpret: ${def.id} names nothing in the world (${JSON.stringify(given)}); dropped`, userId);
        // The receipt may echo the player's own words for what the read named, so it reads alike
        // whether or not anyone hidden goes by those words (DESIGN §5.2).
        dropped.push({ label: def.label, reason: unfitReason(this.registry, render.world, render.state, ref, text, secrets, mayKnow) });
        return;
      }
      rolls ||= checkOf(render.world, def.check) !== null;
    };
    // Try something (DESIGN §11 inferred checks), checked against the chat's policy and the world's
    // sheet: one that isn't a check here is no action, so the message plays without it (no decline:
    // nothing the player typed was wrong). Under suggest it waits on the player's Roll or No roll.
    const takeTry = (given: JsonObject, words: string): void => {
      const verdict = rolls ? ({ ok: false, why: "an action before it rolls its own check" } as const) : inferredRead(this.registry, render.world, render.state, given);
      if (!verdict.ok) {
        this.host.log("info", `[LumiRPEngine] interpret: Try something isn't a check here (${verdict.why}); the message plays without it`, userId);
        return;
      }
      // What is attempted shows on the question unless it names anything hidden the player's message doesn't.
      const asked = verdict.policy.mode === "suggest" ? checkQuestion(verdict, namesHiddenOrSecretLore(this.registry, render.world, render.state, verdict.read.attempt, text) ? "" : verdict.read.attempt, (id) => render.state.entities[id]?.name ?? id) : null;
      steps.push({ action: TRY_ACTION, params: verdict.params, text: words, ...(asked ? { ask: { kind: "check" as const, ...asked } } : {}) });
    };
    if (chosen) take(chosen, params, lead, result.thing, [text], staged !== null);
    else if (result.action === TRY_ACTION) takeTry(result.params, lead);
    // The further actions (DESIGN §11 action queue), each read as the first is. Time passing is never
    // queued: as the last it is the input's `then`, and earlier it ends the queue and is left in words.
    // One carrying a secret is dropped on its own, as a second action carrying one always was, and
    // what follows it, which may hang on it, is left in words. One that fails a check or a requirement
    // still stops the queue when it plays (`planTurn`).
    let then = result.then;
    // A queued time skip's own words for its span (`q.text`), offered with it, as an inline skip's would be told.
    let thenFill = "";
    const further = result.queue ?? [];
    for (const [k, q] of further.entries()) {
      const def = q.action === TRY_ACTION ? undefined : all.find((a) => a.id === q.action);
      if (q.action === TIMELAPSE_ACTION || (!def && q.action !== TRY_ACTION)) {
        if (k === further.length - 1 && !then && q.action === TIMELAPSE_ACTION) {
          then = q.params;
          thenFill = givesUnsaid(q.text) ? "" : (quotedWords(this.registry, render.world, render.state, q.text, secrets, text) ?? "");
        }
        else next = [...further.slice(k).map(leftWords), ...next];
        break;
      }
      if (findLeaks(q.params, secrets).length > 0) {
        next = [...further.slice(k + 1).map(leftWords), ...next];
        break;
      }
      if (!def) {
        takeTry(q.params, chipText(q.text));
        continue;
      }
      const ready = playable(def, q.params, render.world, [q.text, text]);
      take(def, ready, chipText(q.text), q.thing, [q.text, text]);
    }
    bridge.setNext(text, joinActions(next) || null);
    bridge.setOffer(text, then ? interpretedTarget(then, render.world, render.state, text, this.registry) : null, { fill: thenFill, hold: false });
    // A claim waiting on the player holds the read until it is answered (`TurnBridge.setRead`).
    bridge.setRead(text, { lead: result.action, params, probabilities: result.probabilities, chosen: chosen !== undefined || result.action === TRY_ACTION, ...(then ? { then } : {}), steps, dropped });
  }

  /** `puzzle.answer` (DESIGN §10): an Answer the stage can't match exactly is judged, then retried with the probability. */
  private async judgeAnswer(bridge: TurnBridge, text: string, render: { world: WorldDoc; state: WorldState }, settings: UserSettings, facts: SignalFacts, budget: StepBudget, at: LorePhase): Promise<void> {
    const intent = bridge.intentOf(text);
    if (!intent?.action || this.registry.actions.get(intent.action)?.pack !== "story" || intent.action !== "answer") return;
    // The model names the puzzle loosely, or not at all: resolve it as the story pack does.
    const track = openPuzzle(this.registry.context(render.world, render.state), typeof intent.params.puzzle === "string" ? intent.params.puzzle : "") ?? "";
    const answer = typeof intent.params.answer === "string" ? intent.params.answer : "";
    if (typeof intent.params.decision === "number" || !checkAnswer(render.world, render.state, track, answer).needsDecision) return;
    const stage = render.world.tracks[track]?.stages[render.state.tracks[track]?.stage ?? render.world.tracks[track]?.start ?? ""];
    const run = runsOf(settings.modelUse, render.world, "puzzle.answer", facts, { guidance: at.guidance })[0];
    if (!run || !stage?.answer || !budget.take()) return;
    const owner = render.world.tracks[track]?.owner;
    const p = await puzzleAnswer(this.steps, run, stage.label, stage.answer.expect, answer, at.userId, budget.signal, this.stepLore(run, at, { text: `${stage.label}\n${answer}`, links: owner ? [owner] : [] }));
    // Retried by the id the quest log shows it by, which the answer takes (a secret's stand-in), never its own.
    if (p !== null) bridge.amendIntent(text, { ...intent, params: { ...intent.params, puzzle: shownTrackId(render.world, track), decision: p } });
  }

  /**
   * The turn's action whose check `judge` would rate, with its place in the turn (0 the first, then
   * the queue's), its params, the check's verdict and odds, and the policy; null when the policy
   * doesn't need it (no check, not rolled or left to the story, or already judged). The queue stops
   * at its first check (DESIGN §11), so only the first action with one can roll. It is weighed in the
   * state the turn starts from, and isn't judged when that state doesn't offer it yet.
   */
  private judgeTarget(intent: InterpretOutput | null, render: { world: WorldDoc; state: WorldState }): { intent: InterpretOutput; index: number; action: ActionDef; params: JsonObject; verdict: Verdict; odds: Record<string, number>; policy: AdjudicationDef } | null {
    if (!intent?.action || intent.action === TIMELAPSE_ACTION) return null;
    const steps = [{ action: intent.action, params: intent.params, judgement: intent.judgement }, ...(intent.queue ?? [])];
    const index = steps.findIndex((s) => s.action === TRY_ACTION || checkOf(render.world, findAction(this.registry, render.world, s.action)?.check) !== null);
    const step = steps[index];
    // An inferred check is weighed against how hard it looks, so no opponent's numbers reach the judge (DESIGN §11).
    const tried = step?.action === TRY_ACTION ? tryJudged(this.registry, render.world, render.state, step.params) : null;
    const action = tried?.action ?? (step ? findAction(this.registry, render.world, step.action) : undefined);
    if (!step || !action || step.judgement) return null;
    const shown = actionOdds(this.registry, render.world, render.state, tried ?? { action, params: step.params });
    const policy = policyFor(render.world, render.state, action, render.world.pov);
    if (!shown.available || !shown.verdict || !shown.odds || !needsJudge(policy, shown.verdict)) return null;
    return { intent, index, action, params: tried?.params ?? step.params, verdict: shown.verdict, odds: shown.odds, policy };
  }

  /**
   * `judge` (DESIGN §11): when the policy would roll a check the player's words may shift, or leaves
   * it to the story, the approach the player described in words is rated (and the story's odds
   * given) before the plan; a palette or chip tap with no words of its own isn't. The answer rides
   * on the intent, so a Re-run reads the same judgement and the fold never asks.
   * It reads the lore its action, target, place and the player's words find (§5.4), a secret its
   * audience allows included, and it is told only who the POV can see. Its reason, which the roll
   * chip and the Journal show, is dropped (the rating stands) when it carries a secret's unrevealed
   * text the player didn't type, or names someone, a track or a place the POV can't see, or what leads
   * to a secret lore entry (`namesHiddenOrSecretLore`), that the player's message doesn't name too
   * (§7): their own words never blank it, which would tell them a name they typed is hidden.
   */
  private async judgeApproach(bridge: TurnBridge, text: string, render: { world: WorldDoc; state: WorldState }, settings: UserSettings, facts: SignalFacts, budget: StepBudget, at: LorePhase): Promise<void> {
    const userId = at.userId;
    const target = this.judgeTarget(bridge.intentOf(text), render);
    if (!target) return;
    const { intent, index, action, params, verdict, odds, policy } = target;
    const run = runsOf(settings.modelUse, render.world, "judge", facts, { guidance: at.guidance })[0];
    if (!run || !budget.take()) return;
    const story = verdict.why === "story" ? Object.fromEntries(outcomeChoices(action, Object.keys(odds)).map((o) => [o, odds[o] ?? 0])) : null;
    // The judge hears where the POV is as the player may know it: its reason is shown to the player.
    const placeName = povPlace(this.registry, render.world, render.state)?.name ?? null;
    const scene = { you: render.state.entities[render.world.pov]?.name ?? render.world.pov, place: placeName, present: presentNames(this.registry, render.world, render.state) };
    const targets = Object.values(params).filter((v): v is string => typeof v === "string" && (hasOwn(render.state.entities, v) || hasOwn(render.world.places, v)));
    const names = targets.map((id) => render.state.entities[id]?.name ?? render.world.places[id]?.name ?? id);
    const lore = this.stepLore(run, at, { text: [action.label, text, placeName ?? "", ...names].join("\n"), links: [...new Set([...this.sceneLinks(render.world, render.state), ...targets])] });
    const judgement = await judge(this.steps, run, { action: action.label, text, max: policy.description.max, odds: story, scene }, userId, budget.signal, lore);
    if (!judgement) {
      this.host.log("warn", `[LumiRPEngine] judge: no judgement for ${action.id}; ${story ? "the dice decide" : "the roll stands as shown"}`, userId);
      return;
    }
    const typed = text.toLowerCase();
    const secrets = unrevealedSecrets(this.registry, render.world, render.state).filter((s) => !typed.includes(s.toLowerCase()));
    const leaks = findLeaks(judgement.reason, secrets).length > 0 || namesHiddenOrSecretLore(this.registry, render.world, render.state, judgement.reason, text);
    if (leaks) this.host.log("info", `[LumiRPEngine] judge: the reason for ${action.id} carried an unrevealed secret or a hidden name; it isn't shown`, userId);
    const judged = leaks ? { ...judgement, reason: "" } : judgement;
    // The judgement rides on the action it rates: the first, or the queued one whose check it is.
    bridge.amendIntent(text, index === 0 ? { ...intent, judgement: judged } : { ...intent, queue: (intent.queue ?? []).map((q, i) => (i === index - 1 ? { ...q, judgement: judged } : q)) });
  }

  /** What `npc.choose` sees about one tie: who, where, when, and the options (private plans stay in this decision call). */
  private describeTie(t: Tie, world: WorldDoc, state: WorldState): JsonValue {
    const e = state.entities[t.agent];
    const place = placeOfEntity(state, t.agent);
    return { agent: e?.name ?? t.agent, at: place ? (world.places[place]?.name ?? place) : null, time: formatClock(calendarOf(world), state.clock), options: t.options };
  }

  /**
   * What a phase's step lore shares (DESIGN §5.4): its budget, the user's default connection (whose
   * tool support a step on it uses) with the user's record of connections refusing tools loaded,
   * where its traces go, what the player has seen said this turn, and the lore pinned where the POV
   * is and to each helper step (§24.5), read once. Nothing else is read from the host for a world
   * without lore.
   */
  private async lorePhase(phase: "pre" | "post", key: string, chatId: ChatId, userId: UserId, folded: WorldDoc, state: WorldState, budget: StepBudget, said: string, guidance: Guidance): Promise<LorePhase> {
    const world = await this.liveWorld(key, chatId, userId, folded);
    const here = pinsFor(world, placeOfEntity(state, world.pov));
    // The minds steps read their pins with their own calls (`runMinds`, `postMinds`, the skip's beats).
    const own = LORE_AUDIENCE.filter((step) => !isMindPurpose(step)).map((step) => [step, pinsFor(world, null, undefined, [step])] as const);
    const textsOf = await pinReader(this.host, world, [...here, ...own.flatMap(([, refs]) => refs)], userId);
    const at: LorePhase = { phase, key, userId, world, state, budget, active: ACTIVE_CONNECTION, said, guidance, pinned: textsOf(here), steps: Object.fromEntries(own.map(([step, refs]) => [step, textsOf(refs)])) };
    if (Object.keys(world.lore).length === 0) return at;
    await this.toolSupport.ready(userId);
    return { ...at, active: await this.activeConnectionId(userId) };
  }

  /**
   * A step run's lore (DESIGN §5.4): null when the world has none and nothing is pinned where the
   * POV is or to the step, or the step's policy is off and nothing is pinned to it. The step's own
   * pins go first, whatever its policy: the user chose them for it (§24.5); then, unless its policy
   * is off, the lore pinned where the POV is, and its prefetch searches the step's own inputs now,
   * at no call; its lookups go to the connection the step's helper calls use (a helper route's, else
   * the default), as tools unless the step says otherwise or that connection was seen refusing them.
   * Its trace is kept under the phase's key for the inspector, unless the step is about no one the
   * POV may know (`LoreInputs.shown` null). Snippets
   * cost the host's count of their text once it has one for this user, else the estimate, and are
   * counted in the background.
   */
  private stepLore(run: { purpose: StepPurpose; config: StepConfig }, at: LorePhase, inputs: LoreInputs, effects = false): StepLore | null {
    const { world, state, userId } = at;
    const chosen = at.steps[run.purpose] ?? [];
    if (Object.keys(world.lore).length === 0 && at.pinned.length === 0 && chosen.length === 0) return null;
    const setting = stepLoreOf(run.config);
    if (setting.policy === "none" && chosen.length === 0) return null;
    const route = run.config.route;
    const connection = route?.provider === "helper" && route.connectionId ? route.connectionId : at.active;
    const transport: LookupTransport = setting.transport === "tools" || setting.transport === "need" ? setting.transport : this.toolSupport.refuses(userId, connection) ? "need" : "tools";
    const refused = (reason: string): void => {
      void this.toolSupport.refuse(userId, connection, reason).catch((error: unknown) => this.host.log("warn", `[LumiRPEngine] the lore tool record wasn't saved (${error instanceof Error ? error.message : String(error)})`, userId));
    };
    const reader = { reg: this.registry, world, state, tokens: (text: string) => this.tokenCounts.get(hashParts("lre.tokens", userId, text)) ?? sectionTokens(text) };
    // The trace is shown to the player (§6.5, §7): it names no secret, no one the player hasn't met
    // and nowhere the POV can't see, and no lookup names a secret entry. Names are read as a judge's
    // reason is (`namesAny`), however short, in any script. Words the player has seen said this turn
    // are left alone: withholding them would only show which of them are secret.
    const said = at.said.toLowerCase();
    const unsaid = (s: string): boolean => !said.includes(s.toLowerCase());
    const people: string[] = [];
    const labels = unseenPlaceNames(this.registry, world, state, world.pov);
    for (const [id, e] of Object.entries(state.entities)) if (!povMayKnow(this.registry, world, state, id)) (kindIs(this.registry, world, e.kind, "person") ? people : labels).push(e.name);
    const withheld = { text: unrevealedSecrets(this.registry, world, state).filter(unsaid), people, labels, said: at.said, names: secretLoreNames(this.registry, world, state).filter(unsaid) };
    const lore = new StepLore(run.purpose, setting, reader, at.phase, withheld, { effects, counted: (texts) => this.countLater(userId, texts), lookups: { budget: at.budget.lookup, transport, refused }, privateInputs: inputs.shown !== undefined });
    lore.pin(chosen);
    if (setting.policy !== "none") lore.pin(at.pinned);
    lore.prefetch(inputs);
    if (inputs.shown !== null) lruSet(this.loreTraces, at.key, [...(this.loreTraces.get(at.key) ?? []), lore.trace], 64);
    return lore;
  }

  /** Who and where a scene's step is about: the POV, its place and the places that hold it, and the people it can see there. */
  private sceneLinks(world: WorldDoc, state: WorldState): string[] {
    const here = placeOfEntity(state, world.pov);
    const out = [world.pov];
    for (let place = here ?? undefined, i = 0; place !== undefined && i < 4; place = world.places[place]?.parent, i++) out.push(place);
    if (here) for (const id of Object.keys(state.entities)) if (id !== world.pov && placeOfEntity(state, id) === here && canSeeEntity(this.registry, world, state, world.pov, id)) out.push(id);
    return out;
  }

  /** The tracks the POV can see, as words a lore search can match: label, stage and cue. */
  private trackWords(world: WorldDoc, state: WorldState): string {
    const lines: string[] = [];
    for (const id of Object.keys(world.tracks)) {
      const t = playerTrack(this.registry, world, state, world.pov, id);
      if (t) lines.push([t.label, t.stage, t.cue ?? ""].join(" ").trim());
    }
    return lines.join("\n");
  }

  /**
   * What `npc.choose` searches lore with: the agents, their options and where they are. Its trace
   * shows only whose choice it is, by name where the POV knows them: the options are their private
   * plans (§7). A batch with no one the POV may know has no trace to show: a row for it would say
   * someone hidden is choosing.
   */
  private tieInputs(ties: readonly Tie[], world: WorldDoc, state: WorldState): LoreInputs {
    const links = ties.flatMap((t) => [t.agent, ...[placeOfEntity(state, t.agent)].filter((p): p is string => typeof p === "string")]);
    const text = ties.map((t) => `${state.entities[t.agent]?.name ?? t.agent}: ${t.options.map((o) => o.replace(/[_:.-]+/g, " ")).join(", ")}`).join("\n");
    const known = [...new Set(ties.filter((t) => povMayKnow(this.registry, world, state, t.agent)).map((t) => state.entities[t.agent]?.name ?? t.agent))];
    const last = known.at(-1);
    const shown = last === undefined ? null : known.length === 1 ? `${last}'s choice` : `${known.slice(0, -1).join(", ")} and ${last}'s choices`;
    return { text, links: [...new Set(links)], shown };
  }

  /**
   * Asks the host to count texts it hasn't counted for this user yet, in the background; later
   * reads use the counts. A count that isn't a finite number from 0 to `TOKEN_COUNT_CAP` times
   * the estimate is ignored, so a bogus count can't clip every section.
   */
  private countLater(userId: UserId, texts: readonly string[]): void {
    const asked = [...new Set(texts)].map((content) => [hashParts("lre.tokens", userId, content), content] as const).filter(([key]) => !this.tokenCounts.has(key));
    if (asked.length === 0) return;
    void this.settings
      .get(userId)
      .then((settings) =>
        this.host.tokens.count(
          asked.map(([, content]) => content),
          userId,
          settings.timeouts.tokenCountMs,
        ),
      )
      .then((counts) => {
        this.lateCounts.delete(userId);
        counts?.forEach((n, i) => {
          const [key, content] = asked[i] ?? ["", ""];
          if (key !== "" && Number.isFinite(n) && n >= 0 && n <= TOKEN_COUNT_CAP * sectionTokens(content)) lruSet(this.tokenCounts, key, n, 1024);
        });
      })
      .catch((error: unknown) => {
        // A count past the user's limit: the estimate stands in. Said once until a count lands in time.
        if (!(error instanceof TimeoutFired) || this.lateCounts.has(userId)) return;
        this.lateCounts.add(userId);
        this.diag.timeout({ chatId: null, userId, turn: null }, "sections", "token count", error, "sections are priced by the engine's estimate until a count comes back in time");
      });
  }

  /**
   * The world's book must stay in the chat's `chat_world_book_ids` (DESIGN §4.2): attaching another
   * chat book from the host's UI replaces the list, which would silently drop every engine section.
   */
  private async keepBookAttached(chatId: ChatId, bookId: string, userId: UserId): Promise<void> {
    const meta = await this.host.chats.chatMetadata(chatId, userId);
    const ids = Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids : [];
    if (ids.includes(bookId)) return;
    this.host.log("warn", `[LumiRPEngine] chat ${chatId}: the world's book was detached; re-attaching it`, userId);
    await this.book.attach(chatId, bookId, userId);
  }

  async beforeCommit(input: TurnContext): Promise<void> {
    const index = input.observed.findIndex((m) => m.id === input.messageId);
    const recent = recentLines(input.core, input.observed, index < 0 ? input.observed.length : index, this.registry);
    // A Continue reads what it added, matched against the whole message: a JSON block it split is left out whole (DESIGN §6.7).
    const full = input.kind === "continue" ? (input.observed[index]?.swipes[input.swipeId] ?? "") : "";
    let context: ReadInput | null;
    if (input.kind === "continue") {
      // On the head's fold, with no plan; none when the Continue is accepted unread, so no chip offers a change it won't hold.
      const at = input.core.continueContext(input.generationId, input.messageId, full, input.observed);
      context = at ? { state: at.state, world: at.world, seed: "", read: at.read, pre: [], start: at.state, recent } : null;
    } else {
      const at = input.core.commitContext(input.generationId, input.messageId, input.observed);
      context = at ? { ...at, recent } : null;
    }
    const before = full.endsWith(input.content) ? full.slice(0, full.length - input.content.length) : "";
    if (context) await this.prepareRead(input.chatId, input.userId, input.messageId, input.swipeId, input.generationId, input.content, context, input.kind !== "continue", false, before, input.signal);
  }

  /**
   * A phase's time limits that ran out, in the chat's diagnostics (DESIGN §6.9), each naming its
   * setting in Settings → Timeouts: the phase's own, which cut its remaining calls short (one set to
   * 0 ran none, as chosen), else its lookups' window or reserve, which kept a step from looking lore up.
   */
  timeLimits(at: DiagAt, phase: DiagPhase, budget: StepBudget): void {
    const fired = firedTimeout(budget.signal);
    if (fired?.ms === 0) this.diag.skipped(at, phase, "time limit", fired.message);
    else if (fired) this.diag.timeout(at, phase, "time limit", fired, TIMEOUTS[fired.key].fires);
    else if (budget.lookup.stopped) this.diag.skipped(at, phase, "lookups", budget.lookup.stopped);
  }

  /**
   * The post phase (DESIGN §5.2, §5.3), before the read commits: `extract` (or world `effects`
   * templates), off-screen `npc.choose` and `choices`, side by side on the post
   * budget. Proposals are sorted by mode (D4 precedence, then bounds); the automatic ones and the
   * decisions are prepared for the core's read; undo, confirm, Not tracked and choice chips are
   * stored. With `replace` (a Re-read edit, a Retry read), the read replaces the swipe's earlier one,
   * so that read's chips go first (`isReadChip`), the Timelapse offers of the skips it read among
   * them (`readLanded` makes the new read's). What the turn said of the player's message (a roll, a
   * receipt for an action played as roleplay or declined, the rest of the message) stays.
   */
  async prepareRead(chatId: ChatId, userId: UserId, messageId: MessageId, swipeId: number, key: string, content: string, context: ReadInput, post: boolean, replace = false, before = "", signal?: AbortSignal): Promise<void> {
    const settings = await this.settings.get(userId);
    // What the engine reads of the reply: none of the JSON blocks the display hides, matched against the
    // whole message when `before` holds the text a Continue went on from (DESIGN §6.7).
    const text = readableReply(before + content, settings.hideJsonBlocks, before.length);
    if (replace) await this.chips.removeWhere(chatId, userId, (c) => c.messageId === messageId && c.swipeId === swipeId && isReadChip(c.id));
    // A read that replaces an earlier one (Re-read, Retry read) reads World Info as it is now, not as that read did under the same key.
    if (replace) this.liveLores.delete(key);
    const bridge = this.bridges.get(chatId);
    if (!bridge) return;
    const input = { chatId, userId, messageId, generationId: key, content };
    const pre = this.prePhase.get(key);
    // Whether the chat tracks knowledge (DESIGN §24.11), read before the read's tasks start, so none waits unhandled on it.
    const knowing = knowledgeOn(await this.chatKnowledge.get(chatId, userId), context.world, settings);
    // A read without a pre phase (a Continue, Re-read edit, Retry read) takes the user's latest read
    // of the preset: the read itself asks the host for nothing more.
    const guidance = (pre?.preset ?? this.presets.last(userId)).guidance;
    const plan = bridge.planFor(context.seed);
    const ctx = this.registry.context(context.world, context.state);
    const ties = tiesOf(ctx, context.world, context.state);
    const facts: SignalFacts = { ...(pre?.facts ?? noFacts()), ...(pre ? planFacts(context.world, pre.start, context.state, plan) : {}), reply: text.trim() !== "", present: false, offscreen: ties.offscreen.length > 0, tieZone: ties.offscreen.length > 0 };
    // The user's reading time as set (Settings → Timeouts), with no silent floor.
    // Under the reply read's signal when the turn has one, so Cancel skips the reads still waiting.
    const budget = phaseBudget(settings, "post", signal);
    // The secrets the reply's steps may not repeat include the World Info ones this run reads (DESIGN §4.2, §7).
    const live = await this.liveWorld(key, chatId, userId, context.world);
    const secrets = unrevealedSecrets(this.registry, live, context.state);
    // The usual routines of the people with the POV, as it may know them: extract's own input, never a
    // fact, only to tell where a move the reply describes is going (DESIGN §9.4, §6.10). A world's own
    // extract or effects template reads them as `{{usual}}`.
    const usual = usualRoutineForExtract(ctx);
    // The brief the plan's step wrote, while the bridge still holds the plan (as `outcome` and `beats`).
    const vars = safeVars({ ...this.stepVars(context.world, context.state, plan, pre?.text ?? "", text, (plan && bridge.proseFor(context.seed)?.brief) ?? "", context.recent), usual: usual.join("\n") }, secrets);
    const modelUse = settings.modelUse;
    // What the reply's steps search lore with: the reply and the player's message, in the POV's scene.
    const read = { text: `${text}\n${pre?.text ?? ""}`, links: this.sceneLinks(context.world, context.state) };
    const at = await this.lorePhase("post", key, chatId, userId, context.world, context.state, budget, read.text, guidance);
    const lore = (r: StepRun, effects = false) => this.stepLore(r, at, read, effects);
    // Each step takes its call from the budget when it starts, in priority order.
    const extractRun = runsOf(modelUse, context.world, "extract", facts, { guidance }).find((r) => r.template === null || r.template.output !== "effects");
    // L27: a timelapse or speed-through turn's time passed as its timelapse, so its reply proposes no skip.
    const skipped = facts.timelapse || !!plan?.timelapse;
    // What extract is offered by name: places, the ones the reply and the player's message name and the
    // nearest first (DESIGN §9.4), and the kinds a newcomer may be.
    const places = extractRun ? placeMenu(this.registry, context.world, context.state, [text, pre?.text ?? ""], prefixEntities(this.registry, context.world, context.state).flatMap(({ e }) => (typeof e.fields.place === "string" ? [e.fields.place] : []))) : [];
    const personKinds = [...new Set([...Object.keys(context.world.kinds), ...this.registry.kinds.keys()])].filter((k) => kindIs(this.registry, context.world, k, "person"));
    const extractTask = extractRun && budget.take()
      ? extract(this.steps, text, povWorld(this.registry, context.world, context.state), prefixSummary(this.registry, context.world, context.state), clockMinutes(context.pre), EXTRACTION_TYPES.filter((t) => !(KNOWLEDGE_CHANGES as readonly string[]).includes(t) && (t === "time_advance" ? !skipped : this.registry.proposals.has(t))), extractRun.config, userId, budget.signal, extractRun.template ? renderTemplate(extractRun.template.template, vars) : undefined, lore(extractRun), extractRun.guidance, usual, extractRun.recent, pre?.text ?? "", places, personKinds)
      : Promise.resolve({ proposals: [], where: null });
    const effectsTasks = (["extract", "choices"] as const).flatMap((purpose) => runsOf(modelUse, context.world, purpose, facts, { output: "effects", guidance })).map((r) => (budget.take() ? promptedEffects(this.steps, r, vars, context.world.currency, userId, budget.signal, lore(r, true)) : Promise.resolve([])));
    const npcRun = runsOf(modelUse, context.world, "npc.choose", facts, { guidance })[0];
    const npcTask = npcRun && ties.offscreen.length > 0 && budget.take() ? npcChoose(this.steps, npcRun, ties.offscreen, (t) => this.describeTie(t, context.world, context.state), createRng(hashParts("lre.npc.post", bridge.runSeed, key)), userId, budget.signal, this.stepLore(npcRun, at, this.tieInputs(ties.offscreen, context.world, context.state))) : Promise.resolve([]);
    const choiceRuns = runsOf(modelUse, context.world, "choices", facts, { output: "text", guidance });
    // A suggestion names no one hidden that the player hasn't seen said, in their message or the reply,
    // or that the step's inputs don't name, read as the brief and the outline are (DESIGN §5.2, §7).
    const hidden = choiceRuns.length > 0 ? hiddenNameCheck(this.registry, live, context.state, live.pov, { stages: false }) : () => false;
    const heard = choiceRuns.length > 0 ? [read.text, ...Object.values(vars)].join("\n") : "";
    const unshown = (line: string): boolean => findLeaks(line, secrets).length > 0 || hidden(line, heard);
    const choiceTasks = choiceRuns.map((r) => (post && budget.take() ? promptedText(this.steps, r, "choices", vars, unshown, userId, budget.signal, lore(r)).then((lines) => lines ?? []) : Promise.resolve([])));
    // The minds' post phase (DESIGN §24.4, §24.11): who was present, their memory of what was written,
    // consolidation, and while the chat tracks knowledge, its seeding and the knowledge step, which
    // reads what the read found, so runs once it is in; beside the reply's other steps, on the phase's
    // wall clock. Their memory and consolidation read pinned lore as the run read it, World Info's
    // secrecy included (DESIGN §4.2). Its calls are a step of their own in diagnostics (DESIGN §6.9):
    // one cut off is the minds' failure there, never the read's, which commits without what it would
    // have kept either way.
    // What the read found, for the knowledge step: nothing when extract failed, which the read reports itself.
    const found = extractTask.then((r) => r.proposals.map((p) => describeProposal(p, ctx)), (): string[] => []);
    const mindsTask = post ? this.diag.step({ chatId, userId, turn: key }, "memory", "minds", () => postMinds(this.minds, { chatId, userId, world: live, start: context.start, state: context.state, pre: context.pre, messageId, user: pre?.text ?? "", reply: text, signal: budget.signal, guidance: { memory: guidance.memory ?? "", consolidate: guidance.consolidate ?? "", knowledge: guidance.knowledge ?? "" }, knowledge: knowing, read: found }), undefined, MINDS_POST_CALLS) : Promise.resolve<RunMindsResult>({ events: [], traces: [] });
    const [extracted, effects, decisions, choices, minded] = await Promise.all([extractTask, Promise.all(effectsTasks), npcTask, Promise.all(choiceTasks), mindsTask]);
    this.timeLimits({ chatId, userId, turn: key }, "read", budget);
    this.addMindTraces(chatId, key, minded.traces);
    // The reply's lore traces join its generation's inspector record (the pre phase's are there already).
    const traces = this.loreTraces.get(key);
    const inspected = traces ? this.inspector.records(chatId)?.find((r) => r.id === key) : undefined;
    if (traces && inspected) {
      inspected.lore = structuredClone(traces);
      this.inspector.save(chatId);
    }
    // Proposals naming what the POV can't know (a hidden or unmet entity, a secret place) are dropped,
    // and so is the turn's own action told again: a give of what it lent, a movement of money it made
    // (a withdrawal, a deposit, a transfer or a payment), a purchase it made (with the price the player
    // typed for this turn's Buy, in minor units, when there is one). A purchase that names the Buy with
    // other things keeps the others, each its own purchase; one that may be the Buy told again is only
    // ever offered ("Also bought …?").
    const intent = pre ? bridge.intentOf(pre.text) : null;
    // The prices the player typed for this turn's Buys (minor units), the first action's and the queued
    // ones', and the items as typed, whose words say what kind of thing the charged row's name may not.
    const buyActions = intent ? [{ action: intent.action, params: intent.params }, ...(intent.queue ?? [])].filter((a) => a.action === "buy") : [];
    const typed = buyActions.flatMap((a) => (typeof a.params.price === "number" ? [a.params.price] : []));
    const typedItems = buyActions.flatMap((a) => (typeof a.params.item === "string" ? [a.params.item] : []));
    const unsure = new Set<JsonObject>();
    // A move to someone's usual place ("usual") goes where their routine has them now, as the POV may
    // know it; one that resolves to none is left out (DESIGN §9.4).
    // The knowledge step's own change types (DESIGN §24.11) come only from it, never from a read.
    const narrated = [...resolveUsualMoves(ctx, extracted.proposals), ...effects.flat()].filter((p) => !(KNOWLEDGE_CHANGES as readonly string[]).includes(String(p.type)));
    // Where the reply leaves the POV when no move says so is a guess (a flashback, a phone call, a look
    // across the street read as being there): whatever the location mode it waits for Apply, and its
    // chip is no outcome for the type's learning (DESIGN §9.4). `never` still ignores it.
    const guessed = new Set(replyPlace(this.registry, extracted.where, narrated, context));
    const deduped = dedupeProposals(
      [...narrated, ...guessed].flatMap((p) => splitAlongBuy(p, context.pre, ctx, typedItems)),
      context.world.pov,
    ).filter((p) => {
      if (lentAlong(p, context.pre, context.state) || movedAlong(p, context.pre, context.state)) return false;
      const along = boughtAlong(p, context.pre, ctx, typed, text, typedItems);
      if (along === "unsure") unsure.add(p);
      return along !== "retold";
    });
    // A change carrying a secret's unrevealed truth is left out: its chip would show it.
    const unleaked = deduped.filter((p) => findLeaks(p, secrets).length === 0);
    if (unleaked.length < deduped.length) this.host.log("info", `[LumiRPEngine] read ${messageId.slice(0, 8)}: dropped ${deduped.length - unleaked.length} proposal(s) carrying an unrevealed secret`, userId);
    // One naming, in one of its references, anyone or anything the POV doesn't know never reaches its
    // channel, whether that is hidden or nowhere in the world: it is a receipt naming it only as
    // "someone you don't know" and the like, so every world reads the same (DESIGN §11). The log
    // counts those naming what the POV hasn't seen. Any other change naming that is left out.
    const unnamed: JsonObject[] = [];
    const named: JsonObject[] = [];
    for (const p of unleaked) (namesUnknown(ctx, p) ? unnamed : named).push(p);
    const unseen = unnamed.filter((p) => !proposalKnown(p, this.registry, context.world, context.state)).length;
    if (unseen > 0) this.host.log("info", `[LumiRPEngine] read ${messageId.slice(0, 8)}: dropped ${unseen} proposal(s) naming what the player hasn't seen, each a receipt that doesn't name it`, userId);
    const known = named.filter((p) => proposalKnown(p, this.registry, context.world, context.state));
    if (known.length < named.length) this.host.log("info", `[LumiRPEngine] read ${messageId.slice(0, 8)}: dropped ${named.length - known.length} proposal(s) naming what the player hasn't seen`, userId);
    // A change to someone's routine is the story's only for someone the reply speaks of: the player
    // character, or a person it names (DESIGN §9.4). It carries the reply's message as its turn, which
    // the model can't set, so the change records where it came from.
    const proposals = known.flatMap((p): JsonObject[] => {
      if (p.type !== "routine") return [p];
      const who = typeof p.entity === "string" ? p.entity : "";
      if (who === context.world.pov || namedInText(context.state.entities[who]?.name ?? "", text)) return [{ ...p, turn: messageId }];
      this.host.log("info", `[LumiRPEngine] read ${messageId.slice(0, 8)}: dropped a routine change for someone the reply doesn't name`, userId);
      return [];
    });
    this.host.log("info", `[LumiRPEngine] read ${messageId.slice(0, 8)}: ${proposals.length} proposal(s), ${decisions.length} npc decision(s), ${choices.flat().length} choice(s), ${budget.spent} post call(s)`, userId);
    const learning = await this.settings.learningOf(input.userId);
    // D4 learning counts on the connection that read the reply: the extract step's own, else the
    // helper model's. A chip-triggered read (Re-read, Retry read) or a Continue without a pre phase
    // was read on the user's default connection, the one Settings shows.
    const connection = helperCallOf(extractRun?.config, (await this.settings.get(userId)).helper).connectionId ?? pre?.connectionId ?? (await this.activeConnectionId(userId));
    const auto: JsonObject[] = [];
    const confirm: JsonObject[] = [];
    for (const p of proposals) {
      const type = EXTRACTION_TYPES.find((t) => t === p.type);
      if (!type) continue;
      const { mode: typeMode } = effectiveMode(settings, learning, connection, type);
      // What the change lands on: the entity and field its channel names (a thing's count or
      // condition, whose bound in Build applies), else the person it names and the field it gives.
      const target = this.registry.proposals.get(type)?.boundTarget?.(p, ctx) ?? null;
      const entity = target?.entity ?? (typeof p.entity === "string" ? p.entity : typeof p.who === "string" ? p.who : typeof p.from === "string" ? p.from : undefined);
      const field = target?.field ?? (typeof p.field === "string" ? p.field : undefined);
      const bounded = boundProposal(this.registry, context.world, context.state, { type, ...(entity ? { entity } : {}), ...(field ? { field } : {}), ...(typeof p.delta === "number" ? { delta: p.delta } : {}) }, { typeMode, ...(settings.extraction[type]?.maxDelta !== undefined ? { typeMaxDelta: settings.extraction[type]?.maxDelta } : {}) });
      if (bounded.mode === "never") continue;
      // A step limit of none (`maxDelta` 0) leaves a told change nothing to move, as `never` does: no chip.
      if (bounded.delta === 0 && typeof p.delta === "number" && p.delta !== 0) continue;
      // L27: whichever step proposed it (extraction or a world's effects step), on a Re-read too.
      if (type === "time_advance" && skipped) {
        this.host.log("info", `[LumiRPEngine] read ${messageId.slice(0, 8)}: dropped ${describeProposal(p)} (a timelapse turn's time passed as its timelapse)`, userId);
        continue;
      }
      const fitted = bounded.delta !== undefined ? { ...p, delta: bounded.delta } : p;
      if (unsure.has(p)) unsure.add(fitted);
      if (guessed.has(p)) guessed.add(fitted);
      if (bounded.mode === "auto" && !unsure.has(p) && !guessed.has(p)) auto.push(fitted);
      else confirm.push(fitted);
    }
    // The knowledge step's changes (DESIGN §24.11, C4), on the connection it ran on: the player
    // character's learnings and reveals by their own modes, as the read's chips; everyone else's with
    // the minds' events, unless the user's `learn` is never.
    const knew = minded.knowledge;
    const via = new Map<JsonObject, string>();
    let mindsEvents = minded.events;
    if (knew) {
      const knowledgeConnection = knew.connection ?? connection;
      if (effectiveMode(settings, learning, knowledgeConnection, "learn").mode !== "never") mindsEvents = [...minded.events, ...knew.events];
      for (const change of knew.proposals) {
        const p = change as unknown as JsonObject;
        const { mode } = effectiveMode(settings, learning, knowledgeConnection, change.type);
        if (mode === "never") continue;
        via.set(p, knowledgeConnection);
        (mode === "auto" ? auto : confirm).push(p);
      }
    }
    const reading: PreparedRead = { auto, post, events: decisions, minds: mindsEvents, askBeyond: settings.time.askBeyondMinutes };
    bridge.prepareRead(input.content, reading);
    // `choices` become chips below, with the read's others.
    // The state follows the story (DESIGN §11): each automatic proposal applies, with an undo chip,
    // and each confirm proposal gets a confirm chip. No limit the engine sets by default refuses one
    // (a pack's field bound, a per-reply cap, a route, a fight holding the clock, room, a body that
    // doesn't act); only the user's own mode and max delta and a field's range bound it. A change the
    // engine can't keep (something it has no place for, or naming what the POV doesn't know) gets a
    // Not tracked receipt, and nothing tells the next reply otherwise (DESIGN §9.5). A narrated
    // purchase or transfer is the story's and never fails for cover: its chip says where the money
    // came from and that account after it, with Pay another way when nothing covered it, and a
    // purchase nothing prices is the payer's with nothing charged, with Set price. A purchase's chip
    // shows what it charges, and one whose narrated price was capped or clamped can be re-priced.
    const w = new Working(this.registry, context.world, context.state);
    // As the commit reads the reply (`applyRead`) and on its seed, so a chip's events are the record's
    // own (Undo and Pay another way find them), and a payment's chip reads its account as that payment left it.
    const outcomes: (ProposalOutcome & { paid: PaidFrom | null })[] = [];
    applyRead(this.registry, w, reading, context.read, bridge.runSeed, (o) => outcomes.push({ ...o, paid: optionalQuery(w.ctx, "economy.paid_from")?.(w.ctx, o.events, context.world.pov) ?? null }));
    const stored: StoredChip[] = [];
    // One naming what the POV doesn't know is refused for that alone, under any mode but its type's
    // `never`, and never by bounds, which would tell of whom it names.
    const declines: { proposal: JsonObject; reason: string; code: string }[] = unnamed.filter((p) => EXTRACTION_TYPES.some((t) => t === p.type && effectiveMode(settings, learning, connection, t).mode !== "never")).map((proposal) => ({ proposal, reason: UNKNOWN_REASON, code: "unknown_ref" }));
    outcomes.forEach((o, i) => {
      if (o.rejection) {
        this.host.log("info", `[LumiRPEngine] read ${input.messageId.slice(0, 8)}: ${describeProposal(o.proposal)} didn't apply (${o.rejection.code}: ${o.rejection.reason})`, input.userId);
        declines.push({ proposal: o.proposal, reason: o.rejection.reason, code: o.rejection.code });
        return;
      }
      const type = String(o.proposal.type);
      const id = `undo:${input.messageId}:${input.generationId}:${i}`;
      // A purchase nothing prices is the payer's, with nothing charged: its chip prices it.
      if (o.proposal.type === "purchase" && optionalQuery(ctx, "economy.unpriced")?.(ctx, o.proposal) === true) {
        stored.push(unpricedChip(id, { messageId, swipeId }, o.proposal, ctx, o.events, { type, connection }));
        return;
      }
      // A change refused unseen comes back as one that changed nothing: no chip, and the next reply
      // hears nothing of it; the log says why.
      if (o.events.length === 0) {
        if (o.dropped) this.host.log("info", `[LumiRPEngine] read ${input.messageId.slice(0, 8)}: dropped ${describeProposal(o.proposal)} (${o.dropped})`, input.userId);
        return;
      }
      const quote = purchaseQuote(o.proposal, o.events, context.world);
      const money = paidWords(o.paid, context.world);
      stored.push({
        id,
        kind: "undo",
        messageId: input.messageId,
        swipeId,
        label: `${describeProposal(o.proposal, ctx)}${quote?.text ?? ""}${money.label}`,
        detail: ["Applied automatically.", money.detail].filter((s) => s !== "").join(" "),
        actions: [...(money.over ? [{ ...PAY_ANOTHER_WAY, style: "primary" as const }] : []), { id: "undo", label: "Undo", style: "danger" }, ...(quote?.limited ? [{ id: "amount", label: "Edit amount", input: { type: "money" as const, label: "Amount", value: quote.cents } }] : [])],
        expires: "next_send",
        payload: { type, connection: via.get(o.proposal) ?? connection, events: JSON.parse(JSON.stringify(o.events)) as JsonValue },
      });
    });
    // The reply's confirm changes as told, one after another, after its automatic ones: each is
    // checked on what the ones before it leave, as they would apply in order.
    const told = new Working(this.registry, context.world, w.state);
    confirm.forEach((proposal, i) => {
      // A narrated time skip under confirm (DESIGN §9.4) is checked as it would apply automatically:
      // whole, with its catch-up, after this read's automatic changes. One that fits is offered for
      // Apply; a longer one, or one whose catch-up can't run whole, gets the Timelapse chip instead,
      // so narrated time is never dropped.
      if (proposal.type === "time_advance") {
        const advance = applyTimeAdvance(this.registry, new Working(this.registry, context.world, w.state), typeof proposal.minutes === "number" ? Math.round(proposal.minutes) : 0, { runSeed: bridge.runSeed, capMinutes: settings.time.askBeyondMinutes, unitCap: w.state.time.unitCap });
        // A Continue's offer (a read with no post steps) is its own, beside the reply's.
        if (advance.chip) stored.push(skipAheadChip(post ? `adv:${messageId}:${swipeId}:c${i}` : `adv:${messageId}:${swipeId}:${key}:c${i}`, { messageId, swipeId }, advance.chip.target, advance.reason === "unit_cap" ? "unit_cap" : "over_cap"));
        else if (advance.applied) {
          stored.push({
            id: `confirm:${input.messageId}:${input.generationId}:${i}`,
            kind: "confirm",
            messageId: input.messageId,
            swipeId,
            label: describeProposal(proposal, ctx),
            detail: "The narration says this much time passed. Apply it?",
            actions: [
              { id: "confirm", label: "Apply", style: "primary" },
              { id: "reject", label: "No" },
            ],
            expires: "next_send",
            payload: { type: "time_advance", connection, proposal },
          });
        } else this.host.log("info", `[LumiRPEngine] read ${input.messageId.slice(0, 8)}: dropped ${describeProposal(proposal)} (no time to pass)`, input.userId);
        return;
      }
      // Offer Apply for what would apply now: anything refused gets a receipt as under auto, and a
      // purchase nothing prices asks for its price beside Apply. Each is checked after the reply's
      // confirm changes told before it (`told`), so a crack and its repair both ask, as told.
      const also = unsure.has(proposal);
      // A change the player is likely to decline (a purchase that may be their own typed Buy told
      // again, a move the reply only implied) is checked on a copy, so what's told after it doesn't
      // count it: its account, limit and Pay another way read as if it weren't there.
      const against = also || guessed.has(proposal) ? new Working(this.registry, context.world, told.state) : told;
      const [check] = applyProposals(this.registry, against, [proposal], `${context.seed}:check`, bridge.runSeed);
      // A move the reply only implied that can't happen is no told move: no chip (DESIGN §9.4).
      if (check?.rejection && guessed.has(proposal)) {
        this.host.log("info", `[LumiRPEngine] read ${input.messageId.slice(0, 8)}: dropped a guessed move (${check.rejection.code}: ${check.rejection.reason})`, input.userId);
        return;
      }
      // Anything refused is shown as an automatic refusal is, never vanishing: a change the engine
      // can't keep (a move to a place it doesn't have, a payment of no amount) is untracked; what it
      // names is what the POV may know (`namesUnknown` and `proposalKnown` took the rest before
      // here), and a refusal unseen comes back as no change and is dropped below.
      if (check?.rejection) {
        declines.push({ proposal, reason: check.rejection.reason, code: check.rejection.code });
        return;
      }
      const unpriced = proposal.type === "purchase" && optionalQuery(ctx, "economy.unpriced")?.(ctx, proposal) === true;
      if (!check || (check.events.length === 0 && !unpriced)) {
        this.host.log("info", `[LumiRPEngine] read ${input.messageId.slice(0, 8)}: dropped ${describeProposal(proposal)} (${check?.dropped ?? "no change"})`, input.userId);
        return;
      }
      // Applied with the check's seed, so a purchase charges the amount its label shows.
      const seed = `${context.seed}:check`;
      if (unpriced) {
        const pricing = pricingActions(proposal, ctx);
        const priceWords = pricing.length > 1 ? "Set price or Pick item" : "Set price";
        stored.push({
          id: `confirm:${input.messageId}:${input.generationId}:${i}`,
          kind: "confirm",
          messageId: input.messageId,
          swipeId,
          label: `${also ? "Also bought" : "Bought"} ${describeItem(proposal)}: no price`,
          detail: unpricedAsk(proposal, ctx, check.events.length > 0, priceWords),
          actions: [...pricing, ...(check.events.length > 0 ? [{ id: "confirm", label: "Apply" }] : []), { id: "reject", label: "No" }],
          expires: "next_send",
          payload: { type: "purchase", connection, proposal, seed },
        });
        return;
      }
      const quote = purchaseQuote(proposal, check.events, context.world);
      const money = paidWords(optionalQuery(against.ctx, "economy.paid_from")?.(against.ctx, check.events, context.world.pov) ?? null, context.world);
      // A guessed move says why it asks (where the engine has the POV, as every player surface names
      // it) and carries no type, so Apply or No on it counts nothing toward the learning (DESIGN §11).
      const guess = guessed.has(proposal);
      const here = guess ? povPlace(this.registry, context.world, context.state) : null;
      stored.push({
        id: `confirm:${input.messageId}:${input.generationId}:${i}`,
        kind: "confirm",
        messageId: input.messageId,
        swipeId,
        label: also ? `Also bought ${describeItem(proposal)}?${quote?.text ?? ""}${money.label}` : `${describeProposal(proposal, ctx)}${quote?.text ?? ""}${money.label}`,
        detail: [money.detail, also ? "The reply may be telling your purchase again. Apply it only if this was bought too." : guess ? `The reply has you there, but the engine still has you ${here?.id ? `at ${here.name}` : "elsewhere"}. Apply the move?` : proposal.type === "reveal" ? "The story revealed a secret to you. Apply opens it in What you know and on your other screens; No keeps it from you." : "The narration says this happened. Apply it?"].filter((s) => s !== "").join(" "),
        actions: [{ id: "confirm", label: "Apply", style: "primary" }, ...(money.over ? [PAY_ANOTHER_WAY] : []), ...(quote?.limited ? [{ id: "amount", label: "Edit amount", input: { type: "money" as const, label: "Amount", value: quote.cents } }] : []), { id: "reject", label: "No" }],
        expires: "next_send",
        payload: { ...(guess ? {} : { type: String(proposal.type), connection: via.get(proposal) ?? connection }), proposal, seed },
      });
    });
    declines.forEach((d, i) => {
      // What the engine holds already (a fact already known, a death already so) changed nothing to show.
      if (ALREADY_SO.has(d.code)) {
        this.host.log("info", `[LumiRPEngine] read ${input.messageId.slice(0, 8)}: dropped ${describeProposal(d.proposal)} (${d.code}: ${d.reason})`, input.userId);
        return;
      }
      // What the engine has no place for or can't keep as told (a thing as a newcomer, a change
      // naming anyone or anything the POV doesn't know, a payment of no amount) still happened in the
      // story: a receipt says so, with no decision to make, and the next reply is never told
      // otherwise. It names only what the POV knows (`describeProposal`), so it reads the same whether
      // or not the world holds what it names.
      stored.push({
        id: `untracked:${input.messageId}:${input.generationId}:${i}`,
        kind: "untracked",
        messageId: input.messageId,
        swipeId,
        label: `Not tracked: ${describeProposal(d.proposal, ctx)}`,
        detail: `${d.reason.replace(/[.\s]+$/, "")}. The story stands as told, and the next reply isn't told otherwise.`,
        actions: [],
        expires: "next_send",
        payload: { type: String(d.proposal.type), proposal: d.proposal, reason: d.reason },
      });
    });
    // Suggested next moves (DESIGN §5.2 choices): one tap sends it as the player's message.
    choices.flat().forEach((choice, i) => {
      stored.push({ id: `choice:${messageId}:${key}:${i}`, kind: "choice", messageId, swipeId, label: choice, actions: [{ id: "send", label: "Send" }], expires: "next_send", payload: { text: choice } });
    });
    await this.chips.add(input.chatId, input.userId, stored);
    // Kept by the read's key, so a read cancelled before its turn commits takes them back (`readStopped`).
    this.readStored.set(key, stored.map((c) => c.id));
    if (this.readStored.size > 64) this.readStored.delete(this.readStored.keys().next().value ?? "");
  }

  async afterCommit(input: TurnContext): Promise<void> {
    this.meter.close(input.userId);
    const bridge = this.bridges.get(input.chatId);
    if (!bridge) return;
    const rec = input.core.chain(input.observed).find((x) => x.id === input.messageId)?.ledger?.swipes[String(input.swipeId)] ?? input.core.journal.messages[input.messageId]?.ledger.swipes[String(input.swipeId)];
    const stored: StoredChip[] = [];
    const at = `${input.messageId}:${input.swipeId}`;
    const base = { messageId: input.messageId, swipeId: input.swipeId };
    const plan = rec ? bridge.planFor(rec.seed) : undefined;
    if (rec && rec.seed !== "" && !plan && input.kind !== "renarrate" && input.kind !== "continue") this.host.log("warn", `[LumiRPEngine] chat ${input.chatId}: no engine plan for the committed turn (seed ${rec.seed.slice(0, 8)}); its chips are missing`, input.userId);
    const idx = input.observed.findIndex((m) => m.id === input.messageId);
    // The chips after the reply answer the turn's own message (`ownMessage`): a new reply after a reply
    // has none, so it repeats no decline, rest of the message, Timelapse offer or failed read that
    // the bridge still keeps for the message before the reply it follows.
    const user = ownMessage(input.observed.slice(0, idx < 0 ? input.observed.length : idx));
    const userText = user ? (user.swipes[user.swipeId] ?? "") : "";
    // Rolls and odds, and an action that couldn't run (DESIGN §12 chips), from the turn's actions as they played.
    const played = plan?.resolutions ?? [];
    const checked = played.map((res) => `action ${res.action}, check ${res.check?.outcome ?? (res.adjudged ? `${res.outcome ?? "-"} (no roll: ${res.adjudged.why ?? "-"})` : "-")}`);
    this.host.log("info", `[LumiRPEngine] turn ${input.messageId.slice(0, 8)}:${input.swipeId} ${input.kind}: plan ${plan ? "yes" : "no"}, ${checked.length > 0 ? checked.join("; ") : "action -"}${plan?.stopped ? `; queue stopped (${plan.stopped.cause}) with ${plan.stopped.left} left` : ""}`, input.userId);
    if (played.length > 0) {
      // The actions live in the revision the chat folds at (after any Upgrade), not the run's first.
      const world = input.core.worldAt(input.core.fold(input.observed).state.revision) ?? input.core.worldAt(rec?.defHash ?? "");
      const labelOf = (res: Resolution): string => res.inferred?.label ?? (world?.actions[res.action] ?? this.registry.actions.get(res.action))?.label ?? res.action;
      for (const [i, res] of played.entries()) {
        const label = labelOf(res);
        // A turn of one action keeps the chip ids it always had.
        const n = i === 0 ? "" : `:${i}`;
        const chip = rollChip(label, res);
        if (chip) stored.push({ id: `roll:${at}${n}`, kind: "roll", ...base, label: chip.label, detail: chip.detail, actions: [], expires: "never", payload: {} });
        // One the engine couldn't play as things stand (a plain requirement that didn't hold, a payment
        // the money can't cover) played as plain roleplay (DESIGN §11): a receipt says why. A hard lock,
        // or anything else that kept it from running, declines.
        if (playsAsRoleplay(res) && res.failed) stored.push({ id: `roleplay:${at}${n}`, kind: "untracked", ...base, label: `${label}: played as roleplay`, detail: `${unplayedWords(res.failed)}. It played as plain roleplay.`, actions: [], expires: "next_send", payload: {} });
        else if (!res.ok && res.failed) stored.push({ id: `decline:${at}${n}`, kind: "decline", ...base, label: `${label}: couldn't`, detail: playerReason(res.failed), actions: [], expires: "next_send", payload: {} });
        else if (res.rejected.length > 0) stored.push({ id: `decline:${at}${n}`, kind: "decline", ...base, label: `${label}: declined`, detail: res.rejected.map((r) => r.rejection.reason).join("; "), actions: [], expires: "next_send", payload: {} });
        // A thing the player said they had, made real for this action (DESIGN §9.4), or money put in their cash: Undo takes it back, with what the action did.
        if (res.claimed && input.kind !== "renarrate" && input.kind !== "continue") stored.push({ id: `claimed:${at}${n}`, kind: "claimed", ...base, label: res.claimed.cents !== undefined ? `Added: ${res.claimed.name} in cash` : `Added: ${/^[aeiou]/i.test(res.claimed.name) ? "an" : "a"} ${res.claimed.name}`, detail: "You said you had it, so the world has it now. Undo takes it back, with what you did with it.", actions: [{ id: "undo", label: "Undo", style: "danger" }], expires: "next_send", payload: { events: JSON.parse(JSON.stringify(res.claimed.events)) as JsonValue } });
      }
      // Typed text `interpret` read as actions (DESIGN §9.4, §11): one tap undoes what they did.
      const done = played.filter((res) => res.ok && res.events.length > 0);
      if (done.length > 0 && input.kind !== "renarrate" && input.kind !== "continue" && bridge.wasInterpreted(userText)) {
        stored.push({ id: `not_action:${at}`, kind: "not_action", ...base, label: "Not an action?", detail: `Read as ${done.map((res) => `"${labelOf(res)}"`).join(", then ")}. Undo it if you only meant to say it.`, actions: [{ id: "undo", label: "Not an action", style: "danger" }], expires: "next_send", payload: { text: userText, events: JSON.parse(JSON.stringify(inRecordOrder(plan?.events ?? [], done.flatMap((res) => res.events)))) as JsonValue } });
      }
    }
    // `interpret` couldn't read the typed text (DESIGN §9.4): its call failed, or a Decision route's choice
    // had no call left for its params. The turn ran as plain roleplay. Retry runs it again, as the swipe
    // chip's Re-run does, and reads the text afresh.
    if (input.kind !== "continue" && userText.trim() !== "" && bridge.wasUnread(userText)) {
      stored.push({ id: `read_failed:${at}`, kind: "read_failed", ...base, label: "Couldn't read your action", detail: "The call that reads your message failed, or none was left before the reply, so this turn ran as plain roleplay. Retry runs the turn again.", actions: [{ id: "rerun", label: "Retry", style: "primary" }], expires: "next_send", payload: {} });
    }
    // `interpret` dropped actions whose params name nothing in the world that fits (DESIGN §9.4): the
    // rest of the message played without them, or, with none left, the turn ran as plain roleplay.
    // Each played as plain roleplay: a receipt says why the engine couldn't play it, about that action
    // alone, and the next reply hears nothing of it. It is about the typed message, so a later read of
    // this reply keeps it (`prepareRead`).
    const unfit = input.kind === "continue" ? [] : bridge.unfitOf(userText);
    const what = bridge.intentOf(userText) !== null ? "It" : "Your message";
    unfit.forEach((u, i) => {
      const reason = `${u.reason.charAt(0).toUpperCase()}${u.reason.slice(1)}`;
      stored.push({ id: unfitId(input.messageId, input.swipeId, i), kind: "untracked", ...base, label: `${u.label}: played as roleplay`, detail: `${reason}. ${what} played as plain roleplay.`, actions: [], expires: "next_send", payload: {} });
    });
    const hold = holdOf(bridge, userText, plan);
    stored.push(...(await this.turnOffers({ chatId: input.chatId, userId: input.userId, messageId: input.messageId, swipeId: input.swipeId, kind: input.kind, core: input.core, observed: input.observed, bridge, rec, plan, userText, hold, read: bridge.chipsFor(input.content) })));
    // What the turn didn't play of the message (DESIGN §5.2, §11): the queued actions left when the
    // queue stopped, then the words no action reads. One tap sends it as the next message, as a
    // suggested choice does, and it plays as the next turn, with its own prices, time and checks.
    const left = plan?.stopped ? (bridge.intentOf(userText)?.queue ?? []).slice(-plan.stopped.left).map((q) => q.text) : [];
    const next = input.kind === "continue" ? "" : joinActions([...left, bridge.nextOf(userText) ?? ""]);
    if (next !== "") stored.push({ id: restChipId(input.messageId, input.swipeId), kind: "choice", ...base, label: next, detail: `The rest of your message${plan?.stopped ? `: ${STOPPED[plan.stopped.cause]}` : ""}. Send plays it as its own turn.`, actions: [{ id: "send", label: "Send" }], expires: "next_send", payload: { text: next } });
    // An interrupt ended the timelapse early (DESIGN §9.2): say why, and offer the rest of the run.
    const summary = plan?.timelapse?.summary;
    if (summary?.stoppedBy && !(plan?.chips ?? []).some((c) => c.kind === "continue_timelapse")) {
      const elapsed = summary.to - summary.from;
      const rest = summary.target.type === "duration" ? { type: "duration" as const, minutes: Math.max(1, summary.target.minutes - elapsed) } : summary.target;
      const left = rest.type === "duration" ? ` (${compactSpan(rest.minutes)} left)` : "";
      // The rest of a span the player's message filled keeps its words, as it keeps its hold (DESIGN §9.2).
      stored.push({ id: `tl:${at}:stop`, kind: "continue_timelapse", ...base, label: `Timelapse stopped: ${summary.stoppedBy === "mind" ? (plan?.timelapse?.mindName ?? "someone") : STOP_LABEL[summary.stoppedBy]}`, detail: `Continue to the original target${left}?`, actions: [{ id: "timelapse", label: "Continue", style: "primary" }], expires: "next_send", payload: { target: JSON.parse(JSON.stringify(rest)) as JsonValue, ...hold, ...(plan?.fill ? { fill: plan.fill } : {}) } });
    }
    // A Continue's offers are its own, beside those of the reply it went on from (DESIGN §9.4).
    const offer = input.kind === "continue" ? `adv:${at}:${input.generationId}` : `adv:${at}`;
    for (const [i, chip] of bridge.chipsFor(input.content).entries()) stored.push(skipAheadChip(`${offer}:${i}`, base, chip.target, chip.reason));
    await this.chips.add(input.chatId, input.userId, stored);
  }

  /**
   * A swipe deleted on a message (DESIGN §4.3 swipe identity): its chips go and the later swipes'
   * move down, as the ledger's records do, so none shows, or applies, on the swipe that takes its
   * index.
   */
  private async swipeDeleted(chatId: ChatId, userId: UserId, messageId: MessageId, deleted: number): Promise<void> {
    await this.chips.shiftSwipes(chatId, userId, messageId, deleted);
    this.changed(chatId, userId);
  }

  /** The chip ids each read stored (`prepareRead`), by its key: a read cancelled midway takes them back. */
  private readonly readStored = new Map<string, string[]>();

  /**
   * The reply's read was cancelled: its turn commits stopped and unread (DESIGN §5.1 step 6), so
   * the chips the read stored for it go, and its Retry read reads it again.
   */
  async readStopped(input: TurnContext): Promise<void> {
    const ids = new Set(this.readStored.get(input.generationId) ?? []);
    this.readStored.delete(input.generationId);
    if (ids.size === 0) return;
    await this.chips.removeWhere(input.chatId, input.userId, (c) => ids.has(c.id));
    this.changed(input.chatId, input.userId);
  }

  /** Hears the writes that land (`onWritesLanded`). */
  private readonly landedListeners = new Set<(input: LandedWrites) => void>();

  /**
   * Hears every batch of writes that lands (P2), at once or behind a reply, inside the ledger
   * operation that landed it: a listener reads what it needs there and leaves its own work for after.
   * The GM assistant names a held proposal's Undo chip this way once its write lands.
   */
  onWritesLanded(listener: (input: LandedWrites) => void): () => void {
    this.landedListeners.add(listener);
    return () => this.landedListeners.delete(listener);
  }

  /**
   * Writes that landed (P2): a Re-read or Retry read offers what its read found (`readLanded`),
   * whether it landed at once or behind a reply, however that reply's window closed. Of a swipe's
   * reads that landed together, the last is the one that stands.
   */
  async writesLanded(input: LandedWrites): Promise<void> {
    for (const listener of this.landedListeners) listener(input);
    const reads = new Map<string, { messageId: MessageId; swipeId: number }>();
    for (const w of input.writes) if (w.kind === "reread" || w.kind === "retry_read") reads.set(`${w.messageId}:${w.swipeId}`, { messageId: w.messageId, swipeId: w.swipeId });
    for (const r of reads.values()) await this.readLanded(input, r.messageId, r.swipeId);
  }

  /**
   * A Re-read or Retry read landed (DESIGN §9.4): a narrated skip it read that runs longer than a
   * skip may without asking is offered as a Timelapse, as a turn's commit offers its own read's
   * (`afterCommit`). While the reply is still the latest, so its turn's offers stand, those are
   * sized again against the new read: the time the player's message asked for, and the plan's.
   */
  private async readLanded(at: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[] }, messageId: MessageId, swipeId: number): Promise<void> {
    const bridge = this.bridges.get(at.chatId);
    const chain = at.core.chain(at.observed);
    const m = chain.find((x) => x.id === messageId);
    if (!bridge || !m) return;
    const read = bridge.chipsFor(activeText(m));
    const chips: StoredChip[] = [];
    const rec = m.ledger?.swipes[String(swipeId)] ?? at.core.journal.messages[messageId]?.ledger.swipes[String(swipeId)];
    const plan = rec ? bridge.planFor(rec.seed) : undefined;
    if (plan && chain.at(-1)?.id === messageId) {
      const idx = at.observed.findIndex((x) => x.id === messageId);
      const user = ownMessage(at.observed.slice(0, idx < 0 ? at.observed.length : idx));
      const userText = user ? (user.swipes[user.swipeId] ?? "") : "";
      const own = `${messageId}:${swipeId}`;
      await this.chips.removeWhere(at.chatId, at.userId, (c) => c.messageId === messageId && c.swipeId === swipeId && (c.id === `tlo:${own}` || (c.id.startsWith(`tl:${own}:`) && /^\d+$/.test(c.id.slice(`tl:${own}:`.length)))));
      chips.push(...(await this.turnOffers({ ...at, messageId, swipeId, kind: "normal", bridge, rec, plan, userText, hold: holdOf(bridge, userText, plan), read })));
    }
    chips.push(...read.map((chip, i) => skipAheadChip(`adv:${messageId}:${swipeId}:${i}`, { messageId, swipeId }, chip.target, chip.reason)));
    await this.chips.add(at.chatId, at.userId, chips);
    this.changed(at.chatId, at.userId);
  }

  /**
   * The turn's Timelapse offers, sized against what its reply's read told (DESIGN §9.2, §9.4): the
   * plan's own (a Speed through, a Continue timelapse), and the time the player's message asked for,
   * as what the reply didn't already tell of it (`offerLeft`).
   */
  private async turnOffers(input: TurnOffersInput): Promise<StoredChip[]> {
    const { bridge, rec, plan, userText, hold, read } = input;
    const stored: StoredChip[] = [];
    const at = `${input.messageId}:${input.swipeId}`;
    const base = { messageId: input.messageId, swipeId: input.swipeId };
    const headState = input.core.fold(input.observed).state;
    const chipWorld = input.core.worldAt(headState.revision) ?? input.core.worldAt(rec?.defHash ?? "");
    // Time the message asked for that the turn didn't run (DESIGN §9.2): a typed timelapse longer than
    // a turn runs, offered and never run unasked, or time it lets pass after its actions, never offered
    // while some of them are left to play.
    const asked = input.kind === "continue" || plan?.stopped ? undefined : bridge.offerFor(userText);
    // The time the reply's read already moved the clock, and the time its chips still would (§9.4):
    // a Timelapse this turn offers counts both, so tapping it never runs the same time twice. Speed
    // through to an activity's end the clock is already at, or would be, is withdrawn.
    const told = rec ? clockMinutes(rec.events.slice(rec.pre)) : 0;
    const pending = asked || (plan?.chips ?? []).some((chip) => chip.kind === "timelapse_offer") ? narratedPending((await this.chips.list(input.chatId, input.userId)).filter((c) => c.messageId === input.messageId && c.swipeId === input.swipeId), read) : 0;
    const offers = (plan?.chips ?? []).filter((chip) => !(told + pending > 0 && chip.kind === "timelapse_offer" && chip.target.type === "at" && chip.target.at <= headState.clock + pending));
    for (const [i, chip] of offers.entries()) {
      // DESIGN §9.2 wording: "Timelapse to 07:00 (8 h 55 min)?"
      const to = chip.target.type === "at" && chipWorld ? ` to ${shortClock(chipWorld, headState, chip.target.at)}` : "";
      // A time the reply's read moved the clock toward is that much nearer.
      const remaining = told > 0 && chip.target.type === "at" ? chip.target.at - headState.clock : chip.remaining;
      const label = chip.kind === "timelapse_offer" ? `Timelapse${to} (${compactSpan(remaining)})?` : `Continue timelapse (${compactSpan(remaining)} left)`;
      // A Continue of a span the player's message filled keeps its words, as it keeps its hold.
      const fill: JsonObject = chip.kind === "continue_timelapse" && plan?.fill ? { fill: plan.fill } : {};
      stored.push({ id: `tl:${at}:${i}`, kind: chip.kind, ...base, label, actions: [{ id: "timelapse", label: chip.kind === "timelapse_offer" ? "Timelapse" : "Continue", style: "primary" }], expires: "next_send", payload: { target: JSON.parse(JSON.stringify(chip.target)) as JsonValue, ...(chip.povRoutine === false ? { povRoutine: false } : chip.kind === "continue_timelapse" ? hold : {}), ...fill } });
    }
    // The asked time is offered as what the reply didn't already tell of it (`offerLeft`), or not at all.
    const offeredTo = offers.reduce<number | null>((m, chip) => (chip.kind === "timelapse_offer" && chip.target.type === "at" ? Math.max(m ?? chip.target.at, chip.target.at) : m), null);
    const offer = asked && chipWorld ? offerLeft(this.registry, chipWorld, headState, asked, told, pending, offeredTo) : asked;
    if (asked && !offer) this.host.log("info", `[LumiRPEngine] turn ${input.messageId.slice(0, 8)}:${input.swipeId}: the reply told the time the message asked for (${told} min, ${pending} min waiting), so no Timelapse is offered`, input.userId);
    if (offer) {
      const part = offer.type === "day_part" ? chipWorld?.calendar.dayParts.find((d) => d.id === offer.dayPart)?.label.toLowerCase() : undefined;
      const label = offer.type === "duration" ? `Timelapse ${compactSpan(offer.minutes)}?` : offer.type === "day_part" ? `Timelapse to ${part ?? offer.dayPart}?` : offer.type === "at" && chipWorld ? `Timelapse to ${shortClock(chipWorld, headState, offer.at)}?` : offer.type === "shift" ? "Timelapse to your next shift?" : offer.type === "commitment" ? "Timelapse to your next commitment?" : "Timelapse?";
      const covered = asked?.type === "duration" && offer.type === "duration" ? asked.minutes - offer.minutes : 0;
      const detail = asked?.type === "duration" && offer.type === "duration" && covered > 0 ? `The reply already told ${compactSpan(covered)} of the ${compactSpan(asked.minutes)} you asked for. Run the other ${compactSpan(offer.minutes)} as a timelapse?` : offer.type === "duration" && offer.minutes > (await this.settings.get(input.userId)).time.askBeyondMinutes ? "That's longer than a skip runs without asking. Run it as a timelapse?" : "You said time passes after that. Run it as a timelapse?";
      // The span as the message spent it: its fill and its hold travel on the chip, so its Timelapse runs as the inline skip would (DESIGN §9.2).
      const spent = bridge.offerSpent(userText);
      stored.push({ id: `tlo:${at}`, kind: "timelapse_offer", ...base, label, detail, actions: [{ id: "timelapse", label: "Timelapse", style: "primary" }], expires: "next_send", payload: { target: JSON.parse(JSON.stringify(offer)) as JsonValue, ...(spent.fill !== "" ? { fill: spent.fill } : {}), ...(spent.hold ? { povRoutine: false } : {}) } });
    }
    return stored;
  }

  changed(chatId: ChatId, userId: UserId): void {
    this.push.changed(chatId, userId);
    // A sweep that is due runs once nothing of the user's is in flight (DESIGN §4.4).
    this.sweep.nudge(userId);
  }

  /** The next swipe's mode, chosen on the swipe-option chip; consumed by that swipe. */
  private readonly swipeChoice = new Map<ChatId, "rerun" | "renarrate">();

  /**
   * A Re-run rolls the turn again, so a turn kept from a failed reply goes and the engine runs; a
   * Re-narrate keeps the outcome, which the kept turn is (DESIGN §5.1).
   */
  setSwipeChoice(chatId: ChatId, mode: "rerun" | "renarrate"): void {
    lruSet(this.swipeChoice, chatId, mode, 256);
    if (mode === "rerun") this.ledger.discardKept(chatId);
  }

  /** The player's answer to what a read waits on (DESIGN §9.4 a claim's question, §11 a suggested check): kept with the read, so the Regenerate that follows resumes the turn. */
  answerAsk(chatId: ChatId, text: string, index: number, keep: boolean): boolean {
    return this.bridges.get(chatId)?.answerAsk(text, index, keep) ?? false;
  }

  /** Play or Edit on the intent gate (DESIGN §5.1 preview gates): the read plays, with `params` (and the player's `said` words for the receivers they pay outside) when the player edited them, on the Regenerate that follows. */
  passIntent(chatId: ChatId, text: string, params?: JsonObject, said?: Record<string, string>): boolean {
    return this.bridges.get(chatId)?.passIntent(text, params, said) ?? false;
  }

  /**
   * Why an action's params from a request (the intent gate's Edit, `lre.action`) can't play, in the
   * read's own words ("Go: it names no place you know"): a ref that names nothing the player character
   * may know of (`unfitRef`), so no request path plays a guessed id of a hidden thing. `know` is what
   * counts as known: `read`, a typed read's own rule (`povMayKnow`), for edited details; `seen`, what
   * the player's own surfaces may offer (`canSeeEntity`: the player's accounts and payments too), for
   * a palette, panel or tool request. `skip` is a claim's param, which the claim makes real. On the
   * read, a receiver a param that pays pays someone else for (`payeeOf`, DESIGN §9.4 typed money:
   * the owner of a thing, or World for one the story hasn't established) fits, as the typed read pays
   * them; a palette, panel or tool request names whom the player picked. Null when every ref fits.
   */
  requestRefusal(world: WorldDoc, state: Readonly<WorldState>, action: ActionDef, params: JsonObject, know: "read" | "seen", skip?: string): string | null {
    const mayKnow = (id: EntityId): boolean => (know === "read" ? povMayKnow(this.registry, world, state, id) : id === world.pov || canSeeEntity(this.registry, world, state, world.pov, id));
    const unfit = unfitRef(this.registry, action, params, world, state, mayKnow, skip, know === "read");
    return unfit ? `${action.label}: ${unfitReason(this.registry, world, state, unfit, "", unrevealedSecrets(this.registry, world, state), mayKnow)}` : null;
  }

  /**
   * Why the intent gate's Edit can't play the action as picked again (DESIGN §5.1): the read's own
   * check (`requestRefusal`), then every person, place or thing the edit changed must be one the
   * Actions palette offers the player character for it (`paramCandidates`, and `companionCandidates`
   * for who comes along), so a hand-made request can't aim it where the palette never would. A pick
   * the read made itself stands; so does a claim's param (`claim`) left as read, which the claim makes
   * real. A claim's param the edit changed is a pick like any other, checked as one. A receiver a
   * param that pays pays someone else for (`payeeOf`, DESIGN §9.4 typed money) is no pick of the
   * palette's, and plays as the read would play it (`editedPaid`).
   */
  editRefusal(world: WorldDoc, state: Readonly<WorldState>, action: ActionDef, params: JsonObject, read: JsonObject, claim?: string): string | null {
    const kept = (name: string): boolean => JSON.stringify(params[name] ?? null) === JSON.stringify(read[name] ?? null);
    const refused = this.requestRefusal(world, state, action, params, "read", claim !== undefined && kept(claim) ? claim : undefined);
    if (refused) return refused;
    const mayKnow = (id: EntityId): boolean => povMayKnow(this.registry, world, state, id);
    const why = (param: string, def: ParamDef, value: JsonValue): string => `${action.label}: ${unfitReason(this.registry, world, state, { param, def, value }, "", unrevealedSecrets(this.registry, world, state), mayKnow)}`;
    for (const [name, def] of Object.entries(action.params)) {
      const value = params[name];
      if (value === undefined || value === null || value === "" || kept(name)) continue;
      if (def.type === "ref" && payeeOf(this.registry, action, params, def, value, world, state, mayKnow) !== null) continue;
      if (def.type === "ref" && !(typeof value === "string" && paramCandidates(this.registry, world, state, action, name).includes(value))) return why(name, def, value);
      if (def.type === "list" && def.ref !== undefined) {
        const along = companionCandidates(this.registry, world, state, action, name);
        const stray = Array.isArray(value) ? value.find((id) => typeof id !== "string" || !along.includes(id)) : value;
        if (stray !== undefined) return why(name, def, stray ?? null);
      }
    }
    return null;
  }

  /**
   * The intent gate's Edit's params with each receiver the read paid in another's place kept where the
   * edit leaves it unpicked (DESIGN §5.1, §9.4 typed money): World, a thing's owner or a party beyond
   * the scene is no pick the Actions palette offers, so an Edit of the amount alone keeps whom the
   * read pays, and the way of paying the read gave ("from my savings"), which the palette doesn't carry.
   */
  keptPayees(action: ActionDef, params: JsonObject, read: JsonObject): JsonObject {
    const out: JsonObject = { ...params };
    const blank = (v: JsonValue | undefined): boolean => v === undefined || v === null || v === "";
    const pays = Object.values(action.params).some((def) => def.outside !== undefined);
    for (const [name, def] of Object.entries(action.params)) {
      const was = read[name];
      if ((def.outside !== undefined || (pays && name === "method")) && blank(out[name]) && !blank(was)) out[name] = was;
    }
    return out;
  }

  /**
   * The intent gate's Edit as it plays (DESIGN §5.1, §9.4 typed money): its params with each receiver
   * paid as the read pays it (`paidOutside`) and its way of paying as the purchase implies when none
   * is given (`handedCash`), and the player's own words for what each param paid in another's place
   * named: the read's for one the edit left as read, which judge it as the read did, else those of
   * the player's message (`text`).
   */
  editedPaid(world: WorldDoc, state: Readonly<WorldState>, action: ActionDef, params: JsonObject, read: InterpretOutput, text: string): { params: JsonObject; said: Record<string, string> } {
    const mayKnow = (id: EntityId): boolean => povMayKnow(this.registry, world, state, id);
    const paid = paidOutside(this.registry, action, params, world, state, mayKnow, text);
    const kept = Object.fromEntries(Object.entries(read.said ?? {}).filter(([name]) => JSON.stringify(params[name] ?? null) === JSON.stringify(read.params[name] ?? null)));
    return { params: handedCash(this.registry, action, { ...params, ...kept }, paid.params, world, state, mayKnow), said: { ...kept, ...paid.said } };
  }

  /**
   * The intent gate's Edit (DESIGN §5.1): the Actions palette opened at the read action with its picks
   * already made, when the palette offers that action here; only the picks it could offer travel to
   * the page, and a text pick only as the card shows it (`editedText`, the player's message `typed`),
   * so a read's free text never carries a secret or a hidden name there. A receiver the read paid in
   * another's place (World, a thing's owner, a party the player character can see beyond the scene,
   * DESIGN §9.4 typed money) travels as read, though the palette offers no pick for it, and an Edit
   * that leaves it unpicked keeps it (`keptPayees`). Null when the palette has no such action, so Edit
   * isn't offered.
   */
  private intentEdit(world: WorldDoc, state: WorldState, action: ActionDef, params: JsonObject, typed: string): ChipInput | null {
    if (!palette(world, state, this.registry).entries.some((e) => e.action === action.id)) return null;
    const text = editedText(this.registry, world, state, typed);
    const picks: JsonObject = {};
    for (const [name, def] of Object.entries(action.params)) {
      const value = params[name];
      if (value === undefined || value === null) continue;
      if (def.type === "ref") {
        const paid = def.outside !== undefined && typeof value === "string" && (value === outsideOf(def) || canSeeEntity(this.registry, world, state, world.pov, value));
        if (typeof value === "string" && (paid || paramCandidates(this.registry, world, state, action, name).includes(value))) picks[name] = value;
      } else if (def.type === "list" && def.ref !== undefined) {
        const along = companionCandidates(this.registry, world, state, action, name);
        if (Array.isArray(value)) picks[name] = value.filter((id): id is string => typeof id === "string" && along.includes(id));
      } else if (typeof value === "string") {
        const shown = text(def, value);
        if (shown !== null) picks[name] = shown;
      } else picks[name] = value;
    }
    return { type: "action", label: `Change ${action.label}`, action: action.id, params: picks };
  }

  /**
   * The intent gate's card (DESIGN §5.1 preview gates): what the read plays, in words. Its label names
   * the first action and what it acts on, and how many follow; its detail quotes the player's words for
   * that action, then gives each action queued after it with what it acts on and its words, the time
   * the message lets pass after them, what was left out and why, and the words no action reads. A time
   * skip says how long it runs and from when to when, what fills it, and what running it means. Picks
   * are named as the palette names them, the player's own words where the world has no name for them
   * (`actionWords`). Edit opens the Actions sheet at the action, or the Timelapse sheet at the skip,
   * when the sheet can play it.
   */
  private intentCard(bridge: TurnBridge, text: string, read: InterpretOutput, world: WorldDoc, state: WorldState, settings: UserSettings): { label: string; detail: string; edit: ChipInput | null; what: string } {
    const rest = bridge.nextOf(text);
    if (read.action === TIMELAPSE_ACTION) {
      const target = parseTarget(read.params.target);
      const span = target ? skipWords(this.registry, world, state, target, true) : "time passes";
      const held = read.params.povRoutine === false;
      const lines = [
        ...(read.text ? [`Filled with: “${read.text}”`] : []),
        `Play runs the clock on in one go${mindsOn(settings) ? ", the minds of the people it involves thinking at the moments that matter in it" : ""}; you ${held ? "stay where the story has you" : "follow your routine through it"}, and the reply tells it.`,
        ...(rest ? [`Left for after it: “${rest}”`] : []),
      ];
      const edit: ChipInput | null = target && palette(world, state, this.registry).timelapse?.blocked === null ? { type: "action", label: "Change the timelapse", action: TIMELAPSE_ACTION, params: { target: JSON.parse(JSON.stringify(target)) as JsonValue, followRoutine: !held } } : null;
      return { label: `Play Timelapse: ${span}?`, detail: lines.join("\n"), edit, what: `Timelapse ${span}` };
    }
    const action = read.action ?? "";
    const head = this.stepWords(world, state, action, read.params, text, read.said);
    const queue = read.queue ?? [];
    const offer = bridge.offerFor(text);
    const asks = offer?.type === "duration" && offer.minutes > settings.time.askBeyondMinutes;
    const lines = [
      ...(read.text ? [`“${read.text}”`] : []),
      ...queue.map((q) => `Then ${this.stepWords(world, state, q.action, q.params, text, q.said)}${q.text ? ` — “${q.text}”` : ""}`),
      ...(offer ? [`Then time passes: ${skipWords(this.registry, world, state, offer, false)}. ${asks ? "That's longer than a skip runs without asking, so it's offered once these have played." : "The reply tells it after these."}`] : []),
      ...bridge.unfitOf(text).map((u) => `Left out: ${u.label}, ${u.reason}.`),
      ...(rest ? [`Not read as an action: “${rest}”`] : []),
    ];
    const def = (hasOwn(world.actions, action) ? world.actions[action] : undefined) ?? this.registry.actions.get(action);
    return { label: `Play ${head}${queue.length > 0 ? `, then ${queue.length} more` : ""}?`, detail: lines.join("\n"), edit: def ? this.intentEdit(world, state, def, read.params, text) : null, what: head };
  }

  /**
   * One action of a read in words, as the intent gate's card names it (DESIGN §5.1): its label and what
   * it acts on ("Take: letter", "Go to: Bluebird Coffee, with Danny Okafor"), the player's own words
   * where the world has no name for a pick (`typed`), and for a receiver paid in another's place
   * (`said`, DESIGN §9.4 typed money: "Pay: the tip jar, $5.00"); an inferred check by its skill, what
   * is attempted (unless it names anything hidden the player's message doesn't), whom it opposes as the
   * player character may know them, and how it looks.
   */
  private stepWords(world: WorldDoc, state: WorldState, action: ActionId, params: JsonObject, typed: string, said: Readonly<Record<string, string>> = {}): string {
    if (action === TRY_ACTION) {
      const verdict = inferredRead(this.registry, world, state, params);
      if (!verdict.ok) return "Try something";
      const against = verdict.read.against.flatMap((a) => (povMayKnow(this.registry, world, state, a.who) ? [own(state.entities, a.who)?.name ?? ""] : [])).filter((n) => n !== "");
      const attempt = namesHiddenOrSecretLore(this.registry, world, state, verdict.read.attempt, typed) ? "" : verdict.read.attempt;
      return `${verdict.skill.label} check${attempt !== "" ? `: “${attempt}”` : ""}${against.length > 0 ? `, against ${against.join(" and ")}` : ""}, looking ${verdict.band.label.toLowerCase()}`;
    }
    const def = (hasOwn(world.actions, action) ? world.actions[action] : undefined) ?? this.registry.actions.get(action);
    if (!def) return "an action";
    const picks = actionWords(this.registry, world, state, def, params, typed, typed, said);
    return picks !== "" ? `${def.label}: ${picks}` : def.label;
  }

  /**
   * The Outcome's line for the time a typed message lets pass after its actions (DESIGN §9.2), or
   * null: when every action played, the reply tells that time after them, and its read moves the
   * clock by what it tells, so the Timelapse offered after the reply is only what it didn't tell.
   * None while some of the actions are left to play, for a time skip (which runs the time itself),
   * and for a span longer than a skip runs without asking, which waits on its Timelapse instead. Its
   * words for the time are the read's, quoted when they name nothing hidden that the player's message
   * doesn't say too (DESIGN §7): the narrator reads that message anyway.
   */
  private thenLine(chatId: ChatId, said: string, seed: string, world: WorldDoc, state: WorldState, settings: UserSettings, secrets: readonly string[]): string | null {
    const bridge = this.bridges.get(chatId);
    const intent = said === "" ? null : bridge?.intentOf(said);
    const offer = said === "" ? undefined : bridge?.offerFor(said);
    const turn = bridge?.planFor(seed);
    if (!intent?.action || intent.action === TIMELAPSE_ACTION || !offer || !turn || turn.stopped) return null;
    if (offer.type === "duration" && offer.minutes > settings.time.askBeyondMinutes) return null;
    const typed = said.toLowerCase();
    const words = typeof intent.then?.span === "string" ? quotedWords(this.registry, world, state, intent.then.span, secrets.filter((s) => !typed.includes(s.toLowerCase())), said) : null;
    return `After those actions, the player's message lets time pass: ${skipWords(this.registry, world, state, offer, false)}${words ? ` (“${words}”)` : ""}. Tell that time in this reply, after them.`;
  }

  /** Play or Edit on the outline gate (DESIGN §5.1 preview gates): the Regenerate that follows plays the plan the player was shown, told `lines`. */
  passOutline(chatId: ChatId, text: string, lines: string[]): boolean {
    return this.bridges.get(chatId)?.passOutline(text, lines) ?? false;
  }

  async kindOf(input: { chatId: ChatId; userId: UserId; kind: GenerationKind }): Promise<GenerationKind> {
    if (input.kind !== "swipe" && input.kind !== "regenerate") return input.kind;
    const choice = this.swipeChoice.get(input.chatId);
    this.swipeChoice.delete(input.chatId);
    const mode = choice ?? (await this.settings.get(input.userId)).swipeDefault;
    return mode === "renarrate" ? "renarrate" : input.kind;
  }

  /** The next send: lapsed undo chips count as accepted (D4 learning); confirm chips lapse uncounted. */
  private async lapse(chatId: ChatId, userId: UserId): Promise<void> {
    const gone = await this.chips.lapse(chatId, userId);
    const settings = await this.settings.get(userId);
    const learning = await this.settings.learningOf(userId);
    let counted = false;
    for (const chip of gone) {
      if (chip.kind !== "undo") continue;
      const type = EXTRACTION_TYPES.find((t) => t === chip.payload.type);
      const connection = typeof chip.payload.connection === "string" ? chip.payload.connection : ACTIVE_CONNECTION;
      if (!type) continue;
      counted = true;
      const change = recordOutcome(settings, learning, connection, type, "accepted", Date.now());
      if (change) await this.addModeChip(chatId, userId, change.type, change.from, change.to, change.connectionId);
    }
    if (counted) await this.settings.saveLearning(userId);
    this.push.changed(chatId, userId);
  }

  /**
   * The words of the Send chip on the reply before the typed message: the rest of the last message
   * its turn didn't play (DESIGN §5.2, §11), which the typed one may take as done. The chip lapses
   * when the typed message is sent, so it is read as that lapse kept it (`ChipStore.recent`). ""
   * when there is none, or when the player sent those very words (the chip's own Send).
   */
  private async leftUnplayed(chatId: ChatId, userId: UserId, earlier: readonly ChainMessage[], text: string): Promise<string> {
    const reply = earlier.findLast((m) => !m.isUser);
    const chip = reply ? await this.chips.recent(chatId, userId, restChipId(reply.id, reply.swipeId)) : null;
    const left = typeof chip?.payload.text === "string" ? chip.payload.text.trim() : "";
    return neutralizeMacros(left) === text.trim() ? "" : left;
  }

  async addModeChip(chatId: ChatId, userId: UserId, type: ExtractionType, from: string, to: string, connectionId: string): Promise<void> {
    const core = await this.ledger.core(chatId, userId);
    if (!core) return;
    const observed = toChain(await this.host.chats.messages(chatId, userId));
    const head = observed.findLast((m) => !m.isUser);
    if (!head) return;
    const label = to === "auto" ? `${TYPE_LABELS[type]} now apply automatically` : `${TYPE_LABELS[type]} need your confirm again`;
    await this.chips.add(chatId, userId, [
      { id: `mode:${type}:${Date.now()}`, kind: "mode_change", messageId: head.id, label, detail: "Learned from your confirms and undos on this connection.", actions: [{ id: "undo", label: "Undo" }], expires: "never", payload: { change: { connectionId, type, from, to } } },
    ]);
  }

  // ---------------------------------------------------------------- the sections in the book (DESIGN §5.1, §6.4)

  /** The chat's world, from its metadata: the guard's check (DESIGN §5.1). */
  async worldOf(chatId: ChatId, userId: UserId): Promise<WorldId | null> {
    return (await this.runOf(chatId, userId))?.worldId ?? null;
  }

  /**
   * What a chat's sections are made from besides its messages and journal, read from memory for the
   * guard (DESIGN §5.1): the chat's world revision, the settings the turn reads (`turnSettingsKey`)
   * and the chat's own knowledge choices, read with its run (`chat-knowledge-prefs.ts`). The preset
   * isn't one: the reply's guard checks the one that reply is assembled with (`fill`).
   */
  inputs(chatId: ChatId, userId: UserId): TurnInputs {
    return {
      revision: this.runs.get(`${userId}\u0000${chatId}`)?.revision ?? "",
      settings: this.turnSettingsKey(userId),
      chat: this.chatKnowledge.key(chatId, userId),
    };
  }

  /**
   * The user's settings a prepared turn reads (DESIGN §5.1), as one value, so saving any other (a new
   * chat's realism or time, the check rules, the swipe default, Build's jobs, a reply-read setting)
   * keeps the turn: the helper model, which every step without a connection of its own runs on; Model
   * use (each step, the phase budgets, the section budget); the minds; whether JSON blocks are hidden
   * from what the steps read of the chat; the run's own clocks (the engine run, its lore window, the
   * skip plan); the narrator's knowledge; and the texts its narrator prompt is made from, the wording
   * of a secret's mark among them, with which a Re-narrate is sent (§6.12). They are known by the time
   * a turn starts, since its core was read with them.
   */
  private turnSettingsKey(userId: UserId): string {
    const settings = this.settings.known(userId);
    if (!settings) return "";
    const revision = this.settings.revision(userId);
    const kept = this.turnSettings.get(userId);
    if (kept?.revision === revision) return kept.key;
    const { helper, modelUse, minds, hideJsonBlocks, timeouts, narrator, prompts, swipeTexts } = settings;
    const key = hashParts("lre.turn-settings", JSON.stringify({ helper, modelUse, minds, hideJsonBlocks, timeouts: { engineRunMs: timeouts.engineRunMs, preLookupMs: timeouts.preLookupMs, skipPlanMs: timeouts.skipPlanMs }, narrator, prompts: prompts.texts, swipeTexts }));
    lruSet(this.turnSettings, userId, { revision, key }, 256);
    return key;
  }

  /** A section's size in tokens: the host's count of that very text when it has one, else the estimate. */
  private sectionCost(userId: UserId, content: string): number {
    return this.tokenCounts.get(hashParts("lre.tokens", userId, content)) ?? sectionTokens(content);
  }

  /**
   * GM → This chat → Sections' preview (DESIGN §6.11): every section as the next turn would give it
   * to the narrator, from the chat's head and its lore as it reads now, through the turn's own
   * builder (`buildSections`), budgets, caps and marks alike. Fast and model-free: before the next
   * turn plays, Outcome, Montage and the Outline hold nothing, and Scene no elapsed time; the GM page
   * says so.
   */
  async previewSections(chatId: ChatId, userId: UserId, core: LedgerCore, observed: ChainMessage[]): Promise<ResultBodies["lre.sections"]> {
    const render = core.renderState(observed);
    if (!render) throw new Error("the chat's world revision isn't loaded");
    const world = await this.readLore(chatId, userId, render.world);
    const { state } = render;
    const settings = await this.settings.get(userId);
    // What the narrator knows here (this chat's choice, else the world's, else the user's), as a turn reads it.
    const chat = await this.chatKnowledge.get(chatId, userId);
    const built = buildSections({
      registry: this.registry,
      world,
      state,
      secrets: unrevealedSecrets(this.registry, world, state),
      budget: settings.modelUse.tokens.sections,
      mindsBudget: settings.minds.tokens,
      narrator: { chat: chat.narrator ?? null, view: narratorView(chat, world, settings) },
      wording: markWording(settings.prompts.texts),
      // The next turn's texts: the user's own, as a turn that isn't a Re-narrate is sent.
      texts: settings.prompts.texts,
      knowledge: settings.minds.knowledge,
      said: "",
      planned: { outcome: [], montage: [] },
      outline: [],
      elapsed: null,
      // The turn makes again any entry the book lacks, so every section has one to fill.
      hasEntry: () => true,
      cost: (content) => this.sectionCost(userId, content),
      seen: () => {},
      warn: (message) => this.host.log("warn", `[LumiRPEngine] preview ${message}`, userId),
    });
    return {
      sections: built.sections.map((s) => ({ slot: s.slot, label: s.label, status: s.status, scope: s.scope, content: s.content, tokens: s.tokens, cut: s.cut, marked: s.marked, hints: s.hints })),
      budget: { sections: settings.modelUse.tokens.sections, used: built.used, minds: settings.minds.tokens },
    };
  }

  /**
   * The engine run's last step (DESIGN §5.1, §6.4): the prepared turn's sections, rendered from its
   * plan and the fold on the section budget, written into the world's book. Each goes into its
   * section's entry, or the preset outlet's twin, switched on as a constant entry, and every other
   * engine entry goes off: the reply's prompt holds them where each section's Position, or the
   * preset's outlet, puts them. The book is made, repaired, placed for the chat's revision and
   * attached first; the turn's inspector record is kept.
   */
  async deliver(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string }): Promise<Delivered> {
    const started = Date.now();
    const run = await this.runOf(input.chatId, input.userId);
    if (!run) throw new Error("the chat has no world attached");
    lruSet(this.lastWorldChat, input.userId, input.chatId, 1024);
    const render = input.core.renderState(input.observed);
    if (!render) throw new Error("the chat's world revision isn't loaded");
    const { world: folded, state } = render;
    // The sections read the lore the engine run read, World Info included (DESIGN §4.2): the Place
    // section's lore and the leak checks alike.
    const world = await this.liveWorld(input.generationId, input.chatId, input.userId, folded);
    const index = await this.worlds.index(run.worldId, input.userId);
    if (!index) throw new Error("the chat's world is gone");
    // A slot entry deleted in the host's UI is made again, and each sits where this chat's revision puts it.
    const bookId = await this.book.ensure(world, index, input.userId);
    await this.keepBookAttached(input.chatId, bookId, input.userId);
    const entries = await this.book.entriesOf(bookId, input.userId);
    const settings = await this.settings.get(input.userId);
    const secrets = unrevealedSecrets(this.registry, world, state);
    const pending = input.core.journal.pending[input.generationId];
    const plan = pending?.planned ? pending : undefined;
    // The texts the narrator's prompt is made from (DESIGN §6.12).
    const texts = await this.turnTexts(input, plan, settings);
    // The wording a secret is marked in, the turn's own: its sections, its rules and the World Info in its prompt alike.
    const wording = markWording(texts);
    // This run's own lines: the plan it made and the prose it wrote, never another run's of the same
    // seed. A Re-narrate (P3) tells its source's, kept when that turn's reply took it (`adopted`).
    const renarrated = plan?.kind === "renarrate";
    const own = plan && !renarrated ? this.runLines.get(input.generationId) : undefined;
    const turnPlan = plan && !renarrated && !own ? this.bridges.get(input.chatId)?.planFor(plan.seed) : undefined;
    const kept = plan && renarrated ? await this.planNotes.get(input.chatId, input.userId, plan.seed) : null;
    const turnLines = own?.lines ?? (turnPlan ? { ...planLines(turnPlan, world, this.registry), outline: planOutline(turnPlan, undefined) } : kept);
    const outline = turnLines?.outline ?? [];
    const planned = { outcome: [...(turnLines?.outcome ?? [])], montage: [...(turnLines?.montage ?? [])] };
    // The preset the reply assembles with: the one the pre phase read, else read now (a Continue).
    const preset = this.prePhase.get(input.generationId)?.preset ?? (await this.presets.current(input.chatId, input.userId));
    // Time the player's message lets pass after its actions (DESIGN §9.2), when every one of them
    // played: the reply tells it after them, and its read moves the clock by what it tells.
    const after = plan ? this.thenLine(input.chatId, this.prePhase.get(input.generationId)?.text ?? "", plan.seed, world, state, settings, secrets) : null;
    if (after) planned.outcome.push(after);
    const record: InspectorRecord = { id: input.generationId, at: Date.now(), activation: "unconfirmed", sections: [], budget: { sections: settings.modelUse.tokens.sections, used: 0 }, forced: [], entries: {} };
    const traces = this.loreTraces.get(input.generationId);
    if (traces) record.lore = structuredClone(traces);
    const minded = this.mindTraces.get(input.generationId);
    if (minded) record.minds = structuredClone(minded);
    const uncounted: string[] = [];
    // The entry a section fills: the preset places the section itself when an enabled block holds
    // `{{outlet::lre_<slot>}}` (DESIGN §6.8), so its outlet twin is filled; else its own entry.
    const entryOf = (section: SectionTemplate): string | null => {
      const twin = entries.twins.get(section.id);
      return twin !== undefined && preset.outlets.has(outletOf(section.id)) ? twin : (entries.slots.get(section.id) ?? null);
    };
    const chat = await this.chatKnowledge.get(input.chatId, input.userId);
    // The sections as the GM's preview builds them too (`buildSections`), on this turn's budgets.
    const built = buildSections({
      registry: this.registry,
      world,
      state,
      secrets,
      budget: settings.modelUse.tokens.sections,
      mindsBudget: settings.minds.tokens,
      // What the narrator knows in this chat (C3): its own choice, else its world's default, else the user's.
      narrator: { chat: chat.narrator ?? null, view: narratorView(chat, world, settings) },
      wording,
      texts,
      knowledge: settings.minds.knowledge,
      said: this.prePhase.get(input.generationId)?.text ?? "",
      planned,
      outline,
      elapsed: plan ? clockMinutes(plan.events) : null,
      hasEntry: (section) => entryOf(section) !== null,
      cost: (content) => this.sectionCost(input.userId, content),
      seen: (content) => {
        if (!this.tokenCounts.has(hashParts("lre.tokens", input.userId, content))) uncounted.push(content);
      },
      warn: (message) => this.host.log("warn", `[LumiRPEngine] ${message}`, input.userId),
    });
    record.sections = built.record;
    record.budget.used = built.used;
    const slots = new Map(sectionsOf(world).map((s) => [s.id, s]));
    const entryAt = (slot: string): string | null => {
      const section = slots.get(slot);
      return section ? entryOf(section) : null;
    };
    // What goes into the book, in the order it's written: each entry and its text.
    const fills = built.fills.flatMap((f) => {
      const id = entryAt(f.slot);
      return id ? [{ id, content: f.content }] : [];
    });
    for (const slot of built.recorded) {
      const id = entryAt(slot);
      if (id) (record.entries ??= {})[slot] = id;
    }
    // The narrator rules, for world chats only: at the preset's `{{outlet::lre_narrator}}`, else
    // before the character, apart from the section budget. Every turn has them: the order of
    // authority first (DESIGN D36), then what marked facts and secret marks mean, in the turn's mark
    // wording, one text in every world whether or not the turn carries marked facts (§6.8, §6.11),
    // then the preset's own rules, as the player's.
    const rulesAt = entries.narratorOutlet !== null && preset.outlets.has(NARRATOR_OUTLET) ? entries.narratorOutlet : entries.narrator;
    if (rulesAt) fills.push({ id: rulesAt, content: narratorRules(preset.guidance.narrator ?? null, texts) });
    this.countLater(input.userId, uncounted);
    // Activation is confirmed from the entries the player's record shows (a section's row) and the
    // preset's own narrator rules: an entry filled only for marked facts, or rules filled only with the
    // engine's own lines, would make the badge a trace of them when the host left it out (§6.11).
    const traced = new Set(Object.values(record.entries ?? {}));
    if (preset.guidance.narrator && rulesAt) traced.add(rulesAt);
    record.forced = fills.map((f) => f.id).filter((id) => traced.has(id));
    await this.inspector.add(input.chatId, input.userId, record);
    this.push.changed(input.chatId, input.userId);
    // Diagnostics: each section, the outlet the preset gives it, and whether it went out with text.
    const sent = new Set(record.sections.filter((s) => !s.clipped).map((s) => s.slot));
    this.diag.sections({ chatId: input.chatId, userId: input.userId, turn: input.generationId }, `${pending?.kind ?? "continue"} turn, ${preset.preset ? `preset ${preset.preset.id}` : "no preset"}`, sectionsOf(world).map((s) => ({ slot: s.id, outlet: preset.outlets.has(outletOf(s.id)) ? outletOf(s.id) : null, filled: sent.has(s.id) })), started);
    // The prompt set the turn was made from goes onto its record at commit, outside every hash, so a
    // later Re-narrate can be sent the same texts (DESIGN §6.12).
    if (pending) pending.prompts = await this.promptSets.put(input.userId, turnPromptSet(texts));
    // Nothing goes into the book yet: the guard of the generation that takes the turn writes it (`fill`).
    return { bookId, fills: new Map(fills.map((f) => [f.id, f.content])), placed: `${preset.placed}\u0000${this.book.placedAs(bookId)}`, wording };
  }

  /**
   * The texts a turn's narrator prompt is made from (DESIGN §6.12): the user's own now, except for a
   * Re-narrate or a Re-run while Settings → Swipes keeps the turn's own, which is sent the prompt set
   * its source swipe's record names (a Re-narrate's `renarrateOf`; a Re-run's, the swipe of its
   * message it was made in place of, found as a Re-narrate's is). A source made before records named
   * one was made with the shipped texts; one whose set is gone from storage gets the current texts,
   * and its diagnostics say so. Either way a secret mark's wording the set doesn't hold is the user's
   * now (`sourceTexts`): it came from Settings until it was a registry text.
   */
  private async turnTexts(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string }, plan: PendingTurn | undefined, settings: UserSettings): Promise<PromptTexts> {
    if (!plan || settings.swipeTexts !== "turn") return settings.prompts.texts;
    const source = plan.kind === "renarrate" ? plan.renarrateOf : plan.kind === "swipe" || plan.kind === "regenerate" ? rerunSource(input.core, input.observed, plan) : undefined;
    if (!source) return settings.prompts.texts;
    const rec = input.core.chain(input.observed).find((m) => m.id === source.messageId)?.ledger?.swipes[String(source.swipeId)];
    if (!rec) return settings.prompts.texts;
    if (rec.prompts === undefined) return sourceTexts(null, settings.prompts.texts);
    const set = await this.promptSets.get(input.userId, rec.prompts);
    if (set) return sourceTexts(set, settings.prompts.texts);
    this.diag.skipped({ chatId: input.chatId, userId: input.userId, turn: input.generationId }, "sections", "prompts", "the texts the re-narrated turn was made with are gone from storage, so your current texts were sent");
    return settings.prompts.texts;
  }

  /**
   * The guard's write of a turn's sections, for the generation that takes it (DESIGN §6.4): only the
   * turn's entries are on in the book, the rest of the world's engine entries off. `moved`, writing
   * nothing, when what the turn's sections depend on changed since its engine run: the preset the
   * host generates the chat with (its outlets, guidance and narrator rules), or the book's Positions.
   */
  async fill(chatId: ChatId, userId: UserId, delivered: Delivered): Promise<"filled" | "moved"> {
    const now = (await this.presets.current(chatId, userId)).placed;
    if (`${now}\u0000${this.book.placedAs(delivered.bookId)}` !== delivered.placed) return "moved";
    await this.book.write(delivered.bookId, delivered.fills, userId);
    lruSet(this.turnWording, chatId, delivered.wording, 512);
    return "filled";
  }

  /** Once the prompt that took them is assembled (DESIGN §6.4): the turn's entries emptied and off, so no later prompt holds them. */
  async clear(chatId: ChatId, userId: UserId, delivered: Delivered): Promise<void> {
    this.turnWording.delete(chatId);
    await this.book.clear(delivered.bookId, [...delivered.fills.keys()], userId);
  }

  /**
   * The chat's world book holds none of the engine's sections (DESIGN §6.4), for a prompt with no
   * turn of its own (Impersonate, a dry run): what a restart or a refused clear left there goes.
   */
  async vacate(chatId: ChatId, userId: UserId): Promise<void> {
    this.turnWording.delete(chatId);
    const run = await this.runOf(chatId, userId);
    const bookId = run ? (await this.worlds.index(run.worldId, userId))?.loreBookId : null;
    if (bookId) await this.book.vacate(bookId, userId);
  }

  /**
   * The messages before a turn's as its pre phase's facts keep them: those stay in `prePhase` for the
   * turn's later steps and its reads, up to 64 turns' worth, so each message keeps only what recent
   * chat reads (`EarlierMessage`), and one the chat's latest kept turn holds unchanged is that one's,
   * holding the text as the chat's messages hold it now (the same text, its latest copy). However
   * many turns are kept, the chat's text is held once, not once per turn read afresh.
   */
  private keptEarlier(chatId: ChatId, earlier: readonly ChainMessage[]): EarlierMessage[] {
    let kept: readonly EarlierMessage[] = [];
    for (const pre of this.prePhase.values()) if (pre.chatId === chatId) kept = pre.facts.earlier.messages;
    const known = new Map(kept.map((m) => [m.id, m]));
    return earlier.map((m) => {
      const text = m.swipes[m.swipeId] ?? "";
      const was = known.get(m.id);
      if (!was || was.isUser !== m.isUser || was.swipes[0] !== text) return { id: m.id, isUser: m.isUser, swipes: [text], swipeId: 0 };
      was.swipes[0] = text;
      return was;
    });
  }

  /**
   * `world` with the lore its World Info books hold now (DESIGN §4.2, `readLore`), read once per
   * engine run, under its turn id, so its phases, its sections, its time skip and its checks read the
   * same entries; each caller keeps its own world, with that lore.
   */
  private async liveWorld(key: string, chatId: ChatId, userId: UserId, world: WorldDoc): Promise<WorldDoc> {
    const kept = this.liveLores.get(key);
    if (kept) return kept === world.lore ? world : { ...world, lore: kept };
    const live = await this.readLore(chatId, userId, world);
    lruSet(this.liveLores, key, live.lore, LIVE_LORES_KEPT);
    return live;
  }

  /**
   * `world` with the lore its World Info books hold now, as its helpers and minds read it (`liveLore`):
   * a turn's, and GM → Minds → Run's. It reads the books and writes nothing to them.
   */
  async readLore(chatId: ChatId, userId: UserId, world: WorldDoc): Promise<WorldDoc> {
    return liveLore(this.host, world, chatId, userId);
  }

  /** What the World Info interceptor reads of the engine (DESIGN §6.1). */
  private worldInfoGate(): WorldInfoGate {
    return {
      registry: this.registry,
      playsWorld: (meta) => readRun(meta) !== null,
      head: (chatId, userId) => this.ledger.narratorState(chatId, userId),
      settings: (userId) => this.settings.get(userId),
      wording: async (chatId, userId) => this.turnWording.get(chatId) ?? markWording((await this.settings.get(userId)).prompts.texts),
      log: (message, userId) => this.host.log("warn", `[LumiRPEngine] ${message}`, userId),
    };
  }

  /**
   * A generation took the prepared turn: what the engine run kept under the turn's id is the
   * generation's now, its plan's lines and prose become its seed's (the reply's steps read them, and
   * a Re-narrate of this reply tells them), and an earlier run's failure flag goes.
   */
  async adopted(chatId: ChatId, userId: UserId, from: string, to: string): Promise<void> {
    rekey(this.preBudgets, from, to);
    rekey(this.prePhase, from, to);
    // An outline let through is for the one turn it was shown for: once that turn is taken, a Re-run
    // swipe of it plans afresh, and gates again (DESIGN §5.1 preview gates).
    const text = this.prePhase.get(to)?.text;
    if (text !== undefined) this.bridges.get(chatId)?.dropOutline(text);
    rekey(this.loreTraces, from, to);
    // The reply's steps read the World Info the engine run read, not the books again.
    rekey(this.liveLores, from, to);
    rekey(this.mindTraces, from, to);
    const own = this.runLines.get(from);
    this.runLines.delete(from);
    if (own) {
      this.bridges.get(chatId)?.setProse(own.seed, own.prose);
      await this.planNotes.put(chatId, userId, own.seed, own.lines).catch((error: unknown) => this.host.log("warn", `[LumiRPEngine] plan lines not kept: ${error instanceof Error ? error.message : String(error)}`, userId));
    }
    const record = this.inspector.records(chatId)?.find((r) => r.id === from);
    if (record) {
      record.id = to;
      this.inspector.save(chatId);
    }
    await this.chips.removeWhere(chatId, userId, (chip) => chip.kind === "engine_failed" || chip.kind === "claim" || chip.kind === "check");
  }

  /**
   * The engine run failed (DESIGN §5.1): nothing was generated. The chat's last message says what
   * failed and why ("Maya's mind: connection reset (after 2 retries)"), with a Retry that runs the
   * engine again, then the reply, and a way to Diagnostics. The Retry starts the stopped generation
   * again as it started (`as`): Lumiverse's Regenerate, or its Continue for a Continue. A new reply
   * after a reply only the player's own Send can start, so that card says to press it and has no
   * Retry, since a Regenerate there would roll the reply before it again. The minds that answered are
   * kept for the Retry, which asks only the others while nothing they were made from changes. A
   * generation the guard stopped because an earlier turn's sections couldn't be emptied (`clear`,
   * DESIGN §6.4) says so instead, with no Retry: pressing the same button again tries again.
   */
  async failed(input: { chatId: ChatId; userId: UserId; turn: string; step: string; reason: string; as?: GenerateAs }): Promise<void> {
    const answered = this.answeredMinds.get(input.turn);
    this.answeredMinds.delete(input.turn);
    if (answered && answered.minds.size > 0) lruSet(this.keptMinds, input.chatId, { key: answered.key, minds: Promise.resolve(answered.minds) }, 256);
    const last = (await this.host.chats.messages(input.chatId, input.userId)).at(-1);
    if (!last) return;
    // "interpret call failed: …" reads as "Reading your action: …"; a mind's record already says whose,
    // and a refused earlier message's reply says why and what to do instead: no Retry can start it. A
    // finished run whose reply never started (`stale`) says what changed; its Retry runs the engine again.
    const why = (input.reason.startsWith(`${input.step} `) ? input.reason.slice(input.step.length + 1) : input.reason).replace(/(?:^|\b)(?:the )?call failed: /g, "");
    const said = input.step === "mind" || input.step === "target" || input.step === "stale" ? why : `${(STEP_LABEL[input.step] ?? input.step).replace(/…$/, "")}: ${why}`;
    const cleared = input.step === "clear";
    const start = input.step === "target" || cleared ? undefined : input.as;
    const detail = `${said.charAt(0).toUpperCase()}${said.slice(1)}${cleared ? ". Nothing went out with them; try again, and if it keeps failing, Diagnostics shows each attempt." : start === "send" ? ". Press Send, with nothing typed, to run it again." : ""}`;
    const retry = start === "regenerate" || start === "continue" ? [{ id: start, label: "Retry", style: "primary" as const }] : [];
    const label = cleared ? "An earlier turn's sections couldn't be cleared, so nothing was generated" : input.step === "stale" ? "The reply didn't start, so nothing was generated" : "The engine didn't finish, so nothing was generated";
    await this.chips.add(input.chatId, input.userId, [{ id: `engine_failed:${input.turn}`, kind: "engine_failed", messageId: last.id, label, detail, actions: [...retry, { id: "diagnostics", label: "Diagnostics" }], ...(start ? { as: start } : {}), expires: "next_send", payload: {} }]);
    this.push.changed(input.chatId, input.userId);
  }

  /**
   * `WORLD_INFO_ACTIVATED` for the reply the guard let through (DESIGN §4.2): a section whose entry
   * activated reached its prompt, one whose entry didn't did not (the host's World Info budget left it
   * out, say); the record is confirmed when every entry the turn filled activated.
   */
  private onActivated(chatId: ChatId, activated: readonly string[]): void {
    const turn = this.ledger.preparedOf(chatId);
    if (!turn?.generationId) return;
    const record = this.inspector.records(chatId)?.at(-1);
    if (!record || (record.id !== turn.id && record.id !== turn.generationId) || record.activation === "confirmed") return;
    const ids = new Set(activated);
    record.activation = record.forced.every((id) => ids.has(id)) ? "confirmed" : "unconfirmed";
    for (const s of record.sections) {
      const entry = record.entries?.[s.slot];
      if (!s.clipped && entry) s.delivery = ids.has(entry) ? "verified" : "unverified";
    }
    this.inspector.save(chatId);
  }

  /**
   * Opening the Context panel runs the D32 preset lint on a dry run of the chat (DESIGN §13), for its
   * warnings. The dry run assembles the whole prompt, which takes a while on a long chat, so it starts
   * once the request has its reply, and the warnings reach the frontend with the push it ends with.
   */
  checkPresetLater(chatId: ChatId, userId: UserId): void {
    const check: Promise<void> = this.checkPreset(chatId, userId)
      .catch((error: unknown) => this.host.log("warn", `[LumiRPEngine] preset check ${chatId}: ${error instanceof Error ? error.message : String(error)}`, userId))
      .finally(() => this.presetChecks.delete(check));
    this.presetChecks.add(check);
  }

  /** Resolves once every preset check started after a reply has finished (tests). */
  async presetChecked(): Promise<void> {
    while (this.presetChecks.size > 0) await Promise.all([...this.presetChecks]);
  }

  private async checkPreset(chatId: ChatId, userId: UserId): Promise<void> {
    const assembly = await this.host.dryRun(chatId, userId);
    lruSet(this.presetWarnings, chatId, (await this.lintOf(chatId, assembly, userId)).map((c) => c.message), 256);
    this.push.changed(chatId, userId);
  }

  /** The user's default connection id, the key its D4 learning is kept under; `"active"` when the host can't say. */
  async activeConnectionId(userId: UserId): Promise<string> {
    return (await this.host.connections.active(userId).catch(() => null))?.id ?? ACTIVE_CONNECTION;
  }

  /**
   * Settings → Preset (DESIGN §6.8): what the active preset says, read for the open chat (else the
   * world chat last played); with `add`, after adding the RPEngine blocks it lacks. Its outlets are
   * named by the open world chat's sections, else the default ones. Null when `add` finds no preset.
   */
  async presetCard(userId: UserId, add: boolean): Promise<PresetCard | null> {
    const open = await this.host.chats.active(userId).catch(() => null);
    const chatId = open ?? this.lastWorldChat.get(userId) ?? null;
    const config = add ? await this.presets.addBlocks(chatId, userId) : await this.presets.current(chatId, userId);
    if (!config) return null;
    const run = open ? await this.runOf(open, userId) : null;
    const sections = run ? sectionsOf((await this.worlds.get(run.worldId, userId, run.revision)).world) : Object.values(DEFAULT_SECTIONS);
    const labels = new Map<string, string>([...sections.map((s): [string, string] => [outletOf(s.id), s.label]), [NARRATOR_OUTLET, "Narrator rules"]]);
    return {
      preset: config.preset,
      outlets: [...config.outlets].sort().map((outlet) => ({ outlet, label: labels.get(outlet) ?? null })),
      blocks: GUIDANCE_TARGETS.map((target) => ({ target, name: `${GUIDANCE_PREFIX}${target}`, state: config.blocks[target] })),
    };
  }

  /**
   * Settings turned JSON hiding off, and every world chat's hiding goes (its exclusion and the user's
   * unwraps stay); or on, and the open world chat's comes back now, every other one's as the engine meets
   * it (DESIGN §6.7).
   */
  async hidingChanged(userId: UserId, hides: boolean): Promise<void> {
    try {
      if (!hides) {
        await this.jsonHiding.removeHiding(userId);
        return;
      }
      this.jsonHiding.forget(userId);
      const open = await this.host.chats.active(userId);
      const run = open ? await this.runOf(open, userId) : null;
      if (open && run) await this.jsonHiding.ensure(open, run.worldId, userId);
    } catch (error) {
      this.host.log("warn", `[LumiRPEngine] JSON-hiding regex scripts: ${error instanceof Error ? error.message : String(error)}`, userId);
    }
  }

  /**
   * The D32 preset lint (DESIGN §13) for Settings → Caveats: a dry run of the world chat the user has
   * open, else the one they last played; none when there is neither. A dry run is a whole prompt
   * assembly, which takes long on a long chat, so its finding is kept per chat, preset revision and
   * settings revision. The answer waits at most the user's Preset check timeout (`caveatsMs`, or
   * `waitMs`), one timer for the step pre-flight and the dry run: past it the answer says what is
   * still being checked, and the dry run carries on for the next ask. A failed run reads as a caveat
   * too, and is run again on the next ask.
   */
  async presetCaveats(userId: UserId, waitMs?: number): Promise<PresetCaveat[]> {
    const settings = await this.settings.get(userId);
    const ms = waitMs ?? timerMs(settings.timeouts.caveatsMs);
    const late = Promise.withResolvers<typeof LATE>();
    const timer = ms === null ? null : setTimeout(() => late.resolve(LATE), ms);
    try {
      // Before any preset: a Lumiverse that can't stop a generation for the engine run (DESIGN §5.1).
      const host: PresetCaveat[] = [...(this.host.capabilities.cancel ? [] : [{ code: "host_cannot_stop" as const, message: CANNOT_STOP }]), ...(await this.stepCaveats(userId, settings, late.promise))];
      const open = await this.host.chats.active(userId).catch(() => null);
      const chatId = open && (await this.runOf(open, userId)) ? open : this.lastWorldChat.get(userId);
      if (!chatId) return host;
      const preset = (await this.presets.current(chatId, userId)).preset;
      const key = `${userId}\u0000${chatId}\u0000${preset?.id ?? ""}\u0000${preset?.revision ?? ""}\u0000${this.settings.revision(userId)}`;
      let run = this.caveatRuns.get(key);
      if (!run) {
        run = this.host
          .dryRun(chatId, userId)
          .then((assembly) => this.lintOf(chatId, assembly, userId))
          .catch((error: unknown): PresetCaveat[] => {
            const message = error instanceof Error ? error.message : String(error);
            this.host.log("warn", `[LumiRPEngine] preset lint: ${message}`, userId);
            this.caveatRuns.delete(key);
            return [{ code: "preset_lint_failed", message: `The preset check couldn't build a test prompt for this chat (${message.slice(0, 200)}), so its warnings aren't known. Open Caveats again to retry.` }];
          });
        lruSet(this.caveatRuns, key, run, 64);
      }
      const pending: PresetCaveat[] = [{ code: "preset_lint_pending", message: "The preset check is still building a test prompt for this chat, which takes a while on a long chat. Open Caveats again in a moment." }];
      return [...host, ...(await Promise.race([run, late.promise.then(() => pending)]))];
    } finally {
      clearTimeout(timer ?? undefined);
    }
  }

  /**
   * Caveats' pre-flight (DESIGN §5.3): the helper model's connection and every enabled step's own
   * name a connection the user has (a Decision step's, a Decisions API one), and its model one that
   * connection lists, since either gone fails the turn's call. A list the host can't give says
   * nothing; neither does a model list a provider doesn't answer. Each connection's models are asked
   * once, side by side, until `late`: a list still coming then leaves its steps unchecked, never missing.
   */
  private async stepCaveats(userId: UserId, settings: UserSettings, late: Promise<typeof LATE>): Promise<PresetCaveat[]> {
    const named = [
      { label: "Helper model", connectionId: settings.helper.connectionId, model: settings.helper.model, decision: false },
      ...(Object.keys(STEP_NAME) as StepPurpose[]).flatMap((purpose) => {
        const config = stepConfigOf(settings.modelUse.steps, purpose);
        return config.enabled && config.route ? [{ label: STEP_NAME[purpose], connectionId: config.route.connectionId, model: config.route.model, decision: config.route.provider === "decision" }] : [];
      }),
    ].filter((n): n is typeof n & { connectionId: string } => n.connectionId !== null);
    const lists = await Promise.race([Promise.all([this.host.connections.list(userId).catch(() => null), this.host.connections.decisionList(userId).catch(() => null)]), late]);
    const gone: string[] = [];
    const unlisted: string[] = [];
    const unchecked: string[] = [];
    if (lists === LATE) unchecked.push(...named.map((n) => n.label));
    else {
      const [helpers, decisions] = lists;
      const lookups = new Map<string, Promise<string[] | null | typeof LATE>>();
      const checks = named.flatMap((n) => {
        const list = n.decision ? decisions : helpers;
        if (list === null) return [];
        const connection = list.find((c) => c.id === n.connectionId);
        if (!connection) {
          gone.push(n.label);
          return [];
        }
        if (n.decision || n.model === null || n.model === "") return [];
        let lookup = lookups.get(n.connectionId);
        if (!lookup) {
          lookup = Promise.race([this.host.connections.models(n.connectionId, userId).catch(() => null), late]);
          lookups.set(n.connectionId, lookup);
        }
        return [{ ...n, model: n.model, connection: connection.name, lookup }];
      });
      for (const c of checks) {
        const models = await c.lookup;
        if (models === LATE) unchecked.push(c.label);
        else if (models && !models.includes(c.model)) unlisted.push(`${c.label} (${c.model} on ${c.connection})`);
      }
    }
    return [
      ...(gone.length > 0 ? [{ code: "step_connection_missing" as const, message: `These name a connection you no longer have, so their calls would fail the turn: ${gone.join(", ")}. Pick another in Settings → Steps and connections.` }] : []),
      ...(unlisted.length > 0 ? [{ code: "step_model_missing" as const, message: `These name a model their connection doesn't list, so their calls may fail the turn: ${unlisted.join(", ")}. Pick another in Settings → Steps and connections.` }] : []),
      ...(unchecked.length > 0 ? [{ code: "step_model_unchecked" as const, message: `Their connections didn't answer within the Preset check timeout, so these weren't checked: ${unchecked.join(", ")}. Open Caveats again in a moment.` }] : []),
    ];
  }

  private async lintOf(chatId: ChatId, assembly: DryRun, userId: UserId): Promise<PresetCaveat[]> {
    // Named by the preset the host assembles with (block ids repeat across copied presets); its outlets are read from its own blocks, which the dry run resolves away.
    const config = await this.presets.current(chatId, userId);
    const run = await this.runOf(chatId, userId);
    const sections = run ? sectionsOf((await this.worlds.get(run.worldId, userId, run.revision)).world).map((s) => ({ outlet: outletOf(s.id), label: s.label })) : null;
    return presetCaveats(assembly, config.preset?.name ?? null, sections ? { outlets: config.outlets, sections } : null);
  }

  /** The engine runs' section records kept for a chat (newest last). */
  inspectorRecords(chatId: ChatId): readonly InspectorRecord[] | undefined {
    return this.inspector.records(chatId);
  }

  /** The inspector panel (`core.context`, `ContextView`), from the chat's loaded history (`view` loads it). */
  inspectorView(chatId: ChatId, userId: UserId): JsonValue {
    const warnings: string[] = this.host.capabilities.cancel ? [] : [CANNOT_STOP];
    const records = this.inspector.records(chatId) ?? [];
    for (const w of this.presetWarnings.get(chatId) ?? []) if (!warnings.includes(w)) warnings.push(w);
    for (const w of this.ledger.notices(chatId, userId)) if (!warnings.includes(w)) warnings.push(w);
    const view: ContextView = { generations: records.map(({ forced: _forced, entries: _entries, ...r }) => r).reverse(), warnings };
    return JSON.parse(JSON.stringify(view)) as JsonValue;
  }

  // ---------------------------------------------------------------- views

  async view(chatId: ChatId, userId: UserId): Promise<StateView> {
    const run = await this.runOf(chatId, userId);
    if (!run) return notWorldView(chatId);
    const core = await this.ledger.core(chatId, userId);
    if (!core) return notWorldView(chatId);
    const observed = toChain(await this.host.chats.messages(chatId, userId));
    const stored = await this.chips.list(chatId, userId);
    // The inspector's history and the meter are read from storage the first time the chat is viewed.
    await this.inspector.load(chatId, userId);
    await this.meter.ready(userId);
    // GM → This chat shows the chat's knowledge choices beside what each follows: the user's own (no chat, no world).
    const settings = await this.settings.get(userId);
    const knowledge = { chat: await this.chatKnowledge.get(chatId, userId), tracking: knowledgeOn(null, null, settings), narrator: narratorView(null, null, settings) };
    const view = buildView({ chatId, run, core, observed, registry: this.registry, world: (r) => core.worldAt(r), stored, meter: this.meter.view(userId), mapDisplay: await this.chatPrefs.mapDisplay(chatId, userId), knowledge });
    view.panels["core.context"] = this.inspectorView(chatId, userId);
    // A turn kept from a reply that failed waits on the player (DESIGN §5.1): its card shows while it lasts.
    const kept = this.ledger.keptOf(chatId);
    const last = observed.at(-1);
    if (kept && last) view.chips.push(replyFailedChip(kept.turn, kept.failed, kept.as, last.id));
    const staged = await this.staged.get(chatId, userId);
    view.staged = staged ? { action: staged.action, params: staged.request, source: staged.source, label: staged.label } : null;
    return view;
  }

  /**
   * The player's next message takes the chat's staged action (DESIGN §11): it is recorded on that
   * message as an action message's is, its words the described approach, so a swipe, a Re-run or a
   * Continue plays it alike, and the stage clears. A message from before it was staged, or one that
   * already carries an action (a chip's, a Send now), takes nothing.
   */
  takeStaged(chatId: ChatId, userId: UserId, messageId: MessageId): Promise<void> {
    const key = `${userId}\u0000${chatId}`;
    const next = (this.taking.get(key) ?? Promise.resolve())
      .then(async () => {
        const staged = await this.staged.get(chatId, userId);
        if (!staged) return;
        const messages = await this.host.chats.messages(chatId, userId);
        const at = messages.findIndex((m) => m.id === messageId);
        const after = staged.after === null ? -1 : messages.findIndex((m) => m.id === staged.after);
        const m = messages[at];
        if (!m?.isUser || (staged.after !== null && after < 0) || at <= after) return;
        const own = m.metadata[LEDGER_NAMESPACE];
        if (isRecord(own) && typeof own.action === "string") return;
        const words = (m.swipes[m.swipeId] ?? m.content).trim() !== "";
        // `staged`: the player wrote this message, so its words are read too, for all else they say.
        const intent: JsonObject = { action: staged.action, params: staged.params, source: staged.source, staged: true, ...(words ? { described: true } : {}) };
        await this.host.chats.writeMetadata(chatId, messageId, { ...m.metadata, [LEDGER_NAMESPACE]: { ...(isRecord(own) ? own : {}), ...intent } }, userId);
        await this.staged.set(chatId, userId, null);
        this.push.changed(chatId, userId);
      })
      .catch((error: unknown) => this.host.log("warn", `[LumiRPEngine] chat ${chatId}: the staged action wasn't recorded on the message (${error instanceof Error ? error.message : String(error)})`, userId));
    this.taking.set(key, next);
    return next;
  }

  /** A stored chip, removed (it was acted on). */
  takeChip(chatId: ChatId, userId: UserId, id: ChipId): Promise<StoredChip | null> {
    return this.chips.take(chatId, userId, id);
  }

  /** Refs to `events` in a record, in order: by default among its read (post-`pre`) events; `start: 0` includes the plan's. */
  static refsOf(rec: { events: LedgerEvent[]; pre: number }, events: readonly JsonValue[], start = rec.pre): EventRef[] {
    const refs: EventRef[] = [];
    const wanted = events.map((e) => JSON.stringify(e));
    let from = start;
    for (const w of wanted) {
      const index = rec.events.findIndex((e, i) => i >= from && JSON.stringify(e) === w);
      if (index < 0) continue;
      refs.push({ in: "events", index });
      from = index + 1;
    }
    return refs;
  }

  bridgeOf(chatId: ChatId): TurnBridge | undefined {
    return this.bridges.get(chatId);
  }

  /** The head assistant message of a chat (writes target it). */
  static head(observed: readonly ChainMessage[]): { id: MessageId; swipeId: number } | null {
    const m = observed.findLast((x) => !x.isUser);
    return m ? { id: m.id, swipeId: m.swipeId } : null;
  }
}

export const TYPE_LABELS: Record<ExtractionType, string> = {
  time_advance: "Time skips",
  location: "Moves",
  condition: "Condition changes",
  knows: "New facts",
  give: "Handovers",
  purchase: "Purchases",
  transfer: "Payments",
  regard: "Feelings",
  quantity: "Quantities",
  spawn: "New characters",
  life: "Life and death",
  routine: "Routine changes",
  take: "Things picked up",
  drop: "Things put down",
  use_up: "Things used up",
  wear: "Things put on or off",
  lose: "Things lost or stolen",
  item_condition: "Wear and damage",
  learn: "Things you learn",
  reveal: "Secrets the story reveals to you",
};

/**
 * A typed timelapse's target from `interpret`'s read of it (DESIGN §9.2): its `span`, the player's
 * own words for how long or until when, read the same way every time (`typedSpan`); else `at` a
 * stated day and time ("YYYY-MM-DD HH:MM", local to where the POV is, as the HUD shows it); else
 * `until`, in the player's words ("later that evening", "tomorrow morning") or as a day part (or
 * the next one), shift or commitment; else `minutes`. A stated time that has passed is still the
 * target, so the turn refuses it with its note as it does any target it can't reach, and one beyond a
 * timelapse's reach is run toward a reach at a time; text that isn't a day and time the calendar has
 * is no stated time. With the registry, "until dinner" and the other anchors run to the POV's own
 * day (`planAnchors`).
 */
export function interpretedTarget(params: JsonObject, world: WorldDoc, state: Readonly<WorldState>, text: string, reg?: Registry): TimelapseTarget | null {
  const cal = calendarOf(world);
  const now = state.clock;
  const anchorAt = reg ? planAnchors(reg, world, state) : undefined;
  const said = typeof params.span === "string" ? typedSpan(cal, now, params.span, anchorAt) : null;
  if (said) return said;
  const local = typeof params.at === "string" ? clockOfStamp(cal, params.at) : null;
  if (local !== null) return { type: "at", at: local - placeOffset(world, local, placeOfEntity(state, world.pov)) };
  const raw = typeof params.until === "string" ? params.until.trim().toLowerCase() : "";
  const spoken = raw === "" ? null : typedSpan(cal, now, raw, anchorAt);
  if (spoken) return spoken;
  const next = /^(the\s+)?(next|tomorrow)\b/.test(raw);
  const until = raw.replace(/^(the\s+)?(next|tomorrow)\s*/, "");
  const idx = cal.dayParts.findIndex((d) => d.id.toLowerCase() === until || d.label.toLowerCase() === until);
  const part = cal.dayParts[idx];
  if (part) {
    // The model may drop the "next" the player typed ("…sleep until the next morning" → until "morning").
    const words = [until, part.label.toLowerCase()].map((w) => w.replace(/[^a-z0-9 ]/g, "")).filter((w) => w !== "");
    if (next || /\btomorrow\b/i.test(text) || new RegExp(`\\bnext\\s+(${words.join("|")})\\b`, "i").test(text)) return nextDayPart(cal, now, idx);
    return { type: "day_part", dayPart: part.id };
  }
  if (until === "shift" || until === "commitment") return { type: until };
  // A number, or one written as text ("90").
  const given = typeof params.minutes === "string" && /^\s*\d+(?:\.\d+)?\s*$/.test(params.minutes) ? Number(params.minutes) : params.minutes;
  const minutes = typeof given === "number" && Number.isFinite(given) ? Math.round(given) : 0;
  return minutes > 0 ? { type: "duration", minutes } : null;
}

/** The block of the POV's day an anchor starts: a meal, or bed for bedtime. */
const ANCHOR_ACTIVITY: Record<Exclude<SpanAnchor, "morning">, string> = { breakfast: "breakfast", lunch: "lunch", dinner: "dinner", bedtime: "sleep" };

/**
 * Where typed time's anchors fall in the POV's own day (DESIGN §9.2 typed time): the next start of
 * its block for a meal or for bed, in today's plan, else tomorrow's; for the morning, when its
 * night's sleep ends. Null when its day has none, so the calendar's part of the day stands in. The
 * plans are laid only when a span names an anchor.
 */
function planAnchors(reg: Registry, world: WorldDoc, state: Readonly<WorldState>): (anchor: SpanAnchor) => number | null {
  if (!reg.packs.some((p) => p.id === "castlife")) return () => null;
  let laid: DayPlan["blocks"] | null = null;
  return (anchor) => {
    const today = dateAt(calendarOf(world), state.clock).dayIndex;
    const ctx = reg.context(world, state);
    const blocks = (laid ??= [today, today + 1].flatMap((day) => dayPlan(ctx, world.pov, day).blocks));
    if (anchor !== "morning") return blocks.find((b) => b.activity === ANCHOR_ACTIVITY[anchor] && b.start > state.clock)?.start ?? null;
    // A night's sleep is two blocks across midnight: the morning is where the run of sleep ends.
    return blocks.find((b, i) => b.activity === "sleep" && b.end > state.clock && !(blocks[i + 1]?.activity === "sleep" && blocks[i + 1]?.start === b.end))?.end ?? null;
  };
}

/** A swipe's receipt for the `index`th typed action dropped for naming nothing that fits. */
function unfitId(messageId: MessageId, swipeId: number, index: number): string {
  return index === 0 ? `unfit:${messageId}:${swipeId}` : `unfit:${messageId}:${swipeId}:${index}`;
}

/** The id prefixes of the chips a reply's read stores (`prepareRead`) or offers (`readLanded`). */
const READ_CHIP_PREFIXES = ["undo:", "confirm:", "untracked:", "choice:", "unpriced:", "adv:"] as const;

/**
 * Whether a chip is the reply's read's: its undo, confirm, Not tracked and choice chips, an unpriced
 * purchase's, and the Timelapse offers of the skips it read. A read that replaces it drops them; the
 * turn's own chips about the player's message are none of them.
 */
function isReadChip(id: string): boolean {
  return READ_CHIP_PREFIXES.some((p) => id.startsWith(p));
}

/**
 * The POV's hold a span the player's words spent keeps: typed as one, or stated to an action the turn
 * sped through ("sleep for eight hours"), its Speed through and Continue keep the POV where the story
 * has it (DESIGN §8).
 */
function holdOf(bridge: TurnBridge, userText: string, plan: EngineTurnPlan | undefined): JsonObject {
  return bridge.intentOf(userText)?.params.povRoutine === false || plan?.timelapse?.povRoutine === false ? { povRoutine: false } : {};
}

/** A swipe's Send chip holding the rest of the message its turn didn't play (DESIGN §5.2, §11). */
function restChipId(messageId: MessageId, swipeId: number): string {
  return `next:${messageId}:${swipeId}`;
}

/** What a model writes for "nothing" ("none", "null", "N/A"), compared as `offeredNext` compares words. */
const NO_VALUE: Record<string, true> = { "": true, none: true, null: true, nil: true, na: true, "n a": true, nothing: true, no: true, undefined: true, empty: true };

/**
 * Words of the message the turn won't play (a queued action's, or what no action reads) as its chip
 * may offer them (DESIGN §5.2), or null. Whether they are an action, and whether they only let time
 * pass (which is `then`'s, offered as a Timelapse), is the read's call, never a word list's, so only
 * junk is kept off: a placeholder for nothing ("none", "N/A"); the message or its first action said
 * again ("I walk to Bluebird Coffee" after "I walk to Bluebird Coffee to buy a latte"), whose chip
 * would play it twice; and words carrying an unrevealed secret (`secrets`, less the player's own
 * words) or naming anything hidden the player's message (`text`) doesn't, which are dropped on their
 * own while the actions still play. A hidden name the player typed stays: dropping their own words
 * would tell them someone hidden goes by it.
 */
function offeredNext(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, next: string, text: string, secrets: readonly string[]): string | null {
  // Compared as words, without the player's own "I" or "we": "I walk to the cafe." is "walk to the cafe".
  const words = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .replace(/^(?:i|we)\s+/, "");
  const said = words(next);
  if (hasOwn(NO_VALUE, said) || words(text).startsWith(said)) return null;
  return findLeaks(next, secrets).length > 0 || namesHiddenOrSecretLore(reg, world, state, next, text) ? null : next;
}

/**
 * The words a read gave for one of its actions as they are quoted (DESIGN §5.1, §9.2), or null: a
 * placeholder for nothing ("none", "N/A"), and words carrying an unrevealed secret (`secrets`) or
 * naming anything hidden that `heard` doesn't say too. The intent gate's card and the narrator's
 * Outcome both hear the player's message, which the narrator reads anyway, so their own words are
 * never cut for a hidden name they typed (which would tell them someone hidden goes by it).
 */
function quotedWords(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, piece: string, secrets: readonly string[], heard: string): string | null {
  const said = piece.replace(/\s+/g, " ").trim();
  if (hasOwn(NO_VALUE, said.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim())) return null;
  return findLeaks(said, secrets).length > 0 || namesHiddenOrSecretLore(reg, world, state, said, heard) ? null : said;
}

/**
 * How long a time skip runs, as the intent gate's card and the narrator are told it (DESIGN §5.1,
 * §9.2): its length, or what it runs until, and with `clocked` the clock it runs from and the time
 * its target falls at, as the HUD shows times ("1 h, 10:29 PM to 11:29 PM"; "until evening: 2 h 10
 * min, 3:50 PM to 6:00 PM"). A target that falls at no time says only what it runs until.
 */
function skipWords(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, target: TimelapseTarget, clocked: boolean): string {
  const part = target.type === "day_part" ? world.calendar.dayParts.find((d) => d.id === target.dayPart)?.label.toLowerCase() : undefined;
  const what =
    target.type === "duration"
      ? compactSpan(target.minutes)
      : target.type === "at"
        ? `to ${shortClock(world, state, target.at)}`
        : target.type === "day_part"
          ? `until ${part ?? "that part of the day"}`
          : target.type === "shift"
            ? "until your next shift"
            : target.type === "commitment"
              ? "until your next commitment"
              : target.type === "arrival"
                ? "until you arrive"
                : target.type === "stage"
                  ? "until the story moves on"
                  : "until something happens";
  const reached = clocked ? resolveTarget(reg, world, state, target) : null;
  if (!reached || "code" in reached) return what;
  // Where the skip ends, though one farther than a timelapse reaches runs there in steps.
  const end = reached.goal ?? reached.to;
  const range = `${shortClock(world, state, state.clock)} to ${shortClock(world, state, end)}`;
  return target.type === "duration" ? `${what}, ${range}` : `${what}: ${compactSpan(end - state.clock)}, ${range}`;
}

/**
 * What is left to offer of the time a typed message asked to pass after its actions, or beyond what
 * a skip runs without asking (DESIGN §9.2), once the reply has had its say: the read moved the clock
 * `told` minutes, its chips would move it `pending` more (a narrated span waiting on Apply, or on
 * its own Timelapse chip), and the turn may offer to run it on to `offeredTo` already (Speed through
 * an activity). Each counts toward it, so tapping the offer never runs the same time twice: a length
 * is what the reply left of it; a stated time, a part of the day, a shift or a commitment stays as
 * it is until the clock gets there. Null when nothing is left. Where the asked span falls is read
 * from the clock the turn's actions left, before the reply's time.
 */
function offerLeft(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, asked: TimelapseTarget, told: number, pending: number, offeredTo: number | null): TimelapseTarget | null {
  if (told <= 0 && pending <= 0 && offeredTo === null) return asked;
  const from = state.clock - told;
  const reached = asked.type === "duration" ? { to: from + asked.minutes } : resolveTarget(reg, world, { ...state, clock: from }, asked);
  if ("code" in reached) return asked;
  const end = "goal" in reached && reached.goal !== undefined ? reached.goal : reached.to;
  const runs = state.clock + pending;
  if (end <= runs || (offeredTo !== null && end <= offeredTo)) return null;
  return asked.type === "duration" ? { type: "duration", minutes: end - runs } : asked;
}

/**
 * The minutes a reply's read would still move the clock, waiting on the player (DESIGN §9.4): a
 * narrated span on its confirm chip, and one longer than a skip runs without asking on its own
 * Timelapse chip, stored (`stored`, the reply's) or the read's own (`read`).
 */
function narratedPending(stored: readonly StoredChip[], read: readonly ReadChip[]): number {
  let minutes = 0;
  for (const chip of stored) {
    const proposal = chip.kind === "confirm" && chip.payload.type === "time_advance" && isRecord(chip.payload.proposal) ? chip.payload.proposal : null;
    if (proposal && typeof proposal.minutes === "number" && proposal.minutes > 0) minutes += proposal.minutes;
    const target = chip.kind === "timelapse_offer" && chip.id.startsWith("adv:") ? parseTarget(chip.payload.target) : null;
    if (target?.type === "duration") minutes += target.minutes;
  }
  for (const chip of read) if (chip.target.type === "duration") minutes += chip.target.minutes;
  return minutes;
}

/** Actions in the player's words as one message, in order ("I buy a latte. I sit by the window"); a single one stays exactly as given. Empty pieces are skipped. */
function joinActions(pieces: readonly string[]): string {
  const said = pieces.map((p) => p.trim()).filter((p) => p !== "");
  return said.map((p, i) => (i < said.length - 1 && !/[.!?]$/.test(p) ? `${p}.` : p)).join(" ");
}

/** Why the action queue stopped, for the chip holding the rest of the message (DESIGN §11). */
const STOPPED: Record<QueueStop, string> = {
  check: "it stopped at the check",
  failure: "it stopped when an action didn't go through",
  interruption: "it stopped when something came up",
};

/** Why the action queue stopped, for the narrator (DESIGN §9.5, §11). */
const STOPPED_NOTE: Record<QueueStop, string> = {
  check: "it waits on that check",
  failure: "an action didn't go through",
  interruption: "something came up",
};

/**
 * An action's params as `interpret` read them, ready to play: money the model stated as written
 * ("$200") in minor units (cents), and a way of paying the player named that the model left out (a
 * long sentence can lose it), from the first of `said` that names one ("credit card", "cash"); a
 * method the model set stands.
 */
function playable(action: ActionDef, params: JsonObject, world: WorldDoc, said: readonly string[]): JsonObject {
  const out: JsonObject = { ...params };
  const scale = 10 ** world.currency.decimals;
  for (const [name, def] of Object.entries(action.params)) {
    const v = out[name];
    if (def.type === "money" && typeof v === "number" && Number.isFinite(v)) out[name] = Math.round(v * scale);
  }
  const method = out.method;
  const named = hasOwn(action.params, "method") && !(typeof method === "string" && method.trim() !== "") ? (said.map(saidPayMethod).find((m) => m !== null) ?? null) : null;
  if (named) out.method = named;
  return out;
}

/**
 * Why `interpret`'s action couldn't apply (DESIGN §9.4), for its receipt and a request's refusal: a
 * real thing the POV knows, of another kind, by its name ("Bluebird Coffee isn't a person"); anything
 * else, made up or hidden alike, as one nothing has, in the player's own words for it (`text`, whole
 * words only: "Rena isn't anyone you know"), else, with none of theirs (a request, with no `text`) or
 * too long for a name, "it names no one you know"; or that it has none. Neither reads otherwise for
 * someone hidden going by those words. A param that pays (`ParamDef.outside`, DESIGN §9.4 typed
 * money) takes someone, as a person's does, and a payment that pays no one for another reason than
 * whom it names gives that reason (`UnfitRef.reason`: "it needs an amount", "Piggy bank is yours").
 */
function unfitReason(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, unfit: UnfitRef, text: string, secrets: readonly string[], mayKnow: (id: EntityId) => boolean): string {
  const { def, value } = unfit;
  const place = def.ref === "place";
  const person = !place && (def.ref !== undefined ? kindIs(reg, world, def.ref, "person") : def.outside !== undefined || (def.of?.kind ?? []).some((k) => kindIs(reg, world, k, "person")));
  if (value === undefined || value === null || value === "") return place ? "it needs a place" : person ? "it needs someone" : "it needs something";
  const none = place ? "it names no place you know" : person ? "it names no one you know" : "it names nothing you know";
  if (unfit.reason !== undefined) return findLeaks(unfit.reason, secrets).length > 0 ? none : unfit.reason;
  const id = typeof value === "string" ? value : "";
  // Only a param of one kind, or one that pays, refuses a real thing the POV knows, for being another.
  const real = own(state.entities, id);
  const seen = real && canSeeEntity(reg, world, state, world.pov, id) ? real : undefined;
  const placeDef = seen ? undefined : own(world.places, id);
  const known = seen ? (mayKnow(id) ? seen.name : null) : placeDef && canSeePlace(reg, world, state, world.pov, id) ? placeDef.name : null;
  if (known !== null && (def.ref !== undefined || def.outside !== undefined)) {
    if (known.length > 80 || findLeaks(known, secrets).length > 0) return none;
    if (def.ref === undefined) return `${known} isn't someone to pay`;
    const kind = place ? "place" : (reg.kinds.get(def.ref)?.label ?? own(world.kinds, def.ref)?.label ?? def.ref).toLowerCase();
    return `${known} isn't ${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind}`;
  }
  // Anything else reads as one nothing has, a hidden thing's id included, so the reason can't tell the
  // player it exists: by the player's own words for it ("Rena" for a model's "rena"), an id's
  // underscores read as spaces.
  const given = id.replace(/_+/g, " ").trim();
  const typed = given === "" ? undefined : new RegExp(`(?<![\\p{L}\\p{N}])${given.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").exec(text)?.[0];
  if (typed === undefined || typed.length > 80) return none;
  return `${typed} isn't ${place ? "a place" : person ? "anyone" : "anything"} you know`;
}

/**
 * Reads how words give a puzzle's answer as the player's message must (DESIGN §5.2, §10): the answer
 * to play, or null. In them, case and spacing aside, or a number's digits without the words the read
 * added (`ownAnswer`), or naming, by its id, name or an alias, the one person, place or thing the POV
 * may know that they pick out: a whole word or run of words of its name or an alias that nothing else
 * the POV may know has ("It was Avery", with one Avery they know). A word that can't single anyone
 * out (`singlesOut`) counts only as a whole name. Its aliases are those of the lore entries about it
 * alone that a prose step may read. A hidden one counts only by its words, as a name nothing has
 * would, so an answer never tells the player who is hidden. What the POV may know is gathered once,
 * on the first answer that isn't in the words themselves.
 */
function answerReader(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, mayKnow: (id: EntityId) => boolean): (value: string, text: string) => string | null {
  let known: Map<string, string[][]> | undefined;
  const namesKnown = (): Map<string, string[][]> => {
    if (known) return known;
    const names = new Map<string, string[][]>();
    for (const [id, e] of Object.entries(state.entities)) if (mayKnow(id)) names.set(id, [answerWords(e.name)]);
    for (const [id, p] of Object.entries(world.places)) if (!names.has(id) && canSeePlace(reg, world, state, world.pov, id)) names.set(id, [answerWords(p.name)]);
    const open = loreGateReader(reg, world, state);
    for (const entry of Object.values(world.lore)) {
      const about = entry.links.length === 1 ? names.get(entry.links[0] ?? "") : undefined;
      if (about && loreReadable(reg, world, state, entry, "brief", false, open)) for (const alias of entry.aliases ?? []) about.push(answerWords(alias));
    }
    known = names;
    return names;
  };
  const bare = (w: readonly string[]): string => (w.length > 1 && /^(the|a|an)$/.test(w[0] ?? "") ? w.slice(1) : w).join(" ");
  const within = (hay: readonly string[], run: readonly string[]): boolean => {
    for (let i = 0; i + run.length <= hay.length; i++) if (run.every((w, k) => hay[i + k] === w)) return true;
    return false;
  };
  return (value, text) => {
    const typed = ownAnswer(value, text);
    if (typed !== null) return typed;
    const names = namesKnown();
    const given = bare(answerWords(value));
    const named = names.has(value) ? [value] : [...names].filter(([, ns]) => given !== "" && ns.some((n) => bare(n) === given)).map(([id]) => id);
    const target = named.length === 1 ? named[0] : undefined;
    const said = answerWords(text);
    for (const name of target === undefined ? [] : (names.get(target) ?? [])) {
      for (let i = 0; i < name.length; i++) {
        for (let j = i + 1; j <= name.length; j++) {
          const run = name.slice(i, j);
          if (run.length < name.length && !run.some(singlesOut)) continue;
          if (within(said, run) && [...names].every(([id, ns]) => id === target || !ns.some((n) => within(n, run)))) return value;
        }
      }
    }
    return null;
  };
}

/**
 * A clock time for a chip, local to where the POV is, as the HUD shows it: "7:00 AM" later the same
 * day, else with its weekday ("Sat 7:00 AM").
 */
function shortClock(world: WorldDoc, state: Readonly<WorldState>, at: number): string {
  const cal = calendarOf(world);
  const place = placeOfEntity(state, world.pov);
  const d = dateAt(cal, at + placeOffset(world, at, place));
  const today = dateAt(cal, state.clock + placeOffset(world, state.clock, place)).dayIndex;
  return d.dayIndex === today ? formatTimeOfDay(d.minuteOfDay) : `${weekdayName(cal, d.weekday)} ${formatTimeOfDay(d.minuteOfDay)}`;
}

/** The Outline slot's lines: the brief, the engine's beats, then the outline step's prose. */
function planOutline(plan: EngineTurnPlan, prose: PlanProse | undefined): string[] {
  return [...(prose?.brief ? [`Brief: ${prose.brief}`] : []), ...plan.outline, ...(prose?.outline ?? [])];
}

/**
 * What the narrator must know about the turn's plan (DESIGN §6.2 Outcome, §9.2 Montage, §11): each
 * action's result in the order they played, with its roll, or why a hard lock stopped it, and that
 * the rest of the message hasn't happened when the queue stopped; a fight's round; and a timelapse's
 * Montage groups, money, the bands it crossed and its net changes, each already cut to what the
 * POV may see (`buildMontage`). Why an action couldn't run is told as the player reads it, never as a
 * requirement's expression, which may name a secret track or someone the player doesn't know. An
 * action that plays as plain roleplay is the player's words alone: the narrator hears nothing of it.
 */
export function planLines(plan: EngineTurnPlan, world: WorldDoc, registry: Registry): { outcome: string[]; montage: string[] } {
  const outcome: string[] = [];
  for (const res of plan.resolutions) {
    if (playsAsRoleplay(res)) continue;
    // The action as it played, in words (`toldAction`): its picks, where it started, its time and what it changed.
    const label = res.told?.what ?? res.inferred?.label ?? (world.actions[res.action] ?? registry.actions.get(res.action))?.label ?? res.action;
    const took = res.told && res.told.minutes > 0 ? `, taking ${spanText(res.told.minutes)}` : "";
    const changed = res.told && res.told.changes.length > 0 ? ` What changed: ${res.told.changes.join("; ")}.` : "";
    const reasons = res.rejected.slice(0, 3).map((r) => r.rejection.reason);
    if (!res.ok) outcome.push(`${label}: it didn't happen (${res.failed ? playerReason(res.failed).replace(/\.$/, "") : "not possible"}). Narrate the attempt failing.`);
    else if (res.check || res.adjudged) {
      // An inferred check is told with its people and the policy's detail and guidance (DESIGN §11).
      outcome.push(`${res.inferred ? inferredOutcome(res, res.inferred) : checkLine(label, res)}${changed}`);
      for (const r of reasons) outcome.push(`Not possible: ${r}.`);
    } else if (reasons.length > 0) outcome.push(`${label}: it didn't go through (${reasons.join("; ")}). Narrate it failing; nothing changed hands.`);
    else outcome.push(`${label}: done${took}. Narrate it as done.${changed}`);
  }
  // A fight's part of the turn (DESIGN §11): the round in order, then whose turn it is.
  outcome.push(...plan.combat);
  // A timelapse covers what actually ran, not what was asked for (an interrupt may stop it early).
  const summary = plan.timelapse?.summary;
  if (summary) {
    const cal = calendarOf(world);
    const span = spanText(summary.to - summary.from);
    // A character's mind that stopped a time skip is named only as the POV may know them (DESIGN §24.7).
    const by = summary.stoppedBy === "mind" ? (plan.timelapse?.mindName ?? "someone") : summary.stoppedBy ? STOP_LABEL[summary.stoppedBy] : null;
    // What the player's message fills it with is the content the narrator tells of it: their directive.
    const filled = plan.fill ? ` The player's message fills this time: “${plan.fill}”. Narrate that as what the player character does in it.` : "";
    outcome.push(`Time passed: ${span}, from ${formatClock(cal, summary.from)} to ${formatClock(cal, summary.to)}${by ? `, stopped early by ${by}` : ""}.${filled}`);
  }
  // The player's message holds more than the turn played: told so, the narrator doesn't play it out.
  if (plan.stopped) outcome.push(`The rest of the player's message hasn't happened (${STOPPED_NOTE[plan.stopped.cause]}); don't narrate it.`);
  const montage: string[] = [];
  const m = plan.montage;
  if (m) {
    // The player's own words for the span lead what happened in it.
    if (plan.fill && summary) montage.push(`What the player character does in this time, in the player's words: ${plan.fill}`);
    for (const g of m.groups.slice(0, 7)) montage.push(`${g.label}: ${g.lines.slice(0, 6).join("; ")}`);
    for (const a of m.money.slice(0, 4)) montage.push(`${a.label} took in ${formatMoney(a.in, world.currency)} and paid out ${formatMoney(a.out, world.currency)}`);
    for (const b of m.bands.slice(0, 6)) montage.push(b.from ? `${b.label} went from ${b.from} to ${b.to}` : `${b.label} is now ${b.to}`);
    for (const c of m.changes.slice(0, 4)) montage.push(`${c.label} went ${c.delta > 0 ? "up" : "down"} by ${c.money ? formatMoney(Math.abs(c.delta), world.currency) : String(Math.round(Math.abs(c.delta) * 100) / 100)}`);
  }
  return { outcome, montage };
}

/** A share as a whole percentage ("62%"), as chips and the Outcome slot say odds. */
const percent = (p: number): string => `${Math.round(p * 100)}%`;

/**
 * The Outcome slot's line for an action's check (DESIGN §6.2, §11), worded for how the adjudication
 * policy decided it: a roll to narrate as it fell (and, under hybrid, a close call that may come at a
 * cost or leave partial progress), the story's judged outcome, or the reason nothing was rolled.
 */
function checkLine(label: string, res: Resolution): string {
  const a = res.adjudged;
  const c = res.check;
  if (c) {
    const rolled = `rolled ${c.total} on ${c.roll.notation}${a?.approach && a.approach.rating > 0 ? `, ${a.approach.rating} of ${a.approach.max} for the approach` : ""}`;
    const close = a?.close;
    if (!a || !close) return `${label}: ${c.outcome} (${rolled}). Narrate this result.`;
    const passed = a.pass.includes(c.outcome);
    const near = a.pass.includes(close.outcome);
    if (passed && !near) return `${label}: ${c.outcome}, only just (${rolled}). Narrate it succeeding; it may come at a cost.`;
    if (!passed && near) return `${label}: ${c.outcome}, only just (${rolled}). Narrate it failing; it may leave partial progress.`;
    return `${label}: ${c.outcome}, close to ${close.outcome} (${rolled}). Narrate this result; it may come at a cost or leave partial progress.`;
  }
  const outcome = res.outcome ?? "";
  switch (a?.why) {
    case "impossible":
      return `${label}: ${outcome} (too hard to pull off, so no roll). Narrate the attempt failing.`;
    case "retry":
      return `${label}: ${outcome} again (nothing has changed since the last try, so no roll). Narrate it failing the same way.`;
    case "story":
      return `${label}: ${outcome}, as the story decides from the player's approach (no roll${a.chance === null ? "" : `; the dice gave success ${percent(a.chance)}`}). Narrate this result.`;
    default:
      return `${label}: ${outcome} (no roll needed). Narrate this result.`;
  }
}

/**
 * The roll chip (DESIGN §12): what was rolled with its odds, or, when the adjudication policy rolled
 * nothing, why; with the judged approach and a hybrid close call. Under narrative authority a roll
 * means nothing judged the approach, so the dice decided. Null without a check.
 */
export function rollChip(label: string, res: Resolution): { label: string; detail: string } | null {
  if (res.inferred) return inferredChip(res, res.inferred);
  const a = res.adjudged;
  const c = res.check;
  const approach = a?.approach ? ` Your approach: ${a.approach.rating} of ${a.approach.max}${a.approach.reason ? ` (${a.approach.reason})` : ""}.` : "";
  if (c) {
    const odds = Object.entries(c.odds)
      .map(([band, p]) => `${band} ${percent(p)}`)
      .join(" · ");
    const mod = c.modifier !== 0 ? ` ${c.modifier > 0 ? "+" : "−"} ${Math.abs(c.modifier)}` : "";
    // The natural die when a band reads it, and the DC a margin is measured from (DESIGN §11).
    const natural = c.natural !== null && (c.check.bands ?? []).some((b) => b.natural) ? ` (natural ${c.natural})` : "";
    const dc = c.dc !== null && c.dc !== 0 ? ` against ${c.dc}` : "";
    const close = a?.close ? ` Close: ${Math.abs(a.close.points)} ${Math.abs(a.close.points) === 1 ? "point" : "points"} ${a.close.points < 0 ? "lower" : "higher"} would have been ${a.close.outcome}.` : "";
    const undecided = a?.authority === "narrative" ? " Nothing judged your approach, so the dice decided." : "";
    return { label: `${label}: ${c.outcome}`, detail: `Rolled ${c.roll.notation}${mod} = ${c.total}${natural}${dc}. Odds: ${odds}.${approach}${close}${undecided}` };
  }
  if (!a) return null;
  const chance = a.chance === null ? "" : ` (${percent(a.chance)} to succeed)`;
  const why: Record<NonNullable<typeof a.why>, string> = {
    trivial: `a sure thing${chance}`,
    impossible: `too hard to try${chance}`,
    safe: `only risky checks roll${chance}`,
    unmarked: "checks roll only for marked actions, places and quests",
    never: "this chat doesn't roll checks",
    story: `the story decides, judged from your approach${chance}`,
    retry: a.retry === "once" ? "you already failed this here; it takes a new scene" : "you already failed this; it takes a change (time, another way, or better odds)",
  };
  return { label: `${label}: ${res.outcome ?? ""}`, detail: `No roll: ${a.why ? why[a.why] : "the policy settled it"}.${approach}` };
}

/** The thing a proposal is about, for chip labels ("coffee", "Toolbox"). */
export function describeItem(p: JsonObject): string {
  const v = p.name ?? p.item ?? p.category;
  return typeof v === "string" && v !== "" ? v : String(p.type);
}

/**

 * What a purchase's chip adds to its label, from the events that applied it: the amount it charges,
 * the catalog item it's priced as when that isn't the narrated name, and a narrated price the
 * charge doesn't match (": 500 bits (narrated 1,200 bits, capped at 500 bits)", ": $2.50 (priced as
 * Latte, 16 oz; narrated $9.00, clamped to $2.50)"), with the amount and whether it was capped or
 * clamped. Null for anything else, or a purchase that records no history line; a purchase nothing
 * could pay charged nothing, and `paidWords` says so.
 */
export function purchaseQuote(p: JsonObject, events: readonly LedgerEvent[], world: WorldDoc): { text: string; cents: number; limited: boolean } | null {
  if (p.type !== "purchase") return null;
  for (const e of events) {
    const memo = e.type === "economy.txn" && "data" in e ? e.data.memo : undefined;
    if (!("data" in e) || typeof memo !== "string" || !memo.startsWith("Bought ") || e.data.unpaid !== undefined) continue;
    // The amount its posting moved (whoever's accounts its sides are), else what left the payer's own accounts.
    const post = events.find((x): x is PostEvent => x.type === "post" && x.memo === memo);
    const lines = Array.isArray(e.data.lines) ? e.data.lines : [];
    const cents = post ? post.lines.reduce((sum, l) => sum + Math.max(0, l.amount), 0) : lines.reduce((sum: number, l) => sum + (isRecord(l) && typeof l.amount === "number" && l.amount < 0 ? -l.amount : 0), 0);
    const money = (minor: number): string => formatMoney(minor, world.currency);
    const name = memo.slice("Bought ".length).replace(/\s×\d+$/, "");
    const said = typeof p.item === "string" ? p.item.trim().toLowerCase() : "";
    const limit = e.data.limited === "cap" ? "capped at" : e.data.limited === "band" ? "clamped to" : null;
    const narrated = e.data.narrated;
    const notes = [...(name.toLowerCase() !== said ? [`priced as ${name}`] : []), ...(limit && typeof narrated === "number" ? [`narrated ${money(narrated)}, ${limit} ${money(cents)}`] : [])];
    return { text: `: ${money(cents)}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`, cents, limited: limit !== null };
  }
  return null;
}

/**
 * The ways to price a narrated purchase nothing priced (DESIGN §9.5): **Set price** asks for an
 * amount in the world's currency, and **Pick item** offers catalog items, those sharing a word with
 * it first and then what's sold where the payer is.
 */
export function pricingActions(p: JsonObject, ctx: ReadContext): ChipAction[] {
  const { world, state } = ctx;
  const payer = typeof p.payer === "string" && hasOwn(state.entities, p.payer) ? p.payer : world.pov;
  const choices = optionalQuery(ctx, "economy.item_choices")?.(ctx, describeItem(p), payer) ?? [];
  return [
    { id: "price", label: "Set price", style: "primary", input: { type: "money", label: `Price of ${describeItem(p)}` } },
    ...(choices.length > 0 ? [{ id: "item", label: "Pick item", input: { type: "choice" as const, label: "Priced as", options: choices.map((o) => ({ value: o.item, label: `${o.name} · ${formatMoney(o.cents, world.currency)}` })) } }] : []),
  ];
}

/** Pay another way (DESIGN §9.5): a narrated payment that went past what its account covers moves to the first way of the payer's that covers it. */
const PAY_ANOTHER_WAY: ChipAction = { id: "other", label: "Pay another way" };

/**
 * What a narrated payment's chip says of the money (DESIGN §9.5), from `economy.paid_from`: where
 * it came from and that account after it ("From Your checking account: overdrawn by $87.00.",
 * "On Your credit card: $4,624.90 owed, $124.90 over its limit."), and when that went past what the
 * account covers, why, on the label too (" (over Your credit card's limit)"), with Pay another way
 * (`over`). A purchase nothing could pay says so on its label (": nothing charged") and why. Nothing
 * for money that isn't the POV's to see.
 */
function paidWords(paid: PaidFrom | null, world: WorldDoc): { label: string; detail: string; over: boolean } {
  if (!paid) return { label: "", detail: "", over: false };
  const money = (minor: number): string => formatMoney(minor, world.currency);
  if ("unpaid" in paid) return { label: ": nothing charged", detail: `Nothing you pay with covers ${money(paid.unpaid)} or can run a debt: it's yours with nothing charged.`, over: false };
  const over = paid.over > 0;
  const now = paid.credit ? `${money(paid.cents)} owed${over ? `, ${money(paid.over)} over its limit` : ""}` : paid.cents < 0 ? `overdrawn by ${money(-paid.cents)}` : `${money(paid.cents)} left`;
  return {
    label: !over ? "" : paid.credit ? ` (over ${paid.name}'s limit)` : ` (overdraws ${paid.name})`,
    detail: `${paid.credit ? "On" : "From"} ${paid.name}: ${now}.${over ? ` No way of paying covered ${money(paid.total)}.` : ""}`,
    over,
  };
}

/**
 * Whose a narrated purchase makes the thing, as its chips name them (DESIGN §9.5): null for the
 * POV's own, else its payer (`economy.purchaser`) as a change names a person (`refName`), so one the
 * POV doesn't know reads "someone you don't know".
 */
function buyerOf(p: JsonObject, ctx: ReadContext): string | null {
  const payer = optionalQuery(ctx, "economy.purchaser")?.(ctx, p) ?? ctx.world.pov;
  return payer === ctx.world.pov ? null : refName(ctx, "person", payer);
}

/**
 * The chip of a narrated purchase nothing priced that is now the payer's (DESIGN §9.5): owned with
 * nothing charged until Set price or Pick item charges it, with Undo when anything applied (`events`,
 * the read's own or an Apply's). It says whose it is: "It's yours", or someone else's by name.
 * `payload` is the rest of what acting on it needs.
 */
export function unpricedChip(id: string, at: { messageId: MessageId; swipeId?: number }, proposal: JsonObject, ctx: ReadContext, events: readonly LedgerEvent[], payload: JsonObject): StoredChip {
  const pricing = pricingActions(proposal, ctx);
  const priceWords = pricing.length > 1 ? "Set price or Pick item" : "Set price";
  const buyer = buyerOf(proposal, ctx);
  const whose = buyer === null ? "It's yours" : `${buyer.charAt(0).toUpperCase()}${buyer.slice(1)} has it`;
  return {
    id,
    kind: "undo",
    messageId: at.messageId,
    ...(at.swipeId !== undefined ? { swipeId: at.swipeId } : {}),
    label: `Bought ${describeItem(proposal)}: no price`,
    detail: events.length > 0 ? `${whose}, with nothing charged: the narration gives no price and the catalog doesn't list it. ${priceWords} charges it.` : `The narration gives no price and the catalog doesn't list it, so nothing was charged. ${priceWords} charges it.`,
    actions: [...pricing, ...(events.length > 0 ? [{ id: "undo", label: "Undo", style: "danger" as const }] : [])],
    expires: "next_send",
    payload: { ...payload, proposal, events: JSON.parse(JSON.stringify(events)) as JsonValue },
  };
}

/**
 * The ask of a narrated purchase nothing priced, under `confirm` (DESIGN §9.5): whose Apply makes it,
 * with nothing charged, and whose a price makes it; or, when Apply would change nothing, what charges it.
 */
function unpricedAsk(proposal: JsonObject, ctx: ReadContext, applies: boolean, priceWords: string): string {
  const buyer = buyerOf(proposal, ctx);
  const apply = buyer === null ? `Apply makes it yours with nothing charged; ${priceWords} makes it yours at that price.` : `Apply gives it to ${buyer} with nothing charged; ${priceWords} gives it to them at that price.`;
  return `The narration gives no price and the catalog doesn't list it. ${applies ? apply : `${priceWords} charges it.`}`;
}

/** How a change names a reference in `role` (DESIGN §11): by name when the POV knows it (`knownRef`), else, written as an id, as `UNKNOWN_PHRASE` says, else as the reply wrote it. */
function refName(view: PovView, role: RefRole, said: string): string {
  return knownRef(view, role, said)?.name ?? (ID_SHAPED.test(said) ? UNKNOWN_PHRASE[role] : said);
}

/**
 * A one-line label for a proposal chip, in a sentence. With `view`, ids read as names (and money in
 * the world's currency), but only what the POV knows. A reference (`REF_ROLES`) names someone or
 * somewhere it knows (`knownRef`), or the place a `knows` teaches it (`heardPlace`). Any other
 * reference written as an id, hidden or nowhere in the world, reads as "someone you don't know", "a
 * place you don't know" or "something you don't know"; one in words (a fact told in prose, a name)
 * reads as the reply wrote it. Any other value reads as an entity the POV may be told of or a place
 * it can see, else as the reply gave it. So a label reads the same whether or not the world holds
 * what it names (DESIGN §11).
 */
export function describeProposal(p: JsonObject, view?: PovView): string {
  const world = view?.world;
  const state = view?.state;
  const raw = (k: string): string => (typeof p[k] === "string" || typeof p[k] === "number" ? String(p[k]) : "?");
  const roles = typeof p.type === "string" ? own(REF_ROLES, p.type) : undefined;
  const s = (k: string): string => {
    const v = raw(k);
    if (!view) return v;
    if (v === view.world.pov) return "you";
    const role = roles ? own(roles, k) : undefined;
    if (role !== undefined && typeof p[k] === "string" && v.trim() !== "") {
      const heard = role === "fact" ? heardPlace(view, p) : null;
      if (heard !== null) return own(view.world.places, heard)?.name ?? heard;
      const said = v.trim();
      return refName(view, role, said);
    }
    if (hasOwn(view.state.entities, v)) return povMayKnow(view.registry, view.world, view.state, v) ? (own(view.state.entities, v)?.name ?? v) : v;
    if (hasOwn(view.world.places, v)) return canSeePlace(view.registry, view.world, view.state, view.world.pov, v) ? (own(view.world.places, v)?.name ?? v) : v;
    return v;
  };
  // A sentence's subject: the POV reads "You", and takes "are", "know", "have"; someone it doesn't
  // know reads "Someone you don't know".
  const subject = (k: string): string => {
    const who = s(k);
    return who === "you" ? "You" : Object.values(UNKNOWN_PHRASE).includes(who) ? `${who.charAt(0).toUpperCase()}${who.slice(1)}` : who;
  };
  const be = (who: string): string => (who === "You" ? "are" : "is");
  const whose = (k: string): string => {
    const who = subject(k);
    return who === "You" ? "Your" : `${who}'s`;
  };
  // A channel reads a left-out actor as the player character (`strOf(p.entity) || pov`); so does its label.
  const named = (k: string): boolean => typeof p[k] === "string" && (p[k] as string).trim() !== "";
  const actor = (k: string): string => (named(k) ? subject(k) : "You");
  const change = (delta: number): string => `${delta >= 0 ? "went up" : "went down"} by ${Math.abs(delta)}`;
  switch (p.type) {
    case "purchase":
      return `Bought ${s("item")}`;
    case "transfer": {
      // The sum the transfer moves: `cents` when given (minor units), else the converted `amount`.
      const cents = transferCents(p);
      const amount = Number.isFinite(cents) && world ? formatMoney(cents, world.currency) : `${world?.currency.symbol ?? "$"}${Number.isFinite(cents) ? String(cents) : "?"}`;
      return world && p.from !== world.pov && typeof p.from === "string" ? `${s("from")} paid ${amount} to ${s("to")}` : `Paid ${amount} to ${s("to")}`;
    }
    case "give":
      // The channel passes a left-out giver through (the thing's holder gives it), so the label names only who got it.
      return named("from") ? `${subject("from")} gave ${s("item")} to ${s("to")}` : `${subject("to")} got ${s("item")}`;
    case "location":
      return `${actor("entity")} went to ${s("place")}`;
    case "condition": {
      // Sheets: {who, condition, clear?}; a bare field change (entity, field, delta) otherwise.
      if (typeof p.condition !== "string") {
        // A field's own label only on the sheet of someone the POV knows: its kind tells of them.
        const known = view && typeof p.entity === "string" ? knownRef(view, "person", p.entity) : null;
        const kind = known && state ? own(state.entities, known.id)?.kind : undefined;
        const label = kind && world ? own(world.kinds, kind)?.fields[raw("field")]?.label : undefined;
        return `${whose("entity")} ${fieldNoun(label, raw("field")).noun} ${change(Number(p.delta))}`;
      }
      const who = typeof p.who === "string" && p.who !== "" ? subject("who") : "You";
      return `${who} ${be(who)} ${p.clear === true ? "no longer" : "now"} ${raw("condition").replace(/_/g, " ")}`;
    }
    case "quantity":
      return `${named("entity") ? `${whose("entity")} count of` : "The count of"} ${s("item")} ${change(Number(p.delta))}`;
    case "regard":
      return `${whose("from")} ${s("axis").replace(/_/g, " ")} toward ${s("to")} ${Number(p.delta) >= 0 ? "rose" : "fell"} by ${Math.abs(Number(p.delta))}`;
    case "knows": {
      // The channel teaches the player character, which it reads `who` as when left out.
      const who = typeof p.who === "string" && p.who.trim() !== "" ? subject("who") : "You";
      return `${who} ${who === "You" ? "learn" : "learns"}: ${s("fact")}`;
    }
    // The reply's item changes (DESIGN §9.4), each by who and what, as the POV may know them.
    case "take":
      return `${actor("entity")} picked up ${s("item")}`;
    case "drop":
      return `${actor("entity")} put down ${s("item")}`;
    case "use_up":
      return `${actor("entity")} used up ${s("item")}${typeof p.qty === "number" && p.qty > 1 ? ` ×${p.qty}` : ""}`;
    case "wear":
      return `${actor("entity")} ${p.off === true ? "took off" : "put on"} ${s("item")}`;
    case "lose":
      return named("by") ? `${subject("by")} stole ${s("item")} from ${named("entity") ? s("entity") : "you"}` : `${actor("entity")} lost ${s("item")}`;
    case "item_condition":
      return `${s("item")}'s condition ${change(Number(p.delta))}`;
    case "spawn":
      return `${s("name")} appears`;
    case "life": {
      const who = subject("entity");
      return `${who} ${be(who)} now ${raw("state").replace(/_/g, " ")}`;
    }
    case "routine": {
      // The reply's own words for it: what changed, and the days and times it gave.
      const you = world !== undefined && p.entity === world.pov;
      const who = you ? "You" : s("entity");
      const what = typeof p.label === "string" && p.label.trim() !== "" ? p.label.trim() : typeof p.place === "string" ? s("place") : "?";
      if (p.change === "move") return `${who} moved to ${s("place")}`;
      if (p.change === "stop") return `${who} gave up “${what}”`;
      const days = Array.isArray(p.days) ? p.days.filter((d) => typeof d === "string" || typeof d === "number").join(", ") : typeof p.days === "string" ? p.days : "";
      const time = typeof p.start === "string" && p.start !== "" ? `${p.start}${typeof p.end === "string" && p.end !== "" ? `–${p.end}` : ""}` : "";
      const when = [days, time].filter((x) => x !== "").join(", ");
      return `${you ? "Your" : `${who}'s`} routine now has “${what}”${when !== "" ? ` (${when})` : ""}`;
    }
    // The knowledge step's changes (DESIGN §24.11): what you learned, with who told you and who learned
    // it with you; a secret's reveal never words the secret, which the reply already told.
    case "learn":
    case "reveal": {
      const learn = isRecord(p.learn) ? p.learn : {};
      const name = (id: JsonValue | undefined): string => (typeof id === "string" && view && hasOwn(view.state.entities, id) && povMayKnow(view.registry, view.world, view.state, id) ? (own(view.state.entities, id)?.name ?? id) : "someone");
      const how = learn.how === "told" ? ` · told by ${name(learn.by)}` : learn.how === "witnessed" ? " · you saw it" : "";
      const others = (Array.isArray(p.with) ? p.with : []).map(name);
      const too = others.length > 0 ? ` · ${others.join(", ")} ${others.length === 1 ? "knows" : "know"} too` : "";
      return p.type === "reveal" ? `A secret the story revealed to you${how}` : `Learned: ${typeof p.claim === "string" ? p.claim : "something"}${how}${too}`;
    }
    case "time_advance":
      return `Skip ahead ${s("minutes")} min`;
    default:
      return String(p.type);
  }
}

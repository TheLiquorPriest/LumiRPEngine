// The backend composition root (ARCHITECTURE §2): builds the registry from the packs, wires the
// ledger to the host, and implements the turn hooks (interpret before planning, extract before
// the commit, chips after it), the World Info interceptor (engine slots) and the state push.

import { hashParts } from "../shared/hash";
import type { ChatId, ChipId, InterruptClass, MessageId, RevisionId, UserId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import { heldBy } from "../shared/finance";
import { hasOwn, isRecord } from "../shared/json";
import { tableChoices } from "../shared/tables";
import type { ChatRun, EventRef, GenerationKind, LedgerEvent, PostEvent, TimelapseTarget } from "../shared/ledger";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import { neutralizeMacros } from "../shared/macros";
import type { ExtractionType, StepConfig, UserSettings } from "../shared/settings";
import { EXTRACTION_TYPES, helperCallOf, stepLoreOf } from "../shared/settings";
import type { ChipAction, ContextGeneration, ContextView, LoreStepTrace, StateView } from "../shared/state-view";
import type { ActionDef, AdjudicationDef, SectionTemplate, StepPurpose, WorldDoc } from "../shared/world";
import { formatMoney, offersAction } from "../shared/world";
import { MINDS_SLOT, worldMindsOf, type MindCallTrace } from "../shared/minds";
import { mindsOn, postMinds, preMinds, runMinds, type MindsDeps } from "./minds";
import { runSkip, type BeatMinds, type SkipRun } from "./skip";
import { fightOffers } from "../packs/combat/core/index";
import { fitMindLines, mindLines } from "../packs/minds/core/section";
import { matchCatalog, transferCents } from "../packs/economy/core/index";
import { itemName, stem } from "../packs/economy/core/items";
import { needsJudge, outcomeChoices, policyFor, policyOf, type Verdict } from "../engine/adjudication";
import type { EngineTurnPlan, QueueStop } from "../engine/turn";
import { timelapseIntent } from "../engine/turn";
import { checkOf } from "../engine/checks";
import { applyTimeAdvance, fightHoldsClock, IN_FIGHT, parseOverrides, parseTarget } from "../engine/time";
import { EXTERNAL_ACCOUNT_PREFIX } from "../engine/events";
import { boundProposal } from "../engine/bounds";
import { calendarOf, clockOfStamp, dateAt, formatClock, formatHHMM, formatStamp, nextTimeOfDay, placeOffset, weekdayName } from "../engine/calendar";
import type { ChainMessage } from "../engine/ledger/chain";
import { LedgerFold } from "../engine/ledger/fold";
import type { LedgerCore, LedgerEnv } from "../engine/ledger/journal";
import { optionalQuery, own } from "../engine/pack-kit";
import type { PackDef, ReadContext } from "../engine/registry";
import { createRegistry, type Registry } from "../engine/registry-impl";
import { createRng } from "../engine/rng";
import { kindIs, placeOfEntity } from "../engine/scope";
import type { WorldState } from "../engine/state";
import { actionOdds, findAction, type Resolution } from "../engine/resolve";
import type { InterpretOutput, QueuedAction } from "../engine/steps";
import { checkAnswer } from "../engine/tracks";
import { secretLoreNames } from "../engine/lore";
import { namesHidden, playerKnows } from "../engine/player-events";
import { canSeeEntity, canSeePlace, findLeaks, namesAny, playerTrack, povPlace, shownTrackId, unrevealedSecrets, unseenPlaceNames } from "../engine/visibility";
import { openPuzzle, openPuzzles } from "../packs/story/core/index";
import { REGARD_CHANNEL_CAP } from "../packs/relationships/core/index";
import { Working } from "../engine/working";
import type { PresetCard, TemplateInfo } from "../shared/protocol";
import { type BookEntries, DEFAULT_SECTIONS, EngineBook, loreOfEntry, placementOf, renderSection, sectionsOf, sectionTokens } from "./book";
import { ChatPrefs } from "./chat-prefs";
import { ChipStore, idAfterSwipeDelete, type StoredChip } from "./chips";
import type { DryRun, HostPort, InterceptorInput, InterceptorResult } from "./host";
import { LedgerService, toChain, type TurnContext, type TurnHooks } from "./ledger-io";
import { StatePush } from "./push";
import { effectiveMode, recordOutcome, SettingsStore } from "./settings-store";
import { startMarkersFrom } from "./start-markers";
import { StepLore, ToolSupport, type LoreInputs, type LookupTransport } from "./lore-steps";
import { CallMeter, classifyTyped, dedupeProposals, extract, interpret, onlyPassesTime, saidPayMethod, Steps } from "./steps";
import { PlanNotes } from "./plan-notes";
import { OutcomeNotes } from "./outcome-notes";
import { InspectorLog, type InspectorRecord } from "./inspector-log";
import { JsonHiding, readableReply } from "./json-hiding";
import { GUIDANCE_PREFIX, GUIDANCE_TARGETS, NARRATOR_OUTLET, outletOf, PresetBinding, type Guidance, type PresetConfig } from "./preset-binding";
import { presetCaveats, type PresetCaveat } from "./preset-lint";
import { applyProposals, type EnginePipeline, type PlanProse, TIME_ADVANCE_CAP, TurnBridge, type UnfitAction } from "./turn-model";
import { agentsActHere, contradiction, factLines, judge, noFacts, npcChoose, planFacts, presentNames, promptedEffects, promptedText, puzzleAnswer, renderTemplate, runsOf, safeVars, StepBudget, tiesOf, unfitRef, type PlanStart, type SignalFacts, type StepRun, type Tie, type UnfitRef } from "./turn-steps";
import { buildView, clockMinutes, compactSpan, notWorldView, recentLines, spanText, TIMELAPSE_ACTION } from "./view";
import { StudioBridge } from "./studio";
import { WorldStore } from "./worlds";

export interface RuntimeOptions {
  host: HostPort;
  packs: readonly PackDef[];
  pipeline: EnginePipeline;
  /** World templates by id (Modern US starter and friends). */
  templates?: Record<string, (id: string, name: string) => WorldDoc>;
  /** What each template is (`lre.world templates`); a template without an entry here isn't listed. */
  templateInfo?: readonly TemplateInfo[];
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
}

/** Chips a read stores for its swipe; a read that replaces it (Re-read edit, Retry read) drops them. */
const READ_CHIP_KINDS: ReadonlySet<string> = new Set(["undo", "confirm", "decline", "choice", "contradiction"]);

/** Slots only a real turn's plan fills (DESIGN §5.1 Dry Run plans nothing), so a dry run can't confirm them. */
const TURN_ONLY_SLOTS: Readonly<Record<string, true>> = { outcome: true, montage: true, outline: true };

/**
 * The most a host token count may be, as a multiple of the section's padded estimate (which stays at
 * or above the real tokenizers); a larger count is ignored and the estimate stands in.
 */
const TOKEN_COUNT_CAP = 4;
/** How long Settings → Caveats waits on the preset lint's dry run before saying it's still running (the frontend gives a request 30 s). */
const CAVEATS_WAIT_MS = 20_000;

/** The chat's run as its metadata holds it (DESIGN §4.1), or null for a chat that plays no world. */
export function readRun(meta: JsonObject): ChatRun | null {
  const raw = meta[LEDGER_NAMESPACE];
  if (!isRecord(raw) || raw.v !== 1 || typeof raw.worldId !== "string" || typeof raw.revision !== "string" || typeof raw.runSeed !== "string") return null;
  return { v: 1, worldId: raw.worldId, revision: raw.revision, runSeed: raw.runSeed, startedAt: typeof raw.startedAt === "number" ? raw.startedAt : 0 };
}

/**
 * Whether the POV may be told about an entity: itself, someone it has met, its own thing, or someone
 * it can see where it stands (an extraction chip must never name a stranger). A world
 * that doesn't place the POV can't tell who is present: every entity it can see counts.
 */
function povMayKnow(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, id: string): boolean {
  const pov = world.pov;
  if (id === pov || playerKnows(reg, world, state, pov, id)) return true;
  if (!canSeeEntity(reg, world, state, pov, id)) return false;
  const e = state.entities[id];
  if (heldBy(state.entities, id, pov)) return true;
  const here = placeOfEntity(state, pov);
  return here === undefined || placeOfEntity(state, id) === here;
}

/** The world as the POV may know it, for model prompts that list entities and places (`interpret`, `extract`). */
function povWorld(reg: Registry, world: WorldDoc, state: Readonly<WorldState>): WorldDoc {
  return {
    ...world,
    entities: Object.fromEntries(Object.entries(world.entities).filter(([id]) => povMayKnow(reg, world, state, id))),
    places: Object.fromEntries(Object.entries(world.places).filter(([id]) => canSeePlace(reg, world, state, world.pov, id))),
  };
}

/** The prefix an extraction reads against: only entities and places the POV may know. */
function prefixSummary(reg: Registry, world: WorldDoc, state: WorldState): JsonValue {
  const pov = state.entities[world.pov];
  const people: JsonObject = {};
  for (const [id, e] of Object.entries(state.entities)) {
    if (Object.keys(people).length >= 30) break;
    if (!povMayKnow(reg, world, state, id)) continue;
    people[id] = { name: e.name, kind: e.kind, place: typeof e.fields.place === "string" ? e.fields.place : null };
  }
  const places = Object.keys(world.places).filter((p) => canSeePlace(reg, world, state, world.pov, p)).slice(0, 40);
  return { clock: state.clock, pov: world.pov, povName: pov?.name ?? world.pov, cents: state.accounts[world.pov] ?? null, entities: people, places };
}

/**
 * Whether every entity and place a proposal names is one the POV may know; others never become chips
 * or changes. A value is matched as the channels read it, trimmed (and lowercased when only that
 * names something), so `" vera "` is Vera. The one exception is a `knows` proposal's place: hearing
 * of a `known_by` or `discoverable` place is how the POV comes to know it, and the channel takes no
 * secret one.
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
  const heard = (v: JsonValue | undefined): boolean => {
    const place = typeof v === "string" && hasOwn(world.places, v.trim()) ? world.places[v.trim()] : undefined;
    return place?.visibility === "known_by" || place?.visibility === "discoverable";
  };
  return Object.entries(p).every(([k, v]) => k === "type" || (p.type === "knows" && k === "fact" && heard(v)) || ok(v, 0));
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

/**
 * A narrated purchase measured against the Buy this turn's own actions made (DESIGN §11 Confirm
 * chips). Only the same thing can be the Buy told again: the same main noun, as `itemName` reads
 * names ("milk" for the bought "Milk, whole", "brass lantern" for "old brass lantern"; "lantern
 * oil" is oil, not the lantern). Even then it's another purchase when its own words say so
 * ("another coffee", "a second one", "coffee for Danny"), when it names a different quantity, or a
 * qualifier that rules the Buy's out (green for red, large for small, iced for hot). It is the Buy
 * told again (`retold`) when one name's words hold all of the other's and any price the narration
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
export function boughtAlong(p: JsonObject, pre: readonly LedgerEvent[], ctx: ReadContext, typed: readonly number[] = [], narration = ""): Along {
  const { world, state } = ctx;
  if (p.type !== "purchase" || typeof p.item !== "string" || !povPays(p, world, state)) return null;
  const said = itemName(p.item);
  if (!said) return null;
  const stated = typeof p.price === "number" && Number.isFinite(p.price) ? Math.abs(p.price) : null;
  const near = (v: number): boolean => stated === null || Math.abs(stated - v) <= 0.25 * v;
  const another = ANOTHER.test(`${p.item} ${typeof p.name === "string" ? p.name : ""}`) || (said.trailing?.word === "for" && forSomeone(said.trailing.words, ctx));
  const buys = buysIn(pre);
  let verdict: Along = null;
  let sameNoun = false;
  for (const buy of buys) {
    const bought = itemName(buy.name);
    if (!bought || bought.head !== said.head) continue;
    sameNoun = true;
    if (another) continue;
    if (typeof p.qty === "number" && p.qty !== buy.qty) continue;
    const contrast = [...said.words].some((w) => CONTRAST[w] !== undefined && !bought.words.has(w) && [...bought.words].some((b) => b !== w && CONTRAST[b] === CONTRAST[w]));
    if (contrast) continue;
    const holds = [...said.words].every((w) => bought.words.has(w)) || [...bought.words].every((w) => said.words.has(w));
    const inBand = (): boolean => {
      const band = stated === null ? null : optionalQuery(ctx, "economy.bought_band")?.(ctx, buy.name, buy.qty, world.pov);
      return !!band && stated !== null && stated >= 0.75 * band.min && stated <= 1.25 * band.max;
    };
    const priced = near(buy.cents) || typed.some(near) || inBand();
    if (holds && priced && !toldAsAnother(narration, said.head, ctx)) return "retold";
    verdict = "unsure";
  }
  if (sameNoun || another || toldAsAnother(narration, said.head, ctx)) return verdict;
  // Siblings are rows of one group in the price table. The narrated purchase's row is the one
  // `economy.buy` prices it as where the player character is (by id, else what its words name); a
  // catalogued Buy carries its own row's name.
  const rows = ctx.tables.get("economy.catalog")?.rows ?? {};
  const row = hasOwn(rows, p.item) ? p.item : matchCatalog(ctx, p.item, placeOfEntity(state, world.pov), typeof p.category === "string" ? p.category : "");
  const group = row === null ? undefined : own(rows, row)?.category;
  if (typeof group !== "string" || group === "") return null;
  return buys.some((buy) => (typeof p.qty !== "number" || p.qty === buy.qty) && Object.values(rows).some((r) => r.name === buy.name && r.category === group)) ? "unsure" : null;
}

/**
 * A narrated purchase that names several things ("coffee and bran muffin", "a coffee, a muffin and a
 * bagel") one of which is the turn's own Buy: the Buy's part is dropped, and every other part is a
 * purchase of its own, priced on its own (a price the narration gave was for them together). A
 * purchase that holds no part of the Buy stays whole ("fish and chips").
 */
export function splitAlongBuy(p: JsonObject, pre: readonly LedgerEvent[], ctx: ReadContext): JsonObject[] {
  if (p.type !== "purchase" || typeof p.item !== "string" || !povPays(p, ctx.world, ctx.state)) return [p];
  const parts = p.item
    .split(/\s*(?:,|&|\band\b|\bplus\b)\s*/i)
    .map((part) => part.trim())
    .filter((part) => itemName(part) !== null);
  const buys = buysIn(pre).map((b) => itemName(b.name));
  const isBuy = (part: string): boolean => {
    const n = itemName(part);
    return !!n && buys.some((b) => !!b && b.head === n.head && ([...n.words].every((w) => b.words.has(w)) || [...b.words].every((w) => n.words.has(w))));
  };
  if (parts.length < 2 || !parts.some(isBuy)) return [p];
  const { price: _price, qty: _qty, name: _name, ...rest } = p;
  return parts.filter((part) => !isBuy(part)).map((item) => ({ ...rest, item }));
}

/** What an extraction reads against: the state, its world, the record's seed and its pre-reply events. */
export interface ReadInput {
  state: WorldState;
  world: WorldDoc;
  seed: string;
  pre: LedgerEvent[];
  /** The state before `pre`: where the player's message was said, and who heard it (DESIGN §24.4). */
  start: WorldState;
  /** The Journal's latest turn lines before the reply (`{{recent}}`). */
  recent: string[];
}

/** Why a regard proposal past its pair's budget for the reply is refused. */
const REGARD_SPENT = `a reply moves each regard axis of a pair by at most ${REGARD_CHANNEL_CAP}`;

/**
 * One reply's regard budget (DESIGN §9.4): across the reply's proposals, in their order, each axis
 * of a pair moves by at most `REGARD_CHANNEL_CAP` in all, net. A proposal without an axis moves
 * every axis, so it counts against each. A later proposal is cut down to what is left, and one with
 * nothing left is refused (null). Anything but a regard proposal passes as it is.
 */
export function regardBudget(): (p: JsonObject) => JsonObject | null {
  // Net delta so far per pair and axis; "" is the axis-less share every axis carries.
  const moved = new Map<string, Map<string, number>>();
  return (p) => {
    if (p.type !== "regard" || typeof p.delta !== "number" || p.delta === 0 || typeof p.from !== "string" || typeof p.to !== "string") return p;
    const pair = `${p.from.trim()}\u0000${p.to.trim()}`;
    const axes = moved.get(pair) ?? new Map<string, number>();
    const shared = axes.get("") ?? 0;
    const axis = typeof p.axis === "string" ? p.axis : "";
    const sums = axis !== "" ? [(axes.get(axis) ?? 0) + shared] : [shared, ...[...axes].filter(([a]) => a !== "").map(([, v]) => v + shared)];
    const up = p.delta > 0;
    const room = up ? Math.min(REGARD_CHANNEL_CAP, ...sums.map((s) => REGARD_CHANNEL_CAP - s)) : Math.min(REGARD_CHANNEL_CAP, ...sums.map((s) => REGARD_CHANNEL_CAP + s));
    if (room <= 0) return null;
    const delta = up ? Math.min(p.delta, room) : Math.max(p.delta, -room);
    axes.set(axis, (axes.get(axis) ?? 0) + delta);
    moved.set(pair, axes);
    return delta === p.delta ? p : { ...p, delta };
  };
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

function signalWithin(signal: AbortSignal, ms: number): AbortSignal {
  return ms > 0 ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : signal;
}

export class Runtime implements TurnHooks {
  readonly host: HostPort;
  readonly registry: Registry;
  readonly worlds: WorldStore;
  readonly settings: SettingsStore;
  readonly chips: ChipStore;
  /** Planned-turn lines by seed, for Re-narrate after a restart. */
  readonly planNotes: PlanNotes;
  readonly book: EngineBook;
  readonly meter: CallMeter;
  /**
   * Notes for the next turn's Outcome slot (DESIGN §9.5: "the next Outcome slot says so"), from the
   * reply that produced them; dropped once a later message has committed and another follows.
   */
  readonly outcomeNotes: OutcomeNotes;
  /** The inspector's history and delivery badges per chat. */
  readonly inspector: InspectorLog;
  /** How the player chose to see each chat (the map's display mode): presentation, beside the chat. */
  readonly chatPrefs: ChatPrefs;
  readonly steps: Steps;
  /** Connections seen refusing the lore tools (DESIGN §5.4). */
  readonly toolSupport: ToolSupport;
  readonly ledger: LedgerService;
  /** The JSON regex scripts, each world chat's and the user's unwraps (DESIGN §6.7). */
  readonly jsonHiding: JsonHiding;
  /** What the active preset says: section outlets, helper guidance, narrator rules (DESIGN §6.8). */
  readonly presets: PresetBinding;
  readonly push: StatePush;
  /** What LumiRPEngine Studio may read, and its offers (DESIGN §15). */
  readonly studio: StudioBridge;
  readonly templates: Record<string, (id: string, name: string) => WorldDoc>;
  readonly templateInfo: readonly TemplateInfo[];
  private readonly pipeline: EnginePipeline;
  /** Runs by `user \0 chat`. */
  private readonly runs = new Map<string, ChatRun | null>();
  private readonly bridges = new Map<ChatId, TurnBridge>();
  private readonly settingsCache = new Map<UserId, UserSettings>();
  /**
   * Host tokenizer counts of rendered section texts, by user and text hash: the host counts with each
   * user's own main model, so one user's count never prices another's section. A section costs its
   * count once the host has counted that exact text for that user; until then the estimate (with
   * margin) stands in and the count is fetched in the background, so the interceptor never waits on
   * the host. A count that isn't a finite number from 0 to `TOKEN_COUNT_CAP` times the estimate is
   * ignored, so a bogus count can't clip every section.
   */
  private readonly tokenCounts = new Map<string, number>();
  /** The world chat each user last generated in (the D32 preset lint dry-runs it when none is open). */
  private readonly lastWorldChat = new Map<UserId, ChatId>();
  /** The D32 preset caveats each chat's last dry run found (shown in the inspector). */
  private readonly presetWarnings = new Map<ChatId, string[]>();
  /** Settings → Caveats' preset lint by `user \0 chat \0 preset \0 preset revision \0 settings revision`: done, or its dry run still running. */
  private readonly caveatRuns = new Map<string, Promise<PresetCaveat[]>>();
  /** The sections each chat's last interceptor run sent to the preset's outlets, with the preset revision it read (`preset \0 revision`). */
  private readonly routedLast = new Map<ChatId, { preset: string; slots: Set<string> }>();
  /** Per chat, a preset revision whose outlets a delivery check didn't find some routed sections at, and those sections: the world places them again (DESIGN §6.8). */
  private readonly outletMisses = new Map<ChatId, { preset: string; slots: Set<string> }>();
  /** Each open chat's pinned world revisions, by `user \0 chat`. */
  private readonly pins = new Map<string, Map<RevisionId, WorldDoc>>();
  /** The pre-phase call budget per generation, shared by `beforePlan` and `afterPlan`. */
  private readonly preBudgets = new Map<string, StepBudget>();
  /** The POV's place after each chat's last plan (the `scene_change` signal). */
  private readonly lastPlace = new Map<ChatId, string | null>();
  /** What the pre phase saw, per generation, for the plan phase's signals. */
  private readonly prePhase = new Map<string, { facts: SignalFacts; text: string; start: PlanStart; connectionId: string | null; preset: PresetConfig }>();
  /** Each generation's lore traces, step by step (the inspector shows them, DESIGN §6.5). */
  private readonly loreTraces = new Map<string, LoreStepTrace[]>();
  /** Each generation's minds calls, with no text (the inspector shows them, DESIGN §24.5). */
  private readonly mindTraces = new Map<string, MindCallTrace[]>();
  /** What the minds need of the backend: the runner, the pre and post phases and the time skip read it (`backend/minds.ts`). */
  readonly minds: MindsDeps;
  /** The minds a time skip runs at its beats (DESIGN §24.7): `runMinds` on this runtime's deps, which tests replace with a fake. */
  beatMinds: BeatMinds = (input) => runMinds(this.minds, input);

  constructor(options: RuntimeOptions) {
    this.host = options.host;
    this.registry = createRegistry(options.packs);
    this.pipeline = options.pipeline;
    this.templates = options.templates ?? {};
    this.templateInfo = options.templateInfo ?? [];
    this.worlds = new WorldStore(this.host, this.registry);
    // The context handler waits as long as the users' before-the-reply wall clocks need.
    this.settings = new SettingsStore(this.host, (userId, settings) => this.ledger.preReplyBudget(userId, settings.modelUse.budgets.pre.ms));
    this.chips = new ChipStore(this.host);
    this.planNotes = new PlanNotes(this.host);
    this.outcomeNotes = new OutcomeNotes(this.host);
    this.inspector = new InspectorLog(this.host);
    this.chatPrefs = new ChatPrefs(this.host);
    this.book = new EngineBook(this.host, this.worlds);
    this.jsonHiding = new JsonHiding(this.host, async (userId) => (await this.settings.get(userId)).hideJsonBlocks, async (worldId, userId) => (await this.worlds.index(worldId, userId)) !== null);
    this.presets = new PresetBinding(this.host);
    this.meter = new CallMeter(this.host);
    this.steps = new Steps(this.host, this.meter, async (userId) => (await this.settings.get(userId)).helper);
    this.toolSupport = new ToolSupport(this.host);
    this.minds = { host: this.host, registry: this.registry, steps: this.steps, settings: this.settings, presets: this.presets };
    // Snapshots from another build never apply (the build defines LRE_BUILD_ID; tests fold as "dev").
    this.ledger = new LedgerService(this.host, (chatId, userId) => this.resolveEnv(chatId, userId), new LedgerFold(this.registry, { fingerprint: process.env.LRE_BUILD_ID ?? "dev" }));
    this.studio = new StudioBridge(this.host, this.worlds);
    this.worlds.onChange = (worldId, userId) => this.studio.worldChanged(worldId, userId);
    // Every view pushed to a chat also refreshes the summary the Studio reads of it.
    this.push = new StatePush(this.host, async (chatId, userId) => {
      const view = await this.view(chatId, userId);
      this.studio.seen(userId, view);
      return view;
    });
  }

  start(): void {
    this.ledger.hooks = this;
    this.ledger.attach();
    this.host.registerInterceptor((input) => this.intercept(input), 50);
    this.host.on("MESSAGE_SENT", (e, userId) => {
      if (e.message.isUser && userId) void this.lapse(e.chatId, userId);
    });
    // The host shifts a message's swipes down when one is deleted; the chips shown by swipe follow.
    this.host.on("MESSAGE_SWIPED", (e, userId) => {
      if (e.action === "deleted" && userId) this.swipeDeleted(e.chatId, userId, e.message.id, e.swipeId).catch((error: unknown) => this.host.log("warn", `[LumiRPEngine] chat ${e.chatId}: chips didn't follow a deleted swipe (${error instanceof Error ? error.message : String(error)})`, userId));
    });
    this.host.on("WORLD_INFO_ACTIVATED", (e) => this.onActivated(e.chatId, e.entries.map((x) => x.id)));
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
    const run = readRun(await this.host.chats.chatMetadata(chatId, userId));
    lruSet(this.runs, key, run, 512);
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
    this.ledger.forget(chatId);
  }

  private async resolveEnv(chatId: ChatId, userId: UserId): Promise<LedgerEnv | null> {
    const run = await this.runOf(chatId, userId);
    if (!run) return null;
    // The chat pins only the revisions its ledger references (its run's, its migrate targets),
    // loaded as its core asks for them; every other revision lives in the store's bounded LRU.
    const pinned = new Map<RevisionId, WorldDoc>();
    const missing = new Set<RevisionId>();
    lruSet(this.pins, `${userId}\u0000${chatId}`, pinned, 256);
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
  async beforePlan(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string | null; dryRun: boolean; connectionId: string | null; signal: AbortSignal }): Promise<void> {
    await this.keepBookAttached(input.chatId, input.userId);
    const bridge = this.bridges.get(input.chatId);
    const p = input.generationId ? input.core.journal.pending[input.generationId] : null;
    // A Re-narrate copies its source's plan (P3): no resolve, simulate or model calls before it.
    if (!bridge || input.dryRun || !p || p.kind === "continue" || p.kind === "impersonate" || (p.kind === "renarrate" && p.renarrateOf)) return;
    const settings = await this.settings.get(input.userId);
    lruSet(this.settingsCache, input.userId, settings, 256);
    // The preset this generation assembles with, read once for its phases and its interceptor run.
    const preset = await this.presets.current(input.chatId, input.userId, input.connectionId);
    const target = p.messageId ? input.observed.findIndex((m) => m.id === p.messageId) : input.observed.length;
    const before = input.observed.slice(0, target < 0 ? input.observed.length : target);
    const lastUser = before.findLast((m) => m.isUser);
    const text = lastUser ? (lastUser.swipes[lastUser.swipeId] ?? "") : "";
    const render = input.core.renderState(input.observed);
    if (!render) return;
    const budget = new StepBudget(settings.modelUse.budgets.pre.calls, settings.modelUse.budgets.pre.ms, input.signal, settings.modelUse.budgets.pre.lookup);
    this.preBudgets.set(p.generationId, budget);
    trimMap(this.preBudgets);
    const ctx = this.registry.context(render.world, render.state);
    const ties = tiesOf(ctx, render.world, render.state);
    const recorded = lastUser ? (await this.host.chats.messages(input.chatId, input.userId)).find((m) => m.id === lastUser.id)?.metadata[LEDGER_NAMESPACE] : undefined;
    // A combat action only where the ruleset has combat (DESIGN §11), so a world without it reads typed text as before.
    const all = [...this.registry.actions.values(), ...Object.values(render.world.actions)].filter((a) => offersAction(render.world, a));
    const typed = text.trim() !== "" && !(isRecord(recorded) && typeof recorded.action === "string");
    // A palette or chip tap writes the action's label as the message: only words the player typed
    // with it describe an approach, so only those are worth a judge call.
    const described = typed || (text.trim() !== "" && isRecord(recorded) && recorded.described === true);
    const facts: SignalFacts = {
      ...noFacts(before.filter((m) => !m.isUser).length + 1),
      typed,
      classifier: typed && classifyTyped(text, render.world, [...all.flatMap((a) => a.lexicon ?? []), ...TIMELAPSE_LEXICON]),
      sceneChange: this.lastPlace.has(input.chatId) && this.lastPlace.get(input.chatId) !== placeOfEntity(render.state, render.world.pov),
      agentsPresent: agentsActHere(this.registry, render.world, render.state),
      present: ties.present.length > 0,
      offscreen: ties.offscreen.length > 0,
      tieZone: ties.present.length > 0,
      invitation: (before.findLast((m) => !m.isUser)?.ledger?.swipes[String(before.findLast((m) => !m.isUser)?.swipeId ?? 0)]?.events ?? []).some((e) => e.type === "castlife.invitation"),
      timelapse: isRecord(recorded) && recorded.action === TIMELAPSE_ACTION,
    };
    const at = await this.lorePhase("pre", p.generationId, input.userId, render.world, render.state, budget, text, preset.guidance);
    const intentTask = text.trim() === "" || bridge.hasIntent(text) ? Promise.resolve() : this.readIntent(bridge, text, recorded, render, all, settings, facts, budget, at);
    // The judge's call for the player's own action comes before npc.choose's (DESIGN §11). Present
    // agents' choices run beside the intent only while a call stays free for the judge; otherwise
    // they take what is left once it has run. Before `interpret` names the action, the judge may
    // run whenever the policy weighs the player's words or leaves checks to the story.
    const policy = policyOf(render.world, render.state);
    const judging = described && runsOf(settings.modelUse, render.world, "judge", facts, { guidance: at.guidance }).length > 0 && (bridge.hasIntent(text) ? this.judgeTarget(bridge.intentOf(text), render) !== null : policy.description.weight !== "none" || policy.authority === "narrative");
    const npcRun = runsOf(settings.modelUse, render.world, "npc.choose", facts, { guidance: at.guidance })[0];
    const choose = npcRun && ties.present.length > 0 ? () => npcChoose(this.steps, npcRun, ties.present, (t) => this.describeTie(t, render.world, render.state), createRng(hashParts("lre.npc.pre", bridge.runSeed, p.generationId)), input.userId, budget.signal, this.stepLore(npcRun, at, this.tieInputs(ties.present, render.world, render.state))) : null;
    const [, early] = await Promise.all([intentTask, choose && budget.take(judging ? 1 : 0) ? choose() : null]);
    this.prePhase.set(p.generationId, { facts, text, start: { place: placeOfEntity(render.state, render.world.pov), clock: render.state.clock }, connectionId: input.connectionId, preset });
    trimMap(this.prePhase);
    // Character minds (DESIGN §24) think beside the judge: separate calls, on the phase's wall clock,
    // apart from its call count. A timelapse's minds think at its beats instead (`skip.ts`).
    const lastReply = before.findLast((m) => !m.isUser);
    const mindsTask = preMinds(this.minds, { chatId: input.chatId, userId: input.userId, world: render.world, state: render.state, user: text, reply: lastReply ? (lastReply.swipes[lastReply.swipeId] ?? "") : "", timelapse: bridge.intentOf(text)?.action === TIMELAPSE_ACTION, signal: budget.signal, guidance: preset.guidance.mind ?? "" });
    await this.judgeAnswer(bridge, text, render, settings, facts, budget, at);
    if (described) await this.judgeApproach(bridge, text, render, settings, facts, budget, at);
    const decisions = early ?? (choose && budget.take() ? await choose() : []);
    bridge.setDecisions(text, decisions);
    const minds = await mindsTask;
    bridge.setMinds(text, minds.events);
    this.addMindTraces(input.chatId, p.generationId, minds.traces, true);
    if (text.trim() !== "") this.host.log("info", `[LumiRPEngine] plan ${String(input.generationId).slice(0, 8)}: intent ${bridge.intentOf(text)?.action ?? "none"} ${JSON.stringify(bridge.intentOf(text)?.params ?? {}).slice(0, 240)}, ${decisions.length} npc decision(s), ${minds.traces.length} mind(s), ${budget.spent} pre call(s)`, input.userId);
    // A timelapse with minds on is a time skip (DESIGN §24.7): its beats and the minds at them are
    // found and recorded now, from exactly the state the plan starts from, and the plan replays them.
    const intent = bridge.intentOf(text);
    const base = intent?.action === TIMELAPSE_ACTION && mindsOn(settings) ? input.core.planState(p.generationId, input.observed) : null;
    let skip: SkipRun | null = null;
    if (intent && base) {
      const start = new Working(this.registry, base.world, base.state);
      start.applyAll(bridge.prePlan(text));
      try {
        skip = await runSkip({ registry: this.registry, steps: this.steps, minds: this.beatMinds }, { chatId: input.chatId, userId: input.userId, world: base.world, state: start.state, intent, runSeed: bridge.runSeed, settings, guidance: preset.guidance, signal: budget.signal });
      } catch (error) {
        this.host.log("warn", `[LumiRPEngine] time skip not run: ${error instanceof Error ? error.message : String(error)}`, input.userId);
      }
      if (skip) this.addMindTraces(input.chatId, p.generationId, skip.traces);
    }
    bridge.setSkip(text, skip?.record ?? null);
  }

  /**
   * The plan phase (DESIGN §5.2, §5.3): with the plan made, `brief` and the prose `outline` (stacked
   * on the engine's beats) run side by side on the pre budget, except that an outline template
   * naming `{{brief}}` waits for the brief; their text goes to the Outline slot. They see only
   * player-visible facts (secrecy batching rule).
   */
  async afterPlan(input: { chatId: ChatId; userId: UserId; core: LedgerCore; observed: ChainMessage[]; generationId: string; signal: AbortSignal }): Promise<void> {
    const bridge = this.bridges.get(input.chatId);
    const p = input.core.journal.pending[input.generationId];
    const pre = this.prePhase.get(input.generationId);
    if (!bridge || !p?.planned || p.renarrateOf || !pre) return;
    const plan = bridge.planFor(p.seed);
    const render = input.core.renderState(input.observed);
    if (!render) return;
    lruSet(this.lastPlace, input.chatId, placeOfEntity(render.state, render.world.pov), 256);
    const settings = this.settingsCache.get(input.userId) ?? (await this.settings.get(input.userId));
    const facts: SignalFacts = { ...pre.facts, ...planFacts(render.world, pre.start, render.state, plan) };
    const briefRuns = runsOf(settings.modelUse, render.world, "brief", facts, { output: "text", guidance: pre.preset.guidance });
    const outlineRuns = runsOf(settings.modelUse, render.world, "outline", facts, { output: "text", guidance: pre.preset.guidance });
    if (briefRuns.length === 0 && outlineRuns.length === 0) {
      await this.keepPlanLines(input.chatId, input.userId, p.seed, plan, render.world, undefined);
      return;
    }
    const budget = this.preBudgets.get(input.generationId) ?? new StepBudget(settings.modelUse.budgets.pre.calls, settings.modelUse.budgets.pre.ms, input.signal, settings.modelUse.budgets.pre.lookup);
    const secrets = unrevealedSecrets(this.registry, render.world, render.state);
    // The Journal before this turn: the plan's target message and what follows aren't in it.
    const target = p.messageId === null ? -1 : input.observed.findIndex((m) => m.id === p.messageId);
    const recent = recentLines(input.core, input.observed, target < 0 ? input.observed.length : target, this.registry);
    const vars = safeVars(this.stepVars(render.world, render.state, plan, pre.text, "", "", recent), secrets);
    const inputs = { text: [pre.text, vars.outcome ?? "", vars.beats ?? "", this.trackWords(render.world, render.state)].join("\n"), links: this.sceneLinks(render.world, render.state) };
    const at = await this.lorePhase("pre", input.generationId, input.userId, render.world, render.state, budget, pre.text, pre.preset.guidance);
    const run = (r: StepRun, kind: "brief" | "outline", stepVars = vars): Promise<string[]> => (budget.take() ? promptedText(this.steps, r, kind, stepVars, secrets, input.userId, budget.signal, this.stepLore(r, at, inputs)).then((lines) => lines ?? []) : Promise.resolve([]));
    const briefTask = Promise.all(briefRuns.map((r) => run(r, "brief")));
    // An outline template that names {{brief}} waits for the brief (leak-checked as it comes back).
    const outlineTask = Promise.all(outlineRuns.map((r) => (/\{\{\s*brief\s*\}\}/i.test(r.template?.template ?? "") ? briefTask.then((b) => run(r, "outline", { ...vars, brief: b.flat().join(" ").trim() })) : run(r, "outline"))));
    const [briefs, outlines] = await Promise.all([briefTask, outlineTask]);
    const brief = briefs.flat().join(" ").trim();
    const prose = { brief: brief === "" ? null : brief, outline: outlines.flat() };
    bridge.setProse(p.seed, prose);
    await this.keepPlanLines(input.chatId, input.userId, p.seed, plan, render.world, prose);
    this.host.log("info", `[LumiRPEngine] plan ${input.generationId.slice(0, 8)}: brief ${brief === "" ? "none" : "yes"}, ${outlines.flat().length} outline line(s), ${budget.spent} pre call(s)`, input.userId);
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

  /** Stores the sections a plan feeds the narrator, so Re-narrate can rebuild them. */
  private async keepPlanLines(chatId: ChatId, userId: UserId, seed: string, plan: EngineTurnPlan | undefined, world: WorldDoc, prose: PlanProse | undefined): Promise<void> {
    if (!plan) return;
    try {
      await this.planNotes.put(chatId, userId, seed, { ...planLines(plan, world, this.registry), outline: planOutline(plan, prose) });
    } catch (error) {
      this.host.log("warn", `[LumiRPEngine] plan lines not kept: ${error instanceof Error ? error.message : String(error)}`, userId);
    }
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
    };
  }

  /** The turn's intent: a recorded palette or chip action, else `interpret` (helper JSON, or a Decision choice over the actions). */
  private async readIntent(bridge: TurnBridge, text: string, recorded: JsonValue | undefined, render: { world: WorldDoc; state: WorldState }, all: ActionDef[], settings: UserSettings, facts: SignalFacts, budget: StepBudget, at: LorePhase): Promise<void> {
    const userId = at.userId;
    // A palette or chip action records its intent on the user message (dispatch `lre.action`); it
    // survives restarts and a bridge that never saw the request.
    if (isRecord(recorded) && typeof recorded.action === "string") {
      const params = isRecord(recorded.params) ? (JSON.parse(JSON.stringify(recorded.params)) as JsonObject) : {};
      const target = recorded.action === TIMELAPSE_ACTION ? parseTarget(params.target) : null;
      const overrides: Record<string, string> = {};
      for (const [k, v] of Object.entries(parseOverrides(params.overrides))) if (typeof v === "string") overrides[k] = v;
      bridge.setIntent(text, recorded.action === TIMELAPSE_ACTION ? (target ? timelapseIntent(target, overrides) : null) : { action: recorded.action, params, probabilities: { [recorded.action]: 1 } });
      return;
    }
    // Letting time pass is always in the catalog, so a world without actions still interprets.
    const run = runsOf(settings.modelUse, render.world, "interpret", facts, { guidance: at.guidance })[0];
    if (!run || !budget.take()) {
      bridge.setIntent(text, null);
      return;
    }
    const scene = { place: placeOfEntity(render.state, render.world.pov) };
    // Letting time pass is an engine action too ("I sleep until the next morning", "skip ahead to
    // Friday at 6 PM"). The model is told the day and time as the HUD shows them (the place's time
    // zone), so it can name a stated day and time exactly.
    const dayParts = render.world.calendar.dayParts.map((d) => d.id);
    const cal = calendarOf(render.world);
    const offset = placeOffset(render.world, render.state.clock, placeOfEntity(render.state, render.world.pov));
    const now = `${weekdayName(cal, dateAt(cal, render.state.clock + offset).weekday)} ${formatStamp(cal, render.state.clock, offset)}`;
    const timelapseEntry = { id: TIMELAPSE_ACTION, label: `Let time pass (wait, sleep, skip ahead): minutes for a stated duration; until one of ${[...dayParts, "shift", "commitment"].join(", ")} ("next <day part>" for the following day's); or at a stated day and time, as "YYYY-MM-DD HH:MM" (it is now ${now})`, params: ["minutes", "until", "at"], lexicon: TIMELAPSE_LEXICON };
    // Answer lists the open puzzles the player can see, by their rows' ids, so a typed "I dial 1887" finds one and the id the model gives for it is the row's.
    const puzzles = openPuzzleTitles(this.registry, render.world, render.state);
    const labelOf = (a: ActionDef): string => (a.pack === "story" && a.id === "answer" && puzzles.length > 0 ? `${a.label} (open: ${puzzles.join("; ")})` : a.label);
    // A param naming a table row lists the rows' ids, so the helper answers with one ("athletics", not
    // "climbing"); the list keeps to the param's own parentheses, so the next param can't read as a row.
    const paramsOf = (a: ActionDef): string[] => Object.entries(a.params).map(([name, p]) => (p.table !== undefined ? `${name} (one of: ${tableChoices(hasOwn(render.world.tables, p.table) ? render.world.tables[p.table] : undefined).map((c) => c.key).join(" | ")})` : name));
    // Only what fits the fight's state for the POV (Fight outside one, attacks in one), as the Combat tab lists them.
    const offered = all.filter((a) => fightOffers(render.world, render.state, a));
    const catalog = [...offered.map((a) => ({ id: a.id, label: labelOf(a), params: paramsOf(a), ...(a.lexicon ? { lexicon: a.lexicon } : {}) })), timelapseEntry];
    let result: InterpretOutput | null;
    const lore = this.stepLore(run, at, { text: `${text}\n${this.trackWords(render.world, render.state)}`, links: this.sceneLinks(render.world, render.state) });
    if (run.config.route?.provider === "decision") {
      // A Decision route answers which action (or none); a helper call fills its params when it has any.
      const criteria: Record<string, string> = { none: "Not an action: speech, a request, a feeling or a recap." };
      for (const a of offered) criteria[a.id] = labelOf(a);
      criteria[TIMELAPSE_ACTION] = timelapseEntry.label;
      const answer = await this.steps.decide("interpret", { text, scene }, { action: { type: "choice", instructions: run.template?.template ?? "Which engine action does the player character deliberately take in this typed input?", criteria } }, run.config, userId, budget.signal, lore, run.guidance);
      const a = answer?.answers.action;
      const chosen = a?.type === "choice" && a.choice !== "none" ? (a.choice === TIMELAPSE_ACTION ? { id: TIMELAPSE_ACTION, params: { minutes: null, until: null, at: null } } : offered.find((x) => x.id === a.choice)) : undefined;
      if (!chosen) result = a?.type === "choice" ? { action: null, params: {}, probabilities: a.probabilities } : null;
      else if (Object.keys(chosen.params).length === 0) result = { action: chosen.id, params: {}, probabilities: a?.type === "choice" ? a.probabilities : { [chosen.id]: 1 } };
      // With no call left to fill its params, the action went unread, as when the call fails: a chip
      // says so, with Retry, rather than blaming the player for a place or person they did name.
      else if (!budget.take()) result = null;
      else result = await interpret(this.steps, text, povWorld(this.registry, render.world, render.state), catalog.filter((c) => c.id === chosen.id), scene, { ...run.config, route: { provider: "helper", connectionId: null, model: null } }, userId, budget.signal, undefined, lore, run.guidance);
    } else {
      result = await interpret(this.steps, text, povWorld(this.registry, render.world, render.state), catalog, scene, run.config, userId, budget.signal, run.template ? renderTemplate(run.template.template, { world: render.world.name, pov: render.state.entities[render.world.pov]?.name ?? render.world.pov }) : undefined, lore, run.guidance);
    }
    // The call failed (a transient failure already had its second try): the turn runs as plain
    // roleplay, and a chip says the action went unread, with a Retry that runs the turn again.
    if (result === null) {
      this.host.log("warn", `[LumiRPEngine] interpret: couldn't read the player's action; the turn runs as plain roleplay`, userId);
      bridge.setOffer(text, null);
      bridge.setNext(text, null);
      bridge.setUnread(text);
      return;
    }
    // `interpret` may read secret lore its audience allows (DESIGN §7): what it returns becomes chips,
    // Journal lines and the Outcome, so an answer carrying a secret's unrevealed text is played as
    // roleplay. Words the player typed are theirs to repeat. Its further actions are checked on their own.
    const typedText = text.toLowerCase();
    const secrets = unrevealedSecrets(this.registry, render.world, render.state).filter((s) => !typedText.includes(s.toLowerCase()));
    if (findLeaks({ params: result.params, ...(result.then ? { then: result.then } : {}) }, secrets).length > 0) {
      this.host.log("info", `[LumiRPEngine] interpret: ${result.action ?? "no action"} carried an unrevealed secret; played as roleplay`, userId);
      bridge.setOffer(text, null);
      bridge.setNext(text, null);
      bridge.setIntent(text, null);
      return;
    }
    // Words the turn won't play are offered on a chip that sends them as the next message (DESIGN
    // §5.2), each piece only when it may be (`offeredNext`); "" when it may not.
    const lexicon = all.flatMap((a) => a.lexicon ?? []);
    const chipText = (piece: string): string => offeredNext(this.registry, render.world, render.state, piece, text, lexicon, secrets) ?? "";
    let next = (result.next ?? []).map(chipText);
    // A bare time span reads as the timelapse itself, which plays alone: anything after it is offered
    // in words once it has run. One after another action ("I head home and sleep until the next
    // morning") is offered once the actions have run.
    const timeOnly = result.action === TIMELAPSE_ACTION ? result.params : !result.action && result.then ? result.then : null;
    if (timeOnly) {
      bridge.setNext(text, joinActions([...(result.queue ?? []).map((q) => chipText(q.text)), ...next]) || null);
      const target = interpretedTarget(timeOnly, render.world, render.state, text);
      // A short span runs in the turn; a longer one is offered (a misread can't skip days unasked).
      const over = target?.type === "duration" && target.minutes > INTERPRETED_TIMELAPSE_CAP;
      bridge.setOffer(text, over ? target : null);
      bridge.setIntent(text, target && !over ? timelapseIntent(target) : null, target !== null && !over);
      return;
    }
    const chosen = result.action ? all.find((a) => a.id === result.action) : undefined;
    const params = chosen ? playable(chosen, result.params, render.world, [text]) : result.params;
    // An action whose params name nothing in the world that fits ("I pay Rena" where Rena is no one in
    // it) plays as plain roleplay, and its reply says why on a decline chip (DESIGN §9.4).
    const unfit = chosen ? unfitRef(this.registry, chosen, params, render.world, render.state) : null;
    if (chosen && unfit) {
      this.host.log("info", `[LumiRPEngine] interpret: ${chosen.id} names nothing in the world (${JSON.stringify(params)}); played as roleplay`, userId);
      // Nothing that follows the action (time after it, the actions after it) is offered when it didn't play.
      bridge.setOffer(text, null);
      bridge.setNext(text, null);
      bridge.setUnfit(text, { label: chosen.label, reason: unfitReason(this.registry, render.world, render.state, unfit, text, secrets) });
      return;
    }
    // The further actions (DESIGN §11 action queue), each read as the first is. Time passing is never
    // queued: as the last it is the input's `then`, and earlier it ends the queue and is left in words.
    // One carrying a secret is dropped on its own, as a second action carrying one always was, and
    // what follows it, which may hang on it, is left in words. One that names nothing that fits ends
    // the queue with a decline chip, and nothing after it is offered, as after a first action that
    // names nothing.
    let then = result.then;
    const queue: QueuedAction[] = [];
    let misfit: UnfitAction | null = null;
    const further = result.queue ?? [];
    for (const [k, q] of further.entries()) {
      const def = all.find((a) => a.id === q.action);
      if (q.action === TIMELAPSE_ACTION || !def) {
        if (k === further.length - 1 && !then && q.action === TIMELAPSE_ACTION) then = q.params;
        else next = [...further.slice(k).map((r) => chipText(r.text)), ...next];
        break;
      }
      if (findLeaks(q.params, secrets).length > 0) {
        next = [...further.slice(k + 1).map((r) => chipText(r.text)), ...next];
        break;
      }
      const ready = playable(def, q.params, render.world, [q.text, text]);
      const ref = unfitRef(this.registry, def, ready, render.world, render.state);
      if (ref) {
        misfit = { label: def.label, reason: unfitReason(this.registry, render.world, render.state, ref, text, secrets) };
        next = [];
        then = undefined;
        break;
      }
      queue.push({ action: def.id, params: ready, text: chipText(q.text) });
    }
    bridge.setNext(text, joinActions(next) || null);
    bridge.setOffer(text, then ? interpretedTarget(then, render.world, render.state, text) : null);
    const intent: InterpretOutput = { action: result.action, params, probabilities: result.probabilities, ...(then ? { then } : {}), ...(queue.length > 0 ? { queue } : {}) };
    if (misfit) {
      this.host.log("info", `[LumiRPEngine] interpret: queued ${misfit.label} names nothing in the world; the queue ends before it`, userId);
      bridge.setUnfit(text, misfit, intent);
    } else bridge.setIntent(text, intent, true);
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
    const index = steps.findIndex((s) => checkOf(render.world, findAction(this.registry, render.world, s.action)?.check) !== null);
    const step = steps[index];
    const action = step ? findAction(this.registry, render.world, step.action) : undefined;
    if (!step || !action || step.judgement) return null;
    const shown = actionOdds(this.registry, render.world, render.state, { action, params: step.params });
    const policy = policyFor(render.world, render.state, action, render.world.pov);
    if (!shown.available || !shown.verdict || !shown.odds || !needsJudge(policy, shown.verdict)) return null;
    return { intent, index, action, params: step.params, verdict: shown.verdict, odds: shown.odds, policy };
  }

  /**
   * `judge` (DESIGN §11): when the policy would roll a check the player's words may shift, or leaves
   * it to the story, the approach the player described in words is rated (and the story's odds
   * given) before the plan; a palette or chip tap with no words of its own isn't. The answer rides
   * on the intent, so a Re-run reads the same judgement and the fold never asks.
   * It reads the lore its action, target, place and the player's words find (§5.4), a secret its
   * audience allows included, and it is told only who the POV can see. Its reason, which the roll
   * chip and the Journal show, is dropped (the rating stands) when it carries a secret's unrevealed
   * text the player didn't type, or names someone, a track or a place the POV can't see (§7).
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
    const leaks = findLeaks(judgement.reason, secrets).length > 0 || namesHidden(this.registry, render.world, render.state, judgement.reason);
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
   * where its traces go, and what the player has seen said this turn. Nothing is read from the host
   * for a world without lore.
   */
  private async lorePhase(phase: "pre" | "post", key: string, userId: UserId, world: WorldDoc, state: WorldState, budget: StepBudget, said: string, guidance: Guidance): Promise<LorePhase> {
    const at: LorePhase = { phase, key, userId, world, state, budget, active: ACTIVE_CONNECTION, said, guidance };
    if (Object.keys(world.lore).length === 0) return at;
    await this.toolSupport.ready(userId);
    return { ...at, active: await this.activeConnectionId(userId) };
  }

  /**
   * A step run's lore (DESIGN §5.4): null when the world has none or the step's policy is off.
   * Its prefetch searches the step's own inputs now, at no call; its lookups go to the connection
   * the step's helper calls use (a helper route's, else the default), as tools unless the step says
   * otherwise or that connection was seen refusing them. Its trace is kept under the phase's key
   * for the inspector, unless the step is about no one the POV may know (`LoreInputs.shown` null).
   * Snippets cost the host's count of their text once it has one for this user, else the
   * estimate, and are counted in the background.
   */
  private stepLore(run: { purpose: StepPurpose; config: StepConfig }, at: LorePhase, inputs: LoreInputs, effects = false): StepLore | null {
    const { world, state, userId } = at;
    if (Object.keys(world.lore).length === 0) return null;
    const setting = stepLoreOf(run.config);
    if (setting.policy === "none") return null;
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
    void this.host.tokens
      .count(
        asked.map(([, content]) => content),
        userId,
      )
      .then((counts) =>
        counts?.forEach((n, i) => {
          const [key, content] = asked[i] ?? ["", ""];
          if (key !== "" && Number.isFinite(n) && n >= 0 && n <= TOKEN_COUNT_CAP * sectionTokens(content)) lruSet(this.tokenCounts, key, n, 1024);
        }),
      )
      .catch(() => undefined);
  }

  /**
   * The world's book must stay in the chat's `chat_world_book_ids` (DESIGN §4.2): attaching another
   * chat book from the host's UI replaces the list, which would silently drop every engine slot.
   */
  private async keepBookAttached(chatId: ChatId, userId: UserId): Promise<void> {
    const run = await this.runOf(chatId, userId);
    if (!run) return;
    const bookId = (await this.worlds.index(run.worldId, userId))?.loreBookId;
    if (!bookId) return;
    const meta = await this.host.chats.chatMetadata(chatId, userId);
    const ids = Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids : [];
    if (ids.includes(bookId)) return;
    this.host.log("warn", `[LumiRPEngine] chat ${chatId}: the world's book was detached; re-attaching it`, userId);
    await this.book.attach(chatId, bookId, userId);
  }

  async beforeCommit(input: TurnContext): Promise<void> {
    const index = input.observed.findIndex((m) => m.id === input.messageId);
    const recent = recentLines(input.core, input.observed, index < 0 ? input.observed.length : index, this.registry);
    let context: ReadInput | null;
    if (input.kind === "continue") {
      const head = input.core.fold(input.observed.slice(0, index + 1));
      const world = input.core.worldAt(head.state.revision);
      context = world ? { state: head.state, world, seed: "", pre: [], start: head.state, recent } : null;
    } else {
      const at = input.core.commitContext(input.generationId, input.messageId, input.observed);
      context = at ? { ...at, recent } : null;
    }
    // A Continue reads what it added, matched against the whole message: a JSON block it split is left out whole (DESIGN §6.7).
    const full = input.kind === "continue" ? (input.observed[index]?.swipes[input.swipeId] ?? "") : "";
    const before = full.endsWith(input.content) ? full.slice(0, full.length - input.content.length) : "";
    if (context) await this.prepareRead(input.chatId, input.userId, input.messageId, input.swipeId, input.generationId, input.content, context, input.kind !== "continue", false, before);
  }

  /**
   * The post phase (DESIGN §5.2, §5.3), before the read commits: `extract` (or world `effects`
   * templates), off-screen `npc.choose`, `contradiction` and `choices`, side by side on the post
   * budget. Proposals are sorted by mode (D4 precedence, then bounds); the automatic ones and the
   * decisions are prepared for the core's read; undo, confirm, decline, contradiction and choice
   * chips are stored. With `replace` (a Re-read edit), the read replaces the swipe's earlier one, so
   * that read's chips go first. The decline for a typed action that named nothing (`unfitId`) is about
   * the player's message, not the reply, so any read of the swipe keeps it and its note.
   */
  async prepareRead(chatId: ChatId, userId: UserId, messageId: MessageId, swipeId: number, key: string, content: string, context: ReadInput, post: boolean, replace = false, before = ""): Promise<void> {
    const settings = await this.settings.get(userId);
    // What the engine reads of the reply: none of the JSON blocks the display hides, matched against the
    // whole message when `before` holds the text a Continue went on from (DESIGN §6.7).
    const text = readableReply(before + content, settings.hideJsonBlocks, before.length);
    if (replace) await this.chips.removeWhere(chatId, userId, (c) => c.messageId === messageId && c.swipeId === swipeId && READ_CHIP_KINDS.has(c.kind) && c.id !== unfitId(messageId, swipeId));
    const bridge = this.bridges.get(chatId);
    if (!bridge) return;
    const input = { chatId, userId, messageId, generationId: key, content };
    const pre = this.prePhase.get(key);
    // A read without a pre phase (a Continue, Re-read edit, Retry read) takes the user's latest read
    // of the preset: the read itself asks the host for nothing more.
    const guidance = (pre?.preset ?? this.presets.last(userId)).guidance;
    const plan = bridge.planFor(context.seed);
    const ctx = this.registry.context(context.world, context.state);
    const ties = tiesOf(ctx, context.world, context.state);
    const facts: SignalFacts = { ...(pre?.facts ?? noFacts()), ...(pre ? planFacts(context.world, pre.start, context.state, plan) : {}), reply: text.trim() !== "", present: false, offscreen: ties.offscreen.length > 0, tieZone: ties.offscreen.length > 0 };
    // The user's post-phase deadline as set (no silent 15 s floor).
    const budget = new StepBudget(settings.modelUse.budgets.post.calls, settings.modelUse.budgets.post.ms, undefined, settings.modelUse.budgets.post.lookup);
    const secrets = unrevealedSecrets(this.registry, context.world, context.state);
    // The brief the plan's step wrote, while the bridge still holds the plan (as `outcome` and `beats`).
    const vars = safeVars(this.stepVars(context.world, context.state, plan, pre?.text ?? "", text, (plan && bridge.proseFor(context.seed)?.brief) ?? "", context.recent), secrets);
    const modelUse = settings.modelUse;
    // What the reply's steps search lore with: the reply and the player's message, in the POV's scene.
    const read = { text: `${text}\n${pre?.text ?? ""}`, links: this.sceneLinks(context.world, context.state) };
    const at = await this.lorePhase("post", key, userId, context.world, context.state, budget, read.text, guidance);
    const lore = (r: StepRun, effects = false) => this.stepLore(r, at, read, effects);
    // Each step takes its call from the budget when it starts, in priority order.
    const extractRun = runsOf(modelUse, context.world, "extract", facts, { guidance }).find((r) => r.template === null || r.template.output !== "effects");
    const extractTask = extractRun && budget.take()
      ? extract(this.steps, text, povWorld(this.registry, context.world, context.state), prefixSummary(this.registry, context.world, context.state), clockMinutes(context.pre), EXTRACTION_TYPES.filter((t) => t === "time_advance" || this.registry.proposals.has(t)), extractRun.config, userId, budget.signal, extractRun.template ? renderTemplate(extractRun.template.template, vars) : undefined, lore(extractRun), extractRun.guidance)
      : Promise.resolve([]);
    const effectsTasks = (["extract", "contradiction", "choices"] as const).flatMap((purpose) => runsOf(modelUse, context.world, purpose, facts, { output: "effects", guidance })).map((r) => (budget.take() ? promptedEffects(this.steps, r, vars, context.world.currency, userId, budget.signal, lore(r, true)) : Promise.resolve([])));
    const npcRun = runsOf(modelUse, context.world, "npc.choose", facts, { guidance })[0];
    const npcTask = npcRun && ties.offscreen.length > 0 && budget.take() ? npcChoose(this.steps, npcRun, ties.offscreen, (t) => this.describeTie(t, context.world, context.state), createRng(hashParts("lre.npc.post", bridge.runSeed, key)), userId, budget.signal, this.stepLore(npcRun, at, this.tieInputs(ties.offscreen, context.world, context.state))) : Promise.resolve([]);
    const contradictionRun = runsOf(modelUse, context.world, "contradiction", facts, { guidance }).find((r) => r.template === null || r.template.output === "decision");
    const told = [...(plan ? planLines(plan, context.world, this.registry).outcome : []), ...factLines(this.registry, context.world, context.state, secrets)];
    const contradictionTask = contradictionRun && post && budget.take() ? contradiction(this.steps, contradictionRun, told, text, userId, budget.signal, lore(contradictionRun)) : Promise.resolve(null);
    const choiceRuns = runsOf(modelUse, context.world, "choices", facts, { output: "text", guidance });
    const choiceTasks = choiceRuns.map((r) => (post && budget.take() ? promptedText(this.steps, r, "choices", vars, secrets, userId, budget.signal, lore(r)).then((lines) => lines ?? []) : Promise.resolve([])));
    // The minds' post phase (DESIGN §24.4): who was present, their memory of what was written, and
    // consolidation, beside the reply's other steps, on the phase's wall clock.
    const mindsTask = post ? postMinds(this.minds, { chatId, userId, world: context.world, start: context.start, state: context.state, pre: context.pre, messageId, user: pre?.text ?? "", reply: text, signal: budget.signal, guidance: { memory: guidance.memory ?? "", consolidate: guidance.consolidate ?? "" } }) : Promise.resolve({ events: [], traces: [] });
    const [extracted, effects, decisions, contradicted, choices, minded] = await Promise.all([extractTask, Promise.all(effectsTasks), npcTask, contradictionTask, Promise.all(choiceTasks), mindsTask]);
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
    // The prices the player typed for this turn's Buys (minor units): the first action's and the queued ones'.
    const typed = intent ? [{ action: intent.action, params: intent.params }, ...(intent.queue ?? [])].flatMap((a) => (a.action === "buy" && typeof a.params.price === "number" ? [a.params.price] : [])) : [];
    const unsure = new Set<JsonObject>();
    const deduped = dedupeProposals(
      [...extracted, ...effects.flat()].flatMap((p) => splitAlongBuy(p, context.pre, ctx)),
      context.world.pov,
    ).filter((p) => {
      if (lentAlong(p, context.pre, context.state) || movedAlong(p, context.pre, context.state)) return false;
      const along = boughtAlong(p, context.pre, ctx, typed, text);
      if (along === "unsure") unsure.add(p);
      return along !== "retold";
    });
    const known = deduped.filter((p) => proposalKnown(p, this.registry, context.world, context.state));
    if (known.length < deduped.length) this.host.log("info", `[LumiRPEngine] read ${messageId.slice(0, 8)}: dropped ${deduped.length - known.length} proposal(s) naming what the player hasn't seen`, userId);
    // So is one carrying a secret's unrevealed truth: its chip would show it.
    const proposals = known.filter((p) => findLeaks(p, secrets).length === 0);
    if (proposals.length < known.length) this.host.log("info", `[LumiRPEngine] read ${messageId.slice(0, 8)}: dropped ${known.length - proposals.length} proposal(s) carrying an unrevealed secret`, userId);
    this.host.log("info", `[LumiRPEngine] read ${messageId.slice(0, 8)}: ${proposals.length} proposal(s), ${decisions.length} npc decision(s), contradiction ${contradicted ? "yes" : "no"}, ${choices.flat().length} choice(s), ${budget.spent} post call(s)`, userId);
    const learning = await this.settings.learningOf(input.userId);
    // D4 learning counts on the connection that read the reply: the extract step's own, else the
    // helper model's. A chip-triggered read (Re-read, Retry read) or a Continue without a pre phase
    // was read on the user's default connection, the one Settings shows.
    const connection = helperCallOf(extractRun?.config, (await this.settings.get(userId)).helper).connectionId ?? pre?.connectionId ?? (await this.activeConnectionId(userId));
    const auto: JsonObject[] = [];
    const confirm: JsonObject[] = [];
    // A pair's regard moves by at most the channel cap a reply, so later proposals for it are cut
    // down, and one with nothing left is refused like any change past its bound.
    const regard = regardBudget();
    const spent: JsonObject[] = [];
    // A fight holds the clock (DESIGN §11): a time skip narrated during one applies in neither mode;
    // it is declined like any refused change, and the next reply is told so.
    const fighting = fightHoldsClock(ctx);
    const held: JsonObject[] = [];
    for (const p of proposals) {
      const type = EXTRACTION_TYPES.find((t) => t === p.type);
      if (!type) continue;
      const { mode: typeMode } = effectiveMode(settings, learning, connection, type);
      const entity = typeof p.entity === "string" ? p.entity : typeof p.who === "string" ? p.who : typeof p.from === "string" ? p.from : undefined;
      const field = typeof p.field === "string" ? p.field : undefined;
      const bounded = boundProposal(this.registry, context.world, context.state, { type, ...(entity ? { entity } : {}), ...(field ? { field } : {}), ...(typeof p.delta === "number" ? { delta: p.delta } : {}) }, { typeMode, ...(settings.extraction[type]?.maxDelta !== undefined ? { typeMaxDelta: settings.extraction[type]?.maxDelta } : {}) });
      if (bounded.mode === "never") continue;
      if (type === "time_advance" && fighting) {
        held.push(p);
        continue;
      }
      const fitted = regard(bounded.delta !== undefined ? { ...p, delta: bounded.delta } : p);
      if (!fitted) {
        if (bounded.mode === "auto") spent.push(p);
        else this.host.log("info", `[LumiRPEngine] read ${messageId.slice(0, 8)}: dropped ${describeProposal(p)} (${REGARD_SPENT})`, userId);
        continue;
      }
      if (unsure.has(p)) unsure.add(fitted);
      if (bounded.mode === "auto" && !unsure.has(p)) auto.push(fitted);
      else confirm.push(fitted);
    }
    bridge.prepareRead(input.content, { auto, post, events: decisions, minds: minded.events });
    // `choices` and `contradiction` become chips below, with the read's others.
    // Each automatic proposal gets an undo chip; each confirm proposal a confirm chip (DESIGN §11).
    // An automatic proposal the engine refuses gets a decline chip instead, never silence: a payment
    // that can't be covered (with Pay another way), or anything else that can't apply (no amount, an
    // unknown item). The next Outcome slot says it didn't happen (DESIGN §9.5). A purchase's chip
    // shows what it charges, and one whose narrated price was capped or clamped can be re-priced.
    const w = new Working(this.registry, context.world, context.state);
    const outcomes = applyProposals(this.registry, w, auto.filter((p) => p.type !== "time_advance"), `${context.seed}:preview`, bridge.runSeed);
    const stored: StoredChip[] = [];
    const declines: { proposal: JsonObject; reason: string; payment: boolean; unpriced: boolean }[] = [...spent.map((proposal) => ({ proposal, reason: REGARD_SPENT, payment: false, unpriced: false })), ...held.map((proposal) => ({ proposal, reason: IN_FIGHT, payment: false, unpriced: false }))];
    outcomes.forEach((o, i) => {
      if (o.rejection) {
        if (o.rejection.code !== "declined") this.host.log("info", `[LumiRPEngine] read ${input.messageId.slice(0, 8)}: ${describeProposal(o.proposal)} didn't apply (${o.rejection.code}: ${o.rejection.reason})`, input.userId);
        declines.push({ proposal: o.proposal, reason: o.rejection.reason, payment: o.rejection.code === "declined", unpriced: o.rejection.code === "unpriced" });
        return;
      }
      // A change refused unseen comes back as one that changed nothing: no chip, and the next reply
      // hears nothing of it; the log says why.
      if (o.events.length === 0) {
        if (o.dropped) this.host.log("info", `[LumiRPEngine] read ${input.messageId.slice(0, 8)}: dropped ${describeProposal(o.proposal)} (${o.dropped})`, input.userId);
        return;
      }
      const type = String(o.proposal.type);
      const quote = purchaseQuote(o.proposal, o.events, context.world);
      stored.push({
        id: `undo:${input.messageId}:${input.generationId}:${i}`,
        kind: "undo",
        messageId: input.messageId,
        swipeId,
        label: `${describeProposal(o.proposal, context.world, context.state)}${quote?.text ?? ""}`,
        detail: "Applied automatically.",
        actions: [{ id: "undo", label: "Undo", style: "danger" }, ...(quote?.limited ? [{ id: "amount", label: "Edit amount", input: { type: "money" as const, label: "Amount", value: quote.cents } }] : [])],
        expires: "next_send",
        payload: { type, connection, events: JSON.parse(JSON.stringify(o.events)) as JsonValue },
      });
    });
    confirm.forEach((proposal, i) => {
      // A narrated time skip under confirm (DESIGN §9.4) is checked as it would apply automatically:
      // whole, with its catch-up, after this read's automatic changes. One that fits is offered for
      // Apply; a longer one, or one whose catch-up can't run whole, gets the Timelapse chip instead.
      if (proposal.type === "time_advance") {
        const advance = applyTimeAdvance(this.registry, new Working(this.registry, context.world, w.state), typeof proposal.minutes === "number" ? Math.round(proposal.minutes) : 0, { runSeed: bridge.runSeed, capMinutes: TIME_ADVANCE_CAP, unitCap: w.state.time.unitCap });
        if (advance.chip) stored.push(skipAheadChip(`adv:${messageId}:${swipeId}:c${i}`, { messageId, swipeId }, advance.chip.target, advance.reason === "unit_cap" ? "unit_cap" : "over_cap"));
        else if (advance.applied) {
          stored.push({
            id: `confirm:${input.messageId}:${input.generationId}:${i}`,
            kind: "confirm",
            messageId: input.messageId,
            swipeId,
            label: describeProposal(proposal, context.world, context.state),
            detail: "The narration says this much time passed. Apply it?",
            actions: [
              { id: "confirm", label: "Apply", style: "primary" },
              { id: "reject", label: "No" },
            ],
            expires: "next_send",
            payload: { type: "time_advance", connection, proposal },
          });
        } else this.host.log("info", `[LumiRPEngine] read ${input.messageId.slice(0, 8)}: dropped ${describeProposal(proposal)} (no skip a timelapse could reach)`, input.userId);
        return;
      }
      // Offer Apply only for what would apply now: a decline gets its own chip, a purchase nothing
      // prices asks for a price; anything else that can't validate (an unknown item) is logged and dropped.
      const also = unsure.has(proposal);
      const [check] = applyProposals(this.registry, new Working(this.registry, context.world, w.state), [proposal], `${context.seed}:check`, bridge.runSeed);
      // A move that can't happen (no way there, or a body the POV knows of) is declined in plain words,
      // as under auto; one refused unseen comes back as no change and is dropped below.
      if (check?.rejection && proposal.type === "location") {
        declines.push({ proposal, reason: check.rejection.reason, payment: false, unpriced: false });
        return;
      }
      // One that may be the Buy told again declines into nothing: the Buy itself was paid.
      if (check?.rejection?.code === "declined" && !also) {
        declines.push({ proposal, reason: check.rejection.reason, payment: true, unpriced: false });
        return;
      }
      if (check?.rejection?.code === "unpriced") {
        stored.push({
          id: `unpriced:${input.messageId}:${input.generationId}:${i}`,
          kind: "decline",
          messageId: input.messageId,
          swipeId,
          label: `${also ? "Also bought" : "Bought"} ${describeItem(proposal)}: no price`,
          detail: "The narration gives no price and the catalog doesn't list it, so nothing changed. Set a price or pick an item to apply it.",
          actions: [...pricingActions(proposal, ctx), { id: "dismiss", label: "Dismiss" }],
          expires: "next_send",
          payload: { type: "purchase", connection, proposal, reason: check.rejection.reason, seed: `${context.seed}:check` },
        });
        return;
      }
      if (!check || check.rejection || check.events.length === 0) {
        this.host.log("info", `[LumiRPEngine] read ${input.messageId.slice(0, 8)}: dropped ${describeProposal(proposal)} (${check?.dropped ?? check?.rejection?.reason ?? "no change"})`, input.userId);
        return;
      }
      const quote = purchaseQuote(proposal, check.events, context.world);
      stored.push({
        id: `confirm:${input.messageId}:${input.generationId}:${i}`,
        kind: "confirm",
        messageId: input.messageId,
        swipeId,
        label: also ? `Also bought ${describeItem(proposal)}?${quote?.text ?? ""}` : `${describeProposal(proposal, context.world, context.state)}${quote?.text ?? ""}`,
        detail: also ? "The reply may be telling your purchase again. Apply it only if this was bought too." : "The narration says this happened. Apply it?",
        actions: [{ id: "confirm", label: "Apply", style: "primary" }, ...(quote?.limited ? [{ id: "amount", label: "Edit amount", input: { type: "money" as const, label: "Amount", value: quote.cents } }] : []), { id: "reject", label: "No" }],
        expires: "next_send",
        // Applied with the check's seed, so a purchase charges the amount its label shows.
        payload: { type: String(proposal.type), connection, proposal, seed: `${context.seed}:check` },
      });
    });
    // Another swipe of this reply replaces its notes; this swipe's note on its typed action stays.
    const notes = (await this.outcomeNotes.list(chatId, userId)).filter((n) => n.messageId !== messageId || n.id === unfitId(messageId, swipeId));
    declines.forEach((d, i) => {
      const id = `decline:${input.messageId}:${input.generationId}:${i}`;
      notes.push({ id, messageId, text: declineNote(d.proposal, d.reason, "accept", context.state, context.world) });
      stored.push({
        id,
        kind: "decline",
        messageId: input.messageId,
        swipeId,
        label: !d.payment ? `Didn't apply: ${describeProposal(d.proposal, context.world, context.state)}` : d.proposal.type === "purchase" ? `Couldn't pay for ${describeItem(d.proposal)}` : `Declined: ${describeProposal(d.proposal, context.world, context.state)}`,
        detail: d.payment ? `${d.reason}. It stays unowned, and the next reply is told so.` : `${d.reason}. Nothing changed, and the next reply is told so.`,
        actions: [...(d.payment ? [{ id: "other", label: "Pay another way", style: "primary" as const }] : []), ...(d.unpriced ? pricingActions(d.proposal, ctx) : []), { id: "remove", label: "Remove it" }, { id: "accept", label: "Accept" }],
        expires: "next_send",
        payload: { type: String(d.proposal.type), connection, proposal: d.proposal, reason: d.reason },
      });
    });
    // The reply contradicted an engine fact (DESIGN §5.2 contradiction): a chip, and the next turn is told the fact.
    if (contradicted) {
      const id = `contradiction:${messageId}:${key}`;
      notes.push({ id, messageId, text: `Correction: the last reply went against an engine fact. ${contradicted}` });
      stored.push({ id, kind: "contradiction", messageId, swipeId, label: "The reply contradicts the facts", detail: contradicted, actions: [{ id: "renarrate", label: "Re-narrate", style: "primary" }, { id: "dismiss", label: "It's fine" }], expires: "next_send", payload: { fact: contradicted } });
    }
    // Suggested next moves (DESIGN §5.2 choices): one tap sends it as the player's message.
    choices.flat().forEach((choice, i) => {
      stored.push({ id: `choice:${messageId}:${key}:${i}`, kind: "choice", messageId, swipeId, label: choice, actions: [{ id: "send", label: "Send" }], expires: "next_send", payload: { text: choice } });
    });
    await this.outcomeNotes.save(chatId, userId, notes);
    await this.chips.add(input.chatId, input.userId, stored);
  }

  /** Replaces (or, with `null`, drops) a pending Outcome note. */
  async setOutcomeNote(chatId: ChatId, userId: UserId, id: string, text: string | null): Promise<void> {
    const notes = await this.outcomeNotes.list(chatId, userId);
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    if (text === null) notes.splice(notes.indexOf(note), 1);
    else note.text = text;
    await this.outcomeNotes.save(chatId, userId, notes);
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
    const user = input.observed.slice(0, idx < 0 ? input.observed.length : idx).findLast((m) => m.isUser);
    const userText = user ? (user.swipes[user.swipeId] ?? "") : "";
    // Rolls and odds, and an action that couldn't run (DESIGN §12 chips), from the turn's actions as they played.
    const played = plan?.resolutions ?? [];
    const checked = played.map((res) => `action ${res.action}, check ${res.check?.outcome ?? (res.adjudged ? `${res.outcome ?? "-"} (no roll: ${res.adjudged.why ?? "-"})` : "-")}`);
    this.host.log("info", `[LumiRPEngine] turn ${input.messageId.slice(0, 8)}:${input.swipeId} ${input.kind}: plan ${plan ? "yes" : "no"}, ${checked.length > 0 ? checked.join("; ") : "action -"}${plan?.stopped ? `; queue stopped (${plan.stopped.cause}) with ${plan.stopped.left} left` : ""}`, input.userId);
    if (played.length > 0) {
      // The actions live in the revision the chat folds at (after any Upgrade), not the run's first.
      const world = input.core.worldAt(input.core.fold(input.observed).state.revision) ?? input.core.worldAt(rec?.defHash ?? "");
      const labelOf = (res: Resolution): string => (world?.actions[res.action] ?? this.registry.actions.get(res.action))?.label ?? res.action;
      for (const [i, res] of played.entries()) {
        const label = labelOf(res);
        // A turn of one action keeps the chip ids it always had.
        const n = i === 0 ? "" : `:${i}`;
        const chip = rollChip(label, res);
        if (chip) stored.push({ id: `roll:${at}${n}`, kind: "roll", ...base, label: chip.label, detail: chip.detail, actions: [], expires: "never", payload: {} });
        if (!res.ok && res.failed) stored.push({ id: `decline:${at}${n}`, kind: "decline", ...base, label: `${label}: couldn't`, detail: playerReason(res.failed), actions: [], expires: "next_send", payload: {} });
        else if (res.rejected.length > 0) stored.push({ id: `decline:${at}${n}`, kind: "decline", ...base, label: `${label}: declined`, detail: res.rejected.map((r) => r.rejection.reason).join("; "), actions: [], expires: "next_send", payload: {} });
      }
      // Typed text `interpret` read as actions (DESIGN §9.4, §11): one tap undoes what they did.
      const done = played.filter((res) => res.ok && res.events.length > 0);
      if (done.length > 0 && input.kind !== "renarrate" && input.kind !== "continue" && bridge.wasInterpreted(userText)) {
        stored.push({ id: `not_action:${at}`, kind: "not_action", ...base, label: "Not an action?", detail: `Read as ${done.map((res) => `"${labelOf(res)}"`).join(", then ")}. Undo it if you only meant to say it.`, actions: [{ id: "undo", label: "Not an action", style: "danger" }], expires: "next_send", payload: { text: userText, events: JSON.parse(JSON.stringify(done.flatMap((res) => res.events))) as JsonValue } });
      }
    }
    // `interpret` couldn't read the typed text (DESIGN §9.4): its call failed, or a Decision route's choice
    // had no call left for its params. The turn ran as plain roleplay. Retry runs it again, as the swipe
    // chip's Re-run does, and reads the text afresh.
    if (input.kind !== "continue" && userText.trim() !== "" && bridge.wasUnread(userText)) {
      stored.push({ id: `read_failed:${at}`, kind: "read_failed", ...base, label: "Couldn't read your action", detail: "The call that reads your message failed, or none was left before the reply, so this turn ran as plain roleplay. Retry runs the turn again.", actions: [{ id: "rerun", label: "Retry", style: "primary" }], expires: "next_send", payload: {} });
    }
    // `interpret` read an action whose params name nothing in the world that fits (DESIGN §9.4): the
    // turn ran as plain roleplay, or, for a queued action, the queue ended before it; a decline chip
    // says why. As after a declined change (§9.5), the next reply is told it didn't happen, and Remove
    // it or Accept rewords that note. Both are about the typed message, so a later read of this reply
    // keeps them (`prepareRead`).
    const unfit = input.kind === "continue" ? undefined : bridge.unfitOf(userText);
    if (unfit) {
      const id = unfitId(input.messageId, input.swipeId);
      const what = `the player's "${unfit.label}"`;
      const notes = { accept: narratedNote(what, unfit.reason, "accept"), remove: narratedNote(what, unfit.reason, "remove") };
      const kept = (await this.outcomeNotes.list(input.chatId, input.userId)).filter((n) => n.id !== id);
      await this.outcomeNotes.save(input.chatId, input.userId, [...kept, { id, messageId: input.messageId, text: notes.accept }]);
      const reason = `${unfit.reason.charAt(0).toUpperCase()}${unfit.reason.slice(1)}`;
      const before = bridge.intentOf(userText) !== null ? "It didn't play, nor anything after it" : "Your message played as plain roleplay";
      stored.push({ id, kind: "decline", ...base, label: `${unfit.label}: couldn't`, detail: `${reason}. ${before}, and the next reply is told it didn't happen.`, actions: [{ id: "remove", label: "Remove it" }, { id: "accept", label: "Accept" }], expires: "next_send", payload: { reason: unfit.reason, notes } });
    }
    await this.ageNotes(input.chatId, input.userId, input.messageId);
    const headState = input.core.fold(input.observed).state;
    const chipWorld = input.core.worldAt(headState.revision) ?? input.core.worldAt(rec?.defHash ?? "");
    for (const [i, chip] of (plan?.chips ?? []).entries()) {
      // DESIGN §9.2 wording: "Timelapse to 07:00 (8 h 55 min)?"
      const to = chip.target.type === "at" && chipWorld ? ` to ${shortClock(chipWorld, headState, chip.target.at)}` : "";
      const label = chip.kind === "timelapse_offer" ? `Timelapse${to} (${compactSpan(chip.remaining)})?` : `Continue timelapse (${compactSpan(chip.remaining)} left)`;
      stored.push({ id: `tl:${at}:${i}`, kind: chip.kind, ...base, label, actions: [{ id: "timelapse", label: chip.kind === "timelapse_offer" ? "Timelapse" : "Continue", style: "primary" }], expires: "next_send", payload: { target: JSON.parse(JSON.stringify(chip.target)) as JsonValue } });
    }
    // A typed timelapse longer than a turn runs on its own: offered, never run unasked. Time the
    // message lets pass after its actions isn't offered while some of them are left to play.
    const offer = input.kind === "continue" || plan?.stopped ? undefined : bridge.offerFor(userText);
    if (offer) {
      const part = offer.type === "day_part" ? chipWorld?.calendar.dayParts.find((d) => d.id === offer.dayPart)?.label.toLowerCase() : undefined;
      const label = offer.type === "duration" ? `Timelapse ${compactSpan(offer.minutes)}?` : offer.type === "day_part" ? `Timelapse to ${part ?? offer.dayPart}?` : offer.type === "at" && chipWorld ? `Timelapse to ${shortClock(chipWorld, headState, offer.at)}?` : offer.type === "shift" ? "Timelapse to your next shift?" : offer.type === "commitment" ? "Timelapse to your next commitment?" : "Timelapse?";
      const detail = offer.type === "duration" && offer.minutes > INTERPRETED_TIMELAPSE_CAP ? "That's longer than one turn runs on its own. Run it as a timelapse?" : "You said time passes after that. Run it as a timelapse?";
      stored.push({ id: `tlo:${at}`, kind: "timelapse_offer", ...base, label, detail, actions: [{ id: "timelapse", label: "Timelapse", style: "primary" }], expires: "next_send", payload: { target: JSON.parse(JSON.stringify(offer)) as JsonValue } });
    }
    // What the turn didn't play of the message (DESIGN §5.2, §11): the queued actions left when the
    // queue stopped, then the words no action reads. One tap sends it as the next message, as a
    // suggested choice does, and it plays as the next turn, with its own prices, time and checks.
    const left = plan?.stopped ? (bridge.intentOf(userText)?.queue ?? []).slice(-plan.stopped.left).map((q) => q.text) : [];
    const next = input.kind === "continue" ? "" : joinActions([...left, bridge.nextOf(userText) ?? ""]);
    if (next !== "") stored.push({ id: `next:${at}`, kind: "choice", ...base, label: next, detail: `The rest of your message${plan?.stopped ? `: ${STOPPED[plan.stopped.cause]}` : ""}. Send plays it as its own turn.`, actions: [{ id: "send", label: "Send" }], expires: "next_send", payload: { text: next } });
    // An interrupt ended the timelapse early (DESIGN §9.2): say why, and offer the rest of the run.
    const summary = plan?.timelapse?.summary;
    if (summary?.stoppedBy && !(plan?.chips ?? []).some((c) => c.kind === "continue_timelapse")) {
      const elapsed = summary.to - summary.from;
      const rest = summary.target.type === "duration" ? { type: "duration" as const, minutes: Math.max(1, summary.target.minutes - elapsed) } : summary.target;
      const left = rest.type === "duration" ? ` (${compactSpan(rest.minutes)} left)` : "";
      stored.push({ id: `tl:${at}:stop`, kind: "continue_timelapse", ...base, label: `Timelapse stopped: ${summary.stoppedBy === "mind" ? (plan?.timelapse?.mindName ?? "someone") : STOP_LABEL[summary.stoppedBy]}`, detail: `Continue to the original target${left}?`, actions: [{ id: "timelapse", label: "Continue", style: "primary" }], expires: "next_send", payload: { target: JSON.parse(JSON.stringify(rest)) as JsonValue } });
    }
    for (const [i, chip] of bridge.chipsFor(input.content).entries()) stored.push(skipAheadChip(`adv:${at}:${i}`, base, chip.target, chip.reason));
    await this.chips.add(input.chatId, input.userId, stored);
  }

  /** Outcome notes are told to the turn after their reply (and its swipes), then dropped. */
  private async ageNotes(chatId: ChatId, userId: UserId, messageId: MessageId): Promise<void> {
    const notes = await this.outcomeNotes.list(chatId, userId);
    const kept = notes.filter((n) => n.messageId === messageId || n.toldTo === undefined || n.toldTo === messageId);
    for (const n of kept) if (n.messageId !== messageId) n.toldTo = messageId;
    await this.outcomeNotes.save(chatId, userId, kept);
  }

  /**
   * A swipe deleted on a message (DESIGN §4.3 swipe identity): its chips go and the later swipes'
   * move down, as the ledger's records do, so none shows, or applies, on the swipe that takes its
   * index. The Outcome notes tied to its chips (an unfit action's, a refused change's) go with them,
   * and those of the later swipes move down with theirs.
   */
  private async swipeDeleted(chatId: ChatId, userId: UserId, messageId: MessageId, deleted: number): Promise<void> {
    const dropped = await this.chips.shiftSwipes(chatId, userId, messageId, deleted);
    const notes = await this.outcomeNotes.list(chatId, userId);
    const kept = notes.flatMap((n) => {
      if (n.messageId !== messageId) return [n];
      const id = dropped.has(n.id) ? null : idAfterSwipeDelete(n.id, messageId, deleted);
      return id === null ? [] : [id === n.id ? n : { ...n, id }];
    });
    if (kept.length !== notes.length || kept.some((n, i) => n !== notes[i])) await this.outcomeNotes.save(chatId, userId, kept);
    this.changed(chatId, userId);
  }

  changed(chatId: ChatId, userId: UserId): void {
    this.push.changed(chatId, userId);
  }

  /** The next swipe's mode, chosen on the swipe-option chip; consumed by that swipe. */
  private readonly swipeChoice = new Map<ChatId, "rerun" | "renarrate">();

  setSwipeChoice(chatId: ChatId, mode: "rerun" | "renarrate"): void {
    lruSet(this.swipeChoice, chatId, mode, 256);
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

  // ---------------------------------------------------------------- the World Info interceptor

  async intercept(input: InterceptorInput): Promise<InterceptorResult | null> {
    const run = await this.runOf(input.chatId, input.userId);
    if (!run) return null;
    lruSet(this.lastWorldChat, input.userId, input.chatId, 1024);
    const core = await this.ledger.core(input.chatId, input.userId);
    if (!core) return null;
    const observed = toChain(await this.host.chats.messages(input.chatId, input.userId));
    const render = core.renderState(observed);
    if (!render) return null;
    const { world, state } = render;
    const index = await this.worlds.index(run.worldId, input.userId);
    const settings = await this.settings.get(input.userId);
    const result: InterceptorResult = { disabled: [], enabled: [], forced: [], mutated: [] };
    const bookId = index?.loreBookId ?? null;
    const entries: BookEntries = bookId ? await this.book.entriesOf(bookId, input.userId) : { slots: new Map(), twins: new Map(), atOutlet: new Set(), narrator: null, narratorOutlet: null };
    const slotIds = entries.slots;
    const present = new Set(input.entries.filter((e) => e.bookId === bookId).map((e) => e.id));
    const secrets = unrevealedSecrets(this.registry, world, state);
    const plan = Object.values(core.journal.pending).filter((p) => p.planned).at(-1);
    const turnPlan = plan ? this.bridges.get(input.chatId)?.planFor(plan.seed) : undefined;
    const prose = turnPlan && plan ? this.bridges.get(input.chatId)?.proseFor(plan.seed) : undefined;
    // What the active preset says this generation: the one its pre phase read, else read now (a dry run).
    const preset = (plan ? this.prePhase.get(plan.generationId)?.preset : undefined) ?? (await this.presets.current(input.chatId, input.userId));
    const presetKey = preset.preset ? `${preset.preset.id}\u0000${preset.preset.revision}` : "";
    const misses = this.outletMisses.get(input.chatId);
    const routedSlots = new Set<string>();
    // A plan the bridge no longer holds (a restart, or 64 newer plans) comes back from storage.
    const kept = plan && !turnPlan ? await this.planNotes.get(input.chatId, input.userId, plan.seed) : null;
    const outline = turnPlan ? planOutline(turnPlan, prose) : (kept?.outline ?? []);
    const planned = turnPlan ? planLines(turnPlan, world, this.registry) : kept ? { outcome: kept.outcome, montage: kept.montage } : { outcome: [], montage: [] };
    // Declines from the last reply (DESIGN §9.5), for the next turn and its swipes only.
    for (const n of await this.outcomeNotes.list(input.chatId, input.userId)) if (n.messageId !== plan?.messageId && (n.toldTo === undefined || n.toldTo === plan?.messageId)) planned.outcome.unshift(n.text);
    const record: InspectorRecord = { id: plan?.generationId ?? `dry:${Date.now().toString(36)}`, at: Date.now(), activation: "unconfirmed", sections: [], budget: { sections: settings.modelUse.tokens.sections, used: 0 }, forced: [] };
    const traces = plan ? this.loreTraces.get(plan.generationId) : undefined;
    if (traces) record.lore = structuredClone(traces);
    const minded = plan ? this.mindTraces.get(plan.generationId) : undefined;
    if (minded) record.minds = structuredClone(minded);
    if (bookId && present.size === 0) record.warnings = ["The world's book wasn't attached to this chat, so no engine sections reached the narrator. It is re-attached for the next turn."];
    else if (bookId && index) {
      // A slot entry deleted in the host's UI (or a stale cache) is recreated for the next turn, and
      // world lore an earlier build synced into the book is removed; the hook itself reads nothing.
      const missing = sectionsOf(world).some((s) => !present.has(slotIds.get(s.id) ?? ""));
      if (missing) record.warnings = ["Some engine slot entries were missing from the world's book; they are recreated for the next turn."];
      // A book an earlier build made has no outlet twins or narrator entries yet: they are added quietly.
      const unrouted = sectionsOf(world).some((s) => !present.has(entries.twins.get(s.id) ?? "")) || !present.has(entries.narrator ?? "") || !present.has(entries.narratorOutlet ?? "");
      if (missing || unrouted || input.entries.some((e) => e.bookId === bookId && loreOfEntry(e.extensions) !== null)) void this.book.ensure(world, index, input.userId).catch((error: unknown) => this.host.log("warn", `[LumiRPEngine] book repair failed: ${error instanceof Error ? error.message : String(error)}`, input.userId));
    }
    // Slots in rank order on the section budget; Outcome (rank 0) is never clipped (DESIGN §6.2).
    // The Minds section has its own budget and never spends the shared one (DESIGN §24.3).
    let budget = settings.modelUse.tokens.sections;
    const mindsBudget = settings.minds.tokens;
    const fullMinds = worldMindsOf(world).secrecy === "full";
    const { delivery } = await this.inspector.load(input.chatId, input.userId);
    const uncounted: string[] = [];
    // Sections with hint lines (Stance's cues, §6.6), which ride once every section has its place.
    const hinted: { entry: { content?: string }; label: string; template: string; lines: string[]; hints: string[]; cost: number }[] = [];
    // The entry a section fills, and whether the preset's outlet places it.
    const entryOf = (section: SectionTemplate): { id: string; routed: boolean } | null => {
      // The preset places the section itself when an enabled block holds `{{outlet::lre_<slot>}}`
      // (DESIGN §6.8): its outlet twin is filled instead, and the world's placement waits.
      const twin = entries.twins.get(section.id);
      const routed = twin !== undefined && present.has(twin) && preset.outlets.has(outletOf(section.id)) && !(misses?.preset === presetKey && misses.slots.has(section.id));
      // A later revision may have moved the section's own entry to an outlet while this chat's revision
      // places it in the chat: filled, that entry would land at both, so its twin takes the placement.
      const astray = !routed && section.position.type === "chat_depth" && entries.atOutlet.has(section.id) && twin !== undefined && present.has(twin);
      const id = routed || astray ? twin : slotIds.get(section.id);
      return id && present.has(id) ? { id, routed } : null;
    };
    const sectionCost = (content: string): number => this.tokenCounts.get(hashParts("lre.tokens", input.userId, content)) ?? sectionTokens(content);
    // The Minds section on its own budget (DESIGN §24.3): the best on the ladder first, the lowest left
    // out until it fits. Under `full` the narrator gets each mind whole, to depict and never state;
    // under `brief` the lines are leak-checked once more after their own screens. Only those it tells
    // of are out of Stance, which tells of everyone else.
    const mindsSection = sectionsOf(world).find((s) => s.id === MINDS_SLOT);
    const read = this.registry.context(world, state);
    const allMinds = mindsSection && entryOf(mindsSection) ? mindLines(read).filter((l) => fullMinds || findLeaks(l.line, secrets).length === 0) : [];
    const said = plan ? (this.prePhase.get(plan.generationId)?.text ?? "") : "";
    const ladder = (optionalQuery(read, "minds.fidelity")?.(read, { user: said, reply: "" }) ?? []).map((s) => s.entity);
    const mindsFit = mindsSection ? fitMindLines(allMinds, ladder, mindsBudget, (kept) => sectionCost(renderSection(mindsSection.label, mindsSection.template, kept.map((l) => l.line)))) : [];
    const ctx = this.registry.context(world, state, { "minds.minded": () => mindsFit.map((l) => l.entity) });
    for (const section of sectionsOf(world)) {
      const at = entryOf(section);
      if (!at) continue;
      const { id: entryId, routed } = at;
      const minds = section.id === MINDS_SLOT;
      const lines: string[] = minds ? mindsFit.map((l) => l.line) : [];
      const hints: string[] = [];
      for (const r of this.registry.renderers) {
        if (r.slot !== section.id || minds) continue;
        try {
          (r.hint ? hints : lines).push(...r.render(ctx));
        } catch (error) {
          this.host.log("warn", `[LumiRPEngine] section ${section.id}: ${error instanceof Error ? error.message : String(error)}`, input.userId);
        }
      }
      if (section.id === "outline") lines.push(...outline);
      // DESIGN §9.2: every turn has an elapsed time, and the Scene slot states it.
      if (section.id === "scene" && plan) {
        const minutes = clockMinutes(plan.events);
        lines.push(minutes > 0 ? `This turn took ${spanText(minutes)}.` : "No time passes this turn.");
      }
      // The turn's resolution leads the Outcome slot; a timelapse's Montage fills its own.
      if (section.id === "outcome") lines.unshift(...planned.outcome);
      if (section.id === "montage") lines.push(...planned.montage);
      const safe = minds ? lines : lines.filter((l) => findLeaks(l, secrets).length === 0);
      if (safe.length === 0) {
        // A Minds section whose best line alone is over its budget is left out whole.
        if (minds && allMinds.length > 0) record.sections.push({ slot: section.id, label: section.label, tokens: sectionCost(renderSection(section.label, section.template, allMinds.map((l) => l.line))), clipped: true, cut: allMinds.length, delivery: "unchecked" });
        // Hints alone never make a section: its being there would tell of them.
        continue;
      }
      const content = renderSection(section.label, section.template, safe);
      const key = hashParts("lre.tokens", input.userId, content);
      const counted = this.tokenCounts.get(key);
      if (counted === undefined) uncounted.push(content);
      const cost = counted ?? sectionTokens(content);
      const clipped = minds ? cost > mindsBudget : section.rank > 0 && cost > budget;
      // A clipped section wasn't in the prompt, so an earlier delivery check says nothing about it.
      record.sections.push({ slot: section.id, label: section.label, tokens: cost, clipped, ...(minds && mindsFit.length < allMinds.length ? { cut: allMinds.length - mindsFit.length } : {}), delivery: clipped ? "unchecked" : (delivery[section.id] ?? "unchecked") });
      if (clipped) continue;
      if (!minds) budget -= cost;
      if (routed) routedSlots.add(section.id);
      const placement = routed ? null : placementOf(section);
      result.enabled.push(entryId);
      result.forced.push(entryId);
      const entry = { id: entryId, content, ...(placement ? { placement } : {}) };
      result.mutated.push(entry);
      const safeHints = hints.filter((l) => findLeaks(l, secrets).length === 0);
      if (safeHints.length > 0) hinted.push({ entry, label: section.label, template: section.template, lines: safe, hints: safeHints, cost });
    }
    // The preset's narrator rules, for world chats only: at its `{{outlet::lre_narrator}}`, else
    // before the character. They are the preset's own text, apart from the section budget.
    const rules = preset.guidance.narrator;
    const rulesAt = entries.narratorOutlet !== null && present.has(entries.narratorOutlet) && preset.outlets.has(NARRATOR_OUTLET) ? entries.narratorOutlet : entries.narrator;
    if (rules && rulesAt && present.has(rulesAt)) {
      result.enabled.push(rulesAt);
      result.forced.push(rulesAt);
      result.mutated.push({ id: rulesAt, content: `[Narrator rules]\n${rules}` });
    }
    record.budget.used = settings.modelUse.tokens.sections - budget;
    // Hints follow what the POV doesn't know (a hidden flag, a lore gate), so they ride last, in what
    // the budget has left, and the inspector counts none of them: no clip, size or total the player
    // sees moves when an off-screen secret changes (§6.2).
    for (const h of hinted) {
      const content = renderSection(h.label, h.template, [...h.lines, ...h.hints]);
      const counted = this.tokenCounts.get(hashParts("lre.tokens", input.userId, content));
      if (counted === undefined) uncounted.push(content);
      const extra = Math.max(0, (counted ?? sectionTokens(content)) - h.cost);
      if (extra > budget) continue;
      budget -= extra;
      h.entry.content = content;
    }
    this.countLater(input.userId, uncounted);
    // Every engine-book entry the engine didn't fill this turn is voted off, so one re-enabled in the
    // host's UI (an unused slot, a lore entry an earlier build left) can't activate natively. Other
    // books' entries are left to native World Info: no vote, no force, no recursion override.
    const picked = new Set([...result.enabled, ...result.forced]);
    for (const e of input.entries) if (e.bookId === bookId && !picked.has(e.id)) result.disabled.push(e.id);
    record.forced = [...result.forced];
    lruSet(this.routedLast, input.chatId, { preset: presetKey, slots: routedSlots }, 256);
    // Only real turns enter the history; a dry run (inspector check, preview) records nothing.
    if (plan) {
      await this.inspector.add(input.chatId, input.userId, record);
      this.push.changed(input.chatId, input.userId);
    }
    return result;
  }

  /** `WORLD_INFO_ACTIVATED`: confirms the latest interceptor record when every forced entry activated. */
  private onActivated(chatId: ChatId, activated: readonly string[]): void {
    const record = this.inspector.records(chatId)?.at(-1);
    if (!record || record.activation !== "unconfirmed") return;
    const ids = new Set(activated);
    record.activation = record.forced.every((id) => ids.has(id)) ? "confirmed" : "unconfirmed";
    this.inspector.save(chatId);
  }

  /**
   * Deliverability (DESIGN §4.2): between generations, a dry-run assembly is
   * searched for each slot's text; a slot whose text is found is `verified`, else `unverified`.
   * Outcome, Montage and Outline hold only what a real turn planned, so a dry run (which plans
   * nothing) never carries them: they stay `unchecked` rather than reading as not delivered.
   */
  async checkDelivery(chatId: ChatId, userId: UserId): Promise<void> {
    const core = await this.ledger.core(chatId, userId);
    if (!core || core.inFlight) return;
    const assembly = await this.host.dryRun(chatId, userId);
    const text = assembly.messages.map((m) => m.content).join("\n");
    lruSet(this.presetWarnings, chatId, (await this.lintOf(chatId, assembly, userId)).map((c) => c.message), 256);
    const log = await this.inspector.load(chatId, userId);
    const last = log.records.at(-1);
    const out: Record<string, "verified" | "unverified"> = {};
    for (const s of last?.sections ?? []) if (!s.clipped && !hasOwn(TURN_ONLY_SLOTS, s.slot)) out[s.slot] = text.includes(`[${neutralizeMacros(s.label)}]`) ? "verified" : "unverified";
    // A section the preset's outlet should have held but the test build didn't find goes back to the
    // world's placement while that preset revision stands: the host left the outlet's block out (a
    // profile's block states, an activation script), so the section would stay missing there.
    const routed = this.routedLast.get(chatId);
    const missed = routed ? [...routed.slots].filter((slot) => out[slot] === "unverified") : [];
    if (routed && missed.length > 0) {
      const earlier = this.outletMisses.get(chatId);
      lruSet(this.outletMisses, chatId, { preset: routed.preset, slots: new Set([...(earlier?.preset === routed.preset ? earlier.slots : []), ...missed]) }, 256);
    }
    log.delivery = out;
    for (const s of last?.sections ?? []) s.delivery = s.clipped ? "unchecked" : (out[s.slot] ?? s.delivery);
    this.inspector.save(chatId);
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
   * settings revision, and the wait for it is bounded by `waitMs`: past that the answer says the check
   * is still running, and the run carries on for the next ask. A failed run reads as a caveat too,
   * and is run again on the next ask.
   */
  async presetCaveats(userId: UserId, waitMs = CAVEATS_WAIT_MS): Promise<PresetCaveat[]> {
    const open = await this.host.chats.active(userId).catch(() => null);
    const chatId = open && (await this.runOf(open, userId)) ? open : this.lastWorldChat.get(userId);
    if (!chatId) return [];
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
    const pending = Promise.withResolvers<PresetCaveat[]>();
    const timer = setTimeout(() => pending.resolve([{ code: "preset_lint_pending", message: "The preset check is still building a test prompt for this chat, which takes a while on a long chat. Open Caveats again in a moment." }]), waitMs);
    try {
      return await Promise.race([run, pending.promise]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async lintOf(chatId: ChatId, assembly: DryRun, userId: UserId): Promise<PresetCaveat[]> {
    const found = presetCaveats(assembly, null);
    if (found.length === 0) return found;
    // Named by the preset the host assembles with (block ids repeat across copied presets).
    const preset = (await this.presets.current(chatId, userId)).preset;
    return preset ? presetCaveats(assembly, preset.name) : found;
  }

  /** The interceptor records kept for a chat (newest last). */
  inspectorRecords(chatId: ChatId): readonly InspectorRecord[] | undefined {
    return this.inspector.records(chatId);
  }

  /** The inspector panel (`core.context`, `ContextView`), from the chat's loaded history (`view` loads it). */
  inspectorView(chatId: ChatId, userId: UserId): JsonValue {
    const warnings: string[] = [];
    const records = this.inspector.records(chatId) ?? [];
    for (const r of records) for (const w of r.warnings ?? []) if (!warnings.includes(w)) warnings.push(w);
    for (const w of this.presetWarnings.get(chatId) ?? []) if (!warnings.includes(w)) warnings.push(w);
    for (const w of this.ledger.notices(chatId, userId)) if (!warnings.includes(w)) warnings.push(w);
    const view: ContextView = { generations: records.map(({ forced: _forced, warnings: _w, ...r }) => r).reverse(), warnings };
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
    const view = buildView({ chatId, run, core, observed, registry: this.registry, world: (r) => core.worldAt(r), stored, meter: this.meter.view(userId), mapDisplay: await this.chatPrefs.mapDisplay(chatId, userId) });
    view.panels["core.context"] = this.inspectorView(chatId, userId);
    return view;
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
};

/**
 * The puzzles the player can see that take an answer now (`openPuzzles`, up to six), as interpret's
 * Answer label names them: each by the id its quest log row goes by, then as the row shows it,
 * "id: Puzzle — stage", so the world id the model is told to give for `puzzle` is the row's own (a
 * masked secret's stand-in). A masked secret reads "Something is going on" with no stage, like any
 * other, so its cue stands in for the stage: all that tells it from another, and never its own label.
 */
function openPuzzleTitles(registry: Registry, world: WorldDoc, state: Readonly<WorldState>): string[] {
  return openPuzzles(registry.context(world, state))
    .slice(0, 6)
    .map(({ shown }) => {
      const where = shown.stage || shown.cue;
      return `${shown.id}: ${where ? `${shown.label} — ${where}` : shown.label}`;
    });
}

/** Typed phrases that let time pass: they wake the classifier and are the timelapse's lexicon for `interpret`. */
const TIMELAPSE_LEXICON = ["wait until", "sleep until", "next morning", "skip ahead", "skip to", "pass the time", "sleep through", "hours later", "days later", "wait for"];

/** The longest typed timelapse a turn runs on its own (minutes); longer ones are offered as a chip. */
export const INTERPRETED_TIMELAPSE_CAP = 1440;

/** A "next" day part closer than this is the one after it: "sleep until the next morning" at 07:14 means tomorrow's. */
const NEXT_DAY_PART_GAP = 180;

/**
 * A typed timelapse's target from `interpret` params (DESIGN §9.2): `at` a stated day and time
 * ("YYYY-MM-DD HH:MM", local to where the POV is, as the HUD shows it), else `until` a day part (or
 * the next one), shift or commitment, else `minutes`. A stated time that has passed or lies beyond a
 * timelapse's reach is still the target, so the turn refuses it with its note as it does any target
 * it can't reach; text that isn't a day and time the calendar has is no stated time.
 */
export function interpretedTarget(params: JsonObject, world: WorldDoc, state: Readonly<WorldState>, text: string): TimelapseTarget | null {
  const cal = calendarOf(world);
  const now = state.clock;
  const local = typeof params.at === "string" ? clockOfStamp(cal, params.at) : null;
  if (local !== null) return { type: "at", at: local - placeOffset(world, local, placeOfEntity(state, world.pov)) };
  const raw = typeof params.until === "string" ? params.until.trim().toLowerCase() : "";
  const next = /^(the\s+)?(next|tomorrow)\b/.test(raw);
  const until = raw.replace(/^(the\s+)?(next|tomorrow)\s*/, "");
  const idx = cal.dayParts.findIndex((d) => d.id.toLowerCase() === until || d.label.toLowerCase() === until);
  const part = cal.dayParts[idx];
  if (part) {
    // The model may drop the "next" the player typed ("…sleep until the next morning" → until "morning").
    const words = [until, part.label.toLowerCase()].map((w) => w.replace(/[^a-z0-9 ]/g, "")).filter((w) => w !== "");
    if (next || /\btomorrow\b/i.test(text) || new RegExp(`\\bnext\\s+(${words.join("|")})\\b`, "i").test(text)) {
      const start = cal.partStarts[idx] ?? 0;
      const at = nextTimeOfDay(cal, now, start);
      return { type: "at", at: at - now < NEXT_DAY_PART_GAP ? nextTimeOfDay(cal, at, start) : at };
    }
    return { type: "day_part", dayPart: part.id };
  }
  if (until === "shift" || until === "commitment") return { type: until };
  const minutes = typeof params.minutes === "number" && Number.isFinite(params.minutes) ? Math.round(params.minutes) : 0;
  return minutes > 0 ? { type: "duration", minutes } : null;
}

/** Why an action couldn't run, for the player: a requirement isn't shown as its expression ("requires to != here"). */
export function playerReason(failed: { code: string; reason: string; requirement?: string }): string {
  if (failed.code !== "requirement") return failed.reason;
  const req = failed.requirement ?? failed.reason.replace(/^requires\s+/, "");
  if (/\bto\s*!=\s*here\b/.test(req)) return "You're already there.";
  const why = REQUIREMENT_WORDS.find(([pattern]) => pattern.test(req))?.[1];
  return why ? `Not possible here and now: ${why}.` : "Not possible here and now.";
}

/** Readable reasons for the requirement shapes packs use (the expression itself is never shown). */
const REQUIREMENT_WORDS: readonly [RegExp, string][] = [
  [/\blevel\.(\w+)\s*>=/, "this world doesn't simulate that in enough detail"],
  // A money feature the world's switches leave off (`money_feature`, DESIGN §25.12): the world, not the place or the hour, rules it out.
  [/\bmoney_feature\(/, "this world doesn't keep track of that"],
  // Money (DESIGN §25): enough of it, and whose account it is. Whose money comes before who runs it, so a
  // card change refused to someone who neither holds the card nor runs its account reads as the card.
  [/\bcan_afford\(/, "you can't afford it"],
  [/\b(?:spends|holds)\(self\b/, "that account isn't yours to use"],
  [/\bmay_draw\(/, "you can't take a draw from it"],
  [/\bmanages\(self\b/, "you don't run it"],
  [/\bis_credit\(/, "that isn't a card, a credit line or a loan"],
  [/\bemploys\(/, "they already work there"],
  [/\bowner\s*==\s*self\b/, "it isn't yours"],
  [/\bcarries\(self/, "you need to have it with you"],
  [/\blent_out\(/, "it isn't lent out"],
  [/\bat\(|\bplace\([^)]*\)\s*==\s*here|==\s*here\b/, "it has to be here"],
  [/>\s*0\b/, "it needs an amount"],
];

/**
 * Whether text a chip shows from `interpret`'s read names anything hidden: what `namesHidden` finds,
 * or anything else that leads to a secret lore entry (its aliases, keys and topics, and the lookup
 * terms filed to it), by all its words in order.
 */
function chipNamesHidden(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, text: string): boolean {
  return namesHidden(reg, world, state, text) || namesAny(text, [], secretLoreNames(reg, world, state));
}

/** A swipe's decline chip, and its Outcome note, for a typed action that named nothing that fits. */
function unfitId(messageId: MessageId, swipeId: number): string {
  return `unfit:${messageId}:${swipeId}`;
}

/** What a model writes for "nothing" ("none", "null", "N/A"), compared as `offeredNext` compares words. */
const NO_VALUE: Record<string, true> = { "": true, none: true, null: true, nil: true, na: true, "n a": true, nothing: true, no: true, undefined: true, empty: true };

/**
 * Words of the message the turn won't play (a queued action's, or what no action reads) as its chip
 * may offer them (DESIGN §5.2), or null. Whether they are an action is the read's call, not a word
 * list's, so only junk is kept off: a placeholder for nothing ("none", "N/A"); the message or its
 * first action said again ("I walk to Bluebird Coffee" after "I walk to Bluebird Coffee to buy a
 * latte"), whose chip would play it twice; words that only let time pass, which is `then`'s
 * (`lexicon` holds the actions' phrases); and words carrying an unrevealed secret (`secrets`, less
 * the player's own words) or naming anything hidden, which are dropped on their own while the
 * actions still play.
 */
function offeredNext(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, next: string, text: string, lexicon: readonly string[], secrets: readonly string[]): string | null {
  // Compared as words, without the player's own "I" or "we": "I walk to the cafe." is "walk to the cafe".
  const words = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .replace(/^(?:i|we)\s+/, "");
  const said = words(next);
  if (hasOwn(NO_VALUE, said) || words(text).startsWith(said)) return null;
  if (onlyPassesTime(next, world, lexicon, TIMELAPSE_LEXICON)) return null;
  return findLeaks(next, secrets).length > 0 || chipNamesHidden(reg, world, state, next) ? null : next;
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
 * Why `interpret`'s action couldn't apply (DESIGN §9.4), for its decline chip and the next reply's
 * note: what its param named, as the player typed it ("Rena isn't anyone in this world"), a real
 * thing of another kind by its name ("Bluebird Coffee isn't a person"), or that it has none. A name
 * the player didn't type, one the POV can't see, one that leads to a secret or carries an unrevealed
 * secret (`secrets`, less the player's own words), or anything too long for a name is never
 * repeated: "it names no one you know".
 */
function unfitReason(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, unfit: UnfitRef, text: string, secrets: readonly string[]): string {
  const { def, value } = unfit;
  const place = def.ref === "place";
  const person = !place && def.ref !== undefined && kindIs(reg, world, def.ref, "person");
  if (value === undefined || value === null || value === "") return place ? "it needs a place" : person ? "it needs someone" : "it needs something";
  const id = typeof value === "string" ? value : "";
  const entity = own(state.entities, id);
  const placeDef = entity ? undefined : own(world.places, id);
  // A real thing reads by its name where the POV can see it; anything else only as the player typed it
  // ("Rena" for a model's "rena"), an id's underscores read as spaces.
  const given = id.replace(/_+/g, " ").trim();
  const typed = given === "" ? undefined : new RegExp(given.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").exec(text)?.[0];
  const name = entity ? (canSeeEntity(reg, world, state, world.pov, id) ? entity.name : "") : placeDef ? (canSeePlace(reg, world, state, world.pov, id) ? placeDef.name : "") : (typed ?? "");
  if (name === "" || name.length > 80 || findLeaks(name, secrets).length > 0 || chipNamesHidden(reg, world, state, name)) return place ? "it names no place you know" : person ? "it names no one you know" : "it names nothing you know";
  // Only a param of one kind refuses a real thing, for being another.
  if ((entity || placeDef) && def.ref !== undefined) {
    const kind = place ? "place" : (reg.kinds.get(def.ref)?.label ?? own(world.kinds, def.ref)?.label ?? def.ref).toLowerCase();
    return `${name} isn't ${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind}`;
  }
  return `${name} isn't ${place ? "a place" : person ? "anyone" : "anything"} in this world`;
}

/**
 * A clock time for a chip, local to where the POV is, as the HUD shows it: "07:00" later the same
 * day, else with its weekday ("Sat 07:00").
 */
function shortClock(world: WorldDoc, state: Readonly<WorldState>, at: number): string {
  const cal = calendarOf(world);
  const place = placeOfEntity(state, world.pov);
  const d = dateAt(cal, at + placeOffset(world, at, place));
  const today = dateAt(cal, state.clock + placeOffset(world, state.clock, place)).dayIndex;
  return d.dayIndex === today ? formatHHMM(d.minuteOfDay) : `${weekdayName(cal, d.weekday)} ${formatHHMM(d.minuteOfDay)}`;
}

/** The Outline slot's lines: the brief, the engine's beats, then the outline step's prose. */
function planOutline(plan: EngineTurnPlan, prose: PlanProse | undefined): string[] {
  return [...(prose?.brief ? [`Brief: ${prose.brief}`] : []), ...plan.outline, ...(prose?.outline ?? [])];
}

/**
 * What the narrator must know about the turn's plan (DESIGN §6.2 Outcome, §9.2 Montage, §11): each
 * action's result in the order they played, with its roll, or why it couldn't run, and that the
 * rest of the message hasn't happened when the queue stopped; a fight's round; and a timelapse's
 * Montage groups and money. Why an action couldn't run is told as the player reads it, never as a
 * requirement's expression, which may name a secret track or someone the player doesn't know.
 */
export function planLines(plan: EngineTurnPlan, world: WorldDoc, registry: Registry): { outcome: string[]; montage: string[] } {
  const outcome: string[] = [];
  for (const res of plan.resolutions) {
    const label = (world.actions[res.action] ?? registry.actions.get(res.action))?.label ?? res.action;
    const reasons = res.rejected.slice(0, 3).map((r) => r.rejection.reason);
    if (!res.ok) outcome.push(`${label}: it didn't happen (${res.failed ? playerReason(res.failed).replace(/\.$/, "") : "not possible"}). Narrate the attempt failing.`);
    else if (res.check || res.adjudged) {
      outcome.push(checkLine(label, res));
      for (const r of reasons) outcome.push(`Not possible: ${r}.`);
    } else if (reasons.length > 0) outcome.push(`${label}: it didn't go through (${reasons.join("; ")}). Narrate it failing; nothing changed hands.`);
    else outcome.push(`${label}: done.`);
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
    outcome.push(`Time passed: ${span}, from ${formatClock(cal, summary.from)} to ${formatClock(cal, summary.to)}${by ? `, stopped early by ${by}` : ""}. Narrate only this span.`);
  }
  // The player's message holds more than the turn played: told so, the narrator doesn't play it out.
  if (plan.stopped) outcome.push(`The rest of the player's message hasn't happened (${STOPPED_NOTE[plan.stopped.cause]}); don't narrate it.`);
  const montage: string[] = [];
  const m = plan.montage;
  if (m) {
    for (const g of m.groups.slice(0, 7)) montage.push(`${g.label}: ${g.lines.slice(0, 6).join("; ")}`);
    for (const a of m.money.slice(0, 4)) montage.push(`${a.label}: in ${formatMoney(a.in, world.currency)}, out ${formatMoney(a.out, world.currency)}`);
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
 * The next Outcome slot's line for something narrated that didn't happen (DESIGN §9.5), named as
 * `what`: by default (and on Accept) it didn't happen, and why; Remove asks the narrator to drop it
 * from the story.
 */
function narratedNote(what: string, reason: string, choice: "accept" | "remove"): string {
  return choice === "remove" ? `Earlier, ${what} was narrated but never happened; leave it out from here on.` : `Earlier, ${what} was narrated but didn't happen (${reason}).`;
}

/**
 * The next Outcome slot's line for a declined narrated change (DESIGN §9.5): by default (and on
 * Accept) it didn't happen; Remove asks the narrator to drop it from the story.
 */
export function declineNote(p: JsonObject, reason: string, choice: "accept" | "remove", state: Readonly<WorldState>, world: WorldDoc): string {
  // A purchase reads by its item; any other change (a gift of cash, a move) by its chip label,
  // quoted as written, so a name keeps its case ("Danny Okafor paid $20.00 to you").
  const what = p.type === "purchase" ? describeItem(p) : `"${describeProposal(p, world, state)}"`;
  if (choice === "remove" || p.type !== "purchase") return narratedNote(what, reason, choice);
  const payerId = typeof p.payer === "string" && p.payer !== "" ? p.payer : null;
  const who = (payerId ? state.entities[payerId]?.name : undefined) ?? "The payment";
  return payerId ? `Earlier, ${who}'s payment for ${what} was declined (${reason}); they don't have it.` : `Earlier, paying for ${what} was declined (${reason}); it isn't owned.`;
}

/**
 * What a purchase's chip adds to its label, from the events that applied it: the amount it charges,
 * the catalog item it's priced as when that isn't the narrated name, and a narrated price the
 * charge doesn't match (": 500 bits (narrated 1,200 bits, capped at 500 bits)", ": $2.50 (priced as
 * Latte, 16 oz; narrated $9.00, clamped to $2.50)"), with the amount and whether it was capped or
 * clamped. Null for anything else, or a purchase that records no history line.
 */
export function purchaseQuote(p: JsonObject, events: readonly LedgerEvent[], world: WorldDoc): { text: string; cents: number; limited: boolean } | null {
  if (p.type !== "purchase") return null;
  for (const e of events) {
    const memo = e.type === "economy.txn" && "data" in e ? e.data.memo : undefined;
    if (!("data" in e) || typeof memo !== "string" || !memo.startsWith("Bought ")) continue;
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
function pricingActions(p: JsonObject, ctx: ReadContext): ChipAction[] {
  const { world, state } = ctx;
  const payer = typeof p.payer === "string" && hasOwn(state.entities, p.payer) ? p.payer : world.pov;
  const choices = optionalQuery(ctx, "economy.item_choices")?.(ctx, describeItem(p), payer) ?? [];
  return [
    { id: "price", label: "Set price", style: "primary", input: { type: "money", label: `Price of ${describeItem(p)}` } },
    ...(choices.length > 0 ? [{ id: "item", label: "Pick item", input: { type: "choice" as const, label: "Priced as", options: choices.map((o) => ({ value: o.item, label: `${o.name} · ${formatMoney(o.cents, world.currency)}` })) } }] : []),
  ];
}

/** A one-line label for a proposal chip; ids read as names (and money in the world's currency) when the world and state are given. */
export function describeProposal(p: JsonObject, world?: WorldDoc, state?: Readonly<WorldState>): string {
  const raw = (k: string): string => (typeof p[k] === "string" || typeof p[k] === "number" ? String(p[k]) : "?");
  const s = (k: string): string => {
    const v = raw(k);
    if (!world || !state) return v;
    if (v === world.pov) return "you";
    return state.entities[v]?.name ?? world.places[v]?.name ?? v;
  };
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
      return `${s("from")} gave ${s("item")} to ${s("to")}`;
    case "location":
      return `${s("entity")} → ${s("place")}`;
    case "condition": {
      // Sheets: {who, condition, clear?}; a bare field change (entity, field, delta) otherwise.
      if (typeof p.condition !== "string") return `${s("entity")} ${s("field")} ${Number(p.delta) >= 0 ? "+" : ""}${s("delta")}`;
      const who = typeof p.who === "string" && p.who !== "" ? s("who") : "you";
      return p.clear === true ? `${who}: no longer ${raw("condition")}` : `${who}: ${raw("condition")}`;
    }
    case "quantity":
      return `${s("entity")} ${s("item")} ${Number(p.delta) >= 0 ? "+" : ""}${s("delta")}`;
    case "regard":
      return `${s("from")} → ${s("to")}: ${s("axis")} ${Number(p.delta) >= 0 ? "+" : ""}${s("delta")}`;
    case "knows":
      return `${s("who")} learns: ${s("fact")}`;
    case "spawn":
      return `New: ${s("name")}`;
    case "life":
      return `${s("entity")}: ${raw("state").replace(/_/g, " ")}`;
    case "time_advance":
      return `+${s("minutes")} min`;
    default:
      return String(p.type);
  }
}

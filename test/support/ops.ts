// Randomized operation sequences for the ledger gate (DESIGN §14): a seeded generator, a runner
// that drives the fake host and the real ledger service, invariant checks after every operation,
// and a shrinker that reduces a failing sequence to a minimal one.
//
// Operations carry abstract choices (numbers in [0, 1)) that are resolved against the chat as it
// stands when they run, so any subsequence is still a valid sequence (shrinking needs that).
//
// Checked here (DESIGN §14): L1 reference equality, L7 re-validation, L9 seq, L11 Re-narrate, L16 inert/tombstone
// notes, L17 tombstones kept, L18 metadata mirrors the journal and survives clobbering and restart,
// L20 starting markers after every operation; L2 switch-and-back (excursion), L3 no pause on a switch
// or removal, L5 off-path commit, L6 P4 re-render, L8 held writes, L13/L14 Continue, L15 stopped
// Continue, L19 deletion, L34 dry run, L38 assistant edits, L39 user-edit pause, L43 a Re-run
// carries its fixes, L45 a branch or import folds as its source (an earlier build's chat included), L46 detail materialized once, per
// operation; L31 determinism in properties.test.ts. L4 is the classification these exercise; L10 and
// L12 are in scenarios.test.ts and reference.test.ts. Pack-dependent invariants arrive with the packs.

import { presetAdjudication } from "../../src/shared/adjudication";
import { hashJson } from "../../src/shared/hash";
import type { ChatId } from "../../src/shared/ids";
import { runDir } from "../../src/shared/ids";
import { hasOwn } from "../../src/shared/json";
import type { EventRef, HeldWrite, LedgerEvent, Marker, MarkerBody, MessageLedger, Rec, Tombstone, UpgradePicks } from "../../src/shared/ledger";
import { LEDGER_NAMESPACE, ROOT_PATH } from "../../src/shared/ledger";
import { decodeLedger, encodeLedger, toChain } from "../../src/backend/ledger-io";
import { defaultSettings } from "../../src/backend/settings-store";
import { startMarkersFrom } from "../../src/backend/start-markers";
import { applyEvent, applyMarker, eventUnits, EXTERNAL_ACCOUNT_PREFIX, validateEvent, validMarkerBody } from "../../src/engine/events";
import { touchedField } from "../../src/engine/touched";
import type { FoldOutput } from "../../src/engine/ledger/chain";
import { isLive, isTombstoned } from "../../src/engine/ledger/path";
import { referenceFold } from "../../src/engine/ledger/reference";
import { createRng, type Rng } from "../../src/engine/rng";
import type { FakeMessage, Generation } from "./fake-host";
import type { Folds, Harness, Plays } from "./harness";
import { openMoney, POV } from "./test-pack";

export type Op =
  | { op: "send"; text: number; reply: number; createAtEnd: boolean; rerender: boolean; money?: number; toll?: number; fight?: number; opens?: number; life?: number; mind?: number }
  | { op: "regenerate"; at: number; reply: number; renarrate?: boolean; toll?: number; opens?: number }
  | { op: "continue"; at: number; reply: number; stop: boolean; rerenderPrefix: boolean }
  | { op: "editAndSend"; at: number; text: number; reply: number; branch: boolean }
  | { op: "navigate"; at: number; swipe: number }
  | { op: "addSwipe"; at: number; text: number }
  | { op: "putSwipe"; at: number; swipe: number; text: number }
  | { op: "deleteSwipe"; at: number; swipe: number }
  | { op: "editAssistant"; at: number; text: number }
  | { op: "editUser"; at: number; text: number }
  | { op: "deleteMessage"; at: number }
  | { op: "branch"; at: number }
  | { op: "import" }
  /**
   * `gm`: a GM-style fix instead (a money correction, a relation added or removed, a grouped edit),
   * picked by its value; `open`: a ✎ cash fix on Dev instead, which opens his money first while it
   * isn't; `life`: a GM life edit instead (a state set, someone told, or both as one unit); `mind`:
   * a GM minds control instead (a pin, a refresh, a plan added or closed).
   */
  | { op: "write"; kind: number; a: number; b: number; gm?: number; open?: number; life?: number; mind?: number }
  /** A GM-style fix on the head (with `open`, a ✎ cash fix on Dev; with `life`, a GM life edit), then a Re-run of the head with any reply (L43). */
  | { op: "fixRerun"; gm: number; a: number; reply: number; open?: number; opens?: number; life?: number }
  | { op: "dryRun" }
  | { op: "restart" }
  | { op: "clobber"; at: number; echo: boolean }
  | { op: "excursion"; at: number; inner: Op[] }
  /** With `life`, the turn in flight is a queued or life turn (`LIFE_TEXTS`). */
  | { op: "inFlight"; type: number; inner: Op[]; stop: boolean; reply: number; opens?: number; life?: number }
  /** An Upgrade with picks (the definition merge) to one of the revisions, `picks` choosing them. */
  | { op: "upgrade"; to: number; picks: number }
  /** The chat as an earlier build wrote it from here (`Runner.earlierBuildStarts`): first in a sequence, if at all. */
  | { op: "earlierBuild" };

const USER_TEXTS = ["buy:map:30", "buy:lamp:20", "buy:rope:90", "use:map", "use:lamp", "use:rope", "earn:15", "roll", "look around"];
const REPLIES = ["Okay.", "You find coins. [found:5]", "The lamp slips away. [lose:lamp]", "A windfall! [found:40]", "You drop the map. [lose:map]", "Nothing happens."];
const EDITS = ["Edited reply.", "A typo fixed. [found:7]", "Trimmed.", "Rewritten [lose:rope]"];
// Postings on Sam's account: kept apart from the lists above so recorded regressions
// replay unchanged; the optional `money` / `toll` op fields pick from these.
// `shop:map` / `shop:lamp` collide with `buy:map` / `buy:lamp` on other branches, so grouped drops happen often.
const MONEY_TEXTS = ["deposit:60", "deposit:150", "pay:50", "pay:20", "pay:80", "shop:tire:90", "shop:map:25", "shop:lamp:10", "use:tire"];
const TOLL_REPLIES = ["You pay the toll. [pay:30]", "A fee is taken. [pay:15]", "The meter eats your money. [pay:70]"];
// A fight against the rat (start, act, end turn, end), kept apart for the same reason; the optional `fight` op field picks from these.
const FIGHT_TEXTS = ["fight:rat", "strike:rat", "strike:rat", "end_turn", "flee"];
// Replies naming Dev, whose read opens his money (once), kept apart for the same reason; the optional `opens` op field picks from these.
const OPENING_REPLIES = ["Dev counts out his wages. [opens:dev]", "Dev pays you back. [opens:dev] [found:5]"];
// Turns the engine plans with life changes and queued actions (DESIGN §8, §11), kept apart for the
// same reason; the optional `life` op field picks from these. A queue stops at the gamble's check, a
// splurge Sam can't afford, a visible alarm, a fight starting, or Sam collapsing; never at a hidden alarm.
const LIFE_TEXTS = [
  "do:kill:rat",
  "do:revive:rat",
  "do:wound:dev",
  "do:revive:dev",
  "do:tell:dev",
  "do:collapse",
  "do:revive:sam",
  "do:work,go_out,kill:rat,go_in",
  "do:go_out,revive:rat,go_in,tell:rat",
  "do:work,gamble,work",
  "do:work,splurge,work",
  "do:work,alarm,work",
  "do:work,hush,work",
  "do:fight:rat,work",
  "do:finish,work",
  "do:collapse,work",
];
// GM life edits as the GM view records them (`engine/edits` through the `life` effect), kept apart for the same reason.
const LIFE_FIXES: LedgerEvent[][] = [
  [{ type: "engine.life", data: { entity: "dev", to: "dead" } }],
  [{ type: "engine.life", data: { entity: "dev", to: "alive" } }],
  [{ type: "engine.life", data: { entity: "rat", to: "dying" } }],
  [{ type: "engine.life", data: { entity: POV, to: "dying" } }],
  [{ type: "engine.told", data: { entity: "rat", who: [POV] } }],
  [
    { type: "engine.life", data: { entity: "rat", to: "dead" }, group: "edit:life" },
    { type: "engine.told", data: { entity: "rat", who: ["dev"] }, group: "edit:life" },
  ],
];
// Turns where Dev thinks, and replies he remembers (DESIGN §24): the minds pre and post phases' events, kept apart as the others are.
const MIND_TEXTS = ["mind:dev"];
const MIND_REPLIES = ["Dev weighs it up. [recall:dev]", "Dev says nothing.", "You both remember this. [recall:dev] [found:3]"];
// GM minds controls as `lre.edit` records them: a pin, a refresh, a plan added and its status (which a branch without the plan drops).
const GM_PLAN: LedgerEvent = { type: "minds.plan_edit", data: { entity: "dev", plan: "p_gm", value: { id: "p_gm", what: "Fix the boat", kind: "errand", when: { from: 60, to: 120 }, where: null, with: [], priority: 2, status: "open", made: 0, source: "gm", closed: null, reason: null } } };
const MIND_FIXES: LedgerEvent[][] = [
  [{ type: "minds.pin", data: { entity: "dev", level: "live" } }],
  [{ type: "minds.pin", data: { entity: "dev", level: null } }],
  [{ type: "minds.refresh", data: { entity: "dev" } }],
  [GM_PLAN],
  [{ type: "minds.plan", data: { entity: "dev", plan: "p_gm", status: "done", at: 90, reason: null } }],
  [
    { ...GM_PLAN, group: "edit:mind" },
    { type: "minds.plan", data: { entity: "dev", plan: "p_gm", status: "dropped", at: 90, reason: "GM edit" }, group: "edit:mind" },
  ],
];

/**
 * How often a run exercised a funds drop, a grouped drop on a rebased view, a Re-run carrying or
 * dropping a fix, a Re-run dropping a fix whose materialization its new swipe had already made, a
 * copy of an earlier build's chat whose starting markers it had to restore, a turn checked on the
 * chain it was planned on after a deletion moved a swipe it saw, a fight's start, acts, turns and
 * end, a turn's planned life changes and tellings, and queued turns and each way one stops early
 * (the suite asserts they happen).
 */
export interface Coverage {
  fundsDrops: number;
  groupDrops: number;
  carried: number;
  carryDrops: number;
  stripped: number;
  earlierCopies: number;
  shiftedPlans: number;
  fights: Record<"start" | "act" | "turn" | "end", number>;
  lives: Record<"life" | "told", number>;
  minds: Record<"mind" | "memory" | "presence" | "fix", number>;
  queues: Plays;
}

/** A fresh count for a runner or a whole suite. */
export function noCoverage(): Coverage {
  return { fundsDrops: 0, groupDrops: 0, carried: 0, carryDrops: 0, stripped: 0, earlierCopies: 0, shiftedPlans: 0, fights: { start: 0, act: 0, turn: 0, end: 0 }, lives: { life: 0, told: 0 }, minds: { mind: 0, memory: 0, presence: 0, fix: 0 }, queues: { queued: 0, check: 0, failure: 0, interruption: 0 } };
}

const FIGHT_EVENTS: Record<string, keyof Coverage["fights"]> = { "combat.start": "start", "combat.act": "act", "combat.turn": "turn", "combat.end": "end" };
const LIFE_EVENTS: Record<string, keyof Coverage["lives"]> = { "engine.life": "life", "engine.told": "told" };
const MIND_EVENTS: Record<string, keyof Coverage["minds"]> = { "minds.mind": "mind", "minds.memory": "memory", "minds.presence": "presence", "minds.pin": "fix", "minds.refresh": "fix", "minds.plan_edit": "fix", "minds.plan": "fix" };

/**
 * The indexes of the source's events a carried copy left out, or null when the copy isn't the source
 * as it was: only a materialization of detail its new prefix already records may leave (L46).
 */
function strippedFrom(source: readonly LedgerEvent[], copy: readonly LedgerEvent[]): number[] | null {
  const out: number[] = [];
  let j = 0;
  for (const [i, ev] of source.entries()) {
    if (j < copy.length && hashJson(copy[j]) === hashJson(ev)) j++;
    else if (ev.type === "materialize") out.push(i);
    else return null;
  }
  return j === copy.length ? out : null;
}

const pick = <T>(items: readonly T[], x: number): T => {
  const item = items[Math.min(items.length - 1, Math.floor(x * items.length))];
  if (item === undefined) throw new Error("pick from an empty list");
  return item;
};

/**
 * A GM-style fix: a money correction out of Sam's account (a poorer branch can't cover it), an item
 * taken away (a branch whose reply lost it already can't), a `knows` link or unlink (an unlink
 * fails where the link isn't), or a grouped edit of an unlink and a mood.
 */
function gmFix(which: number, x: number): LedgerEvent[] {
  const link: LedgerEvent = { type: "link", rel: "knows", from: POV, to: "dev" };
  const unlink: LedgerEvent = { type: "unlink", rel: "knows", from: POV, to: "dev" };
  if (which < 0.3) {
    const amount = pick([20, 60, 120], x);
    return [{ type: "post", lines: [{ account: POV, amount: -amount }, { account: `${EXTERNAL_ACCOUNT_PREFIX}correction`, amount }], memo: "Correction" }];
  }
  if (which < 0.55) return [{ type: "test.lose", data: { item: pick(["lamp", "map", "rope"], x) } }];
  if (which < 0.7) return [link];
  if (which < 0.85) return [unlink];
  return [
    { ...unlink, group: "edit:pair" },
    { type: "set", entity: POV, field: "mood", value: pick(["calm", "tense"], x), group: "edit:pair" },
  ];
}

/** Starting markers as an earlier build journaled them: each one the marker check clamps, as the world writes it. */
function writtenStarts(markers: readonly Marker[], raws: readonly MarkerBody[]): Marker[] {
  return markers.map((mk) => {
    if (!mk.start) return mk;
    const { seq, at, start: _start, ...body } = mk;
    const raw = raws.find((r) => hashJson(r) !== hashJson(body) && hashJson(validMarkerBody(r)) === hashJson(body));
    return raw ? { ...raw, seq, at, start: true as const } : mk;
  });
}

/** Starting markers as that build's flush wrote them to metadata: clamped. */
function clampedStarts(markers: readonly Marker[]): Marker[] {
  return markers.map((mk) => {
    if (!mk.start) return mk;
    const { seq, at, start: _start, ...body } = mk;
    const clamped = validMarkerBody(body);
    return clamped ? { ...clamped, seq, at, start: true as const } : mk;
  });
}

// ------------------------------------------------------------------ generation

export function generate(rng: Rng, length: number, depth = 0): Op[] {
  const ops: Op[] = [];
  const r = (): number => rng.next();
  // Fights draw from a stream of their own, so every other op is generated as before; so do Dev's
  // money openings (replies naming him, ✎ cash fixes on him) and what is removed while a reply streams.
  const fights = rng.fork(`fights:${depth}`);
  const opens = rng.fork(`opens:${depth}`);
  const removals = rng.fork(`removals:${depth}`);
  for (let i = 0; i < length; i++) {
    const roll = r();
    if (roll < 0.22) ops.push({ op: "send", text: r(), reply: r(), createAtEnd: r() < 0.2, rerender: r() < 0.2, ...(r() < 0.35 ? { money: r() } : {}), ...(r() < 0.2 ? { toll: r() } : {}), ...(fights.next() < 0.3 ? { fight: fights.next() } : {}), ...(opens.next() < 0.15 ? { opens: opens.next() } : {}) });
    else if (roll < 0.29) ops.push({ op: "regenerate", at: r(), reply: r(), renarrate: r() < 0.5, ...(r() < 0.3 ? { toll: r() } : {}), ...(opens.next() < 0.3 ? { opens: opens.next() } : {}) });
    else if (roll < 0.35) ops.push({ op: "continue", at: r(), reply: r(), stop: r() < 0.3, rerenderPrefix: r() < 0.2 });
    else if (roll < 0.38) ops.push({ op: "editAndSend", at: r(), text: r(), reply: r(), branch: r() < 0.3 });
    else if (roll < 0.45) ops.push({ op: "navigate", at: r(), swipe: r() });
    else if (roll < 0.49) ops.push({ op: "addSwipe", at: r(), text: r() });
    else if (roll < 0.52) ops.push({ op: "putSwipe", at: r(), swipe: r(), text: r() });
    else if (roll < 0.54) ops.push({ op: "deleteSwipe", at: r(), swipe: r() });
    else if (roll < 0.59) ops.push({ op: "editAssistant", at: r(), text: r() });
    else if (roll < 0.62) ops.push({ op: "editUser", at: r(), text: r() });
    else if (roll < 0.65) ops.push({ op: "deleteMessage", at: r() });
    else if (roll < 0.66) ops.push({ op: "branch", at: r() });
    else if (roll < 0.67) ops.push({ op: "import" });
    else if (roll < 0.755) ops.push({ op: "write", kind: r(), a: r(), b: r(), ...(r() < 0.3 ? { gm: r() } : {}), ...(opens.next() < 0.15 ? { open: opens.next() } : {}) });
    else if (roll < 0.77) ops.push({ op: "upgrade", to: r(), picks: r() });
    else if (roll < 0.8) ops.push({ op: "fixRerun", gm: r(), a: r(), reply: r(), ...(opens.next() < 0.5 ? { open: opens.next() } : {}), ...(opens.next() < 0.5 ? { opens: opens.next() } : {}) });
    else if (roll < 0.82) ops.push({ op: "dryRun" });
    else if (roll < 0.84) ops.push({ op: "restart" });
    else if (roll < 0.87) ops.push({ op: "clobber", at: r(), echo: r() < 0.5 });
    else if (roll < 0.93 && depth === 0) ops.push({ op: "excursion", at: r(), inner: generateExcursion(rng, 1 + Math.floor(r() * 4)) });
    else if (depth === 0) ops.push({ op: "inFlight", type: r(), inner: generateInner(rng, 1 + Math.floor(r() * 3), opens, removals), stop: r() < 0.25, reply: r(), ...(opens.next() < 0.3 ? { opens: opens.next() } : {}) });
    else ops.push({ op: "write", kind: r(), a: r(), b: r() });
  }
  // Life changes and queued turns come after the rest, from a stream of their own, so every operation
  // before them is generated and runs as before.
  if (depth === 0) {
    const lives = rng.fork("lives");
    ops.push(...generateLives(lives, 1 + Math.floor(lives.next() * 12)));
    // Minds' turns and GM controls come last, from their own stream, so everything before runs as before.
    const minds = rng.fork("minds");
    ops.push(...generateMinds(minds, 1 + Math.floor(minds.next() * 8)));
  }
  // Drawn from a stream of its own, so the sequence is otherwise as before.
  if (depth === 0 && rng.fork("earlier-build").next() < 0.25) ops.unshift({ op: "earlierBuild" });
  return ops;
}

/**
 * Character minds (DESIGN §24): turns that record a minds round and Dev's mind before the plan, and
 * replies that record who was there and his memory after it; GM minds controls; and around them the
 * Re-runs, Re-narrates, swipes, edits and turns in flight that move those records onto other views.
 */
function generateMinds(rng: Rng, length: number): Op[] {
  const ops: Op[] = [];
  const r = (): number => rng.next();
  for (let i = 0; i < length; i++) {
    const roll = r();
    if (roll < 0.4) ops.push({ op: "send", text: r(), reply: r(), createAtEnd: r() < 0.2, rerender: false, mind: r() });
    else if (roll < 0.55) ops.push({ op: "regenerate", at: r(), reply: r(), renarrate: r() < 0.5 });
    else if (roll < 0.7) ops.push({ op: "write", kind: r(), a: r(), b: r(), mind: r() });
    else if (roll < 0.78) ops.push({ op: "navigate", at: r(), swipe: r() });
    else if (roll < 0.84) ops.push({ op: "deleteSwipe", at: r(), swipe: r() });
    else if (roll < 0.9) ops.push({ op: "editUser", at: r(), text: r() });
    else ops.push({ op: "editAndSend", at: r(), text: r(), reply: r(), branch: r() < 0.3 });
  }
  return ops;
}

/**
 * Life changes and queued turns (DESIGN §8, §11): turns the engine plans with the `life` effect,
 * its rule and a queue of actions (`LIFE_TEXTS`), GM life edits (`LIFE_FIXES`), and around them the
 * Re-runs, Re-narrates, edits, swipes, Keep choices, Upgrades and turns in flight that move a record
 * onto another view, where its life changes re-validate.
 */
function generateLives(rng: Rng, length: number): Op[] {
  const ops: Op[] = [];
  const r = (): number => rng.next();
  const opens = rng.fork("opens");
  const removals = rng.fork("removals");
  for (let i = 0; i < length; i++) {
    const roll = r();
    if (roll < 0.4) ops.push({ op: "send", text: r(), reply: r(), createAtEnd: r() < 0.2, rerender: false, life: r() });
    else if (roll < 0.5) ops.push({ op: "regenerate", at: r(), reply: r(), renarrate: r() < 0.5 });
    else if (roll < 0.58) ops.push({ op: "write", kind: r(), a: r(), b: r(), life: r() });
    else if (roll < 0.63) ops.push({ op: "fixRerun", gm: r(), a: r(), reply: r(), life: r() });
    else if (roll < 0.68) ops.push({ op: "editUser", at: r(), text: r() });
    else if (roll < 0.72) ops.push({ op: "editAndSend", at: r(), text: r(), reply: r(), branch: r() < 0.3 });
    else if (roll < 0.77) ops.push({ op: "navigate", at: r(), swipe: r() });
    else if (roll < 0.8) ops.push({ op: "deleteSwipe", at: r(), swipe: r() });
    // Keep (with a conversion when something dropped) or Discard.
    else if (roll < 0.86) ops.push({ op: "write", kind: 0.62 + r() * 0.23, a: r(), b: r() });
    else if (roll < 0.9) ops.push({ op: "upgrade", to: r(), picks: r() });
    else ops.push({ op: "inFlight", type: r(), inner: generateInner(rng, 1 + Math.floor(r() * 3), opens, removals, rng.fork(`lives:${i}`)), stop: r() < 0.25, reply: r(), life: r() });
  }
  return ops;
}

/** Operations allowed while switched away (L2): anything that stays on the switched path. */
function generateExcursion(rng: Rng, length: number): Op[] {
  const ops: Op[] = [];
  for (let i = 0; i < length; i++) {
    const roll = rng.next();
    if (roll < 0.35) ops.push({ op: "send", text: rng.next(), reply: rng.next(), createAtEnd: false, rerender: false });
    else if (roll < 0.45) ops.push({ op: "continue", at: 1, reply: rng.next(), stop: false, rerenderPrefix: false });
    else ops.push({ op: "write", kind: rng.next() * 0.7, a: rng.next(), b: rng.next() });
  }
  return ops;
}

/**
 * Operations interleaved while a reply streams (P2); `opens` and `removals` are the generator's own
 * streams for Dev's money and for swipe deletions, swipe PUTs and message deletions, and `lives`
 * (life changes' turns in flight only) makes some writes GM life edits. A removal often lands on the
 * message the operation before it touched: navigating a message off a swipe, then deleting that
 * swipe, is how a swipe the plan saw goes.
 */
function generateInner(rng: Rng, length: number, opens: Rng, removals: Rng, lives?: Rng): Op[] {
  const ops: Op[] = [];
  for (let i = 0; i < length; i++) {
    const roll = rng.next();
    if (roll < 0.4) ops.push({ op: "write", kind: rng.next(), a: rng.next(), b: rng.next(), ...(rng.next() < 0.3 ? { gm: rng.next() } : {}), ...(opens.next() < 0.2 ? { open: opens.next() } : {}), ...(lives && lives.next() < 0.3 ? { life: lives.next() } : {}) });
    else if (roll < 0.55) ops.push({ op: "navigate", at: rng.next() * 0.8, swipe: rng.next() });
    else if (roll < 0.7) ops.push({ op: "editAssistant", at: rng.next() * 0.8, text: rng.next() });
    else if (roll < 0.8) ops.push({ op: "editUser", at: rng.next(), text: rng.next() });
    else if (roll < 0.9) ops.push({ op: "addSwipe", at: rng.next() * 0.8, text: rng.next() });
    else ops.push({ op: "clobber", at: rng.next(), echo: rng.next() < 0.5 });
    if (removals.next() >= 0.35) continue;
    const last = ops.at(-1);
    const at = last && "at" in last && removals.next() < 0.6 ? last.at : removals.next() * 0.8;
    const kind = removals.next();
    if (kind < 0.6) ops.push({ op: "deleteSwipe", at, swipe: removals.next() });
    else if (kind < 0.85) ops.push({ op: "putSwipe", at, swipe: removals.next(), text: removals.next() });
    else ops.push({ op: "deleteMessage", at: removals.next() });
  }
  return ops;
}

// ------------------------------------------------------------------ running

export class InvariantError extends Error {
  constructor(
    readonly invariant: string,
    message: string,
  ) {
    super(`${invariant}: ${message}`);
    this.name = "InvariantError";
  }
}

interface ChatMemory {
  start: string | null;
  maxSeq: number;
  tombstones: number;
}

export class Runner {
  readonly chats: ChatId[] = [];
  current: ChatId = "";
  private readonly memory = new Map<ChatId, ChatMemory>();
  /** This runner's own coverage counts (no state shared across runs or test files). */
  readonly coverage: Coverage = noCoverage();
  private ids = 0;
  /**
   * The reply streaming during an inFlight's inner operations. The host doesn't let the player edit
   * it, and a foreign metadata write on it before its save is a documented residual (it would read as
   * the save and open the P4 window early), so inner operations leave it alone.
   */
  private streaming: string | null = null;
  /** The swipes (`swipeId`) and messages (`null`) this runner deleted, in order: an inFlight follows the plan's swipes through them. */
  private readonly removed: { messageId: string; swipeId: number | null }[] = [];
  /** Chats an earlier build writes (`earlierBuild`). */
  private readonly earlier = new Set<ChatId>();
  /** Chats whose starting markers are journaled as the world writes them: an earlier build's, and their copies. */
  private readonly asWritten = new Set<ChatId>();

  constructor(readonly h: Harness) {}

  async init(): Promise<void> {
    this.current = await this.h.newChat();
    this.chats.push(this.current);
  }

  private messages(chatId = this.current): FakeMessage[] {
    return this.h.host.chat(chatId).messages;
  }

  private assistants(): FakeMessage[] {
    return this.messages().filter((m) => !m.isUser);
  }

  /**
   * The reply a swipe or Continue can be made of: on a host the guard stops generations on, only the
   * last message, when it's a reply (Lumiverse starts only the last reply again, DESIGN §5.1); else the
   * last assistant message.
   */
  private head(): FakeMessage | undefined {
    if (!this.h.host.capabilities.cancel) return this.assistants().at(-1);
    const last = this.messages().at(-1);
    return last && !last.isUser ? last : undefined;
  }

  /** Whether a generation for `messageId` is one the engine refuses: on a host that stops generations, a reply for an earlier message. */
  private refused(messageId: string, chatId = this.current): boolean {
    return this.h.host.capabilities.cancel && this.messages(chatId).at(-1)?.id !== messageId;
  }

  /** Every message's id and swipes, to check a refused reply added or changed none (L47). Its staging may still move the target's selection to its last swipe. */
  private swipesOf(chatId = this.current): string {
    return JSON.stringify(this.messages(chatId).map((m) => [m.id, m.swipes]));
  }

  /** Assistant messages the player (or a foreign writer) can touch now. */
  private editable(): FakeMessage[] {
    return this.assistants().filter((m) => m.id !== this.streaming);
  }

  private users(): FakeMessage[] {
    return this.messages().filter((m) => m.isUser);
  }

  private async state(chatId = this.current): Promise<string> {
    return hashJson((await this.h.folds(chatId)).optimized.state);
  }

  async run(op: Op): Promise<void> {
    const host = this.h.host;
    const chat = this.current;
    switch (op.op) {
      case "send": {
        // Money texts take precedence, so fights never thin out the postings the coverage counts; fights
        // take it over life and queued turns, which would otherwise thin out a fight's turns.
        const text = op.money !== undefined ? pick(MONEY_TEXTS, op.money) : op.fight !== undefined ? pick(FIGHT_TEXTS, op.fight) : op.life !== undefined ? pick(LIFE_TEXTS, op.life) : op.mind !== undefined ? pick(MIND_TEXTS, op.mind) : pick(USER_TEXTS, op.text);
        const u = host.sendUser(chat, text);
        await host.settle();
        const g = await host.start(chat, { type: "normal", createAtEnd: op.createAtEnd });
        const pausesBefore = (await this.h.core(chat)).journal.pauses.length;
        const reply = op.opens !== undefined ? pick(OPENING_REPLIES, op.opens) : op.toll !== undefined ? pick(TOLL_REPLIES, op.toll) : op.mind !== undefined ? pick(MIND_REPLIES, op.reply) : pick(REPLIES, op.reply);
        await host.finish(g, reply, op.rerender ? { rerender: { [u]: `${text} ` } } : {});
        // L6: the host's re-render of the turn's own user message never pauses.
        if (op.rerender && (await this.h.core(chat)).journal.pauses.length > pausesBefore) throw new InvariantError("L6", "a P4 re-render paused the chat");
        return;
      }
      case "regenerate": {
        const target = this.assistants().length > 1 ? pick(this.assistants().slice(1), op.at) : undefined;
        if (!target) return;
        const before = structuredClone((await this.h.core(chat)).journal.messages[target.id]?.ledger);
        const tombstones = structuredClone((await this.h.core(chat)).journal.tombstones);
        this.h.renarrateNext = op.renarrate === true;
        const refused = this.refused(target.id);
        const unchanged = this.swipesOf();
        const g = await host.start(chat, { type: "swipe", messageId: target.id });
        // L47: a reply for an earlier message is refused: nothing is generated and no swipe changes.
        if (refused) {
          this.h.renarrateNext = false;
          if (g.halted !== "cancelled" || this.swipesOf() !== unchanged) throw new InvariantError("L47", "a reply for an earlier message wasn't refused");
          return;
        }
        await host.finish(g, op.opens !== undefined ? pick(OPENING_REPLIES, op.opens) : op.toll !== undefined ? pick(TOLL_REPLIES, op.toll) : pick(REPLIES, op.reply));
        this.h.renarrateNext = false;
        if (op.renarrate) await this.checkRenarrate(chat, target.id, g.swipeId, before, tombstones);
        else await this.checkRerun(chat, target.id, g.swipeId, before, tombstones);
        return;
      }
      case "continue": {
        const all = this.assistants();
        // Lumiverse's Continue continues the last reply, the only one the engine can start again.
        const target = this.h.host.capabilities.cancel ? this.head() : op.at >= 1 ? all.at(-1) : all.length > 0 ? pick(all, op.at) : undefined;
        if (!target) return;
        const isHead = target.id === all.at(-1)?.id;
        const before = await this.h.folds(chat);
        const headRec = (await this.h.core(chat)).journal.messages[target.id]?.ledger.swipes[String(target.swipeId)];
        const reply = pick(REPLIES, op.reply);
        // L15: a Continue, stopped or not, never pauses.
        await this.noPause(async () => {
          const g = await host.start(chat, { type: "continue", messageId: target.id });
          if (op.stop) await host.stop(g, reply.slice(0, Math.max(1, Math.floor(reply.length / 2))));
          else await host.finish(g, reply, op.rerenderPrefix ? { rerenderPrefix: (c) => `${c.slice(0, 3)}~${c.slice(3)}` } : {});
        });
        const landed = this.messages().find((m) => m.id === target.id);
        if (op.stop && !(landed?.swipes[landed.swipeId] ?? "").startsWith(target.swipes[target.swipeId] ?? "")) throw new InvariantError("L15", "a stopped Continue's text did not land on its target");
        const after = await this.h.folds(chat);
        // L14: a Continue that isn't read moves nothing; L13: a head Continue adds only its suffix.
        const read = !op.stop && !op.rerenderPrefix && isHead && headRec !== undefined && headRec.events.length > 0 && !headRec.accepted && !before.optimized.messages.some((m) => m.fold === "paused");
        if (!read && hashJson(after.optimized.state) !== hashJson(before.optimized.state)) throw new InvariantError("L14", "an unread Continue changed the fold");
        if (read) {
          const found = [...reply.matchAll(/\[found:(\d+)\]/g)].reduce((sum, m) => sum + Number(m[1]), 0);
          const cash = (f: typeof after): number => Number(f.optimized.state.entities[POV]?.fields.cash ?? Number.NaN);
          if (cash(after) - cash(before) !== found) throw new InvariantError("L13", `a head Continue moved cash by ${cash(after) - cash(before)}, its suffix says ${found}`);
        }
        return;
      }
      case "editAndSend": {
        const users = this.users();
        if (users.length === 0) return;
        const u = pick(users, op.at);
        const index = this.messages().findIndex((m) => m.id === u.id);
        const next = this.messages()[index + 1];
        if (!next || next.isUser) return;
        let target = chat;
        let userId = u.id;
        let assistantId = next.id;
        if (op.branch) {
          // A branch holding the starting markers journals them as its chat's metadata holds them.
          const inherits = this.asWritten.has(chat) && (await this.h.chain(chat)).slice(0, index + 2).some((m) => m.ledger?.markers.some((mk) => mk.start));
          target = host.branch(chat, next.id);
          this.chats.push(target);
          if (inherits) this.asWritten.add(target);
          const copy = host.chat(target).messages;
          userId = copy[index]?.id ?? "";
          assistantId = copy[index + 1]?.id ?? "";
          this.current = target;
        }
        host.editMessage(target, userId, pick(USER_TEXTS, op.text));
        await host.settle();
        const refused = this.refused(assistantId, target);
        const unchanged = this.swipesOf(target);
        const g = await host.start(target, { type: "swipe", messageId: assistantId });
        if (refused) {
          if (g.halted !== "cancelled" || this.swipesOf(target) !== unchanged) throw new InvariantError("L47", "an Edit and Send for an earlier message wasn't refused");
          return;
        }
        await host.finish(g, pick(REPLIES, op.reply));
        return;
      }
      case "navigate": {
        const target = this.earlierAssistant(op.at);
        if (!target || target.swipes.length < 2) return;
        await this.noPause(async () => {
          host.navigate(chat, target.id, Math.floor(op.swipe * target.swipes.length));
          await host.settle();
        });
        return;
      }
      case "addSwipe": {
        const target = this.earlierAssistant(op.at);
        if (!target) return;
        await this.noPause(async () => {
          host.addSwipe(chat, target.id, pick(EDITS, op.text));
          await host.settle();
        });
        return;
      }
      case "putSwipe": {
        const target = this.editable().length > 0 ? pick(this.editable(), op.at) : undefined;
        if (!target) return;
        await this.keepsWorld(async () => {
          host.putSwipe(chat, target.id, Math.floor(op.swipe * target.swipes.length), pick(EDITS, op.text));
          await host.settle();
        });
        return;
      }
      case "deleteSwipe": {
        const target = this.earlierAssistant(op.at);
        if (!target || target.swipes.length < 2) return;
        const swipeId = Math.floor(op.swipe * target.swipes.length);
        await this.noPause(async () => {
          host.deleteSwipe(chat, target.id, swipeId);
          await host.settle();
        });
        this.removed.push({ messageId: target.id, swipeId });
        return;
      }
      case "editAssistant": {
        const target = this.editable().length > 0 ? pick(this.editable(), op.at) : undefined;
        if (!target) return;
        await this.keepsWorld(async () => {
          host.editMessage(chat, target.id, `${pick(EDITS, op.text)} (${++this.ids})`);
          await host.settle();
        });
        return;
      }
      case "editUser": {
        const users = this.users();
        if (users.length === 0) return;
        const u = pick(users, op.at);
        const core = await this.h.core(chat);
        const index = this.messages().findIndex((m) => m.id === u.id);
        const laterRecord = this.messages()
          .slice(index + 1)
          .some((m) => !m.isUser && core.journal.messages[m.id]?.ledger.swipes[String(m.swipeId)] !== undefined && !this.tombstoned(core.journal.tombstones, m.id));
        const text = `${pick(USER_TEXTS, op.text)} (${++this.ids})`;
        host.editMessage(chat, u.id, text);
        await host.settle();
        // L39: an earlier user edit with later records pauses.
        if (laterRecord && !core.journal.pauses.some((p) => p.messageId === u.id)) throw new InvariantError("L39", "an earlier user edit did not pause");
        return;
      }
      case "deleteMessage": {
        const all = this.messages();
        // Never the reply streaming during an inFlight.
        const candidates = all.slice(1).filter((m) => m.id !== this.streaming);
        if (candidates.length === 0) return;
        const target = pick(candidates, op.at);
        const before = (await this.h.folds(chat)).optimized.state;
        const core = await this.h.core(chat);
        const index = all.findIndex((m) => m.id === target.id);
        const out = (await this.h.folds(chat)).optimized.messages[index];
        // Under a pause the markers had no effect yet, so there is nothing to keep.
        const hadLive = !target.isUser && out?.fold !== "paused" && (core.journal.messages[target.id]?.ledger.markers ?? []).some((mk) => mk.at === null || mk.at === out?.parentPath);
        await this.noPause(async () => {
          host.deleteMessage(chat, target.id);
          await host.settle();
        });
        this.removed.push({ messageId: target.id, swipeId: null });
        // L19: a deleted message's live markers keep their effect (realism and time stay put).
        const after = (await this.h.folds(chat)).optimized.state;
        const laterAssistants = all.slice(index + 1).some((m) => !m.isUser);
        if (hadLive && !laterAssistants && (hashJson(after.realism) !== hashJson(before.realism) || hashJson(after.time) !== hashJson(before.time))) {
          throw new InvariantError("L19", "deleting the latest message dropped its live markers' effect");
        }
        return;
      }
      case "branch": {
        const all = this.messages();
        if (all.length === 0) return;
        const at = pick(all, op.at);
        await this.copy(chat, host.branch(chat, at.id), all.indexOf(at) + 1);
        return;
      }
      case "import":
        await this.copy(chat, host.importCopy(chat), this.messages().length);
        return;
      case "write": {
        const w = await this.writeFor(op);
        if (!w) return;
        await this.h.write(chat, w);
        return;
      }
      case "fixRerun": {
        const head = this.head();
        if (!head || this.assistants().length < 2) return;
        await this.h.write(chat, { kind: "post", id: `w${++this.ids}`, target: "head", entry: { kind: "fix", events: op.open !== undefined ? await this.devCashFix(op.open) : op.life !== undefined ? pick(LIFE_FIXES, op.life) : gmFix(op.gm, op.a) } });
        const core = await this.h.core(chat);
        const before = structuredClone(core.journal.messages[head.id]?.ledger);
        const tombstones = structuredClone(core.journal.tombstones);
        const g = await host.start(chat, { type: "swipe", messageId: head.id });
        await host.finish(g, op.opens !== undefined ? pick(OPENING_REPLIES, op.opens) : pick([...REPLIES, ...TOLL_REPLIES], op.reply));
        await this.checkRerun(chat, head.id, g.swipeId, before, tombstones);
        return;
      }
      case "dryRun": {
        // L34: a preview records nothing.
        const core = await this.h.core(chat);
        const bags = (): string => JSON.stringify(this.messages().map((m) => m.bag));
        const before = JSON.stringify(core.journal) + bags();
        await host.dryRun(chat);
        await host.settle();
        if (JSON.stringify(core.journal) + bags() !== before) throw new InvariantError("L34", "a dry run changed the ledger");
        return;
      }
      case "restart":
        await this.h.restart();
        return;
      case "clobber": {
        const target = this.editable().length > 0 ? pick(this.editable(), op.at) : undefined;
        if (!target) return;
        if (op.echo) host.clobberEcho(chat, target.id, { [LEDGER_NAMESPACE]: { v: 1, swipes: {}, markers: [] } });
        else host.clobberForeign(chat, target.id);
        await host.settle();
        return;
      }
      case "excursion": {
        const target = this.earlierAssistant(op.at);
        if (!target || (await this.h.core(chat)).journal.pauses.length > 0) return;
        const originalIds = this.messages().map((m) => m.id);
        const original = await this.h.folds(chat);
        const originalSwipe = target.swipeId;
        host.addSwipe(chat, target.id, `Another way (${++this.ids}).`);
        await host.settle();
        for (const inner of op.inner) await this.run(inner);
        if (this.current !== chat) return;
        const still = this.messages().find((m) => m.id === target.id);
        if (!still || still.swipes.length <= originalSwipe) return;
        host.navigate(chat, target.id, originalSwipe);
        await host.settle();
        // L2: switching back restores the original fold exactly. A turn made on the switched path
        // stays in the chain as a rebased view after it, so the original messages are compared.
        const ids = this.messages().map((m) => m.id);
        if (originalIds.some((id, i) => ids[i] !== id)) return;
        const back = await this.h.folds(chat, originalIds.length);
        if (hashJson(back.optimized.state) !== hashJson(original.optimized.state)) throw new InvariantError("L2", "switching back did not restore the original fold");
        // A Continue made on the switched path leaves its text (and the head's swipeHash) behind, unsimulated
        // here (residual risk 10), so the path after the head may differ (and with it the parent paths of
        // user messages after the head); folds, and parent paths up to the head, may not.
        const headIndex = original.optimized.messages.findLastIndex((m) => m.fold !== "user");
        const shape = (f: typeof back) => f.optimized.messages.map((m, i) => [m.id, m.fold, i <= headIndex ? m.parentPath : ""]);
        if (hashJson(shape(back)) !== hashJson(shape(original))) throw new InvariantError("L2", "switching back changed how the original messages fold");
        return;
      }
      case "inFlight": {
        const type = op.type < 0.6 ? "normal" : op.type < 0.85 ? "swipe" : "continue";
        let g: Generation;
        let before: { ledger: MessageLedger | undefined; tombstones: Tombstone[] } | null = null;
        if (type === "normal") {
          host.sendUser(chat, op.life !== undefined ? pick(LIFE_TEXTS, op.life) : pick(USER_TEXTS, op.reply));
          await host.settle();
          g = await host.start(chat, { type: "normal" });
        } else {
          const head = this.head();
          if (!head) return;
          const core = await this.h.core(chat);
          if (type === "swipe") before = { ledger: structuredClone(core.journal.messages[head.id]?.ledger), tombstones: structuredClone(core.journal.tombstones) };
          g = await host.start(chat, { type, messageId: head.id });
        }
        // L5: the chain the plan saw, as the reference fold hashes it (L1 checks that hash independently).
        const parentOfTarget = async (): Promise<string | undefined> => {
          const index = this.messages().findIndex((m) => m.id === g.messageId);
          return (await this.h.folds(chat)).reference.messages[index]?.parentPath;
        };
        const planned = await parentOfTarget();
        const plan = this.messages()
          .slice(0, Math.max(0, this.messages().findIndex((m) => m.id === g.messageId)))
          .map((m) => ({ id: m.id, swipeId: m.swipeId }));
        this.removed.length = 0;
        this.streaming = g.messageId ?? null;
        for (const inner of op.inner) {
          if (inner.op === "write") {
            const w = await this.writeFor(inner);
            if (!w) continue;
            const result = await this.h.write(chat, w);
            // L8: inside a window, every write is held.
            if (result.applied) throw new InvariantError("L8", "a write was journaled inside an open window");
          } else {
            await this.run(inner);
          }
        }
        this.streaming = null;
        const changed = type !== "continue" && (await parentOfTarget()) !== planned;
        const reply = op.opens !== undefined ? pick(OPENING_REPLIES, op.opens) : pick(REPLIES, op.reply);
        if (op.stop) await host.stop(g, reply.slice(0, 6));
        else await host.finish(g, reply);
        const inForce = await parentOfTarget();
        const onPlan = changed && g.messageId ? await this.onPlannedChain(chat, g.messageId, plan, planned) : null;
        // A Re-run reads on the chain it was planned on while that still leads to its path, else on the one in force.
        if (before && g.messageId && g.swipeId !== undefined) await this.checkRerun(chat, g.messageId, g.swipeId, before.ledger, before.tombstones, onPlan || !changed ? planned : inForce);
        if (changed) {
          // An unplanned turn (under a pause) holds nothing made on the old chain; it commits where it lands.
          const target = this.messages().find((m) => m.id === g.messageId);
          const rec = target ? (await this.h.core(chat)).journal.messages[target.id]?.ledger.swipes[String(target.swipeId)] : undefined;
          const fold = (await this.h.folds(chat)).optimized.messages.find((m) => m.id === g.messageId)?.fold;
          if (rec && rec.seed !== "" && fold === "on_path") throw new InvariantError("L5", "a turn whose chain changed in flight committed on-path");
          // L5: back on the chain it was planned on, it folds on its path with nothing of it failing.
          const at = onPlan?.out.messages[onPlan.index];
          if (target && rec && rec.seed !== "" && onPlan && at) {
            if (onPlan.shifted) this.coverage.shiftedPlans++;
            const failed = onPlan.out.violations.filter((v) => v.startsWith(`${target.id}:`));
            if (at.fold !== "on_path" || failed.length > 0) throw new InvariantError("L5", `${chat}/${target.id}: on the chain it was planned on, the turn folds ${at.fold}${failed.length > 0 ? `: ${failed.join("; ")}` : ""}`);
          }
        }
        return;
      }
      case "upgrade": {
        const merge = pick<UpgradePicks>([{}, { [POV]: { fields: { cash: "take" } } }, { [POV]: { entity: "keep" } }, { [POV]: { fields: { cash: "keep", mood: "take" } }, dev: { entity: "take" } }], op.picks);
        const before = (await this.h.folds(chat)).reference.state;
        const result = await this.h.write(chat, { kind: "marker", id: `w${++this.ids}`, target: "head", body: { kind: "migrate", to: pick(this.h.revisions, op.to), merge } });
        // L44: an Upgrade never takes a value play changed unless picked (here Sam's cash, which turns change).
        const folds = await this.h.folds(chat);
        const head = folds.reference.messages.findLast((m) => m.fold !== "user");
        const taken = merge[POV]?.fields?.cash === "take";
        if (result.applied && (head?.fold === "on_path" || head?.fold === "plain") && touchedField(before, POV, "cash") && !taken && folds.reference.state.entities[POV]?.fields.cash !== before.entities[POV]?.fields.cash) {
          throw new InvariantError("L44", `${chat}: an Upgrade took Sam's cash, which play changed, without a pick`);
        }
        return;
      }
      case "earlierBuild":
        this.earlier.add(chat);
        return;
    }
  }

  /** The starting markers the harness's chats get, as the world writes them. */
  private raws(): MarkerBody[] {
    const world = this.h.worlds.get(this.h.revision);
    return world ? startMarkersFrom(defaultSettings(), world, this.h.revision) : [];
  }

  /**
   * An earlier build journaled a chat's starting markers as the world writes them (the half-minute
   * tick as 0.5) and hashed its chain with them, though its flush wrote them to metadata clamped
   * (`earlierFlush`). When they land on an `earlierBuild` chat, they are journaled so if they are
   * on its latest message, before anything is hashed with them; otherwise the chat stays as it is.
   */
  async earlierBuildStarts(): Promise<void> {
    for (const chatId of [...this.earlier]) {
      await this.h.service.with(chatId, this.h.host.userId, (core, observed) => {
        const holder = Object.values(core.journal.messages).find((jm) => jm.ledger.markers.some((mk) => mk.start));
        if (!holder) return;
        this.earlier.delete(chatId);
        if (holder !== core.journal.messages[observed.at(-1)?.id ?? ""]) return;
        holder.ledger.markers = writtenStarts(holder.ledger.markers, this.raws());
        holder.flushed = false;
        this.asWritten.add(chatId);
      });
    }
  }

  /**
   * A copy of a chat whose starting markers are journaled as the world writes them: its metadata
   * holds them so once that chat is opened on this build, but an earlier build's flush wrote them
   * clamped. Where a record after them folds on its path (it was hashed with them), the copy gets
   * them clamped, as from that build, and must restore them to fold as its chat does. Says whether
   * the copy holds the starting markers, and whether they were clamped.
   */
  private async earlierFlush(source: ChatId, copy: ChatId, before: Folds): Promise<{ holds: boolean; clamped: boolean }> {
    const chain = await this.h.chain(source);
    const at = chain.findIndex((m, index) => index < before.reference.messages.length && m.ledger?.markers.some((mk) => mk.start));
    if (at < 0) return { holds: false, clamped: false };
    const m = this.h.host.chat(copy).messages[at];
    const ledger = m ? decodeLedger(m.bag) : null;
    if (!m || !ledger || !before.reference.messages.slice(at + 1).some((x) => x.fold === "on_path")) return { holds: true, clamped: false };
    m.bag = encodeLedger(m.bag, { ...ledger, markers: clampedStarts(ledger.markers) });
    this.coverage.earlierCopies++;
    return { holds: true, clamped: true };
  }

  /**
   * L45 for an earlier build's chat as it stands after every operation: a copy made from its
   * metadata as that build flushed it folds every message as the chat does. The copy is dropped again.
   */
  private async earlierCopy(): Promise<void> {
    const source = this.current;
    if (!this.asWritten.has(source)) return;
    const before = await this.h.folds(source);
    if (before.reference.messages.some((m) => m.fold === "paused")) return;
    const host = this.h.host;
    const copy = host.importCopy(source);
    if ((await this.earlierFlush(source, copy, before)).clamped) {
      await this.h.service.open(copy, host.userId);
      await host.settle();
      await this.foldsAlike(source, copy, before);
    }
    this.h.service.forget(copy);
    host.chatsById.delete(copy);
    for (const key of [...host.files.keys()]) if (key.startsWith(`${host.userId}/${runDir(copy)}`)) host.files.delete(key);
  }

  private earlierAssistant(x: number): FakeMessage | undefined {
    const all = this.assistants();
    if (all.length < 2) return undefined;
    return pick(all.slice(0, -1), x);
  }

  private tombstoned(tombstones: readonly { messageId: string }[], messageId: string): boolean {
    return tombstones.some((t) => t.messageId === messageId);
  }

  /**
   * L45: a branch or an import folds every message it copied as its source chat folds them: the
   * same fold, parent paths, paths and state (its metadata is all a copy has to go on). A pause is
   * the source journal's alone, so a paused source isn't compared.
   */
  private async copy(source: ChatId, copy: ChatId, length: number): Promise<void> {
    const before = await this.h.folds(source, length);
    this.chats.push(copy);
    this.current = copy;
    if (this.asWritten.has(source) && (await this.earlierFlush(source, copy, before)).holds) this.asWritten.add(copy);
    await this.h.service.open(copy, this.h.host.userId);
    await this.h.host.settle();
    if (before.reference.messages.some((m) => m.fold === "paused")) return;
    await this.foldsAlike(source, copy, before);
  }

  private async foldsAlike(source: ChatId, copy: ChatId, before: Folds): Promise<void> {
    const after = await this.h.folds(copy);
    // Message ids differ in a copy; paths never include them.
    const was = before.reference.messages.map((m) => [m.fold, m.parentPath, m.path]);
    const now = after.reference.messages.map((m) => [m.fold, m.parentPath, m.path]);
    if (hashJson(now) !== hashJson(was)) throw new InvariantError("L45", `${copy}: the copy of ${source} folds its messages otherwise`);
    if (hashJson(after.reference.state) !== hashJson(before.reference.state)) throw new InvariantError("L45", `${copy}: the copy of ${source} folds to another state`);
  }

  /** L3: switches, swipe changes and removals never pause. */
  private async noPause(step: () => Promise<void>): Promise<void> {
    const core = await this.h.core(this.current);
    const before = core.journal.pauses.length;
    await step();
    if (core.journal.pauses.length > before) throw new InvariantError("L3", "a switch or removal paused the chat");
  }

  /** L38: an assistant edit never changes the fold. */
  private async keepsWorld(step: () => Promise<void>): Promise<void> {
    const before = await this.state();
    await step();
    if ((await this.state()) !== before) throw new InvariantError("L38", "an assistant edit changed the fold");
  }

  /**
   * L11: a Re-narrate folds as its source up to the reply (same seed, `pre` and `markersApplied`);
   * its copies are the source's live fixes and materializations with their seqs, anchored at the
   * new record's path; its `narr` entry takes a fresh seq. It falls back to a Re-run only when the
   * source can't be reproduced (no planned source, a pause, or a `pre` event that no longer validates).
   */
  private async checkRenarrate(chat: ChatId, messageId: string, swipeId: number, before: MessageLedger | undefined, tombstones: Tombstone[]): Promise<void> {
    let source: Rec | undefined;
    for (let s = swipeId - 1; s >= 0 && !source; s--) {
      const rec = before?.swipes[String(s)];
      if (rec && !isTombstoned(tombstones, messageId, rec)) source = rec;
    }
    const core = await this.h.core(chat);
    const made = core.journal.messages[messageId]?.ledger.swipes[String(swipeId)];
    if (!source || !made || source.path === "" || source.seed === "") return;
    const copied = made.seed === source.seed && hashJson(made.events) === hashJson(source.events.slice(0, source.pre)) && made.markersApplied === source.markersApplied && made.pre === source.pre;
    if (!copied) {
      if (core.journal.pauses.length > 0 || made.seed === "") return;
      // A fallback is legitimate only if a source `pre` event fails on the current prefix.
      const chain = toChain(await this.h.host.chats.messages(chat, this.h.host.userId));
      const index = chain.findIndex((m) => m.id === messageId);
      const state = structuredClone(core.fold(chain.slice(0, index)).state);
      const parent = core.fold(chain.slice(0, index)).messages.at(-1)?.path ?? ROOT_PATH;
      for (const mk of [...(before?.markers ?? [])].sort((a, b) => a.seq - b.seq)) if (mk.seq <= source.markersApplied && isLive(mk.at, parent, parent)) applyMarker(state, mk, { worlds: (r) => this.h.worlds.get(r), types: this.h.registry });
      const world = this.h.worlds.get(state.revision);
      if (!world) return;
      for (const ev of source.events.slice(0, source.pre)) {
        const ctx = this.h.registry.context(world, state);
        if (validateEvent(this.h.registry, ev, ctx)) return;
        applyEvent(this.h.registry, ev, state, ctx);
      }
      throw new InvariantError("L11", `${chat}/${messageId}: Re-narrate fell back to a Re-run though its source was reproducible`);
    }
    const sourcePosts = new Map(source.post.map((p) => [p.seq, p]));
    for (const p of made.post) {
      if (p.kind === "narr") {
        if (sourcePosts.has(p.seq) || p.seq <= source.seq) throw new InvariantError("L11", `${chat}/${messageId}: the narr entry reuses an old seq`);
        if (p.at !== made.path) throw new InvariantError("L11", `${chat}/${messageId}: the narr entry is not anchored at the record's path`);
        continue;
      }
      const original = sourcePosts.get(p.seq);
      if (!original || (p.kind !== "fix" && p.kind !== "materialize") || original.kind !== p.kind || strippedFrom(original.events, p.events) === null) throw new InvariantError("L11", `${chat}/${messageId}: post ${p.seq} is not a copy of a source fix or materialization`);
      if (p.at !== made.path) throw new InvariantError("L11", `${chat}/${messageId}: copy ${p.seq} is not anchored at the new parent path`);
    }
    if (made.post.some((p) => p.kind === "cont" || p.kind === "confirm")) throw new InvariantError("L11", `${chat}/${messageId}: a cont or confirm entry was copied`);
  }

  /**
   * The chain a turn was planned on, its swipes followed through what this runner deleted while the
   * reply streamed, folded by the reference fold up to the turn's message. Null once a message or
   * swipe of it is deleted, under a pause, or where it no longer folds to the planned path (a
   * swipe's text replaced).
   */
  private async onPlannedChain(chat: ChatId, messageId: string, plan: readonly { id: string; swipeId: number }[], planned: string | undefined): Promise<{ out: FoldOutput; index: number; shifted: boolean } | null> {
    const swipes = plan.map((e) => ({ ...e }));
    let shifted = false;
    for (const r of this.removed) {
      for (const e of swipes) {
        if (e.id !== r.messageId) continue;
        if (r.swipeId === null || e.swipeId === r.swipeId) return null;
        if (e.swipeId > r.swipeId) {
          e.swipeId--;
          shifted = true;
        }
      }
    }
    const core = await this.h.core(chat);
    const chain = await this.h.chain(chat);
    const index = chain.findIndex((m) => m.id === messageId);
    if (core.journal.pauses.length > 0 || index !== swipes.length || swipes.some((e, i) => chain[i]?.id !== e.id)) return null;
    const rebuilt = chain.slice(0, index + 1).map((m, i) => ({ ...m, swipeId: swipes[i]?.swipeId ?? m.swipeId }));
    const out = referenceFold({ worlds: (r) => this.h.worlds.get(r), revision: this.h.revision, chain: rebuilt, pauses: core.journal.pauses, tombstones: core.journal.tombstones }, this.h.registry);
    return out.messages[index]?.parentPath === planned ? { out, index, shifted } : null;
  }

  /**
   * L43: a Re-run carries the live fixes of the swipe it was made from (the nearest earlier one
   * holding a record): each is on the new record with its seq, events (less a materialization the new
   * swipe already made) and undos, anchored at the record's path, or listed in its `dropped`; nothing
   * else is copied. A turn committed under a pause carries nothing.
   */
  private async checkRerun(chat: ChatId, messageId: string, swipeId: number, before: MessageLedger | undefined, tombstones: Tombstone[], readOn?: string): Promise<void> {
    let source: Rec | undefined;
    for (let s = swipeId - 1; s >= 0 && !source; s--) {
      const rec = before?.swipes[String(s)];
      if (rec && !isTombstoned(tombstones, messageId, rec)) source = rec;
    }
    const core = await this.h.core(chat);
    const made = core.journal.messages[messageId]?.ledger.swipes[String(swipeId)];
    if (!source || !made || made.path === "" || core.journal.pauses.length > 0) return;
    // The fixes in force on the chain the Re-run was read on: the one it was planned on, which its
    // record is anchored at, or, when it streamed while that chain went (the record then reads as
    // read elsewhere), the one in force at the commit.
    const parent = readOn ?? made.path;
    const sourceUndone = source.undone;
    const off = (seq: number, index: number): boolean => sourceUndone.some((u) => u.in === "post" && u.seq === seq && u.index === index);
    const live = source.post.filter((p) => p.kind === "fix" && isLive(p.at, parent, source.path !== "" ? source.path : null) && !p.events.every((_, i) => off(p.seq, i)));
    const copies = made.post.filter((p) => p.seq < made.seq);
    for (const fix of live) {
      const copy = copies.find((p) => p.seq === fix.seq);
      const dropped = made.dropped?.some((d) => d.seq === fix.seq) === true;
      if (!copy && !dropped) throw new InvariantError("L43", `${chat}/${messageId}: the Re-run neither carried nor dropped fix ${fix.seq}`);
      if (copy && dropped) throw new InvariantError("L43", `${chat}/${messageId}: fix ${fix.seq} was both carried and dropped`);
      if (dropped) this.coverage.carryDrops++;
      if (!copy) continue;
      this.coverage.carried++;
      const stripped = copy.kind === "fix" ? strippedFrom(fix.events, copy.events) : null;
      if (!stripped) throw new InvariantError("L43", `${chat}/${messageId}: copy ${fix.seq} differs from its source`);
      if (stripped.length > 0) this.coverage.stripped++;
      if (copy.at !== made.path) throw new InvariantError("L43", `${chat}/${messageId}: copy ${fix.seq} is not anchored at the record's path`);
      // An undo moves up with its event past what left the copy.
      for (const u of sourceUndone) {
        if (u.in !== "post" || u.seq !== fix.seq) continue;
        const moved = { ...u, index: u.index - stripped.filter((s) => s < u.index).length };
        if (!made.undone.some((m) => JSON.stringify(m) === JSON.stringify(moved))) throw new InvariantError("L43", `${chat}/${messageId}: copy ${fix.seq} lost its undo`);
      }
    }
    if (copies.some((p) => !live.some((f) => f.seq === p.seq))) throw new InvariantError("L43", `${chat}/${messageId}: the Re-run copied an entry that isn't a live fix of its source`);
  }

  /**
   * A ✎ cash fix on Dev as the GM view records one (`setField`): while his money isn't open on the
   * head, it opens first and the fix holds that materialization; then a correction out of his account.
   */
  private async devCashFix(x: number): Promise<LedgerEvent[]> {
    const amount = pick([10, 20, 40], x);
    const open = hasOwn((await this.h.folds(this.current)).optimized.state.materialized, "dev:money");
    return [...(open ? [] : [openMoney("dev")]), { type: "post", lines: [{ account: "dev", amount: -amount }, { account: `${EXTERNAL_ACCOUNT_PREFIX}correction`, amount }], memo: "Correction" }];
  }

  private async writeFor(op: Extract<Op, { op: "write" }>): Promise<HeldWrite | null> {
    const id = `w${++this.ids}`;
    if (op.open !== undefined) return { kind: "post", id, target: "head", entry: { kind: "fix", events: await this.devCashFix(op.open) } };
    if (op.gm !== undefined) return { kind: "post", id, target: "head", entry: { kind: "fix", events: gmFix(op.gm, op.a) } };
    if (op.life !== undefined) return { kind: "post", id, target: "head", entry: { kind: "fix", events: pick(LIFE_FIXES, op.life) } };
    if (op.mind !== undefined) return { kind: "post", id, target: "head", entry: { kind: "fix", events: pick(MIND_FIXES, op.mind) } };
    const all = this.messages();
    const k = op.kind;
    if (k < 0.15) return { kind: "post", id, target: "head", entry: { kind: "materialize", events: [{ type: "materialize", entity: POV, domain: "gear", generatorVersion: 1, tablesRevision: "t", events: [{ type: "set", entity: POV, field: "detail", value: `detail-${Math.floor(op.a * 5)}` }] }] } };
    if (k < 0.3) return { kind: "post", id, target: "head", entry: { kind: "fix", events: [{ type: "set", entity: POV, field: "mood", value: pick(["calm", "tense", "happy"], op.a) }] } };
    if (k < 0.42) return { kind: "post", id, target: "head", entry: { kind: "confirm", events: [{ type: "add", entity: POV, field: "cash", delta: Math.floor(op.a * 20) - 5 }] } };
    if (k < 0.62) {
      const bodies: MarkerBody[] = [
        { kind: "resolve", domain: "gear", scope: { all: true }, to: op.b < 0.5 ? 2 : 3 },
        { kind: "time", control: "scale", scope: { all: true }, to: op.b < 0.5 ? 2 : 1 },
        { kind: "migrate", to: pick(this.h.revisions, op.b) },
        { kind: "adjudicate", to: presetAdjudication(op.b < 0.5 ? "narrative" : "balanced") },
      ];
      return { kind: "marker", id, target: "head", body: pick(bodies, op.a) };
    }
    const core = await this.h.core(this.current);
    if (k < 0.72) {
      const pause = core.journal.pauses[0];
      if (pause) return op.a < 0.6 ? { kind: "keep", id, messageId: pause.messageId, parentPath: "", convert: [] } : { kind: "discard", id, after: pause.messageId };
      return null;
    }
    if (k < 0.8) {
      const folds = await this.h.folds(this.current);
      const dropped = folds.optimized.keepReport.find((line) => line.status === "dropped");
      if (!dropped || !("in" in dropped.ref)) return null;
      return { kind: "keep", id, messageId: dropped.messageId, parentPath: dropped.parentPath, convert: [dropped.ref] };
    }
    if (k < 0.85) {
      const users = all.filter((m) => m.isUser);
      const u = users.length > 0 ? pick(users, op.a) : undefined;
      return u ? { kind: "discard", id, after: u.id } : null;
    }
    if (k < 0.89) {
      // An undo chip: one event of an assistant record (planned, read or post) stops folding.
      const withRecords = all.filter((m) => !m.isUser && core.journal.messages[m.id]?.ledger.swipes[String(m.swipeId)] !== undefined);
      const m = withRecords.length > 0 ? pick(withRecords, op.a) : undefined;
      const rec = m ? core.journal.messages[m.id]?.ledger.swipes[String(m.swipeId)] : undefined;
      if (!m || !rec) return null;
      const refs: EventRef[] = [...rec.events.map((_, index): EventRef => ({ in: "events", index })), ...rec.post.flatMap((p) => p.events.map((_, index): EventRef => ({ in: "post", seq: p.seq, index })))];
      if (refs.length === 0) return null;
      return { kind: "undo", id, messageId: m.id, swipeId: m.swipeId, refs: [pick(refs, op.b)] };
    }
    const accepted = all.filter((m) => !m.isUser && core.journal.messages[m.id]?.ledger.swipes[String(m.swipeId)]?.accepted !== undefined);
    const target = accepted.length > 0 ? pick(accepted, op.a) : all.filter((m) => !m.isUser).at(-1);
    if (!target) return null;
    return k < 0.93 ? { kind: "reread", id, messageId: target.id, swipeId: target.swipeId } : { kind: "retry_read", id, messageId: target.id, swipeId: target.swipeId };
  }

  /** Invariants checked after every top-level operation. */
  async check(): Promise<void> {
    if (this.h.service.errors.length > 0) throw new InvariantError("errors", this.h.service.errors.join("\n"));
    for (const chatId of this.chats) {
      const core = await this.h.core(chatId);
      const { reference, optimized, cold, materializedTwice } = await this.h.folds(chatId);
      // L42: a cold fold that starts from the chat's stored snapshots equals the full fold.
      if (hashJson(cold.state) !== hashJson(reference.state) || hashJson(cold.messages) !== hashJson(reference.messages) || hashJson(cold.notes) !== hashJson(reference.notes) || hashJson(cold.keepReport) !== hashJson(reference.keepReport) || hashJson(cold.violations) !== hashJson(reference.violations)) throw new InvariantError("L42", `${chatId}: a snapshot-started fold differs from the full fold`);
      // L1: the optimized fold equals the reference fold.
      if (hashJson(optimized.state) !== hashJson(reference.state)) throw new InvariantError("L1", `${chatId}: state differs`);
      if (hashJson(optimized.messages) !== hashJson(reference.messages)) throw new InvariantError("L1", `${chatId}: message folds differ`);
      if (hashJson(optimized.notes) !== hashJson(reference.notes) || hashJson(optimized.keepReport) !== hashJson(reference.keepReport)) throw new InvariantError("L1", `${chatId}: notes or Keep report differ`);
      // L7: on-path entries re-validate.
      if (reference.violations.length > 0) throw new InvariantError("L7", reference.violations.join("; "));
      // L40: no own account folds below zero, on any path; a rebased view drops what
      // fails against its new parent, and every drop has its Keep line (and its note).
      // A Keep "convert to manual adjustment" is the player's explicit override, so only it may leave an account short.
      const converted = reference.keepReport.some((k) => k.status === "converted");
      for (const [account, balance] of Object.entries(reference.state.accounts)) {
        if (!converted && !account.startsWith(EXTERNAL_ACCOUNT_PREFIX) && balance < 0) throw new InvariantError("L40", `${chatId}: ${account} folded to ${balance}`);
      }
      // L46: an entity's detail in a domain is materialized at most once on any path (a Keep
      // conversion is again the player's override).
      if (!converted && materializedTwice.length > 0) throw new InvariantError("L46", `${chatId}: ${materializedTwice.join(", ")} materialized twice`);
      const droppedNotes = new Set(reference.notes.filter((n) => n.kind === "dropped").map((n) => `${n.messageId}:${JSON.stringify(n.ref)}`));
      const droppedKeep = new Set(reference.keepReport.filter((k) => k.status === "dropped").map((k) => `${k.messageId}:${JSON.stringify(k.ref)}`));
      if ([...droppedNotes].some((k) => !droppedKeep.has(k)) || [...droppedKeep].some((k) => !droppedNotes.has(k))) throw new InvariantError("L40", `${chatId}: dropped notes and Keep lines differ`);
      if (reference.keepReport.some((k) => k.status === "dropped" && k.text.includes("can't cover"))) this.coverage.fundsDrops++;
      // L41: a group lands whole: within one record list, a unit of grouped events is dropped
      // entirely or not at all on a rebased view.
      const chain = await this.h.chain(chatId);
      const droppedRefs = new Set(reference.keepReport.filter((k) => k.status === "dropped").map((k) => `${k.messageId}:${JSON.stringify(k.ref)}`));
      for (const m of chain) {
        const rec = m.ledger?.swipes[String(m.swipeId)];
        if (m.isUser || !rec) continue;
        for (const e of rec.events) {
          const counted = Object.hasOwn(FIGHT_EVENTS, e.type) ? FIGHT_EVENTS[e.type] : undefined;
          if (counted) this.coverage.fights[counted]++;
          const life = Object.hasOwn(LIFE_EVENTS, e.type) ? LIFE_EVENTS[e.type] : undefined;
          if (life) this.coverage.lives[life]++;
        }
        for (const e of [...rec.events, ...rec.post.flatMap((p) => p.events)]) {
          const mind = Object.hasOwn(MIND_EVENTS, e.type) ? MIND_EVENTS[e.type] : undefined;
          if (mind) this.coverage.minds[mind]++;
        }
        const lists: { events: LedgerEvent[]; ref: (index: number) => EventRef }[] = [{ events: rec.events, ref: (index) => ({ in: "events", index }) }, ...rec.post.map((p) => ({ events: p.events, ref: (index: number): EventRef => ({ in: "post", seq: p.seq, index }) }))];
        for (const list of lists) {
          for (const [from, to] of eventUnits(list.events)) {
            if (to - from < 2) continue;
            const members = Array.from({ length: to - from }, (_, k) => list.ref(from + k)).filter((ref) => !rec.undone.some((u) => JSON.stringify(u) === JSON.stringify(ref)));
            const dropped = members.filter((ref) => droppedRefs.has(`${m.id}:${JSON.stringify(ref)}`)).length;
            if (dropped > 0 && dropped < members.length) throw new InvariantError("L41", `${chatId}/${m.id}: a group was partly dropped`);
            if (dropped > 0) this.coverage.groupDrops++;
          }
        }
      }
      // L16: every stored entry that isn't live, and every tombstoned record, has a Journal note.
      const noted = new Set(reference.notes.map((n) => `${n.kind}:${n.messageId}:${JSON.stringify(n.ref)}`));
      for (const [i, r] of reference.messages.entries()) {
        const m = chain[i];
        if (!m || m.isUser || r.fold === "paused") continue;
        const stored = m.ledger?.swipes[String(m.swipeId)];
        const dead = stored !== undefined && core.journal.tombstones.some((t) => t.messageId === m.id && t.recHash === hashJson(stored));
        if (dead && !noted.has(`tombstoned:${m.id}:null`)) throw new InvariantError("L16", `${chatId}/${m.id}: a tombstoned record has no note`);
        const rec = dead ? undefined : stored;
        const turn = rec && rec.path !== "" ? rec.path : null;
        const live = (at: string | null): boolean => at === null || at === r.parentPath || (turn !== null && at === turn);
        for (const mk of m.ledger?.markers ?? []) {
          if (!live(mk.at) && !noted.has(`inert:${m.id}:${JSON.stringify({ marker: mk.seq })}`)) throw new InvariantError("L16", `${chatId}/${m.id}: inert marker ${mk.seq} has no note`);
        }
        for (const p of rec?.post ?? []) {
          if (!live(p.at) && !noted.has(`inert:${m.id}:${JSON.stringify({ in: "post", seq: p.seq, index: 0 })}`)) throw new InvariantError("L16", `${chatId}/${m.id}: inert post ${p.seq} has no note`);
        }
      }
      if (core.journal.windows.length > 0) throw new InvariantError("P2", `${chatId}: a window is still open between operations`);
      const memory = this.memory.get(chatId) ?? { start: null, maxSeq: 0, tombstones: 0 };
      // L9: seq never decreases and never names two different entries (a Re-narrate copy keeps its source's seq, P3).
      if (core.journal.seq < memory.maxSeq) throw new InvariantError("L9", `${chatId}: seq went back from ${memory.maxSeq} to ${core.journal.seq}`);
      const seqs = new Map<number, string>();
      const claim = (seq: number, what: string): void => {
        const prior = seqs.get(seq);
        if (prior !== undefined && (prior !== what || !what.startsWith("post:"))) throw new InvariantError("L9", `${chatId}: seq ${seq} is used twice`);
        seqs.set(seq, what);
      };
      const starts: Marker[] = [];
      for (const [mid, jm] of Object.entries(core.journal.messages)) {
        for (const mk of jm.ledger.markers) {
          claim(mk.seq, `marker:${mid}:${mk.seq}`);
          if (mk.start) starts.push(mk);
        }
        for (const [swipe, rec] of Object.entries(jm.ledger.swipes)) {
          claim(rec.seq, `rec:${mid}:${swipe}`);
          // A carried copy may leave out a materialization its new prefix already records (L46).
          for (const p of rec.post) claim(p.seq, `post:${mid}:${p.kind}:${hashJson(p.events.filter((e) => e.type !== "materialize"))}`);
        }
      }
      if ([...seqs.keys()].some((s) => s > core.journal.seq)) throw new InvariantError("L9", `${chatId}: a seq above the counter`);
      // L20: one set of starting markers per chat, never changed once written, each journaled as the
      // marker check gives it, so the chain hashes the values that fold (a world's half-minute tick);
      // a chat an earlier build started, and its copies, keep them as it journaled them.
      const start = starts.length > 0 ? hashJson([...starts].sort((a, b) => a.seq - b.seq)) : null;
      if (memory.start !== null && start !== null && start !== memory.start) throw new InvariantError("L20", `${chatId}: the starting markers changed`);
      const raws = this.asWritten.has(chatId) ? this.raws() : null;
      for (const mk of starts) {
        const want = raws ? writtenStarts([mk], raws)[0] : clampedStarts([mk])[0];
        if (hashJson(want) !== hashJson(mk)) throw new InvariantError("L20", `${chatId}: starting marker ${mk.seq} is journaled ${raws ? "clamped, though its chain was hashed as the world writes it" : "unclamped"}`);
      }
      // L17: tombstones are never forgotten.
      if (core.journal.tombstones.length < memory.tombstones) throw new InvariantError("L17", `${chatId}: a tombstone was forgotten`);
      // L18: with no turn in flight, metadata mirrors the journal.
      for (const m of this.h.host.chat(chatId).messages) {
        const jm = core.journal.messages[m.id];
        if (jm && JSON.stringify(decodeLedger(m.bag)) !== JSON.stringify(jm.ledger)) throw new InvariantError("L18", `${chatId}/${m.id}: metadata differs from the journal`);
      }
      this.memory.set(chatId, { start: memory.start ?? start, maxSeq: core.journal.seq, tombstones: core.journal.tombstones.length });
    }
    await this.earlierCopy();
  }
}

// ------------------------------------------------------------------ sequences and shrinking

/**
 * Runs a sequence, checking every invariant after each operation; returns the first failure.
 * With `digest`, appends each chat's final journal, messages and fold (L31 compares two runs).
 */
export async function runSequence(make: () => Harness, ops: Op[], digest?: string[], coverage?: Coverage): Promise<string | null> {
  const runner = new Runner(make());
  await runner.init();
  try {
    for (const op of ops) {
      await runner.run(op);
      await runner.earlierBuildStarts();
      await runner.check();
    }
    if (digest) {
      for (const chatId of runner.chats) {
        const core = await runner.h.core(chatId);
        const folds = await runner.h.folds(chatId);
        digest.push(JSON.stringify(core.journal) + JSON.stringify(runner.h.host.chat(chatId).messages) + hashJson(folds.optimized.state));
      }
    }
    if (coverage) {
      coverage.fundsDrops += runner.coverage.fundsDrops;
      coverage.groupDrops += runner.coverage.groupDrops;
      coverage.carried += runner.coverage.carried;
      coverage.carryDrops += runner.coverage.carryDrops;
      coverage.stripped += runner.coverage.stripped;
      coverage.earlierCopies += runner.coverage.earlierCopies;
      coverage.shiftedPlans += runner.coverage.shiftedPlans;
      for (const k of ["start", "act", "turn", "end"] as const) coverage.fights[k] += runner.coverage.fights[k];
      for (const k of ["life", "told"] as const) coverage.lives[k] += runner.coverage.lives[k];
      for (const k of ["mind", "memory", "presence", "fix"] as const) coverage.minds[k] += runner.coverage.minds[k];
      for (const k of ["queued", "check", "failure", "interruption"] as const) coverage.queues[k] += runner.h.plays[k];
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Delta debugging: drops chunks of operations while the sequence still fails. */
export async function shrink(make: () => Harness, ops: Op[], failure: string, budget = 400): Promise<{ ops: Op[]; error: string }> {
  let current = ops;
  let error = failure;
  let chunk = Math.max(1, Math.floor(current.length / 2));
  let attempts = 0;
  while (chunk >= 1 && attempts < budget) {
    let progressed = false;
    for (let i = 0; i < current.length && attempts < budget; i += chunk) {
      const candidate = [...current.slice(0, i), ...current.slice(i + chunk)];
      attempts++;
      const result = await runSequence(make, candidate);
      if (result && result.split(":")[0] === error.split(":")[0]) {
        current = candidate;
        error = result;
        progressed = true;
        i -= chunk;
      }
    }
    if (!progressed) chunk = Math.floor(chunk / 2);
  }
  return { ops: current, error };
}

export function sequenceFor(seed: string, maxLength: number): Op[] {
  const rng = createRng(seed);
  return generate(rng, 1 + Math.floor(rng.next() * maxLength));
}

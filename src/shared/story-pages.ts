// What the story engine's pages ask of the backend and are answered with (DEPTH2-PLAN §1, §4): the
// Harness tab's Cast and Record (`lre.story`), the prepared start on Play → Now (`lre.prepare`), and
// what Settings → The story's budget shows of the open chat. GM-level, like `lre.gm`: asked for when
// a page opens, never pushed. Every id a view names (a person, "player" for the player's character,
// a place) has its name in the view's `names`, so a page needs no other read to say who and where;
// "world" is the world itself. Story time comes as the engine keeps the clock (`at`) and in words in
// the world's calendar (`text`).

import type { BeatKind, BeatReach, CastStanding, DraftState, DraftTier } from "./ledger";

/** Names for the ids a view mentions, as the world names them now. */
export type StoryNames = Record<string, string>;

/** A moment of story time. */
export interface StoryTime {
  at: number;
  text: string;
}

/** A reply on the chat's path, by its message and the swipe it shows. */
export interface StoryAt {
  messageId: string;
  swipeId: number;
}

// ---------------------------------------------------------------- Cast

/** Someone in the story: how the author cast them and why, the player's pin, and their mind. */
export interface CastRowView {
  /** An entity's id; "player" for the player's character. */
  entity: string;
  /** As cast; an extra where never cast. */
  standing: CastStanding;
  why: string | null;
  pinned: boolean;
  /** The folder of their mind in the chat's workspace (`minds/<id>/`): a principal's mind, a supporting character's profile, the player's character's mind; null for an extra, who has none. */
  mind: string | null;
  /** The last beat their mind took in and when it happened; null where it has taken in none. */
  digested: { beat: string; time: StoryTime } | null;
  /** How many beats reached them that their mind hasn't taken in yet. */
  waiting: number;
}

/** `lre.story cast` and `pin`: everyone the story names (the cast, and anyone a beat on the path names), the player's character first. */
export interface CastView {
  cast: CastRowView[];
  names: StoryNames;
}

/** One beat as it reached a person, as their character's agent is given it, and whether their mind has taken it in. */
export type ReachedItem = { beat: string; time: StoryTime; where: string | null; digested: boolean } & ({ reach: "whole"; by: string; surface: string; quotes?: string[] } | { reach: "part" | "told"; got: string; from?: string } | { reach: "own"; kind: BeatKind; what: string; quotes?: string[] });

/** `lre.story reached`: the newest beats that reached a person, oldest first, and how many older ones aren't shown. */
export interface ReachedView {
  entity: string;
  items: ReachedItem[];
  more: number;
  names: StoryNames;
}

// ---------------------------------------------------------------- the record

/** Whom a beat reached, and how fully. */
export interface ExposureView {
  who: string;
  reach: BeatReach;
  /** What they got of it, in their terms (part, told). */
  got: string | null;
  /** Who told them (told). */
  from: string | null;
}

/** One beat as the record shows it. */
export interface BeatView {
  id: string;
  kind: BeatKind;
  time: StoryTime;
  where: string | null;
  /** An entity's id, "player" or "world". */
  by: string;
  /** The event as true. */
  what: string;
  /** What someone present could sense of it. */
  surface: string;
  quotes: string[];
  to: string[];
  exposure: ExposureView[];
  /** The agent that decided it (its definition's id: author, game_master, character, narrator, historian) and whom it ran as. */
  decidedBy: { agent: string; as: string | null };
  /** The draft it settles. */
  settles: string | null;
  /** Why it no longer stands. */
  struck: string | null;
  /** Recorded afterwards from the chat's past, while the story was prepared. */
  past: boolean;
}

/** A reply on the path whose turn wrote beats, for the record's picker. */
export interface RecordReply extends StoryAt {
  beats: number;
  /** When its first beat happened. */
  time: StoryTime | null;
  /** The chat's newest reply. */
  latest: boolean;
}

/** Off-screen work kept until the story needs it, as it stands on the path. */
export interface DraftView {
  id: string;
  what: string;
  tier: DraftTier;
  who: string[];
  where: string[];
  time: StoryTime;
  state: DraftState;
  notes: string | null;
  basis: StoryAt;
}

/** `lre.story record`: one reply's beats in the order written, every reply that has some, and the drafts on the path. */
export interface RecordView {
  /** The reply shown: the one asked for, else the newest on the path whose turn wrote beats; null where none has. */
  at: StoryAt | null;
  beats: BeatView[];
  /** Newest first. */
  replies: RecordReply[];
  drafts: DraftView[];
  names: StoryNames;
}

// ---------------------------------------------------------------- the budget

/** `lre.story budget`: the treatments counted around the story's time now, as `draft_open` counts them (within one stretch either side). */
export interface BudgetUseView {
  now: StoryTime | null;
  used: { t1: number; t2: number; t3: number };
}

/** The reads and acts of `lre.story`. */
export type StoryAsk = { op: "cast" } | { op: "pin"; entity: string; standing: CastStanding | null } | { op: "reached"; entity: string } | { op: "record"; at?: StoryAt } | { op: "budget" };

/** What each op of `lre.story` is answered with. */
export interface StoryAnswer {
  cast?: CastView;
  reached?: ReachedView;
  record?: RecordView;
  budget?: BudgetUseView;
}

// ---------------------------------------------------------------- the prepared start

/** Where the prepared start stands: not started; the author planning (its job under way, no plan yet); revising its plan with what the player said; its plan waiting for the player's word; under way; held, or stopped before it finished (resume carries it on from its file); finished; cancelled by the player; failed; out of reach, the runtime not linked or the chat not moved to it (the note says what to do). */
export type PrepareState = "none" | "planning" | "revising" | "waiting" | "running" | "paused" | "done" | "cancelled" | "failed" | "unreachable";

/** One stretch of the chat's past the plan relives: its messages by number in the chat, why, who relives it, and how far it has come. */
export interface PrepareStretchView {
  id: string;
  from: number;
  to: number;
  why: string;
  /** The principals who relive it, by entity id. */
  who: string[];
  /** planned; open (the historian records it); recorded (the principals it reached relive it); dropped (filled from summaries instead). */
  state: "planned" | "open" | "recorded" | "dropped";
  /** Beats recorded of it so far. */
  beats: number;
  /** One of the moments that made the story what it is, as the author marked it. */
  key: boolean;
  /** Within the depth the preparation goes to: a planned stretch outside it isn't relived unless the player raises the depth. */
  chosen: boolean;
}

/** How deep a preparation goes, the player's pick: what each principal knows in outline alone (nothing relived), those and the key moments relived, or every stretch of the plan. */
export type PrepareDepth = "outline" | "key" | "all";
export const PREPARE_DEPTHS: readonly PrepareDepth[] = ["outline", "key", "all"];

/** Where the weight of one model call of a preparation was measured: its own calls, this chat's last author run, or nowhere yet (the setting for a call not yet measured). */
export type PrepareCallFrom = "job" | "chat" | "default";

/** The author's plan, as `author/prepare.md` holds it. */
export interface PreparePlan {
  /** What the story is, as the author reads it. */
  story: string;
  /** Who the author casts as principals, and why. */
  principals: { entity: string; why: string }[];
  stretches: PrepareStretchView[];
  /** What is filled from summaries and lore, not relived; null where the author said nothing. */
  summaries: string | null;
  /** The author's own estimate of the whole preparation, in tokens: the view's estimate is the larger of it and the engine's. */
  authorEstimate: number;
  /** The engine's reckoning of the whole preparation when the plan was written, in tokens: what it had spent, and what was left at what one model call weighs, the author's own work included. */
  reckoned: number;
  /** What one model call was reckoned to weigh, in tokens, and where that was measured; null for a plan written before the weight was kept. */
  call: { tokens: number; from: PrepareCallFrom } | null;
  /** The player's ceiling when the plan was written: a plan whose whole is reckoned above it waits for their word. */
  ceiling: number;
  /** Each depth the plan offers, with what the whole preparation is reckoned at going that deep, the author's own work included: outlines only, key moments where some stretch is one, everything planned where there is a stretch. */
  depths: { depth: PrepareDepth; tokens: number }[];
  /** The depth the author recommends, and why, in a sentence. */
  recommended: { depth: PrepareDepth; why: string };
  /** The depth it goes to: the player's pick, else the author's recommendation. */
  depth: PrepareDepth;
}

/** Something the player said to the preparation, as the card shows it: what became of it, and the author's own answer once it gave one. */
export interface PrepareSaidView {
  text: string;
  /** What is happening to it, or happened, in the card's words. */
  status: string;
  /** The author's answer: what it changed for it, in its own words; null until it gave one. */
  answer: string | null;
}

/** `lre.prepare`, every op: the chat's prepared start as it stands after it. */
export interface PrepareView {
  /** Why the page offers to start it, in a line (a chat with a history, a new chat); null where it isn't offered. */
  offer: string | null;
  state: PrepareState;
  plan: PreparePlan | null;
  /** What the whole preparation is reckoned at, in tokens, the author's own work included: what the player's ceiling is held to; null before there is a plan. */
  estimate: number | null;
  /** What preparing has spent so far, in tokens, as LumiAH counts it: every job of it, while one runs and once it stopped. What the cap is held to. */
  spent: number;
  /** The most the whole preparation may spend, the player's cap: no moment is relived past it; null: none. */
  cap: number | null;
  /** What the player said to it, oldest first, each with what became of it. */
  steered: PrepareSaidView[];
  /** What isn't prepared yet, a line each, for a chat played meanwhile; empty once everything is. */
  notYet: string[];
  /** Why it waits, failed, stopped or can't be reached, in words. */
  note: string | null;
  names: StoryNames;
}

/** The reads and acts of `lre.prepare`. `start` may carry what the player says first (`about`: what the story is about and who matters), which goes to the author with the start as their word; `approve` may name the depth the player picks (else the author's recommendation); `depth` changes it later, and a deeper one carries the preparation on with the stretches it adds; `restart` plans afresh, keeping what was recorded. */
export type PrepareAsk = { op: "get" | "pause" | "resume" | "cancel" | "restart" } | { op: "start"; about?: string } | { op: "approve"; depth?: PrepareDepth } | { op: "depth"; depth: PrepareDepth } | { op: "steer"; text: string } | { op: "cap"; tokens: number | null };

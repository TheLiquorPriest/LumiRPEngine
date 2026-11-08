// The depth views' contract (DEPTH-PLAN §7; A1e): what GM → Minds, Notebook, Archive, Drafts and
// Treatments ask the backend for (`lre.depth`) and what each answer holds; the Bootstrap view and the
// opt-in read `lre.bootstrap` (`shared/bootstrap.ts`). Every view is the player's to read: nothing
// here is gated or withheld (§1.4, D-9); a mind, the notebook, a beat's exposure, every draft and
// treatment and every reasoning show as they are. Story times arrive as words the backend wrote in
// the world's calendar, so the views never compute a clock. Pure types and a few pure helpers the
// views and tests share.

import type { StageCounts } from "./bootstrap";
import type { InterviewAsker } from "./character-engine";
import type { DepthRole, DepthThresholdLevel, DepthTreatment } from "./depth-settings";
import type { ChatId, EntityId, MessageId, PlaceId } from "./ids";
import type { DepthSceneView } from "./scene-view";

/** Who decided how a character played a scene (§4.4): its own agent, the author playing it, or handled as world. */
export type DepthEffort = "agent" | "author" | "world";

export const DEPTH_EFFORT_LABEL: Readonly<Record<DepthEffort, string>> = Object.freeze({
  agent: "Its own agent",
  author: "Played by the author",
  world: "Handled as world",
});

/** The mode a mind write came from (§4.4), or the user's own edit, which is pinned. */
export type DepthWriteMode = "play" | "remember" | "catch-up" | "reflect" | "interview" | "seed" | "user";

export const DEPTH_WRITE_LABEL: Readonly<Record<DepthWriteMode, string>> = Object.freeze({
  play: "While playing",
  remember: "Remembering",
  "catch-up": "Catching up",
  reflect: "Reflecting",
  interview: "Interview",
  seed: "Seeded",
  user: "Your edit",
});

/** A beat a write or a point of view cites, as the views name it. */
export interface DepthBeatRef {
  id: string;
  /** The beat in a line: who did what ("Mira pockets the letter"). */
  label: string;
  /** The message it came from, for a jump to it, and its number in the chat as the chat shows it (its #N, from 0). */
  messageId?: MessageId;
  index?: number;
}

/** One character with a mind, in the Minds list. */
export interface DepthMindRow {
  id: EntityId;
  name: string;
  /** Mind files written so far. */
  files: number;
  /** The newest write, by its file and story time in words. */
  last: { path: string; at: string } | null;
  /** Points of view it received and hasn't lived yet (a catch-up waiting). */
  pending: number;
  /** The effort it played its latest scene at. */
  effort: DepthEffort | null;
  /** Its core was written from the history, not a card or an entry, and waits for your review (D-17). */
  review: boolean;
}

/** GM → Minds: every character with a mind, and whose point of view the player drives (D-10; Play as isn't supported yet). */
export interface DepthMindsView {
  /** Whether the chat runs on depth (GM → This chat → Depth). */
  on: boolean;
  /** The player character: the player drives him; he has no agent (D-10). */
  pov: { id: EntityId; name: string } | null;
  characters: DepthMindRow[];
}

/** One mind file (§4.4: core.md, self.md, now.md, on-my-mind.md, memories/<id>.md, beliefs.md, people/<who>.md, plans.md). */
export interface DepthMindFile {
  path: string;
  text: string;
  /** Text you edited: its agent may remark on it but never rewrites it (§7). */
  pinned: boolean;
  /** How many times it was written. */
  revisions: number;
  /** When it was last written, in story time words. */
  at: string | null;
  /** Out of its mind and recall (`writtenFromGone`): its latest write drew on a beat an amendment or a strike replaced, and no catch-up has kept or rewritten it since; one asked twice for a verdict stays so (§4.2, Retcons propagate). */
  out?: true;
  /** A seeded core waiting for your review (D-17): from the history, an imported entry, World Info, or what the world knew of someone met in play. Keeping it as it is, or your edit, clears it. */
  review?: true;
}

/** One write to a mind (`minds.v2.write`), newest first: what its agent wrote, why, and the beats it lived. */
export interface DepthMindWrite {
  id: string;
  path: string;
  at: string;
  mode: DepthWriteMode;
  /** The agent's own reasoning for the write, whole. */
  reasoning: string;
  /** The text as it was written. */
  text: string;
  /** The text it replaced, for a diff; null for a new file. */
  before: string | null;
  lived: DepthBeatRef[];
  /** A write an amended beat's catch-up replaced. */
  superseded?: boolean;
}

/** A belief beside the truth (§4.4): the GM's link, out of world. */
export interface DepthBeliefLink {
  belief: string;
  /** The world-truth fact it is linked to, in words; null while unlinked. */
  truth: string | null;
  verdict: "true" | "false" | "partly" | "unlinked";
  why: string;
}

/** A point of view the character received (§4.2), or one still pending. */
export interface DepthPov {
  beat: DepthBeatRef;
  at: string;
  /** Whole: it perceived the beat whole; part: its own render of a partial reach. */
  reach: "whole" | "part";
  text: string;
  pending: boolean;
}

/** A take the character hasn't remembered yet (§4.4, `minds.v2.take`): its private working memory of the scene, which its next plays read, until it remembers the scene. */
export interface DepthMindTake {
  at: string;
  text: string;
  /** The act it played with this take; null where it let the moment pass. */
  beat: DepthBeatRef | null;
  /** The beats it had just lived as it took the moment in. */
  lived: DepthBeatRef[];
}

/** Who asked an interview, as GM → Minds says it: GM mode (yours, from the Interview tab), the author or the player. */
export const DEPTH_ASKER_LABEL: Readonly<Record<InterviewAsker, string>> = Object.freeze({ gm: "Asked in GM mode", author: "Asked by the author", player: "Asked by you" });

/** One interview (§4.4), as the record keeps it: the question and the answer in voice, kept as a probe apart from the mind unless marked neutral to the world, when the answer joined the mind. */
export interface DepthProbe {
  at: string;
  by: InterviewAsker;
  question: string;
  answer: string;
  neutral: boolean;
}

/** GM → Minds → one character: its files, every write, its working memory, beliefs beside the truth, points of view, efforts and every interview. */
export interface DepthMindView {
  id: EntityId;
  name: string;
  files: DepthMindFile[];
  writes: DepthMindWrite[];
  /** Its takes not yet remembered, in the order it played them. */
  takes: DepthMindTake[];
  beliefs: DepthBeliefLink[];
  povs: DepthPov[];
  /** The effort it played at, scene by scene, newest first, with the author's reason. */
  efforts: { scene: string; at: string; effort: DepthEffort; why: string }[];
  /** Every interview on the chain, newest first. */
  interviews: DepthProbe[];
}

/** An interview's answer (§4.4): in voice; folded into the mind only when marked neutral to the world. */
export interface DepthInterview {
  answer: string;
  folded: boolean;
}

/** The depth of a notebook revision (§4.5), or the player's own edit. */
export type DepthRevisionKind = "light" | "scene" | "chapter" | "user";

export const DEPTH_REVISION_LABEL: Readonly<Record<DepthRevisionKind, string>> = Object.freeze({
  light: "Light touch",
  scene: "Scene's end",
  chapter: "Chapter re-read",
  user: "Your edit",
});

/** One revision of a notebook file, with the reasoning that produced it (§4.5). */
export interface DepthRevision {
  id: string;
  path: string;
  at: string;
  kind: DepthRevisionKind;
  reasoning: string;
  before: string;
  after: string;
}

/** One job a poll asked for (§6.4): its kind, whom or what (a character's name, the author's own reflection, an episode's or a draft's words) and why. */
export interface DepthPollJob {
  kind: "catchup" | "reflect" | "author.reflect" | "episode" | "settle" | "drop" | "rebase";
  subject: string;
  why: string;
}

export const DEPTH_POLL_JOB_LABEL: Readonly<Record<DepthPollJob["kind"], string>> = Object.freeze({ catchup: "Catches up", reflect: "Reflects", "author.reflect": "The author reflects", episode: "Episode off screen", settle: "Settle", drop: "Drop", rebase: "Rebase" });

/** One poll after a turn (§6.4): what it considered and whether it raised it, the jobs it asked for, its account and the author's whole reasoning. */
export interface DepthPoll {
  at: string;
  considered: { what: string; raised: boolean; why: string }[];
  jobs: DepthPollJob[];
  /** The author's short account of the poll, where it gave one. */
  note: string;
  /** The author's thinking as it polled, where it was kept. */
  reasoning: string;
}

/** GM → Notebook: the author's files, revisions, every poll and its predictions (§4.5, §6.4). */
export interface DepthNotebookView {
  on: boolean;
  files: { path: string; text: string; pinned: boolean; revisions: number }[];
  revisions: DepthRevision[];
  /** Every poll on the chain, newest first. */
  poll: DepthPoll[];
  predictions: { at: string; text: string; outcome: "pending" | "hit" | "miss" | "partly"; note: string }[];
}

/** An archive search (§4.3): by text, person, place or story time (words the world's calendar reads: "3 May", "the 14th"); a page from `offset`. */
export interface DepthArchiveQuery {
  text?: string;
  who?: EntityId;
  place?: PlaceId;
  from?: string;
  to?: string;
  offset?: number;
}

/** One hit: the message, its place in the chat and story, and the passage that matched. */
export interface DepthArchiveHit {
  messageId: MessageId;
  /** The message's number in the chat as the chat shows it (its #N, from 0). */
  index: number;
  isUser: boolean;
  swipeId: number;
  /** Its story time in the world's calendar; null when unknown. */
  at: string | null;
  places: string[];
  /** The people of the live beats citing it: actors, addressed and exposed, by name. */
  people: string[];
  snippet: string;
  /** Live beats that cite this message. */
  beats: number;
}

export interface DepthArchiveResult {
  hits: DepthArchiveHit[];
  /** The offset of the next page, or null on the last. */
  next: number | null;
  /** A story time the calendar couldn't read, said back. */
  unread: string[];
}

/** A place in the chat a record rides at: its message, and that message's number in the chat as the chat shows it (its #N, from 0). */
export interface DepthAt {
  messageId: MessageId;
  index: number;
}

/** A draft's state on this chat's chain (§4.6): settled where a live settlement cites it, dropped where a live drop does, else open. */
export type DepthDraftState = "open" | "settled" | "dropped";

export const DEPTH_DRAFT_STATE_LABEL: Readonly<Record<DepthDraftState, string>> = Object.freeze({ open: "Open", settled: "Settled", dropped: "Dropped" });

/** An episode's part as the views show it (§4.6): whom or what, its treatment, and the author's grade with its reason. */
export interface DepthPart {
  subject: string;
  treatment: DepthTreatment;
  rationale: string;
}

/** One of a draft's beats, dated when it happens in the story. */
export interface DepthDraftBeat {
  at: string;
  what: string;
  surface: string;
  quotes?: string;
  /** Who perceived it, by name, "(in part)" where their reach was partial. */
  perceived: string[];
}

/** GM → Depth → Drafts: one draft on this chat's chain, whole (§4.6, §7). */
export interface DepthDraft {
  id: string;
  state: DepthDraftState;
  /** What it read that has changed since it was drafted (someone's mind, the notebook): an open draft with any reads stale to the author. */
  changed: string[];
  summary: string;
  /** When it happens (its first beat's minute), and the episode's span, in words. */
  at: string;
  span: string;
  places: string[];
  people: string[];
  why: string;
  parts: DepthPart[];
  beats: DepthDraftBeat[];
  /** The world changes it would make, in words. */
  effects: string[];
  /** Whom and what it holds, and from when. */
  holds: string[];
  /** The reply it was drafted at (its basis). */
  basis: DepthAt;
  /** The author's thinking as it drafted, where it was kept. */
  reasoning: string;
  /** Live beats on the chain from its story time on: the pins a settlement reads (an open draft's), or how many its settlement read. */
  pins: number;
  /** Its live settlement: where it landed, the author's reading of the pins, its thinking, and the beats it made canon. */
  settle?: DepthAt & { why: string; reasoning: string; beats: number };
  /** Its live drop: where, why, and the author's thinking. */
  drop?: DepthAt & { why: string; reasoning: string };
  /** What the player's last Settle now or Re-draft on it came to while the host has run: under way, done (what became of it, a line each) or failed (why). */
  press?: { op: "settle" | "redraft"; state: "running" | "done" | "failed"; lines: string[] };
}

/** GM → Depth → Drafts (§4.6, §7): every draft on this chat's chain, newest first; Settle now, Drop and Re-draft act on an open one. */
export interface DepthDraftsView {
  on: boolean;
  drafts: DepthDraft[];
}

/** What some of depth's work cost, as the views show it (§4.7): its calls, its tokens (sent and written, reasoning included), the part of them spent reasoning, and money where the provider priced it. */
export interface DepthCost {
  calls: number;
  tokens: number;
  reasoning?: number;
  money?: number;
}

/** Where depth's work runs (§2.4): on screen (a turn's scene, its walk-ons included), right after the reply, and off screen. */
export type DepthLane = "scene" | "after" | "offscreen";

export const DEPTH_LANE_LABEL: Readonly<Record<DepthLane, string>> = Object.freeze({ scene: "On screen", after: "After the reply", offscreen: "Off screen" });

/** The meter for one story interval (§6.5): what depth spent in it, per lane, per treatment off screen with the episodes each bought, and per role. */
export interface DepthMeterRow {
  /** The interval in words: "Story week: Monday 4 May 2026 – Sunday 10 May 2026". */
  label: string;
  /** The story is in this interval now, as Settings → Depth → Budget counts intervals. */
  now: boolean;
  total: DepthCost;
  /** Every lane, spent or not. */
  lanes: { lane: DepthLane; cost: DepthCost }[];
  /** Each treatment that spent anything off screen, and how many episodes it bought. */
  treatments: { treatment: DepthTreatment; episodes: number; cost: DepthCost }[];
  /** Each role that spent anything. */
  roles: { role: DepthRole; cost: DepthCost }[];
  /** Each episode drafted in the interval: each part's treatment with the author's grade and reason against the threshold. */
  grades: { episode: string; subject: string; depth: string; why: string }[];
}

/** One treatment's allowance this story interval (§6.5) and the parts the drafts on the chain spent of it. */
export interface DepthAllowance {
  treatment: DepthTreatment;
  /** null: no limit. */
  allowance: number | null;
  spent: number;
}

/** A ceiling (§6.5, D-7), in tokens, and what was spent against it. */
export interface DepthCeiling {
  which: "turn" | "day";
  /** null: no limit. */
  limit: number | null;
  spent: number;
  /** What `spent` counts, in words. */
  of: string;
  /** It was reached: the latest turn stopped spending there, or today's work waits for the next UTC day. */
  reached: boolean;
}

/** An ask waiting on the player (§6.5, D-7): the chip under its reply, whose buttons answer it as the chip's would. */
export interface DepthOpenAsk {
  /** The chip's id: a button sends `lre.chip` with it and the button's id. */
  chip: string;
  label: string;
  detail: string;
  at: DepthAt;
  actions: { id: string; label: string; primary?: true }[];
}

/** What a treatment-log entry records (§6.5): a turn's scene, the step after a reply, an episode off screen, or an episode held for the player. */
export type DepthLogKind = "scene" | "after" | "episode" | "ask";

export const DEPTH_LOG_KIND_LABEL: Readonly<Record<DepthLogKind, string>> = Object.freeze({ scene: DEPTH_LANE_LABEL.scene, after: DEPTH_LANE_LABEL.after, episode: DEPTH_LANE_LABEL.offscreen, ask: "Ask me" });

/** Where a log entry stands: an episode's draft state, or an ask's (waiting on you, spent past the allowance, kept to it). */
export type DepthLogState = DepthDraftState | "waiting" | "spent" | "kept";

export const DEPTH_LOG_STATE_LABEL: Readonly<Record<DepthLogState, string>> = Object.freeze({ ...DEPTH_DRAFT_STATE_LABEL, waiting: "Waiting on you", spent: "You spent one more", kept: "Kept to the allowance" });

/** One line of a log entry: whom or what, the depth it got, and the author's reason. */
export interface DepthLogLine {
  subject: string;
  depth: string;
  why: string;
}

/** One entry of the treatment log (§6.5): a piece of depth's work, the depth each part of it got and why, what it cost, and what a ceiling put off meanwhile, a line each (never skipped silently). */
export interface DepthLogEntry {
  kind: DepthLogKind;
  title: string;
  /** Its story time in words; null where its record keeps none. */
  when: string | null;
  /** The reply it rides at. */
  at: DepthAt;
  lines: DepthLogLine[];
  /** What it cost, where the chain records it. */
  cost?: DepthCost;
  put: string[];
  state?: DepthLogState;
}

/** GM → Depth → Treatments (§6.5, §7): the asks waiting on you, the treatment log newest first, the meter per story interval newest first, and the budget dial as it stands (this story interval's allowances, the ceilings, Ask me, the threshold). */
export interface DepthTreatmentsView {
  on: boolean;
  asks: DepthOpenAsk[];
  log: DepthLogEntry[];
  meter: DepthMeterRow[];
  /** This story interval in words: "Story week: Monday 4 May 2026 – Sunday 10 May 2026". */
  interval: string;
  allowances: DepthAllowance[];
  ceilings: DepthCeiling[];
  ask: boolean;
  threshold: string;
  level: DepthThresholdLevel;
}

/** What `lre.depth` asks, beside its chat. The bootstrap and the opt-in are `lre.bootstrap`'s (`shared/bootstrap.ts`). */
export type DepthOp =
  | { op: "minds" }
  | { op: "mind"; who: EntityId }
  | { op: "mind_edit"; who: EntityId; path: string; text: string }
  | { op: "interview"; who: EntityId; question: string; neutral: boolean }
  /** Play as (D-10): refused, since switching isn't supported yet. */
  | { op: "pov"; who: EntityId }
  /** Its agent lives the points of view waiting for it now, rather than when the author's poll asks. */
  | { op: "catch_up"; who: EntityId }
  /** Its agent reflects now, rather than at a cadence the author judges. */
  | { op: "reflect"; who: EntityId }
  | { op: "notebook" }
  | { op: "notebook_edit"; path: string; text: string }
  | ({ op: "archive" } & DepthArchiveQuery)
  /** The turn inspector's scene view (`shared/scene-view.ts`): one reply's scene, the newest with one by default. */
  | { op: "scene"; message?: MessageId }
  /** GM → Depth → Drafts (§4.6): every draft on this chain with its state there. */
  | { op: "drafts" }
  /** Settle now: the author reads the open draft against its pins now and settles it, drops it or redrafts it. */
  | { op: "draft_settle"; draft: string }
  /** Drop: the player's own verdict that the open draft won't happen. */
  | { op: "draft_drop"; draft: string }
  /** Re-draft: the open draft dropped, and its episode drafted again at its treatments from where the story is now. */
  | { op: "draft_redraft"; draft: string }
  /** GM → Depth → Treatments (§6.5): the treatment log, the meter, the budget dial as it stands, and the asks waiting on the player. */
  | { op: "treatments" };

/** `lre.depth`'s answer: the part its op asked for. */
export interface DepthResult {
  minds?: DepthMindsView;
  mind?: DepthMindView;
  interview?: DepthInterview;
  notebook?: DepthNotebookView;
  archive?: DepthArchiveResult;
  scene?: DepthSceneView;
  /** With `scene`: the chat's last dry run on the loopback, the narrator's prompt LumiRPEngine would send for it; null when none was kept. */
  dryRun?: { at: number; messages: { role: string; content: string }[] } | null;
  drafts?: DepthDraftsView;
  treatments?: DepthTreatmentsView;
  /** How many points of view a catch-up lived. */
  lived?: number;
  /** A change's Undo (a player edit is a GM edit, §7), or null when it has none. */
  undo?: string | null;
  /** The change waits for the reply being written. */
  pending?: boolean;
  /** What a draft's action did, in words, a line each. */
  said?: string[];
}

/** A request as a view sends it, envelope aside. */
export type DepthBody = { type: "lre.depth"; chatId: ChatId } & DepthOp;

/** Money as the views show it ("$1.25"); "price unknown" where no provider reported one. */
export function moneyText(money: number | null): string {
  return money === null ? "price unknown" : `$${money.toFixed(2)}`;
}

/** A duration as the views show it: "40 s", "12 min", "3 h 20 min". */
export function durationText(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

/** Tokens as the views show them: "820", "41K", "3.2M". */
export function tokensText(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}K`;
  return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** What a stage spent or will spend, in a line: "1,240 calls · 3.2M tokens · $14.80 · 6 h". */
export function countsText(counts: StageCounts): string {
  return [`${counts.calls.toLocaleString("en-US")} ${counts.calls === 1 ? "call" : "calls"}`, `${tokensText(counts.tokensIn + counts.tokensOut)} tokens`, moneyText(counts.cost), durationText(counts.ms)].join(" · ");
}

/** What some work cost, in a line: "3 calls · 11K tokens, 4K of them reasoning · $0.12". */
export function costText(cost: DepthCost): string {
  return [`${cost.calls.toLocaleString("en-US")} ${cost.calls === 1 ? "call" : "calls"}`, `${tokensText(cost.tokens)} tokens${cost.reasoning ? `, ${tokensText(cost.reasoning)} of them reasoning` : ""}`, ...(cost.money !== undefined ? [moneyText(cost.money)] : [])].join(" · ");
}

/** The mind files in the order the view lists them (§4.4): core first, then self, now, on my mind, beliefs, plans, people, memories newest last. */
export function mindFileOrder(path: string): number {
  const base = path.replace(/^minds\/[^/]+\//, "");
  const fixed = ["core.md", "self.md", "now.md", "on-my-mind.md", "beliefs.md", "plans.md"].indexOf(base);
  if (fixed >= 0) return fixed;
  if (base.startsWith("people/")) return 10;
  if (base.startsWith("memories/")) return 20;
  return 30;
}

/** A mind file's name as the view says it: "Core", "On my mind", "Memory: the pier", "Mira". */
export function mindFileLabel(path: string): string {
  const base = path.replace(/^minds\/[^/]+\//, "");
  const named: Record<string, string> = { "core.md": "Core", "self.md": "Self", "now.md": "Now", "on-my-mind.md": "On my mind", "beliefs.md": "Beliefs", "plans.md": "Plans" };
  if (named[base]) return named[base];
  const leaf = base.replace(/\.md$/, "").split("/").pop() ?? base;
  const words = leaf.replace(/[-_]+/g, " ");
  if (base.startsWith("memories/")) return `Memory: ${words}`;
  if (base.startsWith("people/")) return words.charAt(0).toUpperCase() + words.slice(1);
  return base;
}

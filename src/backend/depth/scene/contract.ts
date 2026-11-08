// The live scene's contract (DEPTH-PLAN §1.3, §2.3–§2.5, §4.2, §4.4, §5.2, §9.2 A2): how one depth
// turn runs and where each part plugs in. The loopback bridge (B1b) runs today's engine run for the
// player's input, then calls `runDepthTurn` (scene/turn.ts) inside the loopback request and commits
// what it returns. After the commit it calls `afterDepthReply` (scene/after.ts); when the player
// edits a reply it calls `replyEdited` (scene/edit.ts).
//
//   A2a  the author as DM: the scene's setup and the steps between beats, with effort per character;
//        the loop; the poll (who catches up now) with its log; reflection, drift checks, predictions;
//        edits as directives                          scene/turn.ts, author.ts, after.ts, edit.ts
//   A2b  the GM's beats for the player's input (`playerBeats`), character play (`play`), attempts
//        (`resolveAttempt`), remembering after the reply (`rememberAfterReply`)
//                                                     scene/play.ts, resolve.ts, remember.ts
//   A2c  the narrator: each decided moment rendered, checked by the GM and streamed in order while
//        the next beat is decided (`Narration`); Re-narrate (`renarrateMoments`)   scene/narration.ts
//   A2d  real-time dialogue (`realtimeTurn`, `talkOn`; `story.talk`)            scene/realtime.ts
//
// One turn, in order:
//   1. a Re-narrate renders its source's beats again (A2c) and decides nothing;
//   2. a live talk (`story.talk`) whose character is still present goes to `realtimeTurn` (A2d),
//      which runs the line and its render, or hands the turn back as a full scene (`takeover`);
//   3. the engine run's events (B1b ran it, as today) are applied first;
//   4. the GM writes the player's own beats from his input and the run's resolutions (A2b);
//   5. the author's setup: the scene, its staging, each character's effort, the exposure of the
//      player's beats, an opening beat and any world beats, who acts first, real time on or off;
//   6. until the author ends the turn: the agents it names play (A2b), at once when several do; an
//      attempt goes to the GM (A2b); the author's step writes exposure, staging, world beats and the
//      acts of those it plays or handles, and names who acts next;
//   7. each beat that reached someone in part gets their points of view (the truth-blind render),
//      then each decided moment goes to the narrator (A2c), which streams it while 6 goes on;
//   8. the minutes the scene ran past the clock pass through the engine's time channel.
//
// Canon is decided before the prose: every beat is written by whoever decided it, as it is decided,
// and nothing reads the reply. The record's pre holds the engine run's events, then the scene's in
// decision order, moment by moment (an ask's beats in the moment that asked); its read part holds
// the narrator's `story.passage` events. A Stop keeps the moments through the last one whose passage
// streamed. Stages are pure apart from the port and the sink: they return events and blobs; the loop
// applies the events to the turn's working state, in order, and gives back the blobs to put.

import type { ChatId, EntityId, MessageId, UserId } from "../../../shared/ids";
import type { Basis } from "../../../shared/layer";
import type { GenerationKind, LedgerEvent, PackEvent } from "../../../shared/ledger";
import type { UserSettings } from "../../../shared/settings";
import type { StoryRead } from "../../../shared/story";
import type { TalkNow } from "../../../shared/talk";
import type { WorldDoc } from "../../../shared/world";
import type { EngineTurnPlan } from "../../../engine/turn";
import type { Registry } from "../../../engine/registry-impl";
import type { WorldState } from "../../../engine/state";
import type { LiveEvent } from "../../../engine/ledger/story";
import type { CardHost } from "../../character-agent";
import type { ArchiveSource } from "../archive-tools";
import type { CeilingBind, OnScreenAllowance, TurnBudget } from "../budget";
import type { BeatText, Blobs, StagingText } from "../common";
import type { ModelPort, PortMessage, PortUsage } from "../port";
import type { TurnSink } from "../../loopback/sink";

/** The thinking block and the reply (B1b's bridge implements it over the call's chunks); writers filter by Settings → Depth → thinking (D-5) themselves. */
export type { TurnSink } from "../../loopback/sink";

// ------------------------------------------------------------------ the bridge's side (B1b)

/** What a depth turn reads of the runtime. */
export interface SceneRt {
  readonly registry: Registry;
  /** The user's blobs; a stage reads the texts the turn made so far through the loop's own reader, which looks here last. */
  readonly blobs: { get(userId: UserId, hash: string): Promise<string | null> };
  /** The host's cards: a mind formed in play takes its core from one (`formCore`); absent, from what the world knows. */
  readonly host?: CardHost;
}

/** The fold a turn or a job reads: the frontier it answers and everything through it (`foldAtBasisOf`, queue-free). */
export interface SceneAt {
  basis: Basis;
  state: WorldState;
  world: WorldDoc;
  story: StoryRead;
  /** The live events of the types the turn reads beside the beats, through the basis (`foldAtBasisOf`'s `types`): `story.talk` and `story.scene`, and the drafts with their settlements and drops (`DRAFT_TYPES`). */
  events: readonly LiveEvent[];
}

/** What the bridge gives a depth turn. */
export interface DepthTurnInput {
  chatId: ChatId;
  userId: UserId;
  /** The turn's token: unique per generation. The scene's beat ids and a new scene's id are made from it. */
  turn: string;
  kind: GenerationKind;
  /** The fold through the message the turn answers (the player's; after an empty Send, the reply it follows), before the engine run. */
  at: SceneAt;
  /** The engine run for the player's input, as today (B1b runs it): its events come first in the record's pre; null for none. */
  plan: Pick<EngineTurnPlan, "events" | "elapsedMinutes" | "resolutions" | "chips"> | null;
  /** The chat's run seed and the turn's action seed (`TurnPlanInput`), for an attempt resolved inside the scene. */
  runSeed: string;
  seed: string;
  /** The player's message, verbatim; null when he sent none (an empty Send, which asks the story to go on). A Continue never runs a depth turn: its reply is committed unread. */
  input: { messageId: MessageId; text: string } | null;
  /** The player's signals the turn comes with beyond his words (§3.9, §4.5): what he asked of a swipe and his swipes of the replies around it; the setup and the poll read them. */
  signals?: string[];
  /** What the player asked this telling to change (his "What should change?" on a swipe, §3.9): the narrator renders with it, and the GM's check allows the texture he asked for (`NarrationInput.direction`). */
  direction?: string;
  /** A Re-narrate's source record: its pre, in order, and its read part (its `story.passage` events). */
  source?: { pre: readonly LedgerEvent[]; read: readonly LedgerEvent[] };
  /** The recent raw prose the narrator keeps the voice from (Settings → Depth → window), oldest first, as one text; unused where `frame` carries the recent window. */
  recent: string;
  /** The narrator's frame (B2's short context, `loopback/short-context.ts`): the prompt core assembled, its history replaced by the recent window, with a part closing the window as a system message; absent, a plain frame with `recent`. */
  frame?: (part: string) => PortMessage[];
  settings: UserSettings;
  /** Every model call of the turn, each role on its Settings → Depth row; the bridge's port reports each call to `sink.call`. */
  model: ModelPort;
  sink: TurnSink;
  /** Stop: the scene stops between beats; what streamed stays. */
  signal: AbortSignal;
  rt: SceneRt;
  /** The chat's archive (DEPTH-PLAN §4.3) through the message the turn answers, for the author's setup to read and quote; absent, the setup reads none. */
  archive?: ArchiveSource;
  /** The budget dial's ceilings (§6.5): what binds once the turn has spent so many tokens (its metered port's count), against today's spend too, and what each leaves; absent, nothing binds. The author reads what is left at its setup and each step; once a ceiling binds, whoever still plays as their own agent is played by the author, and the scene goes on as far as it judges. */
  budget?: TurnBudget;
}

/** What a depth turn gives back to commit. */
export interface DepthTurnResult {
  /** The record's planned events, in order: the engine run's, then the scene's moment by moment (a Re-narrate: its source's, cut on a Stop). */
  pre: LedgerEvent[];
  /** The record's read part: the narrator's `story.passage` events. */
  read: LedgerEvent[];
  /** Every text the events name, by hash: put before the commit. */
  blobs: Blobs;
  /** Events the working state refused, with why (the thinking block said so as each was refused). */
  dropped: { event: LedgerEvent; reason: string }[];
  /** The engine run's chips, and a Timelapse offer when the scene ran past what one time advance reaches. */
  chips: EngineTurnPlan["chips"];
  /** Stopped between beats: only the moments whose prose streamed are kept. */
  stopped: boolean;
  /** The narrator couldn't render (its prose failed): the beats stand; Re-narrate renders them again. */
  failed?: string;
  /** A stage of the scene failed once a passage had streamed (§3.14): why, in words. The turn ended as a Stop ends it, keeping the beats whose prose streamed; nothing after them was decided. */
  error?: string;
  /** What runs right after the commit (`afterDepthReply`). */
  after: AfterReply;
}

/** What runs right after a depth reply is committed (§2.4: the next turn usually waits on it). */
export interface AfterReply {
  /** The scene the turn played, and whether it ended with the turn. */
  scene: string | null;
  ended: boolean;
  /** Agents who played this turn and remember it now, each where it hasn't already (A2b's `rememberAfterReply`). */
  remember: EntityId[];
  /** The poll runs now; false while a conversation defers it to its end (A2d). */
  poll: boolean;
  /** The beats this turn decided, by id: the truth-link files their facts, the poll reads them. */
  beats: string[];
  /** The player's signals the turn read, for the poll: how it came ("a swipe", "a Regenerate", "a Re-narrate"), then his out-of-character lines; absent when none (a real-time exchange's). */
  signals?: string[];
  /** What the turn's record spent, in tokens (its scene's `author.spend` and each walk-on's): the step after the reply counts on from it against the per-turn ceiling. */
  spent?: number;
  /** The turn's generation, which the step's own `author.spend` names beside the scene's. */
  turn?: string;
}

// ------------------------------------------------------------------ the narrator (A2c)

/** A beat as the narrator renders it: its texts, and the player character's own point of view where his reach was partial. */
export type RenderBeat = BeatText & { pov?: string };

/**
 * A decided moment: one beat, or a few that read as one, in decision order. `mark` is its index in
 * the turn (0, 1, 2…); a moment with no beat the player character perceived still counts (it was
 * decided), so a Stop's cut can keep it.
 */
export interface Moment {
  beats: RenderBeat[];
  /** The player character's staging as the moment plays. */
  staging?: StagingText;
  mark: number;
}

/** The author's answer to the narrator's ask (§1.3): the beats it decided for that moment, exposure and the player character's point of view done; null: none (render without it). */
export type AskAuthor = (q: { questions: string[]; moment: Moment }) => Promise<RenderBeat[] | null>;

export interface NarrationDeps {
  model: ModelPort;
  sink: TurnSink;
  /** Absent on a Re-narrate, which never decides a beat. */
  ask?: AskAuthor;
  /** How many of the record's pre events run through moment `mark` in its final layout, for `story.passage.through`; called at the end of `drain()`. */
  throughOf: (mark: number) => number;
  /** The narrator's frame (`DepthTurnInput.frame`). */
  frame?: (part: string) => PortMessage[];
}

export interface NarrationInput {
  world: WorldDoc;
  state: Readonly<WorldState>;
  texts: UserSettings["prompts"]["texts"];
  /** The player character (`povOf`, D-10). */
  pov: EntityId;
  /** The people the player character knows by name (`knowsFor`): the narrator names only them and describes anyone else as they appear. */
  knows?: EntityId[];
  /** `ownCheckRoom`: the answer room the user set the check in Settings → Depth (`ownRoom`), which every check asks at, a part of a passage too, over the room sized to what it reads (`checkRoom`); absent or null where none is set. */
  settings: { redrafts: number; thinking: "whole" | "progress"; ownCheckRoom?: number | null };
  /** The recent raw prose, for the voice and continuity. */
  before?: string;
  /** The notebook excerpts the author chose for the scene (the tone contract, a ripe setup). */
  excerpts?: string[];
  /** Each passage of the chat's own prose the author pulled for the scene (§4.3: callbacks), exactly as written. */
  quotes?: ArchivePassage[];
  /** What the player asked this telling to change (his "What should change?", §3.9): the narrator renders with it, and the GM's check allows the texture he asked for, never a fact the beats lack. */
  direction?: string;
  /** The narrator may ask the author for a detail canon lacks; false on a Re-narrate. */
  asks: boolean;
  signal: AbortSignal;
}

/** A passage of the chat's own prose the author pulled for the narrator (§4.3: a callback): its text exactly as the archive holds it, the message it is from, when that falls in the story, and why the author pulled it. */
export interface ArchivePassage {
  messageId: MessageId;
  /** The message's place on the chain, from 0. */
  index: number;
  /** Its story time in words, where the archive has one. */
  when: string | null;
  text: string;
  /** The passage is the start of a longer one, cut at the quote cap. */
  truncated: boolean;
  why: string;
}

/** One passage as it went: its moment, the beats it renders, its text, whether its check passed (null: unchecked), its redrafts, where it departs from its beats, and how long it took. */
export interface PassageOutcome {
  index: number;
  mark: number;
  beats: string[];
  text: string;
  faithful: boolean | null;
  redrafts: number;
  departs?: string;
  ms: { render: number; check: number; total: number };
}

/** What the narrator gives back once every moment it was given has streamed, or on a Stop. */
export interface NarrationOutcome {
  told: PassageOutcome[];
  /** `story.passage` events (the record's read part) and their texts. */
  events: PackEvent[];
  blobs: Blobs;
  /** The mark of the last moment whose passage reached the sink; null when none did. */
  streamedThrough: number | null;
  stopped: boolean;
  failed?: string;
  usage: PortUsage;
}

/** The narrator's side of a turn (A2c's `Narration`): renders strictly in order and never blocks the loop. */
export interface NarrationPort {
  add(moment: Moment): void;
  /** Every moment added rendered, or a Stop: what was told. Where nothing streamed because nothing reached the player character but his own beats, the quiet passage (LIVE3c L3c-5), unless `quiet` is false (a stage of the turn failed, which then fails as it would). */
  drain(o?: { quiet?: boolean }): Promise<NarrationOutcome>;
}

export type NarrationFactory = (deps: NarrationDeps, input: NarrationInput) => NarrationPort;

// ------------------------------------------------------------------ real-time dialogue (A2d)

/** What `realtimeTurn` reads: the fold, the line verbatim, the talk that runs, and the render bound to the turn. */
export interface RealtimeCtx {
  chatId: ChatId;
  userId: UserId;
  rt: SceneRt;
  /** The fold through the answered message; its `state` is the working state after the engine run's events, whose tick is the line's time. */
  at: SceneAt;
  turn: string;
  runSeed: string;
  seed: string;
  /** The player's line, verbatim. */
  line: string;
  /** The live talk (`talkOn`), and the scene it runs in. */
  talk: TalkNow;
  scene: string;
  model: ModelPort;
  sink: TurnSink;
  signal: AbortSignal;
  /** The author's notebook as its stable prefix reads it, for the watch. */
  notebook: string;
  settings: UserSettings;
  /** The ceiling that binds now (§6.5), at what the turn has spent: a line while one binds plays as a scene, where the author plays its character (the cheaper rung). Absent, none binds. */
  binds?: () => CeilingBind | null;
  /** The on-screen allowance this story interval (W17): spent, a line plays as a scene, where the author plays its character. Absent, none is set. */
  onScreen?: OnScreenAllowance | null;
  /**
   * The narrator, bound to this turn (sink, ask, excerpts, recent prose, settings): A2d renders the
   * exchange in it, so the latency line times the whole line. `throughOf` counts A2d's own events
   * through a mark; the factory adds the record's prefix (the engine run's events) before them.
   */
  narrate: (throughOf: (mark: number) => number) => NarrationPort;
}

export type RealtimeOutcome =
  /**
   * The line ran: its events (the character's answer, any world beat the watch added, a talk ending)
   * in decision order, already cut to the last streamed moment on a Stop (none when nothing streamed),
   * and the narration's outcome.
   */
  | { kind: "exchange"; events: LedgerEvent[]; blobs: Blobs; narration: NarrationOutcome; pollDeferred?: boolean; ended?: boolean }
  /** The line needs the DM: nothing is written, and the turn runs as a full scene, with `why` given to the author's setup; `put`, what a ceiling put off, for the scene's spend (§6.5). */
  | { kind: "takeover"; why: string; put?: string };

// ------------------------------------------------------------------ the author's records (A2a)

export type { PollConsidered, PollJob } from "../../../shared/author";

// A turn, from a tagged request to a saved message (plan §10.1, §10.7, §10.8, §6.3). Code gathers what
// the Author is shown and records what it did; it decides nothing about how a turn is run.
//
// Intake: the chat in RPE's store (a fork of a chat RPE knows shares its tree), the generations that
// ended unheard tied to what they saved, the chat's path compared with the turn tree, the turns that
// left the path cancelled, the wait for the previous turn's run (a swipe or regenerate does not wait for
// the attempt it replaces: it stops it), the new turn at the point the generation starts from (`start.ts`;
// a continue goes on with the turn its message is tied to, as a run of its own), the chat's session, the
// briefing's blocks (the turn's facts, the lore map, the world state, and from the story record the story
// so far and the story brief) with what has happened since the last turn. Intake's steps and its waits
// for the turn before are kept on the run apart.
//
// The run: RPH answers, its reply streamed to Lumiverse as it is written, the turn's folder (`folder.ts`)
// written alongside once the Author's first model call has gone out; the run may go on after the reply
// is out whole, and Lumiverse stopping before then stops it. A run that ends with no reply ends
// the reply with a plain line from a file.
//
// Commit: when Lumiverse says the generation ended, the saved message is read back and the turn tied
// to it by the hash of what was stored; an impersonation, which saves no message, leaves an attempt with
// no state. If the event was missed, the next intake ties it the same way.

import type { Database } from "bun:sqlite";
import { type Fields, type Guidance, type LinesPart, loadGuidance, type TemplatePart } from "../app/guidance";
import type { Clock, ContextBlock, DefinitionsApi, FilesPort, Harness, JobState, JsonObject, Log, ModelLimits, ReplyError, ReplySink, Scope, SinceItem, TurnRequest, Usage } from "rp-harness/contract";
import { forkOf, reconcile, type ChatChange, type ChatChanges, type ShownSwipe } from "../adapter/lumiverse/events";
import type { Feedback } from "../adapter/lumiverse/feedback";
import type { TaggedTurn, TurnPlayer } from "../adapter/lumiverse/provider";
import type { LumiverseReads, LvStep } from "../adapter/lumiverse/reads";
import type { Cut, PromptNotice } from "../adapter/lumiverse/receipt";
import type { LvMessage } from "../adapter/lumiverse/rows";
import type { ReplyStream } from "../adapter/lumiverse/stream";
import { type TagLore, textHash } from "../adapter/lumiverse/wire";
import type { LiveHub } from "../app";
import { CAST_VIEWS, castPresentViews, castViews, type CastViewName, type SourceReader } from "../cast";
import { calendarOf, formatClock } from "../engine/calendar";
import { placeOfEntity } from "../engine/scope";
import { mapView, mapWording } from "../iface";
import { knowledgeChange, type Lore, type LoreIndex, loreLines, loreMapFields, type LoreProjection, type SecretSettingsFor } from "../lore";
import { placeLinesAt } from "../places";
import { tidyHolds } from "../play/path-events";
import type { ActivatedRead } from "../lore/indexing";
import { isRecord } from "../shared/json";
import { type ChangeRow, clockRecorded, type DueSource, type MapText, type PathReport, type Report, type ShownMessage, type Store, type TreeView, type TurnRow, type UserStore, worldState } from "../store";
import { aboutOf } from "../store/fold";
import { type SceneSession, sceneSession, storyBrief, storyCoverage, storyRecordParts } from "../story";
import { storyAt } from "../story/path";
import { type StorySoFar, storySoFar, storySoFarBudget } from "../story/sofar";
import { mergeTurnRecord, type Pruned, type TreeChats, type TreeFiles, type TreeNotes, turnFolderName, type TurnRecordMessage, type TurnRecordTokens } from "../tree";
import { type Attempt, type AttemptFeedback, type CastFolder, type FolderAsk, writeAlongside } from "./folder";
import { jobsEndedBetween } from "./jobs";
import { ownerEditsBefore } from "./owner-changes";
import type { OffstageSettings } from "../shared/offstage";
import type { Writes } from "./kv";
import type { TurnPrompts } from "./prompt";
import type { TurnMarks } from "./marks";
import type { ComposerAsk, PanelAsk, Requests } from "./requests";
import { writeTurnRecord } from "./record";
import { leftOutOf, maxTokensOf, prefillOf, promptOf, samplingOf, summarizedOf } from "./request";
import type { IntakeStep, NotGiven, Run, RunRecord, Runs, Stretch } from "./runs";
import { maskWorldInfoScanExclusions, SCAN_SETTING, scannedSteps, scanSettingsOf } from "./scan";
import type { Approvals } from "./approvals";
import { type TurnSettings, turnSettings } from "./settings";
import { type FoundItem, foundItems, type GoneTurn, type KeptItem, type SinceKept } from "./since";
import { stageAt, stageCues } from "./stage";
import { generationStart, seenOf } from "./start";
import { guidanceTexts } from "./texts";

/** The prompt parts the turn lane lays its texts out by (each under `.prompts/`). */
export const PARTS = {
  progress: "progress",
  notices: "notices",
  errors: "reply-errors",
  turnFacts: "turn-facts",
  loreMap: "lore-map",
  worldState: "world-state",
  storySoFar: "story-so-far",
  storyBrief: "story-brief",
  briefing: "briefing",
  turnErrors: "turn-errors",
  /** The turn's reply as saved, as an agent is given it by name (`turn:reply(saved)`). */
  turnReply: "turn-reply",
  /** The turn's result, the beats it opened and its staged changes in both lanes, as an agent is given it by name (`turn:result`). */
  turnResult: "turn-result",
} as const;

/** The names the briefing's template places the host's blocks by. */
export const BLOCKS = { turnFacts: "turn-facts", loreMap: "lore-map", worldState: "world-state", storySoFar: "story-so-far", storyBrief: "story-brief", onStage: "on-stage", notGiven: "not-given", promptCut: "prompt-cut" } as const;

/** The briefing's header field that names the cast's views of the characters on stage the Author is given (`castPresentViews`). */
export const ON_STAGE_VIEWS = "on_stage_views";

/** What a turn keeps of the feedback typed in Lumiverse's regenerate dialog, in `turn_told`: a `Feedback`, the newest the word that stands. */
export const FEEDBACK_TOLD = "feedback";
/** The told kinds of the breakdown's word on a turn's feedback: it disagreed (`{ was, now }`), or agreed (the feedback). */
export const FEEDBACK_CORRECTED = "feedback-corrected";
export const FEEDBACK_CONFIRMED = "feedback-confirmed";

/**
 * A text's tokens as the model layer counts a prompt (`ModelsApi.count`): at RPH's characters to a token for the chat
 * (`tokens.charsPerToken`, `TurnSettings.charsPerToken`). Every budget the turn fills is counted by it, and by no figure of RPE's own.
 */
export function tokenCount(charsPerToken: number): (text: string) => number {
  return (text) => Math.ceil(text.length / charsPerToken);
}

/** The name an agent is given the drawn layer of the map the player's character stands on by (the Author's opening, plan §10.2). */
export const DRAWN_MAP = "map:drawn";

/**
 * The drawn layer of the map the player's character stands on, at the scope's turn's start or the chat's head, with its grid and version;
 * null where the chat has no world, or no map is drawn where he stands.
 */
export function drawnLayer(store: Store, scope: Scope, map: MapText): { grid: string; drawn: string; text: string } | null {
  const user = store.user(scope.user);
  if (user.chat(scope.chat) === null) return null;
  const turn = scope.turn === undefined ? null : user.turn(scope.turn);
  const { state } = turn === null || turn.chat !== scope.chat ? user.headState(scope.chat) : user.stateAt(turn.id);
  const doc = store.env.worlds(state.world.revision);
  const place = doc === undefined ? null : placeOfEntity(state.world, doc.pov);
  return place === null ? null : map.text({ state, env: store.env, place, layer: "drawn" });
}

/** The first `count` words of a text, joined by single spaces. */
function firstWords(text: string, count: number): string {
  return text.trim().split(/\s+/).slice(0, count).join(" ");
}

/**
 * The parts in force that lay out the cast's views `names` names, by view: a view by its own name, or a view of one casting
 * (`history:principal`). A view whose part is switched off has none, and is given no text.
 */
export async function castLayouts(guidance: Pick<Guidance, "part">, names: readonly string[]): Promise<Partial<Record<CastViewName, TemplatePart>>> {
  const layouts: Partial<Record<CastViewName, TemplatePart>> = {};
  for (const view of Object.keys(CAST_VIEWS) as CastViewName[]) {
    if (!names.some((name) => name === view || name.startsWith(`${view}:`))) continue;
    const part = await guidance.part(CAST_VIEWS[view]);
    if (part?.format === "template") layouts[view] = part;
  }
  return layouts;
}

/** A session's id while a chat has none yet: the settings are read before the turn that opens one, and no file of theirs is a session's. */
export const NO_SESSION = "none";

/**
 * How a run's reply ends where none went out whole: the reply-errors part's lines; whether `reply.lastText` sends the Author's last
 * plain text in their place; and, for a reply asked for whole, its hold in milliseconds from its arrival, null for none.
 */
interface Ending {
  errors: LinesPart | undefined;
  lastText: boolean;
  hold: number | null;
}

/**
 * One of the turn's own failures, refusals and stops (a turn RPE cannot play, a run stopped, a read of Lumiverse it cannot make) in the
 * words of the turn-errors part in force for the chat; the case's name alone where the part has no line for it or cannot be read, so
 * that a stop is never held up by its words.
 */
export async function turnErrorWords(files: FilesPort, at: { user: string; chat: string }, name: string, fields: Fields = {}): Promise<string> {
  try {
    return lines(await loadGuidance(files, { user: at.user, chat: at.chat, session: NO_SESSION }).part(PARTS.turnErrors))?.line(name, fields) ?? name;
  } catch {
    return name;
  }
}

/** The connection the harness runs a lead's definition on for the scope (`definitions.list`'s `runsOn`), by its id: null for his default, or where none resolves. */
export async function leadConnection(definitions: Pick<DefinitionsApi, "list">, scope: Scope, lead: string | null): Promise<string | null> {
  if (lead === null) return null;
  return (await definitions.list(scope)).find((d) => d.name === lead)?.runsOn.connection?.id ?? null;
}

/**
 * The first history message the prompt holds, on the chat's path: the window's cut, or past it, where the model's own window trimmed
 * the oldest of what the window kept, the message after the newest it trimmed. Null where neither left anything out.
 */
function keptFirst(cut: TaggedTurn["cut"], steps: readonly LvStep[]): { id: string } | null {
  if (cut.trimmed === null) return cut.keep;
  const after = steps[steps.findIndex((s) => s.id === cut.trimmed?.to.id) + 1];
  return after === undefined ? cut.keep : { id: after.id };
}

/** The notice that tells each way a job can end (plan §13.5): a job that did not finish is never told as finished. */
const JOB_ENDS: Readonly<Partial<Record<JobState, string>>> = { done: "job_finished", failed: "job_failed", cancelled: "job_cancelled", interrupted: "job_interrupted", "off-path": "job_off_path" };

export interface TurnLaneDeps {
  store: Store;
  writes: Writes;
  files: TreeFiles;
  chats: TreeChats;
  prompts: TurnPrompts;
  lore: Lore;
  /** The lore index, whose full lore map the briefing holds. */
  loreIndex: LoreIndex;
  runs: Runs;
  /** What he asks for beside his words (`requests.ts`): told to the turn that answers it, and kept with it. */
  requests: Requests;
  /** The marks each turn carries apart from its run's status (`marks.ts`). */
  marks: TurnMarks;
  /** What the store keeps of a chat's secrecy (`secretSettings`): the knowledge switch and threshold recorded at each turn's start. */
  secretSettings: SecretSettingsFor;
  /** What comparisons of a chat's path found, kept with the chat. */
  since: SinceKept;
  /** The questions a lane set to Confirm waits on, kept with the turn's card: what is waiting is told at a turn's start. */
  approvals: Approvals;
  /** The notes agents write, put as they stand at each turn's start (plan §5.4). */
  notes: TreeNotes;
  /** The projection book (`lore.projection`), brought up to date after a run's reply and at each change of the path, never on the reply's path. */
  projection: Pick<LoreProjection, "refresh">;
  /** What the index file derives of a chat (the state's search index, the vectors of search by meaning), dropped when Lumiverse deletes the chat. */
  forgetChat(user: string, chat: string): Promise<void>;
  /** Prunes the chat's older turn folders (plan §5.5), sparing these folders of turns going on. */
  pruneTurns(user: string, chat: string, spare: ReadonlySet<string>): Promise<Pruned>;
  /** What time brings due, for the world state's due section. */
  due: DueSource;
  /** What a migration carried of a chat, for its first briefing on RPE. */
  migrated: MigratedSource;
  /** A character's sources read live, for a view of those on stage that shows them (`base`). */
  sources: SourceReader;
  live: LiveHub;
  /** The adapter's reads of Lumiverse; null before it is mounted, or when RPE is not set up for a Lumiverse. */
  reads(): LumiverseReads | null;
  /** Stops a generation of the user's in Lumiverse, as the user's own Stop does; false when it was not going on. */
  stopGeneration(generation: string): Promise<boolean>;
  /** The harness, once built. */
  harness(): Harness;
  /** The Lumiverse user this RPE plays for; null before one is set. */
  owner(): string | null;
  clock: Pick<Clock, "now" | "setTimeout" | "clearTimeout">;
  log: Log;
}

/** What a migration carried of a chat, as the composition gives it: the turn lane reads no migration of its own. */
export interface MigratedSource {
  /** The prompt part that lays it out. */
  part: string;
  /** The notice that tells it, with the part's text as its `carried`. */
  notice: string;
  /** The part's fields; null where no migration imported the chat. Whether a turn is told them is the turn lane's to judge, by its own line. */
  fields(user: string, chat: string): Fields | null;
}

/** RPH's usage as an OpenAI-compatible one, for the reply's end. */
function usageOut(u: Usage): { prompt_tokens: number; completion_tokens: number; total_tokens: number } {
  return { prompt_tokens: u.input, completion_tokens: u.output, total_tokens: u.input + u.output };
}

function lines(part: TemplatePart | LinesPart | undefined): LinesPart | undefined {
  return part?.format === "lines" ? part : undefined;
}

/** The notices part's line that tells each thing a lead was not given (`NotGiven`). */
const NOT_GIVEN_LINES: Readonly<Record<NotGiven["what"], string>> = {
  pictures: "pictures_not_taken",
  parts: "parts_not_carried",
  "world-state": "world_state_failed",
  "on-stage": "on_stage_failed",
};

/** What a lead was not given, one line of the notices part each: the messages that held it and how many, or why a block could not be made. */
function notGivenText(notGiven: readonly NotGiven[], notices: LinesPart | undefined): string {
  return notGiven
    .flatMap((n) => {
      const line = notices?.line(NOT_GIVEN_LINES[n.what], "error" in n ? { error: n.error } : { count: n.count, messages: n.messages.join(", ") });
      return line === undefined || line.trim() === "" ? [] : [line];
    })
    .join("\n");
}

/** The notices part's line that tells each thing the receipt found of the prompt (`PromptNotice`, R-103). */
const CUT_LINES: Readonly<Record<PromptNotice["kind"], string>> = {
  unmatched: "cut_unmatched",
  pictures: "cut_pictures",
  uncut: "cut_uncut",
  "joining-unread": "cut_joining_unread",
  "room-unknown": "cut_room_unknown",
};

/**
 * What the receipt found of the prompt, one line of the notices part each, with its fields; then what Lumiverse's own clipping left
 * out inside the window, by its line for what clipped it (`cut_clipped_<by>`), where it left any out.
 */
function cutText(cut: Pick<Cut, "notices" | "clipped">, notices: LinesPart | undefined): string {
  const clipped = cut.clipped !== null && cut.clipped.count > 0 && cut.clipped.by !== null ? [notices?.line(`cut_clipped_${cut.clipped.by.replaceAll("-", "_")}`, { count: cut.clipped.count })] : [];
  return [...cut.notices.map(({ kind, ...fields }) => notices?.line(CUT_LINES[kind], fields)), ...clipped].flatMap((line) => (line === undefined || line.trim() === "" ? [] : [line])).join("\n");
}

function words(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether the turn `before` is on `turn`'s own line ahead of it: among the turns it was made after. */
function madeAfter(store: UserStore, turn: TurnRow, before: string): boolean {
  const ahead = store.turn(before);
  if (ahead === null) return false;
  let at: TurnRow | null = turn;
  while (at !== null && at.depth > ahead.depth) at = at.parent === null ? null : store.turn(at.parent);
  return at !== null && at.id === ahead.id && at.id !== turn.id;
}

/**
 * The swipe a generation wrote, as Lumiverse saved it (plan §6.3): the one it was given at its start, which need not be the one shown
 * now; for a message Lumiverse made only when it saved, its one swipe; for a continue its tag could not place, the swipe its generation
 * named on the message its end names. Null when which swipe it wrote cannot be told.
 */
function writtenOf(run: RunRecord, saved: LvMessage): LvMessage["saves"][number] | null {
  if (run.target === saved.id && run.swipe !== null) return saved.saves[run.swipe] ?? null;
  if (saved.saves.length === 1 && (run.target === null || run.kind === "continue")) return saved.saves[0] ?? null;
  return run.kind === "continue" && run.target === null && run.swipe !== null ? (saved.saves[run.swipe] ?? null) : null;
}

/** The text a message shows: its showing swipe's, where its hash is the one the message shows by, else its content. */
function shownText(m: LvMessage): string {
  const save = m.saves[m.swipe]?.text;
  return save !== undefined && textHash(save) === m.shown.hash ? save : m.text;
}

/**
 * How Lumiverse saved a continue's reply (plan §10.8): the text the swipe held, the preset's continue postfix, then the new text
 * (`generate.service.ts:4129-4147`, `:3636-3642`). The postfixes Lumiverse offers are none, a space or newlines, and one is left out
 * where the text already ends with it (`prompt-assembly.service.ts:662-670`). Gives that join where `saved` is `base`, whitespace or
 * nothing, then `reply`; null where it is anything else.
 */
function joinOf(saved: string, base: string, reply: string): string | null {
  if (saved.length < base.length + reply.length || !saved.startsWith(base) || !saved.endsWith(reply)) return null;
  const join = saved.slice(base.length, saved.length - reply.length);
  return join.trim() === "" ? join : null;
}

/** Where what a run that goes on with a turn records begins (`RunRecord.mark`, which holds the story's and the cast's changes with the engine's): taken inside the write that keeps the run. */
function marksOf(store: UserStore, turn: string): Pick<RunRecord, "mark"> {
  return { mark: store.changes(turn).at(-1)?.ord ?? -1 };
}

/** What a turn's intake found that the block of what has happened since the last turn tells. */
interface Found {
  steps: readonly LvStep[];
  notices: LinesPart | undefined;
  /** The chat's guidance, for the parts a notice's text is laid out by. */
  guidance: Guidance;
  /** The last turn's run, as kept before this turn began. */
  last: RunRecord | null;
  /** A continue of a turn: its first run was told what came before it. */
  again: boolean;
  /** The message a swipe or a regenerate writes again; null for any other turn. */
  replaced: string | null;
  /** Whether the chat lets agents read its hidden messages. */
  hiddenReadable: boolean;
  /** Tokens the replies edited after their turns may take in full (`since.editedBudget`); null for no bound. */
  editedBudget: number | null;
  /** The turns a delete took, quoted while they fit (`since.deletedBudget`, `since.deletedWords`), and what a flip stopped, listed while it fits (`since.notAppliedBudget`). */
  deleted: { budget: number; words: number };
  notAppliedBudget: number;
  /** What each finished job changed, listed while it fits (`since.jobBudget`); the rest counted. */
  jobBudget: number;
  /** A text's tokens as the model layer counts them (`tokenCount`). */
  tokens: (text: string) => number;
  /** The chat's out-of-play settings, by which an edit of his he made no choice on is told or not. */
  tell: OffstageSettings;
}

/**
 * What a briefing is built for: the kind its turn's facts give, who speaks, the message the reply is saved to, the message being
 * written now (left out of the lore scan), and the first history message the prompt kept (the story so far tells what is before it).
 */
interface BriefingFor {
  kind: string;
  speaker: string | null;
  message: string | null;
  writing: string | null;
  keep: string | null;
  /** The lead's model's limits, read when first asked (`TurnLane.#leadLimits`). */
  limits: () => Promise<ModelLimits | null>;
  /** What of the prompt the lead's model is not given (`promptOf`); none for a run given no prompt. */
  notGiven: NotGiven[];
  /** What the receipt found of the prompt that is not as the chat application listed it (R-103), and what Lumiverse's own clipping left out; none for a run given no prompt. */
  cut: Pick<Cut, "notices" | "clipped">;
}

/** What a Settle now gives back: the turn its run is on and the run's id, or the words it was refused in. */
export type Settling = { turn: string; run: string } | { refused: string };

/** Where a Settle now run's reply would go: nowhere, since nothing of it is written into the chat. Its run's record keeps what it wrote. */
const NO_CHAT: ReplyStream = { reasoning: () => undefined, content: () => undefined, progress: () => undefined, toolCalls: () => undefined, finish: () => undefined, error: () => undefined };

/** Waits for `ready`; false, at once, when `signal` aborts first. */
async function unlessAborted(ready: Promise<unknown>, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false;
  const aborted = Promise.withResolvers<false>();
  const onAbort = (): void => aborted.resolve(false);
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([ready.then(() => true), aborted.promise]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

type Ended = Extract<ChatChange, { kind: "generation-ended" }>;

export class TurnLane implements TurnPlayer, ChatChanges {
  readonly #d: TurnLaneDeps;
  /** Ends heard for a generation whose intake goes on and has no run yet; recorded once its run has given its reply. */
  readonly #early = new Map<string, Ended>();
  /** How many runs of the turn before each turn stopped at the wait's limit as it began (`previous.run.stopped`), by user and turn. */
  readonly #stoppedAt = new Map<string, number>();
  /** The drawn layer's versions each turn's world state left given to its session (`drawnGiven` and what it printed), by user and turn; lost on restart, when a layer is printed once more. */
  readonly #drawnAfter = new Map<string, Record<string, string>>();
  /** The generations whose intake goes on and has no run yet. */
  readonly #taking = new Set<string>();
  /** By chat: the intakes going on, the newest last; each waits for the one before it to hold its run, or to end. */
  readonly #intakes = new Map<string, Promise<void>>();
  /** Changes being recorded, so the next intake can wait for them. */
  readonly #recording = new Set<Promise<unknown>>();
  /** By chat: the turns whose deleted message was heard of, cancelled and told to RPH then, until the chat's next comparison. */
  readonly #deletedTold = new Map<string, Set<string>>();
  /** By user and chat: the generations Lumiverse told as begun and not yet as ended (`#generatingIn`). */
  readonly #generating = new Map<string, Set<string>>();
  /**
   * By user and chat: the newest generation whose intake goes on and has not kept its request yet, with the lore Lumiverse said
   * activated for it, heard after the request was taken in; the intake keeps it with the request's own.
   */
  readonly #lateLore = new Map<string, { generation: string; lore: TagLore[] }>();

  constructor(deps: TurnLaneDeps) {
    this.#d = deps;
  }

  /**
   * What the lane does once at a start, before any chat is played. Every run kept as going on is one RPE stopped during (plan §10.10
   * "RPE restarted mid-turn", R-87), whatever became of its generation: each is closed, failed in the words of the turn-errors part
   * (`stopped_mid_run`), so its record and the pages say it ended and how, and its turn is marked interrupted with what the run had
   * staged dropped (`#interrupt`). One whose generation's end was recorded keeps its turn as it was tied; one whose end was not is
   * tied to the part Lumiverse saved, as cut short, or dropped, at its chat's next intake (`#catchUp`).
   */
  async preload(): Promise<void> {
    const left = this.#d.runs.leftGoing();
    if (left.length > 0) {
      const ended = await Promise.all(left.map(async (r): Promise<RunRecord> => ({ ...r, status: "failed", ended: r.ended ?? this.#d.clock.now(), error: { code: "failed", detail: await turnErrorWords(this.#d.files, r, "stopped_mid_run") } })));
      await this.#d.writes.run((db) => ended.forEach((r) => this.#interrupt(db, r)), "ending the runs RPE stopped during");
    }
  }

  /**
   * A run RPE stopped during, inside a write: kept as ended; its turn (a continue's, its held turn) marked interrupted; and what the
   * run had staged there taken back in every lane, its jobs' rows left (R-87): a continue's held turn whole, any other run's from its
   * marks (a first run's, the whole turn's own).
   */
  #interrupt(db: Database, r: RunRecord): void {
    this.#d.runs.put(db, r);
    const turn = r.held ?? r.turn;
    this.#d.marks.set(db, r.user, [turn], "interrupted", this.#d.clock.now());
    const store = this.#d.store.user(r.user);
    const row = store.turn(turn);
    if (row === null || row.status === "dropped" || row.joined !== null) return;
    const own = r.held !== null;
    store.takeBack(turn, own ? -1 : (r.mark ?? -1));
  }

  async play(tagged: TaggedTurn, out: ReplyStream, signal: AbortSignal): Promise<void> {
    const received = this.#d.clock.now();
    // Intake's own steps and its waits for the turn before, each a stretch of the run's time, one after another from `received`
    // (plan §4.7: intake is timed "not counting any wait for the previous turn's work, which is reported on its own"): kept on the
    // run and logged; measured, never acted on.
    const took: IntakeStep[] = [];
    const waits: Stretch[] = [];
    let mark = received;
    const lap = (step: string): void => {
      const now = this.#d.clock.now();
      took.push({ step, from: mark, to: now });
      mark = now;
    };
    /** `work`, awaited; while the turn before has work going on (`going`), a wait of its own, never part of a step. */
    const waited = async <T>(work: Promise<T>, going: boolean): Promise<T> => {
      try {
        return await work;
      } finally {
        if (going) {
          const now = this.#d.clock.now();
          waits.push({ from: mark, to: now });
          mark = now;
        }
      }
    };
    const { tag } = tagged;
    const { user, chat } = tag;
    const reads = this.#d.reads();
    if (reads === null) throw new Error(await turnErrorWords(this.#d.files, tag, "no_lumiverse"));
    const store = this.#d.store.user(user);
    // One intake at a time for a chat (plan §10.1): from here until its run is held, which the next one then waits for as the turn
    // before. A request Lumiverse stops listening to before its turn begins ends there, having begun nothing.
    const intake = this.#queue(user, chat);
    this.#taking.add(tag.generation);
    const chatKey = `${user}\u0000${chat}`;
    this.#lateLore.set(chatKey, { generation: tag.generation, lore: [] });
    const admitted = (): void => {
      intake.done();
      this.#taking.delete(tag.generation);
      if (this.#lateLore.get(chatKey)?.generation === tag.generation) this.#lateLore.delete(chatKey);
    };
    try {
      if (intake.waiting) {
        // The player is shown that this request waits for another of the chat's, in the words of the progress part.
        const line = lines(await loadGuidance(this.#d.files, { user, chat, session: NO_SESSION }).part(PARTS.progress))?.line("waiting_previous");
        if (line !== undefined) out.progress(line);
      }
      lap("queue");
      if (!(await waited(unlessAborted(intake.turn, signal), intake.waiting))) return;

      // The chat, and its folders.
      await this.#chat(reads, user, chat);
      lap("chat");
      // What Lumiverse saved for generations whose end was not recorded (`#catchUp`), once every change heard so far is recorded: the
      // turn before's end among them, so waiting for those is a wait for the turn before's work, kept apart from the steps.
      await waited(this.settled(), this.#recording.size > 0);
      await this.#catchUp(reads, user, chat);
      lap("catch-up");

      // The chat's path compared with the turn tree, what it found kept with the chat, and the turns that left it told (`#compare`). A
      // new reply's message is the turn at hand; a swipe or a regenerate writes a new swipe of the message its attempts were tied to.
      const heardUpTo = this.#d.store.user(user).heardCount(chat);
      const steps = await reads.path(chat);
      if (steps === null) throw new Error(await turnErrorWords(this.#d.files, tag, "no_chat", { chat }));
      lap("path");
      const replaced = tag.kind === "swipe" || tag.kind === "regenerate" ? tag.target.message : null;
      await this.#compare(user, chat, steps, tag.kind === "new" ? tag.target.message : null, replaced, heardUpTo);
      lap("compare");

      // The chat's settings and texts, read before the turn is made: they are its levels' files, whatever session the turn plays in.
      const base: Scope = { user, chat, session: NO_SESSION };
      const guidance = loadGuidance(this.#d.files, base);
      const [settings, progress, notices, errors] = await Promise.all([turnSettings(this.#d.files, base, this.#d.log), guidance.part(PARTS.progress), guidance.part(PARTS.notices), guidance.part(PARTS.errors)]);
      lap("settings");

      // The previous turn's run: waited for up to its limit, then stopped where it stands; Lumiverse stopping this request first ends the
      // wait, and the request, there, the previous run going on. The last turn's run as kept, before this one's joins it.
      const stopped = await waited(this.#previous(user, chat, settings, lines(progress), out, signal), this.#d.runs.ofChat(user, chat).length > 0);
      if (stopped === null || signal.aborted) return;
      const last = this.#d.runs.ofChatKept(user, chat, 1)[0] ?? null;
      lap("previous");

      // The turn: a new attempt, begun at the point the generation starts from (`generationStart`): the point the extension's question
      // is answered at, on the path just read, with the same answer. A continue too plays on a turn of its own, held open until
      // Lumiverse's end names the message it was saved to, which decides its turn (plan §10.10 "Continue", R-192 (e)): what it changes is
      // held there, and no other turn is written to before then. The message its tag names is a first word only: the held turn is begun
      // after that message's turn and plays in that turn's session (`#goingOn`); where the tag could not tell, after the path's last
      // turn. A reply a branch shares with the chat it was made from is that chat's turn (plan §6.3, §10.10 "Branch"): a continue of it
      // plays on in a turn of the branch's own, begun after it at that point, and the chat it came from keeps it as it was.
      const start = generationStart(store, chat, seenOf(steps), { kind: tag.kind, target: tag.target });
      const { goesOn } = start;
      const target = tag.kind === "impersonate" ? null : tag.target.message;
      const tied = goesOn === null ? null : this.#tiedTo(user, chat, goesOn);
      // The turn the tag's message is tied to, of this chat: a continue's held turn is told as a continue of it, and plays in its session.
      const named = tied !== null && tied.turn.chat === chat ? tied.turn : null;
      const begun = await this.#d.writes.run(() => store.beginTurn({ chat, kind: tag.kind, generation: tag.generation, on: start.node }), "beginning a turn");
      if (stopped.length > 0) this.#stoppedAt.set(`${user}\n${begun.id}`, stopped.length);
      // The knowledge switch and threshold in force are recorded at the turn's start where the state there differs, so every reader
      // judges a secret by what held at its point of the path.
      const startWorld = store.stateFor(begun.id, null).state.world;
      const knowledge = knowledgeChange(startWorld, await this.#d.secretSettings({ user, chat, world: this.#d.store.env.worlds(startWorld.revision) ?? null }));
      if (knowledge.length > 0) await this.#d.writes.run(() => store.addChanges(begun.id, knowledge), "recording the knowledge settings");
      // The session the turn plays in (plan §11): the one in force at it (`#sessionAt`), or one opened now for the scene the story record
      // holds open there (or for none), starting from the summary of the scene before it. A swipe or a regenerate may play on in the
      // session an earlier attempt at its message played in, any turn in the turn it follows; a continue plays in the session of the turn
      // its tag names (`#goingOn`). A branch's first turn begins its session as the one it follows stood there (`#forkFrom`): a continue of
      // a reply the branch shares, as that reply's turn left it.
      const earlierAttempts = replaced === null ? [] : store.swipes(chat, replaced).flatMap((t) => (t.id === begun.id ? [] : [t.id]));
      const inForce = named !== null ? this.#goingOn(user, chat, named.id) : this.#sessionAt(user, chat, begun.id, [begun.id, begun.parent, ...earlierAttempts]);
      const session = inForce.session ?? (await this.#d.writes.run(() => store.openSession({ chat, scene: inForce.scene, turn: begun.id }), "opening a session"));
      const scope = { user, chat, session: session.id, turn: begun.id };
      // A session already open is told the summary it opens with as the story record now holds it (the same again writes nothing).
      if (inForce.session === null) await this.#begin(scope, begun, inForce);
      else await this.#d.harness().sessions.opensWith(scope, inForce.summary ?? "");
      // The chat's notes as they stand at the turn's start (plan §5.4): the writes of each turn before it on its path, and a continue's
      // own; a branch starts with its branch point's. Notes that cannot be put there are logged, and the turn goes on with them as they are.
      const cutAt = replaced === null ? -1 : store.path(chat).findIndex((e) => e.message === replaced);
      const earlier = store.line(chat).flatMap((l) => ((cutAt >= 0 && l.at >= cutAt) || l.turn === begun.id ? [] : [l.turn]));
      await this.#d.notes.follow(user, chat, { turns: [...earlier, begun.id], branchOf: store.chat(chat)?.sourceChat ?? null }).catch((error: unknown) =>
        this.#d.log.error("The chat's notes could not be put as they stand at this turn's start.", { turn: begun.id, error: words(error) }),
      );

      // The prompt as the lead's model takes it (plan §4.2 "A prompt with pictures"): a picture, in any message, goes to it only where its
      // model is known to take pictures. Its limits are read once, and only where something needs them.
      let leadLimits: Promise<ModelLimits | null> | undefined;
      const limits = (): Promise<ModelLimits | null> => (leadLimits ??= this.#leadLimits(scope, settings.lead));
      const pictured = tagged.prompt.some((m) => typeof m.content !== "string" && m.content.some((part) => isRecord(part) && part.type === "image_url"));
      const { messages, left } = promptOf(tagged.prompt, pictured && (await limits())?.pictures?.takes === true);
      const prefill = prefillOf(tagged, messages);
      // What Lumiverse puts in front of the reply when it saves it: for a continue, the text the swipe of the message its tag names held
      // (none where the tag named none: what it was is read at the end, from the turn the end names), else the prefill.
      const goneOn = goesOn === null ? undefined : (await reads.messagesById(chat, [goesOn]))[0];
      const front = tag.kind === "continue" ? ((tag.target.swipe === null ? undefined : goneOn?.saves[tag.target.swipe]?.text) ?? goneOn?.text ?? "") : (prefill ?? "");

      const over = Promise.withResolvers<void>();
      const run: Run = {
        id: crypto.randomUUID(),
        traceRun: null,
        user,
        turn: begun.id,
        chat,
        session: session.id,
        generation: tag.generation,
        target,
        swipe: target === null && tag.kind !== "continue" ? null : tag.target.swipe,
        kind: tag.kind,
        status: "running",
        received,
        started: null,
        firstWord: null,
        released: null,
        finished: null,
        ended: null,
        intent: null,
        thinking: [],
        withoutIntent: false,
        intake: null,
        wait: null,
        folder: null,
        usage: null,
        lookups: { searches: 0, reads: 0 },
        reply: "",
        progress: [],
        error: null,
        stoppedBy: null,
        lastText: false,
        notGiven: [],
        base: front,
        saved: null,
        settled: null,
        held: tag.kind === "continue" ? begun.id : null,
        mark: null,
        stop: new AbortController(),
        over: over.promise,
        firstCall: null,
      };
      // The run is held in the one write that keeps it: a panel's tap, refused while a run of the chat is held, lands before it or not at all.
      await this.#d.writes
        .run((db) => {
          // The lore Lumiverse said activated for the generation: heard before the request, and since; heard from now on, it joins the kept record.
          const late = this.#lateLore.get(chatKey);
          if (late?.generation === tag.generation) this.#lateLore.delete(chatKey);
          this.#d.prompts.keep(db, { user, turn: begun.id, chat, layout: tagged.layout, prompt: tagged.prompt.map(({ role, content }) => ({ role, content })), lore: [...tagged.lore, ...(late?.generation === tag.generation ? late.lore : [])], cut: tagged.cut, summarized: summarizedOf(tag, steps), speaker: tag.speaker.id, persona: tag.persona, at: received });
          this.#d.runs.put(db, run);
          this.#d.runs.hold(run);
        }, "keeping the turn's request")
        .catch((error: unknown) => {
          over.resolve();
          throw error;
        });
      admitted();
      lap("begin");
      // The chat's PROMPT-MAP.md follows the preset this turn's prompt came from and its map, written only where its text changed.
      void this.#d.prompts.mapFile(user, chat);

      let request: TurnRequest;
      let ask: FolderAsk;
      try {
        // Who leads is the config's line alone (`lead:`): where no level names one, no agent is chosen here, and the turn ends with the
        // turn-errors line that says so.
        if (settings.lead === null) throw new Error(await turnErrorWords(this.#d.files, { user, chat }, "no_lead"));
        // The briefing's blocks, and what has happened since the last turn.
        const found = { steps, notices: lines(notices), guidance, last, again: named !== null, replaced, hiddenReadable: settings.hiddenReadable, editedBudget: settings.editedBudget, deleted: { budget: settings.deletedBudget, words: settings.deletedWords }, notAppliedBudget: settings.notAppliedBudget, jobBudget: settings.jobBudget, tokens: tokenCount(settings.charsPerToken), tell: settings.taps.tell };
        const writes = tag.target.message !== null && (tag.kind === "new" || tag.kind === "swipe" || tag.kind === "regenerate");
        const at: BriefingFor = { kind: tag.kind, speaker: tag.speaker.name, message: target, writing: writes ? tag.target.message : null, keep: tagged.cut.keep?.id ?? null, limits, notGiven: left, cut: tagged.cut };
        // A continue whose tag names a turn's message is told what is new since that turn's runs were told, as a continue of it.
        const [{ blocks: briefing, loreMap, activated, storyTime, notGiven }, { items: since, told }] = await Promise.all([this.#briefing(reads, guidance, scope, at, steps, settings), this.#since(reads, user, named ?? begun, found)]);
        run.notGiven = notGiven;
        // What he asked for beside his words (`requests.ts`): a turn that answers a new message is told what waits; a swipe or a regenerate,
        // what the earlier attempts at its message were told and the swipe's mode that waits; a continue is told nothing again. Each is one
        // line of `asked`, in the notices part's words: a panel's tap, a depth asked for the message, a swipe's mode with what he typed.
        const asking = tag.kind === "continue" ? [] : this.#d.requests.forTurn(user, chat, replaced === null ? null : earlierAttempts);
        const said = (line: string | undefined): string[] => (line === undefined || line.trim() === "" ? [] : [line]);
        const asked = asking.flatMap((r) => {
          if (r.kind !== "panel") {
            const { choice, words: typed } = r.asked as ComposerAsk;
            return said(lines(notices)?.line(r.kind === "depth" ? "depth_asked" : "swipe_asked", { [r.kind === "depth" ? "depth" : "mode"]: choice, ...(typed !== null && typed.trim() !== "" ? { words: typed } : {}) }));
          }
          // A tap played now went into the chat as his message: the line marks it so (`sent`), with the values the message may not carry.
          const tap = r.asked as PanelAsk;
          const values = Object.entries(tap.values).map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
          return said(lines(notices)?.line("panel_request", { what: tap.what, from: tap.from, ...(tap.on !== null ? { on: tap.on } : {}), ...(tap.action !== null ? { action: tap.action } : {}), ...(values.length > 0 ? { values: values.join(", ") } : {}), ...(r.played ? { sent: true } : {}) }));
        });
        // The feedback he typed in Lumiverse's regenerate dialog, where the door told it apart for certain (R-198): a line of `asked` too,
        // before the Author's first call. Not told apart, it stands where Lumiverse put it in the prompt, and no line comes from it.
        const typed = tagged.feedback;
        if (typed?.found === "separated") asked.push(...said(lines(notices)?.line("feedback_typed", { text: typed.text, position: typed.position })));
        lap("briefing");
        const sampling = samplingOf(tagged.parameters);
        const maxTokens = maxTokensOf(tagged.parameters);
        const firstKept = keptFirst(tagged.cut, steps);
        request = {
          scope,
          // RPE keeps a tree, so a turn always says what it follows: null, for a chat's first turn and a swipe of it, is no earlier turn.
          parent: begun.parent,
          kind: tag.kind,
          ...(tag.speaker.name !== null ? { speaker: tag.speaker.name } : {}),
          lead: settings.lead,
          prompt: messages,
          // Each stretch the window left out, with the oldest history the model's own window trimmed after it, and whether the story
          // record covers each, read at this turn along its own line.
          leftOut: leftOutOf(firstKept, steps.map((s) => s.id), firstKept === null ? new Set() : storyCoverage({ store: this.#d.store, user, chat, turn: begun.id }).covered),
          briefing,
          carry: settings.carry,
          since,
          ...(asked.length > 0 ? { asked } : {}),
          ...(prefill !== undefined ? { prefill } : {}),
          ...(sampling !== undefined ? { presetSampling: sampling } : {}),
          ...(maxTokens !== undefined ? { replyMaxTokens: maxTokens } : {}),
        };
        // Kept before the run: what the turn was told, so no later turn is told it again (for a continue of a named turn, what that turn
        // was told), and the requests it was told, kept with it; and on the turn's row, the story time its briefing gave (plan Appendix B
        // `turn`), as the migration keeps a carried turn's. A continue's held turn is a row of its own: joined to the turn it extended,
        // that turn keeps its own.
        const timed = storyTime !== null;
        // The feedback is kept with this attempt, so the attempts after it carry it with the one it replaced.
        const kept = typed !== undefined && typed.found !== "none";
        if (told.length > 0 || asking.length > 0 || timed || kept) {
          await this.#d.writes.run((db) => {
            if (told.length > 0) this.#d.since.told(db, user, (named ?? begun).id, told);
            this.#d.requests.tell(db, user, asking.map((r) => r.id), begun.id);
            if (timed) store.updateTurn(begun.id, { storyTime });
            if (kept) db.run("INSERT INTO turn_told (user, turn, kind, body, at) VALUES (?, ?, ?, ?, ?)", [user, begun.id, FEEDBACK_TOLD, JSON.stringify(typed), this.#d.clock.now()]);
          }, "keeping what a turn was told and its story time");
          if (asking.length > 0) this.#d.requests.changed(user, chat);
        }
        // The cast's views for the folder are read now, at the turn's start, beside the Author's first call; the folder awaits them.
        const cast = this.#castFolder(scope, guidance, settings);
        cast.catch(() => undefined);
        // Each activated entry's text in the lore file is the text the prompt carried, as the door found it there (`TagLore.text`), never
        // the entry read again: the lore map lists the tag's entries first, in its order. One the check took out, or not found, has none.
        const lore = activated.map(({ text: _read, ...entry }, i) => {
          const sent = tagged.lore[i]?.text;
          return sent === undefined ? entry : { ...entry, text: sent };
        });
        ask = { scope, guidance, tagged, messages, request, loreMap, lore, attempts: replaced === null ? [] : this.#attempts(user, chat, replaced, begun.id), cast, received };
        lap("kept");
      } catch (error) {
        // The run never began: it ends here, failed, so the turn after it does not wait for it. The throw tells Lumiverse.
        run.status = "failed";
        run.error = { code: "failed", detail: words(error) };
        run.ended = this.#d.clock.now();
        run.intake = took;
        run.wait = waits;
        await this.#d.runs.save(run, "keeping a turn's run that never began").catch((e: unknown) => this.#d.log.error("A turn's run could not be kept.", { turn: run.turn, error: words(e) }));
        over.resolve();
        throw error;
      }
      run.intake = took;
      run.wait = waits;
      this.#d.log.debug("A turn's intake, in milliseconds by step.", { turn: begun.id, ...Object.fromEntries(took.map((s) => [s.step, s.to - s.from])), wait: waits.reduce((ms, w) => ms + w.to - w.from, 0) });
      // The turn's folder (plan §5.3), for the agents it delegates to and for the player: the Author has the same in its context. It is
      // written alongside the Author once the Author's first model call has gone out (§10.1 step 6), so nothing of it is read or written
      // before that call; one that cannot be written is told on the run and in the log, and the turn goes on. The run is over for the
      // chat once its folder is written too: `#run` is given an `over` it resolves when the lead's run is over, which resolves the real
      // one only then, so the turn after this one and a stop wait for both, and the run's record keeps how the writing went.
      const ended = Promise.withResolvers<void>();
      const folder = writeAlongside({ files: this.#d.files, live: this.#d.harness().live }, ask, ended.promise, () => {
        run.folder = { from: this.#d.clock.now(), to: null, error: null };
      })
        .then(
          () => null,
          (error: unknown) => words(error),
        )
        .then((error) => {
          run.folder = { from: run.folder?.from ?? this.#d.clock.now(), to: this.#d.clock.now(), error };
          if (error !== null) this.#d.log.error("The turn's folder could not be written in full.", { turn: run.turn, error });
        });
      const afterFolder: PromiseWithResolvers<void> = {
        promise: over.promise,
        reject: over.reject,
        resolve: () => {
          ended.resolve();
          void folder
            .then(() => this.#d.runs.save(run, "keeping how a turn's folder was written"))
            .catch((error: unknown) => this.#d.log.error("A turn's run could not be kept.", { turn: run.turn, error: words(error) }))
            .finally(() => over.resolve());
        },
      };
      // The projection book follows the story once the run's work is over, beside the chat, never on the reply's path.
      void over.promise.then(() => this.#project(user, chat));
      await this.#run(run, request, out, signal, { errors: lines(errors), lastText: settings.lastText, hold: tagged.whole === true ? (tagged.hold ?? null) : null }, afterFolder);
      const early = this.#early.get(tag.generation);
      if (early !== undefined) {
        this.#early.delete(tag.generation);
        this.changed(early);
      }
    } finally {
      admitted();
      this.#early.delete(tag.generation);
    }
  }

  // ---------------------------------------------------------------- Lumiverse's changes

  changed(change: ChatChange): void {
    const user = this.#d.owner();
    if (user === null) return;
    let work: Promise<unknown> | null = null;
    if (change.kind === "generation-started") this.#generatingIn(user, change.chat).add(change.generation);
    else if (change.kind === "generation-ended") {
      this.#generatingIn(user, change.chat).delete(change.generation);
      work = this.#ended(user, change);
    } else if (change.kind === "message-deleted") work = this.#deleted(user, change.chat, change.message).then(() => this.#atRest(user, change.chat));
    else if (change.kind === "message-edited") work = this.#edited(user, change.chat, change.message, change.hidden, change.shown);
    // A swipe flipped, added or deleted changes only which swipe shows, which the question's path carries; his edit of the swipe that
    // shows, through the swipe route and outside a generation, is his edit.
    else if (change.kind === "message-swiped" && change.updated === true) work = this.#edited(user, change.chat, change.message, null, change.shown);
    else if (change.kind === "message-swiped") work = this.#atRest(user, change.chat);
    else if (change.kind === "chat-forked") work = this.#forked(user, change.chat, change.from, change.ids);
    else if (change.kind === "lore-activated") work = this.#loreHeard(user, change.chat, change.lore);
    // Lumiverse's breakdown of a saved reply names the feedback typed in its regenerate dialog: its word governs what the turn kept.
    else if (change.kind === "feedback-told") work = this.#feedbackTold(user, change.generation, change.feedback);
    // A chat deleted in Lumiverse: its folders are kept as a deleted chat's, and its turns stay in the store.
    else if (change.kind === "chat-deleted") work = this.#d.chats.deleted(user, change.chat, this.#d.clock.now()).then(() => this.#d.forgetChat(user, change.chat));
    if (work === null) return;
    const done = work.catch((error: unknown) => this.#d.log.error("A change Lumiverse told of could not be recorded; the chat's next turn finds it again.", { chat: change.chat, change: change.kind, error: words(error) }));
    this.#recording.add(done);
    void done.finally(() => this.#recording.delete(done));
    // A change of the path (a delete, a swipe, an edit, a branch) brings the projection book into step with it.
    if (change.kind === "message-deleted" || change.kind === "message-edited" || change.kind === "message-swiped" || change.kind === "chat-forked") void done.then(() => this.#project(user, change.chat));
  }

  /**
   * The breakdown's word on the feedback typed in Lumiverse's regenerate dialog for a regeneration's generation (R-198): where it
   * disagrees with what the turn kept (told apart at its start, not told apart, or nothing kept), the turn keeps the breakdown's, which
   * the attempts after it carry, and the correction is told on the turn (`feedback-corrected`) for the Turn page; where it agrees, the
   * turn keeps that it was confirmed (`feedback-confirmed`). A generation of no regeneration of RPE's is passed over.
   */
  async #feedbackTold(user: string, generation: string, said: { position: "system" | "user"; text: string } | null): Promise<void> {
    const run = this.#d.runs.byGeneration(user, generation);
    if (run === null || (run.kind !== "swipe" && run.kind !== "regenerate")) return;
    const was = this.#feedbackOf(user, run.turn);
    const now: Feedback = said === null ? { found: "none" } : { found: "separated", position: said.position, text: said.text };
    // Nothing kept and none typed is no correction.
    if (was === null && now.found === "none") return;
    const at = this.#d.clock.now();
    if (was !== null && JSON.stringify(was) === JSON.stringify(now)) {
      await this.#d.writes.run((db) => db.run("INSERT INTO turn_told (user, turn, kind, body, at) VALUES (?, ?, ?, ?, ?)", [user, run.turn, FEEDBACK_CONFIRMED, JSON.stringify(now), at]), "keeping the breakdown's word on a regeneration's feedback");
      return;
    }
    await this.#d.writes.run((db) => {
      db.run("INSERT INTO turn_told (user, turn, kind, body, at) VALUES (?, ?, ?, ?, ?)", [user, run.turn, FEEDBACK_TOLD, JSON.stringify(now), at]);
      db.run("INSERT INTO turn_told (user, turn, kind, body, at) VALUES (?, ?, ?, ?, ?)", [user, run.turn, FEEDBACK_CORRECTED, JSON.stringify({ was, now }), at]);
    }, "keeping the breakdown's word on a regeneration's feedback");
  }

  /** The projection book (`lore.projection`) brought up to date for the chat, beside everything else: a failure is logged and touches no turn. */
  #project(user: string, chat: string): void {
    this.#d.projection.refresh(user, chat).catch((error: unknown) => this.#d.log.error("The chat's projection book could not be brought up to date.", { chat, error: words(error) }));
  }

  /**
   * What was missed while the event socket was closed is found again at each chat's next intake, by the comparison and by `#catchUp`. A
   * generation whose end was missed is no longer known to run: what is heard next is taken as heard outside one.
   */
  reopened(): void {
    this.#generating.clear();
    // What changed while the socket was closed may have moved any chat's path: each chat played on RPE has its projection book checked.
    const user = this.#d.owner();
    if (user !== null) for (const { chat } of this.#d.runs.chats(user)) this.#project(user, chat);
  }

  /** The generations Lumiverse told as begun in the user's chat and not yet as ended: while one runs, its writes to the chat are its own. */
  #generatingIn(user: string, chat: string): Set<string> {
    const key = `${user}\u0000${chat}`;
    let going = this.#generating.get(key);
    if (going === undefined) {
      going = new Set();
      this.#generating.set(key, going);
    }
    return going;
  }

  /**
   * A message's text, hidden mark or `extra` changed (plan §4.2, R-21): the hidden mark is kept for the next question; outside a
   * generation in the chat, the text of the swipe it shows is kept as an edit of the turn played on it (`heardEdit`), which a change
   * that left the text as it was does not change. Lumiverse's own writes while a generation runs (its save, a continue's appended
   * text, its macro re-save) are no edit of his: the generation's end ties them. Both set facts mirrored from Lumiverse, and no world
   * state; a chat the store does not know keeps nothing. Whether it is his edit is told by what was heard before it; both go to the
   * write queue at once, in the order heard.
   */
  #edited(user: string, chat: string, message: string, hidden: boolean | null, shown: ShownSwipe): Promise<void> {
    const store = this.#d.store.user(user);
    const his = this.#generatingIn(user, chat).size === 0;
    return this.#d.writes.run(() => {
      if (hidden !== null) store.markHidden(chat, message, hidden);
      if (his) store.heardEdit(chat, message, shown.date, shown.hash);
    }, "keeping a mark or an edit Lumiverse told of");
  }

  /**
   * A chat forked from another, heard when it is made (plan §6.3, §10.10 "Branch"): where the store holds the source and not yet the
   * branch, the branch is made sharing the source's tree up to the last message of the source's path the id map names, so its first
   * question is answered as the source stood there. A source the store never saw is left to the branch's first turn (`#chat`).
   */
  async #forked(user: string, chat: string, from: string, ids: Record<string, string>): Promise<void> {
    const store = this.#d.store.user(user);
    await this.#d.writes.run(() => {
      if (store.chat(chat) === null && store.chat(from) !== null) store.branchChat({ id: chat, from, map: ids });
    }, "making a chat forked from another");
  }

  /**
   * Lore Lumiverse said activated for a generation of the chat, heard after its request was taken in (plan §9: "heard after it, it is
   * joined to the turn's record then"): an intake still under way keeps it with the request's own; else it joins the record of the
   * chat's newest turn going on. Heard before, the door handed it with the request, and nothing is left to do.
   */
  async #loreHeard(user: string, chat: string, lore: readonly TagLore[]): Promise<void> {
    await this.#d.writes.run((db) => {
      const taking = this.#lateLore.get(`${user}\u0000${chat}`);
      if (taking !== undefined) {
        taking.lore.push(...lore);
        return;
      }
      const going = this.#d.runs.ofChat(user, chat).sort((a, b) => b.received - a.received)[0];
      if (going !== undefined) this.#d.prompts.addLore(db, user, going.turn, lore);
    }, "joining lore heard late to its turn's record");
  }

  /** Resolves once every change heard so far is recorded. */
  async settled(): Promise<void> {
    while (this.#recording.size > 0) await Promise.allSettled([...this.#recording]);
  }

  /** How many intakes go on now and have no run held yet: a restart waits for them as for the runs (none of them is a run yet). */
  intakesGoing(): number {
    return this.#taking.size;
  }

  /** How many runs of the turn before `turn` it stopped at the wait's limit as it began, for the fact `previous.run.stopped`; 0 once RPE restarted. */
  stoppedAt(user: string, turn: string): number {
    return this.#stoppedAt.get(`${user}\n${turn}`) ?? 0;
  }

  /**
   * The prompt's window for the chat as its latest prompt put it (the Story page's coverage): the first history message it kept, past
   * what the model's own window trimmed (null where it kept them all, or no prompt was made yet), and whether agents may read the
   * messages he hid.
   */
  async windowOf(user: string, chat: string): Promise<{ edge: string | null; hiddenReadable: boolean }> {
    const { hiddenReadable } = await turnSettings(this.#d.files, { user, chat, session: NO_SESSION }, this.#d.log);
    const cut = this.#d.prompts.latestCut(user, chat);
    if (!isRecord(cut)) return { edge: null, hiddenReadable };
    const keep = isRecord(cut.keep) && typeof cut.keep.id === "string" ? cut.keep.id : null;
    const reads = this.#d.reads();
    if (!isRecord(cut.trimmed) || reads === null) return { edge: keep, hiddenReadable };
    const steps = await reads.path(chat);
    return { edge: steps === null ? keep : (keptFirst(cut as unknown as TaggedTurn["cut"], steps)?.id ?? null), hiddenReadable };
  }

  /**
   * The story so far at the chat's head, as the next briefing lays it out (the Story page's route): for the history the latest prompt's
   * window left out, by the part `story-so-far` in force for the chat, within its share of the lead's window. Empty where the window left
   * nothing out, the part is off, or RPE is not set up for a Lumiverse to read the chat's path from.
   */
  async soFarAt(user: string, chat: string): Promise<StorySoFar> {
    const scope = { user, chat, session: NO_SESSION };
    const [settings, part, { edge }] = await Promise.all([turnSettings(this.#d.files, scope, this.#d.log), loadGuidance(this.#d.files, scope).part(PARTS.storySoFar), this.windowOf(user, chat)]);
    const window = this.#leadWindow(await this.#leadLimits(scope, settings.lead), settings.lead, null);
    const reads = this.#d.reads();
    const steps = edge === null || reads === null ? null : await reads.path(chat);
    const kept = steps === null ? -1 : steps.findIndex((s) => s.id === edge);
    if (part?.format !== "template" || kept <= 0) return { text: "", tokens: 0, budget: storySoFarBudget(window, settings.storySoFar), leftOut: [] };
    return storySoFar({ record: storyRecordParts({ store: this.#d.store, user, chat, turn: null }), keptFrom: kept, contextWindow: window, settings: settings.storySoFar, tokens: tokenCount(settings.charsPerToken), layout: part });
  }

  /**
   * Stops a turn's run where it stands (plan §10.10 "Stop"); false when it is not going on. While its
   * reply is not out, Lumiverse is told first: its generation ends as stopped, keeping what it had, and
   * the run stops with the request Lumiverse drops. The run is stopped here in any case.
   */
  async stop(user: string, turn: string): Promise<boolean> {
    const run = this.#d.runs.running(user, turn);
    if (run === undefined) return false;
    if (run.finished === null && run.generation !== null) {
      const generation = run.generation;
      await this.#d.stopGeneration(generation).catch((error: unknown) => this.#d.log.warn("Lumiverse could not be told to stop this turn's generation; the turn is stopped on RPE's side.", { turn, generation, error: words(error) }));
    }
    run.stop.abort(new Error(await turnErrorWords(this.#d.files, run, "player_stopped")));
    return true;
  }

  /**
   * Settle now (plan §10.10 "Edit of a reply", §14 the Turn page): the chat's path compared as a turn's intake compares it, then a run
   * on the newest turn of the path, in the session that turn played in, which holds the scene so far. The run is given no prompt; the
   * briefing a turn is given; what was found since that turn's runs were told, as a continue of it is; and what the player asked, in
   * the words of the notices part (`settle_asked`). Its writes are that turn's, so the World page shows them at once, and nothing of it
   * is written into the chat. It holds the chat's intake until its run is held, and the next turn waits for it as for any run of the
   * turn before it. Refused, in the words of the turn-errors part, while a turn of the chat goes on, where no turn RPE played or
   * carried is on the chat's path, and in a branch whose newest turn is the one it shares with the chat it was made from: that turn is
   * that chat's history too (plan §6.3, shared, not copied), and the branch has no turn of its own for the run's writes.
   */
  async settle(user: string, chat: string): Promise<Settling> {
    const refused = async (name: string, fields: Fields = {}): Promise<Settling> => ({ refused: await turnErrorWords(this.#d.files, { user, chat }, name, fields) });
    const reads = this.#d.reads();
    if (reads === null) return await refused("no_lumiverse");
    const intake = this.#queue(user, chat);
    try {
      if (intake.waiting || this.#d.runs.ofChat(user, chat).length > 0) return await refused("settle_running");
      await this.#chat(reads, user, chat);
      await this.#catchUp(reads, user, chat);
      const heardUpTo = this.#d.store.user(user).heardCount(chat);
      const steps = await reads.path(chat);
      if (steps === null) return await refused("no_chat", { chat });
      await this.#compare(user, chat, steps, null, null, heardUpTo);
      const store = this.#d.store.user(user);
      const onPath = store.line(chat).map((l) => l.turn);
      const newest = onPath.at(-1);
      const turn = newest === undefined ? null : store.turn(newest);
      if (turn === null) return await refused("settle_nothing");
      if (turn.chat !== chat) return await refused("settle_shared");

      const base: Scope = { user, chat, session: NO_SESSION };
      const guidance = loadGuidance(this.#d.files, base);
      const [settings, notices, errors] = await Promise.all([turnSettings(this.#d.files, base, this.#d.log), guidance.part(PARTS.notices), guidance.part(PARTS.errors)]);
      const last = this.#d.runs.ofChatKept(user, chat, 1)[0] ?? null;
      const inForce = this.#goingOn(user, chat, turn.id);
      const session = inForce.session ?? (await this.#d.writes.run(() => store.openSession({ chat, scene: inForce.scene, turn: turn.id }), "opening a session"));
      const scope = { user, chat, session: session.id, turn: turn.id };
      if (inForce.session === null) await this.#d.harness().sessions.open(scope, inForce.summary === null ? {} : { summary: inForce.summary });
      else await this.#d.harness().sessions.opensWith(scope, inForce.summary ?? "");
      await this.#d.notes.follow(user, chat, { turns: onPath, branchOf: store.chat(chat)?.sourceChat ?? null }).catch((error: unknown) =>
        this.#d.log.error("The chat's notes could not be put as they stand at this turn's start.", { turn: turn.id, error: words(error) }),
      );

      const over = Promise.withResolvers<void>();
      const run: Run = {
        id: crypto.randomUUID(),
        traceRun: null,
        user,
        turn: turn.id,
        chat,
        session: session.id,
        generation: null,
        target: null,
        swipe: null,
        kind: "settle",
        status: "running",
        received: this.#d.clock.now(),
        started: null,
        firstWord: null,
        released: null,
        finished: null,
        ended: null,
        intent: null,
        thinking: [],
        withoutIntent: false,
        // A Settle now run has no intake of its own, and writes no folder.
        intake: null,
        wait: null,
        folder: null,
        usage: null,
        lookups: { searches: 0, reads: 0 },
        reply: "",
        progress: [],
        error: null,
        stoppedBy: null,
        lastText: false,
        notGiven: [],
        base: "",
        saved: null,
        settled: null,
        held: null,
        // What it records is the turn's, counted from marks taken as a continue's are, in the write that keeps it and holds it.
        mark: null,
        stop: new AbortController(),
        over: over.promise,
        firstCall: null,
      };
      await this.#d.writes
        .run((db) => {
          Object.assign(run, marksOf(store, turn.id));
          this.#d.runs.put(db, run);
          this.#d.runs.hold(run);
        }, "keeping a Settle now run")
        .catch((error: unknown) => {
          over.resolve();
          throw error;
        });
      intake.done();

      let request: TurnRequest;
      try {
        if (settings.lead === null) throw new Error(await turnErrorWords(this.#d.files, { user, chat }, "no_lead"));
        const found = { steps, notices: lines(notices), guidance, last, again: true, replaced: null, hiddenReadable: settings.hiddenReadable, editedBudget: settings.editedBudget, deleted: { budget: settings.deletedBudget, words: settings.deletedWords }, notAppliedBudget: settings.notAppliedBudget, jobBudget: settings.jobBudget, tokens: tokenCount(settings.charsPerToken), tell: settings.taps.tell };
        const limits = (): Promise<ModelLimits | null> => this.#leadLimits(scope, settings.lead);
        const at: BriefingFor = { kind: run.kind, speaker: null, message: null, writing: null, keep: this.#d.prompts.keptFrom(user, turn.id), limits, notGiven: [], cut: { notices: [], clipped: null } };
        const [{ blocks: briefing, notGiven }, { items, told }] = await Promise.all([this.#briefing(reads, guidance, scope, at, steps, settings), this.#since(reads, user, turn, found)]);
        run.notGiven = notGiven;
        const asked = lines(notices)?.line("settle_asked");
        request = {
          scope,
          parent: turn.parent,
          // To the harness the run goes on with the turn, as a continue does: its work goes on from the turn's newest entry in the session.
          kind: "continue",
          // A Settle now run writes nothing into the chat: it owes the player no reply, so its closing calls end it.
          owesReply: false,
          lead: settings.lead,
          prompt: [],
          briefing,
          carry: settings.carry,
          since: asked === undefined || asked.trim() === "" ? items : [...items, { kind: "request", text: asked }],
        };
        if (told.length > 0) await this.#d.writes.run((db) => this.#d.since.told(db, user, turn.id, told), "keeping what a turn was told");
      } catch (error) {
        run.status = "failed";
        run.error = { code: "failed", detail: words(error) };
        run.ended = this.#d.clock.now();
        await this.#d.runs.save(run, "keeping a Settle now run that never began").catch((e: unknown) => this.#d.log.error("A turn's run could not be kept.", { turn: run.turn, error: words(e) }));
        over.resolve();
        throw error;
      }
      void over.promise.then(() => this.#project(user, chat));
      void this.#run(run, request, NO_CHAT, new AbortController().signal, { errors: lines(errors), lastText: settings.lastText, hold: null }, over).catch((error: unknown) => this.#d.log.error("A Settle now run failed.", { turn: run.turn, error: words(error) }));
      return { turn: turn.id, run: run.id };
    } finally {
      intake.done();
    }
  }

  /**
   * After a turn's writes, or a job's for the turn that started it (plan §11): the scene the story record now holds open at the turn
   * decides its session. When another session is in force there than the one the turn played in, that one is closed as the turn's
   * work; and a scene that has no session yet has one opened as the turn's work, starting from the summary of the scene before it. A
   * dropped turn has none; nor has a continue's held turn that joined the turn it extended, whose sessions are that turn's.
   */
  async sessionsAfter(user: string, chat: string, turn: string): Promise<void> {
    const store = this.#d.store.user(user);
    const played = this.#d.runs.record(user, turn)?.session;
    const row = store.turn(turn);
    if (played === undefined || row === null || row.status === "dropped" || row.status === "joined") return;
    const now = this.#sessionAt(user, chat, turn, [turn]);
    if (now.session?.id === played) return;
    const sessions = this.#d.harness().sessions;
    await this.#d.writes.run(() => store.closeSession(played, turn), "closing the session of a scene that ended");
    await sessions.close({ user, chat, session: played, turn });
    if (now.session !== null || now.scene === "") return;
    const opened = await this.#d.writes.run(() => store.openSession({ chat, scene: now.scene, turn }), "opening the session of a scene that began");
    await sessions.open({ user, chat, session: opened.id, turn }, now.summary === null ? {} : { summary: now.summary });
  }

  /**
   * The session in force at a turn (plan §11): the one the story record's open scene has on the turn's line (`sceneSession`). Where no
   * session opened on that line is for the scene, the first that a turn of `on` played in and that is the chat's, for the same scene. A
   * session opened at a turn's start (the chat's first, or the first after a scene ended with none open) is that place's, not that
   * attempt's: a swipe of the turn is a branch of the same session file, and the turns after it follow it there, so an earlier attempt
   * shown again finds in that file what followed the attempt it replaces.
   */
  #sessionAt(user: string, chat: string, turn: string, on: readonly (string | null)[]): SceneSession {
    const at = sceneSession(this.#d.store, user, chat, turn);
    if (at.session !== null) return at;
    const store = this.#d.store.user(user);
    for (const t of on) {
      const played = t === null ? undefined : this.#d.runs.record(user, t)?.session;
      const session = played === undefined ? null : store.session(played);
      if (session !== null && session.chat === chat && session.scene === at.scene) return { ...at, session: { ...session, closedBy: null } };
    }
    return at;
  }

  /**
   * The session a run that goes on with a turn plays in (a continue, a Settle now): the one the turn's first run played in, which holds
   * the turn's own work, even where that turn then moved the story to a new scene and opened its session as its work (plan §10.10
   * "Continue", §11). For a turn no run of RPE's played in this chat (one a migration carried, one a branch shares), the one in force at it.
   */
  #goingOn(user: string, chat: string, turn: string): SceneSession {
    const at = this.#sessionAt(user, chat, turn, [turn]);
    const first = this.#d.runs.ofTurn(user, turn)[0]?.session;
    const played = first === undefined ? null : this.#d.store.user(user).session(first);
    return played !== null && played.chat === chat ? { ...at, session: played } : at;
  }

  /**
   * A session opened for a turn, begun in RPH: as the session in force at the branch point stood there, forked, for a branch's first
   * turn (`#forkFrom`, plan §10.10 "Branch": sessions start as they stood at that point); else from the summary of the scene before. A
   * fork that cannot be made is logged, and the session is begun as any other is.
   */
  async #begin(scope: Scope & { turn: string }, turn: TurnRow, inForce: SceneSession): Promise<void> {
    const sessions = this.#d.harness().sessions;
    const from = this.#forkFrom(scope.user, scope.chat, turn, inForce.scene);
    if (from !== null) {
      try {
        await sessions.fork(from, { user: scope.user, chat: scope.chat, session: scope.session });
        return;
      } catch (error) {
        this.#d.log.error("A branch's session could not be begun as it stood at the branch point; it is begun from the scene's summary.", { turn: scope.turn, error: words(error) });
      }
    }
    await sessions.open(scope, inForce.summary === null ? {} : { summary: inForce.summary });
  }

  /**
   * Where a branch's first turn forks its session from: for a turn that follows a turn of the chat the branch was made from, the session
   * in force at that turn there, where that turn played in it and it is for the scene in force here. Null for any other turn, and for
   * one that follows a turn no run of RPE's played (a migrated one).
   */
  #forkFrom(user: string, chat: string, turn: TurnRow, scene: string): (Scope & { turn: string }) | null {
    const parent = turn.parent === null ? null : this.#d.store.user(user).turn(turn.parent);
    if (parent === null || parent.chat === chat) return null;
    const there = sceneSession(this.#d.store, user, parent.chat, parent.id).session;
    if (there === null || there.scene !== scene || !this.#d.runs.ofTurn(user, parent.id).some((r) => r.session === there.id)) return null;
    return { user, chat: parent.chat, session: there.id, turn: parent.id };
  }

  // ---------------------------------------------------------------- intake

  /**
   * The chat's turn to take a request in: `turn` resolves once the intake before it has held its run or ended, and `done` lets the
   * next one go on. `waiting` says whether another intake of the chat goes on.
   */
  #queue(user: string, chat: string): { waiting: boolean; turn: Promise<void>; done: () => void } {
    const key = `${user}\u0000${chat}`;
    const before = this.#intakes.get(key);
    const mine = Promise.withResolvers<void>();
    const tail = (before ?? Promise.resolve()).then(() => mine.promise);
    this.#intakes.set(key, tail);
    void tail.then(() => {
      if (this.#intakes.get(key) === tail) this.#intakes.delete(key);
    });
    return { waiting: before !== undefined, turn: before ?? Promise.resolve(), done: () => mine.resolve() };
  }

  /** The chat in the store: made on the spot the first time, sharing its source's tree when it is a fork of a chat RPE knows; and its folders. */
  async #chat(reads: LumiverseReads, user: string, chat: string): Promise<void> {
    const store = this.#d.store.user(user);
    const placed = this.#d.chats.folders(user, chat) !== null;
    if (store.chat(chat) !== null && placed) return;
    const lv = await reads.chat(chat);
    if (store.chat(chat) === null) {
      const fork = await forkOf(reads, chat);
      const at = lv?.metadata.branch_at_message;
      await this.#d.writes.run(() => {
        if (store.chat(chat) !== null) return;
        if (fork !== null && store.chat(fork.from) !== null) store.branchChat({ id: chat, from: fork.from, map: fork.ids, at: typeof at === "string" ? at : null });
        else store.createChat({ id: chat });
      }, "making a chat");
    }
    if (!placed) {
      const character = lv === null || lv.character === null ? null : await reads.character(lv.character);
      await this.#d.chats.place(user, chat, { character: character === null ? null : { id: character.id, name: character.name }, chat: { name: lv?.name ?? "" } });
    }
  }

  /**
   * The chat's generations whose end was not recorded (plan §10.8, §10.10): one that ended unheard, and one RPE stopped during, whose
   * run is given its end now, as failed. Each is then tied to what Lumiverse saved, as its end would have tied it, or dropped. One that
   * cannot be recorded now is logged, and the next intake finds it again. What else the comparison with the messages the store holds
   * finds (a message gone, edited, inserted, or the chat deleted) is taken as Lumiverse's own telling of it would be, before the path
   * is compared.
   */
  async #catchUp(reads: LumiverseReads, user: string, chat: string): Promise<void> {
    await this.settled();
    const awaiting = this.#d.runs.unsettled(user, chat);
    if (awaiting.length === 0) return;
    const left = awaiting.filter((r) => r.status === "running");
    if (left.length > 0) {
      const stopped: ReplyError = { code: "failed", detail: await turnErrorWords(this.#d.files, { user, chat }, "stopped_mid_run") };
      await this.#d.writes.run((db) => left.forEach((r) => this.#interrupt(db, { ...r, status: "failed", ended: r.ended ?? this.#d.clock.now(), error: stopped })), "ending the runs RPE stopped during");
      this.#stateChanged(chat);
    }
    const path = this.#d.store.user(user).path(chat);
    const messages = path.map((e) => ({ id: e.message, hash: e.hash, hidden: e.hidden }));
    // A continue whose tag named no message went on the newest reply on the path as RPE held it: its end is looked for there, so it is
    // tied to the joined text as its end would have tied it.
    const newestReply = path.findLast((e) => !e.user)?.message ?? null;
    const found = await reconcile(reads, { chat, messages, awaiting: awaiting.map((r) => ({ generation: r.generation ?? "", message: r.target ?? (r.kind === "continue" ? newestReply : null) })) });
    for (const change of found) {
      if (change.kind !== "generation-ended") {
        this.changed(change);
        continue;
      }
      await this.#ended(user, change).catch((error: unknown) => this.#d.log.error("A generation's end could not be recorded; the chat's next turn looks again.", { chat, generation: change.generation, error: words(error) }));
    }
    await this.settled();
  }

  /**
   * Turns that left the path since it was last compared: their work is cancelled (plan §10.9 "This work belongs to its turn"). The
   * attempt a swipe or regenerate replaces (`replacing`, the turn the path held at its message) is among them, with any run still
   * writing to that message. Then each earlier attempt a flipped swipe shows again, on the newest reply or an earlier one: RPH is told
   * it is on the path again in their place, so the session carries its work (plan §6.3, §11).
   */
  async #left(user: string, chat: string, report: PathReport, replaced: string | null, replacing: string | null): Promise<void> {
    const gone = new Set<string>();
    for (const g of report.gone) if (g.turn !== null) gone.add(g.turn);
    if (report.swiped !== null && report.swiped.from !== null) gone.add(report.swiped.from);
    for (const f of report.flipped) if (f.from !== null) gone.add(f.from);
    if (replacing !== null) gone.add(replacing);
    if (replaced !== null) for (const r of this.#d.runs.ofChat(user, chat)) if (r.target === replaced) gone.add(r.turn);
    // Turns whose deleted message was heard of were cancelled then, and RPH told: it is told once.
    const chatKey = `${user}\u0000${chat}`;
    const told = this.#deletedTold.get(chatKey);
    this.#deletedTold.delete(chatKey);
    await Promise.all([...gone].filter((turn) => told?.has(turn) !== true).map((turn) => this.#cancel(user, chat, turn)));
    const shown = [report.swiped?.to ?? null, ...report.flipped.map((f) => f.to)].filter((turn): turn is string => turn !== null);
    for (const turn of shown) await this.#d.harness().turnShown({ user, chat, session: this.#d.runs.record(user, turn)?.session ?? NO_SESSION, turn });
  }

  /**
   * The chat's path compared with the turn tree (plan §6.3). The message a reply is being written to (`writing`) is the turn at hand,
   * not yet a reply, and is left out; the message a swipe or a regenerate writes a new swipe of (`replaced`) is compared as it showed
   * before, held by the attempt being replaced: its empty new swipe, which may bear the same date, is no edit of that attempt. What the
   * comparison found is kept with the chat in the same write, under the turn then at the head of its path (`since.ts`): should the
   * intake end before the harness takes its request, the next turn is told it. A message of the player's he edited since RPE last read
   * it, or one that now stands on the path where RPE held none, marks every turn after it (plan §10.10, R-25). Then the turns that left
   * the path are told (`#left`).
   */
  async #compare(user: string, chat: string, steps: readonly LvStep[], writing: string | null, replaced: string | null, heardUpTo: number): Promise<void> {
    const store = this.#d.store.user(user);
    // The path as RPE last held it, for the player's own edits since (the store's comparison is of replies), and for the replies no turn
    // is tied to that it held already.
    const was = store.path(chat);
    const before = replaced === null ? undefined : was.find((e) => e.message === replaced);
    const shown: ShownMessage[] = steps
      .filter((s) => s.id !== writing)
      .map((s) => (s.id === replaced && before !== undefined ? { id: s.id, user: false, hash: before.hash, date: before.date, hidden: s.hidden } : { id: s.id, user: s.role !== "assistant", hash: s.shown.hash, date: s.shown.date, hidden: s.hidden }));
    // A reply whose date ties one of its turns' while its text differs may be another swipe rather than an edit (§6.3 l.617): its swipes,
    // each with its saved text's hash and date, are read now, before the write, for the comparison to ask (`sync`'s `swipesOf`).
    const ties = shown.filter((s) => !s.user && store.swipes(chat, s.id).some((t) => t.date === s.date && t.hash !== s.hash));
    const read = ties.length === 0 ? [] : ((await this.#d.reads()?.messagesById(chat, ties.map((s) => s.id))) ?? []);
    const swipes = new Map(read.map((m) => [m.id, m.saves.map((save) => ({ hash: textHash(save.text), date: save.date }))]));
    const report = await this.#d.writes.run((db) => {
      const compared = store.sync(chat, shown, heardUpTo, (message) => swipes.get(message) ?? null);
      const path = store.path(chat);
      const head = path.findLast((e) => e.turn !== null)?.turn ?? null;
      const found = foundItems(compared, was, steps, this.#d.since.stoppedBefore(user, chat));
      this.#d.since.keep(db, user, chat, head, found, this.#d.store.now());
      // His edits since RPE last read them, and his messages the store reports inserted before a played turn, mark every turn after them.
      const marking: { message: string; kind: "edited-message" | "inserted-message" }[] = [
        ...found.flatMap((f) => (f.kind === "player_edited" ? [{ message: f.message, kind: "edited-message" as const }] : [])),
        ...found.flatMap((f) => (f.kind === "player_inserted" ? [{ message: f.message, kind: "inserted-message" as const }] : [])),
      ];
      for (const m of marking) {
        const at = path.findIndex((e) => e.message === m.message);
        if (at >= 0) this.#d.marks.set(db, user, path.slice(at + 1).flatMap((e) => (e.turn === null ? [] : [e.turn])), m.kind, this.#d.clock.now(), m.message);
      }
      return compared;
    }, "comparing the chat's path with its turns");
    await this.#left(user, chat, report, replaced, before?.turn ?? null);
  }

  /**
   * A turn off the chat's path: its run, if it goes on, stopped, and RPH told. A turn a branch shares with the chat it was made from
   * is that chat's (plan §6.3, shared, not copied): a swipe, a regenerate or a deletion in the branch takes it off the branch's path
   * alone, so its run and its jobs are left to that chat, and RPH is told nothing of it.
   */
  async #cancel(user: string, chat: string, turn: string): Promise<void> {
    if (this.#d.store.user(user).turn(turn)?.chat !== chat) return;
    const run = this.#d.runs.running(user, turn);
    if (run !== undefined) run.stop.abort(new Error(await turnErrorWords(this.#d.files, { user, chat }, "left_path")));
    await this.#d.harness().turnLeft({ user, chat, session: run?.session ?? this.#d.runs.record(user, turn)?.session ?? NO_SESSION, turn });
    await run?.over;
  }

  /**
   * The previous turn's run: a new turn waits for it up to the limit, with a progress line, then stops it where it stands. Gives the
   * runs that were still going at the limit, so the Author can be told; null when Lumiverse stopped this request during the wait, which
   * then leaves the previous run going.
   */
  async #previous(user: string, chat: string, settings: TurnSettings, progress: LinesPart | undefined, out: ReplyStream, signal: AbortSignal): Promise<RunRecord[] | null> {
    const before = this.#d.runs.ofChat(user, chat);
    if (before.length === 0) return [];
    const line = progress?.line("waiting_previous");
    if (line !== undefined) out.progress(line);
    const going = new Set<Run>(before);
    for (const r of before) void r.over.then(() => going.delete(r));
    const late = Promise.withResolvers<void>();
    const timer = this.#d.clock.setTimeout(late.resolve, settings.previousRunMs);
    try {
      if (!(await unlessAborted(Promise.race([Promise.all(before.map((r) => r.over)), late.promise]), signal))) return null;
    } finally {
      this.#d.clock.clearTimeout(timer);
    }
    const stopped = [...going];
    const limit = new Error(await turnErrorWords(this.#d.files, { user, chat }, "previous_run_limit"));
    for (const r of before) r.stop.abort(limit);
    await Promise.all(before.map((r) => r.over));
    return stopped;
  }

  /**
   * The turn tied to a message, for a continue of it, with the node the chat's path holds it at; null when none is (a continue of a
   * reply made without RPE begins a turn of its own).
   */
  #tiedTo(user: string, chat: string, message: string): { turn: TurnRow; node: string | null } | null {
    const store = this.#d.store.user(user);
    const entry = store.path(chat).find((e) => e.message === message);
    const turn = entry === undefined || entry.turn === null ? null : store.turn(entry.turn);
    return entry === undefined || turn === null ? null : { turn, node: entry.node };
  }

  /**
   * The earlier attempts at a message a swipe or regenerate writes again (every attempt but `now`, the turn writing it), oldest first: each
   * one's reply as kept, its intent record, and what he said with the attempt that replaced it (the next one, or `now`).
   */
  #attempts(user: string, chat: string, message: string, now: string): Attempt[] {
    const earlier = this.#d.store
      .user(user)
      .swipes(chat, message)
      .filter((t) => t.id !== now);
    return earlier.map((t, i) => {
      const run = this.#d.runs.reply(user, t.id);
      return { turn: t.id, intent: t.intent, reply: run === null ? null : (run.saved ?? run.base + run.reply), feedback: this.#saidWith(user, earlier[i + 1]?.id ?? now) };
    });
  }

  /**
   * What he said with an attempt that replaced another: the composer's swipe mode and his words kept with it, and the feedback kept with
   * it from Lumiverse's regenerate dialog (as told apart at its start, or as the breakdown corrected it after its reply).
   */
  #saidWith(user: string, turn: string): AttemptFeedback {
    const swipe = this.#d.requests.ofTurn(user, turn, null).find((r) => r.kind === "swipe");
    const asked = swipe === undefined ? null : (swipe.asked as ComposerAsk);
    const typed = this.#feedbackOf(user, turn);
    return {
      mode: asked?.choice ?? null,
      words: asked?.words ?? null,
      typed: typed?.found === "separated" ? typed.text : null,
      unseparated: typed?.found === "unseparated" ? { position: typed.position } : null,
    };
  }

  /** The feedback from Lumiverse's regenerate dialog kept with a turn, the newest word on it; null where none was kept. */
  #feedbackOf(user: string, turn: string): Feedback | null {
    const row = this.#d.store.db.query<{ body: string }, [string, string, string]>("SELECT body FROM turn_told WHERE user = ? AND turn = ? AND kind = ? ORDER BY id DESC LIMIT 1").get(user, turn, FEEDBACK_TOLD);
    return row === null ? null : (JSON.parse(row.body) as Feedback);
  }

  /**
   * The briefing's blocks (plan §10.2 block 4): the turn's facts, the lore map, the world state, the cast's views of those on stage,
   * the story so far and the story brief, each laid out by its part and measured by the chat's settings; and what the lead is not given,
   * of its prompt (`at.notGiven`) and of these blocks, told by the notices part. For the turn's folder and its row, the ids of the
   * entries the lore map names, the entries that activated as the lore map read them, and the story time the turn's facts give, as the
   * world's clock reads (null where the chat keeps none); and for the run, what the lead was not given.
   */
  async #briefing(
    reads: LumiverseReads,
    guidance: Guidance,
    scope: Scope & { turn: string },
    at: BriefingFor,
    steps: readonly LvStep[],
    settings: TurnSettings,
  ): Promise<{ blocks: ContextBlock[]; loreMap: string[]; activated: ActivatedRead[]; storyTime: number | null; notGiven: NotGiven[] }> {
    const blocks: ContextBlock[] = [];
    const failed: NotGiven[] = [];
    const [factsPart, mapPart] = await Promise.all([guidance.part(PARTS.turnFacts), guidance.part(PARTS.loreMap)]);
    const time = this.#storyTime(scope.user, scope.chat, scope.turn);
    if (factsPart?.format === "template") {
      const facts = factsPart.render({ kind: at.kind, ...(at.kind === "settle" ? { settle: true } : {}), ...(at.speaker !== null ? { speaker: at.speaker } : {}), ...(at.message !== null ? { message: at.message } : {}), ...(time !== null ? { story_time: time.text } : {}) }).text;
      if (facts.trim() !== "") blocks.push({ name: BLOCKS.turnFacts, text: facts.trimEnd() });
    }
    // The world's own keys are looked for in what Lumiverse scans of the chat for lore, by the user's own scan settings (`scan.ts`):
    // the visible messages but the one being written, the latest of them to the scan depth, the markup hidden from its scan blanked.
    // A chat with no world has no keys of its own to look for, so nothing is read for it.
    const world = this.#d.store.user(scope.user).chat(scope.chat)?.revision ?? null;
    const scan = world === null ? null : scanSettingsOf((await reads.setting(SCAN_SETTING))?.value);
    const writing = new Set(at.writing === null ? [] : [at.writing]);
    const scanned = scan === null ? [] : scannedSteps(steps, writing, scan.depth);
    const first = scanned[0] === undefined ? -1 : steps.indexOf(scanned[0]);
    const ids = new Set(scanned.map((s) => s.id));
    const texts = first < 0 ? [] : (await reads.messages(scope.chat, { from: first, to: steps.length })).filter((m) => ids.has(m.id)).map((m) => maskWorldInfoScanExclusions(m.text));
    const map = await this.#d.loreIndex.loreMap({ user: scope.user, chat: scope.chat, turn: scope.turn, messages: texts, ...(scan !== null ? { matching: scan.matching } : {}) });
    if (mapPart?.format === "template") {
      const laid = mapPart.render({ ...loreMapFields(map, await loreLines(guidance)) }).text;
      if (laid.trim() !== "") blocks.push({ name: BLOCKS.loreMap, text: laid.trimEnd() });
    }
    // The world state (plan §6.9), compiled by the store and worded by the layout file in force for the chat, read whole, with each
    // place's map worded by the map's lines in force. A world state that cannot be compiled is told in this briefing in its place, and
    // the log says why.
    const statePart = await guidance.part(PARTS.worldState);
    const layout = statePart === undefined ? null : await this.#d.files.read(scope, statePart.source.path);
    if (layout?.status === "read") {
      const maps = mapView(await mapWording(guidanceTexts(this.#d.files, scope, this.#d.log)), settings.map);
      try {
        // Counted at the model layer's ratio, as every budget of the turn is: never a figure of the world state's own. A grid's drawn layer
        // the session was given already is left out; what this block printed is kept for the session's next turn.
        const drawnGiven = await this.#drawnGiven(scope, settings.lead, maps);
        const u = this.#d.store.user(scope.user);
        // A place shown in full carries its base's lines (`src/places`): its features, access and what the story changed of it.
        const placeLines = placeLinesAt(u, this.#d.store.env, scope.chat, scope.turn, settings.places, settings.map);
        // With the chat's tidy-up on, the holds that cannot be, each with the fix the tidy-up would make: listed, never applied (R-173).
        const holds = tidyHolds(this.#d.store, scope.user, scope.turn, settings.taps.tidy);
        const state = worldState(u, { chat: scope.chat, turn: scope.turn, layout: layout.text, map: maps, drawnGiven, placeLines, holds, due: this.#d.due, settings: settings.worldState, charsPerToken: settings.charsPerToken });
        this.#drawnAfter.set(`${scope.user}\n${scope.turn}`, { ...drawnGiven, ...state.drawnShown });
        if (state.text.trim() !== "") blocks.push({ name: BLOCKS.worldState, text: state.text.trimEnd() });
      } catch (error) {
        this.#d.log.error("The world state could not be compiled for this turn's briefing.", { turn: scope.turn, error: words(error) });
        failed.push({ what: "world-state", error: words(error) });
      }
    }
    // The cast's views of the characters on stage (plan §7.1, §15.2): which views, of which castings, is what the briefing's header names
    // (`on_stage_views`), each character's laid out by its part, one after another in the order named. Nobody is on stage where the story
    // record holds no scene open at the turn. Views that cannot be read are told in this briefing in their place, and the log says why.
    const said = (await guidance.part(PARTS.briefing))?.header[ON_STAGE_VIEWS];
    const named = Array.isArray(said) ? said.flatMap((name) => (typeof name === "string" && name.trim() !== "" ? [name.trim()] : [])) : [];
    const stage = named.length === 0 ? null : stageAt(this.#d.store, scope.user, scope.chat, scope.turn);
    if (stage !== null && stage.who.length > 0) {
      try {
        const input = { store: this.#d.store, user: scope.user, chat: scope.chat, turn: scope.turn, present: stage.who, sources: this.#d.sources, layouts: await castLayouts(guidance, named), tokens: tokenCount(settings.charsPerToken), settings: settings.cast };
        const views = await castPresentViews(named, { ...input, cues: stageCues(stage) });
        const text = views.flatMap((view) => (view.text.trim() === "" ? [] : [view.text.trimEnd()])).join("\n\n");
        if (text !== "") blocks.push({ name: BLOCKS.onStage, text });
      } catch (error) {
        this.#d.log.error("The cast's views of those on stage could not be read for this turn's briefing.", { turn: scope.turn, error: words(error) });
        failed.push({ what: "on-stage", error: words(error) });
      }
    }
    // The story so far, for the history the window left out of the prompt, and the story brief (plan §8.1): drawn from the story
    // record as this turn's path holds it, each laid out by its part.
    const point = { store: this.#d.store, user: scope.user, chat: scope.chat, turn: scope.turn };
    const [soFarPart, briefPart] = await Promise.all([guidance.part(PARTS.storySoFar), guidance.part(PARTS.storyBrief)]);
    if (soFarPart?.format === "template") {
      const kept = at.keep === null ? -1 : steps.findIndex((s) => s.id === at.keep);
      const keptFrom = kept > 0 ? kept : null;
      const soFar =
        keptFrom === null
          ? null
          : storySoFar({ record: storyRecordParts(point), keptFrom, contextWindow: this.#leadWindow(await at.limits(), settings.lead, scope.turn), settings: settings.storySoFar, tokens: tokenCount(settings.charsPerToken), layout: soFarPart });
      if (soFar !== null && soFar.text.trim() !== "") blocks.push({ name: BLOCKS.storySoFar, text: soFar.text.trimEnd() });
    }
    if (briefPart?.format === "template") {
      // Its arcs are the principals' among those on stage as the turn reads them (R-56).
      const onStage = stageAt(this.#d.store, scope.user, scope.chat, scope.turn)?.who;
      const brief = storyBrief({ ...point, ...(onStage !== undefined ? { stage: onStage } : {}), layout: briefPart });
      if (brief.text.trim() !== "") blocks.push({ name: BLOCKS.storyBrief, text: brief.text });
    }
    // What the lead is not given (plan §4.2 "A prompt with pictures", Y6): of its prompt, and of this briefing, each told by its line of
    // the notices part, and kept on the run.
    const notGiven = [...at.notGiven, ...failed];
    const notices = lines(await guidance.part(PARTS.notices));
    const told = notGivenText(notGiven, notices);
    if (told !== "") blocks.push({ name: BLOCKS.notGiven, text: told });
    // What the receipt found of the prompt that is not as the chat application listed it (R-103), each told by its line.
    const cut = cutText(at.cut, notices);
    if (cut !== "") blocks.push({ name: BLOCKS.promptCut, text: cut });
    return { blocks, loreMap: [...new Set([...map.inPrompt, ...map.world, ...(map.bound ?? [])].map((line) => line.id))], activated: map.activated, storyTime: time?.clock ?? null, notGiven };
  }

  /**
   * The drawn layer's versions the turn's session has been given (plan §10.2): the turn's own where it was briefed already (a settle), else
   * what its parent turn left where that turn played in this session (a swipe takes them as the parent left them); else the session is new
   * and has its opening's, the drawn layer of the grid the player's character stands on where the lead's definition is given `map:drawn`.
   */
  async #drawnGiven(scope: Scope & { turn: string }, lead: string | null, map: MapText): Promise<Record<string, string>> {
    const own = this.#drawnAfter.get(`${scope.user}\n${scope.turn}`);
    if (own !== undefined) return own;
    const parent = this.#d.store.user(scope.user).turn(scope.turn)?.parent ?? null;
    const left = parent === null ? undefined : this.#drawnAfter.get(`${scope.user}\n${parent}`);
    if (left !== undefined && parent !== null && this.#d.runs.ofTurn(scope.user, parent).some((r) => r.session === scope.session)) return left;
    // The lead's opening (`opening:` in its definition, R-163) lists each item as a `given` part of its stack.
    const stack = lead === null ? [] : await this.#d.harness().definitions.stack(scope, lead);
    const opening = stack.some((p) => p.kind === "given" && p.part === DRAWN_MAP && p.left === undefined) ? drawnLayer(this.#d.store, scope, map) : null;
    return opening === null ? {} : { [opening.grid]: opening.drawn };
  }

  /**
   * The cast's views of each character on stage at the turn, for its folder's `cast/<name>/` (plan §5.3): every view the cast lays out,
   * each by its part in force, of every character the open scene names that the cast holds, in the scene's order; only the views that
   * hold anything. None where the story record holds no scene open at the turn. Growth is read apart, since the base lays it over itself.
   */
  async #castFolder(scope: Scope & { turn: string }, guidance: Guidance, settings: TurnSettings): Promise<CastFolder[]> {
    const stage = stageAt(this.#d.store, scope.user, scope.chat, scope.turn);
    if (stage === null || stage.who.length === 0) return [];
    const all = Object.keys(CAST_VIEWS) as CastViewName[];
    const input = { store: this.#d.store, user: scope.user, chat: scope.chat, turn: scope.turn, present: stage.who, sources: this.#d.sources, layouts: await castLayouts(guidance, all), tokens: tokenCount(settings.charsPerToken), settings: settings.cast, cues: stageCues(stage) };
    const out: CastFolder[] = [];
    for (const name of new Set(stage.who)) {
      const [rest, growth] = await Promise.all([castViews(all.filter((v) => v !== "growth"), { ...input, character: name }), castViews(["growth"], { ...input, character: name })]);
      const views = [...rest, ...growth].filter((v) => v.text.trim() !== "");
      if (views.length > 0) out.push({ name, views });
    }
    return out;
  }

  /**
   * The lead's model's limits, as the model layer gives them for the connection the harness runs the lead's definition on for the scope
   * (its own, else his default): its window, and whether it takes pictures. Null where the model layer cannot tell them; the log says so.
   */
  async #leadLimits(scope: Scope, lead: string | null): Promise<ModelLimits | null> {
    try {
      const { models, definitions } = this.#d.harness();
      return await models.limits(scope.user, await leadConnection(definitions, scope, lead));
    } catch (error) {
      this.#d.log.info("The lead's model's limits could not be read: its window is taken as unknown, and it is given no pictures.", { chat: scope.chat, turn: scope.turn ?? null, lead, error: words(error) });
      return null;
    }
  }

  /** The lead's window in tokens, from its model's limits; where nobody can tell it, 0, so the story so far is given its floor, and the log says so. */
  #leadWindow(limits: ModelLimits | null, lead: string | null, turn: string | null): number {
    const window = limits?.contextWindow ?? null;
    if (window !== null) return window.tokens;
    this.#d.log.info("The lead's window is not known, so the story so far is given its floor.", { turn, lead });
    return 0;
  }

  /**
   * The story's time where the chat's state keeps a clock: the clock, and as the world's calendar writes it. At the turn itself, along
   * the path it was made on, as the world state beside it is, so a swipe shows its own start and not the attempt it replaces. A chat
   * that names no world plays on the blank one, whose clock nobody set until play sets it: a time nobody set is shown to nobody.
   */
  #storyTime(user: string, chat: string, turn: string): { clock: number; text: string } | null {
    const store = this.#d.store.user(user);
    if (store.chat(chat) === null) return null;
    const { state } = store.stateAt(turn);
    const world = clockRecorded(state) ? this.#d.store.env.worlds(state.world.revision) : undefined;
    return world === undefined ? null : { clock: state.world.clock, text: formatClock(calendarOf(world), state.world.clock) };
  }

  /**
   * What has happened since the last turn (plan §6.3, §10.10), each in the words of the notices part: for a chat a migration carried,
   * while no turn RPE played is on its path, what was carried, laid out by its own part; what comparisons of the path found and kept
   * for this turn (`#keptFor`: turns gone, another swipe showing on the newest reply or on an earlier one, a reply edited since its
   * turn was tied, with the text it was tied to and the text it has now, the player's own edits of their messages since RPE last read
   * them, the stretches of replies written without a turn, each told once); the last turn's reply cut short, or saved otherwise than
   * it was released (`last`, as kept before this turn began); the jobs that ended since, each by how it ended; his own edits placed
   * before it; and what the player asked for through a panel (a run this turn stopped at its limit is the fact `previous.run.stopped`,
   * no item). A continue of a turn (`again`) is not told again
   * what that turn's first run was told: its jobs and requests. `told`: what of the kept things this turn's telling is to be kept for.
   * Each item goes under its kind as the contract defines it (`SinceItem`), since RPH makes each kind a situation: the files a config
   * adds for it and the rules whose `turns:` name it are given for this turn.
   */
  async #since(reads: LumiverseReads, user: string, turn: TurnRow, found: Found): Promise<{ items: SinceItem[]; told: string[] }> {
    const { steps, notices, guidance, last, again, replaced, hiddenReadable, editedBudget, deleted, notAppliedBudget } = found;
    const { chat } = turn;
    const store = this.#d.store.user(user);
    const items: SinceItem[] = [];
    const place = new Map(steps.map((s, i) => [s.id, i]));
    // An item is kept whatever its line's words: a line emptied hides only its words, and the situation the item's kind carries stays.
    const add = (kind: SinceItem["kind"], line: string | undefined, extra: Partial<SinceItem> = {}): void => {
      items.push({ kind, text: line?.trim() ?? "", ...extra });
    };
    // What a migration carried (plan §12, §15), told to the first run RPE plays on the turn's own line: a swipe of that first turn is
    // told it too, and the turn after a continue of an imported reply, whose run joined the imported turn, is not; nor a second continue.
    const { migrated } = this.#d;
    const before = storyAt(store, chat, turn.id).turns.filter((t) => t !== turn.id);
    const played = this.#d.runs.countOf(user, before) > 0 || (again && this.#d.runs.countOf(user, [turn.id]) > 0);
    const carried = played ? null : migrated.fields(user, chat);
    const carriedPart = carried === null ? undefined : await guidance.part(migrated.part);
    if (carried !== null && carriedPart?.format === "template") add("migrated", notices?.line(migrated.notice, { carried: carriedPart.render(carried).text.trim() }));
    // A swipe or a regenerate stands in for the earlier attempts at its message, the ones tied to it.
    const attempts = replaced === null ? [] : store.swipes(chat, replaced).filter((t) => t.id !== turn.id);
    const kept = this.#keptFor(user, turn, again, attempts);
    const of = <K extends FoundItem["kind"]>(kind: K): Extract<FoundItem, { kind: K }>[] => kept.flatMap((k) => (k.item.kind === kind ? [k.item as Extract<FoundItem, { kind: K }>] : []));
    // Turns gone, counted once each, whichever comparison found them; each named by its message's number as the chat stood before the
    // deletion (the numbers chat_read used) and the first words of its reply, the newest first, while they fit `since.deletedBudget`;
    // the rest by their numbers in one line.
    const gone = new Map<string, GoneTurn | null>();
    for (const d of of("deleted")) {
      for (const t of d.turns) if (!gone.has(t)) gone.set(t, null);
      for (const g of d.gone ?? []) gone.set(g.turn, g);
    }
    if (gone.size > 0) {
      const quoted: { message: number | string; words: string }[] = [];
      const more: number[] = [];
      let spent = 0;
      for (const g of [...gone.values()].flatMap((g) => (g === null ? [] : [g])).sort((a, b) => (b.n ?? -1) - (a.n ?? -1))) {
        const run = this.#d.runs.reply(user, g.turn);
        const words = run === null ? "" : firstWords(run.saved ?? run.base + run.reply, deleted.words);
        const cost = found.tokens(`${g.n ?? g.message} ${words}`);
        if (spent + cost <= deleted.budget) {
          spent += cost;
          quoted.push({ message: g.n ?? g.message, words });
        } else if (g.n !== null) more.push(g.n);
      }
      add("delete", notices?.line("deleted", { count: gone.size, turns: quoted, more: more.sort((a, b) => a - b).join(", ") }));
    }
    // Another swipe showing on the newest reply: its turn (none, for a swipe made without RPE) is the path now, with its own changes.
    for (const s of of("swiped")) add("swiped", notices?.line("swipe_shown", { message: s.message }), s.to !== null ? { turn: s.to } : {});
    // Another swipe showing on an earlier reply: the turns after it stand with their changes applied again on it, the stretch named by
    // message numbers as an unplayed stretch is. What that flip stopped from applying, change by change: what it was about (the things it
    // names, by their names at the chat's head), its operation, its value, the message of the turn it came from, and why, each report code
    // in the notices part's words (its `keys`), while they fit `since.notAppliedBudget`; the rest counted (the world state lists them all).
    const keys = isRecord(notices?.header.keys) ? notices.header.keys : {};
    let headView: TreeView | undefined;
    const namesOf = (refs: readonly string[]): string => {
      headView ??= store.view(chat);
      const view = headView;
      return refs.map((ref) => view.nameOf(ref) ?? ref).join(", ");
    };
    for (const f of of("flipped")) {
      const from = f.stretch === null || f.stretch === undefined ? undefined : place.get(f.stretch.from);
      const to = f.stretch === null || f.stretch === undefined ? undefined : place.get(f.stretch.to);
      const listed: { about?: string; op: string; value: string; message: number | string; why: string }[] = [];
      let spent = 0;
      let left = 0;
      for (const s of f.stopped ?? []) {
        const change = store.changes(s.turn).find((c) => c.id === s.change);
        const tiedTo = store.turn(s.turn)?.message ?? null;
        const why = [...new Set(s.codes)].map((code) => (typeof keys[code] === "string" ? keys[code] : code)).join("; ");
        const about = change === undefined ? "" : namesOf(aboutOf(this.#d.store.env, change.op, change.value));
        const entry = { ...(about !== "" ? { about } : {}), op: s.op, value: change === undefined ? "" : JSON.stringify(change.value), message: tiedTo === null ? s.turn : (place.get(tiedTo) ?? tiedTo), why };
        const cost = found.tokens(`${about} ${entry.message} ${entry.op} ${entry.value} ${entry.why}`);
        if (spent + cost > notAppliedBudget) {
          left++;
          continue;
        }
        spent += cost;
        listed.push(entry);
      }
      const range = from === undefined || to === undefined ? undefined : from === to ? `${from}` : `${from}-${to}`;
      add("restacked", notices?.line("swipe_flipped", { message: f.message, ...(range !== undefined ? { range } : {}), stopped: listed, ...(left > 0 ? { more: left } : {}) }), f.to !== null ? { turn: f.to } : {});
    }

    // The texts Lumiverse holds now: of each reply edited since its turn was tied, of each of the player's messages edited since RPE
    // last read it, and of the player's newest message where RPE has not kept it as it reads now, so that an edit of it can later be
    // told with the text it had. A hidden message's texts are told, read and kept only where the chat lets agents read hidden
    // messages (plan §4.2): while it does not, an edit of one is told without them, and nothing of one is kept.
    const hidden = new Set(steps.flatMap((s) => (s.hidden && !hiddenReadable ? [s.id] : [])));
    const edited = of("edited");
    const edits = of("player_edited");
    const inserted = of("player_inserted");
    const newest = steps.findLast((s) => s.role === "user");
    // The player's newest message, which this turn answers: read now, its text kept with the turn's request record (`prompts.answered`).
    const unkept = newest !== undefined && !hidden.has(newest.id) ? [newest.id] : [];
    const ids = [...new Set([...edited.map((e) => e.message), ...edits.map((e) => e.message), ...inserted.map((e) => e.message), ...unkept])].filter((id) => !hidden.has(id));
    const now = new Map((ids.length === 0 ? [] : await reads.messagesById(chat, ids)).map((m) => [m.id, m]));
    const textNow = (message: string): { new?: string } => {
      const m = now.get(message);
      return m === undefined ? {} : { new: shownText(m) };
    };
    // Each reply edited after its turn, with what its turn was played on: a carried turn's text as the store keeps it, else what
    // Lumiverse saved, where that is not what was released, by the turn's latest run that wrote into the chat (a Settle now run writes
    // nothing there). The newest are told in full while they fit the chat's bound (`since.editedBudget`); the rest, which a carried chat
    // can hold by the hundred, in one line by their messages' numbers, which tells them as surely.
    const editLines = edited.map((e) => {
      const run = hidden.has(e.message) ? null : this.#d.runs.reply(user, e.turn);
      const old = hidden.has(e.message) ? undefined : (e.text ?? (run !== null ? (run.saved ?? run.base + run.reply) : undefined));
      return { edit: e, line: notices?.line("edited", { message: e.message, ...(old !== undefined ? { old } : {}), ...textNow(e.message) }) };
    });
    const inFull = new Set<(typeof editLines)[number]>();
    let spent = 0;
    for (const told of [...editLines].sort((a, b) => (place.get(b.edit.message) ?? -1) - (place.get(a.edit.message) ?? -1))) {
      spent += found.tokens(told.line ?? "");
      if (editedBudget !== null && spent > editedBudget) break;
      inFull.add(told);
    }
    const named = editLines.filter((told) => !inFull.has(told));
    if (named.length > 0) {
      const numbers = named.flatMap((told) => place.get(told.edit.message) ?? []).sort((a, b) => a - b);
      add("edit", notices?.line("edited_more", { count: named.length, messages: numbers.join(", ") }));
    }
    for (const told of editLines) if (inFull.has(told)) add("edit", told.line, { turn: told.edit.turn });
    // His edit of a message is told with its text as the turn that answered it was sent it, kept with that turn's request record and let
    // go with the turn folder's retention; a message no kept turn answered is told as edited without its old text.
    for (const e of edits) {
      const old = hidden.has(e.message) ? null : this.#d.prompts.answeredText(user, chat, e.message, e.had);
      add("edit", notices?.line("player_edited", { message: e.message, ...(old !== null ? { old } : {}), ...textNow(e.message) }));
    }
    // A message of his inserted before a played turn is a change to his earlier messages, told with its text.
    for (const i of inserted) add("edit", notices?.line("player_inserted", { message: place.get(i.message) ?? i.message, ...textNow(i.message) }));
    const answered = newest === undefined ? undefined : now.get(newest.id);
    if (answered !== undefined) await this.#d.writes.run((db) => this.#d.prompts.answered(db, user, turn.id, { message: answered.id, hash: answered.shown.hash, text: shownText(answered) }), "keeping the message the turn answered");

    // Messages are numbered as `chat_read` numbers them, the chat's first message 0. A carried reply that stands with a reason kept for
    // it (stopped, failed, restarted) is named with that reason, in the notices part's words (its `keys`, `unplayed_<why>`).
    for (const u of of("unplayed")) {
      const from = place.get(u.from);
      const to = place.get(u.to);
      if (from === undefined || to === undefined) continue;
      const why = (u.why ?? []).map((w) => ({ message: place.get(w.message) ?? w.message, why: typeof keys[`unplayed_${w.why}`] === "string" ? keys[`unplayed_${w.why}`] : w.why }));
      add("unplayed", notices?.line("unplayed", { range: from === to ? `${from}` : `${from}-${to}`, ...(why.length > 0 ? { why } : {}) }), { range: { from, to: to + 1 } });
    }
    // The last turn's reply: cut short by a stop, or saved by Lumiverse otherwise than it was released (plan §6.3, §10.8).
    const tied = last === null ? null : store.turn(last.turn);
    if (last !== null && tied !== null && tied.message !== null) {
      // A Settle now run on a cut turn was told it already: the turn after is not told again.
      if (tied.status === "cut" && last.kind !== "settle") add("cut-short", notices?.line("cut_short", { message: tied.message }), { turn: last.turn });
      if (last.saved !== null) add("saved-differs", notices?.line("saved_differs", { message: tied.message, released: last.base + last.reply, saved: last.saved }), { turn: last.turn });
    }
    if (!again) for (const job of this.#jobsEnded(user, turn, { keys, place, tokens: found.tokens, budget: found.jobBudget })) add("job", notices?.line(job.line, job.fields), job.turn === null ? {} : { turn: job.turn });
    // His own edits placed before this turn (plan §6.3 l.632): each once, as his, with what he pressed and what it changed; a swipe of
    // the turn told them is told them again, a continue is not.
    if (!again) {
      const revision = store.chat(chat)?.revision ?? null;
      const world = revision === null ? undefined : this.#d.store.env.worlds(revision);
      for (const e of ownerEditsBefore(store, chat, turn.id, found.tell, world)) add("player-edit", notices?.line("player_edit", e.fields));
    }
    // A question that waits for his word (a lane set to Confirm) is told at each turn's start while it waits, in the notices part's words.
    for (const q of this.#d.approvals.waitingIn(user, chat)) add("awaiting", notices?.line("approval_waiting", { tool: q.tool, lane: q.lane, ...(q.turn !== null ? { turn: q.turn } : {}) }), q.turn === null ? {} : { turn: q.turn });
    // What this turn was told that decides what later turns are: a continue's found things, so the turns after the turn it continues
    // are not told them again.
    return { items, told: again ? kept.map((k) => k.id) : [] };
  }

  /**
   * What comparisons found and kept that a turn is told (`since.ts`), oldest first. A continue: what was filed under the turn it
   * continues that the turn was not told yet. Any other turn: what was filed under the turn it follows, but what a continue of that
   * turn was told; and for a swipe or a regenerate, all that was filed under each earlier attempt at its message (`attempts`) too.
   */
  #keptFor(user: string, turn: TurnRow, again: boolean, attempts: readonly TurnRow[]): KeptItem[] {
    const { since } = this.#d;
    if (again) {
      const told = since.toldTo(user, turn.id);
      return since.found(user, turn.chat, turn.id).filter((k) => !told.has(k.id));
    }
    const told = turn.parent === null ? new Set<string>() : since.toldTo(user, turn.parent);
    const kept = new Map(since.found(user, turn.chat, turn.parent).flatMap((k) => (told.has(k.id) ? [] : [[k.id, k] as const])));
    for (const attempt of attempts) for (const k of since.found(user, turn.chat, attempt.id)) kept.set(k.id, k);
    return [...kept.values()].sort((a, b) => a.at - b.at);
  }

  /**
   * The jobs whose end a turn is told (plan §10.9, §13.5): each job of the chat whose end the store recorded after the turn before it
   * on its own line began, and before it began itself, so that it is the first turn to begin after the job ended, where what the job
   * recorded takes effect; one a turn started, only on a line that holds that turn. Each with the notice of how it ended and that
   * notice's data: the job, the definition it ran as, its brief, its report, and what it recorded, change by change: what the change
   * is about, its operation and value, and for one that did not take effect why, each report code in the notices part's words (its
   * `keys`), with the later turn whose value stands (by its message's number) where one does. Each job's changes are listed while
   * they fit `since.jobBudget`; the rest are counted, and the Jobs page lists them all.
   */
  #jobsEnded(
    user: string,
    turn: TurnRow,
    told: { keys: Record<string, unknown>; place: ReadonlyMap<string, number>; tokens: (text: string) => number; budget: number },
  ): { turn: string | null; line: string; fields: JsonObject }[] {
    const store = this.#d.store.user(user);
    const parent = turn.parent === null ? null : store.turn(turn.parent);
    const ended = jobsEndedBetween(this.#d.store.db, user, turn.chat, parent?.created ?? Number.MIN_SAFE_INTEGER, turn.created);
    if (ended.length === 0) return [];
    const placed = new Map<string, { change: ChangeRow; about: string[]; applied: boolean; reports: Report[] }[]>();
    for (const c of store.changesBefore(turn.id)) {
      if (c.change.job === null) continue;
      const of = placed.get(c.change.job);
      if (of === undefined) placed.set(c.change.job, [c]);
      else of.push(c);
    }
    return ended.flatMap(({ view }) => {
      const started = view.scope.turn ?? null;
      const line = JOB_ENDS[view.state];
      if (line === undefined || (started !== null && !madeAfter(store, turn, started))) return [];
      const applied: JsonObject[] = [];
      const notApplied: JsonObject[] = [];
      let spent = 0;
      let more = 0;
      for (const c of placed.get(view.id) ?? []) {
        const entry: JsonObject = { op: c.change.op, about: c.about.join(", "), value: JSON.stringify(c.change.value) };
        if (!c.applied) {
          entry.why = [...new Set(c.reports.map((r) => r.code))].map((code) => (typeof told.keys[code] === "string" ? told.keys[code] : code)).join("; ");
          const later = c.reports.find((r) => r.code === "later_value")?.values?.turn;
          if (typeof later === "string") {
            const message = store.turn(later)?.message ?? null;
            entry.later = message === null ? later : (told.place.get(message) ?? message);
          }
        }
        const cost = told.tokens(Object.values(entry).join(" "));
        if (spent + cost > told.budget) {
          more++;
          continue;
        }
        spent += cost;
        (c.applied ? applied : notApplied).push(entry);
      }
      const fields = { job: view.id, agent: view.agent, brief: view.brief, ...(view.report !== undefined ? { report: view.report } : {}), applied, not_applied: notApplied, ...(more > 0 ? { more } : {}) };
      return [{ turn: started, line, fields }];
    });
  }

  // ---------------------------------------------------------------- the run

  async #run(run: Run, request: TurnRequest, out: ReplyStream, signal: AbortSignal, ending: Ending, over: PromiseWithResolvers<void>): Promise<void> {
    const { live, clock } = this.#d;
    const replied = Promise.withResolvers<void>();
    // Lumiverse was given the reply's end, its finish or its line: after it, the hold has nothing left to answer.
    let answered = false;
    // Lumiverse stopping before the reply is out stops the turn; after it, the run goes on (plan §10.9).
    const onAbort = (): void => {
      if (run.finished === null) run.stop.abort(signal.reason);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    // What went to the chat is published under RPH's own id for the run, as its records are, so a page hangs it on the run it belongs
    // to; RPH gives the run's first record before any of it.
    const piece = (data: { from: number; text: string } | { line: number; progress: string }): void => {
      if (run.traceRun !== null) live.publish(run.chat, { kind: "reply", data: { run: run.traceRun, ...data } });
    };
    // The reply began to go out (its first text reached the sink, or the harness released it, whichever came first): marked at that
    // moment, with whether any intent record of the run had ended by then, and told live while the run may go on.
    const released = (): void => {
      if (run.released !== null) return;
      run.released = clock.now();
      run.withoutIntent = run.intent?.to == null;
      if (run.traceRun !== null) live.publish(run.chat, { kind: "released", data: { run: run.traceRun, at: run.released } });
    };
    const sink: ReplySink = {
      progress: (line) => {
        out.progress(line);
        piece({ line: run.progress.length, progress: line });
        run.progress.push(line);
      },
      content: (delta) => {
        if (run.firstWord === null) run.firstWord = clock.now();
        released();
        out.content(delta);
        piece({ from: run.reply.length, text: delta });
        run.reply += delta;
      },
      finish: (usage) => {
        released();
        run.finished = clock.now();
        answered = true;
        // What went out is kept before Lumiverse is told the reply ended: should RPE stop before the run does, the next intake ties it.
        void this.#d.runs.save(run, "keeping a released reply").catch((error: unknown) => this.#d.log.error("A released reply could not be kept.", { turn: run.turn, error: words(error) }));
        out.finish({ reason: "stop", usage: usageOut(usage) });
        replied.resolve();
      },
      error: (e: ReplyError) => {
        run.error = e;
        answered = true;
        if (e.code === "limit" && e.limit !== undefined) run.stoppedBy ??= { limit: e.limit };
        // Stopped where it stood, at a limit or at the hold: what the Author had written of the reply goes out as the whole reply.
        if (run.stoppedBy !== null && run.reply !== "") {
          run.finished = clock.now();
          out.finish({ reason: "stop" });
          replied.resolve();
          return;
        }
        // With `reply.lastText` on, the Author's last plain text, as the harness gives it with no reply, goes out in place of the line.
        if (ending.lastText && e.text !== undefined) {
          run.lastText = true;
          sink.content(e.text);
          run.finished = clock.now();
          out.finish({ reason: "stop" });
          replied.resolve();
          return;
        }
        // The message Lumiverse keeps shows the same line in its thinking, filled with no detail: a thrown error's or a provider's own
        // words go out as the error alone, since what is kept in the thinking can reach a later prompt.
        const { detail: _detail, ...plain } = e;
        out.error(this.#errorWords(e, ending.errors), this.#errorWords(plain, ending.errors));
        replied.resolve();
      },
    };
    // A reply asked for whole is stopped where it stands at its hold, counted from its arrival, unless the chat's limit on a turn's time
    // ends it first: nothing of it reaches Lumiverse before its end, and Lumiverse cuts a generation that sent nothing for ten minutes.
    const { hold } = ending;
    const holding =
      hold === null
        ? undefined
        : clock.setTimeout(
            () => {
              if (answered) return;
              run.stoppedBy ??= { hold };
              run.stop.abort();
            },
            Math.max(0, run.received + hold - clock.now()),
          );
    run.started = clock.now();
    void this.#d.harness()
      .answer(request, sink, run.stop.signal)
      .then(
        (outcome) => {
          run.status = outcome.status;
          run.usage = outcome.usage;
          if (outcome.error !== undefined) run.error = outcome.error;
          if (outcome.limit !== undefined) run.stoppedBy ??= { limit: outcome.limit };
        },
        (error: unknown) => {
          run.status = "failed";
          const failed: ReplyError = { code: "failed", detail: words(error) };
          if (run.finished === null && run.error === null) sink.error(failed);
          run.error = failed;
        },
      )
      .finally(async () => {
        signal.removeEventListener("abort", onAbort);
        if (holding !== undefined) clock.clearTimeout(holding);
        run.ended ??= clock.now();
        replied.resolve();
        try {
          await this.#d.runs.save(run, "keeping a turn's run");
          // The turn's tokens are what all its runs spent: a continue adds to the runs before it (plan §10.10 "Continue"). Its timings
          // go on its own turn's row; a continue's run that joined the turn it extended keeps its own on the run, never over that turn's.
          // Read in the write, so a join made before it or after it counts this run once.
          const timings = { received: run.received, started: run.started, firstWord: run.firstWord, released: run.released, ended: run.ended };
          await this.#d.writes.run(() => {
            const spent = this.#d.runs.ofTurn(run.user, run.turn).flatMap((r) => (r.usage === null ? [] : [r.usage]));
            const tokens = spent.length === 0 ? {} : { tokensIn: spent.reduce((n, u) => n + u.input, 0), tokensOut: spent.reduce((n, u) => n + u.output, 0) };
            this.#d.store.user(run.user).updateTurn(run.turn, { ...(run.held === null || run.held === run.turn ? { timings } : {}), ...tokens });
          }, "keeping a turn's timings");
          await this.#keepRecord(run);
          await this.#recordRun(run);
        } catch (error) {
          this.#d.log.error("A turn's run could not be kept.", { turn: run.turn, error: words(error) });
        }
        try {
          await this.sessionsAfter(run.user, run.chat, run.turn);
        } catch (error) {
          this.#d.log.error("The sessions of a turn's scene could not be brought up to date.", { turn: run.turn, error: words(error) });
        }
        // The chat's older turn folders are pruned after a turn (plan §5.5), never during one: the folders of its other runs going on are spared.
        try {
          const store = this.#d.store.user(run.user);
          const going = this.#d.runs.ofChat(run.user, run.chat).flatMap((r) => (r === run ? [] : [store.turn(r.turn)]));
          await this.#d.pruneTurns(run.user, run.chat, new Set(going.flatMap((t) => (t === null ? [] : [turnFolderName(t.depth + 1, t.id)]))));
        } catch (error) {
          this.#d.log.error("The chat's older turn folders could not be pruned.", { turn: run.turn, error: words(error) });
        } finally {
          over.resolve();
        }
      });
    await replied.promise;
  }

  /** The line the player is shown when a turn ends with no reply, in the words of the reply-errors part. */
  #errorWords(e: ReplyError, errors: LinesPart | undefined): string {
    const fields = { ...(e.detail !== undefined ? { detail: e.detail } : {}), ...(e.limit !== undefined ? { limit: e.limit.limit, per: e.limit.per, max: e.limit.max, value: e.limit.value } : {}) };
    return errors?.line(e.code, fields) ?? "";
  }

  // ---------------------------------------------------------------- commit

  /**
   * A generation ended (plan §10.8): its turn tied to what Lumiverse saved in the swipe the generation wrote, whichever one the player
   * looks at now, or, saving nothing, left an attempt with no state. A reply not released whole (stopped, failed, or RPE stopped during
   * it) is tied as cut short. Where which swipe it wrote cannot be told, the turn is left open, and the next intake looks again. A
   * continue's run that held its changes on a turn of its own is tied where its end names the message (`#continued`).
   */
  async #ended(user: string, change: Ended): Promise<void> {
    const run: RunRecord | null = this.#d.runs.byGeneration(user, change.generation);
    if (run === null) {
      // An end heard while its intake goes on is recorded once that intake's run has given its reply; any other is not RPE's to record.
      if (this.#taking.has(change.generation)) this.#early.set(change.generation, change);
      return;
    }
    if (run.settled !== null) return;
    const store = this.#d.store.user(user);
    const live = this.#d.runs.running(user, run.turn);
    const held = live !== undefined && live.id === run.id ? live : undefined;
    // The end is recorded on the run going on now itself, so its own later record keeps it; else on the record as kept.
    const settle = (also: Partial<RunRecord> = {}): RunRecord => {
      const at = { ...also, settled: this.#d.clock.now() };
      return held !== undefined ? Object.assign(held, at) : { ...run, ...at };
    };
    const turn = store.turn(run.turn);
    if (turn === null || turn.status === "dropped") {
      const record = settle();
      await this.#d.writes.run((db) => this.#d.runs.put(db, record), "recording a generation's end");
      return;
    }
    const cut = change.stopped === true || run.finished === null;
    const message = run.kind === "impersonate" ? null : (change.message ?? (cut ? run.target : null));
    const reads = this.#d.reads();
    const saved = message === null || reads === null ? undefined : (await reads.messagesById(change.chat, [message]))[0];
    const written = saved === undefined ? undefined : writtenOf(run, saved);
    if (written === null) return;
    if (run.held !== null) {
      await this.#continued(user, run, run.held, held, settle, cut, saved !== undefined && written !== undefined ? { message: saved, text: written.text, date: written.date } : null);
      return;
    }
    if (saved === undefined || written === undefined || (cut && written.text === run.base)) {
      // Saving nothing new, an attempt is dropped, and RPH told it left the path, so its jobs are cut off (plan §13.5).
      const record = settle();
      const dropped = await this.#d.writes.run((db) => {
        this.#d.runs.put(db, record);
        if (store.turn(run.turn)?.status !== "open") return false;
        store.dropTurn(run.turn);
        return true;
      }, "dropping an attempt that saved nothing");
      this.#stateChanged(run.chat);
      if (dropped) await this.#d.harness().turnLeft({ user, chat: run.chat, session: run.session, turn: run.turn });
      return;
    }
    const record = settle({ saved: written.text === run.base + run.reply ? null : written.text });
    await this.#d.writes.run((db) => {
      store.tieTurn(run.turn, { message: saved.id, hash: textHash(written.text), date: written.date, status: cut ? "cut" : "done" });
      this.#d.runs.put(db, record);
      // Saved otherwise than released, beyond the prefill in front: a mark of its own on the turn (plan §10.8, R-25).
      if (record.saved !== null) this.#d.marks.set(db, user, [run.turn], "saved-otherwise", this.#d.clock.now());
    }, "tying a turn to its saved message");
    this.#stateChanged(run.chat);
    await this.#recordMessage(record, record.turn, { id: saved.id, hash: textHash(written.text), date: written.date });
    await this.#keepRecord(record);
  }

  /**
   * A continue's end (plan §10.8, §10.10 "Continue", R-192): the message Lumiverse names decides its turn, whatever its tag named. A
   * message a turn of the chat is tied to means that turn extended: the held turn joins it (`#join`), and it is tied again to the text
   * Lumiverse saved, cut short where the continue was stopped part-way. A message no turn of the chat is tied to (Lumiverse saved a new
   * one, or a reply a branch shares) means the held turn was a turn of its own, tied there with what its run changed, and the turn the
   * tag had named keeps its own message and changes as they were. Saving nothing new, the held turn's own rows go: where the end names
   * a turn's message its jobs' rows still join that turn, and it stays tied to what Lumiverse stored; else the held turn is dropped as
   * an attempt. Its text before the continue is what intake read where the end names the message the tag named, else that turn's as
   * RPE last kept it. The take-backs, the joins and the tie are one write.
   */
  async #continued(
    user: string,
    run: RunRecord,
    heldTurn: string,
    live: Run | undefined,
    settle: (also?: Partial<RunRecord>) => RunRecord,
    cut: boolean,
    written: { message: LvMessage; text: string; date: number | null } | null,
  ): Promise<void> {
    const store = this.#d.store.user(user);
    const tied = written === null ? null : this.#tiedTo(user, run.chat, written.message.id);
    const into = tied !== null && tied.turn.chat === run.chat && tied.turn.id !== heldTurn && (tied.turn.status === "done" || tied.turn.status === "cut") ? tied.turn : null;
    const kept = tied === null ? undefined : this.#d.runs.ofTurn(user, tied.turn.id).findLast((r) => r.kind !== "settle" && r.id !== run.id);
    const before = written === null || written.message.id === run.target ? run.base : kept === undefined ? "" : (kept.saved ?? kept.base + kept.reply);
    // A continue's text as Lumiverse saved it: what it went on, the preset's join, then the reply. A join is no difference, and a
    // continue that saved only its join saved nothing new (plan §10.8 step 4).
    const nothingNew = written !== null && (written.text === before || joinOf(written.text, before, "") !== null || (tied !== null && tied.turn.hash === textHash(written.text)));
    if (written === null || (cut && nothingNew)) {
      // Its own rows are taken back once its run, which may still be winding down, is over.
      if (into !== null) await live?.over;
      const record = settle();
      // Lumiverse saved its join after the text it went on: the turn is tied to what it stored, whether or not he had edited that text
      // before the continue (his edit was told to the continue's run), so the next turn hears of no edit that is only the join.
      const tiedAgain = written !== null && into !== null && written.text !== before;
      const dropped = await this.#d.writes.run((db) => {
        this.#d.runs.put(db, record);
        if (store.turn(heldTurn)?.status !== "open") return false;
        if (into === null) {
          store.dropTurn(heldTurn);
          return true;
        }
        // The held turn's own changes go first, which leave a job's; then the join moves what is left.
        store.takeBack(heldTurn, -1);
        this.#join(db, user, record, heldTurn, into.id);
        if (tiedAgain) store.tieTurn(into.id, { message: written.message.id, hash: textHash(written.text), date: written.date, status: into.status === "cut" ? "cut" : "done" });
        this.#d.runs.put(db, record);
        return false;
      }, "taking back a continue that saved nothing");
      this.#stateChanged(run.chat);
      if (tiedAgain && written !== null) await this.#recordMessage(record, record.turn, { id: written.message.id, hash: textHash(written.text), date: written.date });
      if (dropped) await this.#d.harness().turnLeft({ user, chat: run.chat, session: run.session, turn: heldTurn });
      return;
    }
    const joined = joinOf(written.text, before, run.reply);
    const record = settle(joined !== null ? { saved: null, base: before + joined } : { base: before, saved: written.text === before + run.reply ? null : written.text });
    await this.#d.writes.run((db) => {
      if (store.turn(heldTurn)?.status !== "open") return;
      if (into !== null) this.#join(db, user, record, heldTurn, into.id);
      store.tieTurn(record.turn, { message: written.message.id, hash: textHash(written.text), date: written.date, status: cut ? "cut" : "done" });
      this.#d.runs.put(db, record);
      // Saved otherwise than released, beyond what it went on and the preset's join: a mark of its own on the turn (plan §10.8, R-25).
      if (record.saved !== null) this.#d.marks.set(db, user, [record.turn], "saved-otherwise", this.#d.clock.now());
    }, "tying a continue to its saved message");
    this.#stateChanged(run.chat);
    await this.#recordMessage(record, record.turn, { id: written.message.id, hash: textHash(written.text), date: written.date });
    // The turn's record is kept once both the run has ended and its turn is decided: here, where the run is over already; else at its end.
    if (this.#d.runs.running(user, record.turn)?.id !== record.id) await this.#keepRecord(record);
  }

  /** The message a turn was tied to, completing its record (`turn.json`, plan §5): one that cannot be written is logged, and the turn stands. */
  async #recordMessage(run: RunRecord, turn: string, message: TurnRecordMessage): Promise<void> {
    await mergeTurnRecord(this.#d.files, { user: run.user, chat: run.chat, session: run.session, turn }, { message }).catch((error: unknown) =>
      this.#d.log.error("A turn's record could not be completed with its message.", { turn, error: words(error) }),
    );
  }

  /**
   * A run's own entry in the record of the turn whose folder it played in (`turn.json`, plan §5; a continue's, its held turn's), beside
   * the turn's other runs, never over them: its timings, and the tokens each of its agents spent and all of them together, as RPH counted
   * them. One that cannot be written is logged, and the turn stands.
   */
  async #recordRun(run: Run): Promise<void> {
    const turn = run.held ?? run.turn;
    try {
      const usage = run.traceRun === null ? undefined : await this.#d.harness().usage.run(run.user, run.traceRun);
      const tokens = (u: Usage | null | undefined): TurnRecordTokens => ({ in: u?.input ?? 0, out: u?.output ?? 0, cacheRead: u?.cacheRead ?? 0 });
      await mergeTurnRecord(this.#d.files, { user: run.user, chat: run.chat, session: run.session, turn }, {
        run: {
          run: run.id,
          kind: run.kind,
          timings: { received: run.received, firstCall: run.firstCall, firstWord: run.firstWord, released: run.released, ended: run.ended },
          tokens: { agents: Object.fromEntries((usage?.agents ?? []).map((a) => [a.agent.id, tokens(a.usage)])), all: tokens(usage?.total ?? run.usage) },
        },
      });
    } catch (error) {
      this.#d.log.error("A turn's record could not be completed with its run.", { turn, run: run.id, error: words(error) });
    }
  }

  /**
   * A continue's held turn joins the turn Lumiverse's end decided it extended (plan §10.10, R-192 (e), (f), R-203), inside the caller's
   * write: the store's changes, the cast's and the story's among them, each checked again there; what the held turn was told is that
   * turn's told; the run names that turn from now on, its marks where its rows begin there, so the turn's counts are of the run's own
   * changes; and the turn's tokens are what all its runs spent, this one's among them.
   */
  #join(db: Database, user: string, run: RunRecord, held: string, into: string): void {
    const store = this.#d.store.user(user);
    const ownLast = store.changes(into).at(-1)?.ord ?? -1;
    const moved = store.joinTurn(held, into);
    this.#d.since.told(db, user, into, [...this.#d.since.toldTo(user, held)]);
    this.#d.marks.join(db, user, held, into);
    run.mark = (moved[0]?.ord ?? ownLast + 1) - 1;
    this.#d.runs.join(db, run, into);
    const spent = this.#d.runs.ofTurn(user, into).flatMap((r) => (r.usage === null ? [] : [r.usage]));
    if (spent.length > 0) store.updateTurn(into, { tokensIn: spent.reduce((n, u) => n + u.input, 0), tokensOut: spent.reduce((n, u) => n + u.output, 0) });
  }

  /**
   * Tells the chat's followers that its state changed: a turn joins the chat, or what an attempt recorded is taken back, only when
   * Lumiverse's end of its reply is heard, which can come after its run has ended.
   */
  #stateChanged(chat: string): void {
    this.#d.live.publish(chat, { kind: "state", data: {} });
  }

  /**
   * The Author's record of a tied turn, written to the turn's folder for a later turn carried in the records mode (`record.ts`): when
   * the turn is tied, and again when its run is over, since the run may record it after the reply. Either comes before the next turn of
   * the chat is answered, which waits for both. A record that cannot be written is logged; the turn stands.
   */
  async #keepRecord(run: RunRecord): Promise<void> {
    const status = this.#d.store.user(run.user).turn(run.turn)?.status;
    if (status !== "done" && status !== "cut") return;
    await writeTurnRecord(this.#d.files, this.#d.store, { user: run.user, chat: run.chat, session: run.session, turn: run.turn }).catch((error: unknown) =>
      this.#d.log.error("A turn's record could not be written to its folder.", { turn: run.turn, error: words(error) }),
    );
  }

  /**
   * A message deleted, or an earlier reply's swipe flipped, heard by its event with no turn of the chat going on: the path compared as
   * a turn's intake compares it (keeping its report with the chat, so the next turn's start still tells the Author, once), and the
   * chat's notes put as they stand at its head (plan §5.1, R-130); a note he changed in between stays as he left it. With a turn going
   * on its own start puts the notes; a missed event is caught up at the next start. `#catchUp` is not called here: it waits for
   * `settled()`, which waits on this very work.
   */
  async #atRest(user: string, chat: string): Promise<void> {
    const reads = this.#d.reads();
    const store = this.#d.store.user(user);
    if (reads === null || store.chat(chat) === null || this.#generatingIn(user, chat).size > 0 || this.#d.runs.ofChat(user, chat).length > 0) return;
    const intake = this.#queue(user, chat);
    try {
      if (intake.waiting) return;
      const steps = await reads.path(chat);
      if (steps === null) return;
      await this.#compare(user, chat, steps, null, null, store.heardCount(chat));
      await this.#d.notes.follow(user, chat, { turns: store.line(chat).map((l) => l.turn), branchOf: store.chat(chat)?.sourceChat ?? null });
    } finally {
      intake.done();
    }
  }

  /**
   * A message was deleted: the work of every turn tied to it is cancelled now, and RPH told; the next turn's comparison takes them off
   * the path without telling RPH again.
   */
  async #deleted(user: string, chat: string, message: string): Promise<void> {
    const store = this.#d.store.user(user);
    // What was heard of it goes, through the write queue as every change to the store does.
    const forgotten = this.#d.writes.run(() => store.heardDeleted(chat, message), "forgetting what was heard of a deleted message");
    const tied = store.chat(chat) === null ? [] : store.swipes(chat, message);
    const running = this.#d.runs.ofChat(user, chat).filter((r) => r.target === message);
    const turns = new Set([...tied.map((t) => t.id), ...running.map((r) => r.turn)]);
    const chatKey = `${user}\u0000${chat}`;
    const told = this.#deletedTold.get(chatKey) ?? new Set<string>();
    for (const turn of turns) told.add(turn);
    this.#deletedTold.set(chatKey, told);
    await Promise.all([forgotten, ...[...turns].map((turn) => this.#cancel(user, chat, turn))]);
  }
}

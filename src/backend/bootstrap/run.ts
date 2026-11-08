// The bootstrap's run (DEPTH-PLAN §8.1–§8.6): onboards an existing chat into depth, chunk by chunk,
// oldest first. A graph over chunks in story order (§8.2): the historian's chunk k waits for its
// chunk k−1 and runs ahead of the rest; the author's reading of chunk k waits for the historian's k
// and its own k−1 (it decides chapter ends and who gets a mind); the points of view for chunk k's
// partial reach follow, then chunk k's beats land at their own source messages; each character with
// a mind catches up on its share of chunk k after its own k−1, characters in parallel; at each
// chapter's end the GM's truth link reads the chapter's beats once, the characters reflect, the author
// revises the notebook deeply, the GM reconciles the imported memory entries that cover it, and a
// spot-check card is queued for the user. A beat the user marks wrong on a card is a directive
// (§8.6): between chunks the author amends it at its own source message (a superseding beat, or a
// strike), and the characters who lived it live the corrected beat. The player character is the
// world's own throughout (D-10; Play as isn't supported yet): a switch of character the historian
// reads in the history is noted in the log, never landed, and he never catches up on what he played.
//
// Every job is keyed by what it read (its chunk, and the keys of the jobs before it); its model
// answer is recorded in its own file before anything lands, and what it lands are layer entries with
// ids made from its key, landed idempotently. A call whose answer its stage's parse didn't keep whole
// is recorded with the fields and the answer as written (the raw-against-saved audit), and listed on
// the next spot-check card; an answer asked for as JSON that holds none and wasn't cut off is kept
// so and asked once more. A stage of long answers asks by the room rule: the most room an answer
// may have, or its role's own where the user set one, and once more at twice it after a cut. A job
// that fails, or that Pause or the cap stops holding such a call, keeps
// those calls beside its record, with why it stopped, for the audit alone. A pause, a crash or a restart
// resumes at the first chunk whose recorded progress no longer holds; a job whose answer was
// recorded under its key lands that answer without asking again; a job whose inputs changed (a
// redo, an old message swiped) is asked again, and its new entries supersede the old ones (§8.3,
// §8.4). What the run landed for the chunks it runs again is what it replaces: every stage reads the
// world without it, what replaces a job's entries gives way first, from at or before them, so what
// follows is checked without them, and what a chunk's run no longer makes is retired as it ends. A
// landing a turn in flight holds is waited for, so the job after it reads it (§8.2). The survey reads
// the history only: the path up to depth's play, and once the run first reached the latest message,
// only what it covered then, so a later start amends and redoes, never reads on into play. The run
// never reads the chat after the survey (§8.5), and starts no call past its cap (§8.3).

import type { ChatId, EntityId, MessageId } from "../../shared/ids";
import type { LedgerEvent } from "../../shared/ledger";
import type { Basis, LandResult, LayerDraft, LayerSummary } from "../../shared/layer";
import type { Beat, Staging } from "../../shared/story";
import { beatEvent, STORY_BEAT, STORY_STRIKE, strikeEvent } from "../../shared/story";
import { needsPov, reachOf, type ReachAs } from "../../shared/character-engine";
import { DEPTH_ROLE_WORDS, DEPTH_ROOM_MOST, type DepthRole } from "../../shared/depth-settings";
import { BOOTSTRAP_LOG_LINES, BOOTSTRAP_STAGES, NO_COUNTS } from "../../shared/bootstrap";
import type { BootstrapCap, BootstrapStage, BootstrapStatus, BootstrapView, ChapterView, ImportView, SpotCheckCard, SpotMisread, StageCounts } from "../../shared/bootstrap";
import { noteMisread, type CallMisread } from "../../shared/misread";
import { hash32, hashParts } from "../../shared/hash";
import { blobHash } from "../../shared/stores";
import { layerEntryId } from "../../engine/ledger/layer";
import { answerRead, type ModelPort, type PortAnswer } from "../depth/port";
import { DepthAnswerError, putText, readAnswer, sameName } from "../depth/common";
import { cutShort } from "../agents/runtime";
import { fellBackLine } from "../character-agent";
import type { BootstrapFiles } from "./files";
import { EDITS, MANIFEST, isEdits, isManifest, readChunk, survey } from "./spool";
import type { ChunkInfo, SpoolManifest, SpoolRow, SurveyMessage } from "./spool";
import { estimateRemaining } from "./estimate";
import type { ImportedEntry } from "./import";
import type { AmendOut } from "./amend";
import { buildSpotCard, isCard } from "./spot";
import { roomAgain, type PortOptions } from "../depth/port";
import { roomRefused } from "../steps";

// ---------------------------------------------------------------- the stages it runs

/** What a stage hands back to land: its events, the texts they cite by hash, and its thinking. */
export interface StageOut {
  events: LedgerEvent[];
  blobs: Record<string, string>;
  reasoning?: string;
  /** The layer entry's kind, for its readers (GM → Notebook reads `notebook`); absent: its first event's type. */
  kind?: string;
}

export interface Person {
  id: EntityId;
  name: string;
}

export interface HistorianOut extends StageOut {
  beats: Beat[];
  staging: Staging[];
  /** People the history meets who aren't in the world yet: after binding, `ref` is the id the run gave them. */
  newcomers: { ref: string; name: string; note: string }[];
  /** Places the history meets that the world lacks, in the place each is in: after binding, `ref` is the id the run gave them. */
  newPlaces?: { ref: string; name: string; note: string; parent: string }[];
  /** The player's switches of character (D-10) the history shows, in message order: from `message` on he plays `who`. Play as isn't supported yet: each is noted in the log, never landed. */
  switches?: { message: MessageId; who: EntityId }[];
  uncertain: string[];
}

export interface CastPick {
  who: EntityId;
  mind: boolean;
  why: string;
  /** The author's own reading of who they are, for a core where there is no card, no description in the world and no entry (D-17), marked for review. */
  core?: string;
}

export interface AuthorOut extends StageOut {
  chapterEnds: boolean;
  /** The chapter's title, where the stretch ends one. */
  title?: string | null;
  cast: CastPick[];
  uncertain: string[];
}

/** One beat as a character lived it (`reachOf`): its own act as its own (the beat's deed, as it did it), a message it sent as sending it and one it received as the message's words (no place: it was elsewhere; `from`, its senders), else the surface where it reached them whole, their own point of view where in part. */
export interface Lived {
  beat: string;
  at: number;
  place: string;
  channel: string;
  text: string;
  whole: boolean;
  as: ReachAs;
  from?: EntityId[];
  quotes?: string;
}

/** The GM's reconciliation of the imported memory entries that cover a chapter (§8.1 step 5). */
export interface ReconcileOut extends StageOut {
  /** Entries that agree, with the beats they cite. */
  agree: { entry: string; beats: string[] }[];
  /** Entries recording events the history no longer holds: their beats, sourced from the entry and marked for review, are in `events`. */
  recorded: { entry: string; beats: string[] }[];
  /** Entries contradicting the beats or a formed mind: the user decides, on the spot-check card. */
  contradictions: { entry: string; against: string; why: string }[];
}

/**
 * The agents the run drives: pure, each makes its model calls and returns what to land; none lands
 * anything. The wiring binds them to the historian, the author, the Character Engine and the GM.
 */
export interface BootstrapStages {
  /** `places`: the places the run has made so far, by the id it gave them, which the fold may not hold yet: the historian names them by id rather than make them again. */
  historian(input: { chunk: SpoolRow[]; before: { beats: Beat[]; staging: Staging[]; blobs: Record<string, string> }; cast: Person[]; places: { id: string; name: string }[]; pov: EntityId; basis: Basis }, model: ModelPort): Promise<HistorianOut>;
  /** The newcomers' and the new places' refs rewritten to the ids the run gave them, wherever they appear. */
  bindNewcomers(out: HistorianOut, people: Record<string, EntityId>, places: Record<string, string>): HistorianOut;
  /** The events that bring newcomers and new places into the world, by its own rules; `knownBy`: the player character who met them, if he did. */
  spawn(people: { id: EntityId; name: string; note: string; knownBy: EntityId | null }[], places: { id: string; name: string; note: string; parent: string }[], basis: Basis): Promise<{ people: LedgerEvent[]; places: LedgerEvent[] }>;
  /** The chunk's events per source message: each message's beats, and the closing staging with the last. */
  beatEvents(beats: readonly Beat[], staging: readonly Staging[], blobs: Readonly<Record<string, string>>, rows: readonly SpoolRow[]): Record<MessageId, LedgerEvent[]>;
  authorRead(input: { chunk: SpoolRow[]; beats: Beat[]; blobs: Record<string, string>; chapter: { index: number; chunks: number[] }; cast: Person[]; basis: Basis }, model: ModelPort): Promise<AuthorOut>;
  authorChapter(input: { chapter: { index: number; chunks: number[]; title: string | null; through: MessageId }; beats: Beat[]; blobs: Record<string, string>; cast: Person[]; basis: Basis }, model: ModelPort): Promise<AuthorOut>;
  /** A point of view for each of `who` the render wrote or its GM's check set right; `fellBack`: those left without one, pending (the render, asked again, still wrote theirs naming someone who wasn't there, with the names, and the check couldn't set it right; or didn't write it, none). No rule writes one in its place. */
  pov(input: { beat: Beat; surface: string; quotes?: string; staging: Staging[]; blobs: Record<string, string>; who: EntityId[]; basis: Basis }, model: ModelPort): Promise<{ povs: Record<EntityId, string>; fellBack?: Record<EntityId, string[]>; reasoning?: string }>;
  /** A core for a character the author gave a mind: from its card, else the world's own description of it, else an imported entry, else the author's reading (D-17). Null when it has one the user or the play wrote, or nothing seeds one. */
  seedCore(input: { who: Person; author: string | null; entries: ImportedEntry[]; at: number; basis: Basis }): Promise<StageOut | null>;
  /**
   * A catch-up; `supersedes`: the beat a corrected or struck one replaces, whose writes the new ones
   * supersede in the mind (§4.2, Retcons propagate), with `was`, the old beat as it had reached them:
   * every file whose latest write drew on it is kept or rewritten at its own path. With nothing to
   * live and nothing to rewrite, nothing is asked and no event returned.
   */
  catchUp(input: { who: Person; at: number; lived: Lived[]; basis: Basis; supersedes?: string; was?: Lived[] }, model: ModelPort): Promise<StageOut>;
  /** The author's amendment of a beat the user marked wrong (§8.6), read beside the message it came from and the user's note. */
  amend(input: { beat: Beat; blobs: Record<string, string>; message: SpoolRow; note: string; cast: Person[]; pov: EntityId; key: string; basis: Basis }, model: ModelPort): Promise<AmendOut>;
  /** Whom each of `who` knows by name at the basis (`knowsFor`): a beat involving anyone else reaches them through their own point of view. */
  knows(who: EntityId[], basis: Basis): Promise<Record<EntityId, EntityId[]>>;
  reflect(input: { who: Person; at: number; basis: Basis }, model: ModelPort): Promise<StageOut>;
  truthLink(input: { beats: Beat[]; blobs: Record<string, string>; minds: EntityId[]; basis: Basis }, model: ModelPort): Promise<StageOut>;
  reconcile(input: { chapter: number; final: boolean; span: [number, number]; at: number; entries: ImportedEntry[]; beats: Beat[]; blobs: Record<string, string>; minds: Person[]; basis: Basis }, model: ModelPort): Promise<ReconcileOut>;
}

/** What the run needs of the chat's ledger: the layer to land in, and the blob store. */
export interface BootstrapLedger {
  /**
   * Lands drafts in order with one write, each checked after those before it, with the entries
   * `without` names read as superseded on both sides of its checks (the old run's that a redo has
   * yet to replace); an id already landed is left as it is. One held while a turn is in flight
   * answers once it has landed or been refused as the turn ends, so the job after it reads it.
   */
  landAll(drafts: readonly LayerDraft[], without: ReadonlySet<string>): Promise<LandResult[]>;
  putBlobs(texts: Record<string, string>): Promise<void>;
  /** Whether the basis left the active chain (a refused landing is the chain moving, or the entry's own fault). */
  moved(basis: Basis): Promise<boolean>;
  /** Every message's basis on the active chain, in order. */
  chain(): Promise<Basis[]>;
  /** The chat's own landed entries, without their events. */
  entries(): Promise<LayerSummary[]>;
  /** Every stage's fold reads these entries as superseded from now on: the ones the run is replacing (§8.4), so it builds on the world as it will be once what replaces them lands. */
  replacing(ids: ReadonlySet<string>): void;
}

export interface BootstrapKnobs {
  chunkTokens: number;
  atOnce: { minds: number };
  /** The most characters given a mind, in the author's order; 0 for no limit. */
  mostMinds: number;
  sample: number;
  pauseAfterWrong: number;
}

export interface BootstrapEnv {
  chatId: ChatId;
  files: BootstrapFiles;
  ledger: BootstrapLedger;
  stages: BootstrapStages;
  model: ModelPort;
  /** The active path as the survey reads it, once per survey, up to depth's play: the first turn depth played or one in flight, or the first reply on depth nothing read (`Rec.unread`), and the player's messages it answered (`historyEnd`). */
  messages(): Promise<SurveyMessage[]>;
  /** The messages the read skips because the chat's LumiBooks records stand for them (its hash of each still matches, or its shelf names it). Empty until the author's jumpstart pass reads those records (`JUMPSTART_SKIPS_COVERED`); absent or empty, every message is read. */
  covered?(): Promise<ReadonlySet<MessageId>>;
  /** The world's people at the head and the player character (no agent, D-10). */
  people(): Promise<{ cast: Person[]; pov: EntityId }>;
  /** The import's read of World Info and the memory entries (§8.1 step 2). */
  imports(): Promise<{ entries: ImportedEntry[]; views: ImportView[] }>;
  knobs(): Promise<BootstrapKnobs>;
  /** The answer room the user set `role` in Settings → Depth (`ownRoom`); null where none, so a stage of long answers asks for the most a room may be. */
  room(role: DepthRole): Promise<number | null>;
  /** Each stage's connection (by its name; its id when Lumiverse no longer has it) and model, as Settings → Depth sets them, for the estimate. */
  routes(): Promise<Record<BootstrapStage, { connection: string | null; model: string | null }>>;
  now(): number;
  /** The process's resident memory now, in bytes (§8.5: measured per stage on the dev copy). */
  rss(): number;
  /** Lets the one worker take other work between units (R9). */
  giveWay(): Promise<void>;
  log(line: string): void;
  changed(): void;
}

// ---------------------------------------------------------------- its state

/** What one job's calls spent, kept with its answer (§8.5, measured per job): the stage's counts and the tokens of them spent reasoning, where the provider said. */
interface JobSpent extends StageCounts {
  reasoningOut: number;
}

/** One call of a job whose answer its stage's parse didn't keep whole (`Reading`): its place among the job's calls, the fields, and the answer as the model wrote it. */
interface JobMisread extends CallMisread {
  call: number;
}

/** One job's recorded answer, and the entries it landed under its key. */
interface JobRecord {
  slot: string;
  key: string;
  at: number;
  out: unknown;
  entries: string[];
  /** What an earlier answer for the slot landed, which these entries supersede. */
  supersedes: string[];
  /** What asking it spent; absent from a record kept before it was measured. */
  spent?: JobSpent;
  /** Each call whose answer the parse didn't keep whole, with the fields and the answer as written: kept only for those (the raw-against-saved audit); absent when every call read whole. */
  misread?: JobMisread[];
  /** Each call whose answer room the provider refused as over the model's own, made again at the limit it stated. */
  capped?: { call: number; asked: number; limit: number }[];
}

/** What a job's calls leave as they are made: what they spent, those whose answer the parse didn't keep whole, the rooms providers capped. */
interface JobCalls {
  spent: JobSpent;
  misread: JobMisread[];
  capped: NonNullable<JobRecord["capped"]>;
}

/** A job whose asking failed (not a Pause or the cap): why, what its calls spent, and each call whose answer the parse couldn't keep whole, as written; beside its record, for the audit alone (Resume never reads it). */
interface FailedJob {
  slot: string;
  key: string;
  at: number;
  why: string;
  spent: JobSpent;
  misread?: JobMisread[];
  capped?: JobRecord["capped"];
}

function isJob(raw: unknown): raw is JobRecord {
  return typeof raw === "object" && raw !== null && "slot" in raw && typeof raw.slot === "string" && "key" in raw && typeof raw.key === "string" && "entries" in raw && Array.isArray(raw.entries);
}

interface ChapterState {
  n: number;
  from: number;
  to: number;
  ended: boolean;
  /** Its title, as the author named it when it ended the chapter. */
  title?: string | null;
}

/** A chunk the main lane finished: what it was made from, and the running keys after it. */
interface ChunkProgress {
  chunk: string;
  epoch: string;
  author: string;
  link: string;
  minds: Record<EntityId, string>;
}

/** A beat the user marked wrong, waiting for the author's amendment (§8.6): the card and item, the beat, the chunk it came from and the user's word. */
interface Amend {
  card: string;
  item: string;
  beat: string;
  chunk: number;
  note: string;
  at: number;
}

interface RunState {
  version: 1;
  status: BootstrapStatus;
  reason: string | null;
  startedAt: number | null;
  elapsedMs: number;
  cap: BootstrapCap | null;
  spent: Record<BootstrapStage, StageCounts>;
  /** Per stage: the units (chunks; chapters for reconcile) that asked a model, for the measured rates. */
  units: Record<BootstrapStage, number>;
  /** Per stage: the largest resident memory measured as its calls and landings ended, in bytes (0: not yet). */
  rss: Record<BootstrapStage, number>;
  /** The historian's key per chunk: its chain, from the start. */
  hist: string[];
  progress: ChunkProgress[];
  chapters: ChapterState[];
  /** Who has a mind, from the chunk the author gave it one. */
  minds: Record<EntityId, { name: string; since: number }>;
  /** Newcomers the history met, by the id the run gave them. */
  newcomers: Record<EntityId, { name: string; since: number }>;
  /** New places the history met, by the id the run gave them. */
  places: Record<string, { name: string; since: number }>;
  /** The player character in force at the end of each chunk the historian read (D-10). */
  pcs: EntityId[];
  /** Beats marked wrong, oldest first, for the author to amend before the run's next chunk. */
  amends: Amend[];
  /** Redo from chapter N (§8.4): each makes every job from its first chunk on new. */
  redos: { from: number; at: number }[];
  wrongInRow: number;
  redoFrom: number | null;
  imported: ImportView[];
  /** The answers the parsers didn't keep whole since the last card, for the next one (at most `MISREAD_KEPT`, the latest). */
  misread: SpotMisread[];
  log: string[];
}

const RUN = "run.json";

function isRunState(raw: unknown): raw is RunState {
  return typeof raw === "object" && raw !== null && "version" in raw && raw.version === 1 && "progress" in raw && Array.isArray(raw.progress) && "hist" in raw && Array.isArray(raw.hist);
}

/** The chat's history as the run covered it when it first reached the latest message: every later survey reads only these messages, since what came after is play (§8.3). */
interface Handover {
  version: 1;
  at: number;
  messages: MessageId[];
}

const HANDOVER = "handover.json";

function isHandover(raw: unknown): raw is Handover {
  return typeof raw === "object" && raw !== null && "version" in raw && raw.version === 1 && "messages" in raw && Array.isArray(raw.messages) && raw.messages.every((m: unknown) => typeof m === "string");
}

function perStage<T>(make: () => T): Record<BootstrapStage, T> {
  const out: Partial<Record<BootstrapStage, T>> = {};
  for (const s of BOOTSTRAP_STAGES) out[s] = make();
  return out as Record<BootstrapStage, T>;
}

function freshState(): RunState {
  return {
    version: 1,
    status: "idle",
    reason: null,
    startedAt: null,
    elapsedMs: 0,
    cap: null,
    spent: perStage(() => ({ ...NO_COUNTS })),
    units: perStage(() => 0),
    rss: perStage(() => 0),
    hist: [],
    progress: [],
    chapters: [],
    minds: {},
    newcomers: {},
    places: {},
    pcs: [],
    amends: [],
    redos: [],
    wrongInRow: 0,
    redoFrom: null,
    imported: [],
    misread: [],
    log: [],
  };
}

/** The run starts nothing more: Pause, the cap, or the chain moved under it. */
class Halt extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Halt";
  }
}

/** How many beats before a chunk the historian reads as what was established. */
const BEFORE_BEATS = 40;

/** The most misread answers the run keeps for the next card; past it the oldest go (their records keep them). */
const MISREAD_KEPT = 64;

/**
 * The stages whose answers grow with what they read (§8.3), which ask by the room rule
 * (`BootstrapRun.roomRule`): the historian's beats, the author's readings, chapter revisions and
 * amendments, the characters' catch-ups and reflections, and the GM's truth link.
 */
const LONG_ANSWERS: Readonly<Partial<Record<BootstrapStage, true>>> = { historian: true, author: true, minds: true, truthlink: true };

/** What a failure of a call the provider refused at the most a room may be says to do, where the refusal speaks of the room (`roomRefused`: never a key, an account's access or a missing model, which no room changes): set the role's own room, which the bootstrap asks first. */
function roomAdvice(role: DepthRole): string {
  const label = DEPTH_ROLE_WORDS[role].label;
  return `With no answer room of its own set, the bootstrap asks for the most an answer may have (${DEPTH_ROOM_MOST.toLocaleString("en-US")} tokens), and its provider refused the call: set a room it takes in Settings → Depth → ${label}${label.endsWith("s") ? "'" : "'s"} answer room (run it on its own model), and the bootstrap asks for that instead`;
}

export function totalOf(spent: Readonly<Record<BootstrapStage, StageCounts>>): StageCounts {
  const out: StageCounts = { ...NO_COUNTS };
  for (const s of Object.values(spent)) {
    out.calls += s.calls;
    out.tokensIn += s.tokensIn;
    out.tokensOut += s.tokensOut;
    out.ms += s.ms;
    if (s.cost !== null) out.cost = (out.cost ?? 0) + s.cost;
  }
  return out;
}

/** Runs `each` over `items`, at most `limit` at once; the first failure is thrown once all have stopped. */
async function bounded<T>(items: readonly T[], limit: number, each: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed: { error: unknown } | null = null;
  const worker = async (): Promise<void> => {
    while (failed === null && next < items.length) {
      const item = items[next++] as T;
      try {
        await each(item);
      } catch (error) {
        failed ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  if (failed !== null) throw (failed as { error: unknown }).error;
}

function jobFile(slot: string): string {
  return `jobs/${slot.replaceAll(":", "_")}.json`;
}

/** The chunk of a job that lands entries, from its record's file (`jobFile` of `<stage>:<n>` or `<stage>:<n>:<who>`); null for any other file: the historian's and the points of view's (they land through the beats' job), a failed job's, an amendment's (its beats' record names what it landed). */
function chunkOfJob(file: string): number | null {
  const m = /^jobs\/(?:author|beats|seed|minds|truthlink|reflect|chapter|reconcile)_(\d+)(?:_.*)?\.json$/.exec(file);
  return m && !file.endsWith(".failed.json") ? Number(m[1]) : null;
}

/** The kind of an entry a redone job lands holding nothing but what it takes the place of (§8.4): asked again, the job made nothing, or it isn't asked any more. */
const REDONE = "bootstrap.redone";

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
}

/** The message a beat the historian distilled came from ("" for a beat from anywhere else). */
function sourceOf(beat: Pick<Beat, "by">): MessageId {
  return "bootstrap" in beat.by ? beat.by.bootstrap.message : "";
}

/** The latest story minute among the rows, where the ledger had one. */
function lastClock(rows: readonly SpoolRow[]): number {
  for (let i = rows.length - 1; i >= 0; i--) {
    const c = rows[i]?.clock;
    if (c !== null && c !== undefined) return c;
  }
  return 0;
}

// ---------------------------------------------------------------- the run

export class BootstrapRun {
  private state: RunState = freshState();
  private manifest: SpoolManifest | null = null;
  private entries: ImportedEntry[] = [];
  private running: Promise<void> | null = null;
  private pausing = false;
  /** One of the run's two lanes stopped: the other starts no job after the ones under way. */
  private laneStopped = false;
  private runningSince: number | null = null;
  private loaded = false;
  /** The units (a stage and its chunk; its chapter for reconcile) that asked a model, each counted once for the measured rates, whichever lane asked it. */
  private unitsSeen = new Set<string>();
  /** The player character the history starts with (D-10): the world's own. */
  private firstPc: EntityId = "";
  /**
   * What the run landed for the chunks it runs again, by entry, with its chunk: what it replaces as it
   * goes (§8.4). Every stage reads the world without them; each leaves as what takes its place lands,
   * or as it lands again unchanged, and what a chunk's run leaves of its own is retired at its end.
   */
  private stale = new Map<string, number>();
  /** Settles once the run is to start no more jobs (Pause, a run of wrong marks, the other lane stopped): what a wait on a turn in flight gives way to. */
  private stop = Promise.withResolvers<void>();

  constructor(private readonly env: BootstrapEnv) {}

  /** Reads the run's state and spool manifest from storage, once. */
  async load(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.env.files.read(RUN, isRunState);
    // A state saved before a field existed reads with that field fresh.
    this.state = stored ? { ...freshState(), ...stored } : freshState();
    this.manifest = await this.env.files.read(MANIFEST, isManifest);
    // A run cut off by a restart stands paused: nothing starts again without the user.
    if (this.state.status === "running" || this.state.status === "pausing") {
      this.state.status = "paused";
      this.state.reason = "The run was interrupted (a restart); Resume carries on where it stopped.";
    }
    this.loaded = true;
  }

  get busy(): boolean {
    return this.running !== null;
  }

  get status(): BootstrapStatus {
    return this.state.status;
  }

  /** Surveys the chat for the estimate, without starting anything (§8.1 step 1). */
  async survey(): Promise<SpoolManifest> {
    await this.load();
    const { manifest } = await this.spool(await this.env.knobs());
    if (this.state.status === "idle") this.state.status = "estimated";
    await this.save();
    return manifest;
  }

  /**
   * Surveys the chat's history and spools it (§8.1 step 1): the path up to depth's play (`messages`),
   * and once the run has handed over, only the messages it covered then, so a later start (a mark, a
   * redo, a resume) amends and redoes, never reads on into play (§8.3). With the messages spooled.
   */
  private async spool(knobs: BootstrapKnobs): Promise<{ manifest: SpoolManifest; spooled: MessageId[] }> {
    const handover = await this.env.files.read(HANDOVER, isHandover);
    const covered = handover ? new Set(handover.messages) : null;
    // What LumiBooks covers, the env's `covered`, isn't spooled (Round 2 item 1); it is empty until the author's jumpstart pass reads the records (`JUMPSTART_SKIPS_COVERED`), so every message is read.
    const lumibooks = (await this.env.covered?.()) ?? new Set<MessageId>();
    const history = (await this.env.messages()).filter((m) => (covered === null || covered.has(m.id)) && !lumibooks.has(m.id));
    this.manifest = await survey(this.env.files, history, knobs.chunkTokens, this.env.now());
    return { manifest: this.manifest, spooled: history.map((m) => m.id) };
  }

  /** Starts, or resumes, the run in the background, and answers at once. */
  async start(cap: BootstrapCap | null | undefined): Promise<void> {
    await this.load();
    if (cap !== undefined) this.state.cap = cap;
    if (this.running) {
      await this.save();
      return;
    }
    this.pausing = false;
    this.stop = Promise.withResolvers<void>();
    this.state.status = "running";
    this.state.reason = null;
    this.state.startedAt ??= this.env.now();
    this.runningSince = this.env.now();
    await this.save();
    this.running = this.loop().finally(() => {
      this.running = null;
      this.env.changed();
    });
  }

  /** Starts no more jobs; calls under way finish and are kept. */
  async pause(): Promise<void> {
    await this.load();
    if (!this.running) return;
    this.pausing = true;
    this.stop.resolve();
    this.state.status = "pausing";
    await this.save();
  }

  /** The background run's end (tests, shutdown). */
  async settled(): Promise<void> {
    await this.running;
  }

  /** Redo from chapter N (§8.4, §8.6): every job from its first chunk on is asked again, superseding what it landed. */
  async redo(chapter: number): Promise<void> {
    await this.load();
    if (this.running) throw new Error("Pause the run before a redo.");
    const c = this.state.chapters.find((ch) => ch.n === chapter);
    if (!c) throw new Error(`there is no chapter ${chapter + 1}`);
    this.state.redos.push({ from: c.from, at: this.env.now() });
    this.state.redoFrom = null;
    this.state.wrongInRow = 0;
    if (this.state.status === "done") this.state.status = "paused";
    this.state.reason = `Redo from chapter ${chapter + 1}: Resume runs everything from chunk ${c.from + 1} on again, superseding what it landed.`;
    this.note(this.state.reason);
    await this.save();
  }

  /**
   * The user's mark on a spot-check item (§8.6). A beat marked wrong is a directive: it waits for the
   * author's amendment, which the run makes before its next chunk (a finished run starts again for
   * it). A run of wrong marks pauses the run and offers a redo.
   */
  async mark(cardId: string, itemId: string, right: boolean, note: string): Promise<void> {
    await this.load();
    const file = `spot/${cardId}.json`;
    const card = await this.env.files.read(file, isCard);
    if (!card) throw new Error("no such spot-check card");
    const item = card.items.find((i) => i.id === itemId);
    if (!item) throw new Error("no such item on the card");
    item.mark = { right, note: note.slice(0, 2000), at: this.env.now() };
    await this.env.files.write(file, card);
    this.state.wrongInRow = right ? 0 : this.state.wrongInRow + 1;
    if (!right) this.note(`Marked wrong on chapter ${card.chapter + 1}'s card (${item.kind}): ${note || "no note"}`);
    // The chunk a wrong beat came from, by its message's place on the path. A contradiction marked wrong says its beat is wrong as the entry has it: that beat is amended the same way, with the entry beside the user's word.
    let chunk = !right && item.kind === "beat" ? this.manifest?.chunks.find((c) => item.index >= c.firstIndex && item.index <= c.lastIndex)?.n : undefined;
    const contradicted = item.kind === "contradiction" ? (item.id.split(":").at(-1) ?? "") : "";
    if (!right && item.kind === "contradiction") {
      const chapter = this.state.chapters.find((c) => c.n === card.chapter);
      for (const n of chapter ? range(chapter.from, chapter.to) : []) if (chunk === undefined && (await this.recordOf<HistorianOut>(`historian:${n}`))?.beats.some((b) => b.id === contradicted)) chunk = n;
    }
    const beat = item.kind === "beat" ? item.beat : contradicted;
    if (beat !== "") this.state.amends = this.state.amends.filter((a) => a.beat !== beat);
    if (chunk !== undefined && beat !== "") {
      const why = item.kind === "contradiction" ? `${item.mark.note} (The ${item.title} entry says: ${item.text.slice(0, 1500)}; the import found: ${item.why})` : item.mark.note;
      this.state.amends.push({ card: cardId, item: itemId, beat, chunk, note: why, at: item.mark.at });
      this.note(`The author amends that beat before the run's next chunk, and the characters who lived it live the corrected beat.`);
    }
    const knobs = await this.env.knobs();
    const offered = !right && this.state.wrongInRow >= knobs.pauseAfterWrong;
    if (offered) {
      this.state.redoFrom = card.chapter;
      this.state.reason = `${this.state.wrongInRow} wrong marks in a row, so the run is paused: Redo from chapter ${card.chapter + 1}, perhaps with other models for the historian and the point-of-view render, or Resume to carry on${this.state.amends.length > 0 ? ", amending the beats marked wrong first" : ""}.`;
      if (this.running) {
        this.pausing = true;
        this.stop.resolve();
        this.state.status = "pausing";
      } else if (this.state.status !== "done" || this.state.amends.length > 0) this.state.status = "paused";
    }
    await this.save();
    // A finished run starts again to amend; a paused one amends when it resumes.
    if (chunk !== undefined && !this.running && this.state.status === "done") await this.start(undefined);
  }

  async view(optedIn: boolean): Promise<BootstrapView> {
    await this.load();
    const knobs = await this.env.knobs();
    const manifest = this.manifest;
    const total = manifest?.chunks.length ?? 0;
    const cards: SpotCheckCard[] = [];
    for (const file of (await this.env.files.list("spot/")).sort()) {
      const card = await this.env.files.read(file, isCard);
      if (card) cards.push(card);
    }
    const spot = cards.filter((c) => c.items.some((i) => i.mark === null));
    const chapters: ChapterView[] = this.state.chapters.map((c) => {
      const mine = cards.filter((k) => k.chapter === c.n);
      return { n: c.n, chunks: [c.from, c.to], ended: c.ended, spot: mine.length === 0 ? "none" : mine.some((k) => k.items.some((i) => i.mark === null)) ? "waiting" : "reviewed" };
    });
    const done = this.state.progress.length;
    const stageDone: Record<BootstrapStage, number> = {
      survey: manifest ? 1 : 0,
      import: this.state.units.import > 0 || this.state.imported.length > 0 ? 1 : 0,
      historian: Math.min(total, this.state.hist.length),
      author: done,
      pov: done,
      minds: done,
      truthlink: done,
      reconcile: this.state.chapters.filter((c) => c.ended).length,
    };
    const stageTotal = (s: BootstrapStage): number => (s === "survey" || s === "import" ? 1 : s === "reconcile" ? Math.max(this.state.chapters.length, stageDone.reconcile) : total);
    const minds = Object.keys(this.state.minds).length;
    return {
      chatId: this.env.chatId,
      optedIn,
      status: this.state.status,
      reason: this.state.reason,
      startedAt: this.state.startedAt,
      updatedAt: this.env.now(),
      elapsedMs: this.state.elapsedMs + (this.runningSince !== null ? this.env.now() - this.runningSince : 0),
      chunks: { done, total },
      progress: BOOTSTRAP_STAGES.map((stage) => ({ stage, done: stageDone[stage], total: stageTotal(stage), spent: this.state.spent[stage], rss: this.state.rss[stage] > 0 ? this.state.rss[stage] : null })),
      chapters,
      spent: totalOf(this.state.spent),
      cap: this.state.cap,
      remaining: manifest ? estimateRemaining({ chatId: this.env.chatId, manifest, knobs, routes: await this.env.routes(), spent: this.state.spent, units: this.state.units, done, chapters: this.state.chapters.filter((c) => c.ended).length, minds: minds > 0 ? minds : Math.min((await this.env.people()).cast.length, knobs.mostMinds > 0 ? knobs.mostMinds : Infinity), rss: Math.max(0, ...Object.values(this.state.rss)) || null }) : null,
      imported: this.state.imported,
      spot,
      redoFrom: this.state.redoFrom,
      advice: [],
      log: this.state.log.slice(-BOOTSTRAP_LOG_LINES),
    };
  }

  // ------------------------------------------------------------ the loop

  private async loop(): Promise<void> {
    this.laneStopped = false;
    try {
      const knobs = await this.env.knobs();
      const { manifest, spooled } = await this.spool(knobs);
      this.measure("survey");
      const from = this.rewind(manifest);
      await this.editsAsFixes(from);
      // What it landed for the chunks it runs again: every stage reads the world without it, as it will be once what replaces it lands.
      this.stale = await this.landedFrom(from);
      this.env.ledger.replacing(new Set(this.stale.keys()));
      const imported = await this.env.imports();
      this.measure("import");
      this.entries = imported.entries;
      if (this.state.imported.length === 0) this.state.units.import += 1;
      this.state.imported = imported.views;
      await this.save();
      this.env.changed();
      const people = await this.env.people();
      this.firstPc = people.pov;
      const historian = this.historianLane(manifest, from, people);
      // The historian runs ahead; the rest follow it chunk by chunk. A lane that stops (Pause, the cap, a
      // failure) stops the other at its next job, and the run ends only once both have: no lane asks on
      // after the run stopped, and what both spent is saved.
      const stopped: unknown[] = [];
      const lane = (p: Promise<void>): Promise<void> =>
        p.catch((error: unknown) => {
          if (stopped.length === 0) stopped.push(error);
          this.laneStopped = true;
          this.stop.resolve();
        });
      await Promise.all([lane(historian.done), lane(this.mainLane(manifest, from, knobs, people, historian.ready))]);
      if (stopped.length > 0) throw stopped[0];
      this.state.status = "done";
      this.state.reason = null;
      // The first time, the history it covered is the chat's: what comes after is play, never read.
      if (!(await this.env.files.read(HANDOVER, isHandover))) await this.env.files.write(HANDOVER, { version: 1, at: this.env.now(), messages: spooled } satisfies Handover);
      this.note("The run reached the latest message: this chat's memory is now its beats, its characters' minds and the author's notebook.");
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      this.state.status = "paused";
      this.state.reason = error instanceof Halt ? why : `The run stopped: ${why}. Resume tries again from the job that failed.`;
      this.note(this.state.reason);
      if (!(error instanceof Halt)) this.env.log(`bootstrap of chat ${this.env.chatId} stopped: ${error instanceof Error ? (error.stack ?? why) : why}`);
    } finally {
      if (this.runningSince !== null) this.state.elapsedMs += this.env.now() - this.runningSince;
      this.runningSince = null;
      this.pausing = false;
      await this.save();
    }
  }

  /**
   * The first chunk whose recorded progress no longer holds (it never finished, its messages or their
   * swipes changed, or a redo reaches it), with everything decided from it on forgotten: those chunks'
   * chapters, minds, newcomers, places and switches are decided again as the run reaches them, and a
   * beat marked wrong in them is read afresh by the historian rather than amended.
   */
  private rewind(manifest: SpoolManifest): number {
    let n = 0;
    for (; n < this.state.progress.length && n < manifest.chunks.length; n++) {
      const p = this.state.progress[n];
      if (!p || p.chunk !== manifest.chunks[n]?.key || p.epoch !== this.redoEpoch(n)) break;
    }
    if (n < this.state.progress.length) this.note(`Chunk ${n + 1} changed since it was read: everything from it on runs again, and what it lands supersedes the old.`);
    this.state.progress.length = n;
    this.state.hist.length = Math.min(this.state.hist.length, n);
    this.state.pcs.length = Math.min(this.state.pcs.length, n);
    this.state.chapters = this.state.chapters.filter((c) => c.from < n);
    const open = this.state.chapters.at(-1);
    if (open && open.to >= n) {
      open.to = Math.max(open.from, n - 1);
      open.ended = false;
    }
    for (const [id, m] of Object.entries(this.state.minds)) if (m.since >= n) delete this.state.minds[id];
    for (const [id, m] of Object.entries(this.state.newcomers)) if (m.since >= n) delete this.state.newcomers[id];
    for (const [id, m] of Object.entries(this.state.places)) if (m.since >= n) delete this.state.places[id];
    const moot = this.state.amends.filter((a) => a.chunk >= n).length;
    if (moot > 0) this.note(`${moot} beat${moot === 1 ? "" : "s"} marked wrong ${moot === 1 ? "is" : "are"} in chunks that run again: the historian reads them afresh instead.`);
    this.state.amends = this.state.amends.filter((a) => a.chunk < n);
    return n;
  }

  /**
   * The messages edited since the run read them that kept their swipe's key (`EDITS`, an assistant
   * edit): each is the author's fix (§8.4), so every beat that came from it is queued for amending
   * beside the message as it now reads, as a beat marked wrong is, and the characters who lived it
   * live the amended beat. A chunk that runs again reads its edits itself; an edited message no beat
   * came from is noted.
   */
  private async editsAsFixes(from: number): Promise<void> {
    const edits = await this.env.files.read(EDITS, isEdits);
    if (!edits) return;
    for (const e of edits) {
      const chunk = this.manifest?.chunks[e.n];
      if (e.n >= from || !chunk) continue;
      const beats = ((await this.recordOf<HistorianOut>(`historian:${e.n}`))?.beats ?? []).filter((b) => sourceOf(b) === e.message);
      if (beats.length === 0) this.note(`A message read in chunk ${e.n + 1} was edited since, but no beat came from it: nothing to amend.`);
      const text = (await this.rows(chunk)).find((r) => r.id === e.message)?.text ?? "";
      // The edit's own text keys the amendment: an edit made again is amended again.
      const note = `He edited this message after its history was read: the message as it now reads is his fix (edit ${hashParts("edit", text).slice(0, 8)}).`;
      for (const b of beats) {
        this.state.amends = this.state.amends.filter((a) => !(a.beat === b.id && a.item === `edit:${e.message}`));
        this.state.amends.push({ card: "", item: `edit:${e.message}`, beat: b.id, chunk: e.n, note, at: this.env.now() });
      }
    }
    await this.env.files.remove(EDITS);
    await this.save();
  }

  /**
   * What the run landed for chunks `from` on (§8.4), by entry, with its chunk: what every job record
   * of such a chunk names, past the chunk count too, and what each superseded. As the run reaches
   * them, a job asked again lands entries that take their place, one answered as it was lands them
   * again unchanged, and what neither touches is retired as its chunk's run ends.
   */
  private async landedFrom(from: number): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const file of await this.env.files.list("jobs/")) {
      const n = chunkOfJob(file);
      if (n === null || n < from) continue;
      const rec = await this.env.files.read(file, isJob);
      for (const id of rec ? [...rec.entries, ...rec.supersedes] : []) out.set(id, n);
    }
    return out;
  }

  /** The historian's lane: chunk by chunk, each after the last; `ready(n)` resolves with chunk n's key once its answer is recorded. */
  private historianLane(manifest: SpoolManifest, from: number, people: { cast: Person[]; pov: EntityId }): { ready: (n: number) => Promise<string>; done: Promise<void> } {
    const waits = manifest.chunks.map(() => Promise.withResolvers<string>());
    for (const w of waits) w.promise.catch(() => undefined);
    for (let n = 0; n < from; n++) waits[n]?.resolve(this.state.hist[n] ?? "");
    const done = (async () => {
      let prev = from > 0 ? (this.state.hist[from - 1] ?? "start") : "start";
      let before = await this.beforeOf(from);
      // The player character throughout (D-10): the one the history starts with. A switch the historian reads is noted, never landed.
      const pc = this.firstPc;
      try {
        for (let n = from; n < manifest.chunks.length; n++) {
          const chunk = manifest.chunks[n] as ChunkInfo;
          const key = hashParts(`historian:${n}`, chunk.key, prev, this.redoEpoch(n));
          const opening = pc;
          const out = await this.answer<HistorianOut>(`historian:${n}`, key, "historian", async (model) => {
            const rows = await this.rows(chunk);
            const cast = [...people.cast, ...Object.entries(this.state.newcomers).map(([id, m]) => ({ id, name: m.name }))];
            // The places earlier chunks made, landed or not (the fold at this chunk lags the main lane): named by id, never made again.
            const made = Object.entries(this.state.places).map(([id, m]) => ({ id, name: m.name }));
            const raw = await this.readStretch({ chunk: rows, before, cast, places: made, pov: opening, basis: chunk.basis }, model);
            // Newcomers and new places get ids of their own: the same for the same name however often they are met, however an answer spells it (`sameName`).
            const ids: Record<string, EntityId> = {};
            for (const c of raw.newcomers) {
              const name = c.name.trim();
              const known = Object.entries(this.state.newcomers).find(([, m]) => sameName(name, m.name))?.[0];
              ids[c.ref] = known ?? `bs_${hashParts("bootstrap.newcomer", this.env.chatId, name.toLowerCase()).slice(0, 10)}`;
            }
            const places: Record<string, string> = {};
            for (const p of raw.newPlaces ?? []) {
              const name = p.name.trim();
              const known = Object.entries(this.state.places).find(([, m]) => sameName(name, m.name))?.[0];
              places[p.ref] = known ?? `bsp_${hashParts("bootstrap.place", this.env.chatId, name.toLowerCase()).slice(0, 10)}`;
            }
            return this.env.stages.bindNewcomers(raw, ids, places);
          });
          for (const c of out.newcomers) this.state.newcomers[c.ref] ??= { name: c.name.trim(), since: n };
          for (const p of out.newPlaces ?? []) this.state.places[p.ref] ??= { name: p.name.trim(), since: n };
          for (const s of out.switches ?? []) this.note(`The history has the player play ${people.cast.find((p) => p.id === s.who)?.name ?? this.state.newcomers[s.who]?.name ?? s.who} from message ${s.message} on. Switching isn't supported yet, so ${people.cast.find((p) => p.id === pc)?.name ?? pc} stays the player character.`);
          this.state.pcs[n] = pc;
          this.state.hist[n] = key;
          prev = key;
          before = this.carry(before, out);
          waits[n]?.resolve(key);
          await this.env.giveWay();
        }
      } catch (error) {
        for (const w of waits) w.reject(error);
        throw error;
      }
    })();
    return { ready: (n) => waits[n]?.promise ?? Promise.reject(new Error(`no chunk ${n}`)), done };
  }

  /** What the historian reads before chunk `n` as established: the latest beats and everyone's latest staging, from the records before it. */
  private async beforeOf(n: number): Promise<{ beats: Beat[]; staging: Staging[]; blobs: Record<string, string> }> {
    let before: { beats: Beat[]; staging: Staging[]; blobs: Record<string, string> } = { beats: [], staging: [], blobs: {} };
    const outs: HistorianOut[] = [];
    for (let k = n - 1, beats = 0; k >= 0 && beats < BEFORE_BEATS; k--) {
      const out = await this.recordOf<HistorianOut>(`historian:${k}`);
      if (!out) break;
      outs.unshift(out);
      beats += out.beats.length;
    }
    for (const out of outs) before = this.carry(before, out);
    return before;
  }

  /**
   * The historian's reading of a stretch. An answer cut off at its room even when asked again at
   * twice it is no reading: a stretch of two or more messages is then read as its two halves, the
   * second after what the first established, and the two readings put together; a single message
   * cut off so fails as before.
   */
  private async readStretch(input: Parameters<BootstrapStages["historian"]>[0], model: ModelPort): Promise<HistorianOut> {
    try {
      return await this.env.stages.historian(input, model);
    } catch (error) {
      if (!(error instanceof DepthAnswerError) || !error.cut || input.chunk.length < 2) throw error;
      const half = Math.ceil(input.chunk.length / 2);
      this.note(`The historian's answer for ${input.chunk.length} messages was cut off at its answer room twice: they are read as two halves instead.`);
      const a = await this.readStretch({ ...input, chunk: input.chunk.slice(0, half) }, model);
      const b = await this.readStretch({ ...input, chunk: input.chunk.slice(half), before: this.carry(input.before, a) }, model);
      const reasoning = [a.reasoning, b.reasoning].filter((r) => r !== undefined && r !== "").join("\n\n");
      return {
        ...b,
        events: [...a.events, ...b.events],
        blobs: { ...a.blobs, ...b.blobs },
        beats: [...a.beats, ...b.beats.map((x) => ({ ...x, order: x.order + a.beats.length }))],
        newcomers: [...a.newcomers, ...b.newcomers.filter((c) => !a.newcomers.some((o) => o.ref === c.ref))],
        newPlaces: [...(a.newPlaces ?? []), ...(b.newPlaces ?? []).filter((p) => !(a.newPlaces ?? []).some((o) => o.ref === p.ref))],
        switches: [...(a.switches ?? []), ...(b.switches ?? [])],
        uncertain: [...a.uncertain, ...b.uncertain],
        ...(reasoning !== "" ? { reasoning } : {}),
      };
    }
  }

  private carry(before: { beats: Beat[]; staging: Staging[]; blobs: Record<string, string> }, out: HistorianOut): { beats: Beat[]; staging: Staging[]; blobs: Record<string, string> } {
    const beats = [...before.beats, ...out.beats].slice(-BEFORE_BEATS);
    const latest = new Map<EntityId, Staging>();
    for (const s of [...before.staging, ...out.staging]) latest.set(s.who, s);
    const staging = [...latest.values()];
    const blobs: Record<string, string> = {};
    for (const ref of [...beats.flatMap((b) => [b.what, b.surface, b.quotes]), ...staging.flatMap((s) => [s.where, s.doing, s.occluded])]) {
      if (ref === undefined) continue;
      const text = out.blobs[ref] ?? before.blobs[ref];
      if (text !== undefined) blobs[ref] = text;
    }
    return { beats, staging, blobs };
  }

  /** The main lane: per chunk, the beats marked wrong amended first, then the author, the points of view, the beats landing, the catch-ups and the truth link; at a chapter's end its reflection, revision, reconciliation and card. */
  private async mainLane(manifest: SpoolManifest, from: number, knobs: BootstrapKnobs, people: { cast: Person[]; pov: EntityId }, ready: (n: number) => Promise<string>): Promise<void> {
    const prior = from > 0 ? this.state.progress[from - 1] : undefined;
    let authorKey = prior?.author ?? "start";
    let linkKey = prior?.link ?? "start";
    const mindKeys = new Map<EntityId, string>(Object.entries(prior?.minds ?? {}));
    let chapter = this.state.chapters.at(-1);
    for (let n = from; n < manifest.chunks.length; n++) {
      this.halt();
      await this.amendQueued(n - 1, knobs, people.cast);
      const chunk = manifest.chunks[n] as ChunkInfo;
      if (!chapter || chapter.ended) chapter = this.openChapter((chapter?.n ?? -1) + 1, n);
      const histKey = await ready(n);
      const hist = await this.recordOf<HistorianOut>(`historian:${n}`);
      if (!hist) throw new Halt(`The historian's answer for chunk ${n + 1} is missing; Resume asks again.`);
      chapter.to = n;
      const rows = await this.rows(chunk);
      const cast = this.castOf(people.cast);
      const pc = this.firstPc;
      // The author reads the chunk with its beats: where chapters end, who gets a mind, the notebook.
      const authorSlot = `author:${n}`;
      const aKey = hashParts(authorSlot, histKey, authorKey);
      const ch = chapter;
      const author = await this.answer<AuthorOut>(authorSlot, aKey, "author", (model) => this.env.stages.authorRead({ chunk: rows, beats: hist.beats, blobs: hist.blobs, chapter: { index: ch.n, chunks: range(ch.from, n) }, cast, basis: chunk.basis }, model));
      authorKey = aKey;
      // The player character gets no mind (D-10): no one the player plays through the whole chunk. Past the most minds the settings allow, the author's further picks wait unminded.
      const passed: string[] = [];
      for (const pick of author.cast) {
        if (pick.mind && !this.state.minds[pick.who] && knobs.mostMinds > 0 && Object.keys(this.state.minds).length >= knobs.mostMinds) {
          passed.push(cast.find((p) => p.id === pick.who)?.name ?? this.state.newcomers[pick.who]?.name ?? pick.who);
          continue;
        }
        if (!pick.mind || this.state.minds[pick.who] || pick.who === pc) continue;
        const name = cast.find((p) => p.id === pick.who)?.name ?? this.state.newcomers[pick.who]?.name;
        if (name !== undefined) this.state.minds[pick.who] = { name, since: n };
      }
      if (passed.length > 0) this.note(`Chunk ${n + 1}: ${passed.join(", ")} got no mind: the run is at its most minds (${knobs.mostMinds}, Settings → Depth → Bootstrap).`);
      const minded = Object.keys(this.state.minds);
      // Points of view for every beat that reached someone with a mind in part (its own act with a deed aside), as a message without its words, or whole but involving someone it doesn't know (`needsPov`); never the player character at that beat.
      const known = await this.env.stages.knows(minded, chunk.basis);
      const partOf = (beat: Beat): EntityId[] => beat.exposure.filter((e) => minded.includes(e.who) && e.who !== pc && needsPov(beat, e.who, known[e.who] ?? [])).map((e) => e.who);
      const povSlot = `pov:${n}`;
      const pKey = hashParts(povSlot, histKey, aKey);
      const povs = await this.answer<Record<string, Record<EntityId, string>>>(povSlot, pKey, "pov", async (model) => {
        const out: Record<string, Record<EntityId, string>> = {};
        await bounded(
          hist.beats.filter((b) => partOf(b).length > 0),
          knobs.atOnce.minds,
          async (beat) => {
            const quotes = beat.quotes !== undefined ? hist.blobs[beat.quotes] : undefined;
            const r = await this.env.stages.pov({ beat, surface: hist.blobs[beat.surface] ?? "", ...(quotes !== undefined ? { quotes } : {}), staging: hist.staging, blobs: hist.blobs, who: partOf(beat), basis: chunk.basis }, model);
            out[beat.id] = r.povs;
            this.fellBackPovs(beat.id, r.fellBack);
          },
        );
        return out;
      });
      // The chunk's beats land at their own source messages, each with the points of view it reached, with the author's notebook and the cores of those just given a mind: one write.
      const bKey = hashParts(`beats:${n}`, histKey, pKey);
      const first: LayerDraft[] = [...(await this.beatDrafts(n, bKey, rows, hist, povs, pc)), ...(await this.draftOf(authorSlot, aKey, author, chunk.basis, "author"))];
      for (const who of minded) {
        if (this.state.minds[who]?.since !== n) continue;
        const seedSlot = `seed:${n}:${who}`;
        const sKey = hashParts(seedSlot, aKey);
        const core = author.cast.find((p) => p.who === who)?.core ?? null;
        const seeded = await this.answer<StageOut | null>(seedSlot, sKey, "minds", () => this.env.stages.seedCore({ who: { id: who, name: this.state.minds[who]?.name ?? who }, author: core, entries: this.entries, at: lastClock(rows), basis: chunk.basis }));
        first.push(...(await this.draftOf(seedSlot, sKey, seeded, chunk.basis, "minds")));
        mindKeys.set(who, hashParts(mindKeys.get(who) ?? "start", sKey));
      }
      await this.landBatch(first);
      // Each one's catch-up on what reached it, in story order, characters at once, landing where it last isn't the player character; mind writes at an old message re-fold the chain from it, so they land together.
      const lived = this.livedOf(hist, povs, minded, rows, pc, chunk.basis, known);
      const caught = minded.filter((w) => lived.has(w));
      const writes = new Map<EntityId, LayerDraft[]>();
      await bounded(caught, knobs.atOnce.minds, async (who) => {
        const mine = lived.get(who) as { lived: Lived[]; basis: Basis };
        const slot = `minds:${n}:${who}`;
        const key = hashParts(slot, bKey, mindKeys.get(who) ?? "start");
        const out = await this.answer<StageOut>(slot, key, "minds", (model) => this.env.stages.catchUp({ who: { id: who, name: this.state.minds[who]?.name ?? who }, at: mine.lived.at(-1)?.at ?? lastClock(rows), lived: mine.lived, basis: mine.basis }, model));
        writes.set(who, await this.draftOf(slot, key, out, mine.basis, "minds"));
        mindKeys.set(who, key);
      });
      await this.landBatch(caught.flatMap((w) => writes.get(w) ?? []));
      // The GM's truth link waits for the chapter's end: one call over the chapter, not one per chunk (`linkChapter`).
      if (author.chapterEnds && n < manifest.chunks.length - 1) {
        chapter.title = author.title ?? null;
        linkKey = await this.linkChapter(chapter, chunk, mindKeys, linkKey);
        authorKey = await this.endChapter(chapter, chunk, knobs, mindKeys, linkKey, authorKey);
      }
      // What the run landed for this chunk before, that nothing landed now took the place of, is retired before the chunk counts as done.
      if (n < manifest.chunks.length - 1) await this.retire((k) => k === n);
      this.note(`Chunk ${n + 1} of ${manifest.chunks.length} done (resident memory ${Math.round(this.env.rss() / 1048576)} MB).`);
      this.state.progress[n] = { chunk: chunk.key, epoch: this.redoEpoch(n), author: authorKey, link: linkKey, minds: Object.fromEntries(mindKeys) };
      await this.save();
      this.env.changed();
      await this.env.giveWay();
    }
    // The last chapter closes where the history ends, and what the run landed before for the last chunk and any past the end is retired; then whatever was marked wrong meanwhile is amended.
    const last = manifest.chunks.at(-1);
    if (last && chapter && !chapter.ended && chapter.from <= last.n) {
      linkKey = await this.linkChapter(chapter, last, mindKeys, linkKey);
      await this.endChapter(chapter, last, knobs, mindKeys, linkKey, authorKey);
    }
    await this.retire(() => true);
    await this.amendQueued(manifest.chunks.length - 1, knobs, people.cast);
  }

  /**
   * The GM's truth link for a chapter, once at its end: what its beats established, linked to what
   * each character with a mind by then now believes, at the basis of its last chunk. The running
   * link key after it.
   */
  private async linkChapter(chapter: ChapterState, chunk: ChunkInfo, mindKeys: Map<EntityId, string>, linkKey: string): Promise<string> {
    const read = await this.chapterRead(chapter);
    const minds = Object.entries(this.state.minds)
      .filter(([id, m]) => m.since <= chunk.n && id !== this.firstPc)
      .map(([id]) => id);
    const slot = `truthlink:${chunk.n}`;
    const key = hashParts(slot, ...range(chapter.from, chapter.to).map((k) => this.state.hist[k] ?? ""), linkKey, ...minds.map((w) => mindKeys.get(w) ?? ""));
    const linked = await this.answer<StageOut>(slot, key, "truthlink", (model) => this.env.stages.truthLink({ beats: read.beats, blobs: read.blobs, minds, basis: chunk.basis }, model));
    await this.landBatch(await this.draftOf(slot, key, linked, chunk.basis, "truthlink"));
    return key;
  }

  private openChapter(n: number, from: number): ChapterState {
    const c = { n, from, to: from, ended: false };
    this.state.chapters.push(c);
    return c;
  }

  /** A chapter's end: each character but the player character reflects, the author revises the notebook deeply, the GM reconciles the imported entries, and a card is queued. The author's running key after it. */
  private async endChapter(chapter: ChapterState, chunk: ChunkInfo, knobs: BootstrapKnobs, mindKeys: Map<EntityId, string>, linkKey: string, authorKey: string): Promise<string> {
    const rows = await this.rows(chunk);
    const at = lastClock(rows);
    const minded = Object.keys(this.state.minds);
    // The player character has no agent to reflect (D-10).
    const pcEnd = this.firstPc;
    const reflecting = minded.filter((w) => w !== pcEnd);
    const reflections = new Map<EntityId, LayerDraft[]>();
    await bounded(reflecting, knobs.atOnce.minds, async (who) => {
      const slot = `reflect:${chunk.n}:${who}`;
      const key = hashParts(slot, mindKeys.get(who) ?? "start");
      const out = await this.answer<StageOut>(slot, key, "minds", (model) => this.env.stages.reflect({ who: { id: who, name: this.state.minds[who]?.name ?? who }, at, basis: chunk.basis }, model));
      reflections.set(who, await this.draftOf(slot, key, out, chunk.basis, "minds"));
      mindKeys.set(who, key);
    });
    await this.landBatch(reflecting.flatMap((w) => reflections.get(w) ?? []));
    const read = await this.chapterRead(chapter);
    const cast = Object.entries(this.state.minds).map(([id, m]) => ({ id, name: m.name }));
    const revSlot = `chapter:${chunk.n}`;
    const rKey = hashParts(revSlot, authorKey, linkKey, ...minded.map((w) => mindKeys.get(w) ?? ""));
    const revised = await this.answer<AuthorOut>(revSlot, rKey, "author", (model) => this.env.stages.authorChapter({ chapter: { index: chapter.n, chunks: range(chapter.from, chapter.to), title: chapter.title ?? null, through: chunk.last }, beats: read.beats, blobs: read.blobs, cast, basis: chunk.basis }, model));
    await this.landBatch(await this.draftOf(revSlot, rKey, revised, chunk.basis, "author"));
    let contradictions: ReconcileOut["contradictions"] = [];
    const recSlot = `reconcile:${chunk.n}`;
    const recKey = hashParts(recSlot, rKey, ...this.entries.map((e) => `${e.id}:${e.digest}`));
    if (this.entries.length > 0) {
      const final = chunk.n === (this.manifest?.chunks.length ?? 0) - 1;
      const span: [number, number] = [this.manifest?.chunks[chapter.from]?.firstIndex ?? 0, chunk.lastIndex];
      const reconciled = await this.answer<ReconcileOut>(recSlot, recKey, "reconcile", (model) => this.env.stages.reconcile({ chapter: chapter.n, final, span, at, entries: this.entries, beats: read.beats, blobs: read.blobs, minds: cast, basis: chunk.basis }, model));
      await this.landBatch(await this.draftOf(recSlot, recKey, reconciled, chunk.basis, "reconcile"));
      contradictions = reconciled.contradictions;
    }
    chapter.ended = true;
    chapter.to = chunk.n;
    // The spot-check card (§8.6): a sample of beats beside their prose, a character's memories beside what it lived, a notebook excerpt, every contradiction.
    const cardId = `c${String(chapter.n).padStart(4, "0")}-${hashParts(recKey).slice(0, 8)}`;
    if (!(await this.env.files.read(`spot/${cardId}.json`, isCard))) {
      const minds: { who: EntityId; name: string; out: StageOut }[] = [];
      for (const who of minded)
        for (const n of range(chapter.from, chapter.to)) {
          const out = await this.recordOf<StageOut>(`minds:${n}:${who}`);
          if (out) minds.push({ who, name: this.state.minds[who]?.name ?? who, out });
        }
      // Beside its items, what the historian and the author flagged as uncertain, and the answers the parsers didn't keep whole since the last card.
      const noted = [...read.uncertain, ...revised.uncertain];
      for (const n of range(chapter.from, chapter.to)) noted.push(...((await this.recordOf<AuthorOut>(`author:${n}`))?.uncertain ?? []));
      const card = buildSpotCard({ id: cardId, chapter: chapter.n, now: this.env.now(), sample: knobs.sample, seed: hash32(cardId), beats: read.beats, blobs: read.blobs, uncertain: noted, prose: read.prose, minds, povs: read.povs, notebook: revised, contradictions, entries: this.entries, misread: this.state.misread });
      await this.env.files.write(`spot/${cardId}.json`, card);
      this.state.misread = [];
    }
    this.note(`Chapter ${chapter.n + 1} (chunks ${chapter.from + 1}–${chapter.to + 1}) is done; its spot-check card is waiting.`);
    await this.save();
    this.env.changed();
    return hashParts(authorKey, rKey);
  }

  // ------------------------------------------------------------ jobs: record, land, resume

  /**
   * One job's answer: the one recorded under this key, else asked now (metered, within the cap) and
   * recorded before anything it produced lands, with each call its parse didn't keep whole (the
   * fields and the answer as written, for the next spot-check card too) and each room its provider
   * capped. A new answer for a slot remembers what the slot's earlier answer landed, for its entries
   * to supersede.
   */
  private async answer<T>(slot: string, key: string, stage: BootstrapStage, ask: (model: ModelPort) => Promise<T>): Promise<T> {
    const recorded = await this.env.files.read(jobFile(slot), isJob);
    if (recorded && recorded.key === key) return recorded.out as T;
    this.halt();
    const job: JobCalls = { spent: { ...NO_COUNTS, reasoningOut: 0 }, misread: [], capped: [] };
    // Every failed job is logged as it fails: of two failing at once (the historian's lane and the main lane's), the run's reason names only the first.
    const out = await ask(this.roomRule(stage, this.metered(stage, job))).catch(async (error: unknown) => {
      const halted = error instanceof Halt;
      const { spent, misread, capped } = job;
      // A job a Halt stopped (Pause, the cap before a call asked again) keeps a failed record only for an answer its parse couldn't keep whole, which no record holds otherwise.
      if (!halted || misread.length > 0) {
        const why = error instanceof Error ? error.message : String(error);
        if (!halted) this.env.log(`bootstrap job ${slot} of chat ${this.env.chatId} failed: ${why}`);
        // Why it failed, what it spent, and each answer its parse couldn't keep whole as written (one that wasn't JSON among them), beside its record; a write that fails leaves the log line.
        await this.env.files.write(jobFile(slot).replace(/\.json$/, ".failed.json"), { slot, key, at: this.env.now(), why, spent, ...(misread.length > 0 ? { misread } : {}), ...(capped.length > 0 ? { capped } : {}) } satisfies FailedJob).catch(() => undefined);
      }
      throw error;
    });
    const supersedes = recorded ? [...recorded.entries, ...recorded.supersedes.filter((id) => !recorded.entries.includes(id))] : [];
    const { spent, misread, capped } = job;
    await this.env.files.write(jobFile(slot), { slot, key, at: this.env.now(), out, entries: [], supersedes, spent, ...(misread.length > 0 ? { misread } : {}), ...(capped.length > 0 ? { capped } : {}) } satisfies JobRecord);
    this.state.misread.push(...misread.map((m): SpotMisread => ({ stage, job: slot, call: m.call, fields: m.fields, count: m.count })));
    this.state.misread.splice(0, Math.max(0, this.state.misread.length - MISREAD_KEPT));
    // A unit is a stage's chunk (its chapter for reconcile and the truth link), counted once: the historian's lane runs ahead of the chunk the rest are on, and an amendment's jobs belong to no chunk.
    const unit = slot.split(":")[1] ?? "";
    if (/^\d+$/.test(unit) && !this.unitsSeen.has(`${stage}:${unit}`)) {
      this.unitsSeen.add(`${stage}:${unit}`);
      this.state.units[stage] += 1;
    }
    return out;
  }

  /**
   * A stage's events as one entry at the latest message it read, its texts put first, taking the
   * place of what the slot landed before (`carried`); asked again, a job that makes nothing lands
   * that alone (§8.4). None for a job that makes nothing and never landed anything.
   */
  private async draftOf(slot: string, key: string, out: StageOut | null, basis: Basis, stage: BootstrapStage): Promise<LayerDraft[]> {
    const rec = await this.env.files.read(jobFile(slot), isJob);
    const id = layerEntryId("bootstrap", this.env.chatId, slot, key);
    const by = { role: stage, job: slot };
    const made: LayerDraft[] = [];
    if (out && out.events.length > 0) {
      const blobs = { ...out.blobs };
      const reasoning = out.reasoning ? putText(blobs, out.reasoning) : undefined;
      await this.env.ledger.putBlobs(blobs);
      made.push({ id, basis, kind: out.kind ?? out.events[0]?.type ?? "bootstrap", events: out.events, ...(reasoning ? { reasoning } : {}), by });
    }
    const drafts = await this.carried(made, (rec?.supersedes ?? []).filter((s) => s !== id), { id: layerEntryId("bootstrap", this.env.chatId, slot, key, "redone"), basis, by });
    const ids = drafts.map((d) => d.id);
    if (rec && rec.key === key && ids.some((x) => !rec.entries.includes(x))) await this.env.files.write(jobFile(slot), { ...rec, entries: ids });
    return drafts;
  }

  /**
   * A slot's drafts, in order, with what it landed before giving way first (§8.4), from at or before
   * all of it, so every draft after is checked without it and a fold through any of its messages
   * reads it gone: on the first draft where that is the earliest, else on an entry of its own holding
   * nothing but its supersessions (`redone`), as one whose job made nothing lands.
   */
  private async carried(drafts: readonly LayerDraft[], supersedes: readonly string[], redone: { id: string; basis: Basis; by: { role: string; job: string } }): Promise<LayerDraft[]> {
    if (supersedes.length === 0) return [...drafts];
    const head = drafts[0];
    const at = await this.earliest(head?.basis ?? redone.basis, supersedes);
    if (head && head.basis.message === at.message && head.basis.swipe === at.swipe) return [{ ...head, supersedes: [...supersedes] }, ...drafts.slice(1)];
    return [{ id: redone.id, basis: at, kind: REDONE, events: [], supersedes: [...supersedes], by: redone.by }, ...drafts];
  }

  /** Of `first` and the bases of the landed entries `ids`, the earliest on the active chain (one off it never counts). */
  private async earliest(first: Basis, ids: readonly string[]): Promise<Basis> {
    const at = new Map((await this.env.ledger.chain()).map((b, i) => [`${b.message}\u0000${b.swipe}`, i]));
    const index = (b: Basis): number => at.get(`${b.message}\u0000${b.swipe}`) ?? Number.POSITIVE_INFINITY;
    const wanted = new Set(ids);
    let best = first;
    for (const e of await this.env.ledger.entries()) if (wanted.has(e.id) && index(e.basis) < index(best)) best = e.basis;
    return best;
  }

  /**
   * The chunk's beats as entries, one per source message, with the points of view filled in, after
   * the newcomers and new places they meet. The slot's record names them before any lands.
   */
  private async beatDrafts(n: number, key: string, rows: readonly SpoolRow[], hist: HistorianOut, povs: Record<string, Record<EntityId, string>>, pc: EntityId): Promise<LayerDraft[]> {
    const slot = `beats:${n}`;
    const blobs: Record<string, string> = { ...hist.blobs };
    const beats = hist.beats.map((b): Beat => {
      const reached = povs[b.id] ?? {};
      return { ...b, exposure: b.exposure.map((e) => (reached[e.who] !== undefined ? { ...e, pov: putText(blobs, reached[e.who] as string) } : e)) };
    });
    const drafts: LayerDraft[] = [];
    const first = rows[0];
    const born = hist.newcomers.filter((c) => this.state.newcomers[c.ref]?.since === n);
    const places = (hist.newPlaces ?? []).filter((p) => this.state.places[p.ref]?.since === n);
    if (first && (born.length > 0 || places.length > 0)) {
      // A newcomer the player character was placed to perceive acting, or being spoken of, is someone he has met.
      const metBy = (id: EntityId): EntityId | null => {
        const b = beats.find((x) => (x.actors.includes(id) || x.about.some((r) => "entity" in r && r.entity === id)) && x.exposure.some((e) => e.who === pc));
        return b ? pc : null;
      };
      const made = await this.env.stages.spawn(
        born.map((c) => ({ id: c.ref, name: c.name, note: c.note, knownBy: metBy(c.ref) })),
        places.map((p) => ({ id: p.ref, name: p.name, note: p.note, parent: p.parent })),
        first.basis,
      );
      if (made.people.length > 0) drafts.push({ id: layerEntryId("bootstrap", this.env.chatId, slot, key, "spawn"), basis: first.basis, kind: "spawn", events: made.people, by: { role: "historian", job: slot } });
      if (made.places.length > 0) drafts.push({ id: layerEntryId("bootstrap", this.env.chatId, slot, key, "places"), basis: first.basis, kind: "space.place", events: made.places, by: { role: "historian", job: slot } });
    }
    // One entry per source message, the closing staging with the last: what the next chunk opens on; each with the historian's account of the chunk, readable beside it.
    const byMessage = this.env.stages.beatEvents(beats, hist.staging, blobs, rows);
    const reasoning = hist.reasoning ? putText(blobs, hist.reasoning) : undefined;
    for (const row of rows) {
      const events = byMessage[row.id] ?? [];
      if (events.length > 0) drafts.push({ id: layerEntryId("bootstrap", this.env.chatId, slot, key, row.id), basis: row.basis, kind: STORY_BEAT, events, ...(reasoning ? { reasoning } : {}), by: { role: "historian", job: slot } });
    }
    const rec = await this.env.files.read(jobFile(slot), isJob);
    const made = drafts.map((d) => d.id);
    const supersedes = rec && rec.key !== key ? [...rec.entries, ...rec.supersedes].filter((id) => !made.includes(id)) : (rec?.supersedes ?? []);
    // What the slot landed before gives way first, from at or before all of it: the newcomers it brought in come in again, checked without it.
    const carried = await this.carried(drafts, supersedes, { id: layerEntryId("bootstrap", this.env.chatId, slot, key, "redone"), basis: first?.basis ?? (rows.at(-1) as SpoolRow).basis, by: { role: "historian", job: slot } });
    if (!rec || rec.key !== key) await this.env.files.write(jobFile(slot), { slot, key, at: this.env.now(), out: null, entries: carried.map((d) => d.id), supersedes } satisfies JobRecord);
    await this.env.ledger.putBlobs(blobs);
    return carried;
  }

  /**
   * Lands drafts in order, what the run is still replacing read as gone on both sides of every check,
   * each held by a turn in flight waited for, so the job after reads it (§8.2). A draft that takes
   * others' place lands before the drafts after it; refused, its job's other drafts don't land beside
   * what it would have replaced, which stands, and a chunk's beats halt the run. A refusal also halts
   * the run when its basis left the chain (Resume surveys again); any other is logged and the run goes
   * on. The jobs whose replacement was refused.
   */
  private async landBatch(drafts: readonly LayerDraft[]): Promise<Set<string>> {
    const refused = new Set<string>();
    for (let i = 0; i < drafts.length; ) {
      const next = drafts.findIndex((d, k) => k > i && (d.supersedes?.length ?? 0) > 0);
      const end = (drafts[i]?.supersedes?.length ?? 0) > 0 ? i + 1 : next < 0 ? drafts.length : next;
      const part = drafts.slice(i, end).filter((d) => !refused.has(d.by?.job ?? d.id));
      i = end;
      if (part.length > 0) for (const job of await this.landPart(part)) refused.add(job);
    }
    return refused;
  }

  /** Lands one part of a batch (`landBatch`); the jobs whose replacement was refused. */
  private async landPart(drafts: readonly LayerDraft[]): Promise<string[]> {
    const own = new Set(drafts.flatMap((d) => [d.id, ...(d.supersedes ?? [])]));
    const without = new Set([...this.stale.keys()].filter((id) => !own.has(id)));
    const results = await Promise.race([this.env.ledger.landAll(drafts, without), this.stop.promise.then(() => null)]);
    if (results === null) {
      this.halt();
      throw new Halt("Paused: the calls under way finished and are kept; Resume carries on.");
    }
    for (const role of new Set(drafts.map((d) => d.by?.role))) if (role !== undefined && (BOOTSTRAP_STAGES as readonly string[]).includes(role)) this.measure(role as BootstrapStage);
    const refused: string[] = [];
    for (const [i, r] of results.entries()) {
      const d = drafts[i];
      if (!d || r.status === "held") continue;
      if (r.status === "landed") {
        // It stands now, and what it took the place of is gone: neither is read around any more.
        for (const id of [r.entry.id, ...(r.entry.supersedes ?? [])]) this.stale.delete(id);
        continue;
      }
      if (await this.env.ledger.moved(d.basis)) throw new Halt(`The chat changed under the run (${r.reason}); Resume surveys it again and carries on.`);
      if ((d.supersedes?.length ?? 0) > 0) {
        // What it would have replaced stands, and the run reads it again.
        for (const id of d.supersedes ?? []) this.stale.delete(id);
        refused.push(d.by?.job ?? d.id);
        const beats = /^beats:(\d+)$/.exec(d.by?.job ?? "");
        if (beats) {
          // Resume lands the same reading, recorded under its key, and meets the same refusal: only a redo has the chunk read afresh, so a redo is offered from its chapter.
          const n = Number(beats[1]);
          const chapter = this.state.chapters.find((c) => c.from <= n && n <= c.to);
          this.state.redoFrom = chapter?.n ?? null;
          throw new Halt(`Chunk ${n + 1}'s beats, read again, can't take the place of what the run landed for it before (${r.reason}). Resume lands that same reading again, so it meets this again unless what refused it changes: Redo from chapter ${(chapter?.n ?? 0) + 1}, perhaps with other models for the historian, to have the chunk read afresh.`);
        }
      }
      this.note(`An entry (${d.kind}, ${d.by?.job ?? d.id}) wasn't kept: ${r.reason}`);
      this.env.log(`bootstrap entry ${d.id} refused: ${r.reason}`);
    }
    this.env.ledger.replacing(new Set(this.stale.keys()));
    return refused;
  }

  /**
   * Retires what the run landed, before it ran them again, for the chunks `which` picks, that nothing
   * since took the place of or landed again (§8.4): a job the run no longer asks (a mind the author no
   * longer gives, a chapter that ends elsewhere, a chunk past the end) or whose answer made nothing.
   * One entry holding nothing but its supersessions, from at or before all of it; what is off the
   * chain or already superseded folds nowhere and is left as it is.
   */
  private async retire(which: (chunk: number) => boolean): Promise<void> {
    const left = new Set([...this.stale].filter(([, n]) => which(n)).map(([id]) => id));
    if (left.size === 0) return;
    const chain = new Set((await this.env.ledger.chain()).map((b) => `${b.message}\u0000${b.swipe}`));
    const live = (await this.env.ledger.entries()).filter((e) => chain.has(`${e.basis.message}\u0000${e.basis.swipe}`));
    const stopped = new Set(live.flatMap((e) => e.supersedes ?? []));
    const gone = live.filter((e) => left.has(e.id) && !stopped.has(e.id)).map((e) => e.id);
    for (const id of left) if (!gone.includes(id)) this.stale.delete(id);
    const first = live.find((e) => gone.includes(e.id));
    if (!first) {
      this.env.ledger.replacing(new Set(this.stale.keys()));
      return;
    }
    gone.sort();
    const by = { role: "bootstrap", job: "redone" };
    const refused = await this.landBatch(await this.carried([], gone, { id: layerEntryId("bootstrap", this.env.chatId, "redone", ...gone), basis: first.basis, by }));
    if (!refused.has(by.job)) this.note(`${gone.length} entr${gone.length === 1 ? "y" : "ies"} the run landed before, for what it ran again and nothing now takes the place of, ${gone.length === 1 ? "is" : "are"} retired.`);
  }

  // ------------------------------------------------------------ reads

  private async rows(chunk: ChunkInfo): Promise<SpoolRow[]> {
    const rows = await readChunk(this.env.files, chunk.n);
    if (!rows) throw new Halt("A chunk of the spool is missing; Resume surveys the chat again.");
    return rows;
  }

  private async recordOf<T>(slot: string): Promise<T | null> {
    const rec = await this.env.files.read(jobFile(slot), isJob);
    return rec ? (rec.out as T) : null;
  }

  /** The chapter's beats from its historian records, the points of view they reached, and the prose of the messages they came from. */
  private async chapterRead(chapter: ChapterState): Promise<{ beats: Beat[]; blobs: Record<string, string>; uncertain: string[]; povs: Record<string, Record<EntityId, string>>; prose: Map<MessageId, { text: string; index: number }> }> {
    const beats: Beat[] = [];
    const blobs: Record<string, string> = {};
    const uncertain: string[] = [];
    const povs: Record<string, Record<EntityId, string>> = {};
    const prose = new Map<MessageId, { text: string; index: number }>();
    for (const n of range(chapter.from, chapter.to)) {
      const out = await this.recordOf<HistorianOut>(`historian:${n}`);
      if (!out) continue;
      beats.push(...out.beats);
      Object.assign(blobs, out.blobs);
      uncertain.push(...out.uncertain);
      Object.assign(povs, (await this.recordOf<Record<string, Record<EntityId, string>>>(`pov:${n}`)) ?? {});
      for (const r of (await readChunk(this.env.files, n)) ?? []) prose.set(r.id, { text: r.text, index: r.index });
    }
    return { beats, blobs, uncertain, povs, prose };
  }

  /**
   * What reached each character with a mind, beat by beat in story order, as the shared reach rule
   * has it (`reachOf`): its own act as its own (from the inside where its point of view was written,
   * else the beat's deed), a message it sent with no place and one it received as the message's
   * words, else its own point of view where one was written or the surface where whole; a reach the
   * rule gives a point of view of its own (`needsPov`, with `known`) waits for one, so no text names
   * someone it doesn't know. The whole chunk for everyone but the player character (D-10), who lives
   * none of it, with the basis its catch-up lands at.
   */
  private livedOf(hist: Pick<HistorianOut, "beats" | "blobs">, povs: Record<string, Record<EntityId, string>>, minded: readonly EntityId[], rows: readonly SpoolRow[], pc: EntityId, end: Basis, known: Record<EntityId, EntityId[]>): Map<EntityId, { lived: Lived[]; basis: Basis }> {
    const out = new Map<EntityId, { lived: Lived[]; basis: Basis }>();
    const ordered = [...hist.beats].sort((a, b) => a.at - b.at || a.order - b.order);
    for (const who of minded) {
      const last = who === pc ? -1 : rows.length - 1;
      if (last < 0) continue;
      const upTo = new Set(rows.slice(0, last + 1).map((r) => r.id));
      const lived: Lived[] = [];
      for (const b of ordered) {
        const e = b.exposure.find((x) => x.who === who);
        if (!e || !upTo.has(sourceOf(b))) continue;
        const pov = povs[b.id]?.[who];
        if (pov === undefined && needsPov(b, who, known[who] ?? [])) continue;
        // Its own point of view, where one was written, rides its exposure as the render's blob would; every other text is the history's. The whole exposure stays: whom else it reached tells a message from what its sender saw.
        const mine = pov !== undefined ? blobHash(pov) : undefined;
        const reach = reachOf(mine !== undefined ? { ...b, exposure: b.exposure.map((x) => (x === e ? { ...e, pov: mine } : x)) } : b, who);
        const text = reach === null ? undefined : reach.text === mine ? pov : hist.blobs[reach.text];
        if (reach === null || text === undefined || text === "") continue;
        const quotes = reach.quotes !== undefined ? hist.blobs[reach.quotes] : undefined;
        lived.push({ beat: b.id, at: b.at, place: reach.place ?? "", channel: reach.channel, text, whole: reach.whole, as: reach.as, ...(reach.from !== undefined ? { from: reach.from } : {}), ...(quotes !== undefined ? { quotes } : {}) });
      }
      if (lived.length > 0) out.set(who, { lived, basis: last === rows.length - 1 ? end : (rows[last] as SpoolRow).basis });
    }
    return out;
  }

  /** Says each point of view of beat `beat` left pending: written naming someone who wasn't there that the GM's check couldn't set right, or not written at all, even when asked again; its person doesn't live the beat without one. */
  private fellBackPovs(beat: string, fellBack: Readonly<Record<EntityId, string[]>> | undefined): void {
    for (const [who, names] of Object.entries(fellBack ?? {})) this.note(fellBackLine(this.state.minds[who]?.name ?? who, `beat ${beat}`, names));
  }

  // ------------------------------------------------------------ beats marked wrong (§8.6)

  /**
   * The beats marked wrong, oldest first: the author amends each at its own source message (a beat
   * that supersedes it, or a strike where the message holds none), and each character who lived it,
   * as its chunk's catch-up had it, lives the corrected beat at the run's frontier (`frontier`, the
   * last chunk done) and rewrites, at its own path, every file of its mind that drew on the old one
   * (beside other beats too), with writes that supersede it (§4.2, Retcons propagate). It is an
   * amendment, not a redo: the jobs after it stand.
   */
  private async amendQueued(frontier: number, knobs: BootstrapKnobs, world: readonly Person[]): Promise<void> {
    const front = frontier >= 0 ? this.manifest?.chunks[frontier] : undefined;
    while (front && this.state.amends.length > 0) {
      this.halt();
      const a = this.state.amends[0] as Amend;
      const chunk = a.chunk <= frontier ? this.manifest?.chunks[a.chunk] : undefined;
      const hist = chunk ? await this.recordOf<HistorianOut>(`historian:${a.chunk}`) : null;
      const old = hist?.beats.find((b) => b.id === a.beat);
      const rows = chunk && old ? await this.rows(chunk) : [];
      const row = old ? rows.find((r) => r.id === sourceOf(old)) : undefined;
      if (chunk && hist && old && row) await this.amendOne(a, { chunk, front, hist, old, rows, row }, knobs, world);
      else this.note("A beat marked wrong is no longer one the history holds (its chunk was read afresh): nothing to amend.");
      this.state.amends = this.state.amends.filter((x) => x !== a);
      await this.save();
      this.env.changed();
    }
  }

  private async amendOne(a: Amend, at: { chunk: ChunkInfo; front: ChunkInfo; hist: HistorianOut; old: Beat; rows: SpoolRow[]; row: SpoolRow }, knobs: BootstrapKnobs, world: readonly Person[]): Promise<void> {
    const { chunk, front, hist, old, rows, row } = at;
    const pc = this.firstPc;
    const slot = `amend:${old.id}`;
    const key = hashParts(slot, this.state.hist[chunk.n] ?? "", a.note);
    const amended = await this.answer<AmendOut>(slot, key, "author", (model) => this.env.stages.amend({ beat: old, blobs: hist.blobs, message: row, note: a.note, cast: this.castOf(world), pov: pc, key, basis: chunk.basis }, model));
    const blobs: Record<string, string> = { ...amended.blobs };
    const all = { ...hist.blobs, ...blobs };
    const minded = Object.entries(this.state.minds)
      .filter(([, m]) => m.since <= chunk.n)
      .map(([id]) => id);
    // The corrected beat's reach, as its chunk's would have been: a point of view for each character with a mind it reached in part (its own act with a deed aside), as a message without its words, or whole with someone it doesn't know.
    const known = await this.env.stages.knows(minded, chunk.basis);
    let beat = amended.beat;
    let povs: Record<EntityId, string> = {};
    if (beat) {
      const b = beat;
      const who = b.exposure.filter((e) => minded.includes(e.who) && e.who !== pc && needsPov(b, e.who, known[e.who] ?? [])).map((e) => e.who);
      const quotes = b.quotes !== undefined ? all[b.quotes] : undefined;
      if (who.length > 0) {
        povs = await this.answer<Record<EntityId, string>>(`${slot}:pov`, hashParts(`${slot}:pov`, key), "pov", async (model) => {
          const r = await this.env.stages.pov({ beat: b, surface: all[b.surface] ?? "", ...(quotes !== undefined ? { quotes } : {}), staging: hist.staging, blobs: all, who, basis: chunk.basis }, model);
          this.fellBackPovs(b.id, r.fellBack);
          return r.povs;
        });
      }
      beat = { ...b, exposure: b.exposure.map((e) => (povs[e.who] !== undefined ? { ...e, pov: putText(blobs, povs[e.who] as string) } : e)) };
    }
    const why = amended.why.trim();
    const events = beat ? [beatEvent(beat)] : [strikeEvent({ beats: [old.id], ...(why !== "" ? { why: putText(blobs, why) } : {}) })];
    const landed = await this.draftOf(slot, key, { events, blobs, kind: beat ? STORY_BEAT : STORY_STRIKE, ...(amended.reasoning ? { reasoning: amended.reasoning } : {}) }, row.basis, "author");
    await this.landBatch(landed);
    // Whoever lived it lives the corrected beat at the frontier, and rewrites what it wrote from the
    // old one, as it had reached them; the player character has no agent (D-10).
    const minds = minded.filter((w) => w !== pc);
    const oldPovs = (await this.recordOf<Record<string, Record<EntityId, string>>>(`pov:${chunk.n}`)) ?? {};
    const was = this.livedOf({ beats: [old], blobs: hist.blobs }, oldPovs, minds, rows, pc, chunk.basis, known);
    const b = beat;
    const reach = b ? this.livedOf({ beats: [b], blobs: { ...all, ...blobs } }, { [b.id]: povs }, minds, rows, pc, chunk.basis, known) : new Map<EntityId, { lived: Lived[]; basis: Basis }>();
    const relive = [...new Set([...reach.keys(), ...was.keys()])];
    const writes = new Map<EntityId, LayerDraft[]>();
    await bounded(relive, knobs.atOnce.minds, async (who) => {
      const rSlot = `relive:${old.id}:${who}`;
      const rKey = hashParts(rSlot, key, front.key);
      const out = await this.answer<StageOut>(rSlot, rKey, "minds", (model) => this.env.stages.catchUp({ who: { id: who, name: this.state.minds[who]?.name ?? who }, at: b?.at ?? old.at, lived: reach.get(who)?.lived ?? [], basis: front.basis, supersedes: old.id, was: was.get(who)?.lived ?? [] }, model));
      writes.set(who, await this.draftOf(rSlot, rKey, out, front.basis, "minds"));
    });
    const relived = relive.flatMap((w) => writes.get(w) ?? []);
    await this.landBatch(relived);
    // Recorded with the chunk's beats, so a redo of the chunk supersedes the amendment with them.
    const file = jobFile(`beats:${chunk.n}`);
    const rec = await this.env.files.read(file, isJob);
    const ids = [...landed, ...relived].map((d) => d.id).filter((id) => !rec?.entries.includes(id));
    if (rec && ids.length > 0) await this.env.files.write(file, { ...rec, entries: [...rec.entries, ...ids] });
    const rewrote = relive.filter((w) => !reach.has(w) && (writes.get(w)?.length ?? 0) > 0).length;
    const also = rewrote > 0 ? `; ${rewrote} character${rewrote === 1 ? "" : "s"} rewrote what they wrote from it` : "";
    this.note(beat ? `The author amended a beat of chunk ${chunk.n + 1} marked wrong (${why || "no reason given"}); ${reach.size} character${reach.size === 1 ? "" : "s"} lived the corrected beat${also}.` : `The author struck a beat of chunk ${chunk.n + 1} marked wrong: ${why || "the message holds no such beat"}${also}.`);
  }

  private castOf(world: readonly Person[]): Person[] {
    const out = new Map(world.map((p) => [p.id, p]));
    for (const [id, m] of Object.entries(this.state.newcomers)) if (!out.has(id)) out.set(id, { id, name: m.name });
    return [...out.values()];
  }

  // ------------------------------------------------------------ the meter, the cap, the log

  /** Keeps the stage's largest resident memory so far. */
  private measure(stage: BootstrapStage): void {
    const rss = this.env.rss();
    if (rss > this.state.rss[stage]) this.state.rss[stage] = rss;
  }

  /**
   * The room rule over a stage's port (§8.3) where its answers grow with what it reads
   * (`LONG_ANSWERS`); any other stage's port as it is. Each call asks for the room its stage gives
   * it, else the room the user set its role (`room`), else the most a room may be
   * (`DEPTH_ROOM_MOST`): room left unused costs nothing. The depth port asks again at a limit its
   * provider states, keeping one that is the model's own for its connection and model, and once at
   * the role's own room on any other refusal (`depthPort`). An answer cut off at a room no provider
   * held is kept as misread and asked once more at twice it (`roomAgain`), the stage reading only the
   * second; a call refused at the most a room may be fails saying where the role's own is set.
   */
  private roomRule(stage: BootstrapStage, port: ModelPort): ModelPort {
    if (!LONG_ANSWERS[stage]) return port;
    return async (role, messages, opts) => {
      const own = await this.env.room(role);
      const asking: PortOptions = { ...opts, maxTokens: opts?.maxTokens ?? own ?? DEPTH_ROOM_MOST };
      const ask = (o: PortOptions): Promise<PortAnswer> =>
        port(role, messages, o).catch((error: unknown) => {
          throw own === null && !(error instanceof Halt) && roomRefused(error) ? new Error(`${error instanceof Error ? error.message : String(error)}. ${roomAdvice(role)}`, { cause: error }) : error;
        });
      const first = await ask(asking);
      const again = cutShort(first.finish) && first.capped === undefined && first.room !== undefined && !opts?.signal?.aborted ? roomAgain(first.room) : null;
      if (again === null) return first;
      readAnswer(role, first);
      return ask({ ...asking, maxTokens: again });
    };
  }

  /**
   * One stage's model port: each call metered against the stage, and against its job where one is
   * given, which keeps a capped room and, once its stage's parse says it misread a field, the call's
   * answer as written; none started after Pause or at the cap. An answer asked for as JSON that holds
   * no JSON object and wasn't cut off at its room is kept as misread and asked once more, the stage
   * reading only the second; both count in the spend.
   */
  private metered(stage: BootstrapStage, job?: JobCalls): ModelPort {
    return async (role, messages, opts) => {
      const first = await this.meteredCall(stage, job, role, messages, opts);
      if (!opts?.json || cutShort(first.finish) || answerRead(first.text)) return first;
      readAnswer(role, first);
      return this.meteredCall(stage, job, role, messages, opts);
    };
  }

  /** One call of `metered`'s port, made and metered. */
  private async meteredCall(stage: BootstrapStage, job: JobCalls | undefined, ...[role, messages, opts]: Parameters<ModelPort>): Promise<PortAnswer> {
    this.halt();
    const t0 = this.env.now();
    const answer: PortAnswer = await this.env.model(role, messages, opts);
    const ms = this.env.now() - t0;
    for (const s of job ? [this.state.spent[stage], job.spent] : [this.state.spent[stage]]) {
      s.calls += 1;
      s.tokensIn += answer.usage?.tokensIn ?? 0;
      s.tokensOut += answer.usage?.tokensOut ?? 0;
      if (answer.usage?.cost !== undefined) s.cost = (s.cost ?? 0) + answer.usage.cost;
      s.ms += ms;
    }
    this.measure(stage);
    if (!job) return answer;
    job.spent.reasoningOut += answer.usage?.reasoningOut ?? 0;
    const call = job.spent.calls - 1;
    if (answer.capped) job.capped.push({ call, ...answer.capped });
    let kept: JobMisread | null = null;
    const inner = answer.misread;
    return {
      ...answer,
      misread: (fields) => {
        inner?.(fields);
        if (!kept) {
          kept = { call, fields: [], count: 0, raw: answer.text };
          job.misread.push(kept);
        }
        noteMisread(kept, fields);
      },
    };
  }

  private halt(): void {
    if (this.pausing) throw new Halt(this.state.redoFrom !== null && this.state.reason ? this.state.reason : "Paused: the calls under way finished and are kept; Resume carries on.");
    if (this.laneStopped) throw new Halt("The run's other lane stopped.");
    const cap = this.state.cap;
    if (!cap) return;
    const total = totalOf(this.state.spent);
    // A money cap measures nothing on a connection that reports no price: the run stops rather than run uncapped.
    if (cap.unit === "money" && Object.values(this.state.spent).some((s) => s.calls > 0 && s.cost === null)) throw new Halt("A money cap can't bind on this run: a stage's connection reports no price for its calls, so what the run spends can't be measured in money. Set the cap in tokens (or no cap), then Resume.");
    const used = cap.unit === "tokens" ? total.tokensIn + total.tokensOut : (total.cost ?? 0);
    if (used < cap.value) return;
    const what = cap.unit === "tokens" ? `${used.toLocaleString("en-US")} of ${cap.value.toLocaleString("en-US")} tokens` : `${used.toFixed(2)} of ${cap.value.toFixed(2)}`;
    throw new Halt(`The run reached its cap (${what}) after ${this.state.progress.length} of ${this.manifest?.chunks.length ?? 0} chunks and paused; the rest is estimated below. Raise the cap, give fewer characters a mind (Settings → Depth → Bootstrap → Most characters with a mind), or pick cheaper models for the historian and the point-of-view render, then Resume.`);
  }

  private redoEpoch(n: number): string {
    return this.state.redos
      .filter((r) => r.from <= n)
      .map((r) => `${r.from}@${r.at}`)
      .join(",");
  }

  private note(line: string): void {
    this.state.log.push(line);
    if (this.state.log.length > BOOTSTRAP_LOG_LINES * 2) this.state.log.splice(0, this.state.log.length - BOOTSTRAP_LOG_LINES);
  }

  private async save(): Promise<void> {
    await this.env.files.write(RUN, this.state);
  }
}

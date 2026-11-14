// A turn, from a tagged request to a saved message (plan §10.1, §10.7, §10.8, §6.3). Code gathers what
// the Author is shown and records what it did; it decides nothing about how a turn is run.
//
// Intake: the chat in RPE's store (a fork of a chat RPE knows shares its tree), the generations that
// ended unheard tied to what they saved, the chat's path compared with the turn tree, the turns that
// left the path cancelled, the wait for the previous turn's run (a swipe or regenerate does not wait for
// the attempt it replaces: it stops it), the new turn (a continue goes on with the turn its message is
// tied to, as a run of its own), the chat's session, the briefing's blocks (the turn's facts, the lore
// map, the world state, and from the story record the story so far and the story brief) with what has
// happened since the last turn, and the turn's folder (`folder.ts`).
//
// The run: RPH answers, its reply streamed to Lumiverse as it is written; the run may go on after the
// reply is released, and Lumiverse stopping before the release stops it. A run that ends with no reply
// ends the reply with a plain line from a file.
//
// Commit: when Lumiverse says the generation ended, the saved message is read back and the turn tied
// to it by the hash of what was stored; an impersonation, which saves no message, leaves an attempt with
// no state. If the event was missed, the next intake ties it the same way.

import { type Fields, loadGuidance, type Guidance, type LinesPart, type TemplatePart } from "rp-harness";
import type { Clock, ContextBlock, Harness, JobView, JsonObject, Log, ReplyError, ReplySink, Scope, SinceItem, TurnRequest, Usage } from "rp-harness/contract";
import { forkOf, reconcile, type ChatChange, type ChatChanges } from "../adapter/lumiverse/events";
import type { TaggedTurn, TurnPlayer } from "../adapter/lumiverse/provider";
import type { LumiverseReads, LvStep } from "../adapter/lumiverse/reads";
import type { LvMessage } from "../adapter/lumiverse/rows";
import type { ReplyStream } from "../adapter/lumiverse/stream";
import { textHash } from "../adapter/lumiverse/wire";
import type { LiveHub } from "../app";
import { castMark, takeBackCast } from "../cast";
import { calendarOf, formatClock } from "../engine/calendar";
import { mapLines, mapView } from "../iface";
import { type Lore, loreMapFields } from "../lore";
import { type DueSource, type PathEntry, type PathReport, type ShownMessage, type Store, type TurnRow, worldState } from "../store";
import { sceneSession, storyBrief, storyMark, storyRecordParts, takeBackStory } from "../story";
import { storyAt } from "../story/path";
import { STORY_SO_FAR_DEFAULTS, storySoFar } from "../story/sofar";
import { type Pruned, type TreeChats, type TreeFiles, type TreeNotes, turnFolderName } from "../tree";
import { type Attempt, writeTurnFolder } from "./folder";
import type { Writes } from "./kv";
import type { PlayerSide } from "./player";
import type { TurnPrompts } from "./prompt";
import { writeTurnRecord } from "./record";
import { leftOutOf, maxTokensOf, prefillOf, promptOf, samplingOf, summarizedOf } from "./request";
import type { Run, RunRecord, Runs } from "./runs";
import { maskWorldInfoScanExclusions, SCAN_SETTING, scannedSteps, scanSettingsOf } from "./scan";
import { type TurnSettings, turnSettings } from "./settings";
import { type FoundItem, foundItems, type KeptItem, type SinceKept } from "./since";
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
} as const;

/** The names the briefing's template places the host's blocks by. */
export const BLOCKS = { turnFacts: "turn-facts", loreMap: "lore-map", worldState: "world-state", storySoFar: "story-so-far", storyBrief: "story-brief" } as const;

/** Characters to a token, for measuring the story so far against its share of the Author's window: the figure RPH's own estimates use. */
const CHARS_PER_TOKEN = 3.2;

/** A session's id while a chat has none yet: the settings are read before the turn that opens one, and no file of theirs is a session's. */
export const NO_SESSION = "none";

/** How a run RPE stopped during ended, as the Turn page shows it: no agent is told it. */
const STOPPED_MID_RUN: ReplyError = { code: "failed", detail: "RPE stopped while this run was going on." };

export interface TurnLaneDeps {
  store: Store;
  writes: Writes;
  files: TreeFiles;
  chats: TreeChats;
  prompts: TurnPrompts;
  lore: Lore;
  runs: Runs;
  /** The player's messages as RPE read them, and their requests through a panel. */
  player: PlayerSide;
  /** What comparisons of a chat's path found, kept with the chat. */
  since: SinceKept;
  /** The notes agents write, put as they stand at each turn's start (plan §5.4). */
  notes: TreeNotes;
  /** Prunes the chat's older turn folders (plan §5.5), sparing these folders of turns going on. */
  pruneTurns(user: string, chat: string, spare: ReadonlySet<string>): Promise<Pruned>;
  /** What time brings due, for the world state's due section. */
  due: DueSource;
  /** What a migration carried of a chat, for its first briefing on RPE. */
  migrated: MigratedSource;
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

function words(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The swipe a generation wrote, as Lumiverse saved it (plan §6.3): the one it was given at its start, which need not be the one shown
 * now; for a message Lumiverse made only when it saved, its one swipe. Null when which swipe it wrote cannot be told.
 */
function writtenOf(run: RunRecord, saved: LvMessage): LvMessage["saves"][number] | null {
  if (run.target === saved.id && run.swipe !== null) return saved.saves[run.swipe] ?? null;
  return run.target === null && saved.saves.length === 1 ? (saved.saves[0] ?? null) : null;
}

/** The text a message shows: its showing swipe's, where its hash is the one the message shows by, else its content. */
function shownText(m: LvMessage): string {
  const save = m.saves[m.swipe]?.text;
  return save !== undefined && textHash(save) === m.shown.hash ? save : m.text;
}

/** What a turn's intake found that the block of what has happened since the last turn tells. */
interface Found {
  report: PathReport;
  steps: readonly LvStep[];
  notices: LinesPart | undefined;
  /** The chat's guidance, for the parts a notice's text is laid out by. */
  guidance: Guidance;
  /** The last turn's run, as kept before this turn began. */
  last: RunRecord | null;
  /** The runs this turn stopped at their limit. */
  stopped: readonly RunRecord[];
  /** A continue of a turn: its first run was told what came before it. */
  again: boolean;
  /** The message a swipe or a regenerate writes again; null for any other turn. */
  replaced: string | null;
  /** Whether the chat lets agents read its hidden messages. */
  hiddenReadable: boolean;
}

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
  /** Each chat's standby line, from its progress part at its last intake. */
  readonly #standby = new Map<string, string>();
  /** The standby line of a chat RPE has not met yet: the shipped and global levels' progress part. */
  #standbyDefault: string | null = null;
  /** Ends heard for a generation whose intake goes on and has no run yet; recorded once its run has given its reply. */
  readonly #early = new Map<string, Ended>();
  /** The generations whose intake goes on and has no run yet. */
  readonly #taking = new Set<string>();
  /** By chat: the intakes going on, the newest last; each waits for the one before it to hold its run, or to end. */
  readonly #intakes = new Map<string, Promise<void>>();
  /** Changes being recorded, so the next intake can wait for them. */
  readonly #recording = new Set<Promise<unknown>>();
  /** By chat: the turns whose deleted message was heard of, cancelled and told to RPH then, until the chat's next comparison. */
  readonly #deletedTold = new Map<string, Set<string>>();

  constructor(deps: TurnLaneDeps) {
    this.#d = deps;
  }

  // ---------------------------------------------------------------- the adapter's side

  standbyLine(turn: TaggedTurn): string {
    return this.#standby.get(`${turn.tag.user}\u0000${turn.tag.chat}`) ?? this.#standbyDefault ?? "";
  }

  /** Reads the standby line a chat RPE has not met yet is given: the progress part of the shipped and global levels. */
  async preload(): Promise<void> {
    const user = this.#d.owner();
    if (user === null) return;
    const part = lines(await loadGuidance(this.#d.files, { user, chat: crypto.randomUUID(), session: NO_SESSION }).part(PARTS.progress));
    this.#standbyDefault = part?.line("started") ?? null;
  }

  async play(tagged: TaggedTurn, out: ReplyStream, signal: AbortSignal): Promise<void> {
    const received = this.#d.clock.now();
    // How long each step of the intake takes, for the log: measured, never acted on.
    const took: Record<string, number> = {};
    let mark = performance.now();
    const lap = (step: string): void => {
      const now = performance.now();
      took[step] = Math.round((now - mark) * 100) / 100;
      mark = now;
    };
    const reads = this.#d.reads();
    if (reads === null) throw new Error("RPE is not set up for a Lumiverse, so it cannot play this chat.");
    const { tag } = tagged;
    const { user, chat } = tag;
    const store = this.#d.store.user(user);
    // One intake at a time for a chat (plan §10.1): from here until its run is held, which the next one then waits for as the turn
    // before. A request Lumiverse stops listening to before its turn begins ends there, having begun nothing.
    const intake = this.#queue(user, chat);
    this.#taking.add(tag.generation);
    const admitted = (): void => {
      intake.done();
      this.#taking.delete(tag.generation);
    };
    try {
      if (intake.waiting) {
        // The player is shown that this request waits for another of the chat's, in the words of the progress part.
        const line = lines(await loadGuidance(this.#d.files, { user, chat, session: NO_SESSION }).part(PARTS.progress))?.line("waiting_previous");
        if (line !== undefined) out.progress(line);
      }
      if (!(await unlessAborted(intake.turn, signal))) return;
      lap("queue");

      // The chat, its folders, and what Lumiverse saved for generations whose end was not recorded.
      await this.#chat(reads, user, chat);
      await this.#catchUp(reads, user, chat);
      lap("chat");

      // The chat's path compared with the turn tree (plan §6.3). The message a reply is being written to is the turn at hand, not yet a
      // reply: a new reply's message is left out, and the message a swipe or a regenerate writes a new swipe of is compared as it
      // showed before, held by the attempt being replaced. Its empty new swipe, which may bear the same date, is no edit of that attempt.
      const steps = await reads.path(chat);
      if (steps === null) throw new Error(`Lumiverse has no chat ${chat} for this RPE's user.`);
      lap("path");
      const writing = tag.kind === "new" ? tag.target.message : null;
      const replaced = tag.kind === "swipe" || tag.kind === "regenerate" ? tag.target.message : null;
      // The path as RPE last held it, for the player's own edits since (the store's comparison is of replies).
      const was = store.path(chat);
      const before = replaced === null ? undefined : was.find((e) => e.message === replaced);
      const shown: ShownMessage[] = steps
        .filter((s) => s.id !== writing)
        .map((s) => (s.id === replaced && before !== undefined ? { id: s.id, user: false, hash: before.hash, date: before.date } : { id: s.id, user: s.role !== "assistant", hash: s.shown.hash, date: s.shown.date }));
      // What the comparison found is kept with the chat in the same write, under the turn then at the head of its path (`since.ts`):
      // should this intake end before the harness takes its request, the next turn is told it.
      const report = await this.#d.writes.run((db) => {
        const compared = store.sync(chat, shown);
        const head = store.path(chat).findLast((e) => e.turn !== null)?.turn ?? null;
        this.#d.since.keep(db, user, chat, head, foundItems(compared, was, steps), this.#d.store.now());
        return compared;
      }, "comparing the chat's path with its turns");
      await this.#left(user, chat, report, replaced, before?.turn ?? null);
      lap("compare");

      // The chat's settings and texts, read before the turn is made: they are its levels' files, whatever session the turn plays in.
      const base: Scope = { user, chat, session: NO_SESSION };
      const guidance = loadGuidance(this.#d.files, base);
      const [settings, progress, notices, errors] = await Promise.all([turnSettings(this.#d.files, base, this.#d.log), guidance.part(PARTS.progress), guidance.part(PARTS.notices), guidance.part(PARTS.errors)]);
      const started = lines(progress)?.line("started");
      if (started !== undefined) this.#standby.set(`${user}\u0000${chat}`, started);
      lap("settings");

      // The previous turn's run: waited for up to its limit, then stopped where it stands; Lumiverse stopping this request first ends the
      // wait, and the request, there, the previous run going on. The last turn's run as kept, before this one's joins it.
      const stopped = await this.#previous(user, chat, settings, lines(progress), out, signal);
      if (stopped === null || signal.aborted) return;
      const last = this.#d.runs.ofChatKept(user, chat, 1)[0] ?? null;
      lap("previous");

      // The turn: a new attempt, or for a continue the turn its message is tied to (plan §10.10).
      const continued = tag.kind === "continue" && tag.target.message !== null ? this.#tiedTo(user, chat, tag.target.message) : null;
      const begun = continued ?? (await this.#d.writes.run(() => store.beginTurn({ chat, kind: tag.kind, generation: tag.generation, target: replaced }), "beginning a turn"));
      // The session the turn plays in (plan §11): the one the story record's open scene has on the turn's path, or one opened now for that
      // scene (or for none), starting from the summary of the scene before it.
      const inForce = sceneSession(this.#d.store, user, chat, begun.id);
      const session = inForce.session ?? (await this.#d.writes.run(() => store.openSession({ chat, scene: inForce.scene, turn: begun.id }), "opening a session"));
      const scope = { user, chat, session: session.id, turn: begun.id };
      if (inForce.session === null) await this.#d.harness().sessions?.open(scope, inForce.summary === null ? {} : { summary: inForce.summary });
      // The chat's notes as they stand at the turn's start (plan §5.4): the writes of each turn before it on its path, and a continue's
      // own; a branch starts with its branch point's. Notes that cannot be put there are logged, and the turn goes on with them as they are.
      const onPath = store.path(chat);
      const cutAt = replaced === null ? -1 : onPath.findIndex((e) => e.message === replaced);
      const earlier = (cutAt >= 0 ? onPath.slice(0, cutAt) : onPath).flatMap((e) => (e.turn === null || e.turn === begun.id ? [] : [e.turn]));
      await this.#d.notes.follow(user, chat, { turns: [...earlier, begun.id], branchOf: store.chat(chat)?.sourceChat ?? null }).catch((error: unknown) =>
        this.#d.log.error("The chat's notes could not be put as they stand at this turn's start.", { turn: begun.id, error: words(error) }),
      );

      const { messages, left } = promptOf(tagged.prompt);
      if (left > 0) this.#d.log.warn("Parts of the prompt RPH cannot carry were left out.", { turn: begun.id, parts: left });
      const prefill = prefillOf(tagged, messages);
      // What Lumiverse puts in front of the reply when it saves it: for a continue, the text the swipe it goes on held, else the prefill.
      const goneOn = tag.kind === "continue" && tag.target.message !== null ? (await reads.messagesById(chat, [tag.target.message]))[0] : undefined;
      const front = tag.kind === "continue" ? ((tag.target.swipe === null ? undefined : goneOn?.saves[tag.target.swipe]?.text) ?? goneOn?.text ?? "") : (prefill ?? "");

      const over = Promise.withResolvers<void>();
      const run: Run = {
        id: crypto.randomUUID(),
        user,
        turn: begun.id,
        chat,
        session: session.id,
        generation: tag.generation,
        target: tag.kind === "impersonate" ? null : tag.target.message,
        swipe: tag.kind === "impersonate" || tag.target.message === null ? null : tag.target.swipe,
        kind: tag.kind,
        status: "running",
        received,
        started: null,
        firstWord: null,
        released: null,
        ended: null,
        usage: null,
        reply: "",
        progress: [],
        error: null,
        base: front,
        saved: null,
        settled: null,
        mark: continued === null ? null : (store.changes(continued.id).at(-1)?.ord ?? -1),
        castMark: continued === null ? null : castMark(this.#d.store.db, user, continued.id),
        storyMark: continued === null ? null : storyMark(this.#d.store.db, user, continued.id),
        stop: new AbortController(),
        over: over.promise,
      };
      await this.#d.writes.run((db) => {
        this.#d.prompts.keep(db, { user, turn: begun.id, chat, layout: tagged.layout, lore: tag.lore, cut: tagged.cut, summarized: summarizedOf(tag, steps), at: received });
        this.#d.runs.put(db, run);
      }, "keeping the turn's request");
      this.#d.runs.hold(run);
      admitted();
      lap("begin");

      let request: TurnRequest;
      try {
        // The briefing's blocks, and what has happened since the last turn.
        const found = { report, steps, notices: lines(notices), guidance, last, stopped, again: continued !== null, replaced, hiddenReadable: settings.hiddenReadable };
        const [{ blocks: briefing, loreMap }, { items: since, told }] = await Promise.all([this.#briefing(reads, guidance, scope, tagged, steps, settings.lead), this.#since(reads, user, begun, found)]);
        lap("briefing");
        const sampling = samplingOf(tagged.parameters);
        const maxTokens = maxTokensOf(tagged.parameters);
        request = {
          scope,
          // RPE keeps a tree, so a turn always says what it follows: null, for a chat's first turn and a swipe of it, is no earlier turn.
          parent: begun.parent,
          kind: tag.kind,
          ...(tag.speaker.name !== null ? { speaker: tag.speaker.name } : {}),
          lead: settings.lead,
          prompt: messages,
          leftOut: leftOutOf(tagged.cut.keep, steps.map((s) => s.id)),
          briefing,
          carry: settings.carry,
          since,
          ...(prefill !== undefined ? { prefill } : {}),
          ...(sampling !== undefined ? { presetSampling: sampling } : {}),
          ...(maxTokens !== undefined ? { replyMaxTokens: maxTokens } : {}),
        };
        // The turn's folder, for the agents it delegates to and for the player (plan §5.3): the Author has the same in its context.
        const attempts = replaced === null ? [] : this.#attempts(user, chat, replaced);
        await writeTurnFolder({ files: this.#d.files, reads, lore: this.#d.lore }, { scope, guidance, tagged, messages, request, loreMap, attempts, received }).catch((error: unknown) =>
          this.#d.log.error("The turn's folder could not be written in full.", { turn: begun.id, error: words(error) }),
        );
        if (told.length > 0) await this.#d.writes.run((db) => this.#d.since.told(db, user, begun.id, told), "keeping what a turn was told");
        lap("folder");
      } catch (error) {
        // The run never began: it ends here, failed, so the turn after it does not wait for it. The throw tells Lumiverse.
        run.status = "failed";
        run.error = { code: "failed", detail: words(error) };
        run.ended = this.#d.clock.now();
        await this.#d.runs.save(run, "keeping a turn's run that never began").catch((e: unknown) => this.#d.log.error("A turn's run could not be kept.", { turn: run.turn, error: words(e) }));
        over.resolve();
        throw error;
      }
      this.#d.log.debug("A turn's intake, in milliseconds by step.", { turn: begun.id, ...took });
      await this.#run(run, request, out, signal, lines(errors), over);
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
    if (change.kind === "generation-ended") work = this.#ended(user, change);
    else if (change.kind === "message-deleted") work = this.#deleted(user, change.chat, change.message);
    // An edit, a swipe flipped and a fork are found by the next turn's comparison of the path.
    if (work === null) return;
    const done = work.catch((error: unknown) => this.#d.log.error("A change Lumiverse told of could not be recorded; the chat's next turn finds it again.", { chat: change.chat, change: change.kind, error: words(error) }));
    this.#recording.add(done);
    void done.finally(() => this.#recording.delete(done));
  }

  /** What was missed while the event socket was closed is found again at each chat's next intake, by the comparison and by `#catchUp`. */
  reopened(): void {}

  /** Resolves once every change heard so far is recorded. */
  async settled(): Promise<void> {
    while (this.#recording.size > 0) await Promise.allSettled([...this.#recording]);
  }

  /**
   * Stops a turn's run where it stands (plan §10.10 "Stop"); false when it is not going on. While its
   * reply is not out, Lumiverse is told first: its generation ends as stopped, keeping what it had, and
   * the run stops with the request Lumiverse drops. The run is stopped here in any case.
   */
  async stop(user: string, turn: string): Promise<boolean> {
    const run = this.#d.runs.running(user, turn);
    if (run === undefined) return false;
    if (run.released === null && run.generation !== null) {
      const generation = run.generation;
      await this.#d.stopGeneration(generation).catch((error: unknown) => this.#d.log.warn("Lumiverse could not be told to stop this turn's generation; the turn is stopped on RPE's side.", { turn, generation, error: words(error) }));
    }
    run.stop.abort(new Error("The player stopped the turn."));
    return true;
  }

  /**
   * After a turn's writes, or a job's for the turn that started it (plan §11): the scene the story record now holds open at the turn
   * decides its session. When another session is in force there than the one the turn played in, that one is closed as the turn's
   * work; and a scene that has no session yet has one opened as the turn's work, starting from the summary of the scene before it.
   */
  async sessionsAfter(user: string, chat: string, turn: string): Promise<void> {
    const store = this.#d.store.user(user);
    const played = this.#d.runs.record(user, turn)?.session;
    const row = store.turn(turn);
    if (played === undefined || row === null || row.status === "dropped") return;
    const now = sceneSession(this.#d.store, user, chat, turn);
    if (now.session?.id === played) return;
    const sessions = this.#d.harness().sessions;
    await this.#d.writes.run(() => store.closeSession(played, turn), "closing the session of a scene that ended");
    await sessions?.close({ user, chat, session: played, turn });
    if (now.session !== null || now.scene === "") return;
    const opened = await this.#d.writes.run(() => store.openSession({ chat, scene: now.scene, turn }), "opening the session of a scene that began");
    await sessions?.open({ user, chat, session: opened.id, turn }, now.summary === null ? {} : { summary: now.summary });
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
   * cannot be recorded now is logged, and the next intake finds it again.
   */
  async #catchUp(reads: LumiverseReads, user: string, chat: string): Promise<void> {
    await this.settled();
    const awaiting = this.#d.runs.unsettled(user, chat);
    if (awaiting.length === 0) return;
    const left = awaiting.filter((r) => r.status === "running");
    if (left.length > 0) await this.#d.writes.run((db) => left.forEach((r) => this.#d.runs.put(db, { ...r, status: "failed", error: STOPPED_MID_RUN })), "ending the runs RPE stopped during");
    const found = await reconcile(reads, { chat, messages: [], awaiting: awaiting.map((r) => ({ generation: r.generation ?? "", message: r.target })) });
    for (const change of found) {
      if (change.kind !== "generation-ended") continue;
      await this.#ended(user, change).catch((error: unknown) => this.#d.log.error("A generation's end could not be recorded; the chat's next turn looks again.", { chat, generation: change.generation, error: words(error) }));
    }
  }

  /**
   * Turns that left the path since it was last compared: their work is cancelled (plan §10.9 "This work belongs to its turn"). The
   * attempt a swipe or regenerate replaces (`replacing`, the turn the path held at its message) is among them, with any run still
   * writing to that message.
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
  }

  /** A turn off the path: its run, if it goes on, stopped, and RPH told. */
  async #cancel(user: string, chat: string, turn: string): Promise<void> {
    const run = this.#d.runs.running(user, turn);
    run?.stop.abort(new Error("The turn left the chat's path."));
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
    for (const r of before) r.stop.abort(new Error("The next turn began, and this run had used the time it was given."));
    await Promise.all(before.map((r) => r.over));
    return stopped;
  }

  /** The turn tied to a message, for a continue of it; null when none is (a continue of a reply made without RPE begins a turn of its own). */
  #tiedTo(user: string, chat: string, message: string): TurnRow | null {
    const store = this.#d.store.user(user);
    const entry = store.path(chat).find((e) => e.message === message);
    return entry === undefined || entry.turn === null ? null : store.turn(entry.turn);
  }

  /** The earlier attempts at a message a swipe or regenerate writes again, oldest first: each one's reply as kept, and its intent record. */
  #attempts(user: string, chat: string, message: string): Attempt[] {
    return this.#d.store
      .user(user)
      .swipes(chat, message)
      .map((t) => {
        const run = this.#d.runs.record(user, t.id);
        return { turn: t.id, intent: t.intent, reply: run === null ? null : (run.saved ?? run.base + run.reply) };
      });
  }

  /**
   * The briefing's blocks (plan §10.2 block 4): the turn's facts, the lore map, the world state, the story so far and the story brief,
   * each laid out by its part; and the ids of the entries the lore map names, for the turn's folder.
   */
  async #briefing(reads: LumiverseReads, guidance: Guidance, scope: Scope & { turn: string }, tagged: TaggedTurn, steps: readonly LvStep[], lead: string): Promise<{ blocks: ContextBlock[]; loreMap: string[] }> {
    const { tag } = tagged;
    const blocks: ContextBlock[] = [];
    const [factsPart, mapPart] = await Promise.all([guidance.part(PARTS.turnFacts), guidance.part(PARTS.loreMap)]);
    if (factsPart?.format === "template") {
      const facts = factsPart.render({ kind: tag.kind, ...(tag.speaker.name !== null ? { speaker: tag.speaker.name } : {}), ...(tag.target.message !== null ? { message: tag.target.message } : {}), ...this.#storyTime(scope.user, scope.chat, scope.turn) }).text;
      if (facts.trim() !== "") blocks.push({ name: BLOCKS.turnFacts, text: facts.trimEnd() });
    }
    // The world's own keys are looked for in what Lumiverse scans of the chat for lore, by the user's own scan settings (`scan.ts`):
    // the visible messages but the one being written, the latest of them to the scan depth, the markup hidden from its scan blanked.
    // A chat with no world has no keys of its own to look for, so nothing is read for it.
    const world = this.#d.store.user(scope.user).chat(scope.chat)?.revision ?? null;
    const scan = world === null ? null : scanSettingsOf((await reads.setting(SCAN_SETTING))?.value);
    const writing = new Set(tag.target.message !== null && (tag.kind === "new" || tag.kind === "swipe" || tag.kind === "regenerate") ? [tag.target.message] : []);
    const scanned = scan === null ? [] : scannedSteps(steps, writing, scan.depth);
    const first = scanned[0] === undefined ? -1 : steps.indexOf(scanned[0]);
    const ids = new Set(scanned.map((s) => s.id));
    const texts = first < 0 ? [] : (await reads.messages(scope.chat, { from: first, to: steps.length })).filter((m) => ids.has(m.id)).map((m) => maskWorldInfoScanExclusions(m.text));
    const map = await this.#d.lore.loreMap({ user: scope.user, chat: scope.chat, turn: scope.turn, messages: texts, ...(scan !== null ? { matching: scan.matching } : {}) });
    if (mapPart?.format === "template") {
      const laid = mapPart.render({ ...loreMapFields(map) }).text;
      if (laid.trim() !== "") blocks.push({ name: BLOCKS.loreMap, text: laid.trimEnd() });
    }
    // The world state (plan §6.9), compiled by the store and worded by the layout file in force for the chat, read whole, with each
    // place's map worded by the map's lines in force. A world state that cannot be compiled is left out of this turn's briefing, and
    // the log says why.
    const statePart = await guidance.part(PARTS.worldState);
    const layout = statePart === undefined ? null : await this.#d.files.read(scope, statePart.source.path);
    if (layout?.status === "read") {
      const maps = mapView(await mapLines(guidanceTexts(this.#d.files, scope)));
      try {
        const state = worldState(this.#d.store.user(scope.user), { chat: scope.chat, turn: scope.turn, layout: layout.text, map: maps, due: this.#d.due });
        if (state.text.trim() !== "") blocks.push({ name: BLOCKS.worldState, text: state.text.trimEnd() });
      } catch (error) {
        this.#d.log.error("The world state could not be compiled for this turn's briefing.", { turn: scope.turn, error: words(error) });
      }
    }
    // The story so far, for the history the window left out of the prompt, and the story brief (plan §8.1): drawn from the story
    // record as this turn's path holds it, each laid out by its part.
    const point = { store: this.#d.store, user: scope.user, chat: scope.chat, turn: scope.turn };
    const [soFarPart, briefPart] = await Promise.all([guidance.part(PARTS.storySoFar), guidance.part(PARTS.storyBrief)]);
    if (soFarPart?.format === "template") {
      const keptFrom = leftOutOf(tagged.cut.keep, steps.map((s) => s.id))[0]?.to ?? null;
      const soFar =
        keptFrom === null
          ? null
          : storySoFar({ record: storyRecordParts(point), keptFrom, contextWindow: await this.#authorWindow(guidance, lead, scope.turn), settings: STORY_SO_FAR_DEFAULTS, tokens: (text) => Math.ceil(text.length / CHARS_PER_TOKEN), layout: soFarPart });
      if (soFar !== null && soFar.text.trim() !== "") blocks.push({ name: BLOCKS.storySoFar, text: soFar.text.trimEnd() });
    }
    if (briefPart?.format === "template") {
      const brief = storyBrief({ ...point, layout: briefPart });
      if (brief.text.trim() !== "") blocks.push({ name: BLOCKS.storyBrief, text: brief.text });
    }
    return { blocks, loreMap: [...map.inPrompt, ...map.world].map((line) => line.id) };
  }

  /**
   * The lead's window in tokens, as the model layer reports it for the connection its definition names (`default`, or none, is the
   * default connection). Where the model layer cannot tell it, 0, so the story so far is given its floor; the log says so.
   */
  async #authorWindow(guidance: Guidance, lead: string, turn: string): Promise<number> {
    try {
      const named = (await guidance.definition(lead))?.model;
      const models = this.#d.harness().models;
      const connection = named === undefined || named === "default" ? null : ((await models.list()).connections.find((c) => c.id === named || c.name === named)?.id ?? named);
      const window = (await models.limits(connection)).contextWindow;
      if (window !== null) return window.tokens;
      this.#d.log.info("The lead's window is not known, so the story so far is given its floor.", { turn, lead });
    } catch (error) {
      this.#d.log.info("The lead's window could not be read, so the story so far is given its floor.", { turn, lead, error: words(error) });
    }
    return 0;
  }

  /**
   * The story's time where the chat's state keeps a clock, as the world's calendar writes it: at the turn itself, along the path it was
   * made on, as the world state beside it is, so a swipe shows its own start and not the attempt it replaces.
   */
  #storyTime(user: string, chat: string, turn: string): { story_time?: string } {
    const store = this.#d.store.user(user);
    if ((store.chat(chat)?.revision ?? null) === null) return {};
    const state = store.stateAt(turn).state.world;
    const world = this.#d.store.env.worlds(state.revision);
    return world === undefined ? {} : { story_time: formatClock(calendarOf(world), state.clock) };
  }

  /**
   * What has happened since the last turn (plan §6.3, §10.10), each in the words of the notices part: for a chat a migration carried,
   * while no turn RPE played is on its path, what was carried, laid out by its own part; what comparisons of the path found and kept
   * for this turn (`#keptFor`: turns gone, another swipe showing on the newest reply or on an earlier one, a reply edited since its
   * turn was tied, with the text it was tied to and the text it has now, the player's own edits of their messages since RPE last read
   * them); replies made without a turn; the last turn's reply cut short, or saved otherwise than it was released (`last`, as kept
   * before this turn began); what jobs recorded that takes effect at this turn; the runs this turn stopped at their limit
   * (`stopped`); and what the player asked for through a panel. A continue of a turn (`again`) is not told again what that turn's
   * first run was told: its jobs and requests. `told`: what of the kept things this turn's telling is to be kept for.
   */
  async #since(reads: LumiverseReads, user: string, turn: TurnRow, found: Found): Promise<{ items: SinceItem[]; told: string[] }> {
    const { report, steps, notices, guidance, last, stopped, again, replaced, hiddenReadable } = found;
    const { chat } = turn;
    const store = this.#d.store.user(user);
    const items: SinceItem[] = [];
    const place = new Map(steps.map((s, i) => [s.id, i]));
    const add = (kind: SinceItem["kind"], line: string | undefined, extra: Partial<SinceItem> = {}): void => {
      if (line !== undefined && line.trim() !== "") items.push({ kind, text: line, ...extra });
    };
    // What a migration carried (plan §12, §15), told to the first run RPE plays on the turn's own line: a swipe of that first turn is
    // told it too, and the turn after a continue of an imported reply, which RPE played as a run of the imported turn, is not.
    const { migrated } = this.#d;
    const before = storyAt(store, chat, turn.id).turns.filter((t) => t !== turn.id);
    const played = this.#d.runs.countOf(user, before) > 0 || (again && this.#d.runs.countOf(user, [turn.id]) > 1);
    const carried = played ? null : migrated.fields(user, chat);
    const carriedPart = carried === null ? undefined : await guidance.part(migrated.part);
    if (carried !== null && carriedPart?.format === "template") add("unplayed", notices?.line(migrated.notice, { carried: carriedPart.render(carried).text.trim() }));
    // A swipe or a regenerate stands in for the earlier attempts at its message, the ones tied to it.
    const attempts = replaced === null ? [] : store.swipes(chat, replaced).filter((t) => t.id !== turn.id);
    const kept = this.#keptFor(user, turn, again, attempts);
    const of = <K extends FoundItem["kind"]>(kind: K): Extract<FoundItem, { kind: K }>[] => kept.flatMap((k) => (k.item.kind === kind ? [k.item as Extract<FoundItem, { kind: K }>] : []));
    // Turns gone, counted once each, whichever comparison found them.
    const gone = new Set(of("deleted").flatMap((d) => d.turns));
    if (gone.size > 0) add("delete", notices?.line("deleted", { count: gone.size }));
    // Another swipe showing on the newest reply: its turn (none, for a swipe made without RPE) is the path now, with its own changes.
    for (const s of of("swiped")) add("restacked", notices?.line("swipe_shown", { message: s.message }), s.to !== null ? { turn: s.to } : {});
    // What no longer applies, as data: the operations by name. Why each does not is a code the store's own wording gives words to.
    for (const f of of("flipped")) add("restacked", notices?.line("swipe_flipped", { message: f.message, dropped: f.dropped }), f.to !== null ? { turn: f.to } : {});

    // The texts Lumiverse holds now: of each reply edited since its turn was tied, of each of the player's messages edited since RPE
    // last read it, and of the player's newest message where RPE has not kept it as it reads now, so that an edit of it can later be
    // told with the text it had. A hidden message's texts are told, read and kept only where the chat lets agents read hidden
    // messages (plan §4.2): while it does not, an edit of one is told without them, and nothing of one is kept.
    const hidden = new Set(steps.flatMap((s) => (s.hidden && !hiddenReadable ? [s.id] : [])));
    const edited = of("edited");
    const edits = of("player_edited");
    const newest = steps.findLast((s) => s.role === "user");
    const unkept = newest !== undefined && !hidden.has(newest.id) && this.#d.player.textOf(user, chat, newest.id, newest.shown.hash) === null ? [newest.id] : [];
    const ids = [...new Set([...edited.map((e) => e.message), ...edits.map((e) => e.message), ...unkept])].filter((id) => !hidden.has(id));
    const now = new Map((ids.length === 0 ? [] : await reads.messagesById(chat, ids)).map((m) => [m.id, m]));
    const textNow = (message: string): { new?: string } => {
      const m = now.get(message);
      return m === undefined ? {} : { new: shownText(m) };
    };
    for (const e of edited) {
      // What its turn was tied to: what Lumiverse saved, where that is not what was released.
      const run = hidden.has(e.message) ? null : this.#d.runs.record(user, e.turn);
      add("edit", notices?.line("edited", { message: e.message, ...(run !== null ? { old: run.saved ?? run.base + run.reply } : {}), ...textNow(e.message) }), { turn: e.turn });
    }
    for (const e of edits) {
      const old = hidden.has(e.message) ? null : this.#d.player.textOf(user, chat, e.message, e.had);
      add("edit", notices?.line("player_edited", { message: e.message, ...(old !== null ? { old } : {}), ...textNow(e.message) }));
    }
    const keep = [...now.values()].filter((m) => m.role === "user").map((m) => ({ message: m.id, hash: m.shown.hash, text: shownText(m) }));
    if (keep.length > 0) await this.#d.writes.run((db) => this.#d.player.keepTexts(db, user, chat, keep), "keeping the player's messages as read");

    // Messages are numbered as `chat_read` numbers them, the chat's first message 0.
    for (const u of report.unplayed) {
      const from = place.get(u.from);
      const to = place.get(u.to);
      if (from === undefined || to === undefined) continue;
      add("unplayed", notices?.line("unplayed", { range: from === to ? `${from}` : `${from}-${to}` }), { range: { from, to: to + 1 } });
    }
    // The last turn's reply: cut short by a stop, or saved by Lumiverse otherwise than it was released (plan §6.3, §10.8).
    const tied = last === null ? null : store.turn(last.turn);
    if (last !== null && tied !== null && tied.message !== null) {
      if (tied.status === "cut") add("cut-short", notices?.line("cut_short", { message: tied.message }), { turn: last.turn });
      if (last.saved !== null) add("saved-differs", notices?.line("saved_differs", { message: tied.message, released: last.base + last.reply, saved: last.saved }), { turn: last.turn });
    }
    if (!again) for (const job of await this.#jobsBefore(user, turn)) add("job", notices?.line(job.interrupted ? "job_interrupted" : "job_finished", job.fields), { turn: job.turn });
    // The run after a reply is the turn's own work done late (plan §10.9): one stopped at its limit is told as a job is, with what it recorded kept.
    for (const r of stopped) add("job", notices?.line("previous_run_stopped"), { turn: r.turn });
    // What the player asked for through a panel, as part of the message this turn answers (plan §10.10 "A panel action"): a swipe or a
    // regenerate answers the message its earlier attempts answered, and is told what they were told.
    const requests = again ? [] : this.#d.player.requestsFor(user, chat, replaced === null ? null : attempts.map((a) => a.id));
    for (const r of requests) add("player-edit", notices?.line("panel_request", { what: r.what, ...(r.on !== null ? { on: r.on } : {}) }));
    // What this turn was told that decides what later turns are: a continue's found things, so the turns after the turn it continues
    // are not told them again; the requests, so a request is told once, and again only to a swipe of the turn told it.
    return { items, told: [...(again ? kept.map((k) => k.id) : []), ...requests.map((r) => r.id)] };
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
   * What jobs recorded that takes effect at a turn (plan §10.9: just before the first turn to begin after the job ended), by job, as
   * data for its notice: the operations that took effect and those that did not, and the job as the harness lists it, where it does.
   */
  async #jobsBefore(user: string, turn: TurnRow): Promise<{ turn: string; interrupted: boolean; fields: JsonObject }[]> {
    const jobs = new Map<string, { turn: string; applied: string[]; notApplied: string[] }>();
    for (const placed of this.#d.store.user(user).jobsBefore(turn.id)) {
      const { job, turn: started, op } = placed.change;
      if (job === null) continue;
      const did = jobs.get(job) ?? { turn: started, applied: [], notApplied: [] };
      (placed.applied ? did.applied : did.notApplied).push(op);
      jobs.set(job, did);
    }
    const out: { turn: string; interrupted: boolean; fields: JsonObject }[] = [];
    for (const [job, did] of jobs) {
      let view: JobView | undefined;
      try {
        view = await this.#d.harness().jobs?.get(job);
      } catch (error) {
        this.#d.log.warn("A job the harness ran could not be read; it is told without what the harness keeps of it.", { turn: turn.id, job, error: words(error) });
      }
      const known = view === undefined ? {} : { agent: view.agent, brief: view.brief, ...(view.report !== undefined ? { outcome: view.report, done: view.report } : {}) };
      out.push({ turn: did.turn, interrupted: view?.state === "interrupted", fields: { job, ...known, applied: did.applied, not_applied: did.notApplied } });
    }
    return out;
  }

  // ---------------------------------------------------------------- the run

  async #run(run: Run, request: TurnRequest, out: ReplyStream, signal: AbortSignal, errors: LinesPart | undefined, over: PromiseWithResolvers<void>): Promise<void> {
    const { live, clock } = this.#d;
    const replied = Promise.withResolvers<void>();
    // Lumiverse stopping before the reply is out stops the turn; after it, the run goes on (plan §10.9).
    const onAbort = (): void => {
      if (run.released === null) run.stop.abort(signal.reason);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    const sink: ReplySink = {
      progress: (line) => {
        out.progress(line);
        live.publish(run.chat, { kind: "reply", data: { run: run.turn, line: run.progress.length, progress: line } });
        run.progress.push(line);
      },
      content: (delta) => {
        if (run.firstWord === null) run.firstWord = clock.now();
        out.content(delta);
        live.publish(run.chat, { kind: "reply", data: { run: run.turn, from: run.reply.length, text: delta } });
        run.reply += delta;
      },
      finish: (usage) => {
        run.released ??= clock.now();
        // What went out is kept before Lumiverse is told the reply ended: should RPE stop before the run does, the next intake ties it.
        void this.#d.runs.save(run, "keeping a released reply").catch((error: unknown) => this.#d.log.error("A released reply could not be kept.", { turn: run.turn, error: words(error) }));
        out.finish({ reason: "stop", usage: usageOut(usage) });
        replied.resolve();
      },
      error: (e: ReplyError) => {
        run.error = e;
        out.error(this.#errorWords(e, errors));
        replied.resolve();
      },
    };
    run.started = clock.now();
    void this.#d.harness()
      .answer(request, sink, run.stop.signal)
      .then(
        (outcome) => {
          run.status = outcome.status;
          run.usage = outcome.usage;
          if (outcome.error !== undefined) run.error = outcome.error;
        },
        (error: unknown) => {
          run.status = "failed";
          const failed: ReplyError = { code: "failed", detail: words(error) };
          if (run.released === null && run.error === null) sink.error(failed);
          run.error = failed;
        },
      )
      .finally(async () => {
        signal.removeEventListener("abort", onAbort);
        run.ended ??= clock.now();
        replied.resolve();
        try {
          await this.#d.runs.save(run, "keeping a turn's run");
          // The turn's tokens are what all its runs spent: a continue adds to the runs before it (plan §10.10 "Continue").
          const spent = this.#d.runs.ofTurn(run.user, run.turn).flatMap((r) => (r.usage === null ? [] : [r.usage]));
          const tokens = spent.length === 0 ? {} : { tokensIn: spent.reduce((n, u) => n + u.input, 0), tokensOut: spent.reduce((n, u) => n + u.output, 0) };
          const timings = { received: run.received, started: run.started, firstWord: run.firstWord, released: run.released, ended: run.ended };
          await this.#d.writes.run(() => this.#d.store.user(run.user).updateTurn(run.turn, { timings, ...tokens }), "keeping a turn's timings");
          await this.#keepRecord(run);
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
   * it) is tied as cut short. Where which swipe it wrote cannot be told, the turn is left open, and the next intake looks again.
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
    const cut = change.stopped === true || run.released === null;
    const message = run.kind === "impersonate" ? null : (change.message ?? (cut ? run.target : null));
    const reads = this.#d.reads();
    const saved = message === null || reads === null ? undefined : (await reads.messagesById(change.chat, [message]))[0];
    const written = saved === undefined ? undefined : writtenOf(run, saved);
    if (written === null) return;
    if (saved === undefined || written === undefined || (cut && written.text === run.base)) {
      // Saving nothing new, an attempt is dropped; a continue of a tied turn leaves it as it was, what the continue recorded taken back
      // once its run, which may still be winding down, is over.
      if (run.mark !== null) await held?.over;
      const record = settle();
      await this.#d.writes.run((db) => {
        const status = store.turn(run.turn)?.status;
        if (status === "open") store.dropTurn(run.turn);
        else if (run.mark !== null && (status === "done" || status === "cut")) {
          store.takeBack(run.turn, run.mark);
          if (run.castMark !== null) takeBackCast(db, user, run.turn, run.castMark);
          if (run.storyMark !== null) takeBackStory(db, user, run.turn, run.storyMark);
        }
        this.#d.runs.put(db, record);
      }, "taking back an attempt that saved nothing");
      return;
    }
    const record = settle({ saved: written.text === run.base + run.reply ? null : written.text });
    await this.#d.writes.run((db) => {
      store.tieTurn(run.turn, { message: saved.id, hash: textHash(written.text), date: written.date, status: cut ? "cut" : "done" });
      this.#d.runs.put(db, record);
    }, "tying a turn to its saved message");
    await this.#keepRecord(record);
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
   * A message was deleted: the work of every turn tied to it is cancelled now, and RPH told; the next turn's comparison takes them off
   * the path without telling RPH again.
   */
  async #deleted(user: string, chat: string, message: string): Promise<void> {
    const store = this.#d.store.user(user);
    const tied = store.chat(chat) === null ? [] : store.swipes(chat, message);
    const running = this.#d.runs.ofChat(user, chat).filter((r) => r.target === message);
    const turns = new Set([...tied.map((t) => t.id), ...running.map((r) => r.turn)]);
    const chatKey = `${user}\u0000${chat}`;
    const told = this.#deletedTold.get(chatKey) ?? new Set<string>();
    for (const turn of turns) told.add(turn);
    this.#deletedTold.set(chatKey, told);
    await Promise.all([...turns].map((turn) => this.#cancel(user, chat, turn)));
  }
}

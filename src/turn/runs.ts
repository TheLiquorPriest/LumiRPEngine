// Each turn's run, as the Turn page shows it and the next turn waits on it: where it stands, when its
// moments happened, what it spent, and what went to the chat (its reply's text and the progress lines
// of the thinking block). A run going on now is held in memory, with what stops it; every run is kept
// in RPE's database (`turn_run`), written when it begins, when its reply is released and when it ends,
// and what it spent, once it has ended, as a row of `usage` (plan Appendix B), which the Runtime page and
// the day's caps read. A turn has one run, or more when it is continued: each continue is a run of its
// own, kept beside the earlier ones, and the turn as the pages show it is its latest run.

import type { Database } from "bun:sqlite";
import type { CallFailureKind, LimitHit, ReplyError, RunOutcome, RunStatus, TraceRecord, TurnKind, Usage } from "rp-harness/contract";
import type { Writes } from "./kv";

/** Where a run stands: going on, or how it ended. */
export type RunState = RunStatus | "running";

/** A run's kind: the kind of turn Lumiverse asked for, or a Settle now run (`TurnLane.settle`), which writes nothing into the chat. */
export type RunKind = TurnKind | "settle";

/** A stretch of a run's time between two of its moments, epoch milliseconds, on the clock its other moments are read by. */
export interface Stretch {
  from: number;
  to: number;
}

/** One step of a turn's intake (plan §10.1): its name and its stretch, which never holds a wait for the turn before (`RunRecord.wait`). */
export interface IntakeStep extends Stretch {
  step: string;
}

/**
 * A stretch of a model's own writing (plan §4.7, R-185), epoch milliseconds on the same clock: from its first token to its last; `to`
 * null while it began and has not ended (a run stopped inside it).
 */
export interface Span {
  from: number;
  to: number | null;
}

/** How the turn's folder (plan §5.3) was written alongside the run. */
export interface FolderWrite {
  /** When its writing began: once the lead's first model call had gone out, or the run had ended with none. */
  from: number;
  /** When its writing ended; null while it goes on. */
  to: number | null;
  /** Why it could not be written in full, where it could not; null where it was. */
  error: string | null;
}

/**
 * What stopped a run where it stood, its reply going out with what it had: one of RPH's limits (calls, tokens, time), or the hold of a
 * reply asked for whole, in milliseconds from the request's arrival.
 */
export type StoppedBy = { limit: LimitHit } | { hold: number };

/**
 * Why a run ended, as its record keeps it once the harness tells its end: the error the outcome gives, else the one the run had, else,
 * for a run that reached a limit after its reply went out (its reply sink was given no error), that limit, so the record names it.
 */
export function endedError(outcome: Pick<RunOutcome, "status" | "limit" | "error">, had: ReplyError | null): ReplyError | null {
  if (outcome.error !== undefined) return outcome.error;
  if (had !== null) return had;
  return outcome.status === "limit" && outcome.limit !== undefined ? { code: "limit", limit: outcome.limit } : null;
}

/**
 * What a run's lead was not given, as facts, each told in its briefing by a line of the notices part (plan §4.2 "A prompt with
 * pictures", §10.2, Y6): pictures its model does not take (`pictures`), and parts that are neither text nor a picture (`parts`), each
 * with the messages of the prompt that held them (places from 0) and how many; and a part of the briefing that could not be made
 * (`world-state`, `on-stage`), with why.
 */
export type NotGiven = { what: "pictures" | "parts"; messages: number[]; count: number } | { what: "world-state" | "on-stage"; error: string };

/** A run as it is kept. */
export interface RunRecord {
  /** The run's own id: a continue runs its turn again under a new one. */
  id: string;
  /** RPH's own id for the run, which its trace records and streaming text carry as their `run`; null until its first record. */
  traceRun: string | null;
  user: string;
  /** The turn the run is one of: for a continue, its held turn until Lumiverse's end decides its turn, then that turn (`held`). */
  turn: string;
  chat: string;
  session: string;
  generation: string | null;
  /**
   * The message the reply is saved to; null for one that saves to none (an impersonation), or to one Lumiverse makes when it saves.
   * For a continue, the message its tag named for it to go on, a first word only: none where the tag could not tell, and the turn is
   * tied where Lumiverse's end names it, whichever message that is (R-192).
   */
  target: string | null;
  /**
   * The swipe of `target` the generation writes: a swipe's or a regenerate's own new one, the one a continue goes on, a new reply's
   * first. Lumiverse writes it there whichever swipe the player looks at by then (`chats.service.ts:3346-3362`). Null with no target,
   * but for a continue, whose generation names the swipe it goes on even where its tag names no message.
   */
  swipe: number | null;
  kind: RunKind;
  status: RunState;
  received: number;
  started: number | null;
  firstWord: number | null;
  /** When its reply began to go out: its first text reached RPE's sink, or the harness released it, whichever came first. */
  released: number | null;
  /**
   * When its reply went out whole: the sink's finish, or what a stopped run had written sent as the whole reply. Lumiverse stopping
   * before it stops the run, and the Turn page's Stop tells Lumiverse first; after it, the run goes on (plan §10.9).
   */
  finished: number | null;
  ended: number | null;
  /** The intent record's own time, from its first token to its last (R-185), kept as it arrives; null while no record began. */
  intent: Span | null;
  /**
   * The thinking on the reply's path: for each of the lead's model calls that began before the release and thought before its first
   * output, in call order, from its first thinking token to its last before that output; none when no call thought.
   */
  thinking: Span[];
  /** Its reply began to go out before any intent record of it had ended, in the order the two arrived. */
  withoutIntent: boolean;
  /**
   * Intake's own steps (plan §4.7: intake is timed "not counting any wait for the previous turn's work, which is reported on its
   * own"), in order, from `received` to the run's start, each beginning where the step or wait before it ended. Null for a run that
   * had no intake of its own (a Settle now) or was kept before they were.
   */
  intake: IntakeStep[] | null;
  /**
   * Each wait for the turn before, in order: for the intake before this one to hold its run, for every change heard so far to be
   * recorded (that turn's end among them), then for that turn's run; none when nothing was waited for. Null as for `intake`.
   */
  wait: Stretch[] | null;
  /** How the turn's folder was written alongside the run; null before its writing began, for a run that writes none, or one kept before. */
  folder: FolderWrite | null;
  usage: Usage | null;
  /** Its agents' `lore_search` and `lore_read` calls, counted from its trace as they began (`spans.ts`); none for a run kept before they were. */
  lookups: Lookups;
  /** What went to the chat as the reply. */
  reply: string;
  /** The progress lines that went to the chat's thinking block, in order. */
  progress: string[];
  error: ReplyError | null;
  /** What stopped it where it stood; null for neither a limit nor the hold. */
  stoppedBy: StoppedBy | null;
  /** What went out as its reply is the Author's last plain text, sent by the setting `reply.lastText` in place of the error line. */
  lastText: boolean;
  /** What the lead was not given of its prompt and its briefing this run, each told in its briefing; none when it was given all. */
  notGiven: NotGiven[];
  /** What Lumiverse puts in front of the reply when it saves it: the preset's prefill, or for a continue the text the message held. */
  base: string;
  /** What Lumiverse saved, where it is not what was released (plan §10.8 "Saved against released"); null when it is, or not yet saved. */
  saved: string | null;
  /**
   * When the generation's end was recorded: its turn tied to what Lumiverse saved, or dropped, or nothing to record. Null until then:
   * a run whose end was not heard, or that RPE stopped during, is found by the chat's next intake (plan §10.8).
   */
  settled: number | null;
  /**
   * A continue's own turn (R-192 (e)): what its run changes is held there until Lumiverse's end decides the continue's turn, and its
   * folder holds the run's files. Where the end names a message another turn is tied to, the held turn joins that turn, and `turn`
   * names that one from then on. Null for any other run.
   */
  held: string | null;
  /**
   * Where what the run records begins on its turn: the order (`ord`) of the turn's last change before the run's own, -1 for none. A
   * continue's, set when its held turn joins the turn it extended, so that turn's counts are of this run's changes. Null for any other run.
   */
  mark: number | null;
  /**
   * A continue's own intent record (R-192 (e)): the run's, kept with it whenever it comes, before or after its held turn joined the turn
   * it extended, and never written over that turn's own. Null for any other run, whose record is its turn's.
   */
  intentRecord: string | null;
}

/** A run's lore lookups: its `lore_search` calls and its `lore_read` calls. */
export interface Lookups {
  searches: number;
  reads: number;
}

/**
 * The lead's model call as RPH's trace tells it (`spans.ts`): the newest failure of its calls since one of them last ended whole, with
 * the times that call had been made then and what broke it; and the call under way, with whether any of its answer (text or thinking) came.
 */
export interface LeadCall {
  failed: { tries: number; failure: CallFailureKind } | null;
  open: { heard: boolean } | null;
}

/** A run going on now: its record, what stops it, and when it is over. */
export interface Run extends RunRecord {
  readonly stop: AbortController;
  /** Resolves when the lead's run is over. */
  readonly over: Promise<void>;
  /** When the lead's first model call went out, as RPH's trace told it; null before. Kept in the turn's record (`turn.json`), not here. */
  firstCall: number | null;
  /** The lead's model call as it stands now, for the words of a stop at the hold of a reply asked for whole. Kept nowhere. */
  leadCall: LeadCall;
  /**
   * The facts named by the rules said to its lead, as RPH's trace told each the moment it fired (`rule_fired`); absent before any.
   * Kept nowhere: the rule firings RPE is told once the agent has gone on (`rule_firing`) keep them for good.
   */
  told?: Set<string>;
  /** The action ids its agents' `act` operations named, in calls that ended, lower case; absent before any. Kept with the presses they answered (`Requests.answer`). */
  acted?: Set<string>;
}

interface RunRow {
  id: string;
  trace_run: string | null;
  turn: string;
  chat: string;
  session: string;
  generation: string | null;
  target: string | null;
  swipe: number | null;
  kind: string;
  status: string;
  received: number;
  started: number | null;
  first_word: number | null;
  released: number | null;
  finished: number | null;
  ended: number | null;
  intent_time: string | null;
  thinking: string | null;
  without_intent: number;
  intake: string | null;
  wait: string | null;
  folder: string | null;
  reply: string;
  progress: string;
  error: string | null;
  stopped_by: string | null;
  last_text: number;
  not_given: string | null;
  base: string;
  saved: string | null;
  settled: number | null;
  held: string | null;
  mark: number | null;
  intent_record: string | null;
  // Its `usage` row, null where it has none.
  calls: number | null;
  input: number | null;
  cache_read: number | null;
  cache_write: number | null;
  output: number | null;
  reasoning: number | null;
  lore_searches: number | null;
  lore_reads: number | null;
}

/** A run's row with its usage beside it: every query of runs reads through this, `r` being the run and `WHERE` left to it. */
const RUN_ROWS = "SELECT r.*, u.calls, u.input, u.cache_read, u.cache_write, u.output, u.reasoning, u.lore_searches, u.lore_reads FROM turn_run r LEFT JOIN usage u ON u.user = r.user AND u.run = r.id";

function recordOf(user: string, r: RunRow): RunRecord {
  return {
    id: r.id,
    traceRun: r.trace_run,
    user,
    turn: r.turn,
    chat: r.chat,
    session: r.session,
    generation: r.generation,
    target: r.target,
    swipe: r.swipe,
    kind: r.kind as RunKind,
    status: r.status as RunState,
    received: r.received,
    started: r.started,
    firstWord: r.first_word,
    released: r.released,
    finished: r.finished,
    ended: r.ended,
    intent: r.intent_time === null ? null : (JSON.parse(r.intent_time) as Span),
    thinking: r.thinking === null ? [] : (JSON.parse(r.thinking) as Span[]),
    withoutIntent: r.without_intent === 1,
    intake: r.intake === null ? null : (JSON.parse(r.intake) as IntakeStep[]),
    wait: r.wait === null ? null : (JSON.parse(r.wait) as Stretch[]),
    folder: r.folder === null ? null : (JSON.parse(r.folder) as FolderWrite),
    usage: r.calls === null ? null : { calls: r.calls, input: r.input ?? 0, cacheRead: r.cache_read ?? 0, cacheWrite: r.cache_write ?? 0, output: r.output ?? 0, ...(r.reasoning !== null ? { reasoning: r.reasoning } : {}) },
    lookups: { searches: r.lore_searches ?? 0, reads: r.lore_reads ?? 0 },
    reply: r.reply,
    progress: JSON.parse(r.progress) as string[],
    error: r.error === null ? null : (JSON.parse(r.error) as ReplyError),
    stoppedBy: r.stopped_by === null ? null : (JSON.parse(r.stopped_by) as StoppedBy),
    lastText: r.last_text === 1,
    notGiven: r.not_given === null ? [] : (JSON.parse(r.not_given) as NotGiven[]),
    base: r.base,
    saved: r.saved,
    settled: r.settled,
    held: r.held,
    mark: r.mark,
    intentRecord: r.intent_record,
  };
}

/** A turn a migration carried, as its reply went out under the old engine: what it released, and what was saved otherwise, if anything. */
export interface CarriedRun {
  user: string;
  chat: string;
  turn: string;
  /** When the reply went out, in milliseconds. */
  at: number;
  /** The reply as the old engine released it. */
  released: string;
  /** What was saved otherwise than released (the old engine's departures from it); null where nothing was. */
  saved: string | null;
}

/** The session a carried turn's run names: none, as RPE played no run of it, so it has no folder of RPE's and no trace. */
export const CARRIED_SESSION = "";

/**
 * Keeps the run record of a turn a migration carried, so the first turn RPE plays after it is told its reply as it tells any: cut short,
 * or saved otherwise than released (`saved_differs`, plan §6.3, §10.8). Inside a queued write; one per turn, a second replaces it. It
 * names no session (`CARRIED_SESSION`) and no run of RPH's: RPE played no run of it.
 */
export function keepCarriedRun(db: Database, run: CarriedRun): void {
  db.run("INSERT OR REPLACE INTO turn_run (user, id, turn, chat, session, kind, status, received, released, finished, ended, settled, reply, base, saved) VALUES (?, ?, ?, ?, ?, 'new', 'released', ?, ?, ?, ?, ?, ?, '', ?)", [
    run.user,
    `carried-${run.turn}`,
    run.turn,
    run.chat,
    CARRIED_SESSION,
    run.at,
    run.at,
    run.at,
    run.at,
    run.at,
    run.released,
    run.saved,
  ]);
}

const key = (user: string, id: string): string => `${user}\u0000${id}`;

export class Runs {
  /** Runs going on now, by turn. */
  readonly #running = new Map<string, Run>();

  constructor(
    private readonly db: Database,
    private readonly writes: Writes,
  ) {}

  /** How many runs are going on now: what is held in memory of runs, the rest being in the database. */
  get going(): number {
    return this.#running.size;
  }

  /**
   * Keeps a run's record as it stands, and once it has ended what it spent; inside a queued write. An end once recorded stays recorded,
   * whatever copy is written after it.
   */
  put(into: Database, r: RunRecord): void {
    into.run(
      `INSERT INTO turn_run (user, id, trace_run, turn, chat, session, generation, target, swipe, kind, status, received, started, first_word, released, finished, ended, intent_time, thinking, without_intent, intake, wait, folder, reply, progress, error, stopped_by, last_text, not_given, base, saved, settled, held, mark, intent_record)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user, id) DO UPDATE SET trace_run = excluded.trace_run, session = excluded.session, generation = excluded.generation, target = excluded.target, swipe = excluded.swipe, kind = excluded.kind,
         status = excluded.status, received = excluded.received, started = excluded.started, first_word = excluded.first_word, released = excluded.released, finished = excluded.finished, ended = excluded.ended,
         intent_time = excluded.intent_time, thinking = excluded.thinking, without_intent = excluded.without_intent, intake = excluded.intake, wait = excluded.wait, folder = excluded.folder,
         reply = excluded.reply, progress = excluded.progress, error = excluded.error, stopped_by = excluded.stopped_by, last_text = excluded.last_text, not_given = excluded.not_given, base = excluded.base, saved = excluded.saved,
         settled = COALESCE(turn_run.settled, excluded.settled), mark = excluded.mark, intent_record = COALESCE(excluded.intent_record, turn_run.intent_record)`,
      [
        r.user,
        r.id,
        r.traceRun,
        r.turn,
        r.chat,
        r.session,
        r.generation,
        r.target,
        r.swipe,
        r.kind,
        r.status,
        r.received,
        r.started,
        r.firstWord,
        r.released,
        r.finished,
        r.ended,
        r.intent === null ? null : JSON.stringify(r.intent),
        JSON.stringify(r.thinking),
        r.withoutIntent ? 1 : 0,
        r.intake === null ? null : JSON.stringify(r.intake),
        r.wait === null ? null : JSON.stringify(r.wait),
        r.folder === null ? null : JSON.stringify(r.folder),
        r.reply,
        JSON.stringify(r.progress),
        r.error === null ? null : JSON.stringify(r.error),
        r.stoppedBy === null ? null : JSON.stringify(r.stoppedBy),
        r.lastText ? 1 : 0,
        JSON.stringify(r.notGiven),
        r.base,
        r.saved,
        r.settled,
        r.held,
        r.mark,
        r.intentRecord,
      ],
    );
    const { usage } = r;
    if (usage === null) return;
    into.run(
      `INSERT OR REPLACE INTO usage (user, run, turn, chat, at, calls, input, cache_read, cache_write, output, reasoning, lore_searches, lore_reads) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.user, r.id, r.turn, r.chat, r.ended ?? r.received, usage.calls, usage.input, usage.cacheRead, usage.cacheWrite, usage.output, usage.reasoning ?? null, r.lookups.searches, r.lookups.reads],
    );
  }

  /**
   * A continue's run names the turn its held turn joined from now on (R-192 (e)), inside the caller's queued write: as kept, and as held
   * in memory while it goes on, so its end, its tokens and the Turn page find it under that turn.
   */
  join(into: Database, r: RunRecord, to: string): void {
    into.run("UPDATE turn_run SET turn = ? WHERE user = ? AND id = ?", [to, r.user, r.id]);
    into.run("UPDATE usage SET turn = ? WHERE user = ? AND run = ?", [to, r.user, r.id]);
    const live = this.#running.get(key(r.user, r.turn));
    if (live?.id === r.id) {
      this.#running.delete(key(r.user, r.turn));
      live.turn = to;
      this.#running.set(key(r.user, to), live);
    }
    r.turn = to;
  }

  /**
   * A continue's intent record kept with its run (`RunRecord.intentRecord`), inside the caller's queued write: as kept, and on the run
   * going on now, so its later records keep it.
   */
  keepIntent(into: Database, r: RunRecord, text: string): void {
    into.run("UPDATE turn_run SET intent_record = ? WHERE user = ? AND id = ?", [text, r.user, r.id]);
    const live = this.#running.get(key(r.user, r.turn));
    if (live?.id === r.id) live.intentRecord = text;
    r.intentRecord = text;
  }

  /** The continue's run that held its changes on `turn` (`RunRecord.held`), as it stands; null where none did. */
  byHeld(user: string, turn: string): RunRecord | null {
    for (const r of this.#running.values()) if (r.user === user && r.held === turn) return r;
    const row = this.db.query<RunRow, [string, string]>(`${RUN_ROWS} WHERE r.user = ? AND r.held = ? ORDER BY r.received DESC LIMIT 1`).get(user, turn);
    return row === null ? null : recordOf(user, row);
  }

  /** Writes a run's record as it stands now. */
  async save(r: RunRecord, label: string): Promise<void> {
    const copy: RunRecord = { ...r, progress: [...r.progress], lookups: { ...r.lookups } };
    await this.writes.run((into) => this.put(into, copy), label);
  }

  /** A run going on now joins the ones held in memory. */
  hold(run: Run): void {
    this.#running.set(key(run.user, run.turn), run);
    void run.over.finally(() => {
      if (this.#running.get(key(run.user, run.turn)) === run) this.#running.delete(key(run.user, run.turn));
    });
  }

  /** The run of a turn going on now. */
  running(user: string, turn: string): Run | undefined {
    return this.#running.get(key(user, turn));
  }

  /** The runs of a chat going on now. */
  ofChat(user: string, chat: string): Run[] {
    return [...this.#running.values()].filter((r) => r.user === user && r.chat === chat);
  }

  /** The chats with a run going on now. */
  chatsGoing(): string[] {
    return [...new Set([...this.#running.values()].map((r) => r.chat))];
  }

  /** A turn's run began in RPH: the run of the turn going on now takes RPH's own id for it, from the run's `run_started` (a job's is none of RPE's runs). */
  started(record: TraceRecord): void {
    const turn = record.scope.turn;
    if (record.event.kind !== "run_started" || record.event.run !== "turn" || turn === undefined) return;
    const run = this.running(record.scope.user, turn);
    if (run !== undefined) run.traceRun = record.run;
  }

  /** A turn's run as it stands: the one going on now, else its latest as kept. */
  record(user: string, turn: string): RunRecord | null {
    const live = this.running(user, turn);
    if (live !== undefined) return live;
    const row = this.db.query<RunRow, [string, string]>(`${RUN_ROWS} WHERE r.user = ? AND r.turn = ? ORDER BY r.received DESC, r.rowid DESC LIMIT 1`).get(user, turn);
    return row === null ? null : recordOf(user, row);
  }

  /** A turn's reply as it stands: its latest run that wrote into the chat, never a Settle now run, which writes nothing there; null where none did. */
  reply(user: string, turn: string): RunRecord | null {
    return this.ofTurn(user, turn).findLast((r) => r.kind !== "settle") ?? null;
  }

  /** Every run of a turn, oldest first: its first, then each continue's; the one going on now as it stands. */
  ofTurn(user: string, turn: string): RunRecord[] {
    const live = this.running(user, turn);
    return this.db
      .query<RunRow, [string, string]>(`${RUN_ROWS} WHERE r.user = ? AND r.turn = ? ORDER BY r.received, r.rowid`)
      .all(user, turn)
      .map((r) => (live !== undefined && live.id === r.id ? live : recordOf(user, r)));
  }

  /** The run a generation was played by, as kept. */
  byGeneration(user: string, generation: string): RunRecord | null {
    for (const r of this.#running.values()) if (r.user === user && r.generation === generation) return r;
    const row = this.db.query<RunRow, [string, string]>(`${RUN_ROWS} WHERE r.user = ? AND r.generation = ? ORDER BY r.received DESC LIMIT 1`).get(user, generation);
    return row === null ? null : recordOf(user, row);
  }

  /** A chat's turns as kept, each as its latest run, newest first: `limit` of them, older than the turn `before` when one is named. A run whose turn the store no longer holds is not one of them. */
  ofChatKept(user: string, chat: string, limit: number, before?: string): RunRecord[] {
    const from = before === undefined ? null : this.db.query<{ received: number | null }, [string, string, string]>("SELECT max(received) AS received FROM turn_run WHERE user = ? AND chat = ? AND turn = ?").get(user, chat, before);
    const latest = "NOT EXISTS (SELECT 1 FROM turn_run n WHERE n.user = r.user AND n.turn = r.turn AND (n.received > r.received OR (n.received = r.received AND n.rowid > r.rowid))) AND EXISTS (SELECT 1 FROM turn t WHERE t.user = r.user AND t.id = r.turn)";
    const rows =
      from === null || from.received === null
        ? this.db.query<RunRow, [string, string, number]>(`${RUN_ROWS} WHERE r.user = ? AND r.chat = ? AND ${latest} ORDER BY r.received DESC, r.rowid DESC LIMIT ?`).all(user, chat, limit)
        : this.db.query<RunRow, [string, string, number, number]>(`${RUN_ROWS} WHERE r.user = ? AND r.chat = ? AND r.received < ? AND ${latest} ORDER BY r.received DESC, r.rowid DESC LIMIT ?`).all(user, chat, from.received, limit);
    return rows.map((r) => this.running(user, r.turn) ?? recordOf(user, r));
  }

  /** The chats he played on RPE, the newest played first: a chat a migration carried and RPE has played no turn of is not among them. */
  chats(user: string): { chat: string; last: number }[] {
    return this.db.query<{ chat: string; last: number }, [string, string]>("SELECT chat, max(received) AS last FROM turn_run WHERE user = ? AND session <> ? GROUP BY chat ORDER BY last DESC").all(user, CARRIED_SESSION);
  }

  /**
   * The chat's runs whose generation's end is not recorded yet, as kept, oldest first: ended unheard, or left going when RPE stopped.
   * The ones going on now are not among them.
   */
  unsettled(user: string, chat: string): RunRecord[] {
    return this.db
      .query<RunRow, [string, string]>(`${RUN_ROWS} WHERE r.user = ? AND r.chat = ? AND r.settled IS NULL AND r.generation IS NOT NULL ORDER BY r.received, r.rowid`)
      .all(user, chat)
      .filter((r) => this.running(user, r.turn)?.id !== r.id)
      .map((r) => recordOf(user, r));
  }

  /**
   * Every run kept as going on that this process does not hold, whoever's and whatever became of its generation, oldest first: at a
   * start, the runs RPE stopped during.
   */
  leftGoing(): RunRecord[] {
    return this.db
      .query<RunRow & { user: string }, []>(`${RUN_ROWS} WHERE r.status = 'running' ORDER BY r.received, r.rowid`)
      .all()
      .filter((r) => this.running(r.user, r.turn)?.id !== r.id)
      .map((r) => recordOf(r.user, r));
  }
}

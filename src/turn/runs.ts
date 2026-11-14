// Each turn's run, as the Turn page shows it and the next turn waits on it: where it stands, when its
// moments happened, what it spent, and what went to the chat (its reply's text and the progress lines
// of the thinking block). A run going on now is held in memory, with what stops it; every run is kept
// in RPE's database (`turn_run`), written when it begins, when its reply is released and when it ends.

import type { Database } from "bun:sqlite";
import type { ReplyError, RunStatus, TurnKind, Usage } from "rp-harness/contract";
import type { Writes } from "./kv";

/** Where a run stands: going on, or how it ended. */
export type RunState = RunStatus | "running";

/** A run as it is kept. */
export interface RunRecord {
  user: string;
  turn: string;
  chat: string;
  session: string;
  generation: string | null;
  /** The message the reply is saved to; null for one that saves to none (an impersonation). */
  target: string | null;
  kind: TurnKind;
  status: RunState;
  received: number;
  started: number | null;
  firstWord: number | null;
  released: number | null;
  ended: number | null;
  usage: Usage | null;
  /** What went to the chat as the reply. */
  reply: string;
  /** The progress lines that went to the chat's thinking block, in order. */
  progress: string[];
  error: ReplyError | null;
  /** What Lumiverse puts in front of the reply when it saves it: the preset's prefill, or for a continue the text the message held. */
  base: string;
  /** What Lumiverse saved, where it is not what was released (plan §10.8 "Saved against released"); null when it is, or not yet saved. */
  saved: string | null;
}

/** A run going on now: its record, what stops it, and when it is over. */
export interface Run extends RunRecord {
  readonly stop: AbortController;
  /** Resolves when the lead's run is over. */
  readonly over: Promise<void>;
}

interface RunRow {
  turn: string;
  chat: string;
  session: string;
  generation: string | null;
  target: string | null;
  kind: string;
  status: string;
  received: number;
  started: number | null;
  first_word: number | null;
  released: number | null;
  ended: number | null;
  usage: string | null;
  reply: string;
  progress: string;
  error: string | null;
  base: string;
  saved: string | null;
}

function recordOf(user: string, r: RunRow): RunRecord {
  return {
    user,
    turn: r.turn,
    chat: r.chat,
    session: r.session,
    generation: r.generation,
    target: r.target,
    kind: r.kind as TurnKind,
    status: r.status as RunState,
    received: r.received,
    started: r.started,
    firstWord: r.first_word,
    released: r.released,
    ended: r.ended,
    usage: r.usage === null ? null : (JSON.parse(r.usage) as Usage),
    reply: r.reply,
    progress: JSON.parse(r.progress) as string[],
    error: r.error === null ? null : (JSON.parse(r.error) as ReplyError),
    base: r.base,
    saved: r.saved,
  };
}

const key = (user: string, id: string): string => `${user}\u0000${id}`;

export class Runs {
  /** Runs going on now, by turn. */
  readonly #running = new Map<string, Run>();

  constructor(
    private readonly db: Database,
    private readonly writes: Writes,
  ) {}

  /** Keeps a run's record as it stands; inside a queued write. */
  put(into: Database, r: RunRecord): void {
    into.run(
      `INSERT INTO turn_run (user, turn, chat, session, generation, target, kind, status, received, started, first_word, released, ended, usage, reply, progress, error, base, saved)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user, turn) DO UPDATE SET session = excluded.session, generation = excluded.generation, target = excluded.target, kind = excluded.kind, status = excluded.status,
         received = excluded.received, started = excluded.started, first_word = excluded.first_word, released = excluded.released, ended = excluded.ended,
         usage = excluded.usage, reply = excluded.reply, progress = excluded.progress, error = excluded.error, base = excluded.base, saved = excluded.saved`,
      [
        r.user,
        r.turn,
        r.chat,
        r.session,
        r.generation,
        r.target,
        r.kind,
        r.status,
        r.received,
        r.started,
        r.firstWord,
        r.released,
        r.ended,
        r.usage === null ? null : JSON.stringify(r.usage),
        r.reply,
        JSON.stringify(r.progress),
        r.error === null ? null : JSON.stringify(r.error),
        r.base,
        r.saved,
      ],
    );
  }

  /** Writes a run's record as it stands now. */
  async save(r: RunRecord, label: string): Promise<void> {
    const copy: RunRecord = { ...r, progress: [...r.progress] };
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

  /** The chat a run is played in, for a piece of streaming text, which names only its run (the turn's id). */
  chatOfRun(run: string): string | null {
    for (const r of this.#running.values()) if (r.turn === run) return r.chat;
    return null;
  }

  /** A turn's run as it stands: the one going on now, else as kept. */
  record(user: string, turn: string): RunRecord | null {
    const live = this.running(user, turn);
    if (live !== undefined) return live;
    const row = this.db.query<RunRow, [string, string]>("SELECT * FROM turn_run WHERE user = ? AND turn = ?").get(user, turn);
    return row === null ? null : recordOf(user, row);
  }

  /** The run a generation was played by, as kept. */
  byGeneration(user: string, generation: string): RunRecord | null {
    for (const r of this.#running.values()) if (r.user === user && r.generation === generation) return r;
    const row = this.db.query<RunRow, [string, string]>("SELECT * FROM turn_run WHERE user = ? AND generation = ? ORDER BY received DESC LIMIT 1").get(user, generation);
    return row === null ? null : recordOf(user, row);
  }

  /** A chat's runs as kept, newest first: `limit` of them, older than the turn `before` when one is named. */
  ofChatKept(user: string, chat: string, limit: number, before?: string): RunRecord[] {
    const from = before === undefined ? null : this.db.query<{ received: number }, [string, string, string]>("SELECT received FROM turn_run WHERE user = ? AND chat = ? AND turn = ?").get(user, chat, before);
    const rows =
      from === null
        ? this.db.query<RunRow, [string, string, number]>("SELECT * FROM turn_run WHERE user = ? AND chat = ? ORDER BY received DESC, rowid DESC LIMIT ?").all(user, chat, limit)
        : this.db.query<RunRow, [string, string, number, number]>("SELECT * FROM turn_run WHERE user = ? AND chat = ? AND received < ? ORDER BY received DESC, rowid DESC LIMIT ?").all(user, chat, from.received, limit);
    return rows.map((r) => this.running(user, r.turn) ?? recordOf(user, r));
  }

  /** The chats with a run, the most recently played first, with when their newest run began. */
  chats(user: string): { chat: string; last: number }[] {
    return this.db.query<{ chat: string; last: number }, [string]>("SELECT chat, max(received) AS last FROM turn_run WHERE user = ? GROUP BY chat ORDER BY last DESC").all(user);
  }

  /** The chat's runs whose generation ended unheard: over, with a generation, as kept. */
  ended(user: string, chat: string): RunRecord[] {
    return this.db
      .query<RunRow, [string, string]>("SELECT * FROM turn_run WHERE user = ? AND chat = ? AND generation IS NOT NULL AND status <> 'running'")
      .all(user, chat)
      .filter((r) => this.running(user, r.turn) === undefined)
      .map((r) => recordOf(user, r));
  }
}

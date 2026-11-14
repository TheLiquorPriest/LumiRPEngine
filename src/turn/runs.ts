// Each turn's run, as the Turn page shows it and the next turn waits on it: where it stands, when its
// moments happened, what it spent, and what went to the chat (its reply's text and the progress lines
// of the thinking block). A run going on now is held in memory, with what stops it; every run is kept
// in RPE's database (`turn_run`), written when it begins, when its reply is released and when it ends.
// A turn has one run, or more when it is continued: each continue is a run of its own, kept beside the
// earlier ones, and the turn as the pages show it is its latest run.

import type { Database } from "bun:sqlite";
import type { ReplyError, RunStatus, TurnKind, Usage } from "rp-harness/contract";
import type { Writes } from "./kv";

/** Where a run stands: going on, or how it ended. */
export type RunState = RunStatus | "running";

/** A run as it is kept. */
export interface RunRecord {
  /** The run's own id: a continue runs its turn again under a new one. */
  id: string;
  user: string;
  turn: string;
  chat: string;
  session: string;
  generation: string | null;
  /** The message the reply is saved to; null for one that saves to none (an impersonation), or to one Lumiverse makes when it saves. */
  target: string | null;
  /**
   * The swipe of `target` the generation writes: a swipe's or a regenerate's own new one, the one a continue goes on, a new reply's
   * first. Lumiverse writes it there whichever swipe the player looks at by then (`chats.service.ts:3346-3362`). Null with no target.
   */
  swipe: number | null;
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
  /**
   * When the generation's end was recorded: its turn tied to what Lumiverse saved, or dropped, or nothing to record. Null until then:
   * a run whose end was not heard, or that RPE stopped during, is found by the chat's next intake (plan §10.8).
   */
  settled: number | null;
  /**
   * A continue of a turn already tied: the order (`ord`) of the turn's last change when the continue began, -1 for none. What the
   * turn records after it is the continue's, taken back if it saves nothing new (plan §6.3). Null for any other run.
   */
  mark: number | null;
  /** The same for the cast's rows (`castMark`) and the story's (`storyMark`) on the turn; null for any other run, or a run kept before they were. */
  castMark: number | null;
  storyMark: number | null;
}

/** A run going on now: its record, what stops it, and when it is over. */
export interface Run extends RunRecord {
  readonly stop: AbortController;
  /** Resolves when the lead's run is over. */
  readonly over: Promise<void>;
}

interface RunRow {
  id: string;
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
  ended: number | null;
  usage: string | null;
  reply: string;
  progress: string;
  error: string | null;
  base: string;
  saved: string | null;
  settled: number | null;
  mark: number | null;
  cast_mark: number | null;
  story_mark: number | null;
}

function recordOf(user: string, r: RunRow): RunRecord {
  return {
    id: r.id,
    user,
    turn: r.turn,
    chat: r.chat,
    session: r.session,
    generation: r.generation,
    target: r.target,
    swipe: r.swipe,
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
    settled: r.settled,
    mark: r.mark,
    castMark: r.cast_mark,
    storyMark: r.story_mark,
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

  /** Keeps a run's record as it stands; inside a queued write. An end once recorded stays recorded, whatever copy is written after it. */
  put(into: Database, r: RunRecord): void {
    into.run(
      `INSERT INTO turn_run (user, id, turn, chat, session, generation, target, swipe, kind, status, received, started, first_word, released, ended, usage, reply, progress, error, base, saved, settled, mark, cast_mark, story_mark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user, id) DO UPDATE SET session = excluded.session, generation = excluded.generation, target = excluded.target, swipe = excluded.swipe, kind = excluded.kind,
         status = excluded.status, received = excluded.received, started = excluded.started, first_word = excluded.first_word, released = excluded.released, ended = excluded.ended,
         usage = excluded.usage, reply = excluded.reply, progress = excluded.progress, error = excluded.error, base = excluded.base, saved = excluded.saved,
         settled = COALESCE(turn_run.settled, excluded.settled), mark = excluded.mark, cast_mark = excluded.cast_mark, story_mark = excluded.story_mark`,
      [
        r.user,
        r.id,
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
        r.ended,
        r.usage === null ? null : JSON.stringify(r.usage),
        r.reply,
        JSON.stringify(r.progress),
        r.error === null ? null : JSON.stringify(r.error),
        r.base,
        r.saved,
        r.settled,
        r.mark,
        r.castMark,
        r.storyMark,
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

  /** The chats with a run going on now. */
  chatsGoing(): string[] {
    return [...new Set([...this.#running.values()].map((r) => r.chat))];
  }

  /** The chat a run is played in, for a piece of streaming text, which names only its run (the turn's id). */
  chatOfRun(run: string): string | null {
    for (const r of this.#running.values()) if (r.turn === run) return r.chat;
    return null;
  }

  /** A turn's run as it stands: the one going on now, else its latest as kept. */
  record(user: string, turn: string): RunRecord | null {
    const live = this.running(user, turn);
    if (live !== undefined) return live;
    const row = this.db.query<RunRow, [string, string]>("SELECT * FROM turn_run WHERE user = ? AND turn = ? ORDER BY received DESC, rowid DESC LIMIT 1").get(user, turn);
    return row === null ? null : recordOf(user, row);
  }

  /** Every run of a turn, oldest first: its first, then each continue's; the one going on now as it stands. */
  ofTurn(user: string, turn: string): RunRecord[] {
    const live = this.running(user, turn);
    return this.db
      .query<RunRow, [string, string]>("SELECT * FROM turn_run WHERE user = ? AND turn = ? ORDER BY received, rowid")
      .all(user, turn)
      .map((r) => (live !== undefined && live.id === r.id ? live : recordOf(user, r)));
  }

  /** The run a generation was played by, as kept. */
  byGeneration(user: string, generation: string): RunRecord | null {
    for (const r of this.#running.values()) if (r.user === user && r.generation === generation) return r;
    const row = this.db.query<RunRow, [string, string]>("SELECT * FROM turn_run WHERE user = ? AND generation = ? ORDER BY received DESC LIMIT 1").get(user, generation);
    return row === null ? null : recordOf(user, row);
  }

  /** A chat's turns as kept, each as its latest run, newest first: `limit` of them, older than the turn `before` when one is named. */
  ofChatKept(user: string, chat: string, limit: number, before?: string): RunRecord[] {
    const from = before === undefined ? null : this.db.query<{ received: number | null }, [string, string, string]>("SELECT max(received) AS received FROM turn_run WHERE user = ? AND chat = ? AND turn = ?").get(user, chat, before);
    const latest = "NOT EXISTS (SELECT 1 FROM turn_run n WHERE n.user = r.user AND n.turn = r.turn AND (n.received > r.received OR (n.received = r.received AND n.rowid > r.rowid)))";
    const rows =
      from === null || from.received === null
        ? this.db.query<RunRow, [string, string, number]>(`SELECT * FROM turn_run r WHERE user = ? AND chat = ? AND ${latest} ORDER BY received DESC, rowid DESC LIMIT ?`).all(user, chat, limit)
        : this.db.query<RunRow, [string, string, number, number]>(`SELECT * FROM turn_run r WHERE user = ? AND chat = ? AND received < ? AND ${latest} ORDER BY received DESC, rowid DESC LIMIT ?`).all(user, chat, from.received, limit);
    return rows.map((r) => this.running(user, r.turn) ?? recordOf(user, r));
  }

  /** The chats with a run, the most recently played first, with when their newest run began. */
  chats(user: string): { chat: string; last: number }[] {
    return this.db.query<{ chat: string; last: number }, [string]>("SELECT chat, max(received) AS last FROM turn_run WHERE user = ? GROUP BY chat ORDER BY last DESC").all(user);
  }

  /**
   * The chat's runs whose generation's end is not recorded yet, as kept, oldest first: ended unheard, or left going when RPE stopped.
   * The ones going on now are not among them.
   */
  unsettled(user: string, chat: string): RunRecord[] {
    return this.db
      .query<RunRow, [string, string]>("SELECT * FROM turn_run WHERE user = ? AND chat = ? AND settled IS NULL AND generation IS NOT NULL ORDER BY received, rowid")
      .all(user, chat)
      .filter((r) => this.running(user, r.turn)?.id !== r.id)
      .map((r) => recordOf(user, r));
  }
}

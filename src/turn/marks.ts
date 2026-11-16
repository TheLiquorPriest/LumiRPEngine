// The marks a turn carries, each a mark of its own apart from its run's status (plan §10.8, §10.10, R-25):
// interrupted (RPE restarted while a run of it went on), saved otherwise (what Lumiverse saved is not
// what was released, beyond the prefill in front and a continue's join), and standing on a message of
// the player's he edited, or inserted before it, since the turn was played (with which message and
// when). Kept by turn in the harness database (`turn_mark`), every row carrying the user; given with the
// turn in the chat's list and in its detail.

import type { Database } from "bun:sqlite";
import type { WriteQueue } from "../app";

/** What a mark says of its turn. */
export type MarkKind = "interrupted" | "saved-otherwise" | "edited-message" | "inserted-message";

/** One mark of a turn: its kind, the player's message it names (for an edited or inserted one; null for the rest), and when it was set. */
export interface TurnMark {
  kind: MarkKind;
  message: string | null;
  at: number;
}

interface MarkRow {
  turn: string;
  kind: MarkKind;
  message: string;
  at: number;
}

export class TurnMarks {
  constructor(
    private readonly db: Database,
    private readonly writes: WriteQueue,
  ) {}

  /** Sets a mark on each of `turns`, inside a write; one already set (the same kind, and message) keeps the time it was first set. */
  set(db: Database, user: string, turns: readonly string[], kind: MarkKind, at: number, message: string | null = null): void {
    const put = db.query("INSERT INTO turn_mark (user, turn, kind, message, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user, turn, kind, message) DO NOTHING");
    for (const turn of turns) put.run(user, turn, kind, message ?? "", at);
  }

  /** Sets marks in a write of its own. */
  async mark(user: string, turns: readonly string[], kind: MarkKind, at: number, message: string | null = null): Promise<void> {
    if (turns.length === 0) return;
    await this.writes.run((db) => this.set(db, user, turns, kind, at, message), `marking turns ${kind}`);
  }

  /** A continue's held turn joining the turn it extended, inside the write: its marks become that turn's. */
  join(db: Database, user: string, held: string, into: string): void {
    db.run("INSERT OR IGNORE INTO turn_mark (user, turn, kind, message, at) SELECT user, ?, kind, message, at FROM turn_mark WHERE user = ? AND turn = ?", [into, user, held]);
    db.run("DELETE FROM turn_mark WHERE user = ? AND turn = ?", [user, held]);
  }

  /** The marks of each of `turns`, in the order they were set; a turn with none is left out. */
  of(user: string, turns: readonly string[]): Map<string, TurnMark[]> {
    const out = new Map<string, TurnMark[]>();
    if (turns.length === 0) return out;
    const rows = this.db
      .query<MarkRow, string[]>(`SELECT turn, kind, message, at FROM turn_mark WHERE user = ? AND turn IN (${turns.map(() => "?").join(", ")}) ORDER BY at, rowid`)
      .all(user, ...turns);
    for (const r of rows) {
      const mark: TurnMark = { kind: r.kind, message: r.message === "" ? null : r.message, at: r.at };
      const list = out.get(r.turn);
      if (list === undefined) out.set(r.turn, [mark]);
      else list.push(mark);
    }
    return out;
  }

  /** The marks of one turn. */
  ofTurn(user: string, turn: string): TurnMark[] {
    return this.of(user, [turn]).get(turn) ?? [];
  }
}

// RPE's approvals port, given to RPH (`Environment.approvals`; the engine's tools pass it on): the one home of the decision whether a
// write to a lane goes ahead (plan §6.8, §16). `permission` is the user's setting for the chat, each lane Auto, Confirm or Never
// (`permissions.story`, `permissions.engine`, and `permissions.external` for the tools outside RPE), read from the config of every level
// at each call, so a setting changed between two calls is in force at the second. `ask` keeps the question in the `approval` table,
// where the turn's card shows it as waiting (R-72), and waits for his answer, which the card's route brings (`answer`); when the signal
// ends (the turn stopped, a limit hit) the question is taken down, and the wait ends with the signal's reason. Of what is asked,
// nothing is decided here: a lane set to Never is refused by RPH's gate in the file's words, a Confirm is only waited on.

import type { Database } from "bun:sqlite";
import type { ApprovalAnswer, ApprovalAsk, ApprovalsPort, FilesPort, JsonValue, LanePermission, Log, RunScope } from "rp-harness/contract";
import type { Writes } from "../iface/kit";
import { isRecord } from "../shared/json";
import { turnSettings } from "./settings";

/** Where a question stands. */
export type ApprovalState = "waiting" | "answered" | "taken_down";

/** One question as the table keeps it. */
export interface ApprovalRow {
  id: string;
  chat: string;
  turn: string | null;
  job: string | null;
  agent: JsonValue;
  call: string;
  tool: string;
  lane: string;
  args: JsonValue;
  asked: number;
  state: ApprovalState;
  /** His answer as he gave it; null while it waits or was taken down. */
  answer: ApprovalAnswer | null;
  answered: number | null;
}

interface ApprovalDb {
  id: string;
  chat: string;
  turn: string | null;
  job: string | null;
  agent: string;
  call: string;
  tool: string;
  lane: string;
  args: string;
  asked: number;
  state: string;
  answer: string | null;
  answered: number | null;
}

/** What the port is made of. */
export interface ApprovalsDeps {
  db: Database;
  writes: Writes;
  files: Pick<FilesPort, "layers" | "read">;
  log: Log;
  now: () => number;
  /** Told when a question is asked, answered or taken down, so a page that follows the turn reads its card again. */
  changed?: (chat: string, turn: string | null) => void;
  /** Whether a call of `tool` would only answer that it does nothing (a web search where no provider is set): no question is put to him for it, and the tool says so itself. */
  idle?: (scope: RunScope, tool: string) => Promise<boolean>;
}

/** What an answer to a question came to. */
export type Answered = { ok: true } | { ok: false; why: "unknown" | "settled" };

function rowOf(r: ApprovalDb): ApprovalRow {
  return { id: r.id, chat: r.chat, turn: r.turn, job: r.job, agent: JSON.parse(r.agent) as JsonValue, call: r.call, tool: r.tool, lane: r.lane, args: JSON.parse(r.args) as JsonValue, asked: r.asked, state: r.state as ApprovalState, answer: r.answer === null ? null : (JSON.parse(r.answer) as ApprovalAnswer), answered: r.answered };
}

export class Approvals implements ApprovalsPort {
  /** The questions waiting for his word in this process, by user and id: what resolves each. */
  private readonly waiting = new Map<string, { chat: string; turn: string | null; resolve: (answer: ApprovalAnswer) => void; reject: (reason: unknown) => void }>();
  private next = 0;

  constructor(private readonly deps: ApprovalsDeps) {
    // A question still waiting when RPE went down is one nobody waits on: taken down.
    void deps.writes.run((db) => db.run("UPDATE approval SET state = 'taken_down' WHERE state = 'waiting'"), "taking down the questions no run waits on").catch((error) => deps.log.warn("Taking down the approval questions of an earlier run failed.", { error }));
  }

  /** The user's setting for a lane in this chat; every lane is Auto for work tied to no chat, and a lane RPE keeps no setting for. */
  async permission(scope: RunScope, lane: string): Promise<LanePermission> {
    if (scope.chat === undefined) return "auto";
    const settings = await turnSettings(this.deps.files as FilesPort, scope, this.deps.log);
    return lane === "story" || lane === "engine" || lane === "external" ? settings.permissions[lane] : "auto";
  }

  async ask(scope: RunScope, ask: ApprovalAsk, signal: AbortSignal): Promise<ApprovalAnswer> {
    if (signal.aborted) throw signal.reason;
    if (scope.chat === undefined) return { go: true };
    // A call that would only answer that it does nothing here puts no question to him.
    if (await this.deps.idle?.(scope, ask.tool)) return { go: true };
    const { chat } = scope;
    const turn = scope.turn ?? null;
    const id = `ap-${this.deps.now().toString(36)}-${(this.next++).toString(36)}`;
    const key = `${scope.user}\u0000${id}`;
    const { promise: answered, resolve, reject } = Promise.withResolvers<ApprovalAnswer>();
    this.waiting.set(key, { chat, turn, resolve, reject });
    await this.deps.writes.run(
      (db) => db.run("INSERT INTO approval (user, id, chat, turn, job, agent, call, tool, lane, args, asked, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')", [scope.user, id, chat, turn, ask.agent.job ?? null, JSON.stringify(ask.agent), ask.callId, ask.tool, ask.lane, JSON.stringify(ask.args), ask.at]),
      "keeping a question for your word",
    );
    this.deps.changed?.(chat, turn);
    const takeDown = (): void => {
      const held = this.waiting.get(key);
      if (held === undefined) return;
      this.waiting.delete(key);
      void this.deps.writes
        .run((db) => db.run("UPDATE approval SET state = 'taken_down' WHERE user = ? AND id = ? AND state = 'waiting'", [scope.user, id]), "taking a question down")
        .then(() => this.deps.changed?.(chat, turn))
        .catch((error) => this.deps.log.warn("Taking an approval question down failed.", { error }));
      held.reject(signal.reason);
    };
    if (signal.aborted) takeDown();
    else signal.addEventListener("abort", takeDown, { once: true });
    try {
      return await answered;
    } finally {
      signal.removeEventListener("abort", takeDown);
    }
  }

  /** His word on a question: it resolves the wait, and is kept as he gave it. */
  async answer(user: string, id: string, answer: ApprovalAnswer): Promise<Answered> {
    const key = `${user}\u0000${id}`;
    const held = this.waiting.get(key);
    if (held === undefined) {
      const row = this.deps.db.query<{ state: string }, [string, string]>("SELECT state FROM approval WHERE user = ? AND id = ?").get(user, id);
      return { ok: false, why: row === null ? "unknown" : "settled" };
    }
    this.waiting.delete(key);
    await this.deps.writes.run((db) => db.run("UPDATE approval SET state = 'answered', answer = ?, answered = ? WHERE user = ? AND id = ? AND state = 'waiting'", [JSON.stringify(answer), this.deps.now(), user, id]), "keeping your word on a question");
    held.resolve(answer);
    this.deps.changed?.(held.chat, held.turn);
    return { ok: true };
  }

  /** The questions of a turn (waiting first, then in the order asked), or of a chat's work tied to no turn (`turn` null). */
  ofTurn(user: string, chat: string, turn: string | null): ApprovalRow[] {
    const rows = this.deps.db
      .query<ApprovalDb, [string, string, string | null]>("SELECT id, chat, turn, job, agent, call, tool, lane, args, asked, state, answer, answered FROM approval WHERE user = ?1 AND chat = ?2 AND turn IS ?3 ORDER BY CASE state WHEN 'waiting' THEN 0 ELSE 1 END, asked, id")
      .all(user, chat, turn);
    return rows.map(rowOf);
  }

  /** The questions of a chat that wait for his word now. */
  waitingIn(user: string, chat: string): ApprovalRow[] {
    return this.deps.db
      .query<ApprovalDb, [string, string]>("SELECT id, chat, turn, job, agent, call, tool, lane, args, asked, state, answer, answered FROM approval WHERE user = ?1 AND chat = ?2 AND state = 'waiting' ORDER BY asked, id")
      .all(user, chat)
      .map(rowOf);
  }

  /** The cards, chips and approvals the earlier engine kept for a turn carried in, as they were (the `chip` table, source `import`). */
  chipsOf(user: string, chat: string, turn: string): { id: string; kind: string; at: number; data: JsonValue }[] {
    return this.deps.db
      .query<{ id: string; kind: string; at: number; data: string }, [string, string, string]>("SELECT id, kind, at, data FROM chip WHERE user = ?1 AND chat = ?2 AND turn = ?3 ORDER BY at, id")
      .all(user, chat, turn)
      .map((r) => ({ id: r.id, kind: r.kind, at: r.at, data: JSON.parse(r.data) as JsonValue }));
  }
}

/** Whether a body is an answer: go, or no with a reason, as the card sends it. */
export function answerOf(body: unknown): ApprovalAnswer | null {
  if (!isRecord(body) || typeof body.go !== "boolean") return null;
  return body.go ? { go: true } : { go: false, ...(typeof body.reason === "string" && body.reason.trim() !== "" ? { reason: body.reason.trim() } : {}) };
}

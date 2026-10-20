// Diagnostics (DESIGN §6.9): each chat's ring of records (turns, their steps with their model calls,
// errors, interceptor runs, slow requests), kept in `userStorage/runs/<chatId>/diagnostics.json` and
// mirrored as lines to the user's `diagnostics.log` with their level and turn; and the in-flight
// activity line, pushed to the chat's frontends as `lre.activity`.
//
// The records are GM-level and only ever answer `lre.diag`; the activity line carries a step's label
// and nothing else, so it is safe on the player's surfaces.

import type { ChatId, UserId } from "../shared/ids";
import { runDir } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { Activity, DiagCall, DiagLevel, DiagPhase, DiagRecord, DiagSection, DiagStatus } from "../shared/diagnostics";
import { callLabel, DIAG_PHASES, DIAG_RING, SLOW_MS, STEP_LABEL, suggestFix } from "../shared/diagnostics";
import { PROTOCOL_VERSION } from "../shared/protocol";
import type { TimeoutFired } from "../shared/timeouts";
import type { HostPort } from "./host";
import { readStoredJson } from "./stored-json";

/** Where a record belongs: the chat, its owner, and the generation (null outside a turn). */
export interface DiagAt {
  chatId: ChatId;
  userId: UserId;
  turn: string | null;
}

/** A step's verdict when it returned without throwing but didn't do its work. */
export type DiagVerdict = { status: "skipped" | "failed"; reason: string; fix?: string } | null;

export type DiagHost = Pick<HostPort, "storage" | "log" | "frontend">;

interface OpenStep {
  at: DiagAt;
  phase: DiagPhase;
  step: string;
  start: number;
  calls: DiagCall[];
  label: string;
}

interface Turn {
  at: DiagAt;
  start: number;
  failed: string | null;
  /** The label shown while no step runs ("Waiting for the reply…"). */
  rest: string;
}

interface ChatDiag {
  userId: UserId;
  records: DiagRecord[];
  loaded: Promise<void>;
}

const FORMAT = 1;
const STATUSES: readonly DiagStatus[] = ["ok", "skipped", "failed"];
const LEVELS: readonly DiagLevel[] = ["debug", "info", "warn", "error"];
const KINDS: readonly DiagRecord["kind"][] = ["step", "error", "sections", "slow", "turn"];

function isDiagRecord(raw: unknown): raw is DiagRecord {
  if (!isRecord(raw)) return false;
  return (
    typeof raw.seq === "number" &&
    KINDS.some((k) => k === raw.kind) &&
    LEVELS.some((l) => l === raw.level) &&
    STATUSES.some((s) => s === raw.status) &&
    (raw.turn === null || typeof raw.turn === "string") &&
    (raw.phase === null || DIAG_PHASES.some((p) => p === raw.phase)) &&
    typeof raw.step === "string" &&
    typeof raw.start === "number" &&
    typeof raw.end === "number" &&
    typeof raw.ms === "number"
  );
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Why a step whose last call went wrong failed, or null when its last call was fine. */
function callFailure(calls: readonly DiagCall[]): { reason: string; fix?: string } | null {
  const last = calls.at(-1);
  if (!last) return null;
  let reason: string | null = null;
  if (!last.ok) reason = `${last.purpose} call failed: ${last.error ?? "no reason given"}`;
  else if (last.finishReason === "length") reason = `${last.purpose} answer cut off at ${last.maxTokens ?? "max"} tokens (finish_reason length)`;
  else if (last.tokensOut === 0) reason = `${last.purpose} answer was empty`;
  if (reason === null) return null;
  const fix = suggestFix(reason, last);
  return { reason, ...(fix ? { fix } : {}) };
}

export class Diagnostics {
  private readonly chats = new Map<ChatId, ChatDiag>();
  private readonly writes = new Map<ChatId, Promise<void>>();
  private readonly timers = new Map<ChatId, ReturnType<typeof setTimeout>>();
  /** Steps under way, per user, innermost last: a model call belongs to the user's innermost step. */
  private readonly open = new Map<UserId, OpenStep[]>();
  private readonly turns = new Map<ChatId, Turn>();
  private readonly activities = new Map<ChatId, Activity>();
  /** Model calls under way per user, by purpose, latest last. */
  private readonly inflight = new Map<UserId, string[]>();
  private seq: number;

  constructor(
    private readonly host: DiagHost,
    private readonly options: { now?: () => number; ring?: number; flushMs?: number } = {},
  ) {
    this.seq = this.now();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private path(chatId: ChatId): string {
    return `${runDir(chatId)}diagnostics.json`;
  }

  private chat(chatId: ChatId, userId: UserId): ChatDiag {
    const known = this.chats.get(chatId);
    if (known?.userId === userId) return known;
    const chat: ChatDiag = { userId, records: [], loaded: Promise.resolve() };
    chat.loaded = (async () => {
      await this.writes.get(chatId);
      const raw = await readStoredJson(this.host, this.path(chatId), userId, "diagnostics", (r) => isRecord(r) && r.v === FORMAT && Array.isArray(r.records)).catch(() => null);
      const stored = isRecord(raw) && Array.isArray(raw.records) ? raw.records.filter(isDiagRecord) : [];
      chat.records = [...stored, ...chat.records].slice(-this.ring());
    })();
    this.chats.delete(chatId);
    this.chats.set(chatId, chat);
    if (this.chats.size > 128) this.chats.delete(this.chats.keys().next().value ?? "");
    return chat;
  }

  private ring(): number {
    return this.options.ring ?? DIAG_RING;
  }

  /** The chat's records, oldest first, once its stored ones are read. */
  async records(chatId: ChatId, userId: UserId): Promise<DiagRecord[]> {
    const chat = this.chat(chatId, userId);
    await chat.loaded;
    return [...chat.records];
  }

  /** Forgets the chat's records, in memory and stored. */
  async clear(chatId: ChatId, userId: UserId): Promise<void> {
    const chat = this.chat(chatId, userId);
    await chat.loaded;
    chat.records = [];
    this.save(chatId);
  }

  private add(at: { chatId: ChatId | null; userId: UserId; turn: string | null }, record: Omit<DiagRecord, "seq">): DiagRecord {
    const full: DiagRecord = { seq: ++this.seq, ...record };
    const where = `${record.phase ? `${record.phase}/` : ""}${record.step}`;
    const calls = record.calls && record.calls.length > 0 ? `, ${record.calls.length} call(s) ${record.calls.map((c) => `${c.model} ${c.tokensIn ?? "?"}→${c.tokensOut ?? "?"} ${c.finishReason || "-"}`).join("; ")}` : "";
    this.host.log(record.level === "debug" ? "debug" : record.level, `[LumiRPEngine] ${at.chatId ? `chat ${at.chatId} ` : ""}${record.kind} ${where} ${record.status} in ${Math.round(record.ms)} ms${record.reason ? `: ${record.reason}` : ""}${calls}`, at.userId, at.turn ?? undefined);
    if (!at.chatId) return full;
    const chat = this.chat(at.chatId, at.userId);
    chat.records.push(full);
    if (chat.records.length > this.ring()) chat.records.splice(0, chat.records.length - this.ring());
    if (record.status === "failed" && at.turn) {
      const turn = this.turns.get(at.chatId);
      if (turn && turn.at.turn === at.turn && turn.failed === null) turn.failed = where;
    }
    this.schedule(at.chatId);
    return full;
  }

  // ------------------------------------------------------------ turns and steps

  /** A turn starts: any turn of the chat still open closes first. */
  begin(at: DiagAt, label = STEP_LABEL.pre ?? "Working…"): void {
    const prior = this.turns.get(at.chatId);
    if (prior && prior.at.turn !== at.turn) this.end(prior.at, { status: "skipped", reason: "a new turn started before it ended" });
    if (prior?.at.turn === at.turn) return;
    this.turns.set(at.chatId, { at, start: this.now(), failed: null, rest: label });
    this.publish(at.chatId, at.userId);
  }

  /** The resting label (shown while no step runs) of the chat's turn under way, if any. */
  rest(at: { chatId: ChatId; userId: UserId }, label: string): void {
    const turn = this.turns.get(at.chatId);
    if (!turn) return;
    turn.rest = label;
    this.publish(at.chatId, at.userId);
  }

  /** The turn is over; it failed if any of its steps did, or `outcome` says so. */
  end(at: DiagAt, outcome: DiagVerdict = null): void {
    const turn = this.turns.get(at.chatId);
    if (!turn || turn.at.turn !== at.turn) return;
    this.turns.delete(at.chatId);
    const end = this.now();
    const failed = outcome?.status === "failed" ? (outcome.reason ?? "failed") : turn.failed;
    const status: DiagStatus = failed !== null ? "failed" : (outcome?.status ?? "ok");
    const reason = failed !== null ? (outcome?.status === "failed" ? outcome.reason : `step ${failed} failed`) : outcome?.reason;
    this.add(at, { kind: "turn", level: status === "failed" ? "warn" : "info", turn: at.turn, phase: null, step: "turn", status, start: turn.start, end, ms: end - turn.start, ...(reason ? { reason } : {}), ...(outcome?.fix ? { fix: outcome.fix } : {}) });
    if (failed !== null) this.activities.set(at.chatId, { chatId: at.chatId, turn: at.turn, state: "failed", label: `Failed: ${STEP_LABEL[failed.split("/").at(-1) ?? ""]?.replace("…", "") ?? failed}`, since: end });
    else this.activities.delete(at.chatId);
    this.send(at.chatId, at.userId);
  }

  /**
   * Times `fn` as a step: ok, the verdict `judge` gives its value, or failed with what it threw
   * (rethrown). A step whose last model call failed, was cut off or came back empty failed, whatever
   * it returned: that is how a step that falls back quietly shows.
   */
  async step<T>(at: DiagAt, phase: DiagPhase, step: string, fn: () => Promise<T>, judge?: (value: T) => DiagVerdict): Promise<T> {
    const open: OpenStep = { at, phase, step, start: this.now(), calls: [], label: STEP_LABEL[step] ?? STEP_LABEL[phase] ?? "Working…" };
    const stack = this.open.get(at.userId) ?? [];
    stack.push(open);
    this.open.set(at.userId, stack);
    this.publish(at.chatId, at.userId);
    try {
      const value = await fn();
      this.close(open, judge?.(value) ?? null);
      return value;
    } catch (error) {
      const reason = messageOf(error);
      const fix = suggestFix(reason, open.calls.at(-1));
      this.close(open, { status: "failed", reason, ...(fix ? { fix } : {}) });
      throw error;
    }
  }

  private close(open: OpenStep, verdict: DiagVerdict): void {
    const stack = this.open.get(open.at.userId) ?? [];
    const i = stack.lastIndexOf(open);
    if (i >= 0) stack.splice(i, 1);
    if (stack.length === 0) this.open.delete(open.at.userId);
    const end = this.now();
    const fromCalls = verdict ? null : callFailure(open.calls);
    const status: DiagStatus = verdict?.status ?? (fromCalls ? "failed" : "ok");
    const reason = verdict?.reason ?? fromCalls?.reason;
    const fix = verdict?.fix ?? (verdict?.status === "failed" ? suggestFix(verdict.reason, open.calls.at(-1)) : fromCalls?.fix);
    const level: DiagLevel = status === "failed" ? "warn" : open.calls.some((c) => !c.ok || c.finishReason === "length") ? "warn" : "info";
    this.add(open.at, { kind: "step", level, turn: open.at.turn, phase: open.phase, step: open.step, status, start: open.start, end, ms: end - open.start, ...(reason ? { reason } : {}), ...(fix ? { fix } : {}), ...(open.calls.length > 0 ? { calls: open.calls } : {}) });
    this.publish(open.at.chatId, open.at.userId);
  }

  /** A step that didn't run, and why. */
  skipped(at: DiagAt, phase: DiagPhase, step: string, reason: string): void {
    const t = this.now();
    this.add(at, { kind: "step", level: "info", turn: at.turn, phase, step, status: "skipped", start: t, end: t, ms: 0, reason });
  }

  /** A step that failed without throwing (a null answer, a fallback). */
  failed(at: DiagAt, phase: DiagPhase, step: string, reason: string, fix?: string): void {
    const t = this.now();
    const hint = fix ?? suggestFix(reason);
    this.add(at, { kind: "step", level: "warn", turn: at.turn, phase, step, status: "failed", start: t, end: t, ms: 0, reason, ...(hint ? { fix: hint } : {}) });
  }

  /**
   * A time limit that ran out (Settings → Timeouts), naming its setting and how to raise it: a failed
   * step in the chat's records (so its turn shows as failed), or, outside a chat, in the user's
   * diagnostics log. `context` says what it cut short.
   */
  timeout(at: { chatId: ChatId | null; userId: UserId; turn: string | null }, phase: DiagPhase, step: string, fired: TimeoutFired, context?: string): void {
    const t = this.now();
    this.add(at, { kind: "step", level: "warn", turn: at.turn, phase, step, status: "failed", start: t - fired.ms, end: t, ms: fired.ms, reason: context ? `${fired.message}: ${context}` : fired.message, fix: fired.fix });
  }

  /** An error caught at `where`, with what was going on. */
  error(at: DiagAt, where: string, error: unknown, context?: string): void {
    const t = this.now();
    const reason = `${messageOf(error)}${context ? ` (${context})` : ""}`;
    const fix = suggestFix(reason);
    this.add(at, { kind: "error", level: "error", turn: at.turn, phase: null, step: where, status: "failed", start: t, end: t, ms: 0, reason, ...(fix ? { fix } : {}) });
  }

  /** A model call starts: the activity line says what is being asked. */
  callStart(userId: UserId, purpose: string): void {
    const list = this.inflight.get(userId) ?? [];
    list.push(purpose);
    this.inflight.set(userId, list);
    this.publishUser(userId);
  }

  /** One model call: it joins the user's innermost step under way, or stands alone. */
  call(userId: UserId, call: DiagCall): void {
    const list = this.inflight.get(userId);
    const i = list?.lastIndexOf(call.purpose) ?? -1;
    if (list && i >= 0) list.splice(i, 1);
    if (list?.length === 0) this.inflight.delete(userId);
    const open = this.open.get(userId)?.at(-1);
    if (open) {
      open.calls.push(call);
      this.publishUser(userId);
      return;
    }
    const t = this.now();
    const failure = callFailure([call]);
    this.add({ chatId: null, userId, turn: null }, { kind: "step", level: failure ? "warn" : "debug", turn: null, phase: null, step: call.purpose, status: failure ? "failed" : "ok", start: t - call.ms, end: t, ms: call.ms, calls: [call], ...(failure ? { reason: failure.reason } : {}) });
  }

  /** The engine run wrote the turn's sections into the world's book: which reach which outlets, on which path. */
  sections(at: DiagAt, path: string, sections: readonly DiagSection[], start: number): void {
    const end = this.now();
    const filled = sections.filter((s) => s.filled).length;
    const routed = sections.filter((s) => s.outlet !== null);
    const status: DiagStatus = sections.length === 0 ? "skipped" : filled === 0 ? "failed" : "ok";
    const reason = sections.length === 0 ? "the world has no sections" : filled === 0 ? `no section had text to send, so every outlet (${routed.length} the preset holds) stays empty` : `${filled} of ${sections.length} section(s) filled, ${routed.filter((s) => s.filled).length} of them at the preset's outlets`;
    const fix = status === "failed" ? suggestFix("outlet") : undefined;
    this.add(at, { kind: "sections", level: status === "failed" ? "warn" : "info", turn: at.turn, phase: "sections", step: "sections", status, start, end, ms: end - start, path, sections: [...sections], reason, ...(fix ? { fix } : {}) });
  }

  /**
   * The first failure of a turn so far (the engine run halts on it, DESIGN §5.1): a model call that
   * failed, was cut off or came back empty, or a step that failed. A Decision call the helper answered
   * after is the helper's, and lore lookups don't count: a step answers without them.
   */
  failure(at: DiagAt): { step: string; reason: string } | null {
    for (const r of this.chats.get(at.chatId)?.records ?? []) {
      if (r.turn !== at.turn) continue;
      const calls = r.calls ?? [];
      for (const [i, c] of calls.entries()) {
        const failed = c.lookup ? null : callFailure([c]);
        if (!failed || (c.via === "decision" && calls.slice(i + 1).some((d) => d.purpose === c.purpose && d.via === "helper" && !callFailure([d])))) continue;
        return { step: c.purpose, reason: failed.reason };
      }
      if (r.status === "failed") return { step: r.step, reason: r.reason ?? "it failed" };
    }
    return null;
  }

  /** The turn under `from` goes on as `to` (a prepared turn a generation took): its records and its activity line. */
  rename(chatId: ChatId, from: string, to: string): void {
    for (const r of this.chats.get(chatId)?.records ?? []) if (r.turn === from) r.turn = to;
    const turn = this.turns.get(chatId);
    if (turn?.at.turn === from) turn.at = { ...turn.at, turn: to };
    for (const stack of this.open.values()) for (const s of stack) if (s.at.chatId === chatId && s.at.turn === from) s.at = { ...s.at, turn: to };
    const activity = this.activities.get(chatId);
    if (activity?.turn === from) this.activities.set(chatId, { ...activity, turn: to });
  }

  /** A request that took `ms`: kept when it is slower than `SLOW_MS`. */
  slow(userId: UserId, chatId: ChatId | null, what: string, ms: number): void {
    if (ms <= SLOW_MS) return;
    const end = this.now();
    this.add({ chatId, userId, turn: null }, { kind: "slow", level: "warn", turn: null, phase: "request", step: what, status: "ok", start: end - ms, end, ms, reason: `${what} took ${(ms / 1000).toFixed(1)} s` });
  }

  /** Times a request, keeping it when slow; one that throws is recorded as an error on its chat, and rethrown. */
  async timed<T>(userId: UserId, chatId: ChatId | null, what: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } catch (error) {
      if (chatId) this.error({ chatId, userId, turn: null }, what, error);
      throw error;
    } finally {
      this.slow(userId, chatId, what, performance.now() - t0);
    }
  }

  // ------------------------------------------------------------ activity

  /**
   * The chat's activity line now: while a turn runs, the model calls under way (the latest asked,
   * minds counted), else the innermost step's label, else the turn's resting one; after a failed
   * turn, the failure.
   */
  activityOf(chatId: ChatId): Activity | null {
    const turn = this.turns.get(chatId);
    if (turn) {
      const open = [...(this.open.get(turn.at.userId) ?? [])].reverse().find((s) => s.at.chatId === chatId);
      const asking = open ? this.inflight.get(turn.at.userId)?.at(-1) : undefined;
      const label = asking !== undefined ? callLabel(asking, this.inflight.get(turn.at.userId)?.filter((p) => p === asking).length ?? 1) : (open?.label ?? turn.rest);
      return { chatId, turn: turn.at.turn, state: "running", label, since: turn.start };
    }
    return this.activities.get(chatId) ?? null;
  }

  /** Sends the line of each chat whose turn the user's calls belong to. */
  private publishUser(userId: UserId): void {
    for (const [chatId, turn] of this.turns) if (turn.at.userId === userId) this.send(chatId, userId);
  }

  /** Clears a failure shown on the chat's line (the player saw it). */
  dismiss(chatId: ChatId, userId: UserId): void {
    if (this.activities.get(chatId)?.state !== "failed") return;
    this.activities.delete(chatId);
    this.send(chatId, userId);
  }

  private publish(chatId: ChatId, userId: UserId): void {
    if (this.turns.has(chatId)) this.send(chatId, userId);
  }

  private send(chatId: ChatId, userId: UserId): void {
    this.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.activity", chatId, activity: this.activityOf(chatId) }, userId);
  }

  // ------------------------------------------------------------ storage

  private schedule(chatId: ChatId): void {
    if (this.timers.has(chatId)) return;
    this.timers.set(
      chatId,
      setTimeout(() => {
        this.timers.delete(chatId);
        this.save(chatId);
      }, this.options.flushMs ?? 500),
    );
  }

  private save(chatId: ChatId): void {
    const chat = this.chats.get(chatId);
    if (!chat) return;
    const path = this.path(chatId);
    const write = (this.writes.get(chatId) ?? Promise.resolve())
      .then(async () => {
        await chat.loaded;
        await this.host.storage.write(`${path}.tmp`, JSON.stringify({ v: FORMAT, records: chat.records }), chat.userId);
        await this.host.storage.move(`${path}.tmp`, path, chat.userId);
      })
      .catch((error: unknown) => this.host.log("warn", `[LumiRPEngine] chat ${chatId}: diagnostics weren't saved (${messageOf(error)})`, chat.userId));
    this.writes.set(chatId, write);
    void write.finally(() => {
      if (this.writes.get(chatId) === write) this.writes.delete(chatId);
    });
  }

  /** Writes what is scheduled now and waits for every write (tests; shutdown). */
  async settle(): Promise<void> {
    for (const [chatId, timer] of this.timers) {
      clearTimeout(timer);
      this.timers.delete(chatId);
      this.save(chatId);
    }
    while (this.writes.size > 0) await Promise.all([...this.writes.values()]);
  }
}

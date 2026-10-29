// Diagnostics (DESIGN §6.9): each chat's ring of records (turns, their steps with their model calls,
// errors, the engine run's section fills, slow requests, agent calls), kept in
// `userStorage/runs/<chatId>/diagnostics.json` and mirrored as lines to the user's `diagnostics.log`
// with their level and turn; and the in-flight activity line, pushed to the chat's frontends as
// `lre.activity`. An agent call's text is a blob (DESIGN §4.4) only its record points to: when
// transcript retention passes, the record lets go of it and the sweep removes it.
//
// The records are GM-level and only ever answer `lre.diag`; the activity line carries a step's label
// (or, for an agent at work outside a turn, the GM assistant answering, its label) and, while an
// agent turn runs, one row per agent at work with its role's label and its tokens so far (the live
// trace), and nothing else, so it is safe on the player's surfaces.

import { agentLabel } from "../shared/agent-settings";
import type { ChatId, UserId } from "../shared/ids";
import { runDir } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { Activity, ActivityAgent, DiagAgentCall, DiagCall, DiagLevel, DiagPhase, DiagRecord, DiagSection, DiagStatus, DiagUsage } from "../shared/diagnostics";
import { callLabel, DIAG_AGENT_OUTCOMES, DIAG_PHASES, DIAG_RING, DIAG_USAGE_FIELDS, SLOW_MS, STEP_LABEL, suggestFix } from "../shared/diagnostics";
import type { Limit } from "../shared/minds";
import { limitOf } from "../shared/minds";
import { PROTOCOL_VERSION } from "../shared/protocol";
import { blobHash, DAY_MS, isBlobHash, RETENTION_DEFAULTS } from "../shared/stores";
import type { TimeoutFired } from "../shared/timeouts";
import type { BlobStore } from "./agents/blobs";
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

export interface DiagOptions {
  now?: () => number;
  /** Records kept per chat, the oldest going first: one number, or the user's (Settings → Diagnostics). */
  ring?: number | ((userId: UserId) => number);
  flushMs?: number;
  /** Where agent calls' texts are kept; without it an agent call is recorded with no text. */
  blobs?: BlobStore;
  /** Days an agent call's text is kept after the call (Settings → Agents → Retention); the default's without it. */
  transcriptDays?: (userId: UserId) => Limit;
}

interface OpenStep {
  at: DiagAt;
  phase: DiagPhase;
  step: string;
  start: number;
  calls: DiagCall[];
  label: string;
  /** The purposes of the calls it takes wherever it sits among the steps under way (a side step's, such as the minds' beside the read); absent: the calls of no other step. */
  purposes?: ReadonlySet<string>;
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
const KINDS: readonly DiagRecord["kind"][] = ["step", "error", "sections", "slow", "turn", "agent"];

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

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** A usage as stored or given: the four counts, the cache write when the provider said it, and the estimated ones named only when there are some; undefined when it isn't one. */
function usageOf(raw: unknown): DiagUsage | null | undefined {
  if (raw === null) return null;
  if (!isRecord(raw)) return undefined;
  const { in: sent, cachedIn, cacheWrite, out, reasoningOut, estimated } = raw;
  if (!isCount(sent) || !isCount(cachedIn) || !isCount(out) || !isCount(reasoningOut)) return undefined;
  const guessed = Array.isArray(estimated) ? DIAG_USAGE_FIELDS.filter((f) => estimated.includes(f)) : [];
  return { in: sent, cachedIn, ...(isCount(cacheWrite) ? { cacheWrite } : {}), out, reasoningOut, ...(guessed.length > 0 ? { estimated: guessed } : {}) };
}

/** An agent call as stored, or null when it doesn't read as one; a malformed tool list or text ref is left out of it. */
function agentCallOf(raw: unknown): DiagAgentCall | null {
  if (!isRecord(raw)) return null;
  const { role, connection, model, ms, error, tools, text } = raw;
  const usage = usageOf(raw.usage);
  const outcome = DIAG_AGENT_OUTCOMES.find((o) => o === raw.outcome);
  if (typeof role !== "string" || typeof connection !== "string" || typeof model !== "string" || !isCount(ms) || outcome === undefined || usage === undefined) return null;
  return { role, connection, model, usage, ms, outcome, ...(typeof error === "string" ? { error } : {}), ...(Array.isArray(tools) ? { tools: tools.filter((t): t is string => typeof t === "string") } : {}), ...(isBlobHash(text) ? { text } : {}) };
}

/** A stored record, or null when it doesn't read as one. A malformed agent call is dropped from its record, which stays; files written before agent calls read as they did. */
function storedRecord(raw: unknown): DiagRecord | null {
  if (!isDiagRecord(raw)) return null;
  if (raw.agent === undefined) return raw;
  const { agent, ...rest } = raw;
  const call = agentCallOf(agent);
  return call ? { ...rest, agent: call } : rest;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Why a step failed: the first of its purposes whose last call went wrong (a step that makes calls of
 * several purposes, as the minds' post phase does, fails when any one of them does, whichever ran
 * last), or null when each purpose's last call was fine.
 */
function callFailure(calls: readonly DiagCall[]): { reason: string; fix?: string } | null {
  // A spared call's failure is shown on its step's line, but the run goes on without it.
  const lasts = new Map<string, DiagCall>();
  for (const c of calls) if (c.spared !== true) lasts.set(c.purpose, c);
  for (const last of lasts.values()) {
    let reason: string | null = null;
    if (!last.ok) reason = `${last.purpose} call failed: ${last.error ?? "no reason given"}`;
    else if (last.finishReason === "length") reason = `${last.purpose} answer cut off at ${last.maxTokens ?? "max"} tokens (finish_reason length)`;
    else if (last.tokensOut === 0) reason = `${last.purpose} answer was empty`;
    if (reason === null) continue;
    const fix = suggestFix(reason, last);
    return { reason, ...(fix ? { fix } : {}) };
  }
  return null;
}

export class Diagnostics {
  private readonly chats = new Map<ChatId, ChatDiag>();
  private readonly writes = new Map<ChatId, Promise<void>>();
  private readonly timers = new Map<ChatId, ReturnType<typeof setTimeout>>();
  /** Steps under way, per user, innermost last: a model call belongs to the user's innermost step. */
  private readonly open = new Map<UserId, OpenStep[]>();
  private readonly turns = new Map<ChatId, Turn>();
  private readonly activities = new Map<ChatId, Activity>();
  /** Agents at work in each chat outside any turn (the GM assistant answering), latest last. */
  private readonly working = new Map<ChatId, { id: string; label: string; since: number }[]>();
  /** The agents at work in each chat's turn (the live trace), by agent id, in the order they started: each its role and the tokens it has spent so far. */
  private readonly atWork = new Map<ChatId, Map<string, { role: string; tokens: { in: number; out: number } }>>();
  /** What the agents of each role that stopped have spent in the chat's turn, by role: the role's row counts them. */
  private readonly roleSpent = new Map<ChatId, Map<string, { in: number; out: number }>>();
  /** Model calls under way per user, by purpose, latest last. */
  private readonly inflight = new Map<UserId, string[]>();
  /** Whether the chat has an engine run or reply read Cancel can stop (the ledger's, `LedgerService.cancel`): what the running line offers Cancel by. */
  cancellable: (chatId: ChatId) => boolean = () => false;
  /**
   * Agent turns (INC2-SPEC lane T1), by `chat \0 turn`: their roles' failures follow the roles' own
   * settings, and only a fatal record stops one (`failure`). Each is kept while its turn is under way:
   * until its activity ends (`end`), or its run ends outside one (`agentTurnDone`).
   */
  private readonly agentTurns = new Set<string>();
  /** The order each model call came in (`callMark`, `failedSince`); calls read back from a file have none. */
  private readonly callOrder = new WeakMap<DiagCall, number>();
  private callCount = 0;
  private seq: number;

  constructor(
    private readonly host: DiagHost,
    private readonly options: DiagOptions = {},
  ) {
    this.seq = this.now();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private path(chatId: ChatId): string {
    return `${runDir(chatId)}diagnostics.json`;
  }

  /**
   * The chat's stored records, oldest first, after any write of them under way; none when it has no
   * file or a damaged one (set aside). A storage error is thrown: the sweep must not read a chat it
   * couldn't read as one that keeps no text.
   */
  private async stored(chatId: ChatId, userId: UserId): Promise<DiagRecord[]> {
    await this.writes.get(chatId);
    const raw = await readStoredJson(this.host, this.path(chatId), userId, "diagnostics", (r) => isRecord(r) && r.v === FORMAT && Array.isArray(r.records));
    if (!isRecord(raw) || !Array.isArray(raw.records)) return [];
    return raw.records.flatMap((r) => storedRecord(r) ?? []);
  }

  private chat(chatId: ChatId, userId: UserId): ChatDiag {
    const known = this.chats.get(chatId);
    if (known?.userId === userId) return known;
    const chat: ChatDiag = { userId, records: [], loaded: Promise.resolve() };
    chat.loaded = (async () => {
      // A file that can't be read leaves the chat starting afresh, as before.
      chat.records = [...(await this.stored(chatId, userId).catch((): DiagRecord[] => [])), ...chat.records];
      this.tidy(chat);
    })();
    this.chats.delete(chatId);
    this.chats.set(chatId, chat);
    if (this.chats.size > 128) this.chats.delete(this.chats.keys().next().value ?? "");
    return chat;
  }

  private ring(userId: UserId): number {
    const ring = this.options.ring;
    return typeof ring === "function" ? ring(userId) : (ring ?? DIAG_RING);
  }

  /** When an agent call must have ended for its record to keep its text now: transcript retention's days back ("none": always). */
  private textSince(userId: UserId): number {
    return this.now() - limitOf(this.options.transcriptDays?.(userId) ?? RETENTION_DEFAULTS.transcriptDays) * DAY_MS;
  }

  /**
   * Keeps the chat's records within the user's ring, the oldest going first, and drops each agent
   * call's text ref once transcript retention has passed since the call, so nothing here points at
   * the blob any more and the sweep removes it; the records themselves stay. Whether anything changed.
   */
  private tidy(chat: ChatDiag): boolean {
    const ring = this.ring(chat.userId);
    let changed = chat.records.length > ring;
    if (changed) chat.records.splice(0, chat.records.length - ring);
    const since = this.textSince(chat.userId);
    for (const [i, r] of chat.records.entries()) {
      if (r.agent?.text === undefined || r.end >= since) continue;
      const agent = { ...r.agent };
      delete agent.text;
      chat.records[i] = { ...r, agent };
      changed = true;
    }
    return changed;
  }

  /** The chat's records, oldest first, once its stored ones are read. */
  async records(chatId: ChatId, userId: UserId): Promise<DiagRecord[]> {
    const chat = this.chat(chatId, userId);
    await chat.loaded;
    if (this.tidy(chat)) this.schedule(chatId);
    return [...chat.records];
  }

  /**
   * The hashes of the agent-call texts the chat's records keep now, within the ring and transcript
   * retention: Diagnostics' references for the sweep, and the only texts `lre.diag`'s `text` reads.
   * A chat not in memory is read from its stored file and left out of memory; a storage error there
   * is thrown, never read as a chat that keeps none.
   */
  async transcripts(chatId: ChatId, userId: UserId): Promise<string[]> {
    const known = this.chats.get(chatId);
    let records: readonly DiagRecord[];
    if (known?.userId === userId) {
      await known.loaded;
      if (this.tidy(known)) this.schedule(chatId);
      records = known.records;
    } else records = (await this.stored(chatId, userId)).slice(-this.ring(userId));
    const since = this.textSince(userId);
    return [...new Set(records.flatMap((r) => (r.agent?.text !== undefined && r.end >= since ? [r.agent.text] : [])))];
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
    const agent = record.agent ? `, ${record.agent.model} ${record.agent.usage?.in ?? "?"}→${record.agent.usage?.out ?? "?"} ${record.agent.outcome}${record.agent.tools?.length ? `, tools ${record.agent.tools.join(", ")}` : ""}` : "";
    this.host.log(record.level === "debug" ? "debug" : record.level, `[LumiRPEngine] ${at.chatId ? `chat ${at.chatId} ` : ""}${record.kind} ${where} ${record.status} in ${Math.round(record.ms)} ms${record.reason ? `: ${record.reason}` : ""}${calls}${agent}`, at.userId, at.turn ?? undefined);
    if (!at.chatId) return full;
    const chat = this.chat(at.chatId, at.userId);
    chat.records.push(full);
    const ring = this.ring(at.userId);
    if (chat.records.length > ring) chat.records.splice(0, chat.records.length - ring);
    // An agent call is informational; in an agent turn only its fatal records fail it (`failure`).
    if (record.status === "failed" && at.turn && record.kind !== "agent" && (record.fatal === true || !this.agentTurns.has(`${at.chatId}\u0000${at.turn}`))) {
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

  /** The turn is over; it failed if any of its steps did, or `outcome` says so. An agent turn's policy goes with it. */
  end(at: DiagAt, outcome: DiagVerdict = null): void {
    const turn = this.turns.get(at.chatId);
    if (!turn || turn.at.turn !== at.turn) return;
    this.turns.delete(at.chatId);
    if (at.turn !== null) this.agentTurns.delete(`${at.chatId}\u0000${at.turn}`);
    this.atWork.delete(at.chatId);
    this.roleSpent.delete(at.chatId);
    const end = this.now();
    const failed = outcome?.status === "failed" ? (outcome.reason ?? "failed") : turn.failed;
    const status: DiagStatus = failed !== null ? "failed" : (outcome?.status ?? "ok");
    const reason = failed !== null ? (outcome?.status === "failed" ? outcome.reason : `step ${failed} failed`) : outcome?.reason;
    this.add(at, { kind: "turn", level: status === "failed" ? "warn" : "info", turn: at.turn, phase: null, step: "turn", status, start: turn.start, end, ms: end - turn.start, ...(reason ? { reason } : {}), ...(outcome?.fix ? { fix: outcome.fix } : {}) });
    // The line names only the step that failed, never a reason or a model's error: the record keeps those.
    const step = turn.failed?.split("/").at(-1);
    if (failed !== null) this.activities.set(at.chatId, { chatId: at.chatId, turn: at.turn, state: "failed", label: step ? `Failed: ${STEP_LABEL[step]?.replace("…", "") ?? step}` : "Failed", since: end });
    else this.activities.delete(at.chatId);
    this.send(at.chatId, at.userId);
  }

  /**
   * Times `fn` as a step: ok, the verdict `judge` gives its value, or failed with what it threw
   * (rethrown). A step whose last model call failed, was cut off or came back empty failed, whatever
   * it returned: that is how a step that falls back quietly shows. With `purposes`, the calls of those
   * purposes are this step's even while another step runs inside or beside it (one whose work runs
   * side by side with its parent's), and no other call is.
   */
  async step<T>(at: DiagAt, phase: DiagPhase, step: string, fn: () => Promise<T>, judge?: (value: T) => DiagVerdict, purposes?: readonly string[]): Promise<T> {
    const open: OpenStep = { at, phase, step, start: this.now(), calls: [], label: STEP_LABEL[step] ?? STEP_LABEL[phase] ?? "Working…", ...(purposes ? { purposes: new Set(purposes) } : {}) };
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

  /** The turn is an agent turn (INC2-SPEC lane T1): from now on only its fatal records stop it (`failure`). */
  agentTurn(at: DiagAt): void {
    if (at.turn !== null) this.agentTurns.add(`${at.chatId}\u0000${at.turn}`);
  }

  /** The agent turn's run ended with no activity of its own to end (a Retry read's or a Re-read edit's, one let go or dropped): its policy goes with it. */
  agentTurnDone(at: DiagAt): void {
    if (at.turn !== null) this.agentTurns.delete(`${at.chatId}\u0000${at.turn}`);
  }

  /** An agent turn's own failure: the role that stopped it under `stop`, its time running out, or its orchestration. The turn stops on it, the engine-failed card saying `step` and why. */
  fatal(at: DiagAt, phase: DiagPhase, step: string, reason: string): void {
    const t = this.now();
    const fix = suggestFix(reason);
    this.add(at, { kind: "step", level: "warn", turn: at.turn, phase, step, status: "failed", start: t, end: t, ms: 0, reason, ...(fix ? { fix } : {}), fatal: true });
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

  /** One model call: it joins the user's innermost step under way that takes its purpose, else the innermost that takes any, or stands alone. */
  call(userId: UserId, call: DiagCall): void {
    this.callOrder.set(call, ++this.callCount);
    const list = this.inflight.get(userId);
    const i = list?.lastIndexOf(call.purpose) ?? -1;
    if (list && i >= 0) list.splice(i, 1);
    if (list?.length === 0) this.inflight.delete(userId);
    const stack = this.open.get(userId) ?? [];
    const open = stack.findLast((s) => s.purposes?.has(call.purpose) === true) ?? stack.findLast((s) => s.purposes === undefined);
    if (open) {
      open.calls.push(call);
      this.publishUser(userId);
      return;
    }
    const t = this.now();
    const failure = callFailure([call]);
    this.add({ chatId: null, userId, turn: null }, { kind: "step", level: failure ? "warn" : "debug", turn: null, phase: null, step: call.purpose, status: failure ? "failed" : "ok", start: t - call.ms, end: t, ms: call.ms, calls: [call], ...(failure ? { reason: failure.reason } : {}) });
  }

  /**
   * One call an agent made (AGENT-LOOP-PLAN §3.5), a record of its own: its role, connection, model,
   * usage, time, outcome and the tools it called by name. With `text` (its messages and answer) and a
   * blob store, the text is stored as a blob and the record keeps its hash, which `lre.diag`'s `text`
   * reads behind the Diagnostics curtain until transcript retention passes; with retention at 0 days
   * nothing is stored. The record is there before the blob is written, so a sweep meanwhile counts it
   * referenced; a text that couldn't be written reads as gone.
   *
   * Informational: a failed agent call never fails a classic turn or halts its engine run
   * (`failure`), and never touches the activity line, which carries a step's label only (tool calls
   * can name what the player hasn't met).
   */
  async agentCall(at: DiagAt, phase: DiagPhase | null, call: Omit<DiagAgentCall, "text">, text?: string): Promise<DiagRecord> {
    const end = this.now();
    const blobs = this.options.blobs;
    // A retention of 0 days keeps no text (it would expire as it is recorded), so none is stored.
    const hash = text !== undefined && blobs && this.textSince(at.userId) < end ? blobHash(text) : undefined;
    const status: DiagStatus = call.outcome === "ok" ? "ok" : call.outcome === "cancelled" ? "skipped" : "failed";
    const reason = call.error ?? (call.outcome === "cancelled" ? "cancelled" : call.outcome === "refused" ? "refused by the provider" : undefined);
    const fix = status === "failed" && reason ? suggestFix(reason) : undefined;
    const usage = usageOf(call.usage) ?? null;
    const agent: DiagAgentCall = { role: call.role, connection: call.connection, model: call.model, usage, ms: call.ms, outcome: call.outcome, ...(call.error !== undefined ? { error: call.error } : {}), ...(call.tools && call.tools.length > 0 ? { tools: [...call.tools] } : {}), ...(hash ? { text: hash } : {}) };
    const record = this.add(at, { kind: "agent", level: status === "failed" ? "warn" : "info", turn: at.turn, phase, step: call.role, status, start: end - call.ms, end, ms: call.ms, ...(reason ? { reason } : {}), ...(fix ? { fix } : {}), agent });
    if (hash !== undefined && text !== undefined && blobs) await blobs.put(at.userId, text).catch((error: unknown) => this.host.log("warn", `[LumiRPEngine] chat ${at.chatId}: the ${call.role} agent call's text wasn't stored (${messageOf(error)})`, at.userId, at.turn ?? undefined));
    return record;
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
   * failed, was cut off or came back empty, or a step that failed. An attempt made again after a
   * transient failure is the next attempt's; a Decision call the helper answered after is the
   * helper's; a lore lookup a later call of its step answered after doesn't count.
   */
  failure(at: DiagAt): { step: string; reason: string } | null {
    // An agent turn stops on its own failures alone: its roles' failed calls follow their settings (`fatal`).
    const agent = at.turn !== null && this.agentTurns.has(`${at.chatId}\u0000${at.turn}`);
    for (const r of this.chats.get(at.chatId)?.records ?? []) {
      // An agent call is informational: a turn's agents fail it only through the orchestrator's fatal record.
      if (r.turn !== at.turn || r.kind === "agent") continue;
      if (agent) {
        if (r.fatal) return { step: r.step, reason: r.reason ?? "it failed" };
        continue;
      }
      const calls = r.calls ?? [];
      for (const [i, c] of calls.entries()) {
        const failed = c.retried ? null : callFailure([c]);
        if (!failed) continue;
        const answeredAfter = calls.slice(i + 1).some((d) => d.purpose === c.purpose && !d.retried && !callFailure([d]) && (c.lookup === true || (c.via === "decision" && d.via === "helper")));
        if (answeredAfter) continue;
        const retries = c.retries ?? 0;
        return { step: c.purpose, reason: retries > 0 ? `${failed.reason} (after ${retries} ${retries === 1 ? "retry" : "retries"})` : failed.reason };
      }
      if (r.status === "failed") return { step: r.step, reason: r.reason ?? "it failed" };
    }
    return null;
  }

  /** Where the model calls stand now: `failedSince` reads the calls made after it. */
  callMark(): number {
    return this.callCount;
  }

  /**
   * The first of a turn's model calls since `mark` for one of `purposes` that failed as a classic
   * turn stops on it (`failure`): failed, cut off or empty, not made again after a transient failure,
   * and not answered after by a later call of its step. A step's calls count while it is still under
   * way. What a prompt-only role's classic call left, which the role's `onFail` answers.
   */
  failedSince(at: DiagAt, mark: number, purposes: readonly string[]): { step: string; reason: string } | null {
    const recorded = (this.chats.get(at.chatId)?.records ?? []).filter((r) => r.turn === at.turn && r.kind !== "agent").flatMap((r) => r.calls ?? []);
    const open = (this.open.get(at.userId) ?? []).filter((s) => s.at.chatId === at.chatId && s.at.turn === at.turn).flatMap((s) => s.calls);
    const order = (c: DiagCall): number => this.callOrder.get(c) ?? 0;
    const calls = [...recorded, ...open].filter((c) => order(c) > mark && purposes.includes(c.purpose)).sort((a, b) => order(a) - order(b));
    for (const [i, c] of calls.entries()) {
      const failed = c.retried ? null : callFailure([c]);
      if (!failed) continue;
      if (calls.slice(i + 1).some((d) => d.purpose === c.purpose && !d.retried && !callFailure([d]) && (c.lookup === true || (c.via === "decision" && d.via === "helper")))) continue;
      return { step: c.purpose, reason: failed.reason };
    }
    return null;
  }

  /** What stopped a turn, when anything did: its first fatal record (a role under `stop`, its main agent's failure, its time running out); null when nothing has. */
  stopped(at: DiagAt): { step: string; reason: string } | null {
    if (at.turn === null) return null;
    const r = (this.chats.get(at.chatId)?.records ?? []).find((x) => x.turn === at.turn && x.fatal === true);
    return r ? { step: r.step, reason: r.reason ?? "it failed" } : null;
  }

  /** The turn under `from` goes on as `to` (a prepared turn a generation took): its records and its activity line. */
  rename(chatId: ChatId, from: string, to: string): void {
    for (const r of this.chats.get(chatId)?.records ?? []) if (r.turn === from) r.turn = to;
    if (this.agentTurns.delete(`${chatId}\u0000${from}`)) this.agentTurns.add(`${chatId}\u0000${to}`);
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
   * minds counted), else the innermost step's label, else the turn's resting one; while an agent works
   * there outside a turn, its label; after a failed turn, the failure.
   */
  activityOf(chatId: ChatId): Activity | null {
    const turn = this.turns.get(chatId);
    if (turn) {
      const open = [...(this.open.get(turn.at.userId) ?? [])].reverse().find((s) => s.at.chatId === chatId);
      const asking = open ? this.inflight.get(turn.at.userId)?.at(-1) : undefined;
      const label = asking !== undefined ? callLabel(asking, this.inflight.get(turn.at.userId)?.filter((p) => p === asking).length ?? 1) : (open?.label ?? turn.rest);
      const agents = this.rolesAtWork(chatId);
      return { chatId, turn: turn.at.turn, state: "running", label, since: turn.start, ...(this.cancellable(chatId) ? { cancellable: true } : {}), ...(agents.length > 0 ? { agents } : {}) };
    }
    const agent = this.working.get(chatId)?.at(-1);
    if (agent) return { chatId, turn: null, state: "running", label: agent.label, since: agent.since };
    return this.activities.get(chatId) ?? null;
  }

  /**
   * An agent of the chat's turn at work (`AgentTurn.watch`), with the tokens it has spent so far, or,
   * with `spent` null, stopped. The live trace shows one row per role at work, never one per agent:
   * how many agents a role runs would tell how many people it works for (choosers off-screen, minds
   * the player character can't see), which classic's line never told. A role's row holds all its
   * agents' tokens this turn, and shows while one of them works; the rows go with the turn.
   */
  agentAtWork(chatId: ChatId, userId: UserId, agent: { id: string; role: string }, spent: { in: number; out: number } | null): void {
    const rows = this.atWork.get(chatId) ?? new Map<string, { role: string; tokens: { in: number; out: number } }>();
    const stopped = spent === null ? rows.get(agent.id) : undefined;
    if (stopped) {
      const done = this.roleSpent.get(chatId) ?? new Map<string, { in: number; out: number }>();
      const before = done.get(stopped.role) ?? { in: 0, out: 0 };
      done.set(stopped.role, { in: before.in + stopped.tokens.in, out: before.out + stopped.tokens.out });
      this.roleSpent.set(chatId, done);
    }
    if (spent === null) rows.delete(agent.id);
    else rows.set(agent.id, { role: agent.role, tokens: { in: spent.in, out: spent.out } });
    if (rows.size === 0) this.atWork.delete(chatId);
    else this.atWork.set(chatId, rows);
    this.publish(chatId, userId);
  }

  /** The live trace's rows: each role with an agent at work, in the order its first started, under its label, with what all its agents spent this turn. */
  private rolesAtWork(chatId: ChatId): ActivityAgent[] {
    const done = this.roleSpent.get(chatId);
    const rows = new Map<string, ActivityAgent>();
    for (const a of this.atWork.get(chatId)?.values() ?? []) {
      const row = rows.get(a.role) ?? { id: a.role, label: agentLabel(a.role), tokens: { ...(done?.get(a.role) ?? { in: 0, out: 0 }) } };
      row.tokens = { in: row.tokens.in + a.tokens.in, out: row.tokens.out + a.tokens.out };
      rows.set(a.role, row);
    }
    return [...rows.values()];
  }

  /**
   * An agent starts work in the chat outside any turn (the GM assistant answering, `id` its run):
   * while no turn runs there, the line shows `label` and nothing else, since what it reads and calls
   * can name what the player hasn't met. Its records are its calls' (`agentCall`).
   */
  agentWorking(chatId: ChatId, userId: UserId, id: string, label: string): void {
    this.working.set(chatId, [...(this.working.get(chatId) ?? []).filter((w) => w.id !== id), { id, label, since: this.now() }]);
    this.send(chatId, userId);
  }

  /** That agent's work in the chat ended: the line shows again what it would without it. */
  agentDone(chatId: ChatId, userId: UserId, id: string): void {
    const rest = (this.working.get(chatId) ?? []).filter((w) => w.id !== id);
    if (rest.length > 0) this.working.set(chatId, rest);
    else this.working.delete(chatId);
    this.send(chatId, userId);
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
        this.tidy(chat);
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

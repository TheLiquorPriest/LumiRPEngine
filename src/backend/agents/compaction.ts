// The main agent's session (INC2-SPEC C14; AGENT-LOOP-PLAN §3.3, §4, §7.9), over R2's `Sessions`:
// what a main-agent turn reads of it, and how it stays short.
//
// - **What it reads:** the session at the turn's parent, walked along the chat's active chain
//   (`sessionAt`), so a swipe, a Re-run and a Lumiverse Branch read it as it stood there with no
//   remapping. The main agent's history is its own messages (`by: "main"`), every one of them: nothing
//   of it is held back by the knowledge it was made under (an older message's `knowledge` and `files`
//   are read and ignored). A fixed pipeline's segments hold a digest of their turns for continuity,
//   which the main agent never reads: its turn task's digest covers those turns instead
//   (`turn-task.ts`), as it covers classic turns.
// - **Compaction:** once its own messages pass Settings → Agents → Compaction's tokens, the turn
//   summarizes all but its latest turns (`keepTurns`) in one call with the compaction instructions,
//   before its first stage; the summarize tool does the same when the main agent asks. The summary is
//   a base the session reads from, and the session it replaced is archived whole beside it.
// - **Rollback:** GM → Workspace asks for one (`lre.workspace rollback`), kept in the chat's agent
//   metadata; the next agent turn whose session stands on that compaction brings the archived span
//   back, marked as restored, so it offers no rollback of its own. Either lands on the record of the
//   turn that makes it (`Rebase`), at its close, so no earlier record changes.
// - **GM → Workspace** reads the session whole (`sessionView`): every message and the summary, each
//   message saying whether it is the main agent's own, which is what it reads.

import type { ChatId, UserId } from "../../shared/ids";
import { isRecord, type JsonObject } from "../../shared/json";
import { MAIN_TEXT } from "../../shared/main-agent-prompts";
import type { PromptTexts } from "../../shared/prompts";
import type { SessionMessageView, SessionView } from "../../shared/protocol";
import type { Tombstone } from "../../shared/ledger";
import type { ChainMessage } from "../../engine/ledger/chain";
import { activeRecord } from "../../engine/ledger/path";
import { tokensOf } from "../book";
import { renderPrompt } from "../prompts";
import type { Runtime } from "../runtime";
import type { AgentHistoryMessage, AgentReply } from "./runtime";
import { type Rebase, recordSessionOf, type SessionMessage, type SessionParts, type SessionRefs, sessionAt } from "./sessions";
import { chatHead } from "./tools/workspace";

/** What marks a message of the main agent's own in a session segment. */
export const MAIN_BY = "main";

/** A message of the main agent's own, as its segments keep it: a turn's task or a stage's message, and what it did there. A type, not an interface, so it is JSON a segment stores. */
export type MainMessage = {
  role: "user" | "assistant";
  content: string;
  by: typeof MAIN_BY;
};

export function isMainMessage(m: SessionMessage): m is SessionMessage & MainMessage {
  return m.by === MAIN_BY && (m.role === "user" || m.role === "assistant") && typeof m.content === "string";
}

/** The session a main-agent turn reads: where it stands on the chain (or after the turn's own compaction or rollback), turn by turn. */
export interface MainSession extends SessionParts {
  refs: SessionRefs;
}

export async function readSession(rt: Pick<Runtime, "sessions">, userId: UserId, refs: SessionRefs): Promise<MainSession> {
  return { refs, ...(await rt.sessions.parts(userId, refs)) };
}

/** Where a session stands once a turn's compaction or rollback lands: on the base it made. */
export function rebasedRefs(rebase: Rebase): SessionRefs {
  return { base: rebase.summary, segments: [], archived: rebase.archived };
}

/** What of a session the main agent reads, in tokens, estimated: its summary and each message of its own. */
export function sessionTokens(session: Pick<SessionParts, "summary" | "segments">): number {
  let tokens = session.summary === null ? 0 : tokensOf(session.summary);
  for (const segment of session.segments) for (const m of segment.messages) if (isMainMessage(m)) tokens += tokensOf(m.content);
  return tokens;
}

/** The main agent's history from its session: the summary, then its own messages in order, a run of one role's messages sent as one. */
export function historyOf(session: Pick<SessionParts, "summary" | "segments">, texts: PromptTexts): AgentHistoryMessage[] {
  const out: AgentHistoryMessage[] = [];
  const push = (role: "user" | "assistant", text: string): void => {
    const last = out.at(-1);
    if (last?.role === role) last.text = `${last.text}\n\n${text}`;
    else out.push({ role, text });
  };
  if (session.summary !== null) push("user", renderPrompt(MAIN_TEXT.summary, texts, { summary: session.summary }));
  for (const segment of session.segments) for (const m of segment.messages) if (isMainMessage(m)) push(m.role, m.content);
  return out;
}

/**
 * The main agent's last turn on `chain` (the chain before a turn): the latest reply whose record's
 * segment of the session holds a message of its own (`main`: those segments' hashes). Where none does
 * but the session was summarized, the reply whose record holds the summary, which stands for what
 * came before. Null when the main agent has no turn on the chain: a fresh session.
 */
export function lastMainTurn(chain: readonly ChainMessage[], tombstones: readonly Tombstone[], refs: SessionRefs, main: ReadonlySet<string>): number | null {
  let based: number | null = null;
  for (let i = chain.length - 1; i >= 0; i--) {
    const m = chain[i];
    const rec = m && !m.isUser ? activeRecord(m, tombstones) : null;
    if (!rec) continue;
    const session = recordSessionOf(rec);
    if (session.segment !== undefined && main.has(session.segment)) return i;
    if (based === null && refs.base !== null && session.summary === refs.base) based = i;
  }
  return based;
}

/** What a compaction made: the turn's rebase, the session it reads from now, and how many turns it folded and kept whole. */
export interface Compacted {
  rebase: Rebase;
  session: MainSession;
  summary: string;
  folded: number;
  kept: number;
}

/**
 * Compacts `session`: all but its latest `keep` turns become one summary, which `summarize` writes
 * (one call: the compaction instructions as its system prompt, the summary so far and the turns to
 * fold as its message), and the session it replaced is archived whole for a rollback; both are held
 * for `holder` until the turn's record carries them. Only the main agent's own messages are
 * summarized. Null when the session holds no more than `keep` turns, or none of its own to fold;
 * `failed` with the call's reason when it wrote none.
 */
export async function compact(rt: Pick<Runtime, "sessions">, input: { userId: UserId; holder: string; session: MainSession; keep: number; texts: PromptTexts; summarize: (system: string, message: string) => Promise<AgentReply> }): Promise<Compacted | { failed: string } | null> {
  const { session, keep, texts } = input;
  const folded = session.segments.slice(0, Math.max(0, session.segments.length - keep));
  const read = folded.map((segment) => segment.messages.filter(isMainMessage));
  if (read.every((messages) => messages.length === 0)) return null;
  const none = renderPrompt(MAIN_TEXT.none, texts, {});
  const turns = read.flatMap((messages) => (messages.length === 0 ? [] : [messages.map((m) => `${m.role}: ${m.content}`).join("\n")])).join("\n\n");
  const reply = await input.summarize(renderPrompt(MAIN_TEXT.compaction, texts, { keep: String(keep) }), renderPrompt(MAIN_TEXT.compactionInput, texts, { summary: session.summary ?? none, turns }));
  const summary = reply.text.trim();
  if (reply.status !== "answered" || summary === "") return { failed: reply.reason ?? none };
  const rebase = await rt.sessions.compact(input.userId, input.holder, session.refs, summary, keep);
  return { rebase, session: await readSession(rt, input.userId, rebasedRefs(rebase)), summary, folded: folded.length, kept: session.segments.length - folded.length };
}

/**
 * The rollback GM → Workspace asked for, made by the turn whose session stands at `at`: the span the
 * compaction archived comes back, held for `holder` until the turn's record carries it. Null when
 * none was asked for, or it was asked for a compaction this turn's session doesn't stand on (another
 * branch's, or one already rolled back on this chain).
 */
export async function rolledBack(rt: Pick<Runtime, "sessions" | "chatAgents">, input: { chatId: ChatId; userId: UserId; holder: string; at: SessionRefs }): Promise<Rebase | null> {
  const asked = (await rt.chatAgents.get(input.chatId, input.userId)).rollback;
  if (!asked || input.at.base !== asked.base || input.at.archived !== asked.archived) return null;
  return rt.sessions.rollback(input.userId, input.holder, input.at, asked.archived);
}

/** Where the main session stands at the chat's head, read without the ledger's queue, turn by turn; null for a chat that plays no world. */
async function headSession(rt: Runtime, chatId: ChatId, userId: UserId): Promise<MainSession | null> {
  const head = await chatHead(rt, chatId, userId);
  return head ? readSession(rt, userId, sessionAt(head.core.chain(head.observed), head.core.journal.tombstones)) : null;
}

/** Whether the session's latest base is a compaction a rollback may undo: not none, and not a span a rollback restored. */
function undoable(session: MainSession): boolean {
  return session.refs.base !== null && session.refs.archived !== null && !session.restored;
}

/** Which reply on the chain (1-based) holds each segment, by its hash. */
function segmentTurns(chain: readonly ChainMessage[], tombstones: readonly Tombstone[]): Map<string, number> {
  const out = new Map<string, number>();
  let turn = 0;
  for (const m of chain) {
    if (m.isUser) continue;
    turn++;
    const segment = recordSessionOf(activeRecord(m, tombstones)).segment;
    if (segment !== undefined) out.set(segment, turn);
  }
  return out;
}

/** A message of the session as GM → Workspace shows it, `main` when it is the main agent's own (what it reads); nothing for one that isn't a message (records come from any metadata writer). */
function messageView(m: SessionMessage): SessionMessageView[] {
  if ((m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return [];
  const engine = isRecord(m.engine) ? m.engine : null;
  const list = (part: "roles" | "committed"): JsonObject[] => {
    const value = engine?.[part];
    return Array.isArray(value) ? value.filter((v): v is JsonObject => isRecord(v)) : [];
  };
  return [
    {
      role: m.role,
      text: m.content,
      main: isMainMessage(m),
      ...(engine ? { engine: { roles: list("roles").map((r) => ({ role: String(r.role ?? ""), via: String(r.via ?? ""), ok: r.ok === true })), committed: list("committed").map((c) => ({ role: String(c.role ?? ""), key: String(c.key ?? ""), type: String(c.type ?? "") })) } } : {}),
    },
  ];
}

/**
 * GM → Workspace's view of the main session at the chat's head (`lre.workspace session`): all of it,
 * every message saying whether it is the main agent's own (what its next turn reads), how much of it
 * the main agent reads, and its latest compaction's rollback.
 */
export async function sessionView(rt: Runtime, chatId: ChatId, userId: UserId): Promise<SessionView> {
  const head = await chatHead(rt, chatId, userId);
  if (!head) return { summary: null, turns: 0, tokens: 0, segments: [], reads: { turns: 0, tokens: 0 }, missing: 0, rollback: "none" };
  const chain = head.core.chain(head.observed);
  const session = await readSession(rt, userId, sessionAt(chain, head.core.journal.tombstones));
  const asked = (await rt.chatAgents.get(chatId, userId)).rollback;
  const rollback = !undoable(session) ? "none" : asked?.base === session.refs.base && asked.archived === session.refs.archived ? "pending" : "available";
  const turns = segmentTurns(chain, head.core.journal.tombstones);
  let tokens = session.summary === null ? 0 : tokensOf(session.summary);
  for (const segment of session.segments) for (const m of segment.messages) if (typeof m.content === "string") tokens += tokensOf(m.content);
  return {
    summary: session.summary,
    turns: session.segments.length,
    tokens,
    segments: session.segments.map((s) => ({ turn: turns.get(s.hash) ?? null, messages: s.messages.flatMap(messageView) })),
    reads: { turns: session.segments.filter((s) => s.messages.some(isMainMessage)).length, tokens: sessionTokens(session) },
    missing: session.missing.length,
    rollback,
  };
}

/**
 * Asks for a rollback of the latest compaction the session at the chat's head stands on (`lre.workspace
 * rollback`); the next agent turn's record carries it. Null when there is none to roll back.
 */
export async function askRollback(rt: Runtime, chatId: ChatId, userId: UserId): Promise<SessionView | null> {
  const session = await headSession(rt, chatId, userId);
  if (!session || !undoable(session) || session.refs.base === null || session.refs.archived === null) return null;
  await rt.chatAgents.setRollback(chatId, userId, { base: session.refs.base, archived: session.refs.archived });
  return sessionView(rt, chatId, userId);
}

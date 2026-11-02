// The main agent's session (INC2-SPEC C14; AGENT-LOOP-PLAN §3.3, §4, §7.9), over R2's `Sessions`:
// what a main-agent turn reads of it, and how it stays short.
//
// - **What it reads:** the session at the turn's parent, walked along the chat's active chain
//   (`sessionAt`), so a swipe, a Re-run and a Lumiverse Branch read it as it stood there with no
//   remapping. The main agent's history is its own messages (`by: "main"`), each kept with the
//   knowledge it was made under and the workspace files its tools read for it; a turn reads only
//   those its knowledge now takes in, and only while each file's readers still do (`SessionLens`),
//   as the GM assistant reads its thread. A message or a summary kept before its knowledge was is
//   the GM's. A fixed pipeline's segments hold a digest of their turns for continuity, which the main
//   agent never reads: its turn task's digest covers those turns instead (`turn-task.ts`), as it
//   covers classic turns.
// - **Compaction:** once what the main agent reads of its session passes Settings → Agents →
//   Compaction's tokens, the turn summarizes all but its latest turns (`keepTurns`) in one call with
//   the compaction instructions, before its first stage; the summarize tool does the same when the
//   main agent asks. Only what it reads is counted and summarized, and the summary keeps the widest
//   knowledge of what it holds. The summary is a base the session reads from, and the session it
//   replaced is archived whole beside it.
// - **Rollback:** GM → Workspace asks for one (`lre.workspace rollback`), kept in the chat's agent
//   metadata; the next agent turn whose session stands on that compaction brings the archived span
//   back, marked as restored, so it offers no rollback of its own. Either lands on the record of the
//   turn that makes it (`Rebase`), at its close, so no earlier record changes.
// - **GM → Workspace** reads the session whole (`sessionView`): every message and the summary,
//   whatever knowledge they were made under, each saying whether the main agent reads it now. Only
//   what the main agent is sent is held to its knowledge.

import { AGENT_KNOWLEDGE, type AgentKnowledge, knowledgeWithin } from "../../shared/agent-tools";
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
import { chatHead, listWorkspace } from "./tools/workspace";

/** What marks a message of the main agent's own in a session segment. */
export const MAIN_BY = "main";

/**
 * A message of the main agent's own, as its segments keep it: a turn's task or a stage's message,
 * and what it did there; the knowledge it was made under (absent in a session kept before it: the
 * GM's), and the workspace files its tools read for it. A type, not an interface, so it is JSON a
 * segment stores.
 */
export type MainMessage = {
  role: "user" | "assistant";
  content: string;
  by: typeof MAIN_BY;
  knowledge?: AgentKnowledge;
  files?: string[];
};

export function isMainMessage(m: SessionMessage): m is SessionMessage & MainMessage {
  return m.by === MAIN_BY && (m.role === "user" || m.role === "assistant") && typeof m.content === "string";
}

/** The knowledge a message of the main agent's was made under: the GM's for one kept before it was. */
export function knowledgeOf(m: SessionMessage): AgentKnowledge {
  return typeof m.knowledge === "string" && (AGENT_KNOWLEDGE as readonly string[]).includes(m.knowledge) ? (m.knowledge as AgentKnowledge) : "gm";
}

/** What of its session the main agent reads now: its knowledge, and whether it reads a message of it. */
export interface SessionLens {
  knowledge: AgentKnowledge;
  message(m: SessionMessage): boolean;
}

/** The lens of a main agent reading with `knowledge`: its own messages made under that knowledge or a narrower one. */
export function knowledgeLens(knowledge: AgentKnowledge): SessionLens {
  return { knowledge, message: (m) => isMainMessage(m) && knowledgeWithin(knowledgeOf(m), knowledge) };
}

/**
 * The lens a main-agent turn reads its session with: its own messages made under its knowledge or a
 * narrower one, and of those whose tools read a workspace file, only while the file's readers
 * (`readers`, by path) still take its knowledge in; a moved or deleted file narrows nothing.
 */
export function mainLens(knowledge: AgentKnowledge, readers: ReadonlyMap<string, AgentKnowledge>): SessionLens {
  const reads = (path: unknown): boolean => {
    const r = typeof path === "string" ? readers.get(path) : undefined;
    return r === undefined || knowledgeWithin(r, knowledge);
  };
  return { knowledge, message: (m) => isMainMessage(m) && knowledgeWithin(knowledgeOf(m), knowledge) && (Array.isArray(m.files) ? m.files : []).every(reads) };
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

/** The summary `lens` reads: none when the session has none, or the summary was made under wider knowledge. */
export function summaryOf(session: Pick<SessionParts, "summary" | "summaryKnowledge">, lens: SessionLens): string | null {
  return session.summary !== null && knowledgeWithin(session.summaryKnowledge, lens.knowledge) ? session.summary : null;
}

/** What of a session `lens` reads, in tokens, estimated: its summary and each message it reads. */
export function sessionTokens(session: Pick<SessionParts, "summary" | "summaryKnowledge" | "segments">, lens: SessionLens): number {
  const summary = summaryOf(session, lens);
  let tokens = summary === null ? 0 : tokensOf(summary);
  for (const segment of session.segments) for (const m of segment.messages) if (lens.message(m) && typeof m.content === "string") tokens += tokensOf(m.content);
  return tokens;
}

/** The main agent's history from its session, as `lens` reads it: the summary, then its own messages in order, a run of one role's messages sent as one. */
export function historyOf(session: Pick<SessionParts, "summary" | "summaryKnowledge" | "segments">, texts: PromptTexts, lens: SessionLens): AgentHistoryMessage[] {
  const out: AgentHistoryMessage[] = [];
  const push = (role: "user" | "assistant", text: string): void => {
    const last = out.at(-1);
    if (last?.role === role) last.text = `${last.text}\n\n${text}`;
    else out.push({ role, text });
  };
  const summary = summaryOf(session, lens);
  if (summary !== null) push("user", renderPrompt(MAIN_TEXT.summary, texts, { summary }));
  for (const segment of session.segments) for (const m of segment.messages) if (lens.message(m) && isMainMessage(m)) push(m.role, m.content);
  return out;
}

/**
 * The main agent's last turn on `chain` (the chain before a turn): the latest reply whose record's
 * segment of the session holds a message of its own it reads (`main`: those segments' hashes). Where
 * none does but the session was summarized, the reply whose record holds the summary, which stands
 * for what came before. Null when the main agent has no turn on the chain it reads: a fresh session.
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
 * for `holder` until the turn's record carries them. Only what `lens` reads is summarized, and the
 * summary keeps the widest knowledge of what it holds. Null when the session holds no more than
 * `keep` turns, or nothing `lens` reads to fold; `failed` with the call's reason when it wrote none.
 */
export async function compact(rt: Pick<Runtime, "sessions">, input: { userId: UserId; holder: string; session: MainSession; keep: number; texts: PromptTexts; lens: SessionLens; summarize: (system: string, message: string) => Promise<AgentReply> }): Promise<Compacted | { failed: string } | null> {
  const { session, keep, texts, lens } = input;
  const folded = session.segments.slice(0, Math.max(0, session.segments.length - keep));
  const read = folded.map((segment) => segment.messages.filter((m) => lens.message(m)));
  const before = summaryOf(session, lens);
  if (read.every((messages) => messages.length === 0)) return null;
  const none = renderPrompt(MAIN_TEXT.none, texts, {});
  const turns = read.flatMap((messages) => (messages.length === 0 ? [] : [messages.map((m) => `${String(m.role)}: ${typeof m.content === "string" ? m.content : ""}`).join("\n")])).join("\n\n");
  const reply = await input.summarize(renderPrompt(MAIN_TEXT.compaction, texts, { keep: String(keep) }), renderPrompt(MAIN_TEXT.compactionInput, texts, { summary: before ?? none, turns }));
  const summary = reply.text.trim();
  if (reply.status !== "answered" || summary === "") return { failed: reply.reason ?? none };
  const held = [...read.flat().map(knowledgeOf), ...(before !== null ? [session.summaryKnowledge] : [])];
  const knowledge = AGENT_KNOWLEDGE[Math.max(0, ...held.map((k) => AGENT_KNOWLEDGE.indexOf(k)))] ?? lens.knowledge;
  const rebase = await rt.sessions.compact(input.userId, input.holder, session.refs, summary, keep, knowledge);
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

/** A message of the session as GM → Workspace shows it, with whether `lens` reads it; nothing for one that isn't a message (records come from any metadata writer). */
function messageView(m: SessionMessage, lens: SessionLens): SessionMessageView[] {
  if ((m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") return [];
  const main = isMainMessage(m);
  const files = main && Array.isArray(m.files) ? m.files.filter((f): f is string => typeof f === "string") : [];
  const engine = isRecord(m.engine) ? m.engine : null;
  const list = (part: "roles" | "committed"): JsonObject[] => {
    const value = engine?.[part];
    return Array.isArray(value) ? value.filter((v): v is JsonObject => isRecord(v)) : [];
  };
  return [
    {
      role: m.role,
      text: m.content,
      main,
      ...(main ? { knowledge: knowledgeOf(m) } : {}),
      ...(files.length > 0 ? { files } : {}),
      ...(engine ? { engine: { roles: list("roles").map((r) => ({ role: String(r.role ?? ""), via: String(r.via ?? ""), ok: r.ok === true })), committed: list("committed").map((c) => ({ role: String(c.role ?? ""), key: String(c.key ?? ""), type: String(c.type ?? "") })) } } : {}),
      read: lens.message(m),
    },
  ];
}

/**
 * GM → Workspace's view of the main session at the chat's head (`lre.workspace session`): all of it,
 * whatever knowledge each part was made under, every message saying whether the main agent reads it
 * now (its knowledge and its files' readers, as its next turn reads them), what of it the main agent
 * reads, and its latest compaction's rollback.
 */
export async function sessionView(rt: Runtime, chatId: ChatId, userId: UserId): Promise<SessionView> {
  const knowledge = (await rt.settings.get(userId)).agents.main.knowledge;
  const head = await chatHead(rt, chatId, userId);
  if (!head) return { summary: null, summaryKnowledge: "gm", turns: 0, tokens: 0, segments: [], reads: { knowledge, turns: 0, tokens: 0, summary: false }, missing: 0, rollback: "none" };
  const chain = head.core.chain(head.observed);
  const session = await readSession(rt, userId, sessionAt(chain, head.core.journal.tombstones));
  const lens = mainLens(knowledge, new Map((await listWorkspace(rt, { userId, chatId, knowledge: "gm" })).map((f) => [f.path, f.readers] as const)));
  const asked = (await rt.chatAgents.get(chatId, userId)).rollback;
  const rollback = !undoable(session) ? "none" : asked?.base === session.refs.base && asked.archived === session.refs.archived ? "pending" : "available";
  const turns = segmentTurns(chain, head.core.journal.tombstones);
  return {
    summary: session.summary,
    summaryKnowledge: session.summaryKnowledge,
    turns: session.segments.length,
    // The whole of it: the GM's knowledge reads every part, and every message counts.
    tokens: sessionTokens(session, { knowledge: "gm", message: () => true }),
    segments: session.segments.map((s) => ({ turn: turns.get(s.hash) ?? null, messages: s.messages.flatMap((m) => messageView(m, lens)) })),
    reads: { knowledge, turns: session.segments.filter((s) => s.messages.some((m) => lens.message(m))).length, tokens: sessionTokens(session, lens), summary: summaryOf(session, lens) !== null },
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

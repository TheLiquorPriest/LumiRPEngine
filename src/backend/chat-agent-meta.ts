// A chat's agent metadata (DESIGN §4.4, §4.5; AGENT-LOOP-PLAN §4): what its agents keep in the host's
// chat metadata under LRE's key (`lumi_rp_engine.agents`, beside the chat's run), never in its
// ledger: the learned area's index (`learned`), the GM assistant's thread (`assistant`) and a rollback
// of the main session's latest compaction that GM → Workspace asked for (`rollback`), which the next
// agent turn's record carries. None is part of a turn: a swipe, a Re-run or an Undo never changes them,
// and a Lumiverse Branch, which copies the chat's metadata, keeps them as they stood when the branch
// was made, with no event handling. All hold blob hashes (a blob is a text in the user's store,
// `agents/blobs.ts`): the learned index each file's path with the hash of its body, whose knowledge
// may read it, its pin and who wrote it; the thread each message's hash in order, and each proposal's
// by its id; the rollback the compaction's summary it undoes and the span it brings back. The sweep
// keeps every blob any chat's metadata names (`agentRefs`). Every write takes its turn in the chat's
// queue (`ChatMetaQueue`), with LRE's other writes of the chat's metadata.

import { type AgentKnowledge, isAgentKnowledge } from "../shared/agent-tools";
import type { ChatId, UserId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import { isRecord, safeKey } from "../shared/json";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import { isBlobHash, isLearnedPath, isWorkspacePath } from "../shared/stores";
import { ChatMetaQueue } from "./chat-meta-queue";
import type { HostPort } from "./host";

/** The GM assistant's thread (`lumi_rp_engine.agents.assistant`): its messages' blobs, oldest first, and its proposals' blobs by id, oldest first. */
export interface AssistantThread {
  messages: string[];
  proposals: Record<string, string>;
}

/** A rollback of the main session's latest compaction (`lumi_rp_engine.agents.rollback`): the summary it undoes, and the span that compaction archived, which comes back. */
export interface SessionRollback {
  base: string;
  archived: string;
}

/** A file of the learned area: its body's hash, whose knowledge may read it, whether it is pinned, and the role that wrote it last. */
export interface LearnedFile {
  hash: string;
  readers: AgentKnowledge;
  pinned?: true;
  role?: string;
}

/** What a chat's metadata holds for its agents (`lumi_rp_engine.agents`). */
export interface AgentMeta {
  /** The learned area: each file by its path (under `learned/`). */
  learned: Record<string, LearnedFile>;
  assistant: AssistantThread;
  /** A rollback asked for in GM → Workspace; null when none was. */
  rollback: SessionRollback | null;
}

/** Where a chat's agent metadata sits inside LRE's key of its metadata. */
const AGENTS_KEY = "agents";

function learnedFileOf(raw: unknown): LearnedFile | null {
  if (!isRecord(raw) || !isBlobHash(raw.hash) || !isAgentKnowledge(raw.readers)) return null;
  if ((raw.pinned !== undefined && raw.pinned !== true) || (raw.role !== undefined && typeof raw.role !== "string")) return null;
  return { hash: raw.hash, readers: raw.readers, ...(raw.pinned === true ? { pinned: true as const } : {}), ...(typeof raw.role === "string" ? { role: raw.role } : {}) };
}

/** A chat's agent metadata as its bag holds it; an entry that doesn't read (another writer's, a damaged one) is left out. */
export function agentMetaOf(meta: JsonObject): AgentMeta {
  const own = meta[LEDGER_NAMESPACE];
  const agents = isRecord(own) ? own[AGENTS_KEY] : undefined;
  const raw = isRecord(agents) ? agents.learned : undefined;
  const learned: Record<string, LearnedFile> = {};
  if (isRecord(raw)) {
    for (const [path, entry] of Object.entries(raw)) {
      const file = isWorkspacePath(path) && isLearnedPath(path) ? learnedFileOf(entry) : null;
      if (file) learned[path] = file;
    }
  }
  const thread = isRecord(agents) && isRecord(agents.assistant) ? agents.assistant : {};
  const messages = Array.isArray(thread.messages) ? thread.messages.filter(isBlobHash) : [];
  const proposals: Record<string, string> = {};
  if (isRecord(thread.proposals)) for (const [id, hash] of Object.entries(thread.proposals)) if (safeKey(id) && isBlobHash(hash)) proposals[id] = hash;
  const asked = isRecord(agents) && isRecord(agents.rollback) ? agents.rollback : {};
  const rollback = isBlobHash(asked.base) && isBlobHash(asked.archived) ? { base: asked.base, archived: asked.archived } : null;
  return { learned, assistant: { messages, proposals }, rollback };
}

/** The blobs a chat's agent metadata names (the learned files' bodies, the assistant thread's messages and proposals, a rollback's summary and span): what the sweep keeps for it. */
export function agentRefs(meta: JsonObject): string[] {
  const { learned, assistant, rollback } = agentMetaOf(meta);
  return [...Object.values(learned).map((f) => f.hash), ...assistant.messages, ...Object.values(assistant.proposals), ...(rollback ? [rollback.base, rollback.archived] : [])];
}

function learnedJson(file: LearnedFile): JsonObject {
  return { hash: file.hash, readers: file.readers, ...(file.pinned ? { pinned: true } : {}), ...(file.role !== undefined ? { role: file.role } : {}) };
}

export class ChatAgentMeta {
  constructor(
    private readonly host: Pick<HostPort, "chats">,
    /** The chat's turn among LRE's writes of its metadata (one queue for every writer of it). */
    private readonly queue: ChatMetaQueue = new ChatMetaQueue(),
  ) {}

  /** The chat's agent metadata as the host holds it now (a Branch's is its own copy, made at branch time). */
  async get(chatId: ChatId, userId: UserId): Promise<AgentMeta> {
    return agentMetaOf(await this.host.chats.chatMetadata(chatId, userId));
  }

  /**
   * Changes the learned area: a file puts it at its path (its body a blob the caller stored and holds
   * until this lands), null takes it out.
   */
  async setLearned(chatId: ChatId, userId: UserId, changes: Readonly<Record<string, LearnedFile | null>>): Promise<AgentMeta> {
    for (const [path, file] of Object.entries(changes)) {
      if (!isWorkspacePath(path) || !isLearnedPath(path)) throw new Error(`"${path}" isn't a path in the learned area`);
      if (file !== null && learnedFileOf(file) === null) throw new Error(`the learned file at "${path}" isn't a stored file with its readers`);
    }
    return this.update(chatId, userId, (now) => {
      const learned = { ...now.learned };
      for (const [path, file] of Object.entries(changes)) {
        if (file === null) delete learned[path];
        else learned[path] = file;
      }
      return { learned };
    });
  }

  /**
   * Changes the assistant's thread to what `change` makes of it as the chat holds it then: the blobs
   * it names are ones the caller stored and holds until this lands.
   */
  async setAssistant(chatId: ChatId, userId: UserId, change: (now: Readonly<AssistantThread>) => AssistantThread): Promise<AgentMeta> {
    return this.update(chatId, userId, (now) => {
      const next = change(now.assistant);
      for (const hash of [...next.messages, ...Object.values(next.proposals)]) if (!isBlobHash(hash)) throw new Error(`"${hash}" isn't a stored blob's hash`);
      for (const id of Object.keys(next.proposals)) if (!safeKey(id)) throw new Error(`"${id}" isn't a proposal's id`);
      return { assistant: { messages: [...next.messages], proposals: { ...next.proposals } } };
    });
  }

  /**
   * Asks for a rollback of the main session's latest compaction (GM → Workspace), or, with null,
   * takes the ask back: the summary it undoes and the span it brings back, both blobs the chat's
   * records already name.
   */
  async setRollback(chatId: ChatId, userId: UserId, rollback: SessionRollback | null): Promise<AgentMeta> {
    if (rollback && !(isBlobHash(rollback.base) && isBlobHash(rollback.archived))) throw new Error("a rollback names a stored summary and the span it replaced");
    return this.update(chatId, userId, () => ({ rollback: rollback ? { base: rollback.base, archived: rollback.archived } : null }));
  }

  /**
   * Read-merge-write into the chat's metadata, in the chat's turn: the parts `change` gives back
   * replace those parts, and every other key of LRE's (the chat's run, its own choices, the other
   * part) and of other writers stays as it is. Only a chat that plays a world has any.
   */
  private update(chatId: ChatId, userId: UserId, change: (now: AgentMeta) => Partial<AgentMeta>): Promise<AgentMeta> {
    return this.queue.run(chatId, userId, async () => {
      const meta = await this.host.chats.chatMetadata(chatId, userId);
      const own = meta[LEDGER_NAMESPACE];
      if (!isRecord(own)) throw new Error("this chat plays no world");
      const now = agentMetaOf(meta);
      const parts = change(now);
      const agents: JsonObject = isRecord(own[AGENTS_KEY]) ? { ...(own[AGENTS_KEY] as JsonObject) } : {};
      if (parts.learned) agents.learned = Object.fromEntries(Object.entries(parts.learned).map(([path, file]) => [path, learnedJson(file)]));
      if (parts.assistant) agents.assistant = { messages: parts.assistant.messages, proposals: parts.assistant.proposals };
      if (parts.rollback === null) delete agents.rollback;
      else if (parts.rollback) agents.rollback = { base: parts.rollback.base, archived: parts.rollback.archived };
      await this.host.chats.mergeChatMetadata(chatId, { [LEDGER_NAMESPACE]: { ...own, [AGENTS_KEY]: agents } }, userId);
      return { ...now, ...parts };
    });
  }
}

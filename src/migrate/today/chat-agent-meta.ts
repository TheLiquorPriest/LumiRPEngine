// What a chat's agents keep in today's chat metadata under LRE's key (DESIGN §4.4, §4.5;
// `lumi_rp_engine.agents`): the learned area's index, the GM assistant's thread and a rollback asked
// for, read as the bag holds them; carried for the migration (PlanSwap-5). The old runtime's
// `ChatAgentMeta` (src/backend/chat-agent-meta.ts) reads and writes them through this.

import type { JsonObject } from "../../shared/json";
import { isRecord, safeKey } from "../../shared/json";
import { LEDGER_NAMESPACE } from "../../shared/ledger";
import { isBlobHash, isLearnedPath, isWorkspacePath, type KeptFile, keptFileOf } from "../../shared/stores";

/**
 * The GM assistant's thread (`lumi_rp_engine.agents.assistant`): its messages' blobs, oldest first,
 * and its proposals' blobs by id, oldest first. `side`: on a chat the harness plays, the side session
 * of LumiAH's its answers come from (`harness/assistant.ts`), kept here so a restart finds it; absent
 * until one is started, and once the thread is cleared. A Branch copies it with the thread, though
 * the session stays about the chat it was started in: whoever reads it checks whose it is.
 */
export interface AssistantThread {
  messages: string[];
  proposals: Record<string, string>;
  side?: string;
}

/** A rollback of the main session's latest compaction (`lumi_rp_engine.agents.rollback`): the summary it undoes, and the span that compaction archived, which comes back. */
export interface SessionRollback {
  base: string;
  archived: string;
}

/** What a chat's metadata holds for its agents (`lumi_rp_engine.agents`). */
export interface AgentMeta {
  /** The learned area: each file by its path (under `learned/`). */
  learned: Record<string, KeptFile>;
  assistant: AssistantThread;
  /** A rollback asked for in GM → Workspace; null when none was. */
  rollback: SessionRollback | null;
}

/** Where a chat's agent metadata sits inside LRE's key of its metadata. */
export const AGENTS_KEY = "agents";

/** A chat's agent metadata as its bag holds it; an entry that doesn't read (another writer's, a damaged one) is left out. */
export function agentMetaOf(meta: JsonObject): AgentMeta {
  const own = meta[LEDGER_NAMESPACE];
  const agents = isRecord(own) ? own[AGENTS_KEY] : undefined;
  const raw = isRecord(agents) ? agents.learned : undefined;
  const learned: Record<string, KeptFile> = {};
  if (isRecord(raw)) {
    for (const [path, entry] of Object.entries(raw)) {
      const file = isWorkspacePath(path) && isLearnedPath(path) ? keptFileOf(entry) : null;
      if (file) learned[path] = file;
    }
  }
  const thread = isRecord(agents) && isRecord(agents.assistant) ? agents.assistant : {};
  const messages = Array.isArray(thread.messages) ? thread.messages.filter(isBlobHash) : [];
  const proposals: Record<string, string> = {};
  if (isRecord(thread.proposals)) for (const [id, hash] of Object.entries(thread.proposals)) if (safeKey(id) && isBlobHash(hash)) proposals[id] = hash;
  const side = safeKey(thread.side) ? thread.side : undefined;
  const asked = isRecord(agents) && isRecord(agents.rollback) ? agents.rollback : {};
  const rollback = isBlobHash(asked.base) && isBlobHash(asked.archived) ? { base: asked.base, archived: asked.archived } : null;
  return { learned, assistant: { messages, proposals, ...(side !== undefined ? { side } : {}) }, rollback };
}

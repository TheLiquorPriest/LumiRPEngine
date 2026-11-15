// A chat's own choices for knowledge, the narrator, its engine and tidying, as today's chat metadata
// holds them under LRE's key (DESIGN §6.11, §24; `lumi_rp_engine.prefs`), carried for the migration
// (PlanSwap-5). The old runtime's `ChatKnowledge` (src/backend/chat-knowledge-prefs.ts) reads them
// through this.

import { isRecord, type JsonObject } from "../../shared/json";
import { LEDGER_NAMESPACE } from "../../shared/ledger";
import { narratorViewOf, type NarratorView } from "../../shared/settings";

/** Which engine plays a chat's turns (GM → This chat): its classic steps, the agent loop, or the harness, where the author and the agents it starts play the turn through tools. */
export type ChatEngine = "classic" | "agents" | "harness";

/** A chat's own choices; a part left out follows its world's default, else the user's Settings; the engine left out is classic. */
export interface ChatKnowledgePrefs {
  /** Knowledge tracking in this chat, on or off; absent, Settings → Minds → Knowledge's. */
  knowledge?: boolean;
  /** What the narrator knows in this chat; absent, the world's default, else Settings → Narrator's. */
  narrator?: NarratorView;
  /** The engine that plays this chat's turns; absent, classic. */
  engine?: ChatEngine;
  /** Tidy impossible holds automatically in this chat (the one-time Things tidied fix); absent, the world's (Build → Packs → gear → Tidy up). */
  tidy?: boolean;
}

/** Where a chat's own choices sit inside LRE's key of its metadata. */
export const PREFS_KEY = "prefs";

/** A chat's own choices as its metadata holds them; a malformed part is left out, so it follows. */
export function chatKnowledgePrefsOf(meta: JsonObject): ChatKnowledgePrefs {
  const own = meta[LEDGER_NAMESPACE];
  const raw = isRecord(own) ? own[PREFS_KEY] : undefined;
  if (!isRecord(raw)) return {};
  const narrator = narratorViewOf(raw.narrator);
  // Classic is what a chat with no choice plays, so only the others are stored and read.
  const engine = raw.engine === "agents" || raw.engine === "harness" ? raw.engine : null;
  return { ...(typeof raw.knowledge === "boolean" ? { knowledge: raw.knowledge } : {}), ...(narrator ? { narrator } : {}), ...(engine ? { engine } : {}), ...(typeof raw.tidy === "boolean" ? { tidy: raw.tidy } : {}) };
}

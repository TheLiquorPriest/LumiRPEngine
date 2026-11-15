// A chat's run as today's chat metadata holds it under LRE's key (DESIGN §4.1), carried for the
// migration (PlanSwap-5). The old runtime (src/backend/runtime.ts) reads chats' runs through this.

import type { JsonObject } from "../../shared/json";
import { isRecord } from "../../shared/json";
import type { ChatRun } from "../../shared/ledger";
import { LEDGER_NAMESPACE } from "../../shared/ledger";

/** The chat's run as its metadata holds it (DESIGN §4.1), or null for a chat that plays no world. */
export function readRun(meta: JsonObject): ChatRun | null {
  const raw = meta[LEDGER_NAMESPACE];
  if (!isRecord(raw) || raw.v !== 1 || typeof raw.worldId !== "string" || typeof raw.revision !== "string" || typeof raw.runSeed !== "string") return null;
  return { v: 1, worldId: raw.worldId, revision: raw.revision, runSeed: raw.runSeed, startedAt: typeof raw.startedAt === "number" ? raw.startedAt : 0 };
}

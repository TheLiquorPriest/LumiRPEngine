// A harness turn's part of a reply's record as today's chats hold it (HARNESS-SLICE3: "One record per
// reply"; `Rec.harness`, `shared/ledger.ts`), read leniently; carried for the migration (PlanSwap-5).
// The old runtime's harness records (src/backend/harness/record.ts) read it through this.

import { isRecord, type JsonObject } from "../../shared/json";
import type { Rec, RecHarness } from "../../shared/ledger";

/** A record's harness part as stored; null when it has none, or what it holds names no turn (a reply no turn was played for has only its mark, `unplayedOf`). */
export function recHarnessOf(rec: Pick<Rec, "harness"> | null | undefined): RecHarness | null {
  const raw: unknown = rec?.harness;
  if (!isRecord(raw) || !Array.isArray(raw.turns)) return null;
  const turns = raw.turns.filter((t): t is string => typeof t === "string" && t !== "");
  if (turns.length === 0) return null;
  return {
    turns,
    ...(isRecord(raw.record) ? { record: raw.record as JsonObject } : {}),
    ...(typeof raw.defaultTick === "number" && Number.isFinite(raw.defaultTick) && raw.defaultTick > 0 ? { defaultTick: raw.defaultTick } : {}),
    // Kept through a later write of LumiAH's record (a job of the turn ending): only a turn that writes the record again clears it.
    ...(typeof raw.unplayed === "string" && raw.unplayed !== "" ? { unplayed: raw.unplayed } : {}),
  };
}

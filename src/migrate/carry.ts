// Where each row of the plan's table now is in RPE (STANDALONE-PLAN §15.2), once the real run has
// carried it. The chats are carried into RPE's store by `import-chats.ts`; this says where.

import type { DataPaths } from "../app/config";
import type { UserStore } from "../store";
import type { ChatImportReport, MigrationReport } from "./report";
import type { RowId } from "./rows";
import type { Today } from "./today";

export interface CarryInput {
  today: Today;
  report: MigrationReport;
  paths: DataPaths;
  imports: readonly ChatImportReport[];
  s: UserStore;
}

/** What the chats' import carried, and where it now is. */
const IMPORTED: Partial<Record<RowId, string>> = {
  "chat-run": "RPE's store: each chat with the world and revision it plays",
  ledger: "RPE's store: a turn tied to its message for every reply and swipe, its changes what today's fold applied there; each swipe's record as today's build kept it in the migration's imported_record, beside its turn, read-only",
  "pack-state": "RPE's store: the changes of each turn, folded by the same packs' handlers",
  "secret-holdings": "RPE's store: the knowledge events among each turn's changes, folded into the minds state as today",
  "chat-places": "RPE's store: the chat's own place and map events among each turn's changes",
};

export async function carry(_input: CarryInput): Promise<Partial<Record<RowId, string>>> {
  return { ...IMPORTED };
}

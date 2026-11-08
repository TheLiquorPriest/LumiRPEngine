// A chat's history cutoff (GM → This chat → Depth → History, `shared/depth-history.ts`), kept beside
// the chat's opt-in in `runs/<chatId>/bootstrap/history.json`; a chat that never set one has the default.

import { HISTORY_CUT_DEFAULT, type HistoryCut, historyCutOf } from "../../shared/depth-history";
import type { ChatId, UserId } from "../../shared/ids";
import { BootstrapFiles } from "../bootstrap/files";
import type { HostPort } from "../host";

const FILE = "history.json";

const isCut = (raw: unknown): raw is HistoryCut => historyCutOf(raw) !== null;

export async function historyCut(host: Pick<HostPort, "storage" | "log">, chatId: ChatId, userId: UserId): Promise<HistoryCut> {
  return (await new BootstrapFiles(host, chatId, userId).read(FILE, isCut)) ?? { ...HISTORY_CUT_DEFAULT };
}

export async function setHistoryCut(host: Pick<HostPort, "storage" | "log">, chatId: ChatId, userId: UserId, cut: HistoryCut): Promise<void> {
  await new BootstrapFiles(host, chatId, userId).write(FILE, cut);
}

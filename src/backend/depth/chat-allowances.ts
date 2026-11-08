// A chat's own allowances (DEPTH-PLAN §6.5, "the chat's own choice in GM → This chat"): per
// treatment, the parts a story interval may spend in this chat, over the user's own in Settings →
// Depth → Budget. Kept beside the chat's opt-in in `runs/<chatId>/bootstrap/allowances.json`; a
// treatment the chat doesn't set keeps the user's. The ceilings stay the user's.

import { DEPTH_TREATMENTS, type DepthBudget, type DepthLimit, type DepthTreatment } from "../../shared/depth-settings";
import type { ChatId, UserId } from "../../shared/ids";
import { BootstrapFiles } from "../bootstrap/files";
import type { HostPort } from "../host";

const FILE = "allowances.json";

/** The most parts one treatment's allowance may hold per story interval. */
export const CHAT_ALLOWANCE_MOST = 1000;

export type ChatAllowances = Partial<Record<DepthTreatment, DepthLimit>>;

/** The well-formed allowances in `raw`: each a treatment's count (0 to `CHAT_ALLOWANCE_MOST`) or "none" (no limit); null when anything else is there. */
export function chatAllowancesOf(raw: unknown): ChatAllowances | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const out: ChatAllowances = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!(DEPTH_TREATMENTS as readonly string[]).includes(key)) return null;
    if (value !== "none" && (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > CHAT_ALLOWANCE_MOST)) return null;
    out[key as DepthTreatment] = value;
  }
  return out;
}

const isAllowances = (raw: unknown): raw is ChatAllowances => chatAllowancesOf(raw) !== null;

export async function chatAllowances(host: Pick<HostPort, "storage" | "log">, chatId: ChatId, userId: UserId): Promise<ChatAllowances> {
  return (await new BootstrapFiles(host, chatId, userId).read(FILE, isAllowances)) ?? {};
}

/** Sets the chat's own allowances; none set goes back to the user's. */
export async function setChatAllowances(host: Pick<HostPort, "storage" | "log">, chatId: ChatId, userId: UserId, allowances: ChatAllowances): Promise<void> {
  const files = new BootstrapFiles(host, chatId, userId);
  if (Object.keys(allowances).length === 0) await files.remove(FILE);
  else await files.write(FILE, allowances);
}

/** The budget dial as it holds in this chat: the user's, with the chat's own allowances over it. */
export async function chatBudget(host: Pick<HostPort, "storage" | "log">, chatId: ChatId, userId: UserId, budget: DepthBudget): Promise<DepthBudget> {
  const own = await chatAllowances(host, chatId, userId);
  return Object.keys(own).length === 0 ? budget : { ...budget, allowances: { ...budget.allowances, ...own } };
}

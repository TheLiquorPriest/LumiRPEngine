// A chat's own way of taking the preset (DEPTH-PLAN §3.13, "per chat, default Keep the preset"): GM →
// This chat → Depth → Your preset, over the user's in Settings → Depth → Your preset. Kept beside the
// chat's opt-in in `runs/<chatId>/bootstrap/absorption.json`; a chat that never chose one takes the user's.

import type { DepthSettings } from "../../shared/depth-settings";
import type { ChatId, UserId } from "../../shared/ids";
import { BootstrapFiles } from "../bootstrap/files";
import type { HostPort } from "../host";

const FILE = "absorption.json";

export type ChatAbsorption = DepthSettings["absorption"];

/** The chat's choice in `raw`, or null when it isn't one. */
export function chatAbsorptionOf(raw: unknown): ChatAbsorption | null {
  return raw === "keep" || raw === "narrator" ? raw : null;
}

const isChosen = (raw: unknown): raw is { absorption: ChatAbsorption } => typeof raw === "object" && raw !== null && "absorption" in raw && chatAbsorptionOf(raw.absorption) !== null;

/** The chat's own choice; null where it takes the user's. */
export async function chatAbsorption(host: Pick<HostPort, "storage" | "log">, chatId: ChatId, userId: UserId): Promise<ChatAbsorption | null> {
  return (await new BootstrapFiles(host, chatId, userId).read(FILE, isChosen))?.absorption ?? null;
}

/** Sets the chat's own choice; null goes back to the user's. */
export async function setChatAbsorption(host: Pick<HostPort, "storage" | "log">, chatId: ChatId, userId: UserId, absorption: ChatAbsorption | null): Promise<void> {
  const files = new BootstrapFiles(host, chatId, userId);
  if (absorption === null) await files.remove(FILE);
  else await files.write(FILE, { absorption });
}

// How the command line says a moment and a key's end.

import type { AppConfig } from "../config";

/** A moment as the command line prints it: to the minute, in UTC. */
export const atWords = (at: number): string => `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** How long the web UI's key holds (`auth.webKeyDays`), in milliseconds; null: no end. */
export const webKeyMs = (config: AppConfig): number | null => (config.auth.webKeyDays === null ? null : config.auth.webKeyDays * 86_400_000);

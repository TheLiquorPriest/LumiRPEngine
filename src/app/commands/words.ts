// How the command line says a moment and a key's end.

import type { AppConfig } from "../config";

/** A moment as the command line prints it: to the minute, in UTC. */
export const atWords = (at: number): string => `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** How long the web UI's key holds (`auth.webKeyDays`), in milliseconds; null: no end. */
export const webKeyMs = (config: AppConfig): number | null => (config.auth.webKeyDays === null ? null : config.auth.webKeyDays * 86_400_000);

/** What a list of switches says while RPE is stopped: it can look at no file, and a stopped RPE lists them when it starts. */
export const STOPPED_LISTING = "RPE is stopped, so this is what it had listed when it last ran. A hook, a rule's command, a tool or a server you have written in a file since is listed when RPE starts.";

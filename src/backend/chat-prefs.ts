// What the player chose for how a chat looks (DESIGN §12): for now, how the map shows it
// (knowledge or fog). It is presentation, not world state, so it lives beside the chat in
// `userStorage/runs/<chatId>/prefs.json` rather than in its ledger: a swipe, a branch or a Re-run
// never changes it, and it never changes the world.

import type { ChatId, UserId } from "../shared/ids";
import { runDir } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { MapDisplay } from "../shared/world";
import type { HostPort } from "./host";
import { readStoredJson } from "./stored-json";

interface ChatPrefsFile {
  v: 1;
  mapDisplay?: MapDisplay;
}

export class ChatPrefs {
  /** Prefs by `user \0 chat`: one user's cache never answers another. */
  private readonly prefs = new Map<string, ChatPrefsFile>();

  constructor(private readonly host: HostPort) {}

  private path(chatId: ChatId): string {
    return `${runDir(chatId)}prefs.json`;
  }

  private async load(chatId: ChatId, userId: UserId): Promise<ChatPrefsFile> {
    const key = `${userId}\u0000${chatId}`;
    const known = this.prefs.get(key);
    if (known) return known;
    const raw = await readStoredJson(this.host, this.path(chatId), userId, "Chat preferences", isRecord);
    const display = isRecord(raw) ? raw.mapDisplay : undefined;
    const prefs: ChatPrefsFile = { v: 1, ...(display === "knowledge" || display === "fog" ? { mapDisplay: display } : {}) };
    this.prefs.set(key, prefs);
    if (this.prefs.size > 256) this.prefs.delete(this.prefs.keys().next().value ?? "");
    return prefs;
  }

  /** How the player chose to see this chat's map; null when they haven't (the world's default applies). */
  async mapDisplay(chatId: ChatId, userId: UserId): Promise<MapDisplay | null> {
    return (await this.load(chatId, userId)).mapDisplay ?? null;
  }

  async setMapDisplay(chatId: ChatId, userId: UserId, display: MapDisplay): Promise<void> {
    const prefs = await this.load(chatId, userId);
    if (prefs.mapDisplay === display) return;
    const next: ChatPrefsFile = { ...prefs, mapDisplay: display };
    this.prefs.set(`${userId}\u0000${chatId}`, next);
    const path = this.path(chatId);
    await this.host.storage.write(`${path}.tmp`, JSON.stringify(next), userId);
    await this.host.storage.move(`${path}.tmp`, path, userId);
  }
}

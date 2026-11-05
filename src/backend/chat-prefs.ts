// What the player chose for how a chat looks (DESIGN §12): how the map shows it (knowledge or fog),
// and the Tidy up findings the GM left as they are (GM → Things, ITEMS-SPEC §7.5). It is
// presentation, not world state, so it lives beside the chat in `userStorage/runs/<chatId>/prefs.json`
// rather than in its ledger: a swipe, a branch or a Re-run never changes it, and it never changes
// the world. Beside it, `scene.json` keeps Smart persistence's last scene (`agents/persist.ts`), so a
// restart keeps what a quiet scene may keep; it holds only for the reply it was written for.

import type { ChatId, UserId } from "../shared/ids";
import { runDir } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { MapDisplay } from "../shared/world";
import type { LastScene, SceneStore } from "./agents/persist";
import type { HostPort } from "./host";
import { readStoredJson } from "./stored-json";

/** How many left findings a chat keeps; past it, the oldest left shows again. */
const TIDY_LEFT_MAX = 1000;

interface ChatPrefsFile {
  v: 1;
  mapDisplay?: MapDisplay;
  /** Tidy up findings left as they are, by key, oldest first. */
  tidyLeft?: string[];
}

export class ChatPrefs implements SceneStore {
  /** Prefs by `user \0 chat`: one user's cache never answers another. */
  private readonly prefs = new Map<string, ChatPrefsFile>();

  constructor(private readonly host: HostPort) {}

  private path(chatId: ChatId): string {
    return `${runDir(chatId)}prefs.json`;
  }

  /** Smart persistence's last scene for the chat, as stored (`lastSceneOf` reads it); null when there is none. */
  async lastScene(chatId: ChatId, userId: UserId): Promise<unknown> {
    const raw = await readStoredJson(this.host, `${runDir(chatId)}scene.json`, userId, "Smart persistence's last scene", (r) => isRecord(r) && r.v === 1);
    return isRecord(raw) && raw.v === 1 ? raw.scene : null;
  }

  /** Keeps the chat's last scene for after a restart; a write that fails is logged, and that restart asks every role afresh. */
  async keepScene(chatId: ChatId, userId: UserId, scene: LastScene): Promise<void> {
    const path = `${runDir(chatId)}scene.json`;
    try {
      await this.host.storage.write(`${path}.tmp`, JSON.stringify({ v: 1, scene }), userId);
      await this.host.storage.move(`${path}.tmp`, path, userId);
    } catch (error) {
      this.host.log("warn", `[LumiRPEngine] chat ${chatId}: Smart persistence's last scene wasn't kept for after a restart (${error instanceof Error ? error.message : String(error)}); a turn after one asks every role afresh`, userId);
    }
  }

  private async load(chatId: ChatId, userId: UserId): Promise<ChatPrefsFile> {
    const key = `${userId}\u0000${chatId}`;
    const known = this.prefs.get(key);
    if (known) return known;
    const raw = await readStoredJson(this.host, this.path(chatId), userId, "Chat preferences", isRecord);
    const display = isRecord(raw) ? raw.mapDisplay : undefined;
    const left = isRecord(raw) && Array.isArray(raw.tidyLeft) ? raw.tidyLeft.filter((k): k is string => typeof k === "string" && k !== "").slice(-TIDY_LEFT_MAX) : [];
    const prefs: ChatPrefsFile = { v: 1, ...(display === "knowledge" || display === "fog" ? { mapDisplay: display } : {}), ...(left.length > 0 ? { tidyLeft: left } : {}) };
    this.prefs.set(key, prefs);
    if (this.prefs.size > 256) this.prefs.delete(this.prefs.keys().next().value ?? "");
    return prefs;
  }

  private async save(chatId: ChatId, userId: UserId, next: ChatPrefsFile): Promise<void> {
    this.prefs.set(`${userId}\u0000${chatId}`, next);
    const path = this.path(chatId);
    await this.host.storage.write(`${path}.tmp`, JSON.stringify(next), userId);
    await this.host.storage.move(`${path}.tmp`, path, userId);
  }

  /** How the player chose to see this chat's map; null when they haven't (the world's default applies). */
  async mapDisplay(chatId: ChatId, userId: UserId): Promise<MapDisplay | null> {
    return (await this.load(chatId, userId)).mapDisplay ?? null;
  }

  async setMapDisplay(chatId: ChatId, userId: UserId, display: MapDisplay): Promise<void> {
    const prefs = await this.load(chatId, userId);
    if (prefs.mapDisplay === display) return;
    await this.save(chatId, userId, { ...prefs, mapDisplay: display });
  }

  /** The Tidy up findings the GM left as they are in this chat, by key. */
  async tidyLeft(chatId: ChatId, userId: UserId): Promise<ReadonlySet<string>> {
    return new Set((await this.load(chatId, userId)).tidyLeft ?? []);
  }

  /** Leaves a finding as it is (`left`), or shows it again. */
  async leaveTidy(chatId: ChatId, userId: UserId, key: string, left: boolean): Promise<void> {
    const prefs = await this.load(chatId, userId);
    const was = prefs.tidyLeft ?? [];
    if (was.includes(key) === left) return;
    const next = left ? [...was, key].slice(-TIDY_LEFT_MAX) : was.filter((k) => k !== key);
    const { tidyLeft: _was, ...rest } = prefs;
    await this.save(chatId, userId, next.length > 0 ? { ...rest, tidyLeft: next } : rest);
  }
}

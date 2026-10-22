// The action a chat has staged for the player's next message (DESIGN §11): a palette, panel or map
// tap with no words waits here instead of playing blind, so the player can say how they go about
// it. One per chat; kept in `userStorage/runs/<chatId>/staged.json`, so a reload and every tab see it.

import type { ChatId, MessageId, UserId } from "../shared/ids";
import { runDir } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import { isRecord } from "../shared/json";
import type { ActionRequest } from "../shared/protocol";
import type { HostPort } from "./host";
import { readStoredJson } from "./stored-json";

export interface StagedAction {
  action: string;
  /** The params as the tap sent them: the same tap again clears the stage. */
  request: JsonObject;
  /** The params the message plays with (a timelapse's routine choice already read). */
  params: JsonObject;
  source: ActionRequest["source"];
  label: string;
  /** The chat's last message when it was staged: only a message after it takes it. Null in an empty chat. */
  after: MessageId | null;
}

function isStaged(raw: unknown): raw is StagedAction {
  return isRecord(raw) && typeof raw.action === "string" && isRecord(raw.request) && isRecord(raw.params) && typeof raw.source === "string" && typeof raw.label === "string" && (raw.after === null || typeof raw.after === "string");
}

export class StagedActions {
  /** By `user \0 chat`: one user's cache never answers another. */
  private readonly staged = new Map<string, StagedAction | null>();

  constructor(private readonly host: HostPort) {}

  private path(chatId: ChatId): string {
    return `${runDir(chatId)}staged.json`;
  }

  async get(chatId: ChatId, userId: UserId): Promise<StagedAction | null> {
    const key = `${userId}\u0000${chatId}`;
    if (!this.staged.has(key)) {
      // A cleared stage is stored as null.
      const raw = await readStoredJson(this.host, this.path(chatId), userId, "Staged action", (v) => v === null || isStaged(v));
      this.staged.set(key, isStaged(raw) ? raw : null);
      if (this.staged.size > 256) this.staged.delete(this.staged.keys().next().value ?? "");
    }
    return this.staged.get(key) ?? null;
  }

  /** Stages `staged`, or with null clears the chat's stage. */
  async set(chatId: ChatId, userId: UserId, staged: StagedAction | null): Promise<void> {
    this.staged.set(`${userId}\u0000${chatId}`, staged);
    const path = this.path(chatId);
    await this.host.storage.write(`${path}.tmp`, JSON.stringify(staged), userId);
    await this.host.storage.move(`${path}.tmp`, path, userId);
  }
}

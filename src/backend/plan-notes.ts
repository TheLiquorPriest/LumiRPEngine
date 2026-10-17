// Planned-turn lines by seed: the Outcome, Montage and Outline text a turn's plan put
// in front of the narrator, kept in `userStorage/runs/<chatId>/plans.json` so Re-narrate rebuilds
// the same sections after a restart or after newer plans pushed it out of the turn bridge.

import type { ChatId, UserId } from "../shared/ids";
import { runDir } from "../shared/ids";
import { hasOwn, isRecord, safeKey } from "../shared/json";
import type { HostPort } from "./host";
import { readStoredJson } from "./stored-json";

export interface PlanLines {
  outcome: string[];
  montage: string[];
  outline: string[];
}

/** Seeds kept per chat; the oldest go first. */
export const PLAN_NOTES_CAP = 128;

function lines(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

export class PlanNotes {
  /** Lines by `user \0 chat`, then seed (insertion order is age). */
  private readonly notes = new Map<string, Map<string, PlanLines>>();

  constructor(private readonly host: HostPort) {}

  private path(chatId: ChatId): string {
    return `${runDir(chatId)}plans.json`;
  }

  private async load(chatId: ChatId, userId: UserId): Promise<Map<string, PlanLines>> {
    const key = `${userId}\u0000${chatId}`;
    const known = this.notes.get(key);
    if (known) return known;
    const raw = await readStoredJson(this.host, this.path(chatId), userId, "plan lines", isRecord);
    const map = new Map<string, PlanLines>();
    if (isRecord(raw)) {
      for (const seed of Object.keys(raw)) {
        const v = hasOwn(raw, seed) ? raw[seed] : undefined;
        if (safeKey(seed) && isRecord(v)) map.set(seed, { outcome: lines(v.outcome), montage: lines(v.montage), outline: lines(v.outline) });
      }
    }
    this.notes.set(key, map);
    if (this.notes.size > 256) this.notes.delete(this.notes.keys().next().value ?? "");
    return map;
  }

  async get(chatId: ChatId, userId: UserId, seed: string): Promise<PlanLines | null> {
    const found = (await this.load(chatId, userId)).get(seed);
    return found ? { outcome: [...found.outcome], montage: [...found.montage], outline: [...found.outline] } : null;
  }

  async put(chatId: ChatId, userId: UserId, seed: string, value: PlanLines): Promise<void> {
    if (!safeKey(seed)) return;
    const map = await this.load(chatId, userId);
    map.delete(seed);
    map.set(seed, value);
    while (map.size > PLAN_NOTES_CAP) map.delete(map.keys().next().value ?? "");
    const path = this.path(chatId);
    await this.host.storage.write(`${path}.tmp`, JSON.stringify(Object.fromEntries(map)), userId);
    await this.host.storage.move(`${path}.tmp`, path, userId);
  }
}

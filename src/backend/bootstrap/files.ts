// The bootstrap's own files (DEPTH-PLAN §8.3, §8.5), per chat in `userStorage/runs/<chatId>/bootstrap/`:
// the spool (the active path's text, a file per chunk, read once by the survey), the run's state, one
// record per job holding the model's recorded answer, and the spot-check cards. Every model answer is
// recorded before anything it produced lands (§4.1), so a crash between the two lands the recorded
// answer on resume and never asks the model again.

import type { ChatId, UserId } from "../../shared/ids";
import type { HostPort } from "../host";

export function bootstrapDir(chatId: ChatId): string {
  return `runs/${chatId}/bootstrap/`;
}

/** Reads and writes one chat's bootstrap files as JSON; a file that doesn't parse reads as absent (it was cut off before anything it held was used). */
export class BootstrapFiles {
  constructor(
    private readonly host: Pick<HostPort, "storage" | "log">,
    readonly chatId: ChatId,
    readonly userId: UserId,
  ) {}

  path(rel: string): string {
    return `${bootstrapDir(this.chatId)}${rel}`;
  }

  async read<T>(rel: string, valid: (raw: unknown) => raw is T): Promise<T | null> {
    const text = await this.host.storage.read(this.path(rel), this.userId);
    if (text === null) return null;
    try {
      const raw: unknown = JSON.parse(text);
      if (valid(raw)) return raw;
    } catch {
      // Cut off mid-write: whatever wrote it hadn't gone on to use it.
    }
    this.host.log("warn", `[LumiRPEngine] bootstrap file ${this.path(rel)} didn't read; it is made again`, this.userId);
    return null;
  }

  async write(rel: string, value: unknown): Promise<void> {
    await this.host.storage.write(this.path(rel), JSON.stringify(value), this.userId);
  }

  async remove(rel: string): Promise<void> {
    await this.host.storage.remove(this.path(rel), this.userId).catch(() => undefined);
  }

  /** The files under `rel`, as paths relative to the chat's bootstrap directory. */
  async list(rel: string): Promise<string[]> {
    const base = bootstrapDir(this.chatId);
    return (await this.host.storage.list(this.path(rel), this.userId).catch(() => [] as string[])).map((p) => (p.startsWith(base) ? p.slice(base.length) : p));
  }
}

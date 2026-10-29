// One queue per chat for LRE's writes to the chat's metadata (DESIGN §4.4). Every one is a
// read-merge-write: LRE's key (`lumi_rp_engine`) holds the chat's run, its own knowledge choices and
// its agents' metadata, each writer reading the key, changing its part and writing the key back
// whole, and the host's merge reads the whole bag and writes it back with the patch's keys, so a
// write of the book list beside it writes LRE's key back too. Two at once on one chat would lose one's
// change: each waits here for the one before.

import type { ChatId, UserId } from "../shared/ids";

export class ChatMetaQueue {
  /** Writes under way, by `user \0 chat`: the latest, which the next waits for. */
  private readonly writes = new Map<string, Promise<unknown>>();

  /** Runs `write` (a read of the chat's metadata and its write) once every earlier one of the chat's has ended, however it ended. */
  run<T>(chatId: ChatId, userId: UserId, write: () => Promise<T>): Promise<T> {
    const key = `${userId}\u0000${chatId}`;
    const next = (this.writes.get(key) ?? Promise.resolve()).catch(() => undefined).then(write);
    this.writes.set(key, next);
    const done = (): void => {
      if (this.writes.get(key) === next) this.writes.delete(key);
    };
    next.then(done, done);
    return next;
  }
}

// The agent stores' blobs (DESIGN §4.4; AGENT-LOOP-PLAN §3.3-3.5): workspace file bodies, the main
// session's segments, summaries and archived spans, and the texts of Diagnostics' agent calls. Each
// is kept once, under the content hash of its text (`shared/stores.ts` `blobHash`), in the user's own
// storage at `agents/blobs/<hash>`, shared by all of their chats: a swipe, a Re-run or a Branch that
// keeps a file costs nothing, and no key holds a chat id or a path.
//
// A blob never changes. A put writes the text under its hash (again, when it is there already: the
// same bytes), so a put is idempotent and a blob a sweep removed meanwhile comes back whole. What
// points at a blob keeps it: a turn record, a learned index, a Diagnostics record, or work in flight
// that holds it (`hold`) until its record or index points there. The sweep (`sweep.ts`) removes the
// rest once their retention has passed, and hears each put (`onPut`), so what is put while it looks
// is kept.

import type { UserId } from "../../shared/ids";
import type { JsonValue } from "../../shared/json";
import { blobHash, isBlobHash } from "../../shared/stores";
import type { HostPort } from "../host";

/** Where the blobs live in the user's storage (a fixed path, AGENT-LOOP-PLAN §16). */
export const BLOBS_DIR = "agents/blobs/";

/** A blob's storage path; a hash that isn't one could name another file, so it is refused. */
export function blobPath(hash: string): string {
  if (!isBlobHash(hash)) throw new Error("not a blob hash");
  return `${BLOBS_DIR}${hash}`;
}

export type BlobHost = Pick<HostPort, "storage" | "log">;

export class BlobStore {
  /** Puts under way, by `user \0 hash`: a second put of the same text waits for the first, so they never share a temporary file. */
  private readonly writing = new Map<string, Promise<void>>();
  /** Removals under way, by `user \0 hash`: a put of the same text waits for one, so its write lands after the removal, never under it. */
  private readonly removing = new Map<string, Promise<void>>();
  /** Per user, per holder (a turn, a GM chat's write), the blobs it holds until something points at them. */
  private readonly holds = new Map<UserId, Map<string, Set<string>>>();
  /**
   * Hears every put before its text is written (the sweep: a blob put while it looks is kept, and a
   * blob put again for a new use starts its retention over).
   */
  onPut: ((userId: UserId, hash: string) => void) | null = null;

  constructor(private readonly host: BlobHost) {}

  /**
   * Stores `text` and gives its hash. With `holder`, the blob is held for it (`hold`) from before it
   * is written, so no sweep removes it while the work that made it hasn't pointed at it yet.
   */
  async put(userId: UserId, text: string, holder?: string): Promise<string> {
    const hash = blobHash(text);
    if (holder !== undefined) this.hold(userId, holder, hash);
    this.onPut?.(userId, hash);
    const key = `${userId}\u0000${hash}`;
    const under = this.writing.get(key);
    if (under) {
      await under;
      return hash;
    }
    const path = blobPath(hash);
    const write = (async () => {
      await this.removing.get(key)?.catch(() => undefined);
      await this.host.storage.write(`${path}.tmp`, text, userId);
      await this.host.storage.move(`${path}.tmp`, path, userId);
    })();
    this.writing.set(key, write);
    try {
      await write;
    } finally {
      this.writing.delete(key);
    }
    return hash;
  }

  /** A JSON value as a blob: its `JSON.stringify` text. */
  putJson(userId: UserId, value: JsonValue, holder?: string): Promise<string> {
    return this.put(userId, JSON.stringify(value), holder);
  }

  /**
   * A blob's text; null when it isn't stored, the hash isn't one, or what is stored no longer hashes
   * to its address (damaged: said in the log, never handed out as if it were the blob).
   */
  async get(userId: UserId, hash: string): Promise<string | null> {
    if (!isBlobHash(hash)) return null;
    await this.writing.get(`${userId}\u0000${hash}`);
    const text = await this.host.storage.read(blobPath(hash), userId);
    if (text === null) return null;
    if (blobHash(text) === hash) return text;
    this.host.log("warn", `[LumiRPEngine] the stored blob ${hash} doesn't match its hash, so it is read as missing`, userId);
    return null;
  }

  /** A blob read as JSON; null when it is missing or isn't JSON. */
  async getJson(userId: UserId, hash: string): Promise<JsonValue | null> {
    const text = await this.get(userId, hash);
    if (text === null) return null;
    try {
      return JSON.parse(text) as JsonValue;
    } catch {
      this.host.log("warn", `[LumiRPEngine] the stored blob ${hash} isn't the JSON it was written as, so it is read as missing`, userId);
      return null;
    }
  }

  /** The hash of every blob stored for the user (a put's temporary file isn't one). */
  async list(userId: UserId): Promise<string[]> {
    const out: string[] = [];
    for (const path of await this.host.storage.list(BLOBS_DIR, userId)) {
      const name = path.startsWith(BLOBS_DIR) ? path.slice(BLOBS_DIR.length) : "";
      if (isBlobHash(name)) out.push(name);
    }
    return out;
  }

  /** Removes a blob: the sweep's alone, for one nothing references. A put of it meanwhile writes it again after. */
  async remove(userId: UserId, hash: string): Promise<void> {
    const key = `${userId}\u0000${hash}`;
    const removal = this.host.storage.remove(blobPath(hash), userId);
    this.removing.set(key, removal);
    try {
      await removal;
    } finally {
      if (this.removing.get(key) === removal) this.removing.delete(key);
    }
  }

  // ---------------------------------------------------------------- work in flight

  /** `holder` holds the blob: the sweep counts it referenced until `release`. */
  hold(userId: UserId, holder: string, hash: string): void {
    if (!isBlobHash(hash)) return;
    const byHolder = this.holds.get(userId) ?? new Map<string, Set<string>>();
    this.holds.set(userId, byHolder);
    const held = byHolder.get(holder) ?? new Set<string>();
    byHolder.set(holder, held);
    held.add(hash);
  }

  /** Lets go of every blob `holder` held: its record or index points at them now, or it was cancelled and they are garbage. */
  release(userId: UserId, holder: string): void {
    const byHolder = this.holds.get(userId);
    if (!byHolder) return;
    byHolder.delete(holder);
    if (byHolder.size === 0) this.holds.delete(userId);
  }

  /** Every blob some holder of the user's holds now. */
  held(userId: UserId): Set<string> {
    const out = new Set<string>();
    for (const hashes of this.holds.get(userId)?.values() ?? []) for (const h of hashes) out.add(h);
    return out;
  }
}

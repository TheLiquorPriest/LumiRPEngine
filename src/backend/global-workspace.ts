// The user's global workspace (DESIGN §4.4): the files every chat of theirs shares, addressed under
// `~/` by the workspace tools and shown as GM → Workspace's Global group, kept apart from every
// chat's story. Its index, path → file (`KeptFile`: the body's blob hash, its pin and the role that
// wrote it last), is one file in the user's storage (`agents/global.json`, written temp-then-move; a
// damaged one is set aside and the index starts afresh); the bodies are blobs, shared with the
// chats', which the sweep keeps while the index names them (`refs`). A change lands at once outside
// a turn, and when the turn closes for a turn agent's, as a learned file's does: no swipe, Re-run or
// Undo changes it, and a Branch reads the same one as every other chat.

import type { UserId } from "../shared/ids";
import { isRecord, type JsonObject } from "../shared/json";
import { isGlobalPath, type KeptFile, keptFileJson, keptFileOf } from "../shared/stores";
import type { HostPort } from "./host";
import { readStoredJson } from "./stored-json";

/** Where the index lives in the user's storage (a fixed path, beside `agents/blobs/`). */
export const GLOBAL_INDEX_PATH = "agents/global.json";

/** The index as it is stored: each file by its path, `~/` and all. */
interface GlobalIndexFile {
  v: 1;
  files: Record<string, unknown>;
}

function isIndexFile(raw: unknown): raw is GlobalIndexFile {
  return isRecord(raw) && raw.v === 1 && isRecord(raw.files);
}

export class GlobalWorkspace {
  /** Each user's index as last read or written: this is its only writer, so the copy stands until the next write. */
  private readonly known = new Map<UserId, Promise<Readonly<Record<string, KeptFile>>>>();
  /** Each user's writes, one after another. */
  private readonly writes = new Map<UserId, Promise<unknown>>();

  constructor(private readonly host: Pick<HostPort, "storage" | "log">) {}

  /** The global workspace's files, by path (`~/…`). A read of the index that fails throws, and the next one tries again. */
  get(userId: UserId): Promise<Readonly<Record<string, KeptFile>>> {
    const known = this.known.get(userId);
    if (known) return known;
    const load = this.load(userId);
    this.known.set(userId, load);
    load.catch(() => {
      if (this.known.get(userId) === load) this.known.delete(userId);
    });
    return load;
  }

  /**
   * Changes the global workspace: a file puts it at its path (its body a blob the caller stored and
   * holds until this lands), null takes it out. Each user's changes land one after another, each on
   * the index the one before it left.
   */
  set(userId: UserId, changes: Readonly<Record<string, KeptFile | null>>): Promise<Readonly<Record<string, KeptFile>>> {
    for (const [path, file] of Object.entries(changes)) {
      if (!isGlobalPath(path)) throw new Error(`"${path}" isn't a path in the global workspace`);
      if (file !== null && keptFileOf(file) === null) throw new Error(`the global file at "${path}" isn't a stored file`);
    }
    const work = (this.writes.get(userId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const next: Record<string, KeptFile> = { ...(await this.get(userId)) };
        for (const [path, file] of Object.entries(changes)) {
          if (file === null) delete next[path];
          else next[path] = file;
        }
        const files: Record<string, JsonObject> = Object.fromEntries(Object.entries(next).map(([path, file]) => [path, keptFileJson(file)]));
        await this.host.storage.write(`${GLOBAL_INDEX_PATH}.tmp`, JSON.stringify({ v: 1, files }), userId);
        await this.host.storage.move(`${GLOBAL_INDEX_PATH}.tmp`, GLOBAL_INDEX_PATH, userId);
        this.known.set(userId, Promise.resolve(next));
        return next;
      });
    this.writes.set(userId, work);
    void work.finally(() => {
      if (this.writes.get(userId) === work) this.writes.delete(userId);
    });
    return work;
  }

  /** The blobs the index names: what the sweep keeps for it. A read that fails throws, so the sweep removes nothing. */
  async refs(userId: UserId): Promise<string[]> {
    return Object.values(await this.get(userId)).map((f) => f.hash);
  }

  private async load(userId: UserId): Promise<Readonly<Record<string, KeptFile>>> {
    const raw = await readStoredJson(this.host, GLOBAL_INDEX_PATH, userId, "global workspace", isIndexFile);
    const out: Record<string, KeptFile> = {};
    if (!isIndexFile(raw)) return out;
    // An entry that doesn't read (a damaged one, a path outside `~/`) is left out.
    for (const [path, entry] of Object.entries(raw.files)) {
      const file = isGlobalPath(path) ? keptFileOf(entry) : null;
      if (file) out[path] = file;
    }
    return out;
  }
}

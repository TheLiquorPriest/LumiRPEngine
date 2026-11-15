// The five storage calls today's world store makes of its host (`HostPort["storage"]`), over Build's
// own table: each user's files by storage path. Reads go to the database directly, as every read in
// RPE does; every write goes through the application's one write queue, so a file Build writes is
// written as any other write of RPE's is.
//
// Today's world store reaches its host through these five calls and its log alone (`worlds.ts`
// `readJson`, `writeJson`, `list`, `remove`; `stored-json.ts` setting a damaged file aside), so the
// host it is given here is those two, and nothing else of Lumiverse's.

import type { Database } from "bun:sqlite";
import type { Log } from "rp-harness/contract";
import type { WriteQueue } from "../app";
import type { HostPort } from "../shared/host";

export type BuildStorage = HostPort["storage"];

/** A storage path as Lumiverse keys it: no slash at either end. */
function clean(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

const PUT = "INSERT INTO build_file (user, path, body) VALUES (?, ?, ?) ON CONFLICT (user, path) DO UPDATE SET body = excluded.body";

/** Each user's files of Build's, by storage path, in the table `build_file`. */
export class BuildFiles implements BuildStorage {
  constructor(
    private readonly db: Database,
    private readonly writes: WriteQueue,
  ) {}

  async read(path: string, user: string): Promise<string | null> {
    return this.db.query<{ body: string }, [string, string]>("SELECT body FROM build_file WHERE user = ? AND path = ?").get(user, clean(path))?.body ?? null;
  }

  async write(path: string, data: string, user: string): Promise<void> {
    const at = clean(path);
    await this.writes.run((db) => db.run(PUT, [user, at, data]), "keeping a file of Build's");
  }

  /** Moves a file over whatever `to` held. Like Lumiverse's, it fails for a source that is not there. */
  async move(from: string, to: string, user: string): Promise<void> {
    const source = clean(from);
    const target = clean(to);
    await this.writes.run((db) => {
      const row = db.query<{ body: string }, [string, string]>("SELECT body FROM build_file WHERE user = ? AND path = ?").get(user, source);
      if (row === null) throw new Error(`File not found: ${source}`);
      if (source === target) return;
      db.run(PUT, [user, target, row.body]);
      db.run("DELETE FROM build_file WHERE user = ? AND path = ?", [user, source]);
    }, "moving a file of Build's");
  }

  /** Removes a file; one that is not there is already removed. */
  async remove(path: string, user: string): Promise<void> {
    const at = clean(path);
    await this.writes.run((db) => db.run("DELETE FROM build_file WHERE user = ? AND path = ?", [user, at]), "removing a file of Build's");
  }

  /** Every file under the prefix folder, at any depth, as full storage paths, sorted. */
  async list(prefix: string, user: string): Promise<string[]> {
    const base = clean(prefix);
    const rows =
      base === ""
        ? this.db.query<{ path: string }, [string]>("SELECT path FROM build_file WHERE user = ? ORDER BY path").all(user)
        : this.db.query<{ path: string }, [string, string]>("SELECT path FROM build_file WHERE user = ?1 AND substr(path, 1, length(?2)) = ?2 ORDER BY path").all(user, `${base}/`);
    return rows.map((r) => r.path);
  }
}

/** The host today's world store is given: Build's storage, and the application's log for what it says of a damaged file. */
export function worldHost(storage: BuildStorage, log: Log): HostPort {
  const host: Pick<HostPort, "storage" | "log"> = {
    storage,
    log: (level, message, user) => log[level](message, user === undefined ? undefined : { user }),
  };
  return host as HostPort;
}

// The worlds a migration carried, taken into Build's own table (plan §15.2, "Worlds"): after a run,
// each world the run copied into `world_file` is Build's to edit, as it was today's. A world Build has
// no files of is copied in. One whose files are still what an earlier run put there is replaced by
// this run's. One changed in RPE since (edited, committed or removed there) is kept as it is, and said
// so: a later run never undoes what was done in RPE.
//
// What "what an earlier run put there" is: each world's files as a run copied them in, kept as one
// fingerprint in `build_seed`.

import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

/** What became of each world the run carried, by world id. */
export interface WorldsSeeded {
  /** Build had no files of it: they are copied in. */
  copied: string[];
  /** Build's copy was still as an earlier run put it: this run's files replace it. */
  replaced: string[];
  /** Build's copy is what this run carried already: nothing to do. */
  unchanged: string[];
  /** Changed in RPE since an earlier run put it there, or made in RPE (removed there too): kept as it is, this run's files not taken. */
  kept: string[];
}

interface File {
  path: string;
  body: string;
}

/** One fingerprint of a world's files: each path with its content's hash, in path order. */
function fingerprint(files: readonly File[]): string {
  const all = createHash("sha256");
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) all.update(`${f.path}\u0000${createHash("sha256").update(f.body).digest("hex")}\n`);
  return all.digest("hex");
}

/**
 * Takes the worlds the user's last migration run carried (`world_file`) into Build's table, in one
 * transaction on `db`: the migration's own connection, or the application's inside its write queue.
 */
export function seedCarriedWorlds(db: Database, user: string): WorldsSeeded {
  const decoder = new TextDecoder();
  const carried = new Map<string, { run: string; files: File[] }>();
  for (const row of db.query<{ world: string; file: string; bytes: Uint8Array; run: string }, [string]>("SELECT world, file, bytes, run FROM world_file WHERE user = ? ORDER BY world, file").all(user)) {
    const at = carried.get(row.world) ?? { run: row.run, files: [] };
    at.files.push({ path: `worlds/${row.world}/${row.file}`, body: decoder.decode(row.bytes) });
    carried.set(row.world, at);
  }
  const out: WorldsSeeded = { copied: [], replaced: [], unchanged: [], kept: [] };
  db.transaction(() => {
    const mine = db.query<File, [string, string]>("SELECT path, body FROM build_file WHERE user = ?1 AND substr(path, 1, length(?2)) = ?2");
    const seeded = db.query<{ files: string }, [string, string]>("SELECT files FROM build_seed WHERE user = ? AND world = ?");
    const put = db.query("INSERT INTO build_file (user, path, body) VALUES (?, ?, ?)");
    const seed = db.query("INSERT INTO build_seed (user, world, files, run) VALUES (?, ?, ?, ?) ON CONFLICT (user, world) DO UPDATE SET files = excluded.files, run = excluded.run");
    for (const [world, { run, files }] of carried) {
      const folder = `worlds/${world}/`;
      const held = mine.all(user, folder);
      const earlier = seeded.get(user, world)?.files ?? null;
      const now = fingerprint(files);
      let into: keyof WorldsSeeded;
      if (earlier === null) into = held.length === 0 ? "copied" : "kept";
      else if (fingerprint(held) !== earlier) into = "kept";
      else into = now === earlier ? "unchanged" : "replaced";
      out[into].push(world);
      if (into !== "copied" && into !== "replaced") continue;
      db.run("DELETE FROM build_file WHERE user = ?1 AND substr(path, 1, length(?2)) = ?2", [user, folder]);
      for (const f of files) put.run(user, f.path, f.body);
      seed.run(user, world, now, run);
    }
  })();
  return out;
}

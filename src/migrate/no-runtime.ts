// `--no-runtime` (the server runs no runtime of the previous build for this user) is taken at your word: the run reads no runtime.
// But where Lumiverse's storage holds the registration of this user's runtime, or the runtime's folders hold it, what the run then
// leaves out is said at the head of the report, in the words below: the runtime found, its folders, and each thing not carried
// because of it, with its count. The rehearsal, the real run, what `rpe up` prints given `--no-runtime` and the Migration page all say it
// from the one report that holds it.

import { existsSync } from "node:fs";
import { classifyRuntime } from "./classify";
import { ROWS, type RowId } from "./rows";
import type { RuntimeFolders, RuntimeRead } from "./runtime-folders";

/** What `--no-runtime` leaves out: the runtime found all the same, where its folders are, and what is therefore not carried. */
export interface Disowned {
  /** The folders the run was told not to read, and whether each is there. */
  folders: { configDir: string; dataDir: string; configThere: boolean; dataThere: boolean };
  /** The names of the runtimes Lumiverse's storage registers for this user. */
  registered: string[];
  /** The runtime the run would have taken, and why it is this user's; null where none would have been taken. */
  runtime: { name: string; why: string } | null;
  /** Runtime folders no config names that are this user's, by name, with why. */
  archived: { name: string; why: string }[];
  /** Whether a config signs in as this user's name and the run could not tell which runtime is theirs. */
  undecided: boolean;
  /** Each thing of the runtime the run does not carry because of it, with how many. */
  notCarried: { what: string; count: number; unit: string }[];
}

/**
 * What `--no-runtime` leaves out, read from the runtime's folders as a run would have read them: null where nothing of this user's runtime
 * is found, neither a registration in `registered` nor a runtime in the folders. `off` is how many chats are pinned to a connection in
 * Lumiverse that reaches the runtime, and so would have been on RPE's connections.
 */
export function disownedOf(folders: RuntimeFolders, read: RuntimeRead, registered: readonly string[], off: number): Disowned | null {
  const runtime = read.runtimes[0] ?? null;
  const undecided = read.undecided !== null;
  if (registered.length === 0 && runtime === null && read.archived.length === 0 && !undecided) return null;
  const counts = new Map<RowId, number>();
  for (const f of read.files) {
    if (f.link) continue;
    const row = f.working !== undefined ? "working-copy" : (classifyRuntime(f.path)?.row ?? null);
    if (row !== null) counts.set(row, (counts.get(row) ?? 0) + 1);
  }
  const notCarried: Disowned["notCarried"] = [];
  for (const r of ROWS) {
    const count = counts.get(r.id) ?? 0;
    if (count > 0) notCarried.push({ what: r.what, count, unit: "file(s)" });
  }
  if (read.runtimes.length > 0) notCarried.push({ what: ROWS.find((r) => r.id === "link-credentials")?.what ?? "The old link's credentials", count: read.runtimes.length * 2, unit: "credential(s)" });
  const unsent = read.unsent.filter((u) => u.kept).reduce((n, u) => n + u.files.size, 0);
  if (unsent > 0) notCarried.push({ what: "What the runtime's working copy had not sent to your storage yet, which the run would lay over it as the runtime would send it", count: unsent, unit: "file(s)" });
  if (off > 0) notCarried.push({ what: "Chats pinned to a connection in Lumiverse that reaches the runtime, which are on RPE's connections only with it, and are listed as still off RPE", count: off, unit: "chat(s)" });
  return {
    folders: { configDir: folders.configDir, dataDir: folders.dataDir, configThere: existsSync(folders.configDir), dataThere: existsSync(folders.dataDir) },
    registered: [...registered],
    runtime: runtime === null ? null : { name: runtime.name, why: runtime.why },
    archived: read.archived,
    undecided,
    notCarried,
  };
}

/** The words that say it, a line each. */
export function disownedLines(d: Disowned): string[] {
  const { configDir, dataDir, configThere, dataThere } = d.folders;
  const where = `config ${configDir}, data ${dataDir}`;
  const places = `config ${configDir}${configThere ? "" : " (not there)"}, data ${dataDir}${dataThere ? "" : " (not there)"}`;
  const lines = ["You said (--no-runtime) that the server runs no runtime of the previous build for this user."];
  if (d.registered.length > 0) {
    lines.push(`Lumiverse's storage holds the registration of this user's runtime ${d.registered.join(", ")}, and ${configThere || dataThere ? `its folders are there: ${places}` : `its folders are not there (${where}), so there is nothing of it to carry`}.`);
  } else {
    const named = d.runtime !== null ? `${d.runtime.name} (${d.runtime.why})` : d.archived.length > 0 ? `a working copy of this user's data (${d.archived.map((a) => a.name).join(", ")})` : "a runtime that signs in as this user's name";
    lines.push(`Lumiverse's storage holds no registration of a runtime for this user, but the runtime's folders (${places}) hold ${named}.`);
  }
  if (d.notCarried.length > 0) {
    lines.push("The run does not read it, so it does not carry:");
    for (const n of d.notCarried) lines.push(`  ${n.what}: ${n.count} ${n.unit}`);
    lines.push("To carry them, run again without --no-runtime.");
  }
  return lines;
}

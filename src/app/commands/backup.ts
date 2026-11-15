// `rpe backup`: one archive of the database and the file tree.

import type { CliIO } from "../cli";
import { makeBackup } from "../backup";
import type { DataPaths } from "../config";

export async function backupCommand(paths: DataPaths, out: string | undefined, io: CliIO): Promise<number> {
  const made = await makeBackup(paths, io.now(), out);
  io.out(`Backed up the database and ${made.files} files of the tree to ${made.path} (${(made.bytes / 1048576).toFixed(1)} MiB, sha256 ${made.sha256}).`);
  if (made.skipped.length > 0) io.out(`Left out, being links: ${made.skipped.join(", ")}.`);
  return 0;
}

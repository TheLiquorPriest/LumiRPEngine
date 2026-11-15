// `rpe version` (also `rpe --version`): this build's id alone. No data folder is read and nothing is asked over the network.

import type { CliIO } from "../cli";
import { UsageError } from "./args";

export function versionCommand(command: string, words: readonly string[], io: CliIO, version: string): number {
  if (words.length > 0) throw new UsageError(`rpe ${command} takes nothing more.`);
  io.out(`rpe ${version}`);
  return 0;
}

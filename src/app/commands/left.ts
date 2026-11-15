// What `rpe up` leaves for the user to do.

import { EXTENSION_IDENTIFIER } from "../../adapter/lumiverse/pipe-wire";
import type { CliIO } from "../cli";
import { installedExtension, type LumiverseCall } from "../../adapter/lumiverse/install-calls";

/** The lines of what is left for the user to do. */
export function sayLeft(left: readonly string[], io: CliIO): void {
  io.out("");
  io.out("What is left for you to do:");
  left.forEach((line, i) => io.out(`  ${i + 1}. ${line}`));
}

/** What is left in Lumiverse for RPE's extension: installed, and on. */
export async function extensionLeft(call: LumiverseCall): Promise<string[]> {
  const extension = await installedExtension(call, EXTENSION_IDENTIFIER);
  if (extension === null) return ["Install RPE's extension in Lumiverse, from its git repository's standalone branch, and have an admin approve the permissions it asks for."];
  return extension.on ? [] : ["Switch RPE's extension on in Lumiverse."];
}

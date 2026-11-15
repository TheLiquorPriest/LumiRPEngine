// `rpe allow <name>` and `rpe deny <name>`: the one way anything that runs a command or calls out is switched on or off.

import type { CliIO } from "../cli";
import type { AppConfig, DataPaths } from "../config";
import { withWriter } from "./writer";

export async function switchCommand(name: string, state: "on" | "off", paths: DataPaths, config: AppConfig, io: CliIO, version: string): Promise<number> {
  const { entry, listed } = await withWriter({ paths, config, io, version, what: `rpe ${state === "on" ? "allow" : "deny"}` }, (ops) => ops.setSwitch(name, state), { forUser: true });
  if (entry === null) {
    io.err(`Nothing called "${name}" is listed. ${listed.length === 0 ? "Nothing is listed yet." : `Listed: ${listed.map((s) => `${s.name} (${s.state})`).join(", ")}.`}`);
    return 1;
  }
  io.out(state === "on" ? `"${entry.name}" (${entry.kind}) is on. It may now run: ${entry.what}` : `"${entry.name}" (${entry.kind}) is off.`);
  return 0;
}

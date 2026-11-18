// `rpe allow <name>` and `rpe deny <name>`: the one way anything that runs a command or calls out is switched on or off;
// `rpe allow` with no name lists each user's own things and where each stands.

import type { SwitchEntry } from "../switches";
import type { CliIO } from "../cli";
import type { AppConfig, DataPaths } from "../config";
import { runLine } from "./run-line";
import { STOPPED_LISTING } from "./words";
import { withWriter } from "./writer";

/** Switches the newest definition of `name` for `user` (this RPE's user where none is named) on or off. */
export async function switchCommand(name: string, state: "on" | "off", user: string | undefined, paths: DataPaths, config: AppConfig, io: CliIO, version: string): Promise<number> {
  const { entry, listed, via } = await withWriter({ paths, config, io, version, what: `rpe ${state === "on" ? "allow" : "deny"}` }, async (ops, via) => ({ ...(await ops.setSwitch(name, state, user)), via }), { forUser: true });
  if (entry === null) {
    io.err(`Nothing called "${name}" is listed${user === undefined ? "" : ` for user ${user}`}. ${listed.length === 0 ? "Nothing is listed yet." : `Listed: ${listed.map((s) => `${s.name} (${s.state})`).join(", ")}.`}${via === "folder" ? ` ${STOPPED_LISTING}` : ""}`);
    return 1;
  }
  io.out(state === "on" ? `"${entry.name}" (${entry.kind}) is on. It may now run or call: ${entry.what}` : `"${entry.name}" (${entry.kind}) is off.`);
  return 0;
}

/** One line of the list: what it is, where it stands, what it runs or calls. */
function line(s: SwitchEntry): string {
  return `  ${s.name} (${s.kind}): ${s.state}. ${s.state === "waiting" ? "Would run or call" : "Runs or calls"}: ${s.what}`;
}

/** `rpe allow` with no name: each user's own things and their states, `user` alone where one is named. */
export async function listSwitchesCommand(user: string | undefined, paths: DataPaths, config: AppConfig, io: CliIO, version: string): Promise<number> {
  const { switches, via } = await withWriter({ paths, config, io, version, what: "rpe allow" }, async (ops, via) => ({ ...(await ops.status()), via }), { forUser: true });
  const shown = user === undefined ? switches : switches.filter((s) => s.user === user);
  const stopped = via === "folder";
  if (shown.length === 0) {
    io.out(`Nothing is listed${user === undefined ? "" : ` for user ${user}`} yet: RPE lists a thing here, waiting, when one of your files names it, or when it is first asked to run it or call it.`);
    if (stopped) io.out(STOPPED_LISTING);
    return 0;
  }
  for (const who of [...new Set(shown.map((s) => s.user))]) {
    io.out(`User ${who}${who === config.lumiverse.user ? " (this RPE's)" : ""}:`);
    for (const s of shown.filter((s) => s.user === who)) io.out(line(s));
  }
  const waiting = shown.find((s) => s.state === "waiting");
  if (waiting !== undefined) io.out(`Switch one on with: ${runLine(io, paths, "allow", waiting.name, ...(waiting.user === config.lumiverse.user ? [] : ["--user", waiting.user]))}`);
  if (stopped) io.out(STOPPED_LISTING);
  return 0;
}

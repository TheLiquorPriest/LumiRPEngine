// What a line printed for root has root run (the final security review's last finding, S-1). The
// copies in SYSTEM_RELAY_DIR hold what a system relay's account read from its own install, and the
// refusal that keeps root from running them is their own code, so a changed copy needn't refuse: the
// lines root is given must never run one. A command after `sudo` (not `sudo -u <account>`) runs as
// root, and so does one the pasting shell runs itself, since that shell may be root's.

import { SYSTEM_RELAY_DIR } from "../../src/shared/loopback";

/** The programs a system relay's lines may have root run: systemd's own, and the shell's own scratch. */
export const SYSTEM_RELAY_ROOT_PROGRAMS: readonly string[] = ["systemctl", "install", "rm", "mktemp", "test"];

/** The words of each command `line` has root run, unquoted, its redirections left out. */
export function rootRuns(line: string): string[][] {
  return line.split(/\s*(?:&&|\|\||;|\|)\s*/).flatMap((command) => {
    let words = command
      .trim()
      .split(/\s+/)
      .filter((w) => w !== "" && !/^[0-9]?[<>]/.test(w))
      .map((w) => w.replaceAll(/['"]/g, ""));
    // `t=$(mktemp …)`: the command in the substitution.
    const assigned = /^\w+=\$\((.*)$/.exec(words[0] ?? "");
    if (assigned !== null) words = [assigned[1] ?? "", ...words.slice(1)].map((w) => w.replace(/\)$/, "")).filter((w) => w !== "");
    if (words[0] === "sudo") {
      if (words[1] === "-u" && words[2] !== "root" && words[2] !== "#0") return [];
      words = words.slice(words[1] === "-u" ? 3 : 1);
    }
    return words.length > 0 ? [words] : [];
  });
}

/** Whether `path` is in SYSTEM_RELAY_DIR. */
const inCopies = (path: string): boolean => path === SYSTEM_RELAY_DIR || path.startsWith(`${SYSTEM_RELAY_DIR}/`);

/**
 * The first word of a command root runs (`rootRuns`) that is in SYSTEM_RELAY_DIR, other than where
 * `install` writes, or null: a program run from there, or a file handed to one (a script to Bun).
 */
export function copyRun(words: readonly string[]): string | null {
  return words.find((w, i) => inCopies(w) && !(words[0] === "install" && i === words.length - 1)) ?? null;
}

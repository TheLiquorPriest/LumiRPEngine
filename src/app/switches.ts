// The switch for anything that runs a command or calls out (plan §16): hooks, rule commands, command
// tools, an MCP server started by a command, and the address an HTTP tool or an MCP server calls.
// Each is listed by its name and by exactly what it runs or calls. A definition RPE has not seen
// before is listed as waiting, and only `rpe allow` and `rpe deny` on the server switch one on or
// off. A switch holds the definition the user was shown: when what a name runs changes, the new
// definition waits again, so whoever can edit a file still cannot change what an allowed name runs.
//
// No API route can switch anything. The server's own connection is guarded so that it can only add
// a definition as waiting, never switch one, change one or take one away; the command line opens a
// connection of its own, which carries no guard.

import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type { WriteQueue } from "./database";

export type SwitchState = "waiting" | "on" | "off";

export interface SwitchEntry {
  name: string;
  /** What sort of thing it is, in the words of the area that lists it (a hook, an MCP server, …). */
  kind: string;
  /** Exactly what it runs or calls, as the user approves it. */
  what: string;
  state: SwitchState;
  /** When this definition was first listed. */
  listed: number;
  /** When the command line last switched it; null if never. */
  changed: number | null;
}

const GUARD_WORDS = "Only the command line on the server (rpe allow, rpe deny) changes a switch.";

/**
 * Holds the server's connection to adding definitions as waiting. Run once on it, after the
 * migrations and before anything else uses it. The triggers are the connection's own (TEMP), so no
 * other connection to the file is held by them.
 */
export function guardSwitches(db: Database): void {
  // A REPLACE takes the old row away without firing its delete trigger unless triggers recurse.
  db.run("PRAGMA recursive_triggers = ON");
  db.run(`CREATE TEMP TRIGGER switch_added_waiting BEFORE INSERT ON main.switch WHEN NEW.state <> 'waiting' BEGIN SELECT RAISE(ABORT, '${GUARD_WORDS}'); END`);
  db.run(`CREATE TEMP TRIGGER switch_kept BEFORE UPDATE ON main.switch BEGIN SELECT RAISE(ABORT, '${GUARD_WORDS}'); END`);
  db.run(`CREATE TEMP TRIGGER switch_not_removed BEFORE DELETE ON main.switch BEGIN SELECT RAISE(ABORT, '${GUARD_WORDS}'); END`);
}

/** What keys a definition besides its name: the hash of its kind and what it runs or calls. */
export function switchDigest(kind: string, what: string): string {
  return createHash("sha256").update(`${kind}\n${what}`).digest("hex");
}

/** Each name's newest definition, by name. */
export function listSwitches(db: Database): SwitchEntry[] {
  const newest = new Map<string, SwitchEntry>();
  for (const row of db.query<SwitchEntry, []>("SELECT name, kind, what, state, listed, changed FROM switch ORDER BY name, listed, rowid").all()) newest.set(row.name, row);
  return [...newest.values()];
}

/**
 * The command line's switch: sets the newest definition listed under `name` on or off and returns
 * it; null when nothing of that name is listed. For the command line's own connection: on the
 * server's, the guard refuses it.
 */
export function setSwitch(db: Database, name: string, state: "on" | "off", now: number): SwitchEntry | null {
  const row = db.query<SwitchEntry & { id: number }, [string]>("SELECT rowid AS id, name, kind, what, state, listed, changed FROM switch WHERE name = ? ORDER BY listed DESC, rowid DESC LIMIT 1").get(name);
  if (row === null) return null;
  db.run("UPDATE switch SET state = ?, changed = ? WHERE rowid = ?", [state, now, row.id]);
  const { id: _id, ...entry } = row;
  return { ...entry, state, changed: now };
}

/** The server's side: what is listed, and whether one definition may run now. */
export class Switches {
  constructor(
    private readonly db: Database,
    private readonly writes: WriteQueue,
    private readonly now: () => number,
  ) {}

  list(): SwitchEntry[] {
    return listSwitches(this.db);
  }

  /**
   * Whether `name`, defined as `kind` running or calling `what`, may run now: on, off, or waiting
   * for the user. A definition seen for the first time is listed as waiting, for `rpe allow`.
   */
  async check(name: string, kind: string, what: string): Promise<SwitchState> {
    if (name.trim() === "" || name.length > 200 || /[\u0000-\u001f]/.test(name)) throw new Error("A switch's name is one line of text of at most 200 characters.");
    if (kind.trim() === "") throw new Error(`Say what sort of thing ${name} is.`);
    const digest = switchDigest(kind, what);
    const row = this.db.query<{ state: SwitchState }, [string, string]>("SELECT state FROM switch WHERE name = ? AND digest = ?").get(name, digest);
    if (row !== null) return row.state;
    await this.writes.run((db) => db.run("INSERT OR IGNORE INTO switch (name, digest, kind, what, state, listed) VALUES (?, ?, ?, ?, 'waiting', ?)", [name, digest, kind, what, this.now()]), `listing ${name} as waiting`);
    return "waiting";
  }
}

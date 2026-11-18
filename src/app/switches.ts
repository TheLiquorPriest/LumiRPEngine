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
//
// The registry is each user's own: a thing on for one user is not on for another of the same kind, name
// and target. RPH asks it through its `switches` port (`Switches.state`) before anything runs a command
// or calls out, and before a provider key goes to a connection whose place changed; a thing it has not
// seen for that user is listed as waiting at that moment.

import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type { Switchable, SwitchesPort } from "rp-harness/contract";
import { LIMIT_DEFAULTS } from "./config";
import type { WriteQueue } from "./database";

export type SwitchState = "waiting" | "on" | "off";

export interface SwitchEntry {
  /** The user whose own it is. */
  user: string;
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
 * other connection to the file is held by them. They give way only inside `asCommand`, which the
 * server's command routes alone call: the command line's own switching, made by the one writer.
 */
export function guardSwitches(db: Database): void {
  // A REPLACE takes the old row away without firing its delete trigger unless triggers recurse.
  db.run("PRAGMA recursive_triggers = ON");
  db.run("CREATE TEMP TABLE IF NOT EXISTS switch_command (held INTEGER)");
  const unlessCommand = "NOT EXISTS (SELECT 1 FROM temp.switch_command)";
  db.run(`CREATE TEMP TRIGGER switch_added_waiting BEFORE INSERT ON main.switch WHEN NEW.state <> 'waiting' AND ${unlessCommand} BEGIN SELECT RAISE(ABORT, '${GUARD_WORDS}'); END`);
  db.run(`CREATE TEMP TRIGGER switch_kept BEFORE UPDATE ON main.switch WHEN ${unlessCommand} BEGIN SELECT RAISE(ABORT, '${GUARD_WORDS}'); END`);
  db.run(`CREATE TEMP TRIGGER switch_not_removed BEFORE DELETE ON main.switch WHEN ${unlessCommand} BEGIN SELECT RAISE(ABORT, '${GUARD_WORDS}'); END`);
}

/**
 * Runs `change` as the server's own command line: the guard of `guardSwitches` does not hold for it.
 * Inside a write of the queue; on a connection that is not guarded it changes nothing.
 */
export function asCommand<T>(db: Database, change: () => T): T {
  db.run("CREATE TEMP TABLE IF NOT EXISTS switch_command (held INTEGER)");
  db.run("INSERT INTO temp.switch_command (held) VALUES (1)");
  try {
    return change();
  } finally {
    db.run("DELETE FROM temp.switch_command");
  }
}

/** What keys a definition besides its name: the hash of its kind and what it runs or calls. */
export function switchDigest(kind: string, what: string): string {
  return createHash("sha256").update(`${kind}\n${what}`).digest("hex");
}

/** Each name's newest definition listed for `user`, by name. */
export function listSwitches(db: Database, user: string): SwitchEntry[] {
  const newest = new Map<string, SwitchEntry>();
  for (const row of db.query<SwitchEntry, [string]>("SELECT user, name, kind, what, state, listed, changed FROM switch WHERE user = ? ORDER BY name, listed, rowid").all(user)) newest.set(row.name, row);
  return [...newest.values()];
}

/** Each user's own: every name's newest definition for each user the registry lists a thing for, by user and name. */
export function listAllSwitches(db: Database): SwitchEntry[] {
  const newest = new Map<string, SwitchEntry>();
  for (const row of db.query<SwitchEntry, []>("SELECT user, name, kind, what, state, listed, changed FROM switch ORDER BY user, name, listed, rowid").all()) newest.set(JSON.stringify([row.user, row.name]), row);
  return [...newest.values()];
}

/**
 * The command line's switch: sets the newest definition listed for `user` under `name` on or off and
 * returns it; null when nothing of that name is listed for him. For the command line's own
 * connection: on the server's, the guard refuses it.
 */
export function setSwitch(db: Database, user: string, name: string, state: "on" | "off", now: number): SwitchEntry | null {
  const row = db.query<SwitchEntry & { id: number }, [string, string]>("SELECT rowid AS id, user, name, kind, what, state, listed, changed FROM switch WHERE user = ? AND name = ? ORDER BY listed DESC, rowid DESC LIMIT 1").get(user, name);
  if (row === null) return null;
  db.run("UPDATE switch SET state = ?, changed = ? WHERE rowid = ?", [state, now, row.id]);
  const { id: _id, ...entry } = row;
  return { ...entry, state, changed: now };
}

/**
 * The server's side: RPH's `switches` port, backed by the registry, and what is listed for the user this
 * RPE belongs to. `nameLength` is the longest name it takes (`switches.maxNameChars`).
 */
export class Switches implements SwitchesPort {
  constructor(
    private readonly db: Database,
    private readonly writes: WriteQueue,
    private readonly now: () => number,
    private readonly user: string,
    private readonly nameLength: number = LIMIT_DEFAULTS.switches.nameLength,
  ) {}

  /** What is listed for the user this RPE belongs to. */
  list(): SwitchEntry[] {
    return listSwitches(this.db, this.user);
  }

  /**
   * Where `thing` stands for `user`: on, off, or waiting. A definition seen for the first time for that
   * user is listed as waiting, for `rpe allow`; what is on for another user is not on for this one.
   */
  async state(user: string, thing: Switchable): Promise<SwitchState> {
    const { name, kind, target: what } = thing;
    if (name.trim() === "" || name.length > this.nameLength || /[\u0000-\u001f]/.test(name)) throw new Error(`A switch's name is one line of text of at most ${this.nameLength} characters (the setting switches.maxNameChars).`);
    if (kind.trim() === "") throw new Error(`Say what sort of thing ${name} is.`);
    const digest = switchDigest(kind, what);
    const row = this.db.query<{ state: SwitchState }, [string, string, string]>("SELECT state FROM switch WHERE user = ? AND name = ? AND digest = ?").get(user, name, digest);
    if (row !== null) return row.state;
    await this.writes.run((db) => db.run("INSERT OR IGNORE INTO switch (user, name, digest, kind, what, state, listed) VALUES (?, ?, ?, ?, ?, 'waiting', ?)", [user, name, digest, kind, what, this.now()]), `listing ${name} as waiting`);
    return "waiting";
  }
}

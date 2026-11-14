// The scripts' memory of what they made: `state.json` holds the ids a later run looks for before it
// makes anything (so a second run makes no second copy), and `changes.jsonl` is the change log, one
// line per thing created, changed, played or deleted, each with its id.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Change {
  /** The step that made the change (`world`, `chats`, …). */
  step: string;
  action: "created" | "changed" | "played" | "deleted" | "placed";
  /** What kind of thing: a world, a chat, a message, a setting… */
  kind: string;
  id: string;
  name?: string;
  detail?: Json;
}

export class RunLog {
  private readonly statePath: string;
  private readonly logPath: string;
  private state: { [key: string]: Json };

  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.statePath = join(dir, "state.json");
    this.logPath = join(dir, "changes.jsonl");
    this.state = existsSync(this.statePath) ? (JSON.parse(readFileSync(this.statePath, "utf8")) as { [key: string]: Json }) : {};
  }

  get<T extends Json>(key: string): T | undefined {
    return this.state[key] as T | undefined;
  }

  /** Remembers a value and writes the state at once, so a run cut short still knows what it made. */
  set(key: string, value: Json): void {
    this.state[key] = value;
    const temp = `${this.statePath}.tmp`;
    writeFileSync(temp, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, this.statePath);
  }

  /** One line of the change log, also printed. */
  log(change: Change): void {
    const line = { at: new Date().toISOString(), ...change };
    appendFileSync(this.logPath, `${JSON.stringify(line)}\n`, { mode: 0o600 });
    console.log(`  ${change.action} ${change.kind} ${change.id}${change.name ? ` (${change.name})` : ""}`);
  }

  /** Whether a step already finished in an earlier run; a step marks itself done only at its end. */
  done(step: string): boolean {
    return this.get<boolean>(`done:${step}`) === true;
  }

  finish(step: string): void {
    this.set(`done:${step}`, true);
  }

  /** Runs a part of a step once: a later run skips a part an earlier run finished. */
  async once(part: string, run: () => Promise<void>): Promise<void> {
    if (this.done(part)) return;
    say(`  ${part}`);
    await run();
    this.finish(part);
  }
}

/** A note to the console, for what a run found or waited on (the change log holds only changes). */
export function say(text: string): void {
  console.log(`${new Date().toISOString().slice(11, 19)} ${text}`);
}

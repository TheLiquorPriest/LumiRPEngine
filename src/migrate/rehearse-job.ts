// A rehearsal started from the Migration page (plan §15.3 step 1; R-180, R-4): the running RPE reads today's data as
// `rpe migrate --rehearse` does and holds the report in memory, one per user, beside the last real run's, until the next
// rehearsal or until RPE stops. Nothing of it is written anywhere, RPE's database included, not even a job's row: the route
// that starts it is a long one, whose answer the server keeps in memory too. The chats' names as Lumiverse holds them are
// held with it, for the page, and never put in the report.

import type { JsonObject } from "../shared/json";
import { LumiverseDb } from "./lumiverse-db";
import type { MigrationReport } from "./report";
import { reportText } from "./report";
import type { Sources } from "./today";

/** Where the user's rehearsal stands: none started since RPE started, under way since a time, ready with its report and its text, or failed with why. */
export type HeldRehearsal =
  | { state: "none" }
  | { state: "running"; since: number }
  | { state: "ready"; report: MigrationReport; text: string; names: ReadonlyMap<string, string> }
  | { state: "failed"; why: string };

export class RehearsalRunning extends Error {
  override name = "RehearsalRunning";
}

/** The rehearsals of the page, by user, held in memory; and the chats' names Lumiverse holds for a report's folders, read once each. */
export class Rehearsals {
  readonly #held = new Map<string, HeldRehearsal>();
  readonly #names = new Map<string, ReadonlyMap<string, string>>();

  constructor(
    /** Reads today's data for `user` from `sources` and makes the report, writing nothing (`migrate.ts` `rehearsal`). */
    private readonly read: (sources: Sources) => Promise<{ report: MigrationReport; names: Map<string, string> }>,
    private readonly now: () => number,
  ) {}

  held(user: string): HeldRehearsal {
    return this.#held.get(user) ?? { state: "none" };
  }

  /** Starts the user's rehearsal over `sources` and resolves to its report once read; one under way already is refused. */
  async start(sources: Sources): Promise<MigrationReport> {
    const user = sources.userId;
    if (this.held(user).state === "running") throw new RehearsalRunning("A rehearsal is under way already: its report is shown here once it is read.");
    this.#held.set(user, { state: "running", since: this.now() });
    try {
      const { report, names } = await this.read(sources);
      this.#held.set(user, { state: "ready", report, text: reportText(report), names });
      return report;
    } catch (error) {
      // A fixed reason where the reader's words could quote what a file holds: the report and the page hold no content.
      this.#held.set(user, { state: "failed", why: error instanceof Error ? error.message : "the rehearsal stopped" });
      throw error;
    }
  }

  /**
   * The chats' names as Lumiverse holds them, for a report read from `lumiverse` for `user`: the rehearsal's own, or read
   * once through the migration's door to Lumiverse's database; none where that database can't be read.
   */
  names(user: string, lumiverse: string | null): ReadonlyMap<string, string> {
    const held = this.held(user);
    if (held.state === "ready" && held.report.sources?.lumiverse === lumiverse) return held.names;
    if (lumiverse === null) return new Map();
    const key = `${user}\u0000${lumiverse}`;
    const known = this.#names.get(key);
    if (known !== undefined) return known;
    let read: ReadonlyMap<string, string> = new Map();
    try {
      const db = LumiverseDb.open(lumiverse, user);
      try {
        read = new Map(db.chats().map((c) => [c.id, c.name]));
      } finally {
        db.close();
      }
    } catch {
      // Lumiverse's database is not where the report read it, or not one RPE reads: the page names chats by id.
    }
    this.#names.set(key, read);
    return read;
  }

  /** Each of the user's chats' metadata as Lumiverse holds it now, read through the migration's door; null where Lumiverse's database can't be read. */
  chats(user: string, lumiverse: string | null): ReadonlyMap<string, JsonObject> | null {
    if (lumiverse === null) return null;
    try {
      const db = LumiverseDb.open(lumiverse, user);
      try {
        return new Map(db.chats().map((c) => [c.id, c.metadata]));
      } finally {
        db.close();
      }
    } catch {
      return null;
    }
  }
}

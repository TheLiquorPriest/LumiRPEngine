// What RPH tells RPE as a turn goes (`TurnEvents` in `rp-harness/contract`). None of it returns a
// decision: RPE records it with the turn and shows it. The intent record is kept on the turn as text and
// never read by code (plan §10.3). A sub-agent's writes the lead drops are taken back from the turn's
// staged changes. Rules that fired, consents, gap checks, suggestions and the attachments an agent was
// given are kept with the turn (`turn_told`) for the Turn page.

import type { Database } from "bun:sqlite";
import type { Log, Scope, TurnEvents } from "rp-harness/contract";
import type { Store } from "../store";
import type { Writes } from "./kv";
import type { Runs } from "./runs";

export interface EventsDeps {
  db: Database;
  writes: Writes;
  store: Store;
  runs: Runs;
  now(): number;
  log: Log;
}

/** One thing told, kept with its turn. */
export interface Told {
  kind: string;
  body: unknown;
  at: number;
}

export function toldOf(db: Database, user: string, turn: string): Told[] {
  return db
    .query<{ kind: string; body: string; at: number }, [string, string]>("SELECT kind, body, at FROM turn_told WHERE user = ? AND turn = ? ORDER BY id")
    .all(user, turn)
    .map((r) => ({ kind: r.kind, body: JSON.parse(r.body) as unknown, at: r.at }));
}

export function turnEvents(deps: EventsDeps): TurnEvents {
  const turnOf = (scope: Scope): string => {
    if (scope.turn === undefined) throw new Error("RPH told RPE of a turn's work with no turn named.");
    return scope.turn;
  };
  const tell = async (scope: Scope, kind: string, body: unknown): Promise<void> => {
    const turn = turnOf(scope);
    await deps.writes.run((db) => db.run("INSERT INTO turn_told (user, turn, kind, body, at) VALUES (?, ?, ?, ?, ?)", [scope.user, turn, kind, JSON.stringify(body), deps.now()]), "keeping what RPH told of a turn");
  };
  return {
    async intent(scope, text) {
      const turn = turnOf(scope);
      await deps.writes.run(() => deps.store.user(scope.user).updateTurn(turn, { intent: text }), "keeping the intent record");
    },
    async attachments(scope, agent, refs) {
      await tell(scope, "attachments", { agent, refs });
      // RPE resolves none of its own spaces yet (the world, the story, the cast come with their lanes): each is left out, and RPH says so.
      return [];
    },
    consent: (scope, grant) => tell(scope, "consent", grant),
    gapCheck: (scope, check) => tell(scope, "gap-check", check),
    async dropStaged(scope, agent) {
      const turn = turnOf(scope);
      await deps.writes.run(() => deps.store.user(scope.user).dropStaged(turn, agent.id), "dropping a sub-agent's staged changes");
      await tell(scope, "dropped", { agent });
    },
    ruleFired: (scope, firing) => tell(scope, "rule", firing),
    suggestion: (scope, agent, suggestion) => tell(scope, "suggestion", { agent, suggestion }),
    async released(scope, release) {
      const run = deps.runs.running(scope.user, turnOf(scope));
      if (run !== undefined && run.released === null) run.released = deps.now();
      await tell(scope, "released", release);
    },
    async ended(scope, outcome) {
      const turn = turnOf(scope);
      const run = deps.runs.running(scope.user, turn);
      if (run !== undefined) {
        run.status = outcome.status;
        run.ended = deps.now();
        run.usage = outcome.usage;
        if (outcome.error !== undefined) run.error = outcome.error;
      }
      await tell(scope, "ended", outcome);
    },
  };
}

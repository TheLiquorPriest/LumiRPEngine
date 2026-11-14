// The facts RPE gives RPH (`FactsPort` in `rp-harness/contract`; plan §5.4 "Facts"): one registry each
// area adds its facts to while RPE starts, read as one port once the harness asks for them. A fact is a
// neutral count drawn from RPE's records; the rule that names it says what matters.
//
// The turn lane's own facts, counted along the scope turn's own line (the turns it was made after, and
// itself once its reply is tied), or along the chat's path for a scope with no turn:
//   turns.since.engine.change  turns on that line since the last one that recorded an engine-lane change
//   session.turns              turns on that line since this session opened
//   turn.recorded              what this turn has recorded so far in any lane: the store's changes and the story's and the cast's
//                              rows it wrote; a continue's, since it began (the marks its run took, as its take-back uses them)
//   turn.owes.reply            1 while the run owes the player a reply it has not released; 0 for a run that owes none (Settle now)
//   turn.owes.record           1 while the run owes the player a reply and has recorded nothing (`turn.recorded` is 0); 0 for a run
//                              that owes no reply

import type { FactDef, FactsPort, FactValue, Scope } from "rp-harness/contract";
import type { Store } from "../store";
import { storyAt } from "../story/path";
import type { RunRecord } from "./runs";

/** Facts one area counts. */
export interface FactSource {
  /** The area, for the error when two areas declare one name. */
  area: string;
  defs: readonly FactDef[];
  /** The values of these facts (each one of `defs`) for the scope. */
  read(scope: Scope, names: readonly string[]): Promise<Record<string, FactValue>>;
}

export class FactsRegistry implements FactsPort {
  readonly #sources: FactSource[] = [];
  #fixed = false;

  /** Adds an area's facts. The list is fixed the first time it is read, as the contract asks: the same for the life of the host. */
  add(source: FactSource): void {
    if (this.#fixed) throw new Error(`The ${source.area} area's facts came after the harness read the list: every area adds its facts while RPE starts.`);
    for (const def of source.defs) {
      const owner = this.#sources.find((s) => s.defs.some((d) => d.name === def.name));
      if (owner !== undefined || source.defs.filter((d) => d.name === def.name).length > 1) throw new Error(`The fact ${def.name} is declared by ${owner?.area ?? source.area} already.`);
    }
    this.#sources.push(source);
  }

  defs(): FactDef[] {
    this.#fixed = true;
    return this.#sources.flatMap((s) => s.defs.map((d) => ({ ...d, ...(d.by !== undefined ? { by: [...d.by] } : {}), ...(d.fields !== undefined ? { fields: [...d.fields] } : {}) })));
  }

  async read(scope: Scope, names?: string[]): Promise<Record<string, FactValue>> {
    this.#fixed = true;
    const out: Record<string, FactValue> = {};
    await Promise.all(
      this.#sources.map(async (source) => {
        const asked = source.defs.map((d) => d.name).filter((name) => names === undefined || names.includes(name));
        if (asked.length === 0) return;
        const values = await source.read(scope, asked);
        for (const name of asked) {
          const value = values[name];
          if (value !== undefined) out[name] = value;
        }
      }),
    );
    return out;
  }
}

/** Rows a turn wrote to the cast's or the story's record after `after` (its `ord`), its jobs' left out as the take-back leaves them. */
function rowsAfter(store: Store, table: "cast_entry" | "story_entry", user: string, turn: string, after: number): number {
  return store.db.query<{ n: number }, [string, string, number]>(`SELECT count(*) AS n FROM ${table} WHERE user = ? AND turn = ? AND ord > ? AND job IS NULL`).get(user, turn, after)?.n ?? 0;
}

/** A turn's run as the facts read it: where its own writes begin, its kind, and when its reply went out. */
export type FactsRun = Pick<RunRecord, "mark" | "castMark" | "storyMark" | "kind" | "released">;

/**
 * The turn lane's own facts, counted from the store and, for what a turn recorded and owes, from the run it is in: `run` gives a scope's
 * turn's run as it stands (the one going on, else its latest), whose marks say where a continue's own writes begin. `heard` resolves
 * once what RPE was told of the runs so far has reached their records: a reply reaches its run only once the intent records told
 * before it are taken (RPH holds the reply until then, plan §10.3), so whether a reply went out is read after it.
 */
export function turnFacts(store: Store, run: (user: string, turn: string) => FactsRun | null, heard: () => Promise<void>): FactSource {
  return {
    area: "turn",
    defs: [
      { name: "turns.since.engine.change", counts: "Turns on this turn's own line, this one once its reply is saved, since the last one that recorded a change in the engine lane; every turn on it when none has." },
      { name: "session.turns", counts: "Turns on this turn's own line, this one once its reply is saved, since this session opened, the turn that opened it among them." },
      { name: "turn.recorded", counts: "Things this turn has recorded so far in any lane: the engine's changes, and the story's and the cast's records; for a continue, since it began. A job's are its own." },
      { name: "turn.owes.reply", counts: "1 while this run owes the player a reply it has not released; 0 once it has, and for a run that owes none (a Settle now run)." },
      { name: "turn.owes.record", counts: "1 while this run owes the player a reply and has recorded nothing in any lane (turn.recorded is 0); 0 once it has, and for a run that owes no reply." },
    ],
    async read(scope, names) {
      const user = store.user(scope.user);
      // A chat RPE has not met yet has no turns on its path: every count is 0. A turn still open is not yet one of the turns counted,
      // so a swipe counts the line it follows, not the attempt it replaces.
      const known = user.chat(scope.chat) !== null;
      const line = known ? storyAt(user, scope.chat, scope.turn ?? null).turns : [];
      const turns = scope.turn !== undefined && user.turn(scope.turn)?.status === "open" ? line.filter((t) => t !== scope.turn) : line;
      const turn = known && scope.turn !== undefined && user.turn(scope.turn)?.chat === scope.chat ? scope.turn : null;
      const runNow = turn === null ? null : run(scope.user, turn);
      // Every run owes the player a reply but one that writes nothing into the chat.
      const owes = runNow !== null && runNow.kind !== "settle";
      const recorded = (): number =>
        turn === null
          ? 0
          : user.changes(turn).filter((c) => c.ord > (runNow?.mark ?? -1) && c.job === null).length +
            rowsAfter(store, "story_entry", scope.user, turn, runNow?.storyMark ?? -1) +
            rowsAfter(store, "cast_entry", scope.user, turn, runNow?.castMark ?? -1);
      const out: Record<string, FactValue> = {};
      if (names.includes("turns.since.engine.change")) {
        let count = 0;
        for (let i = turns.length - 1; i >= 0; i--) {
          const t = turns[i];
          if (t !== undefined && user.changes(t).some((c) => c.lane === "engine")) break;
          count++;
        }
        out["turns.since.engine.change"] = { count };
      }
      if (names.includes("session.turns")) {
        const opener = user.session(scope.session)?.openedBy;
        const from = opener === undefined ? -1 : turns.indexOf(opener);
        out["session.turns"] = { count: from < 0 ? 0 : turns.length - from };
      }
      if (names.includes("turn.recorded")) out["turn.recorded"] = { count: recorded() };
      if (names.includes("turn.owes.record")) out["turn.owes.record"] = { count: owes && recorded() === 0 ? 1 : 0 };
      if (names.includes("turn.owes.reply")) {
        if (owes && runNow.released === null) await heard();
        out["turn.owes.reply"] = { count: owes && runNow.released === null ? 1 : 0 };
      }
      return out;
    },
  };
}

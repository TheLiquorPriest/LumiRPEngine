// The facts RPE gives RPH (`FactsPort` in `rp-harness/contract`; plan §5.4 "Facts"): one registry each
// area adds its facts to while RPE starts, read as one port once the harness asks for them. A fact is a
// neutral count drawn from RPE's records; the rule that names it says what matters.
//
// The turn lane's own facts:
//   turns.since.engine.change  turns on the chat's path since the last one that recorded an engine-lane change
//   session.turns              turns on the chat's path since this session opened

import type { FactDef, FactsPort, FactValue, Scope } from "rp-harness/contract";
import type { Store } from "../store";

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

/** The turn lane's own facts, counted from the store. */
export function turnFacts(store: Store): FactSource {
  return {
    area: "turn",
    defs: [
      { name: "turns.since.engine.change", counts: "Turns on the chat's path since the last one that recorded a change in the engine lane; every turn on the path when none has." },
      { name: "session.turns", counts: "Turns on the chat's path since this session opened, the turn that opened it among them." },
    ],
    async read(scope, names) {
      const user = store.user(scope.user);
      if (user.chat(scope.chat) === null) return {};
      const turns = user.path(scope.chat).flatMap((e) => (e.turn === null ? [] : [e.turn]));
      const out: Record<string, FactValue> = {};
      if (names.includes("turns.since.engine.change")) {
        let count = 0;
        for (let i = turns.length - 1; i >= 0; i--) {
          const turn = turns[i];
          if (turn !== undefined && user.changes(turn).some((c) => c.lane === "engine")) break;
          count++;
        }
        out["turns.since.engine.change"] = { count };
      }
      if (names.includes("session.turns")) {
        const opener = user.session(scope.session)?.openedBy;
        const from = opener === undefined ? -1 : turns.indexOf(opener);
        out["session.turns"] = { count: from < 0 ? 0 : turns.length - from };
      }
      return out;
    },
  };
}

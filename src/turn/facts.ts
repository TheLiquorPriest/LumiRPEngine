// The facts RPE gives RPH (`FactsPort` in `rp-harness/contract`; plan §5.4 "Facts"): one registry each
// area adds its facts to while RPE starts, read as one port once the harness asks for them. A fact is a
// neutral count drawn from RPE's records; the rule that names it says what matters.
//
// The turn lane's own facts, counted along the scope turn's own line (the turns it was made after, and
// itself once its reply is tied), or along the chat's path for a scope with no turn:
//   turns.since.engine.change  turns on that line since the last one that recorded an engine-lane change
//   turn.recorded              what this turn has recorded so far in any lane, all of it the store's changes (the story's and the
//                              cast's among them); a continue's, since it began (the marks its run took, as its take-back uses them)
//   unsourced.writes           this turn's writes with no source, through any tool, counted as `turn.recorded` counts
//   turn.owes.reply            1 while the run owes the player a reply it has not released; 0 for a run that owes none (Settle now). A
//                              release is marked on the run the moment its first text reaches RPE (`turns.ts`), so nothing waits for it
//   turn.owes.record           1 while the run owes the player a reply and has recorded nothing (`turn.recorded` is 0); 0 for a run
//                              that owes no reply
//   turn.last.without.intent   1 when the last reply RPE released on the turn before on that line (a continue's: on its own turn)
//                              began to go out before any intent record of its run had ended, in the order the two reached RPE; else 0
//   previous.run.stopped       the runs of the turn before that this turn stopped at the wait's limit as it began
//   story.from, story.newest   the chat's story choice (R-176), 1 in the group the chat's settings name
import type { FactDef, FactsPort, FactValue, Scope } from "rp-harness/contract";
import type { ChangeRow, Store } from "../store";
import { storyAt } from "../story/path";
import type { RunRecord } from "./runs";
import { STORY_FROM, STORY_NEWEST, type StoryFrom, type StoryNewest } from "./settings";

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

/** A turn's run as the facts read it: where its own writes begin, its kind, when its reply went out, and whether that was before its intent record. */
export type FactsRun = Pick<RunRecord, "mark" | "kind" | "released" | "withoutIntent">;

/** What the turn lane's facts read beside the store: a turn's runs, the runs a turn stopped as it began, and the chat's story choice. */
export interface TurnFactsDeps {
  /** A turn's runs, oldest first, the one going on as it stands, whose marks say where a continue's own writes begin. */
  runs(user: string, turn: string): readonly FactsRun[];
  /** How many runs of the turn before `turn` stopped at the wait's limit as `turn` began. */
  stopped(user: string, turn: string): number;
  /** The chat's story choice, as its levels set it. */
  story(scope: Scope): Promise<{ from: StoryFrom; newest: StoryNewest }>;
}

/**
 * The turn lane's own facts, counted from the store and, for what a turn recorded and owes, from the runs it has. Nothing is waited
 * for: what a run was told is on it the moment it was told.
 */
export function turnFacts(store: Store, deps: TurnFactsDeps): FactSource {
  const { runs } = deps;
  return {
    area: "turn",
    defs: [
      { name: "turns.since.engine.change", counts: "Turns on this turn's own line, this one once its reply is saved, since the last one that recorded a change in the engine lane; every turn on it when none has." },
      { name: "turn.recorded", counts: "Things this turn has recorded so far in any lane: the engine's changes, and the story's and the cast's records; for a continue, since it began. A job's are its own." },
      { name: "unsourced.writes", counts: "This turn's writes with no source, through any tool, counted as turn.recorded counts them." },
      { name: "turn.owes.reply", counts: "1 while this run owes the player a reply it has not released; 0 once it has, and for a run that owes none (a Settle now run)." },
      { name: "turn.owes.record", counts: "1 while this run owes the player a reply and has recorded nothing in any lane (turn.recorded is 0); 0 once it has, and for a run that owes no reply." },
      { name: "turn.last.without.intent", counts: "1 when the last reply released on the turn before this one on its line (for a continue, on the turn it goes on with) went out with no intent record taken before it; 0 otherwise, and where no reply was released on that turn." },
      { name: "previous.run.stopped", counts: "Runs of the turn before that this turn stopped at the wait's limit as it began, their work left as it stood." },
      { name: "story.from", counts: "Whose messages are the chat's story: 1 in the group the chat's setting story.from names.", by: [...STORY_FROM] },
      { name: "story.newest", counts: "With the replies as the story, his newest message: 1 in the group the chat's setting story.newest names.", by: [...STORY_NEWEST] },
    ],
    async read(scope, names) {
      const user = store.user(scope.user);
      // A chat RPE has not met yet has no turns on its path: every count is 0. A turn still open is not yet one of the turns counted,
      // so a swipe counts the line it follows, not the attempt it replaces.
      const known = user.chat(scope.chat) !== null;
      const line = known ? storyAt(user, scope.chat, scope.turn ?? null).turns : [];
      const turns = scope.turn !== undefined && user.turn(scope.turn)?.status === "open" ? line.filter((t) => t !== scope.turn) : line;
      const turn = known && scope.turn !== undefined && user.turn(scope.turn)?.chat === scope.chat ? scope.turn : null;
      const runNow = turn === null ? null : (runs(scope.user, turn).at(-1) ?? null);
      // Every run owes the player a reply but one that writes nothing into the chat.
      const owes = runNow !== null && runNow.kind !== "settle";
      const mine = (): ChangeRow[] => (turn === null ? [] : user.changes(turn).filter((c) => c.ord > (runNow?.mark ?? -1) && c.job === null));
      const recorded = (): number => mine().length;
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
      if (names.includes("turn.recorded")) out["turn.recorded"] = { count: recorded() };
      if (names.includes("unsourced.writes")) out["unsourced.writes"] = { count: mine().filter((c) => c.source === null).length };
      if (names.includes("previous.run.stopped")) out["previous.run.stopped"] = { count: turn === null ? 0 : deps.stopped(scope.user, turn) };
      if (names.includes("story.from") || names.includes("story.newest")) {
        const story = await deps.story(scope);
        out["story.from"] = { count: 1, names: [story.from], by: { [story.from]: 1 } };
        out["story.newest"] = { count: 1, names: [story.newest], by: { [story.newest]: 1 } };
      }
      if (names.includes("turn.owes.record")) out["turn.owes.record"] = { count: owes && recorded() === 0 ? 1 : 0 };
      if (names.includes("turn.owes.reply")) out["turn.owes.reply"] = { count: owes && runNow.released === null ? 1 : 0 };
      if (names.includes("turn.last.without.intent")) {
        // The last of the turn's runs whose reply went out stands for the turn.
        const before = turns.at(-1);
        const last = before === undefined ? undefined : runs(scope.user, before).findLast((r) => r.released !== null);
        out["turn.last.without.intent"] = { count: last?.withoutIntent === true ? 1 : 0 };
      }
      return out;
    },
  };
}

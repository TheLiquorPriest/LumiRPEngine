// The facts RPE gives RPH (`FactsPort` in `rp-harness/contract`; plan §5.4 "Facts"): one registry each
// area adds its facts to while RPE starts, read as one port once the harness asks for them. A fact is a
// neutral count drawn from RPE's records; the rule that names it says what matters.
//
// The turn lane's own facts, counted along the scope turn's own line (the turns it was made after, and
// itself once its reply is tied), or along the chat's path for a scope with no turn:
//   turns.since.engine.change  turns RPE played on that line since the last one that recorded an engine-lane change (a turn a
//                              migration carried is none since anything, though an engine change it carried ends the count)
//   turn.recorded              what the agents' own calls of this turn have recorded so far in any lane (the story's and the cast's
//                              records among them); a continue's, since it began (the marks its run took, as its take-back uses
//                              them). RPE's own records (the knowledge switch at a turn's start) and the rows a write brings with it
//                              (a holding a perception gives) are no agent's call, and a job's are its own
//   unsourced.writes           of those, the ones with no source: the agent's own the facts are read for, every agent's where none is
//                              named, so a reminder counts only what the agent it reminds can put right; a job's agent's, its job's
//   turn.owes.reply            1 while the run owes the player a reply it has not released; 0 for a run that owes none (Settle now). A
//                              release is marked on the run the moment its first text reaches RPE (`turns.ts`), so nothing waits for it
//   turn.owes.record           1 while the run owes the player a reply and has recorded nothing (`turn.recorded` is 0); 0 for a run
//                              that owes no reply
//   turn.last.without.intent   1 when the last reply RPE released on the turn before on that line (a continue's: on its own turn)
//                              began to go out before any intent record of its run had ended, in the order the two reached RPE; else 0
//   turn.without.intent        1 while the run owes the player a reply, its lead has no intent record taken (one whose end reached
//                              RPE), and no rule naming this fact has been said to it in the run; by whether its reply has gone out
//   turns.without.intent       the turns RPE played on that line before this one, newest back, that took no intent record, up to the
//                              newest that took one (a turn a migration carried is passed over)
//   asked.unanswered           the panel's presses of an action this turn was told that no `act` of the action reached the engine for in
//                              it (carried out, or refused with the world's reason), and he did not drop; named by what was pressed
//   previous.run.stopped       the runs of the turn before that this turn stopped at the wait's limit as it began
//   story.from, story.newest   the chat's story choice (R-176), 1 in the group the chat's settings name
//   threads.quests.split       a story thread and a quest naming it where one side is closed and the other open, at the turn, by
//                              which side is closed (PlanStory-12's link, read off the story record's path)
// A scope naming a past turn reads every one of them as that turn would have (C-10): its line, its changes, its runs.

import type { AgentRef, FactDef, FactsPort, FactValue, Scope } from "rp-harness/contract";
import { pairMarks } from "../quests/thread";
import { byAgent, type ChangeRow, type Store } from "../store";
import { storyAt } from "../story/path";
import { StoryRecord } from "../story/record";
import { CARRIED_SESSION, type RunRecord } from "./runs";
import { STORY_FROM, STORY_NEWEST, type StoryFrom, type StoryNewest } from "./settings";

/** Facts one area counts. */
export interface FactSource {
  /** The area, for the error when two areas declare one name. */
  area: string;
  defs: readonly FactDef[];
  /** The values of these facts (each one of `defs`) for the scope, read for `agent` where the harness names one. */
  read(scope: Scope, names: readonly string[], agent?: AgentRef): Promise<Record<string, FactValue>>;
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

  async read(scope: Scope, names?: string[], agent?: AgentRef): Promise<Record<string, FactValue>> {
    this.#fixed = true;
    const out: Record<string, FactValue> = {};
    await Promise.all(
      this.#sources.map(async (source) => {
        const asked = source.defs.map((d) => d.name).filter((name) => names === undefined || names.includes(name));
        if (asked.length === 0) return;
        const values = await source.read(scope, asked, agent);
        for (const name of asked) {
          const value = values[name];
          if (value !== undefined) out[name] = value;
        }
      }),
    );
    return out;
  }
}

/** A turn's run as the facts read it: where its own writes begin, its kind, when it was asked for, when its reply went out, its intent record's time and whether its reply went out before it, and its session (none for the record a migration keeps of a carried turn's run). */
export type FactsRun = Pick<RunRecord, "mark" | "kind" | "received" | "released" | "intent" | "withoutIntent" | "session">;

/** What the turn lane's facts read beside the store: a turn's runs, the runs a turn stopped as it began, and the chat's story choice. */
export interface TurnFactsDeps {
  /** A turn's runs, oldest first, the one going on as it stands, whose marks say where a continue's own writes begin. */
  runs(user: string, turn: string): readonly FactsRun[];
  /** How many runs of the turn before `turn` stopped at the wait's limit as `turn` began. */
  stopped(user: string, turn: string): number;
  /** The chat's story choice, as its levels set it. */
  story(scope: Scope): Promise<{ from: StoryFrom; newest: StoryNewest }>;
  /** The facts named by the rules said to the turn's lead since `since`: those the trace told of the run going on, and those kept. */
  told(user: string, turn: string, since: number): ReadonlySet<string>;
  /** The panel's presses of an action kept with `turn` that no `act` of the turn answered, as the requests keep them and as the run going on has acted. */
  unanswered(user: string, turn: string): readonly { what: string; on: string | null; action: string }[];
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
      { name: "turns.since.engine.change", counts: "Turns RPE played on this turn's own line, this one once its reply is saved, since the last one that recorded a change in the engine lane; every turn RPE played on it when none has. A turn a migration carried is not counted: the previous build played it." },
      { name: "turn.recorded", counts: "Things the agents' own calls of this turn have recorded so far in any lane: the engine's changes, and the story's and the cast's records; for a continue, since it began. RPE's own records and the rows a write brings with it are none of them; a job's are its own." },
      { name: "unsourced.writes", counts: "This turn's writes with no source, counted as turn.recorded counts them: those of the agent the facts are read for (a rule due for it), every agent's where none is named; for an agent in a job, its own writes in that job." },
      { name: "turn.owes.reply", counts: "1 while this run owes the player a reply it has not released; 0 once it has, and for a run that owes none (a Settle now run)." },
      { name: "turn.owes.record", counts: "1 while this run owes the player a reply and has recorded nothing in any lane (turn.recorded is 0); 0 once it has, and for a run that owes no reply." },
      { name: "turn.last.without.intent", counts: "1 when the last reply released on the turn before this one on its line (for a continue, on the turn it goes on with) went out with no intent record taken before it; 0 otherwise, and where no reply was released on that turn." },
      {
        name: "turn.without.intent",
        counts: "1 while this run owes the player a reply, its lead has written no intent record the reply contract took (one is taken when its end reaches RPE), and no rule that names this fact has been said to it in this run; 0 once it has, or once one has, and for a run that owes no reply (a Settle now run). By whether its reply has gone out yet.",
        by: ["unreleased", "released"],
      },
      { name: "turns.without.intent", counts: "Turns RPE played on this turn's own line before this one, counting back from the newest, that took no intent record, up to the newest that took one; a turn a migration carried is passed over." },
      {
        name: "asked.unanswered",
        counts: "The player's presses from a panel of one of the world's actions this turn was told, that no `act` of that action has reached the engine for in this turn, carried out or refused with the world's reason; named by what was pressed and on what. asked: each with what was pressed (what), on what (on) and the action's id (action).",
        fields: ["asked"],
      },
      { name: "previous.run.stopped", counts: "Runs of the turn before that this turn stopped at the wait's limit as it began, their work left as it stood." },
      { name: "story.from", counts: "Whose messages are the chat's story: 1 in the group the chat's setting story.from names.", by: [...STORY_FROM] },
      { name: "story.newest", counts: "With the replies as the story, his newest message: 1 in the group the chat's setting story.newest names.", by: [...STORY_NEWEST] },
      { name: "threads.quests.split", counts: "A story thread and a quest naming it where one is closed and the other open, at this turn, by which side is the closed one; named by the quest.", by: ["thread", "quest"] },
    ],
    async read(scope, names, agent) {
      const user = store.user(scope.user);
      // A chat RPE has not met yet has no turns on its path: every count is 0. A turn still open is not yet one of the turns counted,
      // so a swipe counts the line it follows, not the attempt it replaces.
      const known = user.chat(scope.chat) !== null;
      const at = known ? storyAt(user, scope.chat, scope.turn ?? null) : null;
      const line = at?.turns ?? [];
      const turns = scope.turn !== undefined && user.turn(scope.turn)?.status === "open" ? line.filter((t) => t !== scope.turn) : line;
      const turn = known && scope.turn !== undefined && user.turn(scope.turn)?.chat === scope.chat ? scope.turn : null;
      // A turn's runs are those RPE played: the record a migration keeps of a carried turn's run is none of them (plan §15.2).
      const ownRuns = (t: string): FactsRun[] => runs(scope.user, t).filter((r) => r.session !== CARRIED_SESSION);
      const runNow = turn === null ? null : (ownRuns(turn).at(-1) ?? null);
      // Every run owes the player a reply but one that writes nothing into the chat.
      const owes = runNow !== null && runNow.kind !== "settle";
      // Only an agent's own call writes a change with its handle (`byAgent`): RPE's own records, a migration's, a person's, and the rows
      // a write brings with it carry none. What a migration wrote on a carried turn is the previous build's, nothing this turn recorded.
      const mine = (): ChangeRow[] => (turn === null ? [] : user.changes(turn).filter((c) => c.ord > (runNow?.mark ?? -1) && c.job === null && byAgent(c) && c.source !== "import"));
      const recorded = (): number => mine().length;
      // An intent record is taken when its end reaches RPE.
      const intended = (r: FactsRun): boolean => r.intent?.to != null;
      const out: Record<string, FactValue> = {};
      if (names.includes("turns.since.engine.change")) {
        // One read along the line, however long: the newest turn on it that recorded an engine-lane change; then the turns after it RPE played.
        const newest = turns.length === 0 ? null : user.newestWith(turns, "engine");
        out["turns.since.engine.change"] = { count: user.playedOf(newest === null ? turns : turns.slice(turns.lastIndexOf(newest) + 1)).size };
      }
      if (names.includes("turn.recorded")) out["turn.recorded"] = { count: recorded() };
      // A reminder counts what the agent it reminds can put right: its own writes, by its handle. A job's agent's are its job's (on the
      // turn that started it, or his own where none did), never the turn's: a handle is its run's own, and a turn's agent can have the same.
      if (names.includes("unsourced.writes")) {
        const job = agent?.job;
        const own = job === undefined ? mine() : [...(turn === null ? [] : user.changes(turn)), ...(known ? user.ownerChanges(scope.chat) : [])].filter((c) => c.job === job && byAgent(c) && c.source !== "import");
        out["unsourced.writes"] = { count: own.filter((c) => c.source === null && (agent === undefined || c.handle === agent.id)).length };
      }
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
        const last = before === undefined ? undefined : ownRuns(before).findLast((r) => r.released !== null);
        out["turn.last.without.intent"] = { count: last?.withoutIntent === true ? 1 : 0 };
      }
      if (names.includes("turn.without.intent")) {
        // Said once in a run, by whichever rule names it first: a rule at another moment is not said the same thing again.
        const without = owes && turn !== null && !intended(runNow) && !deps.told(scope.user, turn, runNow.received).has("turn.without.intent") ? 1 : 0;
        const released = runNow?.released != null;
        out["turn.without.intent"] = { count: without, by: { unreleased: released ? 0 : without, released: released ? without : 0 } };
      }
      if (names.includes("turns.without.intent")) {
        let count = 0;
        for (const t of turns.toReversed()) {
          if (t === turn) continue;
          const played = ownRuns(t);
          if (played.length === 0) continue;
          if (played.some(intended)) break;
          count++;
        }
        out["turns.without.intent"] = { count };
      }
      if (names.includes("asked.unanswered")) {
        const asked = turn === null ? [] : deps.unanswered(scope.user, turn);
        out["asked.unanswered"] = { count: asked.length, names: asked.map((a) => (a.on === null ? a.what : `${a.what}, on ${a.on}`)), fields: { asked: asked.map((a) => ({ what: a.what, on: a.on, action: a.action })) } };
      }
      if (names.includes("threads.quests.split")) {
        const record = at === null ? null : StoryRecord.read(store, scope.user, at);
        const marks = record === null ? [] : pairMarks(record.of("thread"), record.quests);
        const closed = (side: "thread" | "quest") => marks.filter((m) => m.closed === side);
        out["threads.quests.split"] = { count: marks.length, names: marks.map((m) => m.quest), by: { thread: closed("thread").length, quest: closed("quest").length }, namesBy: { thread: closed("thread").map((m) => m.quest), quest: closed("quest").map((m) => m.quest) } };
      }
      return out;
    },
  };
}

// What RPH tells RPE as a turn goes (`TurnEvents` in `rp-harness/contract`). None of it returns a
// decision: RPE records it with the turn and shows it. The intent record is kept on the turn as text and
// never read by code (plan §10.3). A sub-agent's writes the lead drops are taken back from the turn's
// staged changes, from the cast's and the story's rows beside them, and from the notes it wrote. Rules
// that fired, consents, gap checks, suggestions and the attachments an agent was given are kept with the
// turn (`turn_told`) for the Turn page; a suggestion of a file is filed for the Files page too. Of RPE's
// own spaces an agent can be given by name, the cast's views of the character it plays are given
// (`cast:self(…)`), with who the open scene has on stage and its place as what is present; and the next
// batch of the chat's lore no run has indexed (`index:batch`), worded by the lore's lines in force.
//
// A job's every change of state is kept (`jobs.ts`); its end is recorded in the store in the same write,
// so what it recorded takes effect before the next turn to begin, and the sessions of the turn that
// started it are brought up to date, since its writes may have opened or closed a scene (plan §11). A
// job the user started belongs to no turn, so what its agents are told of is kept with none: its trace
// holds it.

import type { Database } from "bun:sqlite";
import { loadGuidance } from "rp-harness";
import type { AgentRef, ContextBlock, FilesPort, Log, Scope, TurnEvents } from "rp-harness/contract";
import { castViews, dropCastStaged, type SourceReader } from "../cast";
import { LORE_BATCH, type LoreIndex, loreBatchBlock } from "../lore";
import type { Store } from "../store";
import { dropStoryStaged } from "../story";
import type { TreeNotes, TreeSuggestions } from "../tree";
import { keepJob } from "./jobs";
import type { Writes } from "./kv";
import type { Runs } from "./runs";
import { turnSettings } from "./settings";
import { stageAt } from "./stage";
import { castLayouts, turnTokens } from "./turns";

export interface EventsDeps {
  db: Database;
  writes: Writes;
  store: Store;
  runs: Runs;
  /** The agents' files, for the parts the cast's views are laid out by. */
  files: FilesPort;
  /** A character's sources read live, shown with its base. */
  sources: SourceReader;
  /** The lore index, whose next batch an indexing run is given by name. */
  loreIndex: LoreIndex;
  /** The notes agents wrote, which follow the turn: a dropped sub-agent's are taken back. */
  notes: TreeNotes;
  /** The suggestions agents filed of the tree's files, for the Files page. */
  suggestions: TreeSuggestions;
  now(): number;
  /** After a job of a turn ended: the sessions of the turn that started it brought up to date. */
  jobEnded(user: string, chat: string, turn: string): Promise<void>;
  log: Log;
}

/** `cast:self(base, mind, …)`: views of the character the agent plays, by name. */
const CAST_SELF = /^cast:self\((.*)\)$/;

/**
 * The cast's views that `ref` names of the character `agent` plays, each laid out by its part in force for the chat, one after
 * another; null when the ref is not the cast's or the agent plays nobody. A name among them that is not the cast's is left out.
 */
async function castSelf(deps: EventsDeps, scope: Scope, agent: AgentRef, ref: string): Promise<string | null> {
  const inner = CAST_SELF.exec(ref)?.[1];
  if (inner === undefined || agent.plays === undefined) return null;
  const names = inner
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  const [layouts, settings] = await Promise.all([castLayouts(loadGuidance(deps.files, scope), names), turnSettings(deps.files, scope, deps.log)]);
  const turn = scope.turn ?? null;
  const stage = stageAt(deps.store, scope.user, scope.chat, turn);
  const views = await castViews(names, {
    store: deps.store,
    user: scope.user,
    chat: scope.chat,
    turn,
    character: agent.plays,
    present: stage?.who ?? [],
    ...(stage?.place != null ? { cues: [stage.place] } : {}),
    sources: deps.sources,
    layouts,
    tokens: turnTokens,
    settings: settings.cast,
  });
  return views
    .map((view) => view.text)
    .filter((text) => text.trim() !== "")
    .join("\n\n");
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
    if (scope.turn === undefined) return;
    const { turn } = scope;
    await deps.writes.run((db) => db.run("INSERT INTO turn_told (user, turn, kind, body, at) VALUES (?, ?, ?, ?, ?)", [scope.user, turn, kind, JSON.stringify(body), deps.now()]), "keeping what RPH told of a turn");
  };
  return {
    async intent(scope, text) {
      const turn = turnOf(scope);
      await deps.writes.run(() => deps.store.user(scope.user).updateTurn(turn, { intent: text }), "keeping the intent record");
    },
    async attachments(scope, agent, refs) {
      await tell(scope, "attachments", { agent, refs });
      // Of RPE's own spaces only the cast's views and the lore's next batch are given yet; every other name is left out, and RPH says
      // so. What cannot be read leaves out its name alone.
      const blocks: ContextBlock[] = [];
      for (const { ref, own } of refs) {
        if (own) continue;
        try {
          const text = ref === LORE_BATCH ? await loreBatchBlock(deps.loreIndex, scope, loadGuidance(deps.files, scope)) : await castSelf(deps, scope, agent, ref);
          if (text !== null && text !== "") blocks.push({ name: ref, text });
        } catch (error) {
          deps.log.warn("What an agent was to be given by name could not be read.", { agent: agent.id, ref, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return blocks;
    },
    consent: (scope, grant) => tell(scope, "consent", grant),
    gapCheck: (scope, check) => tell(scope, "gap-check", check),
    async dropStaged(scope, agent) {
      const turn = turnOf(scope);
      await deps.writes.run(() => {
        deps.store.user(scope.user).dropStaged(turn, agent.id);
        dropCastStaged(deps.store, scope.user, turn, agent.id);
        dropStoryStaged(deps.store, scope.user, turn, agent.id);
      }, "dropping a sub-agent's staged changes");
      // The notes queue writes of their own, so they are taken back after the block above, never inside it.
      await deps.notes.drop(scope.user, scope.chat, turn, agent.id);
      await tell(scope, "dropped", { agent });
    },
    ruleFired: (scope, firing) => tell(scope, "rule", firing),
    async suggestion(scope, agent, suggestion) {
      await tell(scope, "suggestion", { agent, suggestion });
      await deps.suggestions.file(scope, agent, suggestion);
    },
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
    async job(scope, job) {
      const ended = job.ended !== undefined;
      try {
        await deps.writes.run((db) => {
          keepJob(db, job);
          if (ended) deps.store.user(scope.user).endJob(job.id);
        }, "keeping what RPH told of a job");
      } catch (error) {
        const words = error instanceof Error ? error.message : String(error);
        if (ended) deps.log.error("A job's end could not be recorded, so what it changed does not take effect.", { job: job.id, error: words });
        else deps.log.error("A job's new state could not be kept.", { job: job.id, state: job.state, error: words });
        return;
      }
      if (!ended || scope.turn === undefined) return;
      await deps.jobEnded(scope.user, scope.chat, scope.turn).catch((error: unknown) => deps.log.error("The sessions of a job's scene could not be brought up to date.", { turn: scope.turn ?? null, error: error instanceof Error ? error.message : String(error) }));
    },
  };
}

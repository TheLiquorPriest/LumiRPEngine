// What RPH tells RPE as a turn goes (`TurnEvents` in `rp-harness/contract`). None of it returns a
// decision: RPE records it with the turn and shows it. The intent record is kept on the turn as text and
// never read by code (plan §10.3). A sub-agent's writes the lead drops are taken back from the turn's
// staged changes. Rules that fired, consents, gap checks, suggestions and the attachments an agent was
// given are kept with the turn (`turn_told`) for the Turn page. Of RPE's own spaces an agent can be
// given by name, the cast's views of the character it plays are given (`cast:self(…)`).

import type { Database } from "bun:sqlite";
import { loadGuidance, type TemplatePart } from "rp-harness";
import type { AgentRef, ContextBlock, FilesPort, Log, Scope, TurnEvents } from "rp-harness/contract";
import { CAST_VIEWS, castViews, type CastViewName, type SourceReader } from "../cast";
import type { Store } from "../store";
import { namesOf } from "../story/kit";
import { storyAt } from "../story/path";
import { StoryRecord } from "../story/record";
import type { Writes } from "./kv";
import type { Runs } from "./runs";

export interface EventsDeps {
  db: Database;
  writes: Writes;
  store: Store;
  runs: Runs;
  /** The agents' files, for the parts the cast's views are laid out by. */
  files: FilesPort;
  /** A character's sources read live, shown with its base. */
  sources: SourceReader;
  now(): number;
  log: Log;
}

/** `cast:self(base, mind, …)`: views of the character the agent plays, by name. */
const CAST_SELF = /^cast:self\((.*)\)$/;

/** Who the open scene has on stage, as the story record holds it at the turn: the names the Author gave it. */
function onStage(store: Store, user: string, chat: string, turn: string | null): string[] {
  const scene = StoryRecord.read(store.db, user, storyAt(store.user(user), chat, turn)).current("scene");
  return scene === null || scene.closedBy !== null ? [] : namesOf(scene);
}

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
  const guidance = loadGuidance(deps.files, scope);
  const layouts: Partial<Record<CastViewName, TemplatePart>> = {};
  for (const name of names) {
    if (!Object.hasOwn(CAST_VIEWS, name)) continue;
    const part = await guidance.part(CAST_VIEWS[name as CastViewName]);
    if (part?.format === "template") layouts[name as CastViewName] = part;
  }
  const turn = scope.turn ?? null;
  const views = await castViews(names, { store: deps.store, user: scope.user, chat: scope.chat, turn, character: agent.plays, present: onStage(deps.store, scope.user, scope.chat, turn), sources: deps.sources, layouts });
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
      // Of RPE's own spaces only the cast's views are given yet; every other name is left out, and RPH says so. A view that cannot be
      // read leaves out its name alone.
      const blocks: ContextBlock[] = [];
      for (const { ref, own } of refs) {
        if (own) continue;
        try {
          const text = await castSelf(deps, scope, agent, ref);
          if (text !== null && text !== "") blocks.push({ name: ref, text });
        } catch (error) {
          deps.log.warn("The cast's views an agent was to be given could not be read.", { agent: agent.id, ref, error: error instanceof Error ? error.message : String(error) });
        }
      }
      return blocks;
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

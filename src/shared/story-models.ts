// Which connection, model and effort an agent of the story engine runs on (DEPTH2-PLAN §1.12, §6.3):
// the player's ladder (`StorySettings.models`), read for LumiAH's `agentModel` hook as each agent of
// a run starts, and by the pages that show the pick and where it comes from. Most specific first:
// this character (the person a character's agent runs `as`, as the story record names them: an
// entity's id, "player" for the player's character), the kind of run it is on, how it stands in its
// run, its agent definition, the default. Connection, model and effort are each picked by the first
// level that names it; anything unpicked falls through, and nothing picked leaves the agent's own.
//
// A character's kind of run is read from how it was started, never from a model's words: started
// inside a turn (by the author, or on the direct line), it is in a scene. An agent of a job's run,
// the job's own or one an agent of it started, is on the job's kind of run: the story's prepared
// start (a job of the chat's own, no turn's) is reliving; a job the next turn waits for is digesting;
// any other job, one the player started for something else included, is preparing.

import { HARNESS_AGENT } from "./harness-texts";
import type { AgentStanding, CharacterRun, ModelPick, StoryModels } from "./settings";

/** What LumiAH asks of an agent about to start, as the ladder reads it; `job` the job whose run it is on (its turn's basis, whether the next turn waits for it, and whether it is of the story's prepared start where it belongs to no turn), null for an agent of a turn or a side session. */
export interface ModelAsk {
  definition: string;
  as: string | null;
  standing: AgentStanding;
  job: { basis: string | null; due?: string; prepared?: boolean } | null;
}

/** A level of the ladder: this character, the kind of run, the standing, the agent, the default. */
export type ModelLevel = "character" | "run" | "standing" | "agent" | "default";

/** The kind of run a character's agent is on (see the header); null for any other agent, and for a job the engine doesn't know. A job of no turn is reliving unless it is said to be no part of the prepared start. */
export function characterRun(ask: ModelAsk): CharacterRun | null {
  if (ask.definition !== HARNESS_AGENT.character) return null;
  if (ask.job === null) return ask.standing === "job" ? null : "scene";
  if (ask.job.basis === null) return ask.job.prepared === false ? "prepare" : "relive";
  return ask.job.due === "next_turn" ? "digest" : "prepare";
}

/** The levels of the ladder that pick something for `ask`'s agent, most specific first, each with where it comes from. */
export function modelLadder(models: StoryModels, ask: ModelAsk): { level: ModelLevel; pick: ModelPick }[] {
  const run = characterRun(ask);
  const levels: [ModelLevel, ModelPick | undefined][] = [
    ["character", ask.definition === HARNESS_AGENT.character && ask.as !== null ? models.characters[ask.as] : undefined],
    ["run", run !== null ? models.runs[run] : undefined],
    ["standing", models.standings[ask.standing]],
    ["agent", models.agents[ask.definition]],
    ["default", models.default],
  ];
  return levels.flatMap(([level, pick]) => (pick !== undefined && Object.keys(pick).length > 0 ? [{ level, pick }] : []));
}

/** The connection, model and effort `ask`'s agent runs on, by the player's ladder; null where the ladder picks nothing, so the agent runs on its own. */
export function chooseAgentModel(settings: { story: { models: StoryModels } }, ask: ModelAsk): ModelPick | null {
  const ladder = modelLadder(settings.story.models, ask).map((l) => l.pick);
  const connectionId = ladder.find((p) => p.connectionId !== undefined)?.connectionId;
  const model = ladder.find((p) => p.model !== undefined)?.model;
  const effort = ladder.find((p) => p.effort !== undefined)?.effort;
  const choice: ModelPick = { ...(connectionId !== undefined ? { connectionId } : {}), ...(model !== undefined ? { model } : {}), ...(effort !== undefined ? { effort } : {}) };
  return Object.keys(choice).length > 0 ? choice : null;
}

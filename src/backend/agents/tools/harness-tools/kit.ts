// What the harness engine's own tools share (`tools/harness.ts` lists and runs them): a tool's
// shape, and where a staged change stands. Each of these tools records through the engine's own
// validators; none makes a model call, and none works without the turn the call belongs to
// (`ToolEnv.turn`).

import { WRITE_NOTE } from "../../../../shared/agent-tools-write";
import { HARNESS_NOTE, type HarnessToolTier } from "../../../../shared/harness-texts";
import type { JsonObject } from "../../../../shared/json";
import type { UserSettings } from "../../../../shared/settings";
import type { WorldDoc } from "../../../../shared/world";
import type { ToolOutcome } from "../../runtime";
import type { HarnessChange, HarnessTurn } from "../harness-turn";
import { refusedAnswer } from "../propose";
import type { ToolReadView } from "../read-view";
import type { ToolEnv } from "../registry";

/** One of the harness engine's own tools: its texts are `shared/harness-texts.ts`'s (`harnessToolText`). */
export interface HarnessToolDefinition {
  name: string;
  family: string;
  tier: HarnessToolTier;
  parameters(world: WorldDoc): JsonObject; // hand-written JSON Schema, with the world's enums filled in
  /** For a tool that bounds its own answer by one of the player's settings and is meant to be read in one go: that bound, in characters, under `settings`. LumiAH gives its answer whole up to it (its `wholeChars`) instead of clipping it at Tool results clipped past. A read whose size is worked out from limits never states more than `WHOLE_READ_MOST`; one whose size is itself a setting of the player's states that setting. */
  wholeChars?: (settings: UserSettings) => number;
  run(args: JsonObject, env: ToolEnv): Promise<ToolOutcome>;
}

/**
 * The most a whole read of the engine's states (`wholeChars`) where its size is worked out from the
 * settings that bound what it holds, in characters: `mind_read`, `mind_seed`, `beats_read`,
 * `feed_read`, the stage's `narration_read` and `passage_read`, and a page of the lore reads each
 * state the smaller of this and their own size. About 30,000 tokens: whole for anything a writer may
 * write in a turn (the longest passage, a mind full to its sizes, a scene's beats), and small enough
 * that one read can never take an agent's window, which those limits alone would let it (a read of
 * the record's beats at its limits' maximum works out to hundreds of millions). Past it, LumiAH clips
 * as it does any result, and each read says how to read on. The prepared start's two reads
 * (`prepare_survey`, `stretch_read`) aren't held to it: their size is the player's own setting (One
 * answer of the survey, One read of a stretch, up to 1,000,000), set high on purpose for a model with
 * a very long context.
 */
export const WHOLE_READ_MOST = 120_000;

/** How many characters JSON may write for one character of an agent's text: a quote mark, a backslash, a tab or a line break is escaped in two, and the control characters JSON writes in six never reach a text (`neutralizeMacros` drops them). */
export const JSON_CHAR_MOST = 2;

// A schema's nodes, each made afresh where it is used. A tool's arguments are described in place
// once its schema is copied, and a copy keeps a node used twice as one node: a shared one would
// carry the last description written to it under every argument that uses it.

/** A list of `items`. */
export const list = (items: JsonObject): JsonObject => ({ type: "array", items });
/** A list of words: names, ids, refs. */
export const words = (): JsonObject => list({ type: "string" });
/** A number, whole or not. */
export const number = (): JsonObject => ({ type: "number" });

/**
 * Stages `change` and says where it stands, as a write tool does: landing when the author commits,
 * waiting on the review card, or, after the reply, written already. A refusal comes back as the
 * tool's answer, with its reason apart for a tool that goes on to its other changes.
 */
export async function stageChange(view: ToolReadView, turn: HarnessTurn, change: HarnessChange): Promise<{ lands: string } | { refused: ToolOutcome; reason: string }> {
  const staged = await turn.stage(change);
  if ("refused" in staged) return { refused: refusedAnswer(staged), reason: staged.reason };
  return { lands: view.text(staged.mode === "confirm" ? WRITE_NOTE.stagedReview : turn.reply !== null ? HARNESS_NOTE.recorded : WRITE_NOTE.staged) };
}

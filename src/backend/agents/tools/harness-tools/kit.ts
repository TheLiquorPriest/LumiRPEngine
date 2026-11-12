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
  /** For a tool that bounds its own answer by one of the player's settings and is meant to be read in one go: that bound, in characters, under `settings`. LumiAH gives its answer whole up to it (its `wholeChars`) instead of clipping it at Tool results clipped past. */
  wholeChars?: (settings: UserSettings) => number;
  run(args: JsonObject, env: ToolEnv): Promise<ToolOutcome>;
}

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

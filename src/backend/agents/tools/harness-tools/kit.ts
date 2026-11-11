// What the harness engine's own tools share (`tools/harness.ts` lists and runs them): a tool's
// shape, where a staged change stands, and who was there for the turn. Each of these tools stands in
// for a step the classic engine runs itself, and records through that step's own validator; none
// makes a model call, and none works without the turn the call belongs to (`ToolEnv.turn`).

import { WRITE_NOTE } from "../../../../shared/agent-tools-write";
import { HARNESS_NOTE, type HarnessToolTier } from "../../../../shared/harness-texts";
import type { EntityId } from "../../../../shared/ids";
import type { JsonObject } from "../../../../shared/json";
import type { PresenceEventData } from "../../../../shared/minds";
import type { WorldDoc } from "../../../../shared/world";
import { placeOfEntity } from "../../../../engine/scope";
import { readSlice } from "../../../../packs/minds/core/state";
import { presentWith } from "../../../minds";
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

/** Who was there for a turn, as the knowledge step and the memory count it (`KnowledgeTurn.presence`). */
export interface TurnPresence {
  said: PresenceEventData;
  met: PresenceEventData | null;
  left: EntityId[];
}

/**
 * Who perceived the turn. Once its reply is written, the presence the engine recorded for it (who
 * heard the player's message, then whoever the player character met at its end), with whoever heard
 * it but is no longer with the player character counted as having left partway. Before the reply
 * nothing is recorded yet: whoever is with the player character now heard the message, as the
 * knowledge step before a plan has it.
 */
export function presenceOf(view: ToolReadView, turn: HarnessTurn): TurnPresence {
  const { registry: reg, world, state } = view;
  const there = presentWith(reg, world, state);
  const records = readSlice(state).presence;
  const at = turn.reply === null ? -1 : records.findLastIndex((p) => p.msg === turn.reply?.messageId);
  const heard = records[at];
  if (!heard) return { said: { msg: turn.reply?.messageId ?? turn.said.messageId, at: state.clock, place: placeOfEntity(state, world.pov), who: there, saw: [] }, met: null, left: [] };
  // Whoever the player character met at the turn's end is recorded right after, under no message.
  const next = records[at + 1];
  return { said: { ...heard, saw: [] }, met: next && next.msg === null ? { ...next, saw: [] } : null, left: heard.who.filter((id) => !there.includes(id)) };
}

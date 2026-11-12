// The cast as a harness call reaches it (DEPTH2-PLAN §1.5, §5): each person's casting as it stands
// on the chat's path, what the call's turn staged on top, and the mark of the last beat a person's
// mind took in (`Cast.digestedTo`), which the feed reads from. The player's character is "player"
// here, as everywhere in the story record; anyone never cast is an extra.

import type { Cast } from "../../shared/ledger";
import { storyName } from "../../engine/story/feed";
import { castOn } from "../../engine/story/record";
import type { ToolEnv } from "../agents/tools/registry";
import type { StoryWritten } from "./record";

/** The cast as it stands for the call: the path's, what its turn staged on top. Null where the call reaches no story record. */
export async function castFor(env: Pick<ToolEnv, "turn">): Promise<Cast[] | null> {
  const read = env.turn?.story ? await env.turn.story.read() : null;
  return read ? read.path.cast : null;
}

/**
 * Marks `to` (a beat's id) as the last beat `entity`'s mind took in (an entity's id, or "player"):
 * staged with the turn, or written on the job's turn record. Their casting is kept as it stands; one
 * never cast is written as an extra, the player's character as a principal, their mind being the
 * player's setting.
 */
export async function markDigested(env: Pick<ToolEnv, "turn" | "reader">, entity: string, to: string): Promise<StoryWritten> {
  const port = env.turn?.story;
  const read = port ? await port.read() : null;
  if (!port || !read) return { refused: "none" };
  const who = storyName(entity, (await env.reader.view()).pov);
  const held = castOn(read.path, who);
  return port.write({ cast: [held ? { ...held, digestedTo: to } : { entity: who, standing: who === "player" ? "principal" : "extra", digestedTo: to }] });
}

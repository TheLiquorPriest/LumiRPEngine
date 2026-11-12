// What reached one person of the story, as a harness call reaches it (DEPTH2-PLAN §5, `feed_read`):
// the beats on the chat's path after the last one their mind took in (`Cast.digestedTo`), each as
// it reached them (`engine/story/feed.ts`). And the beats a call's own turn wrote, for the tools
// that tell a turn's beats again (the narrator's).

import type { Beat } from "../../shared/ledger";
import { castOn } from "../../engine/story/record";
import { type Feed, feedOf, storyName } from "../../engine/story/feed";
import type { ToolEnv } from "../agents/tools/registry";

/**
 * What reached `entity` (an entity's id, or "player" for the player's character) since their mind
 * last took things in, or after the beat `after` where given: as many as the player's limit allows
 * (`story.limits.feedItems`). Null where the call reaches no story record.
 */
export async function feedFor(env: Pick<ToolEnv, "turn" | "reader">, entity: string, after?: string): Promise<Feed | null> {
  const turn = env.turn;
  const read = turn?.story ? await turn.story.read() : null;
  if (!turn || !read) return null;
  const pov = (await env.reader.view()).pov;
  const who = storyName(entity, pov);
  return feedOf(read.path, who, pov, after ?? castOn(read.path, who)?.digestedTo ?? null, turn.settings.story.limits.feedItems);
}

/**
 * The beats the call's own turn wrote, in order, as they stand on the path, a struck one left out:
 * in a turn, what it staged (after a Continue's reply's own); in a job, its turn's record's. Null
 * where the call reaches no story record.
 */
export async function turnBeats(env: Pick<ToolEnv, "turn">): Promise<Beat[] | null> {
  const read = env.turn?.story ? await env.turn.story.read() : null;
  if (!read) return null;
  const own = new Set(read.own.beats.map((b) => b.id));
  return read.path.beats.filter(({ beat }) => own.has(beat.id) && beat.struck === undefined).map(({ beat }) => beat);
}

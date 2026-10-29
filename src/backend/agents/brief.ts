// What a role's task is told of the main agent's words (INC2-SPEC C10 `brief`, C14). The main agent
// may read wider than a task of a role it runs: a director's decision reads its chooser's own
// knowledge, its prose and suggested choices the player character's, a mind its character's own. So
// the words are held to each task's own knowledge, line by line, with the filters its prompt is held
// to: a line naming anything that knowledge doesn't reach isn't sent.
//
// - **The GM's:** every line.
// - **Everyone's:** no line naming someone or something removed from the world.
// - **The player character's, or one character's own** (the viewer's):
//   - no line with a secret not yet revealed (`unrevealedSecrets`);
//   - no line naming who or what the viewer can't see (`hiddenNameCheck`), or doesn't know of
//     (`povMayKnow` for the player character, `playerKnows` for a character);
//   - no line placing someone the viewer knows where the viewer can't see them (their whereabouts);
//   - no line quoting another character's mind, plans, notes, commitments, witness log or summary;
//   - no line quoting a fact the viewer doesn't hold.
//
//   Without the turn's head to check against, or a character to read as, none.

import type { AgentKnowledge } from "../../shared/agent-tools";
import type { EntityId } from "../../shared/ids";
import type { WorldDoc } from "../../shared/world";
import { own } from "../../engine/pack-kit";
import { hiddenNameCheck, playerKnows, povMayKnow } from "../../engine/player-events";
import type { Registry } from "../../engine/registry-impl";
import { isGone, kindIs, placeOfEntity } from "../../engine/scope";
import type { WorldState } from "../../engine/state";
import { findLeaks, namesAny, unrevealedSecrets } from "../../engine/visibility";
import { factsOf, holdingsOf } from "../../packs/minds/core/knowledge";
import { readSlice } from "../../packs/minds/core/state";

/** Whose knowledge a task reads with: an agent's, or one character's own (null: a character the task doesn't name). */
export type TaskReads = AgentKnowledge | { own: EntityId | null };

/** What a task is told of a brief: the lines it may read, and whether any were kept from it. */
export interface ScreenedBrief {
  text: string;
  withheld: boolean;
}

/** The turn's head as a screen reads it. */
type Head = { world: WorldDoc; state: Readonly<WorldState> };

/** The names of the entities `pick` takes, as `namesAny` reads them: people by name, everything else by label. */
function namesOf(reg: Registry, head: Head, pick: (id: EntityId) => boolean): { people: string[]; things: string[] } {
  const out: { people: string[]; things: string[] } = { people: [], things: [] };
  for (const [id, e] of Object.entries(head.state.entities)) if (pick(id)) (kindIs(reg, head.world, e.kind, "person") ? out.people : out.things).push(e.name);
  return out;
}

/** Everyone's screen: no line naming someone or something removed from the world. */
function everyoneScreen(reg: Registry, head: Head): (line: string) => boolean {
  const gone = namesOf(reg, head, (id) => isGone(head.state, id));
  return (line) => !namesAny(line, gone.people, gone.things);
}

/** The screen of what `viewer` knows: the player character's (`pov`) or one character's own (see the header). */
function viewerScreen(reg: Registry, head: Head, viewer: EntityId, pov: boolean): (line: string) => boolean {
  const { world, state } = head;
  const hidden = hiddenNameCheck(reg, world, state, viewer, { stages: false });
  const knows = (id: EntityId): boolean => id === viewer || (pov ? povMayKnow(reg, world, state, id) : playerKnows(reg, world, state, viewer, id));
  const unknown = namesOf(reg, head, (id) => !knows(id));
  // Where the people the viewer knows are, while the viewer isn't there to see them.
  const here = placeOfEntity(state, viewer);
  const away = Object.entries(state.entities).flatMap(([id, e]) => {
    const at = id === viewer || !knows(id) || !kindIs(reg, world, e.kind, "person") ? undefined : placeOfEntity(state, id);
    const place = at === undefined || at === null || at === here ? undefined : own(world.places, at)?.name;
    return place ? [{ name: e.name, place }] : [];
  });
  const slice = readSlice(state);
  const minds = Object.entries(slice.chars).flatMap(([id, c]) =>
    id === viewer ? [] : [c.mind?.monologue ?? "", c.mind?.intent ?? "", ...(c.mind?.reactions ?? []), ...c.plans.map((p) => p.what), ...c.notes.map((n) => n.text), ...c.commitments.map((m) => m.text), ...c.witness.map((w) => w.what), c.summary, c.intent?.text ?? ""],
  );
  const held = holdingsOf(slice, viewer);
  const keptFrom = Object.entries(factsOf(slice)).flatMap(([id, f]) => (own(held, id) === undefined ? [f.claim] : []));
  const phrases = [...unrevealedSecrets(reg, world, state), ...minds, ...keptFrom];
  return (line) => findLeaks(line, phrases).length === 0 && !hidden(line) && !namesAny(line, unknown.people, unknown.things) && !away.some((a) => namesAny(line, [a.name]) && namesAny(line, [], [a.place]));
}

/** The lines of `text` a task reading with `reads` may be told, on the turn's head (see the header). */
export function screenBrief(reg: Registry, head: Head | null, text: string, reads: TaskReads): ScreenedBrief {
  if (text.trim() === "" || reads === "gm") return { text, withheld: false };
  const viewer = reads === "pov" ? (head?.world.pov ?? null) : reads === "everyone" ? null : reads.own;
  if (!head || (reads !== "everyone" && viewer === null)) return { text: "", withheld: true };
  const keeps = viewer === null ? everyoneScreen(reg, head) : viewerScreen(reg, head, viewer, reads === "pov");
  const lines = text.split("\n");
  const kept = lines.filter((line) => line.trim() === "" || keeps(line));
  return { text: kept.join("\n"), withheld: kept.length < lines.length };
}

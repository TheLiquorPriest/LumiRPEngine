// An entity's cues (DESIGN §6.6): behaviour the author wrote for a person while one secret of theirs
// stays hidden, each keyed to the one secret it stands for (a lore entry, a track or a story flag).
// Stance plays them for the narrator (`packs/castlife/core/cues.ts`); a mind knows the secret each
// of its character's cues stands for as its own (DESIGN §24.5). Read live from the world.

import type { EntityId } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { WorldDoc } from "../shared/world";
import { own } from "./pack-kit";

const SECRET_KINDS = ["lore", "track", "flag"] as const;

export interface Cue {
  text: string;
  secret: { kind: (typeof SECRET_KINDS)[number]; id: string };
}

/** A cue as the engine reads it: text and the one secret it stands for; anything else is no cue, so it never shows. */
export function readCue(raw: unknown): Cue | null {
  if (!isRecord(raw) || typeof raw.text !== "string" || raw.text.trim() === "") return null;
  const keyed = SECRET_KINDS.filter((kind) => raw[kind] !== undefined);
  const kind = keyed[0];
  const id = kind === undefined ? undefined : raw[kind];
  return keyed.length === 1 && kind !== undefined && typeof id === "string" && id !== "" ? { text: raw.text.trim(), secret: { kind, id } } : null;
}

/** The cues `who` carries in the world that read as cues, in order. */
export function cuesOf(world: WorldDoc, who: EntityId): Cue[] {
  const cues = own(world.entities, who)?.cues;
  return (Array.isArray(cues) ? cues : []).flatMap((raw) => readCue(raw) ?? []);
}

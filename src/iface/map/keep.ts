// Keep (plan §8.2, §6.8; today's `world_keep`): what this chat changed of its world's maps copied into
// the world's own draft, the working copy Build edits. A map laid in play, a place or a path of the
// world's own the chat changed, the map settings, and the squares the chat drew on a map (laid onto the
// map they change, whether the world draws it or the chat laid it) are each written whole, over what
// the draft holds now, and its maps compiled again. The draft is written on the version it was read
// at (`UserWorlds.writeDraft`); where it moved meanwhile, the draft as it now stands is read and the
// chat's changes are laid on it again, so what was changed elsewhere stands beside them. The chat keeps
// its own record: an Upgrade to a revision that takes a change in drops it from the chat (`carryDraft`,
// `carrySpace`). Never decides what is worth keeping: only what the call names is copied. `world_keep`
// (`today.ts`) and the owner's route share this one operation.

import { hashJson } from "../../shared/hash";
import { isRecord, type JsonObject } from "../../shared/json";
import type { MapDoc, WorldDoc } from "../../shared/world";
import { isWorldDoc, migrateWorld } from "../../engine/authoring";
import { own } from "../../engine/pack-kit";
import type { WorldState } from "../../engine/state";
import { chatDraftOf, draftChanges, keptWorld, type DraftEdit } from "../../engine/world-draft";
import { editedMap, squareEditsOf, squaredMaps } from "../../packs/space/core/grid-play";
import type { DraftRead, UserWorlds } from "../../store/worlds";

/** What a chat has changed of its world that Keep can copy. */
export interface Keepable {
  kind: "map" | "place" | "path" | "settings";
  id: string;
  /** The name or title it goes by, where it has one. */
  name: string | null;
  /** The change as an edit of the draft the world keeps (null where it cannot be made on it: squares on a map the draft lacks). */
  edit(working: WorldDoc): DraftEdit | null;
}

/** What the call names of it: maps, places and paths by id, a map's title or a place's name, and whether the settings. */
export interface KeepPick {
  maps: readonly string[];
  places: readonly string[];
  paths: readonly string[];
  settings: boolean;
}

/** Why something named was not kept: the chat changed nothing of it, the draft has it so already, or the draft has no map for the squares. */
export interface Skipped {
  id: string;
  code: "not_changed" | "in_draft_already" | "no_map";
}

export interface Kept {
  maps: string[];
  places: string[];
  paths: string[];
  settings: boolean;
}

export type KeepOutcome =
  | { kept: Kept; skipped: Skipped[]; version: number; written: boolean }
  | { failed: "no_world" | "unreadable" | "busy" };

/** How many times a write that finds the draft moved is made again on the draft as it stands. */
export const KEEP_TRIES = 8;

/** A name as it is matched: case and the spaces between words aside. */
const plain = (said: string): string => said.trim().replace(/\s+/g, " ").toLowerCase();

/** The item of `working` an edit writes (or takes out), for telling whether the draft has it so already. */
function heldBy(working: WorldDoc, edit: DraftEdit): unknown {
  return "part" in edit ? working[edit.part] : own(working[edit.collection] as Readonly<Record<string, unknown>>, edit.id);
}

/** Whether writing `edit` over `working` would change nothing. */
function alreadyIn(working: WorldDoc, edit: DraftEdit): boolean {
  const held = heldBy(working, edit);
  return "value" in edit ? held !== undefined && hashJson(held) === hashJson(edit.value) : held === undefined;
}

/** Everything this chat changed of its world's maps, places, paths and settings that Keep can copy, over `base` (the revision the chat plays). */
export function keepable(base: WorldDoc, state: Readonly<WorldState>): Keepable[] {
  const out: Keepable[] = [];
  const mapped = new Set<string>();
  for (const edit of draftChanges(base, chatDraftOf(state))) {
    if ("part" in edit) {
      out.push({ kind: "settings", id: "settings", name: null, edit: () => edit });
      continue;
    }
    const value = "value" in edit ? edit.value : null;
    if (edit.collection === "maps") {
      mapped.add(edit.id);
      const edits = squareEditsOf(state, edit.id);
      const laid: DraftEdit = value === null ? edit : { collection: "maps", id: edit.id, value: (edits ? editedMap(value as unknown as MapDoc, edits) : value) as unknown as JsonObject };
      out.push({ kind: "map", id: edit.id, name: typeof value?.title === "string" ? value.title : null, edit: () => laid });
    } else if (edit.collection === "places") out.push({ kind: "place", id: edit.id, name: typeof value?.name === "string" ? value.name : null, edit: () => edit });
    else out.push({ kind: "path", id: edit.id, name: null, edit: () => edit });
  }
  // Squares the chat drew on a map the world draws: laid onto that map as the draft has it.
  for (const id of squaredMaps(state)) {
    const edits = squareEditsOf(state, id);
    if (mapped.has(id) || edits === null) continue;
    const title = own(base.maps, id)?.title;
    out.push({
      kind: "map",
      id,
      name: typeof title === "string" ? title : null,
      edit(working) {
        const map = own(working.maps, id);
        return map === undefined ? null : { collection: "maps", id, value: editedMap(map, edits) as unknown as JsonObject };
      },
    });
  }
  return out;
}

/** The working copy the world keeps, as `{ base, doc }`: the stored draft, else the head revision. Null where it cannot be read. */
function workingOf(worlds: UserWorlds, read: DraftRead, index: Uint8Array): { base: string | null; doc: WorldDoc } | null {
  const decoder = new TextDecoder();
  try {
    if (read.bytes !== null) {
      const raw: unknown = JSON.parse(decoder.decode(read.bytes));
      return isRecord(raw) && isWorldDoc(raw.doc) ? { base: typeof raw.base === "string" ? raw.base : null, doc: migrateWorld(raw.doc) } : null;
    }
    const kept: unknown = JSON.parse(decoder.decode(index));
    const head = isRecord(kept) && typeof kept.head === "string" ? kept.head : null;
    const doc = head === null ? null : worlds.doc(head);
    return doc === null ? null : { base: head, doc };
  } catch {
    return null;
  }
}

/**
 * Copies what `pick` names of this chat's changes (over `base`, the revision it plays, `state` the
 * chat's) into the draft of `base`'s world. A name that is no change of this chat's is skipped, and so
 * is a change the draft has so already; nothing is written when nothing is left.
 */
export function keepInDraft(worlds: UserWorlds, base: WorldDoc, state: Readonly<WorldState>, pick: KeepPick): KeepOutcome {
  const index = worlds.index(base.id);
  if (index === null) return { failed: "no_world" };
  const candidates = keepable(base, state);
  const named: [Keepable["kind"], readonly string[]][] = [
    ["map", pick.maps],
    ["place", pick.places],
    ["path", pick.paths],
  ];
  for (let attempt = 0; attempt < KEEP_TRIES; attempt++) {
    const read = worlds.draft(base.id);
    const working = workingOf(worlds, read, index);
    if (working === null) return { failed: "unreadable" };
    const kept: Kept = { maps: [], places: [], paths: [], settings: false };
    const skipped: Skipped[] = [];
    const edits: DraftEdit[] = [];
    const take = (c: Keepable): void => {
      const edit = c.edit(working.doc);
      if (edit === null) skipped.push({ id: c.id, code: "no_map" });
      else if (alreadyIn(working.doc, edit)) skipped.push({ id: c.id, code: "in_draft_already" });
      else {
        edits.push(edit);
        if (c.kind === "settings") kept.settings = true;
        else kept[c.kind === "map" ? "maps" : c.kind === "place" ? "places" : "paths"].push(c.id);
      }
    };
    for (const [kind, saids] of named) {
      for (const said of saids) {
        const hit = candidates.find((c) => c.kind === kind && (c.id === said || (c.name !== null && plain(c.name) === plain(said)) || plain(c.id) === plain(said)));
        if (hit === undefined) skipped.push({ id: said, code: "not_changed" });
        else if (!edits.some((e) => "collection" in e && e.id === hit.id && e.collection === (kind === "map" ? "maps" : kind === "place" ? "places" : "routes"))) take(hit);
      }
    }
    if (pick.settings) {
      const settings = candidates.find((c) => c.kind === "settings");
      if (settings === undefined) skipped.push({ id: "settings", code: "not_changed" });
      else take(settings);
    }
    if (edits.length === 0) return { kept, skipped, version: read.version, written: false };
    const doc = keptWorld(working.doc, edits);
    const out = worlds.writeDraft(base.id, JSON.stringify({ base: working.base, doc, version: read.version + 1 }), read.version);
    if (out.done) return { kept, skipped, version: out.version, written: true };
  }
  return { failed: "busy" };
}

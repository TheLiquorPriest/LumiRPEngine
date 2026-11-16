// Build's own write path as the proposals write an entry of the user's world through it (plan §9.5, R-154): the entry set in the
// world's draft and the draft committed, version-checked, as the world's next revision; a write the world's head has moved
// past, or while he holds an uncommitted draft of the world (his unsaved edits would be committed with it), is refused.

import { hasOwn, type JsonObject } from "../shared/json";
import { PROTOCOL_VERSION } from "../shared/protocol";
import type { LoreEntryDef } from "../shared/world";
import { WorldError, type WorldStore } from "../worlds/worlds";
import { worldRevision } from "./lore";
import type { LoreEntryFields, LoreWorldWrites, WorldEntryNow } from "./proposals";

/** The world store's calls this takes. */
export type WorldEntryStore = Pick<WorldStore, "index" | "get" | "workingAt" | "edit" | "editFrom" | "commit">;

function nowOf(entry: LoreEntryDef, key: string): WorldEntryNow {
  const keys = Array.isArray(entry.keys) ? entry.keys.filter((k): k is string => typeof k === "string") : [];
  return { fields: { content: typeof entry.content === "string" ? entry.content : "", comment: typeof entry.title === "string" ? entry.title : "", keys }, stamp: worldRevision(entry, key) };
}

export function worldEntryWrites(worlds: WorldEntryStore): LoreWorldWrites {
  /** The entry as the world's head holds it, with the head. */
  const read = async (user: string, world: string, key: string): Promise<{ now: WorldEntryNow; head: string } | null> => {
    const index = await worlds.index(world, user);
    if (index === null) return null;
    const { world: doc } = await worlds.get(world, user, index.head);
    const entry = hasOwn(doc.lore, key) ? doc.lore[key] : undefined;
    return entry === undefined ? null : { now: nowOf(entry, key), head: index.head };
  };
  return {
    async entry(user, world, key) {
      return (await read(user, world, key))?.now ?? null;
    },
    async update(user, world, key, fields: LoreEntryFields, stamp) {
      const found = await read(user, world, key);
      if (found === null) return { refused: "missing" };
      if (found.now.stamp !== stamp) return { refused: "changed" };
      // A stored draft is his: its other edits would be committed with this one.
      if ((await worlds.workingAt(world, user)).at.split("\u0000")[1] !== "") return { refused: "draft" };
      let edited = false;
      try {
        await worlds.editFrom(world, user, (draft) => {
          const entry = hasOwn(draft.lore, key) ? draft.lore[key] : undefined;
          if (entry === undefined) throw new WorldError("conflict", `the world has no entry ${key} any more`);
          const value = { ...entry, title: fields.comment, keys: fields.keys, content: fields.content } as unknown as JsonObject;
          return { lre: PROTOCOL_VERSION, type: "lre.editor", reqId: "", worldId: world, base: null, op: "put", collection: "lore", id: key, value };
        });
        edited = true;
        await worlds.commit(world, found.head, user, { source: "build", note: `lore entry ${key}` });
      } catch (error) {
        // What was set in the draft and not committed is taken off again: the draft was none of his before this write.
        if (edited) await worlds.edit({ lre: PROTOCOL_VERSION, type: "lre.editor", reqId: "", worldId: world, base: null, op: "discard" }, user).catch(() => undefined);
        if (error instanceof WorldError && error.code === "conflict") return { refused: "changed" };
        throw error;
      }
      const after = await read(user, world, key);
      if (after === null) return { refused: "missing" };
      return { written: after.now };
    },
  };
}

// A migrated character's old mind files (plan §15.2, §12): the migration attached each version of
// each file to the character's record as it was, every word, on the turn that held it
// (`character_doc` text of kind `file`), and wrote on that turn the character's mind item for it
// (`src/migrate/minds.ts`: item `imported:<character>:<file>`, value `{ kind: "imported", file,
// version, entity, filed: false }`, a file a turn removed dropped), so a swipe shows the version its
// turn held. Until a file is marked filed, the character's agent is given it whole (the `imported`
// view); marking it filed is a write of the turn that does it, so a swipe of that turn gives the
// file again. The original stays attached. The older minds pack's notes of the character are one
// more such file, `minds` (`carried.ts`), read from the state at the reading's point.

import type { Database } from "bun:sqlite";
import { isRecord } from "../shared/json";
import type { UserStore } from "../store";
import { IMPORTED_KIND } from "./carried";
import { CAST_WRITE } from "./fold";
import { type CastItem, type CastRecord, fileText } from "./record";

/** A character's old mind files on a reading's path, filed or not, in the order they were first carried; a file a turn removed is not among them. */
export function importedFiles(record: CastRecord, character: string): CastItem[] {
  return record.of(character, "mind").filter((m) => m.fields.kind === IMPORTED_KIND);
}

/** Whether a carried file has been marked filed. */
export function isFiled(file: CastItem): boolean {
  return file.fields.filed === true;
}

/** A carried file's name, as the earlier build named it (`core.md`). */
export function fileName(file: CastItem): string {
  return typeof file.fields.file === "string" ? file.fields.file : file.id;
}

/** The text of a carried file as the reading shows it: the version its item names, as it was attached; null when none is. */
export function importedText(db: Database, user: string, file: CastItem): string | null {
  const version = file.fields.version;
  return typeof version === "number" ? fileText(db, user, file.character, fileName(file), version) : null;
}

/** The file of `files` that `said` names: by its name (`core.md`, or `core`), or by its item's id; case ignored. */
export function fileNamed(files: readonly CastItem[], said: string): CastItem | undefined {
  const key = said.trim().toLowerCase();
  return files.find((f) => {
    const name = fileName(f).toLowerCase();
    return f.id.toLowerCase() === key || name === key || name.replace(/\.md$/, "") === key;
  });
}

/** The carried files `by` attached on the turns named, by character: read from what those turns recorded, whatever path shows them. */
export function filesAttachedOn(s: UserStore, turns: readonly string[], by: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const turn of turns) {
    for (const c of s.changes(turn)) {
      if (c.op !== CAST_WRITE || c.by !== by || !isRecord(c.value) || !isRecord(c.value.value)) continue;
      const file = c.value.value.file;
      if (c.value.part !== "mind" || c.value.value.kind !== IMPORTED_KIND || typeof file !== "string" || typeof c.value.character !== "string") continue;
      out.set(c.value.character, (out.get(c.value.character) ?? new Set<string>()).add(file));
    }
  }
  return out;
}

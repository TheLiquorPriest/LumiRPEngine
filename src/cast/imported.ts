// A migrated character's old mind files (plan §15.2, §12): the migration attached each version of
// each file to the character's record as a row of its mind, marked as carried and not yet filed
// (`src/migrate/minds.ts`: item `imported:<character>:<file>`, value `{ kind: "imported", file, text,
// entity, filed: false }`, a file a turn removed dropped). Until a file is marked filed, the
// character's agent is given it whole (the `imported` view); marking it filed is a row of the turn
// that does it, so a swipe of that turn gives the file again. The original stays on the record.

import type { CastItem, CastRecord } from "./record";

/** The kind the migration marks a carried mind file's rows with. */
export const IMPORTED_KIND = "imported";

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

/** The file of `files` that `said` names: by its name (`core.md`, or `core`), or by its item's id; case ignored. */
export function fileNamed(files: readonly CastItem[], said: string): CastItem | undefined {
  const key = said.trim().toLowerCase();
  return files.find((f) => {
    const name = fileName(f).toLowerCase();
    return f.id.toLowerCase() === key || name === key || name.replace(/\.md$/, "") === key;
  });
}

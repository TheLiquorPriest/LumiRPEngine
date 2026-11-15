// What the stand-in Lumiverse's HTTP routes (`http.ts`) write to a user's world books: a book, an entry made, an entry
// changed with the revision check Lumiverse gives it, an entry or a book deleted. Each follows `services/world-books.service.ts`
// (staging at a70f4ed2; paths are Lumiverse's `src/`), written to the rows the stand-in keeps (`db.ts`), which a generation reads its
// lore from. What the stand-in leaves out: the vectors of an entry (it has no vectorization queue; an entry's stored index status
// follows Lumiverse's rule and a test scripts what a search finds).

import type { StandInDb } from "./db";
import { rowToBook, rowToEntry } from "./served";

type Row = Record<string, unknown>;
type Value = string | number | null;

/** What a write answers: the entry or book, or the refusal as Lumiverse's route words it. */
export type Written = { ok: true; body: unknown; event?: { name: string; payload: unknown } } | { ok: false; status: number; body: unknown };

/** The extension keys an entry's own columns hold (`:170-172`). */
const OUTLET_KEYS = ["outlet_name", "outletName"];
const MARKER_KEYS = ["wi_marker", "wiMarker"];
const SIDE_KEYS = ["wi_marker_side", "wiMarkerSide"];
const WI_MARKERS = new Set(["chat_history", "world_info_before", "world_info_after", "char_description", "char_personality", "persona_description", "scenario", "dialogue_examples", "main_prompt", "enhance_definitions", "jailbreak", "nsfw_prompt"]);

const isPlain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const trimmedOrNull = (value: unknown): string | null => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);
const marker = (value: unknown): string | null => (typeof value === "string" && WI_MARKERS.has(value.trim().toLowerCase()) ? value.trim().toLowerCase() : null);
const side = (value: unknown): "before" | "after" | null => (typeof value === "string" && ["before", "after"].includes(value.trim().toLowerCase()) ? (value.trim().toLowerCase() as "before" | "after") : null);

/** `splitManagedEntryExtensions` and `buildStoredEntryExtensions` (`:219-268`): the managed keys given, else the ones the entry's extensions already hold, written back into its extensions. */
function storedExtensions(raw: unknown, outlet: unknown, markerValue?: unknown, sideValue?: unknown): string {
  const parsed = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  const next: Record<string, unknown> = isPlain(parsed) ? (JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>) : {};
  const embeddedOutlet = trimmedOrNull(next.outlet_name ?? next.outletName);
  const embeddedMarker = marker(next.wi_marker ?? next.wiMarker);
  const embeddedSide = side(next.wi_marker_side ?? next.wiMarkerSide);
  for (const key of [...OUTLET_KEYS, ...MARKER_KEYS, ...SIDE_KEYS]) delete next[key];
  const outletName = outlet !== undefined ? trimmedOrNull(outlet) : embeddedOutlet;
  const wiMarker = markerValue !== undefined ? marker(markerValue) : embeddedMarker;
  const wiSide = sideValue !== undefined ? side(sideValue) : embeddedSide;
  if (outletName) next.outlet_name = outletName;
  if (wiMarker) next.wi_marker = wiMarker;
  if (wiSide) next.wi_marker_side = wiSide;
  return JSON.stringify(next);
}

const validRevision = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

/** `WorldBookEntryConflictError.payload` (`:30-59`): the entry as it stands now, for a client to merge against. */
const conflict = (id: string, current: Row | null): Written => ({ ok: false, status: 409, body: { error: "world_book_entry_conflict", code: "WORLD_BOOK_ENTRY_CONFLICT", conflicts: [{ id, current }] } });
/** `WorldBookEntryRevisionInvalidError` (`:62-71`), told as 428 (`routes/world-books.routes.ts:1031-1033`). */
const invalid = (): Written => ({ ok: false, status: 428, body: { error: "WORLD_BOOK_ENTRY_REVISION_INVALID", code: "WORLD_BOOK_ENTRY_REVISION_INVALID", field: "expected_revision" } });
/** `WorldBookEntryOrganizationError` (`:1747-1757`), told with its own status. */
const organization = (message: string): Written => ({ ok: false, status: 400, body: { error: message } });

const BOOL_FIELDS = ["selective", "constant", "disabled", "group_override", "case_sensitive", "match_whole_words", "use_regex", "prevent_recursion", "exclude_recursion", "delay_until_recursion", "use_probability", "vectorized"] as const;
const INT_FIELDS = ["position", "depth", "order_value", "group_weight", "probability", "scan_depth", "priority", "sticky", "cooldown", "delay", "selective_logic"] as const;
const STRING_FIELDS = ["content", "comment", "role", "group_name", "automation_id"] as const;

/** `normalizeEntryTags` (`:371-378`). */
const tagsOf = (value: unknown): string[] => (Array.isArray(value) ? [...new Set(value.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean))] : []);

/** `validateOrganizationInput` (`:341-352`). */
function organizationFault(input: Row): string | null {
  if (input.folder !== undefined && typeof input.folder !== "string") return "folder must be a string";
  if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.some((tag) => typeof tag !== "string"))) return "tags must be an array of strings";
  return null;
}

/** `getEntry` (`:1739-1744`): an entry of one of the user's books. */
export function entryOf(db: StandInDb, user: string, id: string): Row | undefined {
  return db.rows("SELECT e.* FROM world_book_entries e JOIN world_books w ON e.world_book_id = w.id WHERE e.id = ? AND w.user_id = ?", id, user)[0];
}

const touch = (db: StandInDb, book: string, now: number): void => db.run("UPDATE world_books SET updated_at = ? WHERE id = ?", now, book);

/** `createWorldBook` (`:1100-1111`, route `routes/world-books.routes.ts:318-323`): `name` required; answered with 201. */
export function createBook(db: StandInDb, user: string, input: Row, now: number): Written {
  if (!input.name) return { ok: false, status: 400, body: { error: "name is required" } };
  const id = crypto.randomUUID();
  db.run(
    "INSERT INTO world_books (id, user_id, name, description, folder, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    id,
    user,
    String(input.name),
    String(input.description || ""),
    String(input.folder || ""),
    JSON.stringify(input.metadata || {}),
    now,
    now,
  );
  const book = rowToBook(db.rows("SELECT * FROM world_books WHERE id = ? AND user_id = ?", id, user)[0]!);
  return { ok: true, body: book, event: { name: "WORLD_BOOK_CHANGED", payload: { id, worldBook: book } } };
}

/** `createEntry` (`:1746-1830`, route `:960-974`): the columns' own defaults, a uid of its own, its index status pending where it is eligible for vectors, revision 1; answered with 201. */
export function createEntry(db: StandInDb, user: string, bookId: string, input: Row, now: number): Written {
  const fault = organizationFault(input);
  if (fault !== null) return organization(fault);
  const id = crypto.randomUUID();
  const vectorized = !!input.vectorized;
  const eligible = vectorized && !input.disabled && String(input.content || "").trim().length > 0;
  const values: Record<string, Value> = {
    id,
    world_book_id: bookId,
    uid: crypto.randomUUID(),
    key: JSON.stringify(input.key || []),
    keysecondary: JSON.stringify(input.keysecondary || []),
    content: String(input.content || ""),
    comment: String(input.comment || ""),
    position: Number(input.position ?? 0),
    depth: Number(input.depth ?? 4),
    role: input.role ? String(input.role) : null,
    order_value: Number(input.order_value ?? 100),
    selective: input.selective ? 1 : 0,
    constant: input.constant ? 1 : 0,
    disabled: input.disabled ? 1 : 0,
    group_name: String(input.group_name || ""),
    group_override: input.group_override ? 1 : 0,
    group_weight: Number(input.group_weight ?? 100),
    probability: Number(input.probability ?? 100),
    scan_depth: input.scan_depth === undefined || input.scan_depth === null ? null : Number(input.scan_depth),
    case_sensitive: input.case_sensitive ? 1 : 0,
    match_whole_words: input.match_whole_words ? 1 : 0,
    automation_id: input.automation_id ? String(input.automation_id) : null,
    use_regex: input.use_regex ? 1 : 0,
    prevent_recursion: input.prevent_recursion ? 1 : 0,
    exclude_recursion: input.exclude_recursion ? 1 : 0,
    delay_until_recursion: input.delay_until_recursion ? 1 : 0,
    priority: Number(input.priority ?? 10),
    sticky: Number(input.sticky ?? 0),
    cooldown: Number(input.cooldown ?? 0),
    delay: Number(input.delay ?? 0),
    selective_logic: Number(input.selective_logic ?? 0),
    use_probability: input.use_probability !== false ? 1 : 0,
    vectorized: vectorized ? 1 : 0,
    vector_index_status: eligible ? "pending" : "not_enabled",
    vector_indexed_at: null,
    vector_index_error: null,
    extensions: storedExtensions(input.extensions, input.outlet_name, input.wi_marker, input.wi_marker_side),
    created_at: now,
    updated_at: now,
    folder: typeof input.folder === "string" ? input.folder.trim() : "",
    tags: JSON.stringify(tagsOf(input.tags)),
  };
  const columns = Object.keys(values);
  db.run(`INSERT INTO world_book_entries (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, ...columns.map((c) => values[c]!));
  touch(db, bookId, now);
  const created = rowToEntry(entryOf(db, user, id)!);
  return { ok: true, body: created, event: { name: "WORLD_BOOK_ENTRY_CHANGED", payload: { id, worldBookId: bookId, entry: created } } };
}

/**
 * `updateEntry` (`:1833-1941`): the fields given written, the entry's revision raised by one and its book touched; with `expected_revision` the write
 * is made only where the entry still holds that revision, else refused with the entry as it stands (409); one present and not a whole number from 1
 * is refused first (428), even where nothing else changes. Given no field that changes anything, the entry is answered as it is with no write, no
 * revision raised and no event, the check still made.
 */
export function updateEntry(db: StandInDb, user: string, id: string, input: Row, now: number): Written | null {
  const asked = Object.prototype.hasOwnProperty.call(input, "expected_revision");
  if (asked && !validRevision(input.expected_revision)) return invalid();
  const expected = asked ? (input.expected_revision as number) : undefined;
  const existingRow = entryOf(db, user, id);
  if (existingRow === undefined) return null;
  const existing = rowToEntry(existingRow);
  const fault = organizationFault(input);
  if (fault !== null) return organization(fault);
  const fields: string[] = [];
  const values: Value[] = [];
  if (input.folder !== undefined) {
    fields.push("folder = ?");
    values.push(String(input.folder).trim());
  }
  if (input.tags !== undefined) {
    fields.push("tags = ?");
    values.push(JSON.stringify(tagsOf(input.tags)));
  }
  for (const f of ["key", "keysecondary"] as const) {
    if (input[f] !== undefined) {
      fields.push(`${f} = ?`);
      values.push(JSON.stringify(input[f]));
    }
  }
  for (const f of STRING_FIELDS) {
    if (input[f] !== undefined) {
      fields.push(`${f} = ?`);
      values.push(input[f] as Value);
    }
  }
  for (const f of INT_FIELDS) {
    if (input[f] !== undefined) {
      fields.push(`${f} = ?`);
      values.push(input[f] as Value);
    }
  }
  for (const f of BOOL_FIELDS) {
    if (input[f] !== undefined) {
      fields.push(`${f} = ?`);
      values.push(input[f] ? 1 : 0);
    }
  }
  if (input.extensions !== undefined || input.outlet_name !== undefined || input.wi_marker !== undefined || input.wi_marker_side !== undefined) {
    fields.push("extensions = ?");
    values.push(
      storedExtensions(
        input.extensions ?? existing.extensions,
        input.outlet_name !== undefined ? input.outlet_name : existing.outlet_name,
        input.wi_marker !== undefined ? input.wi_marker : existing.wi_marker,
        input.wi_marker_side !== undefined ? input.wi_marker_side : existing.wi_marker_side,
      ),
    );
  }
  // `shouldResetVectorIndex` (`:381-392`).
  if (["vectorized", "content", "comment", "key", "keysecondary", "disabled"].some((f) => input[f] !== undefined)) {
    const eligible = !!(input.vectorized ?? existing.vectorized) && !(input.disabled ?? existing.disabled) && String(input.content ?? existing.content ?? "").trim().length > 0;
    fields.push("vector_index_status = ?", "vector_indexed_at = ?", "vector_index_error = ?");
    values.push(eligible ? "pending" : "not_enabled", null, null);
  }
  const revision = (row: Row): number => (validRevision(row.revision) ? row.revision : 1);
  if (expected !== undefined && revision(existingRow) !== expected) return conflict(id, existing);
  if (fields.length === 0) return { ok: true, body: existing };
  fields.push("updated_at = ?", "revision = revision + 1");
  values.push(now, id);
  db.run(`UPDATE world_book_entries SET ${fields.join(", ")} WHERE id = ?`, ...values);
  touch(db, String(existingRow.world_book_id), now);
  const updated = rowToEntry(entryOf(db, user, id)!);
  return { ok: true, body: updated, event: { name: "WORLD_BOOK_ENTRY_CHANGED", payload: { id, worldBookId: updated.world_book_id, entry: updated } } };
}

/** `deleteEntry` (`:1943-1990`, route `:1096-1100`): the route passes no revision; the entry's row gone and its book touched, `WORLD_BOOK_ENTRY_DELETED` told. */
export function deleteEntry(db: StandInDb, user: string, id: string, now: number): Written | null {
  const existing = entryOf(db, user, id);
  if (existing === undefined) return null;
  db.run("DELETE FROM world_book_entries WHERE id = ?", id);
  touch(db, String(existing.world_book_id), now);
  return { ok: true, body: { success: true }, event: { name: "WORLD_BOOK_ENTRY_DELETED", payload: { id, worldBookId: existing.world_book_id } } };
}

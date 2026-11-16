// What a character may know of the lore and which secrets it holds (plan §9.4, §9.6), by today's own rule: a public entry, one whose
// links the character knows, a secret it holds; an entry that awaits review is the GM's alone. The world's entries are read as they stand
// in the chat's world; a book's entries as lore, found by their own fields alone (`booksAsLore`), each mark of an entry a secret of its own.
// A character the story made a holder of a secret (a holding that counts at the reader's point, R-189) reads it, gate or no gate, as one the
// world names; for anyone else the rule stands exactly. Nothing here changes a state or a book.

import { loreHeldBy, loreReadable } from "../../engine/lore";
import { loreGateReader } from "../../engine/visibility";
import { bookLoreId, bookMarkLoreId, booksAsLore, entriesRead } from "../../secrecy/book-lore";
import { copiedOriginals } from "../../secrecy/lore-secrets";
import type { HostBookEntry } from "../../shared/host";
import type { EntityId } from "../../shared/ids";
import { hasOwn } from "../../shared/json";
import { loreIsSecret, loreSourceOf } from "../../shared/lore";
import type { HoldingHow } from "../../shared/minds";
import { hasSecretMarks, renderSecretMarks, unreadableMarks, wholeEntrySecret } from "../../shared/secret-marks";
import type { LoreEntryDef, StepPurpose, WorldDoc } from "../../shared/world";
import type { LoreBookEntry, WorldAt } from "../sources";
import type { HoldersAt } from "./holders";

/** How today's code reads lore as a character: as the minds read it (`backend/minds-context.ts:519,528`). */
export const AS_CHARACTER: StepPurpose = "mind";

/** A book entry as the secrecy's lore reads it (`booksAsLore`). */
function hostEntry(row: LoreBookEntry): HostBookEntry {
  return { id: row.id, bookId: row.book, comment: row.comment, content: row.content, keys: row.keys, secondaryKeys: row.secondaryKeys, disabled: row.disabled, constant: row.constant, position: 0, depth: 0, role: null, order: 0, extensions: row.extensions };
}

/** The world with the lore of the books' entries beside its own, as today's live lore has it: each entry and each mark held back as its fields and text say, a copy as secret as its original. */
export async function worldWithBooks(world: WorldDoc, rows: readonly LoreBookEntry[], entry: (id: string) => Promise<LoreBookEntry | null>): Promise<WorldDoc> {
  const live = entriesRead(rows.map(hostEntry));
  const originals = await copiedOriginals(async (id) => {
    const row = await entry(id);
    return row === null ? null : hostEntry(row);
  }, live);
  return booksAsLore(world, live, originals).world;
}

/** A secret a character holds, as it is worded to it: its words, and how it came by it (an author's seeding reads `authored`). */
export interface HeldSecret {
  /** The secret's lore id in the world the character reads: a world entry's key, or a book entry's or mark's (`book:<book>/<entry>[#n]`). */
  id: string;
  title: string;
  text: string;
  how: HoldingHow;
  /** Who told them, where they were told and the story says. */
  by: string | null;
}

/**
 * One character's reading of a world: whether an entry of `doc` is theirs to know, what they may read of a book entry's text, and the secrets they
 * hold. `doc` is the chat's world for its own entries, or that world with its books' lore (`worldWithBooks`) for a book's.
 */
export class CharacterReads {
  readonly #at: WorldAt;
  readonly #doc: WorldDoc;
  readonly #who: EntityId;
  readonly #holds: HoldersAt;
  readonly #open: (entry: LoreEntryDef) => boolean;

  constructor(at: WorldAt, doc: WorldDoc, who: EntityId, holds: HoldersAt) {
    this.#at = at;
    this.#doc = doc;
    this.#who = who;
    this.#holds = holds;
    this.#open = loreGateReader(at.registry, doc, at.state);
  }

  /** The entry as this character reads it: a secret the story made them a holder of names them among its holders too (`key` is its id in the world). */
  view(key: string, entry: LoreEntryDef): LoreEntryDef {
    if (!loreIsSecret(entry) || !this.#holds.holds(this.#who, key)) return entry;
    return { ...entry, holders: [...(Array.isArray(entry.holders) ? entry.holders : []), this.#who] };
  }

  /** Whether the character may know the entry `key` of the world. */
  readable(key: string, entry: LoreEntryDef): boolean {
    return loreReadable(this.#at.registry, this.#doc, this.#at.state, this.view(key, entry), AS_CHARACTER, false, this.#open, this.#who);
  }

  /**
   * What the character may read of a book entry's text, null where it may read none: a public entry as written, each mark of it in place
   * where the character holds it and left out where it does not; an entry that is one secret, as the secret, to its holders alone; an entry
   * with no text of its own that is only marks, the marks the character holds. The entries of today's rule only: one that holds no lore
   * (switched off, empty, the engine's own, a twin of a text read already) is read by no one.
   */
  bookText(row: LoreBookEntry): string | null {
    const id = bookLoreId(row.book, row.id);
    const def = hasOwn(this.#doc.lore, id) ? this.#doc.lore[id] : undefined;
    const own = def !== undefined && this.readable(id, def);
    const whole = wholeEntrySecret(row.content);
    if (whole !== null) return own ? whole.text : null;
    if (!hasSecretMarks(row.content) && unreadableMarks(row.content).length === 0) return own && def !== undefined ? def.content : null;
    const held = new Map<number, string>();
    renderSecretMarks(row.content, (mark, n) => {
      const markId = bookMarkLoreId(row.book, row.id, n);
      const mine = hasOwn(this.#doc.lore, markId) ? this.#doc.lore[markId] : undefined;
      if (mine !== undefined && this.readable(markId, mine)) held.set(n, mark.text);
      return "";
    });
    if (own) return renderSecretMarks(row.content, (_mark, n) => held.get(n) ?? "");
    return held.size === 0 ? null : [...held.values()].join("\n\n");
  }

  /**
   * The secrets the character holds, in the world's order: those it names as holders from the start (an entry's `holders`, a mark's `known to`,
   * its cues) and those the story made them a holder of, each once, with how it came by it. A secret that awaits review, or has no words, is left out.
   */
  held(): HeldSecret[] {
    const counted = this.#holds.counted(this.#who);
    const out: HeldSecret[] = [];
    for (const key of Object.keys(this.#doc.lore).sort()) {
      const def = hasOwn(this.#doc.lore, key) ? this.#doc.lore[key] : undefined;
      if (def === undefined || !loreIsSecret(def)) continue;
      const source = loreSourceOf(def.source);
      if (source.kind === "ai" && source.status === "pending") continue;
      const played = counted.get(key);
      if (played === undefined && !loreHeldBy(this.#doc, def, this.#who)) continue;
      const text = (typeof def.content === "string" ? def.content : "").replace(/\s+/g, " ").trim();
      if (text === "") continue;
      out.push({ id: key, title: typeof def.title === "string" ? def.title : key, text, how: played?.how ?? "authored", by: played?.by == null ? null : this.#holds.name(played.by) });
    }
    return out;
  }
}

// The id a secret is shown by, and the fact it is in today's state (plan §9.6, App. A `LoreSecret`): a world secret entry `w-31`
// is today's `lore:<key>`; a book entry that is one secret, `e-112`, is `wi:<book>:<entry>`; the second mark in a book entry's text,
// `e-112#2` (marks count from 1), is `wi:<book>:<entry>:1` (today's marks count from 0). A perception that names a secret by the id
// it was shown is turned into the fact by `secretFactOf`; the facts a state holds are shown by `shownSecretId`. Today's own forms
// pass through: a fact id of lore or World Info, and a live lore id (`book:<book>/<entry>`, `book:<book>/<entry>#<n>`).

import { type FactId, factId, parseFactId, wiFactIdOfLiveLore } from "../../shared/minds";
import type { EntryNumbers } from "../ids";
import type { LoreBooks } from "../sources";

/** A shown id's parts: the entry's RPE id and, for a mark in a book entry's text, its place from 1. */
const SHOWN = /^([ew])-(\d+)(?:#(\d+))?$/;

/** What the resolver reads: RPE's numbers of entries, and the user's books for the book an entry is in. */
export interface SecretIdsDeps {
  numbers: Pick<EntryNumbers, "entry" | "of" | "worldEntry" | "worldNumberOf">;
  books: Pick<LoreBooks, "entry">;
}

export interface SecretIds {
  /** The fact a secret is in today's state, from the id it is shown by or one of today's own forms; null for an id that names no secret of this user's. */
  secretFactOf(user: string, shown: string): Promise<FactId | null>;
  /**
   * The id a fact is shown by: null for a fact that is no lore secret, or one of a world entry the user's numbers do not hold. A
   * key several of the user's worlds hold is shown by the one `world` names; with none named, it is not shown.
   */
  shownSecretId(user: string, fact: FactId, world?: string): Promise<string | null>;
}

export function secretIds(deps: SecretIdsDeps): SecretIds {
  return {
    async secretFactOf(user, shown) {
      const said = shown.trim();
      const m = SHOWN.exec(said);
      if (m === null) {
        // Today's forms: a fact id of lore or of World Info, or the live id of a book entry or mark.
        const kind = parseFactId(said)?.kind;
        return kind === "lore" || kind === "wi" ? said : wiFactIdOfLiveLore(said);
      }
      const n = Number(m[2]);
      const mark = m[3] === undefined ? null : Number(m[3]);
      if (m[1] === "w") {
        if (mark !== null) return null;
        const world = deps.numbers.worldEntry(user, n);
        return world === null ? null : factId({ kind: "lore", lore: world.key });
      }
      if (mark !== null && mark < 1) return null;
      const entry = deps.numbers.entry(user, n);
      const row = entry === null ? null : await deps.books.entry(user, entry);
      return row === null ? null : factId({ kind: "wi", book: row.book, entry: row.id, mark: mark === null ? null : mark - 1 });
    },

    async shownSecretId(user, fact, world) {
      const ref = parseFactId(fact);
      if (ref?.kind === "lore") {
        const n = deps.numbers.worldNumberOf(user, ref.lore, world);
        return n === null ? null : `w-${n}`;
      }
      if (ref?.kind === "wi") {
        const n = (await deps.numbers.of(user, [ref.entry])).get(ref.entry);
        return n === undefined ? null : `e-${n}${ref.mark === null ? "" : `#${ref.mark + 1}`}`;
      }
      return null;
    },
  };
}

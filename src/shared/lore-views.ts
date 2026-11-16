// Build's views of his lore books (DESIGN §4.2, §24.5, §9.6): a book and its entries with their lore
// fields and marks, the lore index Build built, the pins, and each book's secrecy plan, as Build's
// lore service answers them and the kept components show them. Moved unchanged out of the previous
// extension's protocol and settings registry (PlanSwap-13), which take them back from here until
// PlanSwap-10 removes them.

import type { EntityId, PlaceId } from "./ids";
import type { BookLoreFields } from "./lore";
import type { LorePin, StepPurpose } from "./world";

/** One World Info entry, by its book and its own id. */
export interface LoreEntryRef {
  bookId: string;
  entryId: string;
}

/** The lore index entry Build → Lore built (DESIGN §4.2): where it is, and the world whose books it lists, which LRE keeps it in step with. */
export interface BuiltLoreIndex extends LoreEntryRef {
  worldId: string;
}

/**
 * The lore index of a world's books as Build shows it (`lre.lore index`): the text Build's index
 * entry holds (the entries anyone may read), each book with how many entries it lists, and the entry
 * LRE keeps in sync, with its book's name, when there is one.
 */
export interface LoreIndexView {
  text: string;
  books: { id: string; name: string; entries: number }[];
  built: (BuiltLoreIndex & { book: string }) | null;
}

/**
 * A change to the secret marks in one World Info entry's text (`lre.lore mark`), names as written:
 * `secret` makes its whole text one secret; `add` adds a secret line at its end; `names` changes the
 * names of its mark `mark`, and `public` makes that mark plain text again (marks counted from 0, in
 * the order its text holds them).
 */
export type LoreMarkChange =
  | { kind: "secret"; knownTo: string[]; keptFrom: string[] | "everyone" }
  | { kind: "add"; text: string; knownTo: string[]; keptFrom: string[] | "everyone" }
  | { kind: "names"; mark: number; knownTo: string[]; keptFrom: string[] | "everyone" }
  | { kind: "public"; mark: number };

/** A secret mark in an entry's text as Build shows it: its text, and its names as written. */
export interface LoreMarkView {
  text: string;
  knownTo: string[];
  keptFrom: string[] | "everyone";
}

/**
 * A World Info book a pin may name an entry of (`lre.lore books`); `attached`: to the chat asked
 * about. `character`: a character brought it (Lumiverse makes a book of its own for each one a card
 * it imports carries, which may share its name with one imported on its own); `added`: when it was
 * made, in Unix seconds, or null. A picker tells books with the same name apart by these.
 */
export interface LoreBookView {
  id: string;
  name: string;
  attached: boolean;
  character: boolean;
  added: number | null;
}

/**
 * One entry of a World Info book, for a pin picker and the lore editor (`lre.lore entries`);
 * `disabled`: switched off in its book, which a pin still reads; `lore`: its LRE fields, when it has
 * any (an earlier build's secrecy among them, read as it stands). `marks`: the secret marks its text
 * holds, in order; `whole` when its whole text is one, which makes the whole entry secret;
 * `unreadable`: what in its text starts like a mark but can't be read as one, and why. `copyOf`: the
 * entry an earlier build switched this one off as a copy of, as its note names it.
 */
export interface LoreBookEntryView {
  id: string;
  title: string;
  disabled: boolean;
  /** Its text's length, in characters. */
  chars: number;
  /** Lumiverse's revision of it: a write sends the revision it read, and is refused where the entry has changed since. */
  revision?: number;
  lore?: BookLoreFields;
  marks?: LoreMarkView[];
  whole?: true;
  unreadable?: { raw: string; problem: string }[];
  copyOf?: { bookId: string; entryId: string };
}

/**
 * A pin as read now (`lre.lore pins`): its entry's title and where it comes from (the world's lore,
 * or a book by name). `missing`: no such lore entry, or gone from its book; `pending`: an AI-written
 * entry not reviewed yet, which nothing reads; `off`: switched off in its book, which a pin still
 * reads. `secret`: a secret world entry, which reaches only the readers it allows.
 */
export interface LorePinView {
  key: string;
  pin: LorePin;
  title: string;
  source: string;
  status: "ok" | "missing" | "pending" | "off";
  secret: boolean;
}

/** Every pin of a world, read now (`lre.lore pins`), by character, by place and by step, in order. */
export interface LorePinsView {
  characters: Record<EntityId, LorePinView[]>;
  places: Record<PlaceId, LorePinView[]>;
  steps: Partial<Record<StepPurpose, LorePinView[]>>;
}

/**
 * Where a book stands in its move to secret marks: never moved, or put back (`legacy`); moved and
 * waiting for the user's check (`applied`); moved with its old fields taken off (`confirmed`); or put
 * back only in part, a restore that didn't finish, which Restore finishes (`restoring`).
 */
export type SecrecyState = "legacy" | "applied" | "confirmed" | "restoring";

/** A book of the user's on Build's secrecy page (`lre.secrecy books`): when its latest move was applied, and when that move was put back, in Unix ms (null for none). */
export interface SecrecyBookView extends LoreBookView {
  state: SecrecyState;
  applied: number | null;
  restored: number | null;
}

/**
 * One entry a book's move lists (`lre.secrecy preview`), by what LRE left on it:
 * - `mark`: an LRE secret whose whole text becomes one secret mark, `mark` (the entry's text once
 *   moved), known to `knownTo` (its holders' ids, as LRE stored them);
 * - `marked`: an LRE secret whose text holds secret marks already, which it is read by; its text stays;
 * - `twin`: a copy LRE kept off with the secret `original`, whose text becomes the same mark (`mark`,
 *   known to `knownTo`), then put back as its note says it stood (`was`: switched off or on, and
 *   whether it had LRE fields of its own);
 * - `fields`: LRE fields on an entry that keeps nothing secret, which Confirm takes off (`removes`);
 * - `refused`: an LRE secret, or a twin (`original`), whose text can't be a mark (`reason`), which
 *   keeps its old secrecy.
 * `gate` and `audience`: what no longer applies once a secret is a mark. `switchedOff`: LRE switched
 * it off and nothing says how it stood before, so the move leaves it off and the page lists it for
 * the user to switch on. `off`: stored switched off now. Once moved, `now` says whether it stands as
 * the move left it, was changed since (Restore replaces the change, keeping a copy in the backup), is
 * gone (Restore can't put it back) or stands as before the move already; `marked`, whether its text
 * holds a secret mark now; `error`, the last step whose write to it failed, and why.
 */
export interface SecrecyEntryView {
  id: string;
  title: string;
  kind: "mark" | "marked" | "twin" | "fields" | "refused";
  off: boolean;
  mark?: string;
  knownTo?: string[];
  gate?: string;
  audience?: StepPurpose[];
  switchedOff?: boolean;
  original?: { bookId: string; entryId: string };
  was?: { off: boolean; fields: boolean };
  removes?: string[];
  reason?: string;
  now?: "moved" | "changed" | "gone" | "before";
  marked?: boolean;
  error?: { step: "apply" | "confirm" | "restore"; message: string };
}

/**
 * A book's move to secret marks (`lre.secrecy preview`, and the answer to Apply, Confirm and
 * Restore): when its latest move was applied, confirmed and put back (Unix ms, null for none);
 * `version`, what Apply, Confirm and Restore send back; `entries`, what Apply would do, or what the
 * move did; `damaged`, where a backup file that couldn't be read was kept aside, when one was (the
 * book then reads as never moved).
 */
export interface SecrecyBookPlan {
  bookId: string;
  name: string;
  state: SecrecyState;
  applied: number | null;
  confirmed: number | null;
  restored: number | null;
  version: string;
  entries: SecrecyEntryView[];
  damaged: string | null;
}

// What the secrecy rule is checked on: invented books of Harbor notes, each kind of held-back entry
// among them (a marked passage, a whole-entry secret, an earlier build's secret, a twin of a mark, and
// copies that name an original) and a world whose own lore shows through a book entry. Pure data and a
// stub of the reader of one entry by id, so a check runs on `src/secrecy/` alone.

import { blankWorld } from "../../src/engine/authoring";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import type { WorldInfoCandidate } from "../../src/shared/host";
import type { HostBookEntry } from "../../src/shared/host";
import type { JsonObject } from "../../src/shared/json";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import type { WorldDoc } from "../../src/shared/world";

export const registry = createRegistry(ALL_PACKS);

export const USER = "user-harbor";

export const FERRY = "FERRY-MARK: the ferry runs twice a day.";
export const DEBT = "DEBT-MARK: Marcus owes the marina three months of slip fees.";
export const WRECK = "WRECK-MARK: the old boat went down with the marina's records aboard.";
export const DOCK = "DOCK-MARK: the dock is stone.";
export const SEEN = "SEEN-MARK: Jordan saw the boat go down from the breakwater.";
export const PLAIN = "PLAIN-MARK: the pier is older than the ferry.";
export const OLD = "OLD-SECRET: the ferryman scuttled the old boat for the insurance money.";
export const ORIGINAL = "ORIGINAL-SECRET: the lamp-keeper keeps a second ledger.";

/** LRE's own fields on an entry, in its extension data. */
export const lreFields = (lore: JsonObject, more: JsonObject = {}): JsonObject => ({ [LEDGER_NAMESPACE]: { lore, ...more } });

/** A book entry as the host gives one. */
export function bookEntry(bookId: string, id: string, content: string, over: Partial<HostBookEntry> = {}): HostBookEntry {
  return { id, bookId, comment: id, content, keys: ["ferry"], disabled: false, constant: true, position: 0, depth: 4, role: null, order: 100, extensions: {}, ...over };
}

/** The entry as the interceptor is handed it. */
export const candidateOf = (e: HostBookEntry): WorldInfoCandidate => ({ id: e.id, bookId: e.bookId, disabled: e.disabled, extensions: e.extensions, comment: e.comment, content: e.content });

/** The books the chat reads: `b1` holds a marked passage, a whole-entry secret, an earlier build's secret, a twin of a mark and a plain entry; `b2` holds copies. */
export function books(): HostBookEntry[] {
  return [
    bookEntry("b1", "e-ferry", `${FERRY}\n{{// Secret (known to Marcus): ${DEBT}}}`),
    bookEntry("b1", "e-wreck", `{{// Secret: ${WRECK}}}`),
    bookEntry("b1", "e-dock", `${DOCK}\n{{// Secret (known to Jordan): ${SEEN}}}`),
    bookEntry("b1", "e-old", OLD, { disabled: true, extensions: lreFields({ secret: true, gate: "self.cash > 100000" }) }),
    bookEntry("b1", "e-twin", `  ${DEBT.replace(" ", "   ")}\n`),
    bookEntry("b1", "e-plain", PLAIN),
    bookEntry("b1", "e-engine", `{{// Secret: ENGINE-TEXT}}`, { extensions: { [LEDGER_NAMESPACE]: { slot: "scene" } } }),
    bookEntry("b2", "e-copy", ORIGINAL, { extensions: { [LEDGER_NAMESPACE]: { secretCopyOf: { entry: "b3/e-original", off: false } } } }),
    bookEntry("b2", "e-lost", "LOST-COPY: a copy whose original is gone.", { extensions: { [LEDGER_NAMESPACE]: { secretCopyOf: { entry: "b3/e-gone", off: false } } } }),
    bookEntry("b2", "e-unread", "UNREAD-COPY: a copy whose original can't be read.", { extensions: { [LEDGER_NAMESPACE]: { secretCopyOf: { entry: "b3/e-unreadable", off: false } } } }),
  ];
}

/** The originals the copies name, where the books the chat reads do not hold them. */
export const ORIGINALS: Record<string, HostBookEntry> = { "e-original": bookEntry("b3", "e-original", ORIGINAL, { extensions: lreFields({ secret: true, gate: "self.cash > 5" }) }) };

/** A reader of one entry by id, as the host gives it: one is read, one is gone, one cannot be read. */
export async function readEntry(entryId: string): Promise<HostBookEntry | null> {
  if (entryId === "e-unreadable") throw new Error("the host would not say");
  return Object.hasOwn(ORIGINALS, entryId) ? (ORIGINALS[entryId] ?? null) : null;
}

/** Harbor: a world whose own lore holds an entry its first build copied from `b1/e-plain`, a secret of its own, and a pin of the copy. */
export function harbor(): WorldDoc {
  const world = blankWorld("w-harbor", "Harbor");
  world.lore = {
    "copy-of-plain": { id: "copy-of-plain", title: "The pier", content: PLAIN, keys: [], links: [], source: { kind: "book", bookId: "b1", entryId: "e-plain", hash: "h" } },
    own: { id: "own", title: "The lighthouse", content: "The lighthouse is white.", keys: ["lighthouse"], links: [] },
    vault: { id: "vault", title: "The vault", content: "VAULT-SECRET: the vault holds the marina's silver.", keys: [], links: [], secret: true, gate: "false" },
  };
  world.lorePins = { characters: { you: [{ lore: "copy-of-plain" }, { lore: "own" }] }, places: { home: [{ lore: "vault" }] }, steps: {} };
  return world;
}

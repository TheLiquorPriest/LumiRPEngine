// Where the cast's writes come from (plan §6.6, §10.5): every item the cast's tools write (an operation of `cast_update`, a
// perception, a memory, an entry of the mind, a relationship) can carry a source, a precision and a standing, read as the engine's
// operations read them (`iface/source.ts`). An item that names no source is written all the same, marked `unsourced`; an
// invention names its gap check and its consent, or is marked so. What cannot be read of them is left out and said, never refused.

import type { JsonObject } from "rp-harness/contract";
import type { Reply } from "../iface/kit";
import { MARKS, type Provenance, provenanceLeniently, type Stamp, stampOf } from "../iface/source";
import { textOf } from "../iface/texts";
import type { CastCall } from "./kit";
import type { ItemRead } from "./update";

/** The arguments every item that is written reads for where it comes from. */
export const PROVENANCE_READS = ["source", "precision", "standing"] as const;

/** What an item reads, said to the agent: its provenance aside, which every item that is written reads and each argument's file says. */
export const shownReads = (reads: readonly string[]): string[] => reads.filter((f) => !(PROVENANCE_READS as readonly string[]).includes(f));

/** What a secret's own fact (the lore marks it) is recorded with: it comes from the lore, whoever tells it. */
export const LORE_STAMP: Stamp = { source: "lore", precision: null, standing: null, cite: null };

/** What a character's own bookkeeping is recorded with (what recalling a memory strengthens): the character's. */
export const CHARACTER_STAMP: Stamp = { source: "character", precision: null, standing: null, cite: null };

/** Reads the provenance an item carries onto the item (`prov`); an argument that cannot be read is left out and said on it. */
export function readSource(call: CastCall, it: ItemRead, given: JsonObject): void {
  const { prov, left } = provenanceLeniently(given, call.agent);
  for (const u of left) it.unread.push({ line: "unreadable_op", fields: { n: it.n, op: it.op ?? "", field: u.field, value: JSON.stringify(u.value), choices: textOf(u.choices) } });
  it.prov = prov;
}

/** What a write carries to the store: its item's provenance as a change keeps it; none where the writer's own stands. */
export const stampOn = (prov: Provenance | undefined): { stamp?: Stamp } => (prov === undefined ? {} : { stamp: stampOf(prov) });

/** The marks and lines the provenance of each item written carries into the answer: the writes were made all the same. */
export function sourceLines(reply: Reply, items: readonly ItemRead[]): void {
  for (const it of items) {
    const prov = it.prov;
    if (prov === undefined || it.fatal.length > 0) continue;
    for (const mark of prov.marks) reply.mark(mark);
    const fields = { n: it.n, op: it.op ?? "" };
    if (prov.marks.includes(MARKS.unsourced)) reply.line("unsourced", fields);
    if (prov.marks.includes(MARKS.noGapCheck)) reply.line("invented_unchecked", fields);
    if (prov.marks.includes(MARKS.noConsent)) reply.line("invented_unconsented", fields);
  }
}

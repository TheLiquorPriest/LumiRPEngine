// Search by meaning (plan §9.4, §10.5): one vector per lore entry, chat message, state thing and story item, kept in the index file
// (Appendix B, `CONTRACT.md`'s PlanTurn line) by the user, its id and its revision, with no text, and rebuilt from its sources. The
// vectors are made on the user's embedding connection through RPH's model layer (`ModelsApi.embed`), never by RPE calling a model.
// With no embedding connection set, the query is never embedded, nothing is sent anywhere, and a search answers null: every hit is by
// words. A place's vectors are brought up to date when it is next searched: a row whose revision changed is embedded again, a row gone
// is dropped, so a chat's vectors dropped on request are rebuilt from their sources on next need.

import type { Embedded } from "rp-harness/contract";
import type { IndexFile, TableDef, TableRow } from "../app/index-file/index-file";

/** The places a search by meaning covers, each a scope of its own within a chat. */
export type MeaningPlace = "lore" | "chat" | "state" | "story";
export const MEANING_PLACES: readonly MeaningPlace[] = ["lore", "chat", "state", "story"];

/** The index file's table of vectors: bytes alone, beside the user, id, revision and scope every row carries. */
export const MEANING_TABLE: TableDef = { name: "meaning", columns: { vector: "blob" } };

/** One text of a place, as its source holds it now: its id there, its revision (a changed revision is embedded again), and its text, which is sent to be embedded and never kept. */
export interface MeaningDoc {
  id: string;
  revision: string;
  text: string;
}

/** What the index reads and writes through: the index file, and the user's embedding connection through RPH's model layer. */
export interface MeaningDeps {
  index: Pick<IndexFile, "putRows" | "dropRows" | "rows">;
  embed(user: string, texts: readonly string[]): Promise<Embedded>;
}

const scopeOf = (place: MeaningPlace, chat: string): string => `${place}:${chat}`;
/** A row's revision: its source's, and the connection and model that made it, so a vector of another model is made again and never compared. */
const revisionOf = (doc: MeaningDoc, made: { connection: string; model: string }): string => `${doc.revision}@${made.connection}/${made.model}`;

const toBytes = (vector: readonly number[]): Uint8Array => new Uint8Array(Float32Array.from(vector).buffer);
const toVector = (bytes: Uint8Array): Float32Array => new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** What an embed call came to: the vectors and what made them; null for none set; a failure thrown in the layer's own words. */
function vectorsOf(embedded: Embedded): { connection: string; model: string; vectors: number[][] } | null {
  if (embedded.status === "none") return null;
  if (embedded.status === "failed") throw new Error(embedded.words);
  return embedded;
}

export class MeaningIndex {
  readonly #d: MeaningDeps;

  constructor(deps: MeaningDeps) {
    this.#d = deps;
  }

  /**
   * The ids of `docs` nearest `text` in meaning, nearest first, at most `limit`; null while no embedding connection is set, with nothing
   * sent anywhere. The place's vectors are first brought up to date with `docs` (read only once the connection is known to be set).
   */
  async nearest(user: string, chat: string, place: MeaningPlace, text: string, limit: number, docs: () => Promise<readonly MeaningDoc[]> | readonly MeaningDoc[]): Promise<string[] | null> {
    if (text.trim() === "" || limit <= 0) return [];
    const asked = vectorsOf(await this.#d.embed(user, [text]));
    if (asked === null) return null;
    const query = asked.vectors[0];
    if (query === undefined) return [];
    const rows = await this.#update(user, scopeOf(place, chat), await docs(), asked);
    const q = Float32Array.from(query);
    return rows
      .map((row) => ({ id: row.id, score: row.values.vector instanceof Uint8Array ? cosine(q, toVector(row.values.vector)) : 0 }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit)
      .map((r) => r.id);
  }

  /** A chat's vectors, every place's, dropped (a prune of a living chat's derived rows); rebuilt from their sources when next searched. */
  async dropChat(user: string, chat: string): Promise<void> {
    for (const place of MEANING_PLACES) {
      const ids = (await this.#d.index.rows(MEANING_TABLE, user, scopeOf(place, chat))).map((r) => r.id);
      if (ids.length > 0) await this.#d.index.dropRows(MEANING_TABLE, user, ids);
    }
  }

  /** What a chat's vectors hold, every place's, as `dropChat` would drop them: how many rows, and the bytes of their vectors. */
  async held(user: string, chat: string): Promise<{ rows: number; bytes: number }> {
    let rows = 0;
    let bytes = 0;
    for (const place of MEANING_PLACES) {
      for (const row of await this.#d.index.rows(MEANING_TABLE, user, scopeOf(place, chat))) {
        rows++;
        if (row.values.vector instanceof Uint8Array) bytes += row.values.vector.byteLength;
      }
    }
    return { rows, bytes };
  }

  /** The place's rows brought up to date with its docs by the model that made the query's vector: the changed and new embedded, the gone dropped. */
  async #update(user: string, scope: string, docs: readonly MeaningDoc[], made: { connection: string; model: string }): Promise<TableRow[]> {
    const kept = new Map<string, TableRow>((await this.#d.index.rows(MEANING_TABLE, user, scope)).map((r) => [r.id, r]));
    const ids = new Set(docs.map((d) => d.id));
    const gone = [...kept.keys()].filter((id) => !ids.has(id));
    if (gone.length > 0) await this.#d.index.dropRows(MEANING_TABLE, user, gone);
    const stale = docs.filter((d) => kept.get(d.id)?.revision !== revisionOf(d, made) && d.text.trim() !== "");
    if (stale.length > 0) {
      const embedded = vectorsOf(await this.#d.embed(user, stale.map((d) => d.text)));
      if (embedded === null) return [];
      const fresh = stale.flatMap((d, i): TableRow[] => {
        const vector = embedded.vectors[i];
        return vector === undefined ? [] : [{ id: d.id, revision: revisionOf(d, embedded), scope, values: { vector: toBytes(vector) } }];
      });
      await this.#d.index.putRows(MEANING_TABLE, user, fresh);
      for (const row of fresh) kept.set(row.id, row);
    }
    return docs.flatMap((d) => {
      const row = kept.get(d.id);
      return row !== undefined && row.revision === revisionOf(d, made) ? [row] : [];
    });
  }
}

// The index file (plan §4.2 "No copy", Appendix B; R-14): beside `rpe.db`, readable by its owner alone,
// written by its own worker thread and by nothing else. Its five indexes (chat messages, lore entries,
// facts, beats, memories) hold tokens and ids, never text: a lane feeds each text it searches (`put`, a new
// revision replacing the one before; `drop`), and a search answers ids, revisions and rank, the user's
// alone and within a chat or a book, which the lane then reads from its own store or from Lumiverse.
// Searches run on the app's pool, over connections that read alone, so a search never waits for a write.
//
// The file is rebuilt from its sources: it is not in `rpe backup`, and one found missing at the start is
// made new (`made`), which tells each lane that feeds it to feed it whole again. An area may add a table of
// its own (`table`), made and written by the writer, keyed by user, id and revision, holding no text.

import type { Log } from "rp-harness/contract";
import { Workers } from "../workers/pool";
import type { IndexDoc, IndexHit, IndexName, TableDef, TableRow } from "./thread";

export { INDEXES, type ColumnKind, type ColumnValue, type IndexDoc, type IndexHit, type IndexName, type TableDef, type TableRow } from "./thread";

export interface IndexFileOptions {
  /** The file, beside the database. */
  path: string;
  /** The app's pool, which runs the searches. */
  workers: Workers;
  /** Rows the writer writes in one transaction (`database.indexBatch`). */
  batch: number;
  log: Log;
}

export class IndexFile {
  readonly #path: string;
  readonly #writer: Workers;
  readonly #workers: Workers;
  readonly #batch: number;

  private constructor(
    options: IndexFileOptions,
    writer: Workers,
    /** The file was missing at the start and was made new: each lane that feeds it feeds it whole again. */
    readonly made: boolean,
  ) {
    this.#path = options.path;
    this.#writer = writer;
    this.#workers = options.workers;
    this.#batch = options.batch;
  }

  /** Opens the file on its own writer thread, making it where it is missing. */
  static async open(options: IndexFileOptions): Promise<IndexFile> {
    const writer = new Workers({ threads: 1, name: "the index file's writer", log: options.log });
    try {
      const { made } = await writer.run("indexOpen", { path: options.path });
      if (made) options.log.info("the index file was made new; each area feeds it again from its own rows", { file: options.path });
      return new IndexFile(options, writer, made);
    } catch (error) {
      await writer.close();
      throw error;
    }
  }

  /** Indexes `docs` of the user's in `index`: a text of a new revision replaces the one before; one of the same revision is left as it is. */
  async put(index: IndexName, user: string, docs: readonly IndexDoc[]): Promise<{ written: number }> {
    return await this.#writer.run("indexPut", { path: this.#path, index, user, docs, batch: this.#batch });
  }

  /** Drops the user's `ids` from `index`. */
  async drop(index: IndexName, user: string, ids: readonly string[]): Promise<{ dropped: number }> {
    return await this.#writer.run("indexDrop", { path: this.#path, index, user, ids, batch: this.#batch });
  }

  /** The user's texts in `index` that hold every word of `query` (with `prefix`, every word as the start of a word), within `scope` (a chat, a book) when one is named, best first, `limit` at most. */
  async search(index: IndexName, user: string, query: string, options: { scope?: string | null; limit: number; prefix?: boolean }): Promise<IndexHit[]> {
    return await this.#workers.run("indexSearch", { path: this.#path, index, user, query, scope: options.scope ?? null, limit: options.limit, prefix: options.prefix === true });
  }

  /** The id and revision of each of the user's texts in `index` within `scope` (a chat, a book): what a lane that feeds it from its source holds there. */
  async held(index: IndexName, user: string, scope: string): Promise<{ id: string; revision: string }[]> {
    return await this.#workers.run("indexHeld", { path: this.#path, index, user, scope });
  }

  /** Makes an area's own table, by its own step; one standing with other columns is made again, empty (`made`), and the area feeds it again. */
  async table(table: TableDef): Promise<{ made: boolean }> {
    return await this.#writer.run("indexTable", { path: this.#path, table });
  }

  /** Writes rows of the user's in an area's own table, each replacing the row of its id. */
  async putRows(table: TableDef, user: string, rows: readonly TableRow[]): Promise<{ written: number }> {
    return await this.#writer.run("indexPutRows", { path: this.#path, table, user, rows, batch: this.#batch });
  }

  /** Drops rows of the user's from an area's own table. */
  async dropRows(table: TableDef, user: string, ids: readonly string[]): Promise<{ dropped: number }> {
    return await this.#writer.run("indexDropRows", { path: this.#path, table, user, ids, batch: this.#batch });
  }

  /** The user's rows of an area's own table, within `scope` when one is named. */
  async rows(table: TableDef, user: string, scope: string | null = null): Promise<TableRow[]> {
    return await this.#workers.run("indexRows", { path: this.#path, table, user, scope });
  }

  /** Closes the file and stops its writer, once the writes it was given have landed. */
  async close(): Promise<void> {
    try {
      await this.#writer.run("indexClose", { path: this.#path });
    } finally {
      await this.#writer.close();
    }
  }
}

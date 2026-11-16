// The index file on a folder of its own, for the tests of what the door feeds it: its feed over a reader of the stand-in's rows.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lineLog } from "../../src/app";
import { IndexFile } from "../../src/app/index-file/index-file";
import { Workers } from "../../src/app/workers/pool";
import { IndexFeed } from "../../src/adapter/lumiverse/index-feed";
import type { LumiverseReads } from "../../src/adapter/lumiverse/reads";

export interface IndexBed {
  index: IndexFile;
  feed: IndexFeed;
  /** The index file's own path. */
  path: string;
  close(): Promise<void>;
}

export async function openIndexBed(reads: LumiverseReads, user: string): Promise<IndexBed> {
  const dir = mkdtempSync(join(tmpdir(), "rpe-feed-"));
  const path = join(dir, "index.db");
  const log = lineLog(() => undefined);
  const workers = new Workers({ threads: 1, name: "the feed test's pool", log });
  const index = await IndexFile.open({ path, workers, batch: 200, log });
  const feed = new IndexFeed({ index, reads, user, log: () => undefined });
  return {
    index,
    feed,
    path,
    close: async () => {
      await index.close();
      await workers.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// A fold too long for RPE's thread (`store.workerFoldAt`) is refused there inside work that can be made again (`barred`): through `afar`
// it is answered from a thread's fold, inside a write the write is rolled back, the fold made on a thread, and the write made again
// once, landing as if it had found the state held; asked for anywhere else it runs in place, as before the bar, and the log says so.

import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WriteQueue } from "../../src/app/database";
import { barred, FoldAway, type FoldJob, type StoreBrief } from "../../src/store/away";
import { foldAway } from "../../src/store/away-thread";
import { STORY_STORE_AREA } from "../../src/story";
import { engine, goTo, play, POV, testStore, tick } from "./fixtures";

const folder = mkdtempSync(join(tmpdir(), "rpe-away-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

test("a fold over the bar is refused where it can be made again, answered from a thread, run in place elsewhere, and a write that needs it lands once", async () => {
  const file = join(folder, "store.db");
  // A thread here is the same fold run in this process on a read-only connection of its own, as RPE's worker runs it.
  const away = { path: file, run: async (brief: StoreBrief, job: FoldJob) => foldAway({ brief, job }, [STORY_STORE_AREA]) };
  const said: string[] = [];
  const { store, s, world, revision } = testStore({ db: file, away, workerFoldAt: 5, snapshotEvery: 1000, log: (message) => said.push(message) });
  s.putWorld(revision, world);
  s.createChat({ id: "c", revision });
  const start = s.headState("c").state.world.clock;
  let last = play(s, "c", "m1", "Wren comes in from the rain.", 1, engine(tick(10), goTo(POV, "cellar")));
  for (let i = 2; i <= 4; i++) last = play(s, "c", `m${i}`, `Wren waits ${i}.`, i, engine(tick(10), goTo(POV, "cellar")));

  // Nothing held: the head folds from the chat's start over eight changes, past the bar. Refused where it can be made again; in place,
  // and said, anywhere else.
  store.dropCaches();
  expect(() => barred(() => s.headState("c"))).toThrow(FoldAway);
  expect(s.headState("c").state.world.clock).toBe(start + 40);
  expect(said).toContain("A fold over the bar ran on RPE's thread: what asked for it cannot wait for a worker thread.");
  store.dropCaches();
  expect((await store.afar(() => s.headState("c"))).state.world.clock).toBe(start + 40);

  // Inside a write: rolled back, folded on a thread, made again once.
  store.dropCaches();
  const writes = new WriteQueue(store.db, 50);
  let runs = 0;
  await writes.run(() => {
    runs++;
    return s.addChanges(last.id, engine(tick(5)));
  }, "a late change");
  expect(runs).toBe(2);
  expect(s.changes(last.id).length).toBe(3);
  expect((await store.offThread(() => s.headState("c"))).state.world.clock).toBe(start + 45);
  store.close();
});

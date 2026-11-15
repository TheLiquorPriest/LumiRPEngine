// The floor's fixture on the rig's Lumiverse (PlanScenarios-2; plan §17.1): what `bun scripts/testbed/floor.ts setup` makes on the bed, made on the
// stand-in from the same designs (`scripts/testbed/floor-fixture.ts`: card, persona, preset, book and its entries, the plain connection's reasoning set
// to the effort the shipped Author definition names), and its record kept in a folder of the rig's own, so `findFixture` finds it by the ids the record
// lists as it does on the bed. The book, its entries and the connection's binding go in through Lumiverse's own routes over the network door, as `setup`
// sends them; the card, persona and preset, which the stand-in has no create routes for, go in as rows (`fixtures.ts`).
//
// The floor's reader finds the record where the environment says (`LRE_INSTANCE_DIR`, `recordOfEnv`): a play of the floor on the rig points it at the
// rig's own folder for as long as the play lasts, so the bed's record, where the environment holds one, is never read by a rig play.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorEffort, bookBody, embeddingBlockers, entriesToMake, entryBody, fileRecord, type FixtureRecord, LORE, RECORD_FILE, type RecordStore, setPlainThinking } from "../../testbed/floor-fixture";
import type { Lumiverse } from "../../testbed/lib/lumiverse";
import type { Fixtures } from "./fixtures";

/** The forms that play the floor's fixture: the floor itself, G0 and the row-0.2 gates, all over the same card, preset and book. */
export const FLOOR_FIXTURE_FORMS: readonly string[] = ["floor", "G0", "phase0-0.2-tags", "phase0-0.2-two-step", "phase0-0.2-sampling", "phase0-0.2-eight"];

export interface FloorMade {
  /** The record, as the floor reads it, with the chats the play makes added. */
  store: RecordStore;
  /** What was made, for the play's notes. */
  lines: string[];
  /** The folder the record is in; the play's end removes it, and gives `LRE_INSTANCE_DIR` back as it was before the play pointed it here. */
  dir: string;
  /** Gives the environment back and removes the folder. */
  close(): Promise<void>;
}

/**
 * Makes the floor's fixture on the stand-in and keeps its record. `definition` is the shipped Author definition's text as RPE serves it: the effort it
 * names is what plain generation's connection is set to (never one of the rig's own).
 */
export async function makeFloorFixture(input: { fixtures: Fixtures; lumiverse: Lumiverse; definition: string; plainConnection: string }): Promise<FloorMade> {
  const effort = authorEffort(input.definition);
  if (effort === null) throw new Error("the shipped Author definition names no effort, so the rig has none to set plain generation to");
  const blockers = embeddingBlockers(await input.lumiverse.call("GET", "/api/v1/embeddings/config"));
  const book = await input.lumiverse.createWorldBook(bookBody());
  const lines: string[] = [];
  for (const design of entriesToMake(LORE, blockers)) {
    await input.lumiverse.createEntry(book.id, entryBody(design));
    lines.push(`entry "${design.title}" (${design.kind}) made`);
  }
  for (const design of LORE) if (!entriesToMake(LORE, blockers).includes(design)) lines.push(`entry "${design.title}" (${design.kind}) not made: ${blockers.join("; ")}`);
  const made = input.fixtures.floor(book.id);
  lines.push(await setPlainThinking(input.lumiverse, input.plainConnection, effort));
  const dir = await mkdtemp(join(tmpdir(), "rpe-rig-floor-"));
  const store = fileRecord(join(dir, RECORD_FILE));
  const record: FixtureRecord = { presets: [made.preset], personas: [made.persona], books: [book.id], cards: [made.card], chats: [] };
  store.write(record);
  const instanceWas = process.env.LRE_INSTANCE_DIR;
  process.env.LRE_INSTANCE_DIR = dir;
  return {
    store,
    lines,
    dir,
    async close() {
      if (instanceWas === undefined) delete process.env.LRE_INSTANCE_DIR;
      else process.env.LRE_INSTANCE_DIR = instanceWas;
      await rm(dir, { recursive: true, force: true });
    },
  };
}

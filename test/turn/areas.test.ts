// The Migration page's route, through RPE as composed: the page of an install no migration ran on shows no report, with the steps of
// going back naming the extension as Lumiverse has it installed. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { EXTENSION_IDENTIFIER } from "../../src/adapter/lumiverse/pipe-wire";
import type { MigrationPage } from "../../src/migrate/page";
import { openTurnBed, type TurnBed } from "./bed";

let bed: TurnBed | null = null;
afterEach(async () => {
  await bed?.close();
  bed = null;
});

test("the Migration page is answered by RPE as composed", async () => {
  const b = (bed = await openTurnBed({ answers: [] }));
  const migration = await b.page<MigrationPage>("GET", "/api/v1/migration");
  expect(migration.status).toBe(200);
  expect(migration.body.run).toBeNull();
  expect(migration.body.goingBack.steps.some((step) => step.includes(`(${EXTENSION_IDENTIFIER})`))).toBe(true);
});

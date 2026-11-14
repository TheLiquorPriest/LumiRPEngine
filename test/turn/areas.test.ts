// Build mode's route and the Migration page's route, through RPE as composed: a world made on the Build
// page is listed back by it, and the Migration page of an install no migration ran on shows no report,
// with the steps of going back naming the extension as Lumiverse has it installed. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import { EXTENSION_IDENTIFIER } from "../../src/adapter/lumiverse/pipe-wire";
import type { MigrationPage } from "../../src/migrate/page";
import type { ErrorMessage, ResultMessage } from "../../src/shared/protocol";
import { openTurnBed, type TurnBed } from "./bed";

let bed: TurnBed | null = null;
afterEach(async () => {
  await bed?.close();
  bed = null;
});

test("the Build page's messages and the Migration page are answered by RPE as composed", async () => {
  const b = (bed = await openTurnBed({ answers: [] }));
  const send = async (reqId: string, message: Record<string, unknown>) => {
    const { status, body } = await b.page<{ result: ResultMessage | ErrorMessage; pushes: unknown[] }>("POST", "/api/v1/build", { lre: 1, reqId, ...message });
    expect(status).toBe(200);
    return body.result;
  };

  const made = await send("req-make", { type: "lre.world", op: "create", name: "Saltreach", template: "fantasy_town" });
  expect(made).toMatchObject({ type: "lre.result", request: "lre.world", reqId: "req-make" });
  const world = made.type === "lre.result" && made.request === "lre.world" ? (made.body.world?.id ?? "") : "";
  expect(world).not.toBe("");

  const listed = await send("req-list", { type: "lre.world", op: "list" });
  expect(listed).toMatchObject({ type: "lre.result", request: "lre.world", reqId: "req-list" });
  expect(listed.type === "lre.result" && listed.request === "lre.world" ? listed.body.worlds?.map((w) => [w.id, w.name]) : null).toEqual([[world, "Saltreach"]]);

  const migration = await b.page<MigrationPage>("GET", "/api/v1/migration");
  expect(migration.status).toBe(200);
  expect({ report: migration.body.report, text: migration.body.text, chats: migration.body.chats, waiting: migration.body.waiting }).toEqual({ report: null, text: null, chats: [], waiting: [] });
  expect(migration.body.goingBack.steps.some((step) => step.includes(`(${EXTENSION_IDENTIFIER})`))).toBe(true);
});

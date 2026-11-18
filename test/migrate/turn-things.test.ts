// What today's build kept beside a reply that belongs to a turn, in the turn lane's tables after a real run: the panel request on his message on
// the turn that answered it, the stored review card on its message's turn, the staged change waiting for his next message, and the tools he
// approved for a chat; a second run puts each again and no more.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { migrate } from "../../src/migrate/migrate";
import { migrationPage } from "../../src/migrate/page";
import type { MigrationReport } from "../../src/migrate/report";
import { HARNESS_MIGRATIONS, keepCarriedRun } from "../../src/turn";
import { buildFixture, CHAT, STRAY, USER, type Fixture } from "./fixture";
import { look, pageInput, turnOf } from "./look";
import { TREE as tree } from "./tree";
import { rm } from "node:fs/promises";

let fixture: Fixture;
let data: string;
let report: MigrationReport;

const runs = { tables: { area: "harness" as const, migrations: HARNESS_MIGRATIONS }, keep: keepCarriedRun };

beforeAll(async () => {
  fixture = await buildFixture("operator");
  await rm(join(fixture.userFolder, STRAY));
  data = join(fixture.root, "rpe-data");
  for (const hour of [9, 10]) {
    const run = await migrate(fixture.sources, { data, env: fixture.named, tree, runs, now: () => new Date(`2026-11-14T${String(hour).padStart(2, "0")}:00:00.000Z`) });
    expect(run.ran).toBe(true);
    report = run.report;
  }
});

afterAll(async () => {
  await fixture.remove();
});

test("each panel request, review card, staged change and approval is on the turn it belongs to, and a second run leaves the same rows", () => {
  const rows = look(data, (db) => ({
    requests: db.query<{ id: string; turn: string | null; played: number; message: string | null; asked: string }, [string]>("SELECT id, turn, played, message, asked FROM request WHERE user = ? ORDER BY id").all(USER),
    chips: db.query<{ id: string; turn: string | null; kind: string; source: string }, [string]>("SELECT id, turn, kind, source FROM chip WHERE user = ? ORDER BY id").all(USER),
    answered: turnOf(db, CHAT.classic, "m-c4", 0),
    shown: turnOf(db, CHAT.classic, "m-c2", 1),
    ran: turnOf(db, CHAT.harness, "m-h2", 0),
  }));
  // The payment he made through the palette: played at once as his own message, on the turn of the reply that answered it.
  const paid = rows.requests.find((r) => r.id === `carried:${CHAT.classic}:m-c3`);
  expect(paid).toMatchObject({ turn: rows.answered, played: 1, message: "m-c3" });
  expect(JSON.parse(paid?.asked ?? "{}")).toMatchObject({ action: "economy.pay", values: { amount: 3 }, from: "palette" });
  // The walk he staged and did not send waits, on no turn, to go with his next message.
  expect(rows.requests.find((r) => r.id === `carried:${CHAT.classic}:staged`)).toMatchObject({ turn: null, played: 0 });
  expect(rows.requests).toHaveLength(2);
  expect(rows.chips).toEqual([
    { id: `carried:${CHAT.classic}:chip-1`, turn: rows.shown, kind: "review", source: "import" },
    { id: `carried:${CHAT.harness}:approval:lore_search`, turn: rows.ran, kind: "approval", source: "import" },
  ]);
  expect(report.carried?.turnThings).toMatchObject({ tables: true, requests: 1, staged: 1, chips: 1, approvals: 1 });
});

test("the Migration page's line of the staged change follows its held request: done once a turn that stands takes it, waiting again when that turn is dropped, done when he drops it", () => {
  const staged = (db: Database): unknown => migrationPage(pageInput(db, fixture, data)).waiting.find((w) => w.kind === "staged" && w.chat === CHAT.classic);
  look(data, (db) => {
    const id = `carried:${CHAT.classic}:staged`;
    expect(staged(db)).toEqual({ kind: "staged", chat: CHAT.classic, staged: 1, done: false });
    // Taken with his next message by a turn, as the turn lane tells it.
    const turn = turnOf(db, CHAT.classic, "m-c4", 0);
    db.run("UPDATE request SET turn = ? WHERE user = ? AND id = ?", [turn, USER, id]);
    expect(staged(db)).toEqual({ kind: "staged", chat: CHAT.classic, staged: 1, done: true });
    // That turn dropped: the request waits again.
    const status = db.query<{ status: string }, [string, string]>("SELECT status FROM turn WHERE user = ? AND id = ?").get(USER, turn)?.status ?? "";
    db.run("UPDATE turn SET status = 'dropped' WHERE user = ? AND id = ?", [USER, turn]);
    expect(staged(db)).toEqual({ kind: "staged", chat: CHAT.classic, staged: 1, done: false });
    db.run("UPDATE turn SET status = ? WHERE user = ? AND id = ?", [status, USER, turn]);
    // Dropped by him: the request is gone, and nothing is left to do.
    db.run("DELETE FROM request WHERE user = ? AND id = ?", [USER, id]);
    expect(staged(db)).toEqual({ kind: "staged", chat: CHAT.classic, staged: 1, done: true });
  });
});

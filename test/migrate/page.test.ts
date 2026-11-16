// The Migration page's data, as a route serves it after a real run on the migration fixture: the
// report and its text, each chat's check and what was carried of it, the backup with its checksum and
// whether it is still there, what waits on the user with GUIDANCE.md first, and the four steps of
// going back with the previous build's permissions by name.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { PREVIOUS_PERMISSIONS } from "../../src/migrate/going-back";
import { migrate } from "../../src/migrate/migrate";
import { type MigrationPage, migrationPage } from "../../src/migrate/page";
import { reportText, type MigrationReport } from "../../src/migrate/report";
import { buildFixture, CHAT, IDENT, PEOPLE, RUNTIME, STRAY, USER, type Fixture } from "./fixture";
import { TREE as tree } from "./tree";

describe("the Migration page's data", () => {
  let fixture: Fixture;
  let data: string;
  let report: MigrationReport;

  const page = (): MigrationPage => {
    const db = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      return migrationPage({ db, user: USER, identifier: IDENT });
    } finally {
      db.close();
    }
  };

  beforeAll(async () => {
    fixture = await buildFixture("operator");
    await rm(join(fixture.userFolder, STRAY));
    data = join(fixture.root, "rpe-data");
    const run = await migrate(fixture.sources, { data, env: fixture.named, tree, now: () => new Date("2026-11-14T09:00:00.000Z") });
    expect(run.ran).toBe(true);
    report = run.report;
  });

  afterAll(async () => {
    await fixture.remove();
  });

  test("holds the last run's report and its text, and each chat's check with what was carried of it", () => {
    const p = page();
    expect(p.report?.at).toBe(report.at);
    expect(p.text).toBe(reportText(report));
    expect(p.chats.map((c) => c.chat).sort()).toEqual((report.imports ?? []).map((c) => c.chatId).sort());
    const harness = p.chats.find((c) => c.chat === CHAT.harness);
    expect(harness).toMatchObject({ outcome: "imported", turns: 3, check: { matched: { head: true } } });
    expect(harness?.carried?.characters).toEqual([
      { name: PEOPLE.ada.name, files: ["core.md", "memory.md"] },
      { name: PEOPLE.bo.name, files: ["profile.md"] },
    ]);
    expect(harness?.carried?.notes).toEqual({ folder: "persistent-workspace", latest: 2, versions: 3, learned: 1 });
  });

  test("holds the backup with its checksum, and says when it is no longer there", async () => {
    expect(page().backup).toEqual({ path: report.backup?.path ?? "", bytes: report.backup?.bytes ?? 0, sha256: report.backup?.sha256 ?? "", present: true });
    await rm(report.backup?.path ?? "");
    expect(page().backup?.present).toBe(false);
  });

  test("lists what waits on the user, GUIDANCE.md first: connections to pick, each chat's open changes, their own agents switched off, the filing", () => {
    const waiting = page().waiting;
    expect(waiting[0]).toEqual({ kind: "guidance", path: "imported/GUIDANCE.md" });
    expect(waiting.filter((w) => w.kind === "connection").map((w) => (w.kind === "connection" ? w.connection : ""))).toEqual(["conn-helper", "conn-main", "conn-story"]);
    expect(waiting).toContainEqual({ kind: "chat", chat: CHAT.classic, questions: 1, staged: 1, chips: 1, reviewCards: 1, rollback: false });
    expect(waiting).toContainEqual({ kind: "chat", chat: CHAT.agents, questions: 0, staged: 0, chips: 0, reviewCards: 0, rollback: true });
    expect(waiting).toContainEqual({ kind: "own", agents: 1, skills: 1, texts: 2 });
    expect(waiting).toContainEqual({ kind: "filing", chat: CHAT.harness, characters: 2, notes: true });
  });

  test("gives the four steps of going back, the runtime's own install line among them, and the previous build's permissions by name", () => {
    const back = page().goingBack;
    expect(back.steps).toHaveLength(4);
    expect(back.steps[0]).toStartWith("1. Run rpe down:");
    expect(back.steps[3]).toContain(`up --name ${RUNTIME} --systemd`);
    expect(back.permissions).toEqual([...PREVIOUS_PERMISSIONS]);
    expect(back.steps[2]).toContain(PREVIOUS_PERMISSIONS.join(", "));
  });
});

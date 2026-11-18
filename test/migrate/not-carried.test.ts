// A chat the previous build's fold fails on, at a plain `rpe migrate`: the run names it first, ahead of the report, with why, what of it
// RPE holds and what to do, says it again last and ends with exit code 1; what an earlier run carried of it stays; and the Migration page
// says the same at its top while the last real run's report holds it. The fault is the test's own: the importer's fold throws for one chat.

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { type CliIO, runCli } from "../../src/app/cli";
import { CapturingFold } from "../../src/migrate/capture";
import { type MigrationPage, migrationPage } from "../../src/migrate/page";
import { say } from "../../src/shared/lines";
import { buildFixture, CHAT, STRAY, USER, type Fixture } from "./fixture";
import { pageInput } from "./look";

/** Makes the previous build's fold fail on the agents chat (its messages are `m-a…`) until `restore`. */
function foldFailsOnAgents(): { restore(): void } {
  const real = CapturingFold.prototype.last;
  const spy = spyOn(CapturingFold.prototype, "last").mockImplementation(function (this: CapturingFold, input) {
    if (input.chain.some((m) => m.id.startsWith("m-a"))) throw new Error("an invented fault of the previous build's fold");
    return real.call(this, input);
  });
  return { restore: () => spy.mockRestore() };
}

describe("a chat the run does not carry", () => {
  let fixture: Fixture;
  let data: string;
  const out: string[] = [];
  const args = (): string[] => ["--lumiverse", fixture.sources.lumiverse, "--user", USER, "--runtime-config", fixture.sources.runtime?.configDir ?? "", "--runtime-data", fixture.sources.runtime?.dataDir ?? "", "--data", data];
  const rpe = async (): Promise<{ code: number; text: string }> => {
    out.length = 0;
    const io: CliIO = { out: (t) => out.push(t), err: (t) => out.push(t), env: fixture.named, home: fixture.root, now: () => Date.parse("2026-11-14T11:00:00.000Z"), secret: async () => null, ask: async () => null, stopped: () => new Promise(() => {}), fetch: async () => Promise.reject(new Error("The migration calls out to nothing.")) };
    const code = await runCli(["migrate", ...args()], io, { version: "test" });
    return { code, text: out.join("\n") };
  };
  const page = (): MigrationPage => {
    const db = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      return migrationPage(pageInput(db, fixture));
    } finally {
      db.close();
    }
  };
  const turnsOfAgents = (): number => {
    const db = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      return db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM turn WHERE chat = ?").get(CHAT.agents)?.n ?? 0;
    } finally {
      db.close();
    }
  };

  beforeAll(async () => {
    fixture = await buildFixture("operator");
    await rm(join(fixture.userFolder, STRAY));
    data = join(fixture.root, "rpe-data");
  });

  afterAll(async () => {
    await fixture.remove();
  });

  test("is named first with why and what to do, said again last, and the run ends with 1; the page says it at its top while it is so", async () => {
    const head = say("migration_not_carried_head", { count: 1 });
    expect(head).not.toBe("");
    // Named as Lumiverse's database names it, the chat's name and its id after it (the agents chat has no character).
    const line = say("migration_not_carried_chat", { label: say("migration_not_carried_label", { name: "Gate (agents)", character: null, chat: CHAT.agents }), why: say("migration_not_carried_fold") });
    expect(line).toStartWith(`Gate (agents) (${CHAT.agents}): `);

    // The first run: the fold fails on the agents chat, and no run carried it before, so RPE holds nothing of it.
    const failing = foldFailsOnAgents();
    let first: { code: number; text: string };
    try {
      first = await rpe();
    } finally {
      failing.restore();
    }
    expect(first.code).toBe(1);
    // Ahead of the report: why, what RPE holds of it, that the previous build's data holds it all, and the line that runs it again as typed; no
    // switch was made, so there is nothing to go back from. The report follows, and the last line says it again.
    expect(first.text.split("\n").slice(0, 7)).toEqual([
      head,
      `  ${line}`,
      `    ${say("migration_not_carried_none")}`,
      `    ${say("migration_not_carried_kept")}`,
      `    ${say("migration_not_carried_again", { line: ["rpe", "migrate", ...args()].join(" ") })}`,
      "",
      expect.stringMatching(/^Migration real run/),
    ]);
    expect(out.at(-1)).toBe(say("migration_not_carried_end", { count: 1 }));
    expect(turnsOfAgents()).toBe(0);
    expect(page().notCarried).toEqual({ head: say("migration_not_carried_page", { count: 1 }), chats: [{ chat: CHAT.agents, line, lines: expect.arrayContaining([say("migration_not_carried_none"), say("migration_not_carried_kept")]) }] });

    // Mended: the next run carries it, ends with 0, and the page says nothing of it.
    const mended = await rpe();
    expect(mended.code).toBe(0);
    expect(mended.text).not.toContain(head);
    const carried = turnsOfAgents();
    expect(carried).toBeGreaterThan(0);
    expect(page().notCarried).toBeNull();

    // It fails again: what the earlier run carried stands, and the words say what is and is not in RPE.
    const again = foldFailsOnAgents();
    let later: { code: number; text: string };
    try {
      later = await rpe();
    } finally {
      again.restore();
    }
    expect(later.code).toBe(1);
    expect(later.text.split("\n").slice(0, 3)).toEqual([head, `  ${line}`, `    ${say("migration_not_carried_stands")}`]);
    expect(turnsOfAgents()).toBe(carried);
    expect(page().notCarried?.chats[0]?.lines[0]).toBe(say("migration_not_carried_stands"));
  });
});

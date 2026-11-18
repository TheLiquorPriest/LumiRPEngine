// A chat the previous build's fold fails on, at a plain `rpe migrate`: the run keeps the cause whole in a record of its own in RPE's data folder,
// readable by his account alone (the stage, the error's own words and its stack, the message and swipe, the broken record by its place, kind and
// shape, never its content, and where that record is in the previous build's files); it names the chat first, ahead of the report, in one
// sentence made from that record, with what of it RPE holds and what to do, says it again last and ends with exit code 1; what an earlier run
// carried of it stays; the Migration page says the same at its top, and opens the record, while it is kept; and the run that carries the chat
// closes it and says so. The fault is the one of 18 Nov, on the test's own terms: while the agents chat folds, no words are loaded, so the first
// line a type's check says throws.

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, readFileSync, statSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CliIO, runCli } from "../../src/app/cli";
import { configOf, dataPaths } from "../../src/app/config";
import { CapturingFold } from "../../src/migrate/capture";
import { type ChatFailure, failureFile, failuresFolder, readFailure, unreadFile } from "../../src/migrate/failures";
import { type MigrationPage, migrationPage } from "../../src/migrate/page";
import { migrateRoutes } from "../../src/migrate/routes";
import { say, withLines } from "../../src/shared/lines";
import { buildFixture, CHARACTER, CHAT, IDENT, STRAY, USER, type Fixture } from "./fixture";
import { pageInput } from "./look";
import { callRoute } from "../app/call";

/** The words of a thread that has none, as `say` throws them. */
const noWords = (name: string): Error => new Error(`RPE has no words loaded on this thread, so it cannot say the line "${name}": the lines of guidance/.prompts/history-*.md were never given to it.`);

/** Makes the previous build's fold of the agents chat (its messages are `m-a…`) run with no words loaded, until `restore`. */
function foldFailsOnAgents(): { restore(): void } {
  const real = CapturingFold.prototype.last;
  const none = {
    line(name: string): string {
      throw noWords(name);
    },
  };
  const spy = spyOn(CapturingFold.prototype, "last").mockImplementation(function (this: CapturingFold, input) {
    return input.chain.some((m) => m.id.startsWith("m-a")) ? withLines(none, () => real.call(this, input)) : real.call(this, input);
  });
  return { restore: () => spy.mockRestore() };
}

/** `rpe migrate` over the fixture into RPE's data folder `data`, with `more` words on its line, its words gathered in `out`: its exit code, and what it printed. */
async function migrateBy(fixture: Fixture, data: string, out: string[], more: readonly string[] = []): Promise<{ code: number; text: string }> {
  out.length = 0;
  const io: CliIO = { out: (t) => out.push(t), err: (t) => out.push(t), env: fixture.named, home: fixture.root, now: () => Date.parse("2026-11-14T11:00:00.000Z"), secret: async () => null, ask: async () => null, stopped: () => new Promise(() => {}), fetch: async () => Promise.reject(new Error("The migration calls out to nothing.")) };
  const code = await runCli(["migrate", ...argsOf(fixture, data), ...more], io, { version: "test" });
  return { code, text: out.join("\n") };
}

const argsOf = (fixture: Fixture, data: string): string[] => ["--lumiverse", fixture.sources.lumiverse, "--user", USER, "--runtime-config", fixture.sources.runtime?.configDir ?? "", "--runtime-data", fixture.sources.runtime?.dataDir ?? "", "--data", data];

describe("a chat the run does not carry", () => {
  let fixture: Fixture;
  let data: string;
  const out: string[] = [];
  const args = (): string[] => argsOf(fixture, data);
  const rpe = (more: readonly string[] = []): Promise<{ code: number; text: string }> => migrateBy(fixture, data, out, more);
  const withDb = <T>(read: (db: Database) => T): T => {
    const db = new Database(join(data, "rpe.db"), { readonly: true });
    try {
      return read(db);
    } finally {
      db.close();
    }
  };
  const page = (): MigrationPage => withDb((db) => migrationPage(pageInput(db, fixture, data)));
  const turnsOfAgents = (): number => withDb((db) => db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM turn WHERE chat = ?").get(CHAT.agents)?.n ?? 0);
  const label = (): string => say("migration_not_carried_label", { name: "Gate (agents)", character: null, chat: CHAT.agents });
  /** The chat's sentence, as its record of why makes it. */
  const sentence = (record: ChatFailure): string =>
    say("migration_not_carried_chat", { label: label(), why: say("migration_not_carried_fold"), number: String(record.message?.number), swipe: String(record.message?.swipe), error: record.error.message.split("\n")[0] ?? "", file: failureFile(data, CHAT.agents) });
  /** The line that says what the last real run could not read, as many files as its report names; none where it read everything. */
  const unread = (): string[] => {
    const count = withDb((db) => (JSON.parse(db.query<{ report: string }, [string]>("SELECT report FROM migration_run WHERE user = ? ORDER BY at DESC LIMIT 1").get(USER)?.report ?? "{}") as { unreadable: unknown[] }).unreadable.length);
    return count === 0 ? [] : [say("migration_unread", { count, file: unreadFile(data) })];
  };

  beforeAll(async () => {
    fixture = await buildFixture("operator");
    await rm(join(fixture.userFolder, STRAY));
    data = join(fixture.root, "rpe-data");
  });

  afterAll(async () => {
    await fixture.remove();
  });

  test("keeps the cause whole for him alone, names it first in one sentence and last again, ends with 1, and closes it once the chat is carried", async () => {
    // The first run: the fold fails on the agents chat, and no run carried it before, so RPE holds nothing of it.
    const failing = foldFailsOnAgents();
    let first: { code: number; text: string };
    try {
      first = await rpe();
    } finally {
      failing.restore();
    }
    expect(first.code).toBe(1);

    // The record: his account's alone, the stage, the error's own words and where in RPE's code it was raised, where in the chat's records it
    // stood, the broken record's shape and never its content, and where that record is in the previous build's files.
    const file = failureFile(data, CHAT.agents);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(failuresFolder(data)).mode & 0o777).toBe(0o700);
    const record = readFailure(data, CHAT.agents);
    if (record === null) throw new Error("no record of the failure was kept");
    expect(record.stage).toBe("fold");
    expect(record.error.message).toStartWith("RPE has no words loaded on this thread, so it cannot say the line");
    expect(record.error.stack).toContain("validate");
    expect(record.message).toEqual({ id: "m-a2", number: 2, swipe: 0 });
    expect(record.world).not.toBeNull();
    expect(record.record).toMatchObject({ place: "swipes.0.events[0]", kind: "engine.ws.write" });
    expect(JSON.stringify(record.record?.shape)).not.toContain("notes.md");
    expect(record.file?.at).toMatch(/^\$\./);
    expect(record.file?.inside).toBe("swipes.0.events[0]");
    expect(["lumiverse-database", "user-storage", "runtime-copy"]).toContain(record.file?.store ?? "");

    // Ahead of the report: the head with where the records are, the chat's sentence made from its record, what RPE holds of it, that the
    // previous build's data holds it all, and the line that runs it again as typed; no switch was made, so there is nothing to go back from.
    const head = say("migration_not_carried_head", { count: 1, folder: failuresFolder(data) });
    expect(head).toContain(failuresFolder(data));
    const line = sentence(record);
    expect(line).toStartWith(`Gate (agents) (${CHAT.agents}): `);
    expect(line).toContain("at message 2 (swipe 0)");
    expect(line).toContain("RPE has no words loaded on this thread");
    expect(line).toContain(file);
    const expected = [
      head,
      `  ${line}`,
      `    ${say("migration_not_carried_none")}`,
      `    ${say("migration_not_carried_kept")}`,
      `    ${say("migration_not_carried_again", { line: ["rpe", "migrate", ...args()].join(" ") })}`,
      `    ${say("migration_not_carried_one", { line: ["rpe", "migrate", ...args(), "--chat", CHAT.agents].join(" ") })}`,
      ...unread(),
      "",
      expect.stringMatching(/^Migration real run/),
    ];
    expect(first.text.split("\n").slice(0, expected.length)).toEqual(expected);
    expect(out.at(-1)).toBe(say("migration_not_carried_end", { count: 1 }));
    // The report holds the stage, never the error's words.
    expect(withDb((db) => db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM migration_run WHERE report LIKE ?").get("%no words loaded%")?.n ?? 0)).toBe(0);
    expect(turnsOfAgents()).toBe(0);

    // The page says the same while the record is kept, and opens it.
    expect(page().notCarried).toEqual({ head: say("migration_not_carried_page", { count: 1, folder: failuresFolder(data) }), chats: [{ chat: CHAT.agents, line, lines: expect.arrayContaining([say("migration_not_carried_none"), say("migration_not_carried_kept")]), record: file }], carried: [] });
    const opened = await withDb(async (db) => {
      const routes = migrateRoutes({ db, identifier: IDENT, paths: dataPaths(data), config: configOf({ port: 0, lumiverse: { url: null, user: USER } }, {}, "the test's config"), rehearsals: pageInput(db, fixture, data).rehearsals, env: {}, home: "/nowhere" });
      const route = routes.find((r) => r.method === "GET" && r.path === "/api/v1/migration/chats/:chat/failure");
      if (route === undefined) throw new Error("no route opens a record");
      return callRoute(route, { user: USER, params: { chat: CHAT.agents } });
    });
    const { format: _, ...kept } = record;
    expect(opened).toEqual({ path: file, failure: kept });

    // Mended: the next run carries it, ends with 0, says it carried it, and closes the record; the page says when.
    const mended = await rpe();
    expect(mended.code).toBe(0);
    expect(mended.text).not.toContain(head);
    expect(mended.text.split("\n")[0]).toBe(say("migration_carried_now", { label: label(), failed: record.at }));
    expect(existsSync(file)).toBe(false);
    const carried = turnsOfAgents();
    expect(carried).toBeGreaterThan(0);
    const shown = page().notCarried;
    expect(shown?.chats).toEqual([]);
    expect(shown?.carried).toEqual([{ chat: CHAT.agents, line: say("migration_carried_page", { label: label(), at: page().run?.at ?? "", failed: record.at }) }]);

    // It fails again: what the earlier run carried stands, and the words say what is and is not in RPE.
    const again = foldFailsOnAgents();
    let later: { code: number; text: string };
    try {
      later = await rpe();
    } finally {
      again.restore();
    }
    expect(later.code).toBe(1);
    const reKept = readFailure(data, CHAT.agents);
    if (reKept === null) throw new Error("no record of the second failure was kept");
    expect(later.text.split("\n").slice(0, 3)).toEqual([head, `  ${sentence(reKept)}`, `    ${say("migration_not_carried_stands")}`]);
    expect(turnsOfAgents()).toBe(carried);
    expect(page().notCarried?.chats[0]?.lines[0]).toBe(say("migration_not_carried_stands"));
  });

  test("`--chat` carries that chat alone once it is mended and closes its record, every other chat left as it stands; it is refused with a rehearsal, before any real run, and for a chat that plays no world", async () => {
    // As the test above left it: the agents chat's record is kept, and the earlier import of it stands.
    expect(readFailure(data, CHAT.agents)).not.toBeNull();
    const turnsOf = (chat: string): string[] => withDb((db) => db.query<{ id: string }, [string]>("SELECT id FROM turn WHERE chat = ? ORDER BY id").all(chat).map((t) => t.id));
    const harness = turnsOf(CHAT.harness);
    const agents = turnsOf(CHAT.agents);
    expect(harness.length).toBeGreaterThan(0);

    const rehearsed = await rpe(["--chat", CHAT.agents, "--rehearse"]);
    expect(rehearsed.code).toBe(2);
    expect(rehearsed.text).toContain(say("migration_chat_rehearse"));
    const none = await rpe(["--chat", "c-nowhere"]);
    expect(none.code).toBe(1);
    expect(none.text).toContain(`  - ${say("migration_chat_none", { chat: "c-nowhere" })}`);
    const fresh = join(fixture.root, "rpe-data-fresh");
    const first = await migrateBy(fixture, fresh, [], ["--chat", CHAT.agents]);
    expect(first.code).toBe(1);
    expect(first.text).toContain(`  - ${say("migration_chat_first", { chat: CHAT.agents })}`);
    expect(existsSync(join(fresh, "rpe.db"))).toBe(false);

    // Mended, carried alone: the record is closed and the run says so; the harness chat is left as the earlier run carried it, turn for turn.
    const was = readFailure(data, CHAT.agents);
    const one = await rpe(["--chat", CHAT.agents]);
    expect(one.code).toBe(0);
    expect(one.text.split("\n")[0]).toBe(say("migration_carried_now", { label: label(), failed: was?.at ?? null }));
    expect(readFailure(data, CHAT.agents)).toBeNull();
    expect(turnsOf(CHAT.agents).length).toBeGreaterThan(0);
    expect(turnsOf(CHAT.agents)).not.toEqual(agents);
    expect(turnsOf(CHAT.harness)).toEqual(harness);
    const report = page().run;
    expect(report).not.toBeNull();
    const imports = withDb((db) => JSON.parse(db.query<{ report: string }, [string]>("SELECT report FROM migration_run WHERE user = ? ORDER BY at DESC LIMIT 1").get(USER)?.report ?? "{}") as { imports: { chatId: string; outcome: string; why?: string }[] }).imports;
    expect(imports.find((c) => c.chatId === CHAT.agents)?.outcome).toBe("replaced");
    expect(imports.find((c) => c.chatId === CHAT.harness)).toMatchObject({ outcome: "not asked for", why: expect.stringContaining("what an earlier run imported of it stands") });
  });
});

describe("a chat the previous build's reader cannot open", () => {
  test("is kept at the read stage, with the world's error and the revision's file, and named first with no message, as it stood at none", async () => {
    const fixture = await buildFixture("operator");
    try {
      await rm(join(fixture.userFolder, STRAY));
      const data = join(fixture.root, "rpe-data");
      // The harness chat plays a revision its world does not hold.
      const lumiverse = new Database(join(fixture.sources.lumiverse, "lumiverse.db"));
      try {
        lumiverse.query(`UPDATE chats SET metadata = json_set(metadata, '$.${IDENT}.revision', 'rev-unreadable') WHERE id = ?`).run(CHAT.harness);
      } finally {
        lumiverse.close();
      }
      const out: string[] = [];
      const ran = await migrateBy(fixture, data, out);
      expect(ran.code).toBe(1);
      const record = readFailure(data, CHAT.harness);
      if (record === null) throw new Error("no record of the failure was kept");
      expect(record.stage).toBe("read");
      expect(record.world).toEqual({ id: fixture.worldId, revision: "rev-unreadable" });
      expect(record.error.message).not.toBe("");
      expect(record.error.stack).not.toBeNull();
      expect(record.message).toBeNull();
      expect(record.record).toBeNull();
      expect(record.file).toMatchObject({ store: "user-storage", row: null, at: "$", inside: null });
      expect(record.file?.path).toEndWith(join("worlds", fixture.worldId, "rev", "rev-unreadable.json"));
      const line = ran.text.split("\n")[1] ?? "";
      expect(line).toStartWith(`  Fog (harness), with ${CHARACTER.name} (${CHAT.harness}): ${say("migration_not_carried_read")}: `);
      expect(line).not.toContain("at message");
      expect(line).toContain(record.error.message.split("\n")[0] ?? "");
      expect(line).toEndWith(`See ${failureFile(data, CHAT.harness)}.`);
    } finally {
      await fixture.remove();
    }
  });
});

describe("a file of the previous build the run reads as JSON and cannot read", () => {
  test("is named under what could not be read in fixed words, kept with the parser's error for him alone, and said ahead of the report", async () => {
    const fixture = await buildFixture("operator");
    try {
      await rm(join(fixture.userFolder, STRAY));
      const data = join(fixture.root, "rpe-data");
      // LumiAH's list of the chats the engine is on, damaged: the run read it as absent before, and said nothing.
      await writeFile(join(fixture.userFolder, "harness", "chats.json"), "{ Ostrichfeather");
      const out: string[] = [];
      const ran = await migrateBy(fixture, data, out);
      expect(ran.code).toBe(0);
      expect(ran.text).toContain("  user storage: harness/chats.json: it does not read as JSON, so nothing in it is carried");
      const kept = JSON.parse(readFileSync(unreadFile(data), "utf8")) as { files: { path: string; error: { message: string } | null }[] };
      expect(statSync(unreadFile(data)).mode & 0o777).toBe(0o600);
      expect(kept.files.find((f) => f.path === "user storage: harness/chats.json")?.error?.message).toBeString();
      const count = kept.files.length;
      expect(ran.text.split("\n")).toContain(say("migration_unread", { count, file: unreadFile(data) }));
      // The report holds no word of the file.
      const db = new Database(join(data, "rpe.db"), { readonly: true });
      try {
        expect(db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM migration_run WHERE report LIKE ?").get("%Ostrichfeather%")?.n ?? 0).toBe(0);
      } finally {
        db.close();
      }
      expect(ran.text).not.toContain("Ostrichfeather");
    } finally {
      await fixture.remove();
    }
  });
});

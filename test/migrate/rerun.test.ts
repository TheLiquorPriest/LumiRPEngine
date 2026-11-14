// A run made again (STANDALONE-PLAN §15.3): each run reads today's data afresh; a chat not yet played
// on RPE is replaced by what today's side holds now, a chat played on RPE is left as it is, and the
// report says which. Nothing is imported twice. A chat is gone only when Lumiverse no longer has it:
// one this run can't read keeps what an earlier run imported.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { migrate, Migrations } from "../../src/app/migrations";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import type { WorldDoc } from "../../src/shared/world";
import { openStore, STORE_MIGRATIONS, type Store, type UserStore } from "../../src/store";
import { chatsToImport, importChats } from "../../src/migrate/import-chats";
import { textHash } from "../../src/migrate/lumiverse-db";
import type { ChatImportReport } from "../../src/migrate/report";
import { importedChats, MIGRATE_TABLES } from "../../src/migrate/tables";
import { openToday } from "../../src/migrate/today";
import { buildFixture, USER, type Fixture } from "./fixture";
import { addPlayedChats, goTo, pay, PLAYED, replay, tick, type Played } from "./played";

const registry = createRegistry(ALL_PACKS);

describe("a run made again", () => {
  let fixture: Fixture;
  let played: Played;
  let db: Database;
  let store: Store;
  let s: UserStore;
  const worlds = new Map<string, WorldDoc>();
  let runs = 0;
  const count = (table: string): number => db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n ?? 0;
  const counts = (): Record<string, number> => Object.fromEntries(["chat", "turn", "change", "path_node", "message_link", "imported_record", "migration_chat"].map((t) => [t, count(t)]));

  /** One run's import, as `migrate` makes it: today's data read afresh, into the same RPE database. */
  async function run(): Promise<ChatImportReport[]> {
    const today = await openToday(fixture.sources);
    try {
      const { chats, notOpened } = await chatsToImport(today);
      for (const c of chats) for (const r of c.revisions) {
        const w = c.input.worlds(r);
        if (w) worlds.set(r, w);
      }
      return importChats({ store, s, db, registry, chats, notOpened, present: new Set(today.chats.map((c) => c.id)), earlier: importedChats(db, USER), run: `run-${++runs}` });
    } finally {
      today.close();
    }
  }

  beforeAll(async () => {
    fixture = await buildFixture("operator");
    played = await addPlayedChats(fixture);
    db = new Database(":memory:");
    const migrations = new Migrations();
    migrations.add("store", STORE_MIGRATIONS);
    migrations.add("migrate", MIGRATE_TABLES);
    migrate(db, migrations, { version: "test", backups: "/nonexistent", now: () => 0 });
    store = openStore({ db, registry, worlds: (r) => worlds.get(r) });
    s = store.user(USER);
    await run();
  });

  afterAll(async () => {
    db.close();
    await fixture.remove();
  });

  test("a second run over the same data replaces each chat and duplicates nothing", async () => {
    const before = counts();
    const head = s.headState(PLAYED.classic).state.world;
    const reports = await run();
    expect(counts()).toEqual(before);
    expect(new Set(reports.map((r) => r.outcome))).toEqual(new Set(["replaced"]));
    expect(s.headState(PLAYED.classic).state.world).toEqual(head);
    // The branch was removed with its source and imported again, sharing its turns as before.
    expect(reports.find((r) => r.chatId === PLAYED.branch)?.shares).toEqual({ chat: PLAYED.classic, messages: 4 });
  });

  test("a correction and a new turn made on today's side since are in RPE after the next run", async () => {
    const play = played.plays.get(PLAYED.deleted);
    play?.fix("px-a3", [pay(25, "Late fee")]).user("px-u4", "On to the inn.", 400).reply("px-a4", "The Gull's lamps are lit.", 401, [goTo("inn"), tick(12)]);
    await replay(fixture, played, PLAYED.deleted);
    const coin = s.headState(PLAYED.deleted).state.world.accounts.acct_mara ?? 0;
    const reports = await run();
    expect(reports.find((r) => r.chatId === PLAYED.deleted)).toMatchObject({ outcome: "replaced", turns: 3, differences: [] });
    const head = s.headState(PLAYED.deleted).state.world;
    expect(head.entities.mara?.fields.place).toBe("inn");
    expect(head.accounts.acct_mara).toBe(coin - 25);
    expect(s.swipes(PLAYED.deleted, "px-a4").map((t) => t.hash)).toEqual([textHash("The Gull's lamps are lit.")]);
  });

  test("a chat played on RPE is left as it is by the next run, which says so", async () => {
    // A turn played on RPE, after the chat's last reply.
    const turn = s.beginTurn({ chat: PLAYED.paused, kind: "normal" });
    s.addChanges(turn.id, [{ lane: "engine", op: "clock", value: { type: "clock", minutes: 30, cause: "tick" }, by: "gm", source: "gm" }]);
    s.tieTurn(turn.id, { message: "rpe-reply-1", hash: textHash("Played on RPE."), date: 900 });
    // Today's side moves on as well: that is not carried into a chat RPE now owns.
    played.plays.get(PLAYED.paused)?.user("pp-u3", "Anything else?", 300).reply("pp-a3", "Nothing else.", 301, [tick(1)]);
    await replay(fixture, played, PLAYED.paused);
    const turns = count("turn");
    const reports = await run();
    expect(reports.find((r) => r.chatId === PLAYED.paused)?.outcome).toBe("played on RPE: left alone");
    expect(s.turn(turn.id)?.imported).toBe(false);
    expect(s.swipes(PLAYED.paused, "pp-a3")).toEqual([]);
    expect(count("turn")).toBe(turns);
  });

  test("a chat Lumiverse no longer has is removed from RPE, unless it was played there", async () => {
    const lumiverse = new Database(`${fixture.sources.lumiverse}/lumiverse.db`);
    lumiverse.query("DELETE FROM chats WHERE id = ?").run(PLAYED.discarded);
    lumiverse.close();
    const reports = await run();
    expect(reports.find((r) => r.chatId === PLAYED.discarded)?.outcome).toBe("gone from Lumiverse: removed");
    expect(s.chat(PLAYED.discarded)).toBeNull();
    expect(db.query("SELECT count(*) AS n FROM imported_record WHERE chat = ?").get(PLAYED.discarded)).toEqual({ n: 0 });
    expect(reports.find((r) => r.chatId === PLAYED.paused)?.outcome).toBe("played on RPE: left alone");
  });

  test("a chat Lumiverse still has that this run can't read keeps what an earlier run imported, and is not called gone", async () => {
    const heads = [PLAYED.planted, PLAYED.rebased].map((chat) => s.headState(chat).state.world);
    const lumiverse = new Database(`${fixture.sources.lumiverse}/lumiverse.db`);
    // One's world can't be read at the revision it plays; the other's run no longer reads at all.
    lumiverse.query("UPDATE chats SET metadata = json_set(metadata, '$.lumi_rp_engine.revision', 'rev-unreadable') WHERE id = ?").run(PLAYED.planted);
    lumiverse.query("UPDATE chats SET metadata = json_remove(metadata, '$.lumi_rp_engine.worldId') WHERE id = ?").run(PLAYED.rebased);
    lumiverse.close();
    const reports = await run();
    for (const chat of [PLAYED.planted, PLAYED.rebased]) {
      expect(reports.filter((r) => r.chatId === chat).map((r) => ({ outcome: r.outcome, stands: r.why?.endsWith("what an earlier run imported of it stands") }))).toEqual([{ outcome: "not imported", stands: true }]);
    }
    expect([PLAYED.planted, PLAYED.rebased].map((chat) => s.headState(chat).state.world)).toEqual(heads);
    expect(db.query("SELECT count(*) AS n FROM migration_chat WHERE chat IN (?, ?)").get(PLAYED.planted, PLAYED.rebased)).toEqual({ n: 2 });
  });
});

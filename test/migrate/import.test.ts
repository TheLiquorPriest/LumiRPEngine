// Each chat into RPE's store, on the invented tree of today's data with chats played as today's build
// records them: every reply and every swipe is a turn tied to its message; the time, place, coin and
// inventory RPE's store folds equal today's fold at the head of every chat and at every swipe, along
// the chain each was played on (a test's own fold, from the chains it played); a value RPE's fold gets
// differently is marked, kept as today's, and listed; a branch shares its source's turns; and the disk
// of today's data doesn't change.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { migrate, Migrations } from "../../src/app/migrations";
import type { ChainMessage } from "../../src/engine/ledger/chain";
import { LedgerFold } from "../../src/engine/ledger/fold";
import { optionalQuery } from "../../src/engine/pack-kit";
import { createRegistry } from "../../src/engine/registry-impl";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import { ALL_PACKS } from "../../src/packs/index";
import type { ChatId, UserId } from "../../src/shared/ids";
import type { WorldDoc } from "../../src/shared/world";
import { openStore, STORE_MIGRATIONS, type Store, type UserStore } from "../../src/store";
import { chatsToImport, importChats, type ChatToImport } from "../../src/migrate/import-chats";
import { textHash } from "../../src/migrate/lumiverse-db";
import type { ChatImportReport } from "../../src/migrate/report";
import { MIGRATE_TABLES } from "../../src/migrate/tables";
import { openToday, type Today } from "../../src/migrate/today";
import { buildFixture, CHAT, treeSums, USER, type Fixture } from "./fixture";
import { addPlayedChats, PLAYED, POV, type Played, type PlayedSwipe } from "./played";

const registry = createRegistry(ALL_PACKS);

/** Who holds what: every thing whose chain of holders reaches `who`, with its quantity. */
function carried(state: WorldState, who: string): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const [id, e] of Object.entries(state.entities)) {
    let at: string | undefined = id;
    for (let guard = 0; at && guard < 16; guard++) {
      at = state.entities[at]?.relations.find((r) => r.type === "in")?.to;
      if (at === who) {
        out.push([id, e.fields.qty ?? 1]);
        break;
      }
    }
  }
  return out.sort(([a], [b]) => (a < b ? -1 : 1));
}

/** The four things a player sees first: the time, where the player's character is, the coin, and what they carry. */
function four(state: WorldState, world: WorldDoc) {
  const ctx = registry.context(world, state);
  return { time: state.clock, place: placeOfEntity(state, POV), coin: { accounts: state.accounts, carried: optionalQuery(ctx, "economy.carried_cash")?.(ctx, POV) ?? null }, inventory: carried(state, POV) };
}

/** RPE's database in memory, with the store's tables and the migration's, as the application makes them; and the store over it. */
function target(chats: readonly ChatToImport[]): { db: Database; store: Store; s: UserStore } {
  const db = new Database(":memory:");
  const migrations = new Migrations();
  migrations.add("store", STORE_MIGRATIONS);
  migrations.add("migrate", MIGRATE_TABLES);
  migrate(db, migrations, { user: USER, version: "test", backups: "/nonexistent", now: () => 0 });
  const worlds = new Map<string, WorldDoc>();
  for (const c of chats) for (const r of c.revisions) {
    const w = c.input.worlds(r);
    if (w) worlds.set(r, w);
  }
  const store = openStore({ db, registry, worlds: (r) => worlds.get(r) });
  return { db, store, s: store.user(USER) };
}

/** The chain a swipe was played on, as the test played it: each earlier reply showing its pick; one played before an edit or a deletion, where it shows now. */
function playedChain(chat: ChatToImport, swipe: PlayedSwipe): ChainMessage[] {
  const chain = chat.input.chain;
  const at = chain.findIndex((m) => m.id === swipe.message);
  return chain.slice(0, at + 1).map((m, i) => (i === at ? { ...m, swipeId: swipe.swipe } : m.isUser || swipe.lost || swipe.picks[m.id] === undefined ? m : { ...m, swipeId: swipe.picks[m.id] ?? m.swipeId }));
}

describe("each chat into the store", () => {
  let fixture: Fixture;
  let played: Played;
  let before: Map<string, string>;
  let today: Today;
  let chats: ChatToImport[];
  let s: UserStore;
  let db: Database;
  let reports: ChatImportReport[];
  const chat = (id: string): ChatToImport => {
    const c = chats.find((x) => x.chatId === id);
    if (!c) throw new Error(`no chat ${id}`);
    return c;
  };
  const report = (id: string): ChatImportReport | undefined => reports.find((r) => r.chatId === id);
  const turnOf = (swipe: { chat: string; message: string; swipe: number }): string => {
    const m = chat(swipe.chat).input.chain.find((x) => x.id === swipe.message) as ChainMessage;
    const turn = s.swipes(swipe.chat, swipe.message).find((t) => t.hash === textHash(m.swipes[swipe.swipe] ?? ""));
    if (!turn) throw new Error(`no turn for ${swipe.message} swipe ${swipe.swipe}`);
    return turn.id;
  };

  beforeAll(async () => {
    fixture = await buildFixture("operator");
    played = await addPlayedChats(fixture);
    before = await treeSums(fixture.root);
    today = await openToday(fixture.sources);
    const read = await chatsToImport(today);
    chats = read.chats;
    const t = target(chats);
    s = t.s;
    db = t.db;
    reports = importChats({ store: t.store, s, db: t.db, registry, chats, notOpened: read.notOpened, present: new Set(today.chats.map((c) => c.id)), earlier: [], run: "run-1" });
  });

  afterAll(async () => {
    today.close();
    await fixture.remove();
  });

  test("every reply and every swipe of every chat is a turn tied to its message", () => {
    for (const c of chats) {
      for (const m of c.input.chain) {
        if (m.isUser) continue;
        const turns = s.swipes(c.chatId, m.id);
        const facts = c.swipes.get(m.id);
        // A swipe the old engine says stood with no turn played has none here: it is an unplayed stretch of the chat's path.
        const played = [...m.swipes.entries()].filter(([swipe]) => {
          const harness = m.ledger?.swipes[String(swipe)]?.harness;
          return !(harness?.unplayed !== undefined && (harness.turns ?? []).length === 0);
        });
        expect({ chat: c.chatId, message: m.id, turns: turns.length }).toEqual({ chat: c.chatId, message: m.id, turns: played.length });
        for (const [swipe, text] of played) expect(turns.some((t) => t.hash === textHash(text) && t.date === (facts?.dates[swipe] ?? null) && t.imported)).toBe(true);
      }
    }
    expect(reports.filter((r) => r.outcome !== "imported").map((r) => [r.chatId, r.outcome, r.why ?? ""])).toEqual([]);
    expect(s.isPlayed(PLAYED.classic)).toBe(false);
  });

  test("a chat's record holds its seed, its start, whether the engine was on and the engine that played it; a reply left unplayed has no turn, and its reason is kept", () => {
    for (const c of chats.filter((x) => x.branch === null)) expect(s.chat(c.chatId)).toMatchObject({ seed: c.run.runSeed, started: c.run.startedAt, wasOn: c.wasOn, engine: c.engine });
    expect(chat(CHAT.harness).engine).toBe("harness");
    expect(s.swipes(CHAT.harness, "m-h4")).toEqual([]);
    expect(db.query<{ why: string }, [string, string]>("SELECT why FROM reply_reason WHERE chat = ? AND message = ?").get(CHAT.harness, "m-h4")?.why).toBe("stopped");
  });

  test("time, place, coin and inventory equal today's fold at every swipe, along the chain it was played on", () => {
    expect(played.swipes.length).toBeGreaterThan(10);
    for (const swipe of played.swipes) {
      const c = chat(swipe.chat);
      const theirs = new LedgerFold(registry).fold({ ...c.input, chain: playedChain(c, swipe) }).state;
      const ours = s.stateAt(turnOf(swipe)).state.world;
      const world = c.input.worlds(c.run.revision) as WorldDoc;
      expect({ swipe, values: four(ours, world) }).toEqual({ swipe, values: four(theirs, world) });
    }
  });

  test("and at the head of every chat, its flipped swipes, pauses and discards as today's fold has them", () => {
    for (const c of chats) {
      const theirs = new LedgerFold(registry).fold(c.input).state;
      const ours = s.headState(c.chatId).state.world;
      const world = c.input.worlds(c.run.revision) as WorldDoc;
      expect({ chat: c.chatId, values: four(ours, world) }).toEqual({ chat: c.chatId, values: four(theirs, world) });
    }
  });

  test("a swipe played on an earlier reply's other swipe is folded on that path, which differs from the head's", () => {
    const own = s.stateAt(turnOf({ chat: PLAYED.classic, message: "pc-a3", swipe: 0 })).state.world;
    // Played when the brass lantern was the one bought; the head shows the tin one, with that reply after it.
    expect(own.entities.lantern_brass).toBeDefined();
    expect(own.entities.lantern).toBeUndefined();
    const head = s.headState(PLAYED.classic).state.world;
    expect(head.entities.lantern).toBeDefined();
    expect(head.entities.lantern_brass).toBeUndefined();
    expect(report(PLAYED.classic)?.placed.own).toBeGreaterThanOrEqual(6);
    expect(report(PLAYED.classic)?.differences).toEqual([]);
  });

  test("a value RPE's fold gets differently marks the chat, keeps today's state as the start there, and is listed", () => {
    const planted = report(PLAYED.planted);
    expect(planted?.matched.swipes).toBeLessThan(planted?.matched.of ?? 0);
    expect(planted?.differences.map((d) => d.at)).toEqual([{ message: "pt-a2", swipe: 0 }]);
    expect(planted?.differences[0]?.values).toContain("accounts/acct_harbour");
    // Today's fold converted the dues as Keep asked; RPE's store keeps that state as the turn's start.
    expect(s.headState(PLAYED.planted).state.world.accounts.acct_harbour).toBe(250);
    for (const id of [PLAYED.classic, PLAYED.paused, PLAYED.discarded, PLAYED.deleted, PLAYED.branch]) expect({ id, differences: report(id)?.differences }).toEqual({ id, differences: [] });
  });

  test("a chat whose head stands rebased and differs keeps today's state as the start at its head, and each swipe on its own path", () => {
    const rebased = report(PLAYED.rebased);
    expect(rebased?.matched.head).toBe(false);
    // The fee made on the tin lantern's path is today's head; RPE's fold of the reply's own path (the brass one) has none: today's state is the start there, kept.
    expect(rebased?.differences.map((d) => [d.at, d.kept])).toEqual([["head", true]]);
    expect(rebased?.differences[0]?.values).toContain("accounts/acct_mara");
    const head = s.headState(PLAYED.rebased).state.world;
    expect(head.entities.lantern).toBeDefined();
    expect(head.accounts.acct_mara).toBe(-360);
  });

  test("a branch shares its source's turns for the messages it copied, and has its own after", () => {
    expect(report(PLAYED.branch)?.shares).toEqual({ chat: PLAYED.classic, messages: 4 });
    expect(s.swipes(PLAYED.branch, "pb-a2").map((t) => t.chat)).toEqual([PLAYED.classic, PLAYED.classic]);
    expect(s.swipes(PLAYED.branch, "pb-a3").map((t) => t.chat)).toEqual([PLAYED.branch]);
  });

  test("a chat paused on a keep-or-discard question stands as today's build shows it", () => {
    const head = s.headState(PLAYED.paused).state.world;
    expect(head.entities.rope?.relations.some((r) => r.type === "in" && r.to === "satchel")).toBe(true);
    expect(s.changes(turnOf({ chat: PLAYED.paused, message: "pp-a2", swipe: 0 }))).toEqual([]);
    expect(s.changes(turnOf({ chat: PLAYED.discarded, message: "pd-a3", swipe: 0 }))).toEqual([]);
  });

  test("leaves today's data as it found it", async () => {
    const after = await treeSums(fixture.root);
    const lockIndex = (sums: Map<string, string>) => new Map([...sums].filter(([path]) => !path.endsWith(".db-shm")));
    expect(lockIndex(after)).toEqual(lockIndex(before));
  });
});

describe("a swipe Lumiverse deletes while the run reads", () => {
  test("each turn is tied to the swipe it was made for: its hash and date are read with the messages the run folds", async () => {
    const fixture = await buildFixture("operator");
    await addPlayedChats(fixture);
    const today = await openToday(fixture.sources);
    try {
      // The run reads the chat when it makes its report…
      await today.reader.today(PLAYED.classic as ChatId, USER as UserId);
      // …and, before it imports the chat, today's build deletes the reply's first swipe: the one after it moves up.
      const lumiverse = new Database(join(fixture.sources.lumiverse, "lumiverse.db"));
      lumiverse.query("UPDATE messages SET swipes = ?, swipe_dates = ?, swipe_id = 0, content = ? WHERE id = ?").run(JSON.stringify(["She picks the brass one."]), JSON.stringify([202]), "She picks the brass one.", "pc-a2");
      lumiverse.close();
      const { chats, notOpened } = await chatsToImport(today);
      const t = target(chats);
      try {
        importChats({ store: t.store, s: t.s, db: t.db, registry, chats, notOpened, present: new Set(today.chats.map((c) => c.id)), earlier: [], run: "run-1" });
        const tied = t.s.swipes(PLAYED.classic, "pc-a2").map((turn) => ({ hash: turn.hash, date: turn.date }));
        expect(tied.sort((a, b) => (a.date ?? 0) - (b.date ?? 0))).toEqual([
          { hash: textHash("A tin lantern changes hands."), date: 201 },
          { hash: textHash("She picks the brass one."), date: 202 },
        ]);
      } finally {
        t.db.close();
      }
    } finally {
      today.close();
      await fixture.remove();
    }
  });
});

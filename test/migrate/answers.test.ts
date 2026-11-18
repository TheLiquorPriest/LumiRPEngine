// A chat today's build left paused on a keep-or-discard question, answered from RPE: the answer is kept, the held turns take
// what today's fold now applies there (or today's build holds it while a reply is under way), and the next run reads the
// chat with the answer given.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createRegistry } from "../../src/engine/registry-impl";
import { answerPaused } from "../../src/migrate/answers";
import { migrate } from "../../src/migrate/migrate";
import { answersOf, importedTurns } from "../../src/migrate/tables";
import { ALL_PACKS } from "../../src/packs/index";
import { openStore } from "../../src/store";
import { CAST_STORE_AREA } from "../../src/cast";
import { STORY_STORE_AREA } from "../../src/story";
import { buildFixture, CHAT, STRAY, USER, type Fixture } from "./fixture";
import { TREE as tree } from "./tree";

describe("a paused chat answered from RPE", () => {
  let fixture: Fixture;
  let data: string;

  beforeAll(async () => {
    fixture = await buildFixture("operator");
    await rm(join(fixture.userFolder, STRAY));
    data = join(fixture.root, "rpe-data");
    const run = await migrate(fixture.sources, { data, env: fixture.named, tree, now: () => new Date("2026-11-14T09:00:00.000Z") });
    expect(run.ran).toBe(true);
    expect(run.report.chats.find((c) => c.chatId === CHAT.classic)?.waiting.questions).toBe(1);
  });

  afterAll(async () => {
    await fixture.remove();
  });

  test("keep is kept, lands on the imported turns or is held while a reply is under way, and the next run reads it as today's build would", async () => {
    let held = false;
    const db = new Database(join(data, "rpe.db"));
    try {
      const registry = createRegistry(ALL_PACKS);
      const store = openStore({ db, registry, worlds: () => undefined, areas: [CAST_STORE_AREA, STORY_STORE_AREA] });
      const done = await answerPaused({ db, s: store.user(USER), registry, sources: fixture.sources, chat: CHAT.classic, choice: "keep", now: 1, write: async (work) => work() });
      expect(done.answer.choice).toBe("keep");
      const first = answersOf(db, USER);
      expect(first).toEqual([{ chat: CHAT.classic, message: done.answer.message, choice: "keep", at: 1 }]);
      held = done.held;
      // An answer is given once: the other answer to the same question is refused, says what was chosen, and lays nothing on.
      const lay = () => importedTurns(db, USER, CHAT.classic).reduce((n, t) => n + store.user(USER).changes(t.turn).length, 0);
      const laid = lay();
      await expect(answerPaused({ db, s: store.user(USER), registry, sources: fixture.sources, chat: CHAT.classic, choice: "discard", now: 2, write: async (work) => work() })).rejects.toThrow(/answered this question already: you chose Keep/);
      expect(lay()).toBe(laid);
      expect(answersOf(db, USER)).toEqual(first);
    } finally {
      db.close();
    }
    const again = await migrate(fixture.sources, { data, env: fixture.named, tree, rehearse: true, now: () => new Date("2026-11-14T10:00:00.000Z") });
    expect(again.report.chats.find((c) => c.chatId === CHAT.classic)?.waiting.questions).toBe(held ? 1 : 0);
  });
});

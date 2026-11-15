// A reply edited in Lumiverse after its turn, before the cutover (STANDALONE-PLAN §15.2: a reply that
// differs from the record is given to the Author like any other; §6.3): today's record of the swipe
// holds what its turn read, and Lumiverse holds the edit. Nothing may be lost: RPE's first turn in the
// carried chat finds the edit by the ordinary comparison of the chat's path (`turn/since.ts`), as it
// finds one made after a turn RPE played, and the report says so. Every name is invented.

import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { LvStep } from "../../src/adapter/lumiverse/reads";
import { textHash } from "../../src/adapter/lumiverse/wire";
import { migrate } from "../../src/migrate/migrate";
import { reportText } from "../../src/migrate/report";
import { foundItems, type FoundItem } from "../../src/turn/since";
import { buildFixture, CHAT, type Fixture, STRAY } from "./fixture";
import { look, turnOf } from "./look";
import { branchChat, editReply, lumiverse } from "./today-edits";
import { TREE as tree } from "./tree";

/** A chat's messages as RPE's reader lists them at a turn's intake: each by its role, with its showing swipe's hash and date. */
function stepsOf(fixture: Fixture, chat: string): LvStep[] {
  return lumiverse(fixture, (db) =>
    db
      .query<{ id: string; index_in_chat: number; is_user: number; swipe_id: number; swipes: string; swipe_dates: string; revision: number }, [string]>("SELECT id, index_in_chat, is_user, swipe_id, swipes, swipe_dates, revision FROM messages WHERE chat_id = ? ORDER BY index_in_chat")
      .all(chat)
      .map((m) => {
        const swipes = JSON.parse(m.swipes) as string[];
        const date = (JSON.parse(m.swipe_dates) as (number | null)[])[m.swipe_id] ?? null;
        return { id: m.id, chat, index: m.index_in_chat, role: m.is_user === 1 ? "user" : "assistant", swipe: m.swipe_id, swipes: swipes.length, hidden: false, revision: m.revision, shown: { hash: textHash(swipes[m.swipe_id] ?? ""), date } };
      }),
  );
}

/** What the comparison at a chat's first turn on RPE finds, as the turn's intake makes it: the chat's path against the chat as Lumiverse shows it now. */
function firstComparison(data: string, fixture: Fixture, chat: string): FoundItem[] {
  const steps = stepsOf(fixture, chat);
  return look(data, (_db, s) => {
    const was = s.path(chat);
    const report = s.sync(
      chat,
      steps.map((st) => ({ id: st.id, user: st.role !== "assistant", hash: st.shown.hash, date: st.shown.date })),
    );
    return foundItems(report, was, steps);
  });
}

test("a reply edited after its turn, before the run, is found edited at the carried chat's first turn on RPE, and the report says it will be", async () => {
  const fixture = await buildFixture("operator");
  try {
    await rm(join(fixture.userFolder, STRAY));
    const data = join(fixture.root, "rpe-data");
    // The harness chat's first reply, edited after its turn and before a branch was made at it, which copies the edit; and the classic chat's showing swipe, edited after its turn.
    editReply(fixture, "m-h2", 0, "Fog rolls in, thick and grey.");
    branchChat(fixture, { from: CHAT.harness, at: "m-h2", id: "c-fog", name: "Fog (branch)" });
    // The branch's own exchange after the reply it shares, written without a turn: its path runs through the shared, edited reply.
    lumiverse(fixture, (db) => {
      const add = db.query("INSERT INTO messages (id, chat_id, index_in_chat, is_user, name, content, swipe_id, swipes) VALUES (?, 'c-fog', ?, ?, ?, ?, 0, ?)");
      add.run("m-fog-u", 2, 1, "Player", "Light the lamp anyway.", JSON.stringify(["Light the lamp anyway."]));
      add.run("m-fog-a", 3, 0, "Narrator", "The lamp gutters in the fog.", JSON.stringify(["The lamp gutters in the fog."]));
    });
    editReply(fixture, "m-c2", 1, "The harbour is quiet, but for the gulls.");
    const run = await migrate(fixture.sources, { data, env: fixture.named, tree, now: () => new Date("2026-11-14T09:00:00.000Z") });
    expect(run.ran).toBe(true);
    const branch = run.report.imports?.find((c) => c.chatId === "c-fog");
    expect({ outcome: branch?.outcome, shares: branch?.shares, turns: branch?.turns }).toEqual({ outcome: "imported", shares: { chat: CHAT.harness, messages: 2 }, turns: 1 });

    const h2 = look(data, (db) => turnOf(db, CHAT.harness, "m-h2", 0));
    const c2 = look(data, (db) => turnOf(db, CHAT.classic, "m-c2", 1));
    expect(firstComparison(data, fixture, CHAT.harness)).toEqual([{ kind: "edited", message: "m-h2", turn: h2 }]);
    expect(firstComparison(data, fixture, CHAT.classic)).toEqual([{ kind: "edited", message: "m-c2", turn: c2 }]);
    // A carried chat nobody edited: its first turn finds nothing.
    expect(firstComparison(data, fixture, CHAT.agents)).toEqual([]);

    const text = reportText(run.report);
    expect(text).toContain("    1 swipe(s) edited since today's build read them: each is told to the chat's agents as a reply edited after its turn, at the first turn on RPE that finds it showing");
    // The branch shares the harness chat's turn for the edited reply and carries none of its own for it.
    expect(text.match(/edited since today's build read them/g)?.length).toBe(2);
  } finally {
    await fixture.remove();
  }
});

// The pre-reply window (DESIGN §4.3 P2, L50): writes made while the engine runs a turn before its
// reply. One the window holds (flagged `hold`, as a GM agent's write and a workspace save are, or any
// with "Hold writes during the engine run" on) waits for the turn, lands after its reply over what
// the turn did, and never throws the turn away. One it doesn't hold lands at once and the turn's reply
// doesn't start, as before. An edit of a message still makes the turn stale, and what the window held
// lands then; so it does when a backend restart loses the turn, or another turn replaces it.

import { describe, expect, test } from "bun:test";
import { hashJson } from "../../src/shared/hash";
import { isRecord } from "../../src/shared/json";
import type { HeldWrite } from "../../src/shared/ledger";
import type { WriteResult } from "../../src/engine/ledger/journal";
import { Harness } from "../support/harness";
import { POV } from "../support/test-pack";

async function expectAgree(h: Harness, chatId: string): Promise<void> {
  const { reference, optimized } = await h.folds(chatId);
  expect(hashJson(optimized.state)).toBe(hashJson(reference.state));
  expect(optimized.messages).toEqual(reference.messages);
  expect(optimized.notes).toEqual(reference.notes);
  expect(reference.violations).toEqual([]);
  expect(h.service.errors).toEqual([]);
}

async function mood(h: Harness, chatId: string): Promise<unknown> {
  return (await h.folds(chatId)).optimized.state.entities[POV]?.fields.mood;
}

async function owns(h: Harness, chatId: string, item: string): Promise<boolean> {
  const slice = (await h.folds(chatId)).optimized.state.packs.test;
  return isRecord(slice) && isRecord(slice.owned) && slice.owned[item] === true;
}

/** The steps the engine runs that failed name (`stale`: the turn's reply never started). */
function failedSteps(h: Harness): string[] {
  return h.failures.map((f) => f.slice(0, f.indexOf(":")));
}

/** A ✎ fix of Sam's mood, or with `hold` a GM agent's. */
function moodFix(id: string, value: string, hold?: true): HeldWrite {
  return { kind: "post", id, target: "head", entry: { kind: "fix", events: [{ type: "set", entity: POV, field: "mood", value }] }, ...(hold ? { hold } : {}) };
}

/** The record on a message's shown swipe, from the journal. */
async function recordOn(h: Harness, chatId: string, messageId: string) {
  const swipe = h.host.message(chatId, messageId).swipeId;
  return (await h.core(chatId)).journal.messages[messageId]?.ledger.swipes[String(swipe)];
}

/** A chat with one turn played and the player's next message sent: the turn's reply, before the next one. */
async function waiting(h: Harness, next: string): Promise<{ chat: string; before: string }> {
  const chat = await h.newChat();
  await h.send(chat, "earn:10", "Payday.");
  const before = h.host.head(chat)?.id ?? "";
  h.host.sendUser(chat, next);
  await h.host.settle();
  return { chat, before };
}

describe("writes made while the engine runs a turn before its reply", () => {
  test("a GM agent's write waits for the turn and lands after its reply, over what the turn did; the turn plays", async () => {
    const h = new Harness();
    const { chat } = await waiting(h, "buy:lamp:20");
    const made: Promise<WriteResult>[] = [];
    // Sam has no lamp to lose until the turn buys it.
    const lose: HeldWrite = { kind: "post", id: "gm-1", target: "head", hold: true, entry: { kind: "fix", gm: true, events: [{ type: "test.lose", data: { item: "lamp" } }] } };
    h.duringRun = (chatId) => {
      made.push(h.service.write(chatId, h.host.userId, lose));
    };
    const g = await h.host.start(chat, { type: "normal" });
    // The turn wasn't thrown away: its reply runs, and the write waits for it.
    expect(g.halted).toBeUndefined();
    expect(h.failures).toEqual([]);
    expect(await Promise.all(made)).toEqual([{ applied: false, pending: true }]);
    expect(await owns(h, chat, "lamp")).toBe(false);
    await h.host.finish(g, "You pay for the lamp.");
    // It landed on the turn's own record, after the turn's events: the lamp the turn bought is lost.
    const rec = await recordOn(h, chat, h.host.head(chat)?.id ?? "");
    expect(rec?.events.some((e) => e.type === "test.buy")).toBe(true);
    const fix = rec?.post.find((p) => p.kind === "fix");
    expect(fix?.events).toEqual([{ type: "test.lose", data: { item: "lamp" } }]);
    expect(fix?.seq).toBeGreaterThan(rec?.seq ?? Number.POSITIVE_INFINITY);
    expect(await owns(h, chat, "lamp")).toBe(false);
    const core = await h.core(chat);
    expect([core.journal.held, core.journal.prereply, core.journal.refused]).toEqual([[], undefined, undefined]);
    await expectAgree(h, chat);
  });

  test("with Hold writes during the engine run off, a ✎ fix lands at once and the turn's reply doesn't start, as before; on, it waits for the turn, which plays", async () => {
    for (const on of [false, true]) {
      const h = new Harness();
      h.holdWrites(on);
      const { chat, before } = await waiting(h, "earn:5");
      const made: Promise<WriteResult>[] = [];
      h.duringRun = (chatId) => {
        made.push(h.service.write(chatId, h.host.userId, moodFix("fix-1", "calm")));
      };
      const g = await h.host.start(chat, { type: "normal" });
      const [result] = await Promise.all(made);
      if (on) {
        expect(g.halted).toBeUndefined();
        expect(h.failures).toEqual([]);
        expect(result).toEqual({ applied: false, pending: true });
        expect(await mood(h, chat)).toBe("fine");
        await h.host.finish(g, "Paid.");
        const rec = await recordOn(h, chat, h.host.head(chat)?.id ?? "");
        expect(rec?.post.find((p) => p.kind === "fix")?.seq).toBeGreaterThan(rec?.seq ?? Number.POSITIVE_INFINITY);
      } else {
        expect(g.halted).toBe("cancelled");
        expect(failedSteps(h)).toEqual(["stale"]);
        expect(result).toMatchObject({ applied: true, pending: false });
        expect((await recordOn(h, chat, before))?.post.some((p) => p.kind === "fix")).toBe(true);
        // The player's next try runs the engine again, with the fix in force.
        const again = await h.host.start(chat, { type: "normal" });
        expect(again.halted).toBeUndefined();
        await h.host.finish(again, "Paid.");
      }
      expect(await mood(h, chat)).toBe("calm");
      await expectAgree(h, chat);
    }
  });

  test("an edit of a reply still makes the turn stale, and what the window held lands then, whether the edit arrives while the engine runs or as the turn waits", async () => {
    for (const now of [true, false]) {
      const h = new Harness();
      const { chat, before } = await waiting(h, "earn:5");
      const made: Promise<WriteResult>[] = [];
      h.duringRun = (chatId) => {
        made.push(h.service.write(chatId, h.host.userId, moodFix("gm-1", "calm", true)));
        h.host.editMessage(chatId, before, "Payday, a good one.");
        if (now) h.host.deliverNow();
      };
      const g = await h.host.start(chat, { type: "normal" });
      expect(g.halted).toBe("cancelled");
      expect(failedSteps(h)).toEqual(["stale"]);
      // While the engine still ran, the run ended before the write reached the chat, so it landed as
      // the run's other writes do; as the turn waited, the window held it until the turn went stale.
      const [result] = await Promise.all(made);
      expect(result?.pending).toBe(!now);
      expect((await recordOn(h, chat, before))?.post.some((p) => p.kind === "fix")).toBe(true);
      expect(await mood(h, chat)).toBe("calm");
      const core = await h.core(chat);
      expect([core.journal.held, core.journal.prereply]).toEqual([[], undefined]);
      await expectAgree(h, chat);
    }
  });

  test("a turn another replaces passes on what its window held: it lands after the reply of the turn that replaced it", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "earn:10", "Payday.");
    const payday = h.host.head(chat)?.id ?? "";
    const made: Promise<WriteResult>[] = [];
    h.duringRun = (chatId) => {
      made.push(h.service.write(chatId, h.host.userId, moodFix("gm-1", "calm", true)));
    };
    // A Re-run of the reply is planned and waits for its reply; the player sends a new message instead.
    expect((await h.host.begin(chat, { type: "swipe", messageId: payday })).halted).toBe("cancelled");
    expect(await Promise.all(made)).toEqual([{ applied: false, pending: true }]);
    h.host.restarts.length = 0;
    h.host.sendUser(chat, "earn:5");
    await h.host.settle();
    const g = await h.host.start(chat, { type: "normal" });
    expect(g.halted).toBeUndefined();
    expect(await mood(h, chat)).toBe("fine");
    await h.host.finish(g, "Paid.");
    expect(h.failures).toEqual([]);
    const rec = await recordOn(h, chat, h.host.head(chat)?.id ?? "");
    expect(rec?.post.find((p) => p.kind === "fix")?.seq).toBeGreaterThan(rec?.seq ?? Number.POSITIVE_INFINITY);
    expect(await mood(h, chat)).toBe("calm");
    const core = await h.core(chat);
    expect([core.journal.held, core.journal.prereply]).toEqual([[], undefined]);
    await expectAgree(h, chat);
  });

  test("a backend restart while the turn waits for its reply lands what its window held", async () => {
    const h = new Harness();
    const { chat, before } = await waiting(h, "earn:5");
    const made: Promise<WriteResult>[] = [];
    h.duringRun = (chatId) => {
      made.push(h.service.write(chatId, h.host.userId, moodFix("gm-1", "calm", true)));
    };
    expect((await h.host.begin(chat, { type: "normal" })).halted).toBe("cancelled");
    expect(await Promise.all(made)).toEqual([{ applied: false, pending: true }]);
    // The journal keeps the window and what it holds; the turn lived in the backend's memory only.
    expect((await h.core(chat)).journal.prereply).toHaveLength(1);
    await h.restart();
    const core = await h.core(chat);
    expect([core.journal.held, core.journal.prereply]).toEqual([[], undefined]);
    expect((await recordOn(h, chat, before))?.post.some((p) => p.kind === "fix")).toBe(true);
    expect(await mood(h, chat)).toBe("calm");
    await expectAgree(h, chat);
    // The next reply plans with it.
    const g = await h.host.start(chat, { type: "normal" });
    expect(g.halted).toBeUndefined();
    await h.host.finish(g, "Paid.");
    expect(await mood(h, chat)).toBe("calm");
    await expectAgree(h, chat);
  });
});

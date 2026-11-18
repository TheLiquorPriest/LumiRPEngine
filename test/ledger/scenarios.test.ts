// Hand-written ledger scenarios on the fake host: each pins one rule of DESIGN §4.3 / §5.1.
// The randomized gate is properties.test.ts; these name the cases a reader checks first.

import { describe, expect, test } from "bun:test";
import { decodeJournal, decodeLedger, journalPath, toChain } from "../../src/migrate/today/ledger-io";
import { defaultSettings } from "../../src/migrate/today/settings-store";
import { startMarkersFrom } from "../../src/migrate/today/start-markers";
import { presetAdjudication } from "../../src/shared/adjudication";
import { hashJson } from "../../src/shared/hash";
import type { ChatId, MessageId } from "../../src/shared/ids";
import type { JsonValue } from "../../src/shared/json";
import { isRecord } from "../../src/shared/json";
import type { Journal, LedgerEvent, Marker, PackEvent } from "../../src/shared/ledger";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import { EXTERNAL_ACCOUNT_PREFIX, validMarkerBody } from "../../src/engine/events";
import type { EventTypeDef } from "../../src/engine/registry";
import { Harness } from "../support/harness";
import { balanceOf, openMoney, POV, testModel } from "../support/test-pack";

async function cash(h: Harness, chatId: string): Promise<number> {
  const { optimized } = await h.folds(chatId);
  const v = optimized.state.entities[POV]?.fields.cash;
  return typeof v === "number" ? v : Number.NaN;
}

async function expectAgree(h: Harness, chatId: string): Promise<void> {
  const { reference, optimized } = await h.folds(chatId);
  expect(hashJson(optimized.state)).toBe(hashJson(reference.state));
  expect(optimized.messages).toEqual(reference.messages);
  expect(optimized.notes).toEqual(reference.notes);
  expect(optimized.keepReport).toEqual(reference.keepReport);
  expect(reference.violations).toEqual([]);
  expect(h.service.errors).toEqual([]);
}

describe("ledger scenarios", () => {
  test("a reply whose own swipe is deleted while it streams is not read, and records nothing", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "earn:5", "Okay.");
    const a1 = h.host.head(chat);
    if (!a1) throw new Error("no head");
    const g = await h.host.start(chat, { type: "swipe", messageId: a1.id });
    h.host.deleteSwipe(chat, a1.id, g.swipeId);
    await h.host.settle();
    // No read context, so the post steps make no model call for it.
    const core = await h.core(chat);
    expect(core.commitContext(g.id, a1.id, toChain(await h.host.chats.messages(chat, h.host.userId)))).toBeNull();
    await h.host.finish(g, "A windfall! [found:40]");
    expect(Object.keys(core.journal.messages[a1.id]?.ledger.swipes ?? {})).toEqual(["0"]);
    await expectAgree(h, chat);
  });

  test("editing an earlier user message pauses until Keep or Discard (L39)", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "buy:map:30", "Bought.");
    await h.send(chat, "earn:5", "Paid.");
    const u1 = h.host.chat(chat).messages.find((m) => m.isUser);
    if (!u1) throw new Error("no U1");
    h.host.editMessage(chat, u1.id, "buy:map:40");
    await h.host.settle();
    const core = await h.core(chat);
    expect(core.journal.pauses.map((p) => p.messageId)).toEqual([u1.id]);
    expect((await h.folds(chat)).optimized.messages.filter((m) => m.fold === "paused").length).toBe(2);
    await expectAgree(h, chat);
    await h.write(chat, { kind: "keep", id: "k1", messageId: u1.id, parentPath: "", convert: [] });
    expect(core.journal.pauses).toEqual([]);
    expect((await h.folds(chat)).optimized.messages.filter((m) => m.fold === "view").length).toBe(2);
    await expectAgree(h, chat);
  });

  test("writes made inside a window are held and land after the turn (P2, L8)", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "earn:10", "Payday.");
    h.host.sendUser(chat, "earn:1");
    await h.host.settle();
    const g = await h.host.start(chat, { type: "normal" });
    const held = await h.write(chat, { kind: "marker", id: "m1", target: "head", body: { kind: "resolve", domain: "gear", scope: { all: true }, to: 3 } });
    expect(held.pending).toBe(true);
    await h.host.finish(g, "Paid again.");
    const core = await h.core(chat);
    const head = h.host.head(chat);
    const ledger = head ? core.journal.messages[head.id]?.ledger : undefined;
    const marker = ledger?.markers.find((m) => m.kind === "resolve" && m.domain === "gear");
    expect(marker?.seq).toBeGreaterThan(ledger?.swipes["0"]?.markersApplied ?? Infinity);
    await expectAgree(h, chat);
  });

  test("a restart mid-generation drops the turn whose staged reply the host removed", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "earn:10", "Payday.");
    const before = await h.folds(chat);
    h.host.sendUser(chat, "earn:5");
    await h.host.settle();
    await h.host.start(chat, { type: "normal" });
    await h.restart();
    const core = await h.core(chat);
    expect(core.journal.windows).toEqual([]);
    expect(core.journal.pending).toEqual({});
    expect(hashJson((await h.folds(chat)).optimized.state)).toBe(hashJson(before.optimized.state));
    await expectAgree(h, chat);
  });

  test("a journal an earlier build stored mid-generation, its pending turn carrying slotHeld, decodes and recovers; this build never writes the key", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "earn:10", "Payday.");
    const before = await h.folds(chat);
    h.host.sendUser(chat, "earn:5");
    await h.host.settle();
    await h.host.start(chat, { type: "normal" });
    const file = `${h.host.userId}/${journalPath(chat)}`;
    const text = h.host.files.get(file) ?? "";
    const stored = JSON.parse(text) as Journal;
    if (!stored.run) throw new Error("no run stamp");
    expect(Object.keys(stored.pending).length).toBe(1);
    expect(text).not.toContain("slotHeld");
    // As the earlier build stored it: every pending turn with the flag, always false.
    const old = JSON.stringify({ ...stored, pending: Object.fromEntries(Object.entries(stored.pending).map(([id, p]) => [id, { ...p, slotHeld: false }])) });
    const decoded = decodeJournal(old, chat, stored.run);
    expect(decoded.reset).toBeNull();
    expect(Object.keys(decoded.journal.pending)).toEqual(Object.keys(stored.pending));
    expect(JSON.stringify(decoded.journal)).not.toContain("slotHeld");
    // Restart recovery opens the chat on that journal, not a fresh one, and closes the turn.
    h.host.files.set(file, old);
    await h.restart();
    expect(h.service.notices(chat, h.host.userId)).toEqual([]);
    expect((await h.core(chat)).journal.pending).toEqual({});
    expect(h.host.files.get(file)).not.toContain("slotHeld");
    expect(hashJson((await h.folds(chat)).optimized.state)).toBe(hashJson(before.optimized.state));
    await expectAgree(h, chat);
  });

  test("foreign clobbering is re-asserted (L18)", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "buy:map:30", "Bought.");
    const head = h.host.head(chat);
    if (!head) throw new Error("no head");
    const before = await h.folds(chat);
    h.host.clobberForeign(chat, head.id);
    await h.host.settle();
    expect(h.host.message(chat, head.id).bag[LEDGER_NAMESPACE]).toBeDefined();
    expect(h.host.message(chat, head.id).bag.other_extension).toBeDefined();
    expect(hashJson((await h.folds(chat)).optimized.state)).toBe(hashJson(before.optimized.state));
    await expectAgree(h, chat);
  });

  async function rerun(h: Harness, chat: string, times: number): Promise<{ seeds: Set<string>; cash: number[] }> {
    const seeds = new Set<string>();
    const amounts: number[] = [];
    for (let i = 0; i < times; i++) {
      const head = h.host.head(chat);
      if (!head) throw new Error("no head");
      const g = await h.host.start(chat, { type: "swipe", messageId: head.id });
      await h.host.finish(g, "The dice roll.");
      const swipe = h.host.message(chat, head.id).swipeId;
      const rec = (await h.core(chat)).journal.messages[head.id]?.ledger.swipes[String(swipe)];
      if (rec) seeds.add(rec.seed);
      amounts.push(await cash(h, chat));
    }
    return { seeds, cash: amounts };
  }

  test("a Re-run committed under a pause carries none of the swipe's fixes, and each it would have carried is a Journal drop (L43)", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "buy:lamp:20", "Bought.");
    const head = h.host.head(chat);
    const user = h.host.chat(chat).messages.find((m) => m.isUser);
    if (!head || !user) throw new Error("no turn");
    const fix = (id: string, events: LedgerEvent[]) => h.write(chat, { kind: "post", id, target: "head", entry: { kind: "fix", events } });
    await fix("mood", [{ type: "set", entity: POV, field: "mood", value: "calm" }]);
    await fix("detail", [{ type: "set", entity: POV, field: "detail", value: "scar" }]);
    const [mood, detail] = (await h.core(chat)).journal.messages[head.id]?.ledger.swipes["0"]?.post ?? [];
    if (!mood || !detail) throw new Error("no fixes");
    // An undone fix is in force nowhere, so the new swipe has nothing to say about it.
    expect((await h.write(chat, { kind: "undo", id: "u1", messageId: head.id, swipeId: 0, refs: [{ in: "post", seq: detail.seq, index: 0 }] })).applied).toBe(true);
    // The player edits the message the Re-run answers while it streams, so it commits under the pause.
    const g = await h.host.start(chat, { type: "swipe", messageId: head.id });
    h.host.editMessage(chat, user.id, "buy:map:30");
    await h.host.settle();
    await h.host.finish(g, "Okay.");
    const made = (await h.core(chat)).journal.messages[head.id]?.ledger.swipes[String(h.host.message(chat, head.id).swipeId)];
    expect(made?.post).toEqual([]);
    expect(made?.dropped).toEqual([{ seq: mood.seq, kind: "fix", reason: "the chat was paused" }]);
    const notCarried = async () => (await h.folds(chat)).optimized.notes.filter((n) => n.kind === "not_carried").map((n) => [n.ref, n.text]);
    expect(await notCarried()).toEqual([[{ in: "post", seq: mood.seq, index: 0 }, "the chat was paused"]]);
    await expectAgree(h, chat);
    // Kept, the new swipe folds as a view without the correction and still says it wasn't carried.
    expect((await h.write(chat, { kind: "keep", id: "k1", messageId: user.id, parentPath: "", convert: [] })).applied).toBe(true);
    expect((await h.folds(chat)).optimized.state.entities[POV]?.fields.mood).toBe("fine");
    expect(await notCarried()).toEqual([[{ in: "post", seq: mood.seq, index: 0 }, "the chat was paused"]]);
    await expectAgree(h, chat);
  });

  test("a Re-narrate that got no plan is a Re-run: under a pause it notes each fix it would have carried, and with the pause lifted mid-stream it carries them (P3, L43)", async () => {
    // Two chats, each with a calm fix on the turn's reply, its first user message then edited (the pause).
    const setUp = async () => {
      const h = new Harness();
      const chat = await h.newChat();
      await h.send(chat, "look around");
      await h.send(chat, "buy:lamp:20", "Bought.");
      const head = h.host.head(chat);
      const first = h.host.chat(chat).messages.find((m) => m.isUser);
      if (!head || !first) throw new Error("no turn");
      await h.write(chat, { kind: "post", id: "mood", target: "head", entry: { kind: "fix", events: [{ type: "set", entity: POV, field: "mood", value: "calm" }] } });
      const mood = (await h.core(chat)).journal.messages[head.id]?.ledger.swipes["0"]?.post[0];
      if (!mood) throw new Error("no fix");
      h.host.editMessage(chat, first.id, "earn:5");
      await h.host.settle();
      // A swipe under the pause gets no plan, so it can't copy its source.
      h.renarrateNext = true;
      const g = await h.host.start(chat, { type: "swipe", messageId: head.id });
      const made = async () => (await h.core(chat)).journal.messages[head.id]?.ledger.swipes[String(h.host.message(chat, head.id).swipeId)];
      return { h, chat, first, mood, g, made };
    };
    const paused = await setUp();
    await paused.h.host.finish(paused.g, "Okay.");
    expect((await paused.made())?.post).toEqual([]);
    expect((await paused.made())?.dropped).toEqual([{ seq: paused.mood.seq, kind: "fix", reason: "the chat was paused" }]);
    await expectAgree(paused.h, paused.chat);
    // Deleting the edited message lifts the pause before the reply ends: it commits where it lands, carrying the fix.
    const lifted = await setUp();
    lifted.h.host.deleteMessage(lifted.chat, lifted.first.id);
    await lifted.h.host.settle();
    await lifted.h.host.finish(lifted.g, "Okay.");
    const rec = await lifted.made();
    expect(rec?.post).toEqual([{ ...lifted.mood, at: rec?.path ?? "" }]);
    expect(rec?.dropped).toBeUndefined();
    expect((await lifted.h.folds(lifted.chat)).optimized.state.entities[POV]?.fields.mood).toBe("calm");
    await expectAgree(lifted.h, lifted.chat);
  });

  test("a Re-run made under a pause names the fixes live where it was made, though a switch moved the chain before it ended (L43)", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "look around");
    const greeting = h.host.chat(chat).messages[0];
    if (!greeting) throw new Error("no greeting");
    h.host.addSwipe(chat, greeting.id, "Another way.");
    await h.host.settle();
    // A fix held while a reply streams lands after it, under the pause its user message's edit made:
    // it is live only where the chat stood then, not on its own record's path.
    const user = h.host.sendUser(chat, "buy:map:30");
    await h.host.settle();
    const w1 = await h.host.start(chat, { type: "normal" });
    expect((await h.write(chat, { kind: "post", id: "mood", target: "head", entry: { kind: "fix", events: [{ type: "set", entity: POV, field: "mood", value: "calm" }] } })).pending).toBe(true);
    h.host.editMessage(chat, user, "buy:lamp:20");
    await h.host.settle();
    await h.host.finish(w1, "Okay.");
    const head = h.host.head(chat);
    const mood = head ? (await h.core(chat)).journal.messages[head.id]?.ledger.swipes["0"]?.post[0] : undefined;
    if (!head || !mood) throw new Error("no fix");
    // The Re-run under the pause gets no plan; the greeting switched back moves its chain, and a Keep held in its window lifts the pause after it.
    const g = await h.host.start(chat, { type: "swipe", messageId: head.id });
    h.host.navigate(chat, greeting.id, 0);
    await h.host.settle();
    expect((await h.write(chat, { kind: "keep", id: "k1", messageId: user, parentPath: "", convert: [] })).pending).toBe(true);
    await h.host.finish(g, "Okay.");
    const made = (await h.core(chat)).journal.messages[head.id]?.ledger.swipes[String(h.host.message(chat, head.id).swipeId)];
    expect(made?.post).toEqual([]);
    expect(made?.dropped).toEqual([{ seq: mood.seq, kind: "fix", reason: "the chat was paused" }]);
    expect((await h.core(chat)).journal.pauses).toEqual([]);
    await expectAgree(h, chat);
  });

  // A ✎ cash fix on Dev as the GM view records it while his money isn't open: the opening first (+50), then the correction to 30.
  const devCashFix: LedgerEvent[] = [openMoney("dev"), { type: "post", lines: [{ account: "dev", amount: -20 }, { account: `${EXTERNAL_ACCOUNT_PREFIX}correction`, amount: 20 }], memo: "Correction" }];
  const OPENS_DEV = "Dev counts out his wages. [opens:dev]";

  async function devMoney(h: Harness, chat: string): Promise<[number, number]> {
    const { state } = (await h.folds(chat)).optimized;
    return [balanceOf(state, "dev"), balanceOf(state, `${EXTERNAL_ACCOUNT_PREFIX}opening`)];
  }

  test("a Re-run whose reply opens the money a fix opened carries the correction without the opening: it posts once (L46)", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "look around");
    const head = h.host.head(chat);
    if (!head) throw new Error("no head");
    expect((await h.write(chat, { kind: "post", id: "fix", target: "head", entry: { kind: "fix", events: devCashFix } })).applied).toBe(true);
    expect(await devMoney(h, chat)).toEqual([30, -50]);
    const g = await h.host.start(chat, { type: "swipe", messageId: head.id });
    await h.host.finish(g, OPENS_DEV);
    // The fix keeps setting Dev's cash to 30, now on the accounts the reply opened.
    expect(await devMoney(h, chat)).toEqual([30, -50]);
    expect((await h.folds(chat)).optimized.notes.filter((n) => n.kind === "not_carried")).toEqual([]);
    await expectAgree(h, chat);
  });

  test("a Re-read whose new read opens the money a kept fix opened keeps the correction without the opening (L46)", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "look around");
    const head = h.host.head(chat);
    if (!head) throw new Error("no head");
    await h.write(chat, { kind: "post", id: "fix", target: "head", entry: { kind: "fix", events: devCashFix } });
    h.host.editMessage(chat, head.id, OPENS_DEV);
    await h.host.settle();
    expect((await h.write(chat, { kind: "reread", id: "r1", messageId: head.id, swipeId: head.swipeId })).applied).toBe(true);
    expect(await devMoney(h, chat)).toEqual([30, -50]);
    expect((await h.folds(chat)).optimized.notes.filter((n) => n.kind === "not_carried")).toEqual([]);
    await expectAgree(h, chat);
  });

  test("a fix held while a reply streams lands without the opening the reply already made (L46)", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "look around");
    h.host.sendUser(chat, "look around");
    await h.host.settle();
    const g = await h.host.start(chat, { type: "normal" });
    expect((await h.write(chat, { kind: "post", id: "held", target: "head", entry: { kind: "fix", events: devCashFix } })).pending).toBe(true);
    await h.host.finish(g, OPENS_DEV);
    expect(await devMoney(h, chat)).toEqual([30, -50]);
    expect((await h.core(chat)).journal.refused).toBeUndefined();
    await expectAgree(h, chat);
  });

  test("a same-roll world reproduces the roll on every Re-run (L12)", async () => {
    const h = new Harness("same_roll");
    const chat = await h.newChat();
    await h.send(chat, "roll", "The dice roll.");
    const first = await cash(h, chat);
    const { seeds, cash: amounts } = await rerun(h, chat, 10);
    expect(seeds.size).toBe(1);
    expect(amounts.every((c) => c === first)).toBe(true);
    await expectAgree(h, chat);
  });
});

// Hand-written ledger scenarios on the fake host: each pins one rule of DESIGN §4.3 / §5.1.
// The randomized gate is properties.test.ts; these name the cases a reader checks first.

import { describe, expect, test } from "bun:test";
import { decodeJournal, decodeLedger, journalPath } from "../../src/backend/ledger-io";
import { defaultSettings } from "../../src/backend/settings-store";
import { startMarkersFrom } from "../../src/backend/start-markers";
import { presetAdjudication } from "../../src/shared/adjudication";
import { hashJson } from "../../src/shared/hash";
import type { ChatId, MessageId } from "../../src/shared/ids";
import type { JsonValue } from "../../src/shared/json";
import { isRecord } from "../../src/shared/json";
import type { Journal, LedgerEvent, Marker } from "../../src/shared/ledger";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import { EXTERNAL_ACCOUNT_PREFIX, validMarkerBody } from "../../src/engine/events";
import { Harness } from "../support/harness";
import { balanceOf, openMoney, POV } from "../support/test-pack";

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

function assistantIds(h: Harness, chatId: string): string[] {
  return h.host.chat(chatId).messages.filter((m) => !m.isUser).map((m) => m.id);
}

/**
 * A chat as an earlier build left it: its starting markers journaled as the world writes them (the
 * half-minute action tick as 0.5), so the chain after them was hashed with those, while its flush
 * wrote them to metadata as the marker check clamps them (1). The turns of the test below.
 */
async function earlierBuildChat(h: Harness): Promise<{ chat: ChatId; first: MessageId; clamped: Marker[] }> {
  const chat = await h.newChat();
  await h.send(chat, "look around");
  const first = h.host.head(chat)?.id ?? "";
  const jm = (await h.core(chat)).journal.messages[first];
  const world = h.worlds.get(h.revision);
  if (!jm || !world) throw new Error("no starting markers");
  const clamped = structuredClone(jm.ledger.markers);
  const raws = startMarkersFrom(defaultSettings(), world, h.revision).filter((raw) => hashJson(validMarkerBody(raw)) !== hashJson(raw));
  expect(raws.length).toBeGreaterThan(0);
  jm.ledger.markers = jm.ledger.markers.map((mk) => {
    const { seq, at, start: _start, ...body } = mk;
    const raw = mk.start ? raws.find((r) => hashJson(validMarkerBody(r)) === hashJson(body)) : undefined;
    return raw ? { ...raw, seq, at, start: true as const } : mk;
  });
  await h.send(chat, "earn:5", "Payday. [found:5]");
  await h.send(chat, "earn:7", "Okay.");
  const message = h.host.chat(chat).messages.find((m) => m.id === first);
  const stored = message?.bag[LEDGER_NAMESPACE];
  if (!message || !isRecord(stored)) throw new Error("no stored ledger");
  message.bag = { ...message.bag, [LEDGER_NAMESPACE]: { ...stored, markers: clamped as unknown as JsonValue } };
  return { chat, first, clamped };
}

/** The action tick among a chat's journaled starting markers. */
async function startTick(h: Harness, chatId: ChatId): Promise<unknown> {
  const starts = Object.values((await h.core(chatId)).journal.messages).flatMap((jm) => jm.ledger.markers.filter((mk) => mk.start));
  return starts.find((mk) => mk.kind === "time" && mk.control === "tick" && "sceneType" in mk.scope && mk.scope.sceneType === "action")?.to;
}

describe("ledger scenarios", () => {
  test("a turn commits planned and read events, with starting markers, and flushes metadata", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "buy:map:30", "You buy a map. [found:5]");
    expect(await cash(h, chat)).toBe(75);
    const { optimized } = await h.folds(chat);
    // The starting markers are the world's own defaults, each as a marker plays it: the half-minute action tick is a minute.
    expect(optimized.state.time.sceneTicks.action).toBe(1);
    expect(optimized.state.adjudication).toEqual(presetAdjudication("crunchy"));
    const head = h.host.head(chat);
    const core = await h.core(chat);
    expect(JSON.stringify(head?.bag[LEDGER_NAMESPACE])).toBe(JSON.stringify(head ? core.journal.messages[head.id]?.ledger : undefined));
    await expectAgree(h, chat);
  });

  test("a copy of a chat whose first reply was read without a plan gets its starting markers on its next turn, as the chat does", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    // The host gives up on the first turn's context handler: nothing is planned, and the reply is still read.
    h.host.sendUser(chat, "look around");
    await h.host.settle();
    const g = await h.host.start(chat, { type: "normal", abandonContext: true });
    await h.host.finish(g, "You find a coin. [found:5]");
    expect((await h.core(chat)).journal.started).toBe(false);
    const branch = h.host.branch(chat, h.host.head(chat)?.id ?? "");
    const imported = h.host.importCopy(chat);
    await h.send(chat, "earn:5");
    const source = (await h.folds(chat)).reference.state;
    expect(source.adjudication).toEqual(presetAdjudication("crunchy"));
    for (const id of [branch, imported]) {
      await h.service.open(id, h.host.userId);
      await h.host.settle();
      expect((await h.core(id)).journal.started).toBe(false);
      await h.send(id, "earn:5");
      expect(hashJson((await h.folds(id)).reference.state)).toBe(hashJson(source));
      await expectAgree(h, id);
    }
  });

  test("a branch, an import and a journal rebuilt from metadata fold every record on its path; Undo and Re-read work there", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "look around");
    await h.send(chat, "earn:5", "Payday. [found:5]");
    await h.send(chat, "earn:7", "Okay.");
    const head = h.host.head(chat);
    if (!head) throw new Error("no head");
    const branch = h.host.branch(chat, head.id);
    const imported = h.host.importCopy(chat);
    // The original as a lost journal leaves it: rebuilt from what its messages' metadata holds.
    h.host.files.delete(`${h.host.userId}/${journalPath(chat)}`);
    h.service.forget(chat);
    for (const id of [branch, imported, chat]) {
      await h.service.open(id, h.host.userId);
      await h.host.settle();
      expect((await h.folds(id)).optimized.messages.filter((m) => m.fold !== "user").map((m) => m.fold)).toEqual(["plain", "on_path", "on_path", "on_path"]);
      expect(await cash(h, id)).toBe(117);
      const last = h.host.head(id);
      if (!last) throw new Error("no head");
      // Undo the last turn's earn (event 0 is its tick), then Re-read an edit of its reply.
      expect((await h.write(id, { kind: "undo", id: `u-${id}`, messageId: last.id, swipeId: last.swipeId, refs: [{ in: "events", index: 1 }] })).applied).toBe(true);
      expect(await cash(h, id)).toBe(110);
      h.host.editMessage(id, last.id, "Okay. [found:3]");
      await h.host.settle();
      expect((await h.write(id, { kind: "reread", id: `r-${id}`, messageId: last.id, swipeId: last.swipeId })).applied).toBe(true);
      expect(await cash(h, id)).toBe(113);
      await expectAgree(h, id);
    }
  });

  test("a chat an earlier build wrote folds on its path once branched, imported or rebuilt, and gets its starting markers back as they were hashed", async () => {
    const h = new Harness();
    const { chat, first, clamped } = await earlierBuildChat(h);
    const lost = (await earlierBuildChat(h)).chat;
    const head = h.host.head(chat);
    if (!head) throw new Error("no head");
    const branch = h.host.branch(chat, head.id);
    const imported = h.host.importCopy(chat);
    // A journal the earlier build rebuilt from that metadata holds the clamped markers too.
    const file = `${h.host.userId}/${journalPath(chat)}`;
    const journal = JSON.parse(h.host.files.get(file) ?? "null") as Journal;
    const held = journal.messages[first];
    if (!held) throw new Error("no journaled starting markers");
    held.ledger.markers = clamped;
    h.host.files.set(file, JSON.stringify(journal));
    h.service.forget(chat);
    // A lost journal is rebuilt from that metadata now.
    h.host.files.delete(`${h.host.userId}/${journalPath(lost)}`);
    h.service.forget(lost);
    for (const id of [branch, imported, chat, lost]) {
      await h.service.open(id, h.host.userId);
      await h.host.settle();
      const folds = await h.folds(id);
      expect(folds.optimized.messages.filter((m) => m.fold !== "user").map((m) => m.fold)).toEqual(["plain", "on_path", "on_path", "on_path"]);
      expect(folds.cold.messages).toEqual(folds.reference.messages);
      expect(hashJson(folds.cold.state)).toBe(hashJson(folds.reference.state));
      // Journaled as the chain was hashed, and written back, so a later copy folds alike.
      expect(await startTick(h, id)).toBe(0.5);
      const core = await h.core(id);
      for (const m of h.host.chat(id).messages) if (core.journal.messages[m.id]) expect(JSON.stringify(decodeLedger(m.bag))).toBe(JSON.stringify(core.journal.messages[m.id]?.ledger));
      expect(await cash(h, id)).toBe(117);
      const last = h.host.head(id);
      if (!last) throw new Error("no head");
      expect((await h.write(id, { kind: "undo", id: `u-${id}`, messageId: last.id, swipeId: last.swipeId, refs: [{ in: "events", index: 1 }] })).applied).toBe(true);
      expect(await cash(h, id)).toBe(110);
      await expectAgree(h, id);
    }
    // A chat this build started keeps its starting markers clamped: its paths were hashed with them.
    const current = await h.newChat();
    await h.send(current, "look around");
    await h.send(current, "earn:5");
    const copy = h.host.branch(current, h.host.head(current)?.id ?? "");
    await h.service.open(copy, h.host.userId);
    await h.host.settle();
    for (const id of [current, copy]) expect(await startTick(h, id)).toBe(1);
    expect((await h.folds(copy)).optimized.messages.filter((m) => m.fold !== "user").map((m) => m.fold)).toEqual(["plain", "on_path", "on_path"]);
  });

  test("editing an assistant reply keeps the world; Re-read edit re-extracts (L38)", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "earn:10", "Payday. [found:5]");
    const before = await h.folds(chat);
    const head = h.host.head(chat);
    if (!head) throw new Error("no head");
    h.host.editMessage(chat, head.id, "Payday, fixed typo. [found:50]");
    await h.host.settle();
    const after = await h.folds(chat);
    expect(hashJson(after.optimized.state)).toBe(hashJson(before.optimized.state));
    const rec = (await h.core(chat)).journal.messages[head.id]?.ledger.swipes["0"];
    expect(rec?.accepted).toBeDefined();
    await h.write(chat, { kind: "reread", id: "r1", messageId: head.id, swipeId: 0 });
    expect(await cash(h, chat)).toBe(160);
    await expectAgree(h, chat);
  });

  test("an earlier swipe switch rebases later records; switching back restores the original (L2, L3)", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "buy:map:30", "Bought.");
    await h.send(chat, "use:map", "You read the map.");
    const original = await h.folds(chat);
    const [, a1] = assistantIds(h, chat);
    if (!a1) throw new Error("no A1");
    h.host.addSwipe(chat, a1, "You walk past the shop.");
    await h.host.settle();
    const switched = await h.folds(chat);
    expect(switched.optimized.messages.at(-1)?.fold).toBe("view");
    expect(switched.optimized.keepReport.some((k) => k.status === "dropped")).toBe(true);
    expect((await h.core(chat)).journal.pauses).toEqual([]);
    await expectAgree(h, chat);
    h.host.navigate(chat, a1, 0);
    await h.host.settle();
    const back = await h.folds(chat);
    expect(hashJson(back.optimized.state)).toBe(hashJson(original.optimized.state));
    await expectAgree(h, chat);
  });

  test("a payment rebased onto a poorer branch is dropped with a Keep line, never folded negative", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "deposit:100", "Payday.");
    await h.send(chat, "pay:20", "You buy a soda.");
    const [, , soda] = assistantIds(h, chat);
    if (!soda) throw new Error("no soda turn");
    // The other swipe of that turn bought nothing.
    h.host.addSwipe(chat, soda, "You walk past the machine.");
    await h.host.settle();
    await h.send(chat, "pay:90", "You pay Marcus for the tire.");
    expect(balanceOf((await h.folds(chat)).optimized.state)).toBe(10);
    // Back to the soda: the $90 payment no longer fits the $80 left.
    h.host.navigate(chat, soda, 0);
    await h.host.settle();
    const rebased = await h.folds(chat);
    expect(rebased.optimized.messages.at(-1)?.fold).toBe("view");
    expect(balanceOf(rebased.optimized.state)).toBe(80);
    expect(rebased.optimized.keepReport.filter((k) => k.status === "dropped").map((k) => k.text)).toEqual(["sam can't cover 90"]);
    await expectAgree(h, chat);
    h.host.navigate(chat, soda, 1);
    await h.host.settle();
    expect(balanceOf((await h.folds(chat)).optimized.state)).toBe(10);
    await expectAgree(h, chat);
  });

  test("a grouped purchase rebased onto a poorer branch drops whole: no payment, no item (L41)", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "deposit:100", "Payday.");
    await h.send(chat, "pay:20", "You buy a soda.");
    const [, , soda] = assistantIds(h, chat);
    if (!soda) throw new Error("no soda turn");
    h.host.addSwipe(chat, soda, "You walk past the machine.");
    await h.host.settle();
    await h.send(chat, "shop:tire:90", "Marcus hands you the tire.");
    expect(balanceOf((await h.folds(chat)).optimized.state)).toBe(10);
    expect(JSON.stringify((await h.folds(chat)).optimized.state.packs.test)).toContain("tire");
    h.host.navigate(chat, soda, 0);
    await h.host.settle();
    const rebased = await h.folds(chat);
    expect(balanceOf(rebased.optimized.state)).toBe(80);
    expect(JSON.stringify(rebased.optimized.state.packs.test ?? {})).not.toContain("tire");
    // Both members are dropped for the posting's reason, each with its Keep line.
    expect(rebased.optimized.keepReport.filter((k) => k.status === "dropped").map((k) => k.text)).toEqual(["sam can't cover 90", "sam can't cover 90"]);
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

  test("a head Continue reads only its suffix; a non-head Continue is accepted unread (L13, L14)", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "earn:10", "Payday.");
    let g = await h.host.start(chat, { type: "continue" });
    await h.host.finish(g, "And a bonus. [found:3]");
    expect(await cash(h, chat)).toBe(113);
    const greeting = assistantIds(h, chat)[0];
    if (!greeting) throw new Error("no greeting");
    const before = await h.folds(chat);
    g = await h.host.start(chat, { type: "continue", messageId: greeting });
    await h.host.finish(g, "Earlier text. [found:1000]");
    const after = await h.folds(chat);
    expect(hashJson(after.optimized.state)).toBe(hashJson(before.optimized.state));
    expect((await h.core(chat)).journal.messages[greeting]?.ledger.swipes["0"]?.accepted).toBeDefined();
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

  test("a Re-run carries the swipe's fixes, undos included; one that no longer applies is dropped with a note (L43)", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "buy:lamp:20", "Bought.");
    const head = h.host.head(chat);
    if (!head) throw new Error("no head");
    const fix = (id: string, events: LedgerEvent[]) => h.write(chat, { kind: "post", id, target: "head", entry: { kind: "fix", events } });
    await fix("mood", [{ type: "set", entity: POV, field: "mood", value: "calm" }]);
    await fix("detail", [{ type: "set", entity: POV, field: "detail", value: "scar" }]);
    await fix("lamp", [{ type: "test.lose", data: { item: "lamp" } }]);
    // An undone fix stays undone on the new swipe.
    const rec = (await h.core(chat)).journal.messages[head.id]?.ledger.swipes["0"];
    const detail = rec?.post.find((p) => p.events.some((e) => e.type === "set" && e.field === "detail"));
    if (!detail) throw new Error("no detail fix");
    expect((await h.write(chat, { kind: "undo", id: "u1", messageId: head.id, swipeId: 0, refs: [{ in: "post", seq: detail.seq, index: 0 }] })).applied).toBe(true);
    // The Re-run's own reply loses the lamp, so taking it away no longer applies.
    const g = await h.host.start(chat, { type: "swipe", messageId: head.id });
    await h.host.finish(g, "The lamp slips away. [lose:lamp]");
    const after = (await h.folds(chat)).optimized;
    expect(after.state.entities[POV]?.fields).toMatchObject({ mood: "calm" });
    expect(after.state.entities[POV]?.fields.detail).toBeUndefined();
    expect(after.notes.filter((n) => n.kind === "not_carried").map((n) => n.text)).toEqual(["no lamp to lose"]);
    await expectAgree(h, chat);
    // Swiping back finds the original swipe with its own fixes.
    h.host.navigate(chat, head.id, 0);
    await h.host.settle();
    expect((await h.folds(chat)).optimized.notes.filter((n) => n.kind === "not_carried")).toEqual([]);
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

  test("a Re-run records a fresh seed and a 50% roll lands near half (L12)", async () => {
    const h = new Harness();
    const chat = await h.newChat();
    await h.send(chat, "roll", "The dice roll.");
    const { seeds, cash: amounts } = await rerun(h, chat, 200);
    expect(seeds.size).toBe(200);
    const wins = amounts.filter((c) => c === 110).length;
    expect(amounts.every((c) => c === 110 || c === 90)).toBe(true);
    expect(wins).toBeGreaterThan(70);
    expect(wins).toBeLessThan(130);
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

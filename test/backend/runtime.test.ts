// The backend end to end on the fake host: world create and attach over the protocol, a turn
// planned by the real simulation pipeline, extraction with scripted model replies (auto and
// confirm chips, D4 learning), the engine slots in the interceptor, settings and the state push.

import { describe, expect, test } from "bun:test";
import { loreOfEntry, slotOfEntry } from "../../src/backend/book";
import type { HostBookEntryInput } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { describeProposal, playerReason } from "../../src/backend/runtime";
import { compactSpan, keepSummary, playerDrops, spanText, TIMELAPSE_ACTION } from "../../src/backend/view";
import { UNSEEN_DROP } from "../../src/engine/player-events";
import type { Rec } from "../../src/shared/ledger";
import { initialState } from "../../src/engine/world-state";
import type { JsonObject } from "../../src/shared/json";
import { isRecord } from "../../src/shared/json";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import { DEFAULT_CURRENCY, formatMoney } from "../../src/shared/world";
import { registryOf } from "../packs/support";
import { Rig } from "../support/rig";
import { POV, testWorld } from "../support/test-pack";

const EXTRACT_MARK = "propose concrete state changes";

describe("backend runtime", () => {
  test("create a world, attach a chat, and get a snapshot", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const meta = await rig.host.chats.chatMetadata(chatId, rig.host.userId);
    expect(isRecord(meta[LEDGER_NAMESPACE])).toBe(true);
    expect(Array.isArray(meta.chat_world_book_ids)).toBe(true);
    const view = rig.latestView(chatId);
    expect(view?.status).toBe("idle");
    expect(view?.worldId).toBeDefined();
  });

  test("a turn is planned by the pipeline, committed and pushed", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "look around", "The kitchen is quiet.");
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const head = rig.host.head(chatId);
    const rec = head ? core?.journal.messages[head.id]?.ledger.swipes["0"] : undefined;
    expect(rec).toBeDefined();
    expect(rec?.events.some((e) => e.type === "clock")).toBe(true);
    const view = await rig.rt.view(chatId, rig.host.userId);
    expect(view.status).toBe("idle");
    expect(view.hud?.clock.minutes).toBeGreaterThan(0);
    // D8: the turn's player-known results are in the Journal.
    expect(view.journal.some((n) => n.kind === "note" && n.messageId === head?.id && n.text.includes("min passed"))).toBe(true);
    expect(rig.host.sent.some((m) => m.type === "lre.state.delta" && m.chatId === chatId)).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("Re-narrate copies the source's seed and pre events and commits its read as a narr entry; Re-run rolls afresh", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "look around", "The kitchen is quiet.");
    const head = rig.host.head(chatId);
    if (!head) throw new Error("no head");
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const source = core?.journal.messages[head.id]?.ledger.swipes["0"];
    if (!source) throw new Error("no source record");
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "swipe_option");
    expect(chip?.actions.map((a) => a.id)).toEqual(["renarrate", "rerun"]);
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip?.id, choice: "renarrate" }));
    const g = await rig.host.start(chatId, { type: "swipe" });
    await rig.host.finish(g, "The kitchen hums, quiet as ever.");
    const renarrated = core?.journal.messages[head.id]?.ledger.swipes["1"];
    expect(renarrated?.seed).toBe(source.seed);
    expect(renarrated?.pre).toBe(source.pre);
    expect(renarrated?.events).toEqual(source.events.slice(0, source.pre));
    expect(renarrated?.markersApplied).toBe(source.markersApplied);
    expect(renarrated?.post.every((p) => p.kind !== "narr" || p.seq > (core?.journal.messages[head.id]?.ledger.swipes["0"]?.seq ?? 0))).toBe(true);
    // The one-shot choice is spent: the next swipe follows the default (Re-run) with a fresh seed.
    const g2 = await rig.host.start(chatId, { type: "swipe" });
    await rig.host.finish(g2, "Something else entirely.");
    const rerun = core?.journal.messages[head.id]?.ledger.swipes["2"];
    expect(rerun?.seed).not.toBe(source.seed);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a checked action gets a roll chip and leads the Outcome slot; chips belong to their swipe", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld("Coins");
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "checks", id: "coin_flip", value: { id: "coin_flip", dice: "1d2", bands: [{ outcome: "fail", max: 1 }, { outcome: "success", min: 2 }] } }));
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "actions", id: "flip_coin", value: { id: "flip_coin", label: "Flip a coin", params: {}, requires: [], check: "coin_flip", outcomes: { success: [], fail: [] }, duration: "1", lexicon: ["flip a coin"] } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.body(await rig.send({ type: "lre.action", chatId, action: "flip_coin", params: {}, source: "palette" }));
    // As after a restart: the bridge that saw the request is gone; the intent comes from the message.
    rig.rt.forgetChat(chatId);
    const g = await rig.host.start(chatId, { type: "normal" });
    const outcome = rig.host.lastInterceptor?.mutated.find((m) => m.content?.startsWith("[Outcome]"))?.content ?? "";
    expect(outcome).toMatch(/Flip a coin: (success|fail) \(rolled [12] on 1d2\)/);
    await rig.host.finish(g, "The coin spins.");
    const head = rig.host.head(chatId);
    if (!head) throw new Error("no reply");
    const roll = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "roll");
    expect(roll?.swipeId).toBe(0);
    expect(roll?.detail).toContain("Odds: fail 50% · success 50%");
    // Another swipe of the same reply: swipe 0's chips stay with swipe 0.
    const g2 = await rig.host.start(chatId, { type: "swipe" });
    await rig.host.finish(g2, "Heads again.");
    const rolls = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "roll");
    expect(rolls.map((c) => c.swipeId)).toEqual([1]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("world lore stays in the world document: the engine book holds slots only, and lore an earlier build synced there is removed at the next ensure", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld("Harbor");
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "ferry", value: { id: "ferry", title: "The ferry", content: "The ferry crosses every hour.", keys: ["ferry"], links: [] } }));
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "vault", value: { id: "vault", title: "The vault", content: "Rumors say the bank has an old vault.", keys: ["ferry"], links: [], secret: true, gate: "false" } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const got = rig.body(await rig.send({ type: "lre.world", op: "get", worldId }));
    expect(isRecord(got.world) && isRecord(got.world.lore) ? Object.keys(got.world.lore).sort() : []).toEqual(["ferry", "vault"]);
    const bookId = (await rig.rt.worlds.index(worldId, rig.host.userId))?.loreBookId;
    if (!bookId) throw new Error("no engine book");
    const slots = await rig.host.books.entries(bookId, rig.host.userId);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((e) => slotOfEntry(e.extensions) !== null && e.disabled && e.keys.length === 0 && e.content === "")).toBe(true);
    // A gated secret's lore as an earlier build synced it: its full text, its gate in extension data.
    await rig.host.books.createEntry(bookId, { comment: "The vault", content: "Rumors say the bank has an old vault.", keys: [], disabled: true, constant: false, position: 0, depth: 4, role: null, order: 200, extensions: { [LEDGER_NAMESPACE]: { lore: "vault", keys: ["ferry"], links: [], secret: true, gate: "false", hash: "old" } } }, rig.host.userId);
    // Attaching the world to a chat ensures its book: the copy goes, the slots stay.
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const after = await rig.host.books.entries(bookId, rig.host.userId);
    expect(after.some((e) => loreOfEntry(e.extensions) !== null)).toBe(false);
    expect(after.map((e) => e.id)).toEqual(slots.map((e) => e.id));
  });

  test("an engine-book entry the engine didn't fill is voted off even when switched on in the host's UI; a lore copy an earlier build left is removed after the turn", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const run = await rig.rt.runOf(chatId, rig.host.userId);
    const bookId = (await rig.rt.worlds.index(run?.worldId ?? "", rig.host.userId))?.loreBookId ?? "";
    // Switched on with a key the turn's text matches: the unused Vehicles slot and an old lore copy.
    const vehicles = (await rig.rt.book.slotEntries(bookId, rig.host.userId)).get("vehicles") ?? "";
    rig.host.editEntry(vehicles, { disabled: false, keys: ["ferry"] });
    const leftover = await rig.host.books.createEntry(bookId, { comment: "The vault", content: "Rumors say the bank has an old vault.", keys: ["ferry"], disabled: false, constant: false, position: 0, depth: 4, role: null, order: 200, extensions: { [LEDGER_NAMESPACE]: { lore: "vault", secret: true, gate: "false" } } }, rig.host.userId);
    await rig.turn(chatId, "I wait for the ferry.", "The horn sounds.");
    const result = rig.host.lastInterceptor;
    for (const id of [vehicles, leftover]) {
      expect(result?.disabled).toContain(id);
      expect(result?.enabled).not.toContain(id);
      expect(result?.forced).not.toContain(id);
    }
    await rig.host.settle();
    const entries = await rig.host.books.entries(bookId, rig.host.userId);
    expect(entries.some((e) => e.id === leftover)).toBe(false);
    expect(entries.some((e) => e.id === vehicles)).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a world file with a step template for the retired select purpose imports without it; its other templates stay", async () => {
    const rig = new Rig();
    const file = rig.body(await rig.send({ type: "lre.world", op: "export", worldId: await rig.newWorld("Source") })).file as { world: JsonObject };
    const steps = { pick: { id: "pick", purpose: "select", template: "Does this lore matter?", output: "decision", signals: ["uncached"] }, brief: { id: "brief", purpose: "brief", template: "Summarize the scene.", output: "text", signals: [] } };
    const imported = rig.body(await rig.send({ type: "lre.world", op: "import", file: { format: "lre-world-export-v1", world: { ...file.world, steps } } })) as { world: { id: string; steps: Record<string, unknown> } };
    expect(Object.keys(imported.world.steps)).toEqual(["brief"]);
    const stored = rig.body(await rig.send({ type: "lre.world", op: "get", worldId: imported.world.id })) as { world: { steps: Record<string, unknown> } };
    expect(Object.keys(stored.world.steps)).toEqual(["brief"]);
  });

  test("a narrated purchase the engine declines gets a decline chip, the next Outcome slot says so, and Pay another way applies it", async () => {
    const rig = new Rig();
    rig.host.quietReply = (req) => (req.messages[0]?.content.includes(EXTRACT_MARK) ? JSON.stringify({ proposals: [{ type: "purchase", payer: POV, item: "lamp", price: 99999 }] }) : "{}");
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I buy the lamp.", "She rings up the lamp.");
    const chips = (await rig.rt.view(chatId, rig.host.userId)).chips;
    expect(chips.some((c) => c.kind === "confirm")).toBe(false);
    const decline = chips.find((c) => c.kind === "decline");
    expect(decline?.label).toBe("Couldn't pay for lamp");
    expect(decline?.actions.map((a) => a.id)).toEqual(["other", "remove", "accept"]);
    // The next turn (and only it) is told the purchase didn't happen.
    rig.host.quietReply = () => "{}";
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    expect(rig.host.lastInterceptor?.mutated.find((m) => m.content?.startsWith("[Outcome]"))?.content ?? "").toContain("payment for lamp was declined (Sam doesn't have $99999)");
    await rig.host.finish(g, "Nothing much.");
    rig.host.sendUser(chatId, "I wait.");
    await rig.host.settle();
    const g2 = await rig.host.start(chatId, { type: "normal" });
    expect(rig.host.lastInterceptor?.mutated.find((m) => m.content?.startsWith("[Outcome]"))?.content ?? "").not.toContain("lamp");
    await rig.host.finish(g2, "Time passes.");
    expect(rig.rt.ledger.errors).toEqual([]);
    // Pay another way (on a fresh chat, before the chip lapses): the first method that covers it applies.
    const other = new Rig();
    other.host.quietReply = (req) => (req.messages[0]?.content.includes(EXTRACT_MARK) ? JSON.stringify({ proposals: [{ type: "purchase", payer: POV, item: "lamp", price: 99999 }] }) : "{}");
    const otherChat = await other.worldChat();
    await other.turn(otherChat, "I buy the lamp.", "She rings up the lamp.");
    const chip = (await other.rt.view(otherChat, other.host.userId)).chips.find((c) => c.kind === "decline");
    expect(other.body(await other.send({ type: "lre.chip", chatId: otherChat, chip: chip?.id, choice: "other" })).applied).toBe(true);
    const core = await other.rt.ledger.core(otherChat, other.host.userId);
    expect(core?.fold(toChain(await other.host.chats.messages(otherChat, other.host.userId))).state.entities[POV]?.fields.detail).toBe("paid from savings");
    expect(other.rt.ledger.errors).toEqual([]);
  });

  test("typed text interpret read as an action gets a Not an action? chip that undoes the resolution", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld("Earnings");
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "actions", id: "tip", value: { id: "tip", label: "Get a tip", params: {}, requires: [], outcomes: { default: [{ type: "add", args: { entity: POV, field: "cash", delta: 5 } }] }, duration: "1", lexicon: ["tip"] } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.host.quietReply = (req) => (req.messages[0]?.content.includes(EXTRACT_MARK) ? "{}" : JSON.stringify({ action: "tip", params: {}, probabilities: { tip: 1 } }));
    const before = Number(await rig.cashOf(chatId));
    await rig.turn(chatId, "Someone leaves a tip.", "A coin clinks.");
    expect(Number(await rig.cashOf(chatId))).toBe(before + 5);
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "not_action");
    expect(chip?.label).toBe("Not an action?");
    expect(chip?.detail).toContain('Read as "Get a tip"');
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip?.id, choice: "undo" }));
    expect(Number(await rig.cashOf(chatId))).toBe(before);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("extraction applies automatic proposals with an undo chip and stores confirm chips", async () => {
    const rig = new Rig();
    rig.host.quietReply = (req) => (req.messages[0]?.content.includes(EXTRACT_MARK) ? JSON.stringify({ proposals: [{ type: "condition", entity: POV, field: "cash", delta: 7 }, { type: "regard", from: POV, to: "dev", axis: "trust", delta: 1 }] }) : "{}");
    // Dev is in the room: a world that places the player (here at its start place) names only people the player can know.
    const worldId = await rig.newWorld();
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: "dev", value: { ...testWorld().entities.dev, fields: { ...testWorld().entities.dev?.fields, place: "home" } } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    // Regard is `auto` from cold start (re-measured D4); pin it to confirm to exercise confirm chips.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { regard: { mode: "confirm" } } } }));
    await rig.turn(chatId, "earn", "Dev slips you seven bucks and you trust him a little more.");
    const view = await rig.rt.view(chatId, rig.host.userId);
    const kinds = view.chips.map((c) => c.kind);
    expect(kinds).toContain("undo");
    expect(kinds).toContain("confirm");
    const start = Number(testWorld().entities[POV]?.fields.cash);
    expect(await rig.cashOf(chatId)).toBe(start + 7);
    // Confirm the regard proposal: it lands as a confirm post entry on the head.
    const confirm = view.chips.find((c) => c.kind === "confirm");
    if (!confirm) throw new Error("no confirm chip");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: confirm.id, choice: "confirm" }));
    expect(await rig.moodOf(chatId)).toBe("warm");
    // Undo the automatic one: the cash change stops folding.
    const undo = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "undo");
    if (!undo) throw new Error("no undo chip");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: undo.id, choice: "undo" }));
    expect(await rig.cashOf(chatId)).toBe(start);
    const learning = await rig.rt.settings.learningOf(rig.host.userId);
    expect(learning.connections.active?.condition?.rejected).toBe(1);
    expect(learning.connections.active?.regard?.accepted).toBe(1);
  });

  test("a double-tapped confirm chip applies once", async () => {
    const rig = new Rig();
    rig.host.quietReply = (req) => (req.messages[0]?.content.includes(EXTRACT_MARK) ? JSON.stringify({ proposals: [{ type: "condition", entity: POV, field: "cash", delta: 7 }] }) : "{}");
    const chatId = await rig.worldChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { condition: { mode: "confirm" } } } }));
    await rig.turn(chatId, "earn", "Dev slips you seven bucks.");
    const start = Number(await rig.cashOf(chatId));
    const confirm = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "confirm");
    if (!confirm) throw new Error("no confirm chip");
    const replies = await Promise.all([rig.send({ type: "lre.chip", chatId, chip: confirm.id, choice: "confirm" }), rig.send({ type: "lre.chip", chatId, chip: confirm.id, choice: "confirm" })]);
    expect(replies.map((r) => r.type).sort()).toEqual(["lre.error", "lre.result"]);
    expect(Number(await rig.cashOf(chatId))).toBe(start + 7);
    const learning = await rig.rt.settings.learningOf(rig.host.userId);
    expect(learning.connections.active?.condition?.accepted).toBe(1);
  });

  test("a double-tapped Re-read edit reads once: one extraction, one confirm chip, one change", async () => {
    const rig = new Rig();
    let extracts = 0;
    // Only the edited text ("seven bucks") reads as a change; the original reply doesn't.
    rig.host.quietReply = (req) => {
      const text = req.messages.map((m) => m.content).join("\n");
      if (!text.includes(EXTRACT_MARK)) return "{}";
      extracts++;
      return JSON.stringify({ proposals: text.includes("seven bucks") ? [{ type: "condition", entity: POV, field: "cash", delta: 7 }] : [] });
    };
    const chatId = await rig.worldChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { condition: { mode: "confirm" } } } }));
    await rig.turn(chatId, "earn", "Dev waves.");
    const head = rig.host.head(chatId);
    if (!head) throw new Error("no reply");
    rig.host.editMessage(chatId, head.id, "Dev slips you seven bucks.");
    await rig.host.settle();
    const reread = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "reread");
    if (!reread) throw new Error("no Re-read chip");
    const before = extracts;
    const start = Number(await rig.cashOf(chatId));
    const replies = await Promise.all([rig.send({ type: "lre.chip", chatId, chip: reread.id, choice: "reread" }), rig.send({ type: "lre.chip", chatId, chip: reread.id, choice: "reread" })]);
    expect(replies.map((r) => r.type).sort()).toEqual(["lre.error", "lre.result"]);
    expect(extracts - before).toBe(1);
    const confirms = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "confirm" && c.messageId === head.id);
    expect(new Set(confirms.map((c) => c.id)).size).toBe(confirms.length);
    for (const c of confirms) rig.body(await rig.send({ type: "lre.chip", chatId, chip: c.id, choice: "confirm" }));
    expect(Number(await rig.cashOf(chatId))).toBe(start + 7);
  });

  describe("a Re-read edit replaces the earlier read", () => {
    // Both the original reply and its edit narrate the same purchase.
    const shop = async (): Promise<{ rig: Rig; chatId: string; headId: string; confirms: () => Promise<{ id: string }[]>; posts: () => Promise<number> }> => {
      const rig = new Rig();
      rig.host.quietReply = (req) => (req.messages.map((m) => m.content).join("\n").includes(EXTRACT_MARK) ? JSON.stringify({ proposals: [{ type: "purchase", payer: POV, item: "lamp", price: 30 }] }) : "{}");
      const chatId = await rig.worldChat();
      rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { purchase: { mode: "confirm" } } } }));
      await rig.turn(chatId, "I shop.", "You buy a lamp.");
      const head = rig.host.head(chatId);
      if (!head) throw new Error("no reply");
      const confirms = async () => (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "confirm" && c.messageId === head.id);
      const posts = async () => ((await rig.rt.ledger.core(chatId, rig.host.userId))?.journal.messages[head.id]?.ledger.swipes["0"]?.post ?? []).filter((p) => p.kind === "confirm").length;
      return { rig, chatId, headId: head.id, confirms, posts };
    };
    const reread = async (rig: Rig, chatId: string, headId: string): Promise<void> => {
      rig.host.editMessage(chatId, headId, "You buy a lamp, gladly.");
      await rig.host.settle();
      const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "reread");
      if (!chip) throw new Error("no Re-read chip");
      rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "reread" }));
    };

    test("the earlier read's chips go: one confirm chip, one post (cash 100 → 70)", async () => {
      const { rig, chatId, headId, confirms, posts } = await shop();
      expect(await confirms()).toHaveLength(1);
      await reread(rig, chatId, headId);
      const after = await confirms();
      expect(after).toHaveLength(1);
      for (const c of after) rig.body(await rig.send({ type: "lre.chip", chatId, chip: c.id, choice: "confirm" }));
      expect(await posts()).toBe(1);
      expect(Number(await rig.cashOf(chatId))).toBe(70);
    });

    test("a chip applied before the Re-read is replaced with the read: applying the new one charges once", async () => {
      const { rig, chatId, headId, confirms, posts } = await shop();
      const [old] = await confirms();
      if (!old) throw new Error("no confirm chip");
      rig.body(await rig.send({ type: "lre.chip", chatId, chip: old.id, choice: "confirm" }));
      expect(Number(await rig.cashOf(chatId))).toBe(70);
      await reread(rig, chatId, headId);
      // The read it confirmed from is gone; the new read offers the purchase again.
      expect(await posts()).toBe(0);
      expect(Number(await rig.cashOf(chatId))).toBe(100);
      const fresh = await confirms();
      expect(fresh).toHaveLength(1);
      for (const c of fresh) rig.body(await rig.send({ type: "lre.chip", chatId, chip: c.id, choice: "confirm" }));
      expect(await posts()).toBe(1);
      expect(Number(await rig.cashOf(chatId))).toBe(70);
    });
  });

  test("learning counts on the user's real connection, and Settings reads it there", async () => {
    const rig = new Rig();
    rig.host.activeConnection = { id: "conn-ds", name: "Deepseek" };
    rig.host.quietReply = (req) => (req.messages[0]?.content.includes(EXTRACT_MARK) ? JSON.stringify({ proposals: [{ type: "condition", entity: POV, field: "cash", delta: 7 }] }) : "{}");
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "earn", "Dev slips you seven bucks.");
    const undo = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "undo");
    if (!undo) throw new Error("no undo chip");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: undo.id, choice: "undo" }));
    const learning = await rig.rt.settings.learningOf(rig.host.userId);
    expect(learning.connections["conn-ds"]?.condition?.rejected).toBe(1);
    expect(learning.connections.active).toBeUndefined();
    const result = rig.body(await rig.send({ type: "lre.settings.get" }));
    const view = isRecord(result.extraction) && isRecord(result.extraction.condition) ? result.extraction.condition : null;
    expect(view?.connection).toEqual({ id: "conn-ds", name: "Deepseek" });
    expect(view?.rejected).toBe(1);
  });

  test("the post phase keeps the user's deadline: 0 ms runs no post call (no 15 s floor)", async () => {
    const rig = new Rig();
    let extracts = 0;
    rig.host.quietReply = (req) => {
      if (req.messages[0]?.content.includes(EXTRACT_MARK)) extracts++;
      return "{}";
    };
    const chatId = await rig.worldChat();
    const settings = await rig.rt.settings.get(rig.host.userId);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { budgets: { post: { calls: settings.modelUse.budgets.post.calls, ms: 0 } } } } }));
    await rig.turn(chatId, "earn", "Dev slips you seven bucks.");
    expect(extracts).toBe(0);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("the interceptor fills the engine's slot entries from the fold", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const assembly = await rig.host.dryRun(chatId);
    expect(assembly.messages.some((m) => m.content.includes("[Scene]") && m.content.includes("Sam has $"))).toBe(true);
    expect(rig.host.lastInterceptor?.forced.length).toBeGreaterThan(0);
  });

  test("in a world chat your own books are left to native World Info, while the engine's sections still go in; the inspector shows them (dry runs don't enter it)", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    // A user book with a keyword entry, a disabled one and a constant one, attached to the chat.
    const userBook = await rig.host.books.create("My lore", "", rig.host.userId);
    const specs: [string, Partial<HostBookEntryInput>][] = [["The diner", {}], ["Old note", { disabled: true }], ["Always on", { constant: true, keys: [] }]];
    const mine = new Set<string>();
    for (const [comment, over] of specs) mine.add(await rig.host.books.createEntry(userBook, { comment, content: `${comment}.`, keys: ["diner"], disabled: false, constant: false, position: 0, depth: 4, role: null, order: 100, extensions: {}, ...over }, rig.host.userId));
    const meta = await rig.host.chats.chatMetadata(chatId, rig.host.userId);
    const ids = Array.isArray(meta.chat_world_book_ids) ? meta.chat_world_book_ids : [];
    await rig.host.chats.mergeChatMetadata(chatId, { chat_world_book_ids: [...ids, userBook] }, rig.host.userId);
    await rig.turn(chatId, "Let's go to the diner.", "Sure.");
    const result = rig.host.lastInterceptor;
    if (!result) throw new Error("no interceptor run");
    // No vote, force, enable or text for any of the user's entries.
    for (const list of [result.disabled, result.enabled, result.forced, result.mutated.map((m) => m.id)]) expect(list.filter((id) => mine.has(id))).toEqual([]);
    // Every section the engine filled is a slot entry, enabled, forced and given its text.
    const run = await rig.rt.runOf(chatId, rig.host.userId);
    const slots = await rig.rt.book.slotEntries((await rig.rt.worlds.index(run?.worldId ?? "", rig.host.userId))?.loreBookId ?? "", rig.host.userId);
    const scene = slots.get("scene") ?? "";
    expect(result.enabled).toContain(scene);
    expect(result.forced).toContain(scene);
    expect(result.mutated.find((m) => m.id === scene)?.content).toMatch(/^\[Scene\]\n/);
    expect(result.mutated.every((m) => [...slots.values()].includes(m.id) && result.enabled.includes(m.id) && result.forced.includes(m.id))).toBe(true);
    // Opening the inspector verifies slot delivery; a generation shows sections and the section budget only.
    const count = (rig.rt.inspectorRecords(chatId) ?? []).length;
    rig.body(await rig.send({ type: "lre.view.open", chatId, panel: "core.context", entity: null }));
    const panel = (await rig.rt.view(chatId, rig.host.userId)).panels["core.context"];
    if (!isRecord(panel) || !Array.isArray(panel.generations) || !Array.isArray(panel.warnings)) throw new Error("no inspector panel");
    const latest = panel.generations[0];
    if (!isRecord(latest) || !Array.isArray(latest.sections)) throw new Error("no record");
    expect("candidates" in latest).toBe(false);
    const shown = latest.sections.flatMap((s) => (isRecord(s) && s.clipped === false && typeof s.tokens === "number" ? [s.tokens] : []));
    expect(latest.budget).toEqual({ sections: 600, used: shown.reduce((sum, n) => sum + n, 0) });
    expect(latest.sections.some((s) => isRecord(s) && s.slot === "scene" && s.delivery === "verified")).toBe(true);
    expect(panel.warnings.some((w) => typeof w === "string" && /council|lore/i.test(w))).toBe(false);
    // Opening ran a dry-run assembly; it added nothing to the history.
    expect((rig.rt.inspectorRecords(chatId) ?? []).length).toBe(count);
  });

  test("opening the inspector leaves Outcome, Montage and Outline unchecked: a dry run plans nothing, so it can't show them", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await rig.turn(chatId, "I wait an hour on the porch.", "The street wakes up around you.");
    rig.body(await rig.send({ type: "lre.view.open", chatId, panel: "core.context", entity: null }));
    const panel = (await rig.rt.view(chatId, rig.host.userId)).panels["core.context"];
    const latest = isRecord(panel) && Array.isArray(panel.generations) ? panel.generations[0] : undefined;
    const sections = isRecord(latest) && Array.isArray(latest.sections) ? latest.sections.flatMap((s) => (isRecord(s) ? [s] : [])) : [];
    const turnOnly = sections.filter((s) => ["outcome", "montage", "outline"].includes(String(s.slot)) && s.clipped !== true);
    expect(turnOnly.length).toBeGreaterThan(0);
    expect(turnOnly.map((s) => s.delivery)).toEqual(turnOnly.map(() => "unchecked"));
    expect(sections.some((s) => s.slot === "scene" && s.delivery === "verified")).toBe(true);
  });

  test("settings merge-patch, preset expansion and effective extraction modes", async () => {
    const rig = new Rig();
    const set = rig.body(await rig.send({ type: "lre.settings.set", patch: { realism: { preset: "grounded" }, extraction: { purchase: { mode: "auto" } } } }));
    const settings = set.settings;
    if (!isRecord(settings) || !isRecord(settings.realism) || !isRecord(settings.realism.levels)) throw new Error("no settings");
    expect(settings.realism.levels.money).toBe(2);
    const extraction = set.extraction;
    if (!isRecord(extraction) || !isRecord(extraction.purchase) || !isRecord(extraction.regard)) throw new Error("no extraction view");
    expect(extraction.purchase.source).toBe("pinned");
    expect(extraction.regard.source).toBe("default");
    const unpinned = rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { purchase: null } } }));
    if (!isRecord(unpinned.extraction) || !isRecord(unpinned.extraction.purchase)) throw new Error("no extraction view");
    expect(unpinned.extraction.purchase.source).toBe("default");
  });

  test("the D32 preset lint: a JSON-ledger block and a small max tokens with a reasoning model show in Settings → Caveats and the inspector", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.activeChat = chatId;
    const ledger = "[Ledger] Gold: 10. Carrying 1 items; newest: torch.\nEnd every reply with the updated ledger as JSON ledger:\n<json>{\"gold\": 10}</json>";
    rig.host.preset = { name: "Default", blocks: [{ id: "b1", name: "Main", content: "You are the narrator." }, { id: "b2", name: "Ledger (JSON)", content: ledger }], maxTokens: 800, model: "deepseek-v4-flash" };
    const result = rig.body(await rig.send({ type: "lre.settings.get" }));
    const caveats = Array.isArray(result.caveats) ? result.caveats.filter(isRecord) : [];
    expect(caveats.map((c) => c.code)).toEqual(["preset_json_ledger", "preset_low_max_tokens"]);
    expect(String(caveats[0]?.message)).toContain("“Default” has an enabled block “Ledger (JSON)”");
    // Opening the inspector dry-runs the chat: the same caveats are its warnings.
    rig.body(await rig.send({ type: "lre.view.open", chatId, panel: "core.context", entity: null }));
    const panel = (await rig.rt.view(chatId, rig.host.userId)).panels["core.context"];
    if (!isRecord(panel) || !Array.isArray(panel.warnings)) throw new Error("no inspector panel");
    expect(panel.warnings.some((w) => typeof w === "string" && w.includes("Ledger (JSON)"))).toBe(true);
    // A clean preset: no caveats.
    rig.host.preset = { name: "Default", blocks: [{ id: "b1", name: "Main", content: "Never output JSON; write prose." }], maxTokens: 4000, model: "deepseek-v4-flash" };
    const clean = rig.body(await rig.send({ type: "lre.settings.get" }));
    expect(clean.caveats).toEqual([]);
  });

  test("a palette action appends a user message with its intent and triggers a turn", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const reply = await rig.send({ type: "lre.action", chatId, action: "missing.action", params: {}, source: "palette" });
    expect(reply.type).toBe("lre.error");
  });

  test("Build drafts survive a reload: get resumes the stored draft with its base; discard drops it; currency rides in meta", async () => {
    const rig = new Rig();
    const created = rig.body(await rig.send({ type: "lre.world", op: "create", name: "Coins", template: "test" }));
    if (!isRecord(created.world) || typeof created.world.id !== "string") throw new Error("no world");
    const worldId = created.world.id;
    const fresh = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
    expect(fresh.stored).toBe(false);
    if (!isRecord(fresh.draft) || !isRecord(fresh.draft.currency)) throw new Error("no currency");
    expect(fresh.draft.currency.code).toBe("USD");
    const coins = { code: "SP", symbol: "sp", minorUnit: "copper", decimals: 2, format: "{sign}{major} sp {minor} cp" };
    rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: fresh.base, part: "meta", value: { currency: coins } }));
    const resumed = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
    expect(resumed.stored).toBe(true);
    expect(resumed.base).toBe(fresh.base);
    if (!isRecord(resumed.draft)) throw new Error("no draft");
    expect(resumed.draft.currency).toEqual(coins);
    const dropped = rig.body(await rig.send({ type: "lre.editor", op: "discard", worldId, base: null }));
    expect(dropped.stored).toBe(false);
    expect(formatMoney(12345, coins)).toBe("123 sp 45 cp");
    expect(formatMoney(-123456, DEFAULT_CURRENCY)).toBe("-$1,234.56");
  });
});

describe("time spans", () => {
  test("a span reads in days, hours or minutes, never 43200 min", () => {
    expect(spanText(43200)).toBe("30 days");
    expect(spanText(1440)).toBe("1 day");
    expect(spanText(150)).toBe("2.5 hours");
    expect(spanText(45)).toBe("45 min");
    // Chip labels: "Timelapse to 07:00 (8 h 55 min)?"
    expect(compactSpan(535)).toBe("8 h 55 min");
    expect(compactSpan(4560)).toBe("3 d 4 h");
    expect(compactSpan(120)).toBe("2 h");
  });
});

describe("Keep report chip", () => {
  test("a dropped group is one row: its payment's line leads, its unseen member counts as a linked change", () => {
    const rig = new Rig();
    const world = testWorld();
    const state = initialState(world, "r", rig.rt.registry);
    const dev = state.entities.dev;
    if (!dev) throw new Error("no dev");
    state.entities.ghost = { ...structuredClone(dev), name: "The Ghost", fields: { visibility: "secret" } };
    const rec: Rec = { v: 1, defHash: "r", seq: 1, swipeHash: { len: 0, hash: "" }, path: "p", seed: "s", pre: 0, events: [{ type: "set", entity: "ghost", field: "mood", value: "paid", group: "g1" }, { type: "add", entity: POV, field: "cash", delta: -84, group: "g1" }], post: [], markersApplied: 0, status: "ok", undone: [], intents: {} };
    const out = playerDrops(rig.rt.registry, world, state, (id) => (id === "m1" ? rec : null), [], [
      { messageId: "m1", parentPath: "p", ref: { in: "events", index: 0 }, status: "dropped", text: "x" },
      { messageId: "m1", parentPath: "p", ref: { in: "events", index: 1 }, status: "dropped", text: "y" },
    ]);
    expect(out.keep.map((k) => k.group)).toEqual(["g1", "g1"]);
    const lead = out.keep[1]?.text ?? "";
    expect(lead).not.toBe(UNSEEN_DROP);
    expect(out.keep.map((k) => k.text)).toEqual([lead, lead]);
    expect(keepSummary(out.keep)).toEqual({ count: 1, detail: `dropped: ${lead} (2 linked changes)` });
  });

  test("the Journal lists a dropped group once, led by its payment's line, with its linked changes counted", () => {
    const rig = new Rig();
    const world = testWorld();
    const state = initialState(world, "r", rig.rt.registry);
    const dev = state.entities.dev;
    if (!dev) throw new Error("no dev");
    state.entities.ghost = { ...structuredClone(dev), name: "The Ghost", fields: { visibility: "secret" } };
    const rec: Rec = { v: 1, defHash: "r", seq: 1, swipeHash: { len: 0, hash: "" }, path: "p", seed: "s", pre: 0, events: [{ type: "set", entity: "ghost", field: "mood", value: "paid", group: "g1" }, { type: "add", entity: POV, field: "cash", delta: -84, group: "g1" }, { type: "add", entity: POV, field: "cash", delta: -5 }], post: [], markersApplied: 0, status: "ok", undone: [], intents: {} };
    const out = playerDrops(rig.rt.registry, world, state, (id) => (id === "m1" ? rec : null), [
      { kind: "dropped", messageId: "m1", ref: { in: "events", index: 0 }, text: "x" },
      { kind: "dropped", messageId: "m1", ref: { in: "events", index: 1 }, text: "y" },
      { kind: "dropped", messageId: "m1", ref: { in: "events", index: 2 }, text: "z" },
      { kind: "inert", messageId: "m1", ref: { marker: 3 }, text: "made on another branch" },
    ], [
      { messageId: "m1", parentPath: "p", ref: { in: "events", index: 0 }, status: "dropped", text: "x" },
      { messageId: "m1", parentPath: "p", ref: { in: "events", index: 1 }, status: "dropped", text: "y" },
    ]);
    const lead = out.keep[0]?.text ?? "";
    expect(lead).not.toBe(UNSEEN_DROP);
    expect(out.notes.map((n) => [n.kind, n.text])).toEqual([
      ["dropped", `${lead} (2 linked changes)`],
      ["dropped", out.notes[1]?.text ?? ""],
      ["inert", "made on another branch"],
    ]);
    expect(out.notes[1]?.text).not.toBe(lead);
    expect(out.notes[1]?.text).not.toBe(UNSEEN_DROP);
  });

  test("a group's members failing with one reason collapse into one counted line", () => {
    const lines = [
      { status: "dropped", text: "Your wallet cash can't cover $165.00" },
      { status: "dropped", text: "Your wallet cash can't cover $165.00" },
      { status: "inert", text: "Bought a latte" },
    ];
    expect(keepSummary(lines)).toEqual({ count: 2, detail: "dropped: Your wallet cash can't cover $165.00 (2 linked changes)\ninert: Bought a latte" });
  });

  test("drop notes and Keep lines never show a validator's reason: a visible event reads as its line, a hidden one neutrally", () => {
    const rig = new Rig();
    const world = testWorld();
    const state = initialState(world, "r", rig.rt.registry);
    const dev = state.entities.dev;
    if (!dev) throw new Error("no dev");
    state.entities.ghost = { ...structuredClone(dev), name: "The Ghost", fields: { visibility: "secret" } };
    const rec: Rec = { v: 1, defHash: "r", seq: 1, swipeHash: { len: 0, hash: "" }, path: "p", seed: "s", pre: 0, events: [{ type: "add", entity: POV, field: "cash", delta: -5 }, { type: "set", entity: "ghost", field: "mood", value: "restless" }], post: [], markersApplied: 0, status: "ok", undone: [], intents: {} };
    const leak = "Sam's wallet at The Secret Vault can't cover $5";
    const out = playerDrops(rig.rt.registry, world, state, (id) => (id === "m1" ? rec : null), [
      { kind: "dropped", messageId: "m1", ref: { in: "events", index: 0 }, text: leak },
      { kind: "dropped", messageId: "m1", ref: { in: "events", index: 1 }, text: "The Ghost can't haunt The Secret Vault" },
      { kind: "inert", messageId: "m1", ref: { marker: 3 }, text: "made on another branch" },
    ], [
      { messageId: "m1", parentPath: "p", ref: { in: "events", index: 1 }, status: "dropped", text: "The Ghost can't haunt The Secret Vault" },
      { messageId: "m1", parentPath: "p", ref: { marker: 3 }, status: "converted", text: "The Secret Vault stays" },
    ]);
    const shown = JSON.stringify(out);
    expect(shown).not.toContain("Secret Vault");
    expect(shown).not.toContain("Ghost");
    expect(out.notes[0]?.text).not.toBe(UNSEEN_DROP);
    expect(out.notes[1]?.text).toBe(UNSEEN_DROP);
    expect(out.notes[2]?.text).toBe("made on another branch");
    expect(out.keep.map((k) => k.text)).toEqual([UNSEEN_DROP, UNSEEN_DROP]);
  });
});

describe("proposal labels", () => {
  test("a sheets condition reads 'who: condition' (the undo chip once said '? ? ?')", () => {
    const world = testWorld();
    const state = initialState(world, "r", registryOf());
    expect(describeProposal({ type: "condition", who: "dev", condition: "injured" }, world, state)).toBe("Dev: injured");
    expect(describeProposal({ type: "condition", condition: "tired", clear: true }, world, state)).toBe("you: no longer tired");
  });

  test("a transfer chip states the sum the transfer moves: cents as minor units, else the converted amount", () => {
    const world = testWorld();
    const state = initialState(world, "r", registryOf());
    expect(describeProposal({ type: "transfer", from: world.pov, to: "dev", cents: 1500 }, world, state)).toBe("Paid $15.00 to Dev");
    expect(describeProposal({ type: "transfer", from: world.pov, to: "dev", amount: 2000 }, world, state)).toBe("Paid $20.00 to Dev");
    expect(describeProposal({ type: "transfer", from: world.pov, to: "dev", amount: 2000, cents: 20 }, world, state)).toBe("Paid $0.20 to Dev");
  });
});

describe("Scene slot", () => {
  test("the Scene slot states the turn's elapsed time (DESIGN §9.2)", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    const scene = rig.host.lastInterceptor?.mutated.find((m) => m.content?.startsWith("[Scene]"))?.content ?? "";
    expect(scene).toMatch(/This turn took \d+ min\./);
    await rig.host.finish(g, "Quiet.");
  });
});


describe("typed timelapse", () => {
  const reply = (params: Record<string, unknown>) => (req: { messages: { content: string }[] }) => (req.messages[0]?.content.includes("You map a player's typed input") ? JSON.stringify({ action: TIMELAPSE_ACTION, params, confidence: 0.9 }) : "{}");
  const clockOf = async (rig: Rig, chatId: string): Promise<number> => (await rig.rt.ledger.core(chatId, rig.host.userId))?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state.clock ?? 0;

  test("'until the next morning' runs as the turn's timelapse", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const before = await clockOf(rig, chatId);
    rig.host.quietReply = reply({ until: "morning" });
    await rig.turn(chatId, "I go to bed and sleep until the next morning.", "Morning light.");
    expect((await clockOf(rig, chatId)) - before).toBeGreaterThan(20 * 60);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("three days is offered as a chip, not run", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const before = await clockOf(rig, chatId);
    rig.host.quietReply = reply({ minutes: 4320 });
    await rig.turn(chatId, "I wait for three days.", "You settle in.");
    const offer = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "timelapse_offer");
    expect(offer?.label).toBe("Timelapse 3 d?");
    expect((await clockOf(rig, chatId)) - before).toBeLessThan(60);
  });

  test("a time span after the action ('…and sleep until the next morning') is read too", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const before = await clockOf(rig, chatId);
    // No action matched, only the trailing time: it runs as the turn's timelapse.
    rig.host.quietReply = (req) => (req.messages[0]?.content.includes("You map a player's typed input") ? JSON.stringify({ action: null, params: {}, confidence: 0.8, then: { until: "morning" } }) : "{}");
    await rig.turn(chatId, "I head home and sleep until the next morning.", "Morning light.");
    expect((await clockOf(rig, chatId)) - before).toBeGreaterThan(20 * 60);
  });

  test("'the next morning' 46 min before morning starts sleeps a night, not 46 min", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.quietReply = reply({ until: "morning" });
    await rig.turn(chatId, "I wait until morning.", "Morning.");
    const morning = await clockOf(rig, chatId);
    rig.host.quietReply = reply({ minutes: 1440 - 46 });
    await rig.turn(chatId, "I wait a long while.", "Time passes.");
    const before = await clockOf(rig, chatId);
    expect(morning + 1440 - before).toBeLessThanOrEqual(46 + 15);
    // The model drops the "next": the player's text keeps it.
    rig.host.quietReply = reply({ until: "morning" });
    await rig.turn(chatId, "I roll out my sleeping bag on the beach and sleep until the next morning.", "Morning light.");
    expect((await clockOf(rig, chatId)) - before).toBeGreaterThan(20 * 60);
  });

  test("an unmet requirement reads for the player in a decline chip", () => {
    expect(playerReason({ code: "requirement", reason: "requires to != here", requirement: "to != here" })).toBe("You're already there.");
    expect(playerReason({ code: "requirement", reason: "requires at(kitchen)" })).toBe("Not possible here and now: it has to be here.");
    expect(playerReason({ code: "requirement", reason: "requires item.owner == self", requirement: "item.owner == self" })).toBe("Not possible here and now: it isn't yours.");
    expect(playerReason({ code: "requirement", reason: "requires weird_thing()" })).toBe("Not possible here and now.");
    expect(playerReason({ code: "declined", reason: "Sam can't afford $90" })).toBe("Sam can't afford $90");
  });
});
describe("palette on the shipped packs", () => {
  test("Attempt lists one option per stat with its odds; unmet requirements read for the player", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Hollow", "fantasy_town");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const palette = (await rig.rt.view(chatId, rig.host.userId)).palette;
    const attempt = palette?.entries.find((e) => e.action === "attempt");
    expect(attempt?.options.length).toBeGreaterThan(1);
    expect(attempt?.options.every((o) => typeof o.params.stat === "string" && (o.odds?.length ?? 0) > 0)).toBe(true);
    expect(palette?.entries.flatMap((e) => e.options).some((o) => o.disabled?.startsWith("requires "))).toBe(false);
    // Build's kind pickers see the packs' kinds (container, vehicle, account …) with their fields.
    const got = rig.body(await rig.send({ type: "lre.world", op: "get", worldId }));
    const kinds = isRecord(got.packKinds) ? got.packKinds : {};
    expect(isRecord(kinds.container) && kinds.container.pack).toBe("gear");
    expect(isRecord(kinds.vehicle) && isRecord(kinds.vehicle.fields)).toBe(true);
    // A realism preview names the domain and reads the level at the scope it changes.
    const preview = rig.body(await rig.send({ type: "lre.marker", chatId, preview: true, kind: "resolve", domain: "castlife", scope: { tier: "background" }, to: 0 }));
    expect(JSON.stringify(preview.preview)).toContain("Cast life for background characters drops from level");
  });

  test("an action with a second required ref nests it: Drive lists vehicles, each with destinations", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const entries = (await rig.rt.view(chatId, rig.host.userId)).palette?.entries ?? [];
    const nested = entries.flatMap((e) => e.options).filter((o) => o.next);
    expect(nested.length).toBeGreaterThan(0);
    for (const o of nested) {
      expect(o.disabled).toBeUndefined();
      expect(o.next?.options.length).toBeLessThanOrEqual(12);
      expect(o.next?.options.every((n) => Object.keys(n.params).length === 1 && n.params[o.next?.param ?? ""] !== undefined)).toBe(true);
    }
    // Lend's days is a number input, so its picks aren't all blocked for want of it.
    const lend = entries.find((e) => e.action === "lend");
    expect(lend?.number).toEqual({ param: "days", label: "Days", min: 1, max: null, default: 1 });
    // An optional number no requirement reads (Buy's qty) gets no input.
    expect(entries.find((e) => e.action === "buy")?.number).toBeUndefined();
    // A step without its own label takes its ref kind's ("Person"), never the param name ("to").
    expect(lend?.options.find((o) => o.next)?.next?.label).not.toBe("to");
    // Pay and Invest are judged with a nominal amount: no target is blocked for want of one.
    expect(entries.filter((e) => e.amount).flatMap((e) => e.options.flatMap((o) => [o, ...(o.next?.options ?? [])])).some((o) => o.disabled?.includes("needs amount"))).toBe(false);
  });

  test("a typed lend with only an end ('until 7 tonight') lends until 19:00; the palette's days still work", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.host.quietReply = (req) => (req.messages[0]?.content.includes("You map a player's typed input") ? JSON.stringify({ action: "lend", params: { item: "pov_truck", to: "danny_okafor", until: "7 tonight" }, confidence: 0.9 }) : "{}");
    await rig.turn(chatId, "I lend Danny my truck until 7 tonight.", "Danny grins and takes the keys.");
    const loanOf = async (borrower: string, thing: string): Promise<number | undefined> => {
      const core = await rig.rt.ledger.core(chatId, rig.host.userId);
      const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
      return state?.entities[borrower]?.relations.find((r) => r.type === "uses" && r.to === thing)?.until;
    };
    const view = await rig.rt.view(chatId, rig.host.userId);
    expect(view.chips.map((c) => c.detail ?? c.label).join(" | ")).not.toContain("needs");
    const until = await loanOf("danny_okafor", "pov_truck");
    // The world starts Monday 06:15: 7 tonight is 19:00 the same day.
    expect(until !== undefined && until % 1440).toBe(19 * 60);
    // The palette sends days: one day from now, as before.
    const clock = Number(view.hud?.clock.minutes);
    rig.body(await rig.send({ type: "lre.action", chatId, action: "lend", params: { item: "pov_atv", to: "danny_okafor", days: 1 }, source: "palette" }));
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "Danny nods.");
    const atv = await loanOf("danny_okafor", "pov_atv");
    expect(atv !== undefined && atv - clock).toBeGreaterThanOrEqual(1440);
    expect(atv !== undefined && atv - clock).toBeLessThan(1440 + 60);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a narrated give of what the turn lent (or of something inside it) folds into the loan; a distinct give to the same person stays", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { give: { mode: "confirm" } } } }));
    const give = (item: string) => ({ type: "give", item, from: "pov", to: "danny_okafor" });
    rig.host.quietReply = (req) => {
      const prompt = req.messages[0]?.content ?? "";
      if (prompt.includes("You map a player's typed input")) return JSON.stringify({ action: "lend", params: { item: "pov_truck", to: "danny_okafor", days: 1 }, confidence: 0.9 });
      if (prompt.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: [give("pov_truck"), give("pov_truck_glovebox"), give("pov_watch")] });
      return "{}";
    };
    await rig.turn(chatId, "I lend Danny my truck for the day and give him my old watch.", "You hand Danny the truck and, on a whim, your old wristwatch.");
    const view = await rig.rt.view(chatId, rig.host.userId);
    const said = view.chips.filter((c) => c.kind === "confirm").map((c) => `${c.label} ${c.detail ?? ""}`).join(" | ");
    expect(said).toContain("Wristwatch");
    expect(said).not.toContain("Your pickup");
    expect(said).not.toContain("glovebox");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a reply that tells the turn's own Buy again offers no second purchase; a different thing bought in the same reply still gets its chip", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.host.quietReply = (req) => {
      const prompt = req.messages[0]?.content ?? "";
      if (prompt.includes("You map a player's typed input")) return JSON.stringify({ action: "buy", params: { item: "old brass ship's lantern", price: 84, method: "cash" }, confidence: 0.9 });
      if (prompt.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: [{ type: "purchase", item: "brass ship's lantern", category: "household", payer: "pov", price: 84, method: "cash" }, { type: "purchase", item: "box of matches", category: "household", payer: "pov", price: 0.5 }] });
      return "{}";
    };
    await rig.turn(chatId, "I buy the old brass ship's lantern and pay her $84 in cash.", "Tessa wraps the brass ship's lantern; you pay her $84 in cash and pocket a box of matches for fifty cents.");
    const view = await rig.rt.view(chatId, rig.host.userId);
    const offered = view.chips.filter((c) => c.kind === "confirm" || c.kind === "decline").map((c) => `${c.label} ${c.detail ?? ""}`);
    expect(offered.filter((t) => t.includes("lantern"))).toEqual([]);
    expect(offered.some((t) => t.includes("matches"))).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

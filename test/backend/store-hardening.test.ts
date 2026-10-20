// Stored files that are damaged inside: wrong-typed chips are dropped, set-aside copies never
// overwrite each other, a journal with junk entries is set aside and the player told, a damaged
// record on a message is skipped and the player told, and metadata writes never loop.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import { runDir } from "../../src/shared/ids";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import { journalPath, REASSERTS_PER_LEDGER } from "../../src/backend/ledger-io";
import { CORRUPT_SUFFIX, readStoredJson } from "../../src/backend/stored-json";
import { FakeHost } from "../support/fake-host";
import { Rig } from "../support/rig";

describe("stored chips", () => {
  test("a chips.json entry with a wrong-typed field is dropped; the good one reaches the view", async () => {
    const rig = new Rig();
    const user = rig.host.userId;
    const worldId = await rig.newWorld();
    const chatId = rig.host.createChat("Morning, Sam.");
    const messageId = (await rig.host.chats.messages(chatId, user))[0]?.id ?? "";
    const good = { id: "decline:good", kind: "decline", messageId, label: "Buy: declined", detail: "No money.", actions: [], expires: "next_send", payload: {} };
    const bad = [
      { ...good, id: "decline:actions", actions: "no" },
      { ...good, id: "decline:label", label: 5 },
      { ...good, id: "decline:action", actions: [{ id: "x", label: 3 }] },
      { ...good, id: "decline:message", messageId: 7 },
      { ...good, id: "decline:expires", expires: "later" },
      { ...good, id: "decline:detail", detail: ["x"] },
      { ...good, id: "decline:swipe", swipeId: "0" },
    ];
    await rig.host.storage.write(`${runDir(chatId)}chips.json`, JSON.stringify([...bad, good]), user);
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const view = await rig.rt.view(chatId, user);
    const ids = view.chips.map((c) => c.id);
    expect(ids).toContain("decline:good");
    for (const b of bad) expect(ids).not.toContain(b.id);
  });
});

describe("set-aside files", () => {
  test("two set-asides of the same path keep both damaged copies", async () => {
    const host = new FakeHost();
    const user = host.userId;
    const path = "settings.json";
    await host.storage.write(path, "{\"v\":1,", user);
    await readStoredJson(host, path, user, "settings", () => true);
    await host.storage.write(path, "[\"second\"", user);
    await readStoredJson(host, path, user, "settings", () => true);
    const kept = (await host.storage.list("", user)).filter((p) => p.startsWith(`${path}${CORRUPT_SUFFIX}`)).sort();
    expect(kept.length).toBe(2);
    expect(await Promise.all(kept.map((p) => host.storage.read(p, user)))).toEqual(["{\"v\":1,", "[\"second\""]);
    expect(await host.storage.read(path, user)).toBeNull();
  });
});

describe("a journal with junk inside", () => {
  const junk: [string, Record<string, unknown>][] = [
    ["a null pending turn", { pending: { g: null } }],
    ["a number held write", { held: [5] }],
    ["a held write of no known kind", { held: [{ write: { kind: "launch", id: "h1" }, waitFor: [] }] }],
    ["a number pause", { pauses: [7] }],
    ["an empty tombstone", { tombstones: [{}] }],
    ["a null chain entry", { chain: [null] }],
    ["a number message", { messages: { m1: 5 } }],
    ["a number window", { windows: [3] }],
  ];
  for (const [name, patch] of junk) {
    test(`${name}: the chat opens on a fresh journal, the file is set aside and the player is told`, async () => {
      const rig = new Rig();
      const user = rig.host.userId;
      const chatId = await rig.worldChat();
      await rig.turn(chatId, "I look around.", "Quiet.");
      const path = journalPath(chatId);
      const stored = JSON.parse((await rig.host.storage.read(path, user)) ?? "null") as Record<string, unknown>;
      const text = JSON.stringify({ ...stored, ...patch });
      await rig.host.storage.write(path, text, user);
      rig.rt.ledger.forget(chatId);
      await rig.turn(chatId, "I wait.", "Still quiet.");
      expect(rig.rt.ledger.errors).toEqual([]);
      const journal = (await rig.rt.ledger.core(chatId, user))?.journal;
      expect(journal?.pending).toEqual({});
      expect(journal?.held).toEqual([]);
      const kept = (await rig.host.storage.list(path, user)).filter((p) => p.startsWith(`${path}${CORRUPT_SUFFIX}`));
      expect(await Promise.all(kept.map((p) => rig.host.storage.read(p, user)))).toEqual([text]);
      const context = (await rig.rt.view(chatId, user)).panels["core.context"] as { warnings: string[] };
      expect(context.warnings.some((w) => w.includes("journal") && w.includes(kept[0] ?? "?"))).toBe(true);
    });
  }
});

/** Mutations of one stored turn record (the reply's swipe 0) or its message's ledger. */
type LedgerPatch = (ledger: { swipes: Record<string, Record<string, unknown>>; markers: unknown[] }, rec: Record<string, unknown>) => void;

const recordDamage: [string, LedgerPatch][] = [
  ["a record without undone", (_, rec) => delete rec.undone],
  ["a record whose undone is a number", (_, rec) => (rec.undone = 5)],
  ["a record whose swipeHash is null", (_, rec) => (rec.swipeHash = null)],
  ["a record whose events hold a number", (_, rec) => (rec.events = [5])],
  ["a record whose post entry has no seq", (_, rec) => (rec.post = [{ at: "x", kind: "fix", events: [] }])],
];

/** A chat with one turn, its metadata writes counted from now on. */
async function playedChat(): Promise<{ rig: Rig; chatId: string; replyId: string; writes: () => number }> {
  const rig = new Rig();
  const chatId = await rig.worldChat();
  await rig.turn(chatId, "I look around.", "Quiet.");
  const replyId = rig.host.chat(chatId).messages.findLast((m) => !m.isUser)?.id ?? "";
  let count = 0;
  const write = rig.host.chats.writeMetadata;
  rig.host.chats.writeMetadata = async (...args) => {
    count++;
    await write(...args);
  };
  return { rig, chatId, replyId, writes: () => count };
}

describe("a journal message with a damaged entry", () => {
  const damage: [string, LedgerPatch][] = [
    ["a marker whose body fails the marker check", (ledger) => ledger.markers.push({ kind: "resolve", domain: "nowhere", scope: { all: true }, to: 9, seq: 1, at: null })],
    ["a swipe key that isn't a swipe index", (ledger, rec) => (ledger.swipes.x = structuredClone(rec))],
    ...recordDamage,
  ];
  for (const [name, patch] of damage) {
    test(`${name}: the journal is set aside, the player told, and metadata writes stay bounded`, async () => {
      const { rig, chatId, replyId, writes } = await playedChat();
      const user = rig.host.userId;
      const path = journalPath(chatId);
      const stored = JSON.parse((await rig.host.storage.read(path, user)) ?? "null") as { messages: Record<string, { ledger: Parameters<LedgerPatch>[0] }> };
      const ledger = stored.messages[replyId]?.ledger;
      const rec = ledger?.swipes["0"];
      if (!ledger || !rec) throw new Error("no stored record");
      patch(ledger, rec);
      const text = JSON.stringify(stored);
      await rig.host.storage.write(path, text, user);
      rig.rt.ledger.forget(chatId);
      await rig.turn(chatId, "I wait.", "Still quiet.");
      expect(rig.rt.ledger.errors).toEqual([]);
      expect(writes()).toBeLessThan(10);
      const kept = (await rig.host.storage.list(path, user)).filter((p) => p.startsWith(`${path}${CORRUPT_SUFFIX}`));
      expect(await Promise.all(kept.map((p) => rig.host.storage.read(p, user)))).toEqual([text]);
      const context = (await rig.rt.view(chatId, user)).panels["core.context"] as { warnings: string[] };
      expect(context.warnings.some((w) => w.includes("journal") && w.includes(kept[0] ?? "?"))).toBe(true);
    });
  }
});

describe("a damaged record in message metadata (an imported or forked chat)", () => {
  for (const [name, patch] of recordDamage) {
    test(`${name}: the record is skipped, the chat plays on and the player is told`, async () => {
      const { rig, chatId, replyId } = await playedChat();
      const user = rig.host.userId;
      const reply = rig.host.chat(chatId).messages.find((m) => m.id === replyId);
      const ledger = structuredClone(reply?.bag[LEDGER_NAMESPACE]) as Parameters<LedgerPatch>[0] | undefined;
      const rec = ledger?.swipes["0"];
      if (!reply || !ledger || !rec) throw new Error("no stored record");
      patch(ledger, rec);
      // The chat arrives with its records on its messages and no journal.
      reply.bag = { ...reply.bag, [LEDGER_NAMESPACE]: ledger as unknown as JsonObject };
      rig.host.files.delete(`${user}/${journalPath(chatId)}`);
      rig.rt.ledger.forget(chatId);
      const view = await rig.rt.view(chatId, user);
      expect(view.status).not.toBe("not_world");
      await rig.turn(chatId, "I wait.", "Still quiet.");
      expect(rig.rt.ledger.errors).toEqual([]);
      const journal = (await rig.rt.ledger.core(chatId, user))?.journal;
      expect(journal?.messages[replyId]?.ledger.swipes["0"]).toBeUndefined();
      const context = (await rig.rt.view(chatId, user)).panels["core.context"] as { warnings: string[] };
      expect(context.warnings.some((w) => w.includes(replyId) && w.includes("damaged"))).toBe(true);
    });
  }

  test("the journal's copy of a record damaged on its message is written back", async () => {
    const { rig, chatId, replyId } = await playedChat();
    const user = rig.host.userId;
    const reply = rig.host.chat(chatId).messages.find((m) => m.id === replyId);
    const good = structuredClone(reply?.bag[LEDGER_NAMESPACE] ?? null);
    const ledger = structuredClone(good) as Parameters<LedgerPatch>[0] | undefined;
    const rec = ledger?.swipes["0"];
    if (!reply || !ledger || !rec) throw new Error("no stored record");
    delete rec.undone;
    reply.bag = { ...reply.bag, [LEDGER_NAMESPACE]: ledger as unknown as JsonObject };
    // Found when the chat is next opened (the engine was off while it was written).
    rig.rt.ledger.forget(chatId);
    await rig.rt.ledger.open(chatId, user);
    await rig.host.settle();
    expect(rig.rt.ledger.errors).toEqual([]);
    expect(reply.bag[LEDGER_NAMESPACE]).toEqual(good);
  });
});

describe("metadata writes never loop", () => {
  test("a journal ledger part the metadata reader drops is written once, not re-asserted forever", async () => {
    const { rig, chatId, replyId, writes } = await playedChat();
    const user = rig.host.userId;
    const jm = (await rig.rt.ledger.core(chatId, user))?.journal.messages[replyId];
    if (!jm) throw new Error("no journal message");
    jm.ledger.markers.push({ kind: "resolve", domain: "nowhere", scope: { all: true }, to: 9, seq: 1, at: null } as unknown as (typeof jm.ledger.markers)[number]);
    jm.flushed = false;
    await rig.rt.ledger.open(chatId, user);
    await rig.host.settle();
    expect(rig.rt.ledger.errors).toEqual([]);
    expect(writes()).toBe(1);
  });

  test(`a host that keeps dropping the engine's ledger gets at most ${REASSERTS_PER_LEDGER} re-asserts`, async () => {
    const { rig, chatId, replyId, writes } = await playedChat();
    const write = rig.host.chats.writeMetadata;
    rig.host.chats.writeMetadata = async (c, m, bag, u) => {
      const { [LEDGER_NAMESPACE]: _dropped, ...rest } = bag;
      await write(c, m, rest, u);
    };
    rig.host.clobberForeign(chatId, replyId);
    await rig.host.settle();
    expect(rig.rt.ledger.errors).toEqual([]);
    expect(writes()).toBe(REASSERTS_PER_LEDGER);
  });
});

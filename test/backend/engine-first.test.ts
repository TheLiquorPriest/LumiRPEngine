// Engine first (DESIGN §5.1): the guard stops a generation the engine hasn't prepared; the engine
// run plans the turn and writes its sections into the world's book; the frontend starts the reply
// again and the guard lets it through, with every outlet filled. Any enabled step that fails halts
// the run: nothing is generated, and the chat says what failed and why, with a Retry that asks only
// what failed. A transient provider error is asked again first. The entries are emptied once the
// reply ends, and a turn the chat changed under is never used. Dry runs change nothing.

import { describe, expect, test } from "bun:test";
import type { HostPresetBlock, QuietRequest } from "../../src/backend/host";
import { isRecord, type JsonObject } from "../../src/shared/json";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import { placeOfEntity } from "../../src/engine/scope";
import { toChain } from "../../src/backend/ledger-io";
import { Rig } from "../support/rig";

const block = (name: string, content: string): HostPresetBlock => ({ id: `b_${name}`, name, content, enabled: true, marker: null, injectionTrigger: [], characterTagTrigger: [], categoryMode: null });
const MIND = /You are the private mind of (.+?) in the roleplay world/;

/** The world's engine entries that hold text or are on, as the host stores them. */
async function liveEntries(rig: Rig, chatId: string) {
  const run = await rig.rt.runOf(chatId, rig.host.userId);
  const bookId = (await rig.rt.worlds.index(run?.worldId ?? "", rig.host.userId))?.loreBookId ?? "";
  return (await rig.host.books.entries(bookId, rig.host.userId)).filter((e) => isRecord(e.extensions[LEDGER_NAMESPACE]) && (!e.disabled || e.content !== ""));
}

/** A chat in a world whose one action is a checked coin flip, so a turn has an Outcome. */
async function coinChat(rig: Rig): Promise<string> {
  const worldId = await rig.newWorld("Coins");
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "checks", id: "coin_flip", value: { id: "coin_flip", dice: "1d2", bands: [{ outcome: "fail", max: 1 }, { outcome: "success", min: 2 }] } }));
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "actions", id: "flip_coin", value: { id: "flip_coin", label: "Flip a coin", params: {}, requires: [], check: "coin_flip", outcomes: { success: [], fail: [] }, duration: "1", lexicon: ["flip a coin"] } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning, Sam.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return chatId;
}

/** A Port Alder chat where Danny and Priya are with the POV, the only Live minds. */
async function alderChat(rig: Rig): Promise<string> {
  const people = ["danny_okafor", "priya_nair"];
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "minds", value: { thresholds: { live: 900, near: 900, far: 900 }, always: { ids: people } } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { refreshLimit: 0 } } }));
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  const here = state ? placeOfEntity(state, "pov") : null;
  if (!here) throw new Error("the POV is nowhere");
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: people.map((entity) => ({ op: "move", entity, to: here })) }));
  return chatId;
}

/** A mind's answer naming them, and nothing for every other step. */
function mindAnswer(req: QuietRequest): string {
  const mind = MIND.exec(req.messages[0]?.content ?? "")?.[1];
  if (mind) return JSON.stringify({ monologue: `${mind} thinks.`, depiction: `${mind} leans on the counter`, intent: `${mind} means to talk`, reactions: [], plans: [], mood: "calm" });
  return JSON.stringify({ notes: [], commitments: [], resolved: [], plans: [], told: [], proposals: [] });
}

const mindsAsked = (calls: readonly QuietRequest[]): string[] => calls.flatMap((c) => MIND.exec(c.messages[0]?.content ?? "")?.[1] ?? []).sort();

/** The chat's failed-engine flag, as the view shows it. */
async function flagOf(rig: Rig, chatId: string): Promise<JsonObject | undefined> {
  const view = await rig.rt.view(chatId, rig.host.userId);
  const flag = view.chips.find((c) => c.kind === "engine_failed");
  return flag ? (JSON.parse(JSON.stringify(flag)) as JsonObject) : undefined;
}

describe("engine first", () => {
  test("a Send is stopped, the engine runs, and the reply it restarts holds the sections at every outlet the preset places", async () => {
    const rig = new Rig();
    const chatId = await coinChat(rig);
    rig.host.presetBlocks = [block("Story", "{{outlet::lre_scene}}\n{{outlet::lre_outcome}}")];
    rig.body(await rig.send({ type: "lre.action", chatId, action: "flip_coin", params: {}, source: "palette" }));
    const first = await rig.host.begin(chatId, { type: "normal" });
    // Stopped before its prompt; the engine ran and asked the frontend to start the reply again.
    expect(first.halted).toBe("cancelled");
    expect(rig.host.assembled).toEqual([]);
    expect(rig.host.restarts).toEqual([{ chatId, as: "regenerate" }]);
    const reply = await rig.host.begin(chatId, { type: "regenerate" });
    expect(reply.halted).toBeUndefined();
    expect(reply.type).toBe("normal");
    const at = (outlet: string) => rig.host.assembled.find((e) => e.position === 8 && e.outlet === outlet)?.content ?? "";
    expect(at("lre_scene")).toMatch(/^\[Scene\]\n/);
    expect(at("lre_outcome")).toMatch(/^\[Outcome\]\n- Flip a coin: (success|fail) \(rolled [12] on 1d2\)/);
    await rig.host.finish(reply, "The coin lands.");
    // The reply took the plan, and once it ended no engine entry holds text or is on.
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    expect(core?.journal.messages[reply.messageId ?? ""]?.ledger.swipes["0"]?.status).toBe("ok");
    expect(await liveEntries(rig, chatId)).toEqual([]);
  });

  test("a failed mind halts the run: nothing is generated, the book is emptied, and the flag says whose mind and why, with Retry and Diagnostics", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig);
    rig.host.quietReply = (req) => {
      if (MIND.exec(req.messages[0]?.content ?? "")?.[1] === "Priya Nair") throw new Error("invalid api key");
      return mindAnswer(req);
    };
    const said = rig.host.sendUser(chatId, "Hello.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    expect(g.halted).toBe("cancelled");
    expect(rig.host.restarts).toEqual([]);
    expect(rig.host.chat(chatId).messages.at(-1)?.id).toBe(said);
    expect(await liveEntries(rig, chatId)).toEqual([]);
    const flag = await flagOf(rig, chatId);
    expect(flag).toMatchObject({ messageId: said, actions: [{ id: "regenerate", label: "Retry" }, { id: "diagnostics", label: "Diagnostics" }] });
    expect(String(flag?.detail)).toMatch(/^(Priya Nair's mind|A mind): invalid api key$/);
    const records = await rig.rt.diag.records(chatId, rig.host.userId);
    expect(records.some((r) => r.kind === "turn" && r.status === "failed")).toBe(true);
  });

  test("Retry asks only the minds that failed, keeping the ones that answered, then generates", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig);
    let priyaDown = true;
    rig.host.quietReply = (req) => {
      if (priyaDown && MIND.exec(req.messages[0]?.content ?? "")?.[1] === "Priya Nair") throw new Error("invalid api key");
      return mindAnswer(req);
    };
    rig.host.sendUser(chatId, "Hello.");
    await rig.host.settle();
    expect((await rig.host.start(chatId, { type: "normal" })).halted).toBe("cancelled");
    expect(mindsAsked(rig.host.quietCalls)).toEqual(["Danny Okafor", "Priya Nair"]);
    priyaDown = false;
    const before = rig.host.quietCalls.length;
    // Retry: the flag's Regenerate, which the host plays as a normal reply after the player's message.
    const reply = await rig.host.start(chatId, { type: "regenerate" });
    expect(reply.halted).toBeUndefined();
    expect(mindsAsked(rig.host.quietCalls.slice(before))).toEqual(["Priya Nair"]);
    expect(rig.host.section("Minds")).toContain("Danny Okafor: Danny Okafor leans on the counter");
    expect(rig.host.section("Minds")).toContain("Priya Nair: Priya Nair leans on the counter");
    expect(await flagOf(rig, chatId)).toBeUndefined();
  });

  test("a transient provider error is asked again before the step fails, and the reply goes ahead", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig);
    let resets = 1;
    rig.host.quietReply = (req) => {
      if (resets > 0 && MIND.exec(req.messages[0]?.content ?? "")?.[1] === "Danny Okafor") {
        resets--;
        throw new Error("read ECONNRESET");
      }
      return mindAnswer(req);
    };
    await rig.turn(chatId, "Hello.", "Danny nods.");
    expect(mindsAsked(rig.host.quietCalls)).toEqual(["Danny Okafor", "Danny Okafor", "Priya Nair"]);
    expect(await flagOf(rig, chatId)).toBeUndefined();
    const records = await rig.rt.diag.records(chatId, rig.host.userId);
    const calls = records.flatMap((r) => r.calls ?? []).filter((c) => c.purpose === "mind");
    expect(calls.filter((c) => c.retried)).toHaveLength(1);
    expect(calls.filter((c) => c.retries === 1 && c.ok)).toHaveLength(1);
  });


  test("a turn the chat changed under is never used: its entries are emptied and the next generation runs the engine again", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const said = rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    expect((await rig.host.begin(chatId, { type: "normal" })).halted).toBe("cancelled");
    expect((await liveEntries(rig, chatId)).length).toBeGreaterThan(0);
    // The player edits their message before the reply starts: the prepared turn goes, and its entries.
    rig.host.editMessage(chatId, said, "I check the time.");
    await rig.host.settle();
    expect(await liveEntries(rig, chatId)).toEqual([]);
    // The restart the engine asked for is stopped again, and the engine runs for the edited message.
    rig.host.restarts.length = 0;
    expect((await rig.host.begin(chatId, { type: "regenerate" })).halted).toBe("cancelled");
    expect(rig.host.restarts).toEqual([{ chatId, as: "regenerate" }]);
    const reply = await rig.host.begin(chatId, { type: "regenerate" });
    expect(reply.halted).toBeUndefined();
    expect(rig.host.section("Scene")).toMatch(/^\[Scene\]\n/);
  });

  test("a dry run changes nothing: no stop, no engine run, no entry filled", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    const fills = rig.host.fills.length;
    const before = JSON.stringify((await rig.rt.ledger.core(chatId, rig.host.userId))?.journal);
    const dry = await rig.host.dryRun(chatId);
    await rig.host.settle();
    expect(rig.host.fills.length).toBe(fills);
    expect(rig.host.restarts).toEqual([]);
    expect(rig.host.quietCalls).toEqual([]);
    expect(dry.messages.some((m) => m.content.startsWith("["))).toBe(false);
    expect(JSON.stringify((await rig.rt.ledger.core(chatId, rig.host.userId))?.journal)).toBe(before);
  });
});

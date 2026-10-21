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
import { NOT_LAST_REPLY } from "../../src/shared/diagnostics";
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
    expect(rig.host.restarts).toMatchObject([{ chatId, as: "regenerate", session: "page" }]);
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

  test("a failed read of the action halts the run; fixing that step's settings and pressing Retry reads it again and keeps every mind", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const chatId = await alderChat(rig);
    let readDown = true;
    rig.host.quietReply = (req) => {
      if ((req.messages[0]?.content ?? "").includes("You map a player's typed input")) {
        if (readDown) throw new Error("no such connection");
        return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
      }
      return mindAnswer(req);
    };
    rig.host.sendUser(chatId, "I walk over to the counter.");
    await rig.host.settle();
    expect((await rig.host.start(chatId, { type: "normal" })).halted).toBe("cancelled");
    expect(String((await flagOf(rig, chatId))?.detail)).toMatch(/^Reading your action: no such connection$/);
    expect(mindsAsked(rig.host.quietCalls)).toEqual(["Danny Okafor", "Priya Nair"]);
    // The player fixes the step's connection in Settings, then presses Retry.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { steps: { interpret: { maxTokens: 900 } } } } }));
    readDown = false;
    const before = rig.host.quietCalls.length;
    expect((await rig.host.start(chatId, { type: "regenerate" })).halted).toBeUndefined();
    const asked = rig.host.quietCalls.slice(before);
    expect(asked.filter((c) => (c.messages[0]?.content ?? "").includes("You map a player's typed input"))).toHaveLength(1);
    expect(mindsAsked(asked)).toEqual([]);
    expect(rig.host.section("Minds")).toContain("Danny Okafor: Danny Okafor leans on the counter");
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
    // A turn waiting for its reply holds nothing in the book: its reply's guard writes it.
    expect(await liveEntries(rig, chatId)).toEqual([]);
    // The player edits their message before the reply starts: the prepared turn goes, and its entries.
    rig.host.editMessage(chatId, said, "I check the time.");
    await rig.host.settle();
    expect(await liveEntries(rig, chatId)).toEqual([]);
    // The restart the engine asked for is stopped again, and the engine runs for the edited message.
    rig.host.restarts.length = 0;
    expect((await rig.host.begin(chatId, { type: "regenerate" })).halted).toBe("cancelled");
    expect(rig.host.restarts).toMatchObject([{ chatId, as: "regenerate", session: "page" }]);
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

  test("the restart fires once with two pages open: only the page the stopped reply ran for starts it, the other sees it already started, and no second reply or swipe comes", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    expect((await rig.host.begin(chatId, { type: "normal", session: "desk" })).halted).toBe("cancelled");
    expect(rig.host.restarts.map((r) => r.session)).toEqual(["desk"]);
    // The phone opens the chat and resyncs: it isn't asked, and its activity line says why.
    const before = rig.host.sent.length;
    rig.body(await rig.send({ type: "lre.hello", chatId }, "phone"));
    rig.body(await rig.send({ type: "lre.state.resync", chatId }, "phone"));
    expect(rig.host.restarts.map((r) => r.session)).toEqual(["desk"]);
    expect(activitiesTo(rig, "phone", before).at(-1)).toBe("Already started in another window");
    // The desktop starts it once; the guard lets it through and the turn is consumed.
    const [restart] = rig.host.restarts.splice(0);
    const reply = await rig.host.begin(chatId, { type: "regenerate", session: restart?.session ?? "" });
    expect(reply.halted).toBeUndefined();
    for (const page of ["phone", "desk"]) rig.body(await rig.send({ type: "lre.state.resync", chatId }, page));
    expect(rig.host.restarts).toEqual([]);
    await rig.host.finish(reply, "The square is quiet.");
    const replies = rig.host.chat(chatId).messages.filter((m) => !m.isUser);
    expect(replies.at(-1)?.swipes).toEqual(["The square is quiet."]);
  });

  test("a page holding the restart closes: the next page to open the chat takes it, and only that one", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    expect((await rig.host.begin(chatId, { type: "normal", session: "desk" })).halted).toBe("cancelled");
    rig.host.restarts.length = 0;
    rig.host.closeSession("desk");
    await rig.host.settle();
    rig.body(await rig.send({ type: "lre.hello", chatId }, "phone"));
    rig.body(await rig.send({ type: "lre.hello", chatId }, "tablet"));
    expect(rig.host.restarts.map((r) => r.session)).toEqual(["phone"]);
    expect((await rig.host.begin(chatId, { type: "regenerate", session: "phone" })).halted).toBeUndefined();
  });

  test("the sending page showing the chat gets the restart while a newer page sits on home, though the reply ran for the newer one", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.body(await rig.send({ type: "lre.hello", chatId }, "desk"));
    rig.body(await rig.send({ type: "lre.hello", chatId: null }, "phone"));
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    // Lumiverse runs new work for its newest page, the phone on home.
    expect((await rig.host.begin(chatId, { type: "normal", session: "phone" })).halted).toBe("cancelled");
    expect(rig.host.restarts.map((r) => r.session)).toEqual(["desk"]);
    const reply = await rig.host.start(chatId, { type: "regenerate", session: "desk" });
    expect(reply.halted).toBeUndefined();
  });

  test("the page asked to start the reply reads 'Waiting for the reply…' while it does; when no page shows the chat, the line says to reopen it", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.body(await rig.send({ type: "lre.hello", chatId }, "desk"));
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    const from = rig.host.sent.length;
    expect((await rig.host.begin(chatId, { type: "normal", session: "desk" })).halted).toBe("cancelled");
    expect(rig.host.restarts.map((r) => r.session)).toEqual(["desk"]);
    expect(activitiesTo(rig, "desk", from).at(-1)).toBe("Waiting for the reply…");
    // The desk goes home before starting it, and no other page shows the chat.
    const home = rig.host.sent.length;
    rig.body(await rig.send({ type: "lre.page", chatId: null, viewing: true }, "desk"));
    expect(activitiesTo(rig, "desk", home).at(-1)).toBe("Ready; reopen the chat to continue");
  });

  test("a page that opens the chat takes the restart from a holder that went home; the old holder's claim is refused, so one reply comes", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.body(await rig.send({ type: "lre.hello", chatId }, "desk"));
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    expect((await rig.host.begin(chatId, { type: "normal", session: "desk" })).halted).toBe("cancelled");
    const [offered] = rig.host.restarts.splice(0);
    expect(offered?.session).toBe("desk");
    // The desk goes home before starting it; the phone opens the chat and takes it.
    rig.body(await rig.send({ type: "lre.page", chatId: null, viewing: false }, "desk"));
    rig.body(await rig.send({ type: "lre.hello", chatId }, "phone"));
    expect(rig.host.restarts.map((r) => r.session)).toEqual(["phone"]);
    // The desk's old ask is refused; the phone's claim starts the one reply.
    expect(rig.body(await rig.send({ type: "lre.restart", chatId, turn: offered?.turn ?? "" }, "desk")).start).toBe(false);
    const turn = rig.host.restarts[0]?.turn ?? "";
    expect(rig.body(await rig.send({ type: "lre.restart", chatId, turn }, "phone")).start).toBe(true);
    const reply = await rig.host.begin(chatId, { type: "regenerate", session: "phone" });
    expect(reply.halted).toBeUndefined();
    await rig.host.finish(reply, "The square is quiet.");
    expect(rig.host.chat(chatId).messages.filter((m) => !m.isUser).at(-1)?.swipes).toEqual(["The square is quiet."]);
  });

  test("two pages both showing the chat: one is asked, the other's claim is refused, and one reply comes", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.body(await rig.send({ type: "lre.hello", chatId }, "desk"));
    rig.body(await rig.send({ type: "lre.hello", chatId }, "phone"));
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    expect((await rig.host.begin(chatId, { type: "normal", session: "phone" })).halted).toBe("cancelled");
    const [offered] = rig.host.restarts;
    expect(rig.host.restarts.map((r) => r.session)).toEqual(["phone"]);
    // The desk resyncs: it isn't asked, and its claim, should it try, is refused.
    rig.body(await rig.send({ type: "lre.state.resync", chatId }, "desk"));
    expect(rig.host.restarts).toHaveLength(1);
    expect(rig.body(await rig.send({ type: "lre.restart", chatId, turn: offered?.turn ?? "" }, "desk")).start).toBe(false);
    const reply = await rig.host.start(chatId, { type: "regenerate", session: "phone" });
    expect(reply.halted).toBeUndefined();
    await rig.host.finish(reply, "Quiet.");
    // Consumed: a late claim from either page is refused.
    for (const page of ["desk", "phone"]) expect(rig.body(await rig.send({ type: "lre.restart", chatId, turn: offered?.turn ?? "" }, page)).start).toBe(false);
    expect(rig.host.chat(chatId).messages.filter((m) => !m.isUser).at(-1)?.swipes).toEqual(["Quiet."]);
  });

  test("a reply for an earlier message is refused before any model call: nothing is generated, nothing goes to the last reply, and the flag says why with no Retry", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    await rig.turn(chatId, "I wait.", "A bell rings.");
    const [earlier, last] = rig.host.chat(chatId).messages.filter((m) => !m.isUser).slice(-2);
    if (!earlier || !last) throw new Error("no replies");
    const calls = rig.rt.meter.log.length;
    // Edit and Send in place on the first message stages a swipe on the reply after it; Lumiverse's
    // Regenerate, the only restart there is, would make a swipe of the last reply instead.
    const g = await rig.host.start(chatId, { type: "swipe", messageId: earlier.id });
    expect(g.halted).toBe("cancelled");
    expect(rig.rt.meter.log.length).toBe(calls);
    expect(rig.host.restarts).toEqual([]);
    const after = rig.host.chat(chatId).messages;
    expect(after.find((m) => m.id === earlier.id)?.swipes).toEqual(["The square is quiet."]);
    expect(after.find((m) => m.id === last.id)?.swipes).toEqual(["A bell rings."]);
    const flag = await flagOf(rig, chatId);
    expect(flag).toMatchObject({ messageId: last.id, detail: NOT_LAST_REPLY });
    expect(flag?.actions).toEqual([{ id: "diagnostics", label: "Diagnostics" }]);
  });
});

/** The activity lines one page got since `from` in the host's sends: those sent to it and those sent to every page. */
function activitiesTo(rig: Rig, session: string, from: number): string[] {
  return rig.host.sent.flatMap((m, i) => {
    const to = rig.host.sentTo[i]?.session;
    return i >= from && (to === session || to === undefined) && m.type === "lre.activity" && m.activity ? [m.activity.label] : [];
  });
}

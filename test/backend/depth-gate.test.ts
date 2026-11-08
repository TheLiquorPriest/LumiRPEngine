// What a chat on depth tells its player about getting there and playing on it: the opt-in is refused
// until Settings → Loopback shows the user ready (a relay Running, a loopback key, a loopback
// connection), with the reason; a turn generated on a connection other than the loopback runs no
// engine and asks no model, on either engine, and says depth needs the loopback, with Settings →
// Loopback; and the player's edit of a reply says what became of it as a chip.

import { describe, expect, test } from "bun:test";
import type { BootstrapView } from "../../src/shared/bootstrap";
import { ROLE_IDS } from "../../src/shared/agent-roles";
import type { Chip } from "../../src/shared/state-view";
import { alderChat, DANNY, fakeModels, PRIYA } from "../support/mind-chat";
import { readyLoopback, RELAY_SESSION } from "../support/relay";
import { Rig } from "../support/rig";

async function chips(rig: Rig, chatId: string): Promise<Chip[]> {
  return (await rig.rt.view(chatId, rig.host.userId)).chips;
}

/** Model calls by the step that asked each, the depth scene's GM standing for the scene; `all` counts every one. */
type Asked = Record<"minds" | "memory" | "knowledge" | "intent" | "brief" | "outline" | "read" | "scene" | "all", number>;

/** The model calls made since the `from`th. */
function asked(rig: Rig, from: number): Asked {
  const texts = rig.host.quietCalls.slice(from).map((c) => c.messages.map((m) => m.content).join("\n"));
  const count = (mark: string): number => texts.filter((t) => t.includes(mark)).length;
  return {
    minds: count("You are the private mind of"),
    memory: count("You keep the memory of"),
    knowledge: count("You keep track of who knows what"),
    intent: count("You map a player's typed input"),
    brief: count("You brief a roleplay narrator"),
    outline: count("You outline a roleplay narrator"),
    read: count("propose concrete state changes"),
    scene: count("What the player wrote, verbatim:"),
    all: texts.length,
  };
}

/** The opt-in's answer: the chat's view, or the refusal's code and words. */
async function optIn(rig: Rig, chatId: string): Promise<{ optedIn: boolean } | { code: string; message: string }> {
  const reply = await rig.send({ type: "lre.bootstrap", chatId, op: "opt", on: true });
  if (reply.type === "lre.error") return { code: reply.code, message: reply.message };
  return { optedIn: (rig.body(reply).view as BootstrapView).optedIn };
}

describe("the depth opt-in's gate", () => {
  test("refuses to start until Settings → Loopback shows the user ready, saying what is missing and where to put it right; the chat stays off until then", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const status = async (): Promise<boolean> => (rig.body(await rig.send({ type: "lre.bootstrap", chatId, op: "status" })).view as BootstrapView).optedIn;

    // No relay at all.
    expect(await optIn(rig, chatId)).toEqual({ code: "unavailable", message: "Depth can't start on this chat yet. No relay carries your replies yet: start one with the line in Settings → Loopback." });
    expect(await status()).toBe(false);

    // A relay whose Lumiverse session has ended is not Running.
    const registered = rig.body(await rig.send({ type: "lre.loopback.register", name: "sam", mode: "user", build: "dev", host: "box", listen: "127.0.0.1", port: 7864 }, RELAY_SESSION));
    const report = { name: "sam", build: "dev", runtime: { bun: "/usr/bin/bun", script: "/srv/lre/lumirpengine.js", unit: null }, host: "box", listen: "127.0.0.1", port: 7864, scheduler: "excluded", session: { valid: false, expiresAt: null, checkedAt: null }, calls: 0 };
    rig.body(await rig.send({ type: "lre.loopback.hello", secret: registered.secret, api: 1, report, open: [] }, RELAY_SESSION));
    expect(await optIn(rig, chatId)).toEqual({ code: "unavailable", message: "Depth can't start on this chat yet. No relay of yours is running: sam has gone quiet or its Lumiverse session ended; sign it in again with its line in Settings → Loopback." });

    // Running again, but no key yet.
    rig.body(await rig.send({ type: "lre.loopback.ping", secret: registered.secret, report: { ...report, session: { valid: true, expiresAt: null, checkedAt: null } }, calls: [] }, RELAY_SESSION));
    expect(await optIn(rig, chatId)).toEqual({ code: "unavailable", message: "Depth can't start on this chat yet. You have no loopback key: mint one in Settings → Loopback and set it as the loopback connection's API key." });

    // The key, but no connection that is the loopback.
    rig.body(await rig.send({ type: "lre.loopback.page", op: "mint" }));
    expect(await optIn(rig, chatId)).toEqual({ code: "unavailable", message: "Depth can't start on this chat yet. None of your connections is the loopback: make one as Settings → Loopback shows." });
    expect(await status()).toBe(false);

    // Ready: it starts, and turning it off again is never gated.
    await readyLoopback(rig, 7865, "kit");
    expect(await optIn(rig, chatId)).toEqual({ optedIn: true });
    rig.body(await rig.send({ type: "lre.bootstrap", chatId, op: "opt", on: false }));
    expect(await status()).toBe(false);
  });

  test("pins the chat to the loopback connection, keeping a loopback pin it has, and opting out puts back the pin it replaced unless the player has pinned it elsewhere since", async () => {
    const rig = new Rig();
    const first = (await readyLoopback(rig, 7863, "sam")).connectionId;
    const second = (await readyLoopback(rig, 7866, "kit")).connectionId;
    rig.host.connectionProfiles.push({ id: "conn-other", name: "Other", models: ["gpt-x"] });
    const pin = (chatId: string): unknown => ({ id: rig.host.chat(chatId).metadata.connection_profile_id ?? null, model: rig.host.chat(chatId).metadata.connection_model ?? null });
    const opt = async (chatId: string, on: boolean): Promise<void> => void rig.body(await rig.send({ type: "lre.bootstrap", chatId, op: "opt", on }));

    // Pinned to another connection: pinned to the first loopback, with the connection's own model; opting out puts the old pin back, its model too.
    const other = await rig.worldChat();
    rig.host.chat(other).metadata.connection_profile_id = "conn-other";
    rig.host.chat(other).metadata.connection_model = "gpt-x";
    await opt(other, true);
    expect(pin(other)).toEqual({ id: first, model: null });
    // A second opt-in keeps the pin the first replaced.
    await opt(other, true);
    await opt(other, false);
    expect(pin(other)).toEqual({ id: "conn-other", model: "gpt-x" });

    // Pinned to a loopback already: that one stays, without a model of its own; opting out puts its model back.
    const looped = await rig.worldChat();
    rig.host.chat(looped).metadata.connection_profile_id = second;
    rig.host.chat(looped).metadata.connection_model = "lre-narrator";
    await opt(looped, true);
    expect(pin(looped)).toEqual({ id: second, model: null });
    await opt(looped, false);
    expect(pin(looped)).toEqual({ id: second, model: "lre-narrator" });

    // Not pinned: pinned, and unpinned again on opting out.
    const bare = await rig.worldChat();
    await opt(bare, true);
    expect(pin(bare)).toEqual({ id: first, model: null });
    await opt(bare, false);
    expect(pin(bare)).toEqual({ id: null, model: null });

    // Pinned elsewhere by the player while on depth: opting out leaves the player's pin.
    await opt(bare, true);
    rig.host.chat(bare).metadata.connection_profile_id = "conn-other";
    await opt(bare, false);
    expect(pin(bare)).toEqual({ id: "conn-other", model: null });
  });

  // The depth release's late security review (its note): opting in read depth.json outside the chat's
  // metadata queue, so the second of two opt-ins at once recorded the loopback the first had just
  // pinned as the pin it replaced, and opting out left the chat on the loopback.
  test("two opt-ins at once record the pin the chat had, not the loopback the first pinned: opting out puts it back", async () => {
    const rig = new Rig();
    const loopback = (await readyLoopback(rig, 7863, "sam")).connectionId;
    rig.host.connectionProfiles.push({ id: "conn-other", name: "Other", models: ["gpt-x"] });
    const pin = (chatId: string): unknown => ({ id: rig.host.chat(chatId).metadata.connection_profile_id ?? null, model: rig.host.chat(chatId).metadata.connection_model ?? null });
    const opt = async (chatId: string, on: boolean): Promise<void> => void rig.body(await rig.send({ type: "lre.bootstrap", chatId, op: "opt", on }));
    const chatId = await rig.worldChat();
    rig.host.chat(chatId).metadata.connection_profile_id = "conn-other";
    rig.host.chat(chatId).metadata.connection_model = "gpt-x";
    await Promise.all([opt(chatId, true), opt(chatId, true)]);
    expect(pin(chatId)).toEqual({ id: loopback, model: null });
    await opt(chatId, false);
    expect(pin(chatId)).toEqual({ id: "conn-other", model: "gpt-x" });
  });
});

describe("a chat on depth", () => {
  test("generating on a connection other than the loopback says depth needs the loopback, with Settings → Loopback; a chat off depth says nothing of it", async () => {
    const rig = new Rig();
    await readyLoopback(rig);
    const off = await rig.worldChat();
    await rig.turn(off, "I look around.", "The room is quiet.");
    expect((await chips(rig, off)).filter((c) => c.kind === "needs_loopback")).toEqual([]);

    const on = await rig.worldChat();
    rig.body(await rig.send({ type: "lre.bootstrap", chatId: on, op: "opt", on: true }));
    await rig.turn(on, "I look around.", "The room is quiet.");
    const said = rig.host.chat(on).messages.findLast((m) => m.isUser);
    const chip = (await chips(rig, on)).find((c) => c.kind === "needs_loopback");
    expect(chip).toMatchObject({ id: `needs_loopback:${said?.id}`, messageId: said?.id, label: "Depth needs the loopback connection", actions: [{ id: "loopback", label: "Settings → Loopback", input: { type: "settings", label: "Settings → Loopback", page: "loopback" } }], expires: "next_send" });
    expect(chip?.detail).toContain("generated on another");
  });

  // LIVE2's first turns ran today's engine before a reply no scene could play and nothing read: the
  // intent read, the Brief and the Outline on classic, the pre-phase roles on agents, every call spent
  // for nothing. Off the loopback a chat on depth now runs no engine at all.
  test("generating on a connection other than the loopback runs no engine, on either engine: no mind, memory or knowledge step, no step before the reply, no intent read and no scene; the reply goes out with no engine section, unread and Not canon, and GM → Live says why each role is none", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig);
    await readyLoopback(rig);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
    const chatId = await alderChat(rig, async () => {}, [DANNY, PRIYA]);
    const turn = async (text: string, reply: string): Promise<Asked> => {
      const from = rig.host.quietCalls.length;
      await rig.turn(chatId, text, reply);
      await rig.host.settle();
      await rig.rt.depthSettled();
      return asked(rig, from);
    };

    // Before the chat went on depth, its classic turn asked every step, and its reply went out with the engine's sections.
    const classic = await turn("Morning, Danny.", "Danny looks up from the bench and nods.");
    expect(classic.scene).toBe(0);
    expect(Math.min(classic.minds, classic.memory, classic.knowledge, classic.intent, classic.brief, classic.outline, classic.read)).toBeGreaterThan(0);
    expect(rig.host.assembled).not.toEqual([]);

    // On depth, generated on the user's own connection: no call at all, and no section in the prompt.
    rig.body(await rig.send({ type: "lre.bootstrap", chatId, op: "opt", on: true }));
    const none = { minds: 0, memory: 0, knowledge: 0, intent: 0, brief: 0, outline: 0, read: 0, scene: 0, all: 0 };
    expect(await turn("I ask Danny how the boat engine is coming along.", "Danny says it needs a new gasket.")).toEqual(none);
    expect(rig.host.assembled).toEqual([]);
    // The reply commits unread, with nothing planned for it: no time passed and no event.
    const said = rig.host.chat(chatId).messages.findLast((m) => m.isUser);
    const reply = rig.host.head(chatId);
    if (!said || !reply) throw new Error("no turn");
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    expect(core?.journal.messages[reply.id]?.ledger.swipes[String(reply.swipeId)]).toMatchObject({ seed: "", pre: 0, events: [], unread: "reply" });
    // Its two chips: depth needs the loopback, under the player's message, and Not canon, under the reply.
    expect((await chips(rig, chatId)).map((c) => [c.kind, c.label, c.messageId, c.detail])).toEqual([
      ["needs_loopback", "Depth needs the loopback connection", said.id, "This chat is on depth, which plays its turns through the loopback connection. This reply was generated on another, so the engine didn't run for it and made no model call: no scene played it, no step ran before it, and nothing reads it into the story. Settings → Loopback names your loopback connections and how to make one; generate on one of them."],
      ["untracked", "Not canon", reply.id, "No scene played this reply on depth, and nothing read it into the story: none of what it tells happened beyond what its turn decided."],
    ]);

    // On agents the same, and GM → Live's plan says why each role is none.
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, engine: "agents" }));
    expect(await turn("I hand Priya the wrench.", "Priya takes it.")).toEqual(none);
    const live = rig.rt.live.view(chatId, rig.host.userId);
    const plan = live?.entries.find((e) => e.kind === "plan");
    expect(plan?.kind === "plan" ? plan.rows : null).toEqual(ROLE_IDS.map((role) => ({ role, status: "none", why: "Generated off the loopback: no scene and no read of the reply." })));
    expect(live?.ended).toMatchObject({ state: "done", reason: "Generated off the loopback, so the engine didn't run." });
  }, 60_000);

  test("the player's edit of a reply says what became of it as a chip on the reply, one per reply, the latest edit's", async () => {
    const rig = new Rig();
    await readyLoopback(rig);
    const chatId = await rig.worldChat();
    rig.body(await rig.send({ type: "lre.bootstrap", chatId, op: "opt", on: true }));
    await rig.turn(chatId, "I look around.", "The room is quiet.");
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    rig.host.editMessage(chatId, reply.id, "The room is quiet, and cold.");
    await rig.host.settle();
    await rig.rt.depthSettled();
    // A reply played off the loopback holds no beats, so there is nothing to amend, and the player is told.
    const read = (await chips(rig, chatId)).filter((c) => c.kind === "edit_read");
    expect(read).toEqual([{ id: `edit_read:${reply.id}:${reply.swipeId}`, kind: "edit_read", messageId: reply.id, swipeId: reply.swipeId, label: "Your edit, as the author read it", detail: "The edited reply holds no beats: nothing to amend.", actions: [], expires: "next_send" }]);
    rig.host.editMessage(chatId, reply.id, "The room is quiet, and colder still.");
    await rig.host.settle();
    await rig.rt.depthSettled();
    expect((await chips(rig, chatId)).filter((c) => c.kind === "edit_read")).toHaveLength(1);
  });
});

// What the backend lets go never breaks a turn or a page: a chat's guard state stays through its
// engine run while other chats open theirs, guard state made again never reuses minds kept from
// before a change, and a chat's view being built when other chats push is never let go, so an older
// view can't land after a newer one.

import { describe, expect, test } from "bun:test";
import type { ContextHandlerInput, ContextVerdict, HostPort, QuietRequest } from "../../src/backend/host";
import { OPEN_CHATS_CAP, toChain } from "../../src/backend/ledger-io";
import { StatePush, VIEWS_KEPT } from "../../src/backend/push";
import { placeOfEntity } from "../../src/engine/scope";
import { applyDelta } from "../../src/frontend/delta";
import { timeMarker } from "../../src/frontend/requests";
import type { BackendToFrontend } from "../../src/shared/protocol";
import type { StateView } from "../../src/shared/state-view";
import { Rig } from "../support/rig";

const MIND = /You are the private mind of (.+?) in the roleplay world/;
const mindsAsked = (calls: readonly QuietRequest[]): string[] => calls.flatMap((c) => MIND.exec(c.messages[0]?.content ?? "")?.[1] ?? []).sort();

/** What the fake host keeps of the guard it was given: the context handler Lumiverse calls before a generation. */
interface GuardHolder {
  contextHandler: ((input: ContextHandlerInput, signal: AbortSignal) => Promise<ContextVerdict>) | null;
}

/** The guard as Lumiverse calls it before a generation. */
function guardOf(rig: Rig): (input: ContextHandlerInput, signal: AbortSignal) => Promise<ContextVerdict> {
  // The fake host keeps its registered context handler in a private field; the test calls it as the host does.
  const holder = rig.host as unknown as GuardHolder;
  const handler = holder.contextHandler;
  if (!handler) throw new Error("no guard");
  return handler;
}

/** More world chats than the guard keeps state for. */
async function crowd(rig: Rig, worldId: string): Promise<string[]> {
  const chats: string[] = [];
  for (let n = 0; n <= OPEN_CHATS_CAP * 8; n++) {
    const chatId = rig.host.createChat("Hello.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    chats.push(chatId);
  }
  return chats;
}

/** Each chat's dry run (Lumiverse's preset check), which opens its guard state. */
async function lookAt(rig: Rig, chats: readonly string[]): Promise<void> {
  const guard = guardOf(rig);
  for (const chatId of chats) await guard({ chatId, userId: rig.host.userId, generationType: "normal", dryRun: true, connectionId: null, personaId: null }, new AbortController().signal);
}

describe("eviction races", () => {
  test("a chat's engine run keeps its guard state while the player's other chats open theirs, and its reply starts", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const others = await crowd(rig, await rig.newWorld("Elsewhere"));
    rig.body(await rig.send({ type: "lre.hello", chatId }, "desk"));
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    // While the engine runs for this chat, every other chat is opened.
    const quiet = rig.host.models.quiet;
    let crowded = false;
    rig.host.models.quiet = async (...call: Parameters<typeof quiet>) => {
      if (!crowded) {
        crowded = true;
        await lookAt(rig, others);
      }
      return quiet(...call);
    };
    const reply = await rig.host.start(chatId, { type: "normal", session: "desk" });
    expect(crowded).toBe(true);
    expect(reply.halted).toBeUndefined();
    await rig.host.finish(reply, "The square is quiet.");
    expect(rig.host.chat(chatId).messages.at(-1)?.swipes).toEqual(["The square is quiet."]);
    // Opening more chats than the guard keeps state for takes a while.
  }, 30_000);

  test("minds kept from before a change are asked again after the chat's guard state was let go", async () => {
    const rig = new Rig({ shipped: true, minds: true });
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
    const others = await crowd(rig, worldId);
    let readDown = true;
    rig.host.quietReply = (req) => {
      const prompt = req.messages[0]?.content ?? "";
      if (prompt.includes("You map a player's typed input")) {
        if (readDown) throw new Error("no such connection");
        return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
      }
      const mind = MIND.exec(prompt)?.[1];
      if (mind) return JSON.stringify({ monologue: `${mind} thinks.`, depiction: `${mind} leans on the counter`, intent: `${mind} means to talk`, reactions: [], plans: [], mood: "calm" });
      return JSON.stringify({ notes: [], commitments: [], resolved: [], plans: [], told: [], proposals: [] });
    };
    rig.host.sendUser(chatId, "I walk over to the counter.");
    await rig.host.settle();
    expect((await rig.host.start(chatId, { type: "normal" })).halted).toBe("cancelled");
    expect(mindsAsked(rig.host.quietCalls)).toEqual(["Danny Okafor", "Priya Nair"]);
    // The GM pauses the clock, which the minds didn't think from; then every other chat is opened.
    rig.body(await rig.send(timeMarker(chatId, "pause", { all: true }, true)));
    await lookAt(rig, others);
    readDown = false;
    const before = rig.host.quietCalls.length;
    expect((await rig.host.start(chatId, { type: "regenerate" })).halted).toBeUndefined();
    expect(mindsAsked(rig.host.quietCalls.slice(before))).toEqual(["Danny Okafor", "Priya Nair"]);
  }, 60_000);

  test("a view still being built when other chats push isn't let go: the page ends on the newest view, not an older one landing last", async () => {
    const sent: { message: BackendToFrontend; session?: string }[] = [];
    const host = { frontend: { send: (message: BackendToFrontend, _userId: string | null, session?: string) => sent.push({ message: structuredClone(message), ...(session !== undefined ? { session } : {}) }) }, log: () => undefined } as unknown as HostPort;
    const minutes = new Map<string, number>([["a", 1]]);
    let hold: PromiseWithResolvers<void> | null = Promise.withResolvers<void>();
    const held = hold;
    const push = new StatePush(host, async (chatId) => {
      const at = minutes.get(chatId) ?? 0;
      if (chatId === "a" && hold) {
        const wait = hold;
        hold = null;
        await wait.promise;
      }
      return { v: 1, chatId, minutes: at } as unknown as StateView;
    });
    // The page opens chat a; its view is slow to build, and meanwhile the player's other chats push theirs.
    const opened = push.snapshot("a", "u", "page");
    for (let n = 0; n < VIEWS_KEPT + 2; n++) await push.snapshot(`c${n}`, "u");
    minutes.set("a", 2);
    push.changed("a", "u");
    await push.settle();
    held.resolve();
    await opened;
    await push.settle();
    const mine = sent.filter((s) => (s.session === undefined || s.session === "page") && (s.message.type === "lre.state.snapshot" || s.message.type === "lre.state.delta") && s.message.chatId === "a").map((s) => s.message);
    const at = mine.findLastIndex((m) => m.type === "lre.state.snapshot");
    const snapshot = mine[at];
    if (snapshot?.type !== "lre.state.snapshot") throw new Error("no snapshot");
    let view: unknown = snapshot.view;
    let rev = snapshot.rev;
    for (const m of mine.slice(at + 1)) {
      if (m.type !== "lre.state.delta" || m.base !== rev) continue;
      view = applyDelta(view, m.ops);
      rev = m.rev;
    }
    expect(view).toMatchObject({ minutes: 2 });
  });
});

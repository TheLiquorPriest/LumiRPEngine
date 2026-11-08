// Depth work between turns (DEPTH-PLAN §6): a swipe or a delete of the message it read through stops
// it, Work between turns off stops it once what the next turn reads is in, and a turn reading through
// it waits for what it needs and says what it went on without.

import { describe, expect, test } from "bun:test";
import { chatBudget } from "../../src/backend/depth/chat-allowances";
import type { ChatId, MessageId } from "../../src/shared/ids";
import { readyLoopback } from "../support/relay";
import { Rig } from "../support/rig";

type Job = { signal: AbortSignal; ready: () => void; reads: (message: MessageId) => void };

/** Starts depth work on the rig's runtime (`Runtime.depthWorking`), reading through `reads`. */
function work(rig: Rig, chatId: string, what: string, run: (job: Job) => Promise<void>, reads: MessageId): void {
  rig.rt["depthWorking"](chatId, rig.host.userId, what, run, { reads, between: true });
}

/** Work that stays under way until it is stopped; `aborted` resolves with why. */
function held(): { run: (job: Job) => Promise<void>; aborted: Promise<string> } {
  const aborted = Promise.withResolvers<string>();
  return {
    aborted: aborted.promise,
    run: (job) =>
      new Promise<void>((resolve) => {
        job.signal.addEventListener("abort", () => {
          aborted.resolve(job.signal.reason instanceof Error ? job.signal.reason.message : String(job.signal.reason));
          resolve();
        });
      }),
  };
}

describe("depth work between turns", () => {
  test("stops when a swipe or a delete takes the message it read off the chat, and only that work", async () => {
    const rig = new Rig();
    await readyLoopback(rig);
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "The room is quiet.");
    const reply = rig.host.head(chatId);
    const said = rig.host.chat(chatId).messages.findLast((m) => m.isUser);
    if (!reply || !said) throw new Error("no turn");
    const onReply = held();
    const onSaid = held();
    work(rig, chatId, "the step after the reply", onReply.run, reply.id);
    work(rig, chatId, "the author's poll", onSaid.run, said.id);
    rig.host.addSwipe(chatId, reply.id, "The room is loud.");
    rig.host.deliverNow();
    expect(await onReply.aborted).toBe("a swipe took the reply it read off the chat");
    rig.host.deleteMessage(chatId, said.id);
    rig.host.deliverNow();
    expect(await onSaid.aborted).toBe("the message it read was deleted");
    await rig.rt.depthSettled();
  });

  test("a turn reading through it waits for what the next turn reads, and names what it went on without once stopped", async () => {
    const rig = new Rig();
    await readyLoopback(rig);
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "The room is quiet.");
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no turn");
    const rest = Promise.withResolvers<void>();
    work(
      rig,
      chatId,
      "the step after the reply",
      async (job) => {
        await Promise.resolve();
        job.ready();
        await rest.promise;
      },
      reply.id,
    );
    expect(await rig.rt.depthNeeded(chatId, new Set([reply.id]))).toEqual({ waited: [{ what: "the step after the reply", message: reply.id }], without: [] });
    // What is ready isn't waited for again; nothing at another message is waited for.
    expect(await rig.rt.depthNeeded(chatId, new Set([reply.id]))).toEqual({ waited: [], without: [] });
    const stopped = held();
    work(rig, chatId, "a catch-up", stopped.run, reply.id);
    expect(await rig.rt.depthNeeded(chatId, new Set(["elsewhere" as MessageId]))).toEqual({ waited: [], without: [] });
    const waiting = rig.rt.depthNeeded(chatId, new Set([reply.id]));
    rig.host.addSwipe(chatId, reply.id, "The room is loud.");
    rig.host.deliverNow();
    expect(await waiting).toEqual({ waited: [], without: [{ what: "a catch-up", message: reply.id }] });
    rest.resolve();
    await rig.rt.depthSettled();
  });

  test("Work between turns off stops work between turns once what the next turn reads is in", async () => {
    const rig = new Rig();
    await readyLoopback(rig);
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "The room is quiet.");
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no turn");
    const go = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<string>();
    let readyYet = false;
    work(
      rig,
      chatId,
      "the step after the reply",
      async (job) => {
        await go.promise;
        readyYet = true;
        job.ready();
        await new Promise<void>((resolve) => job.signal.addEventListener("abort", () => resolve()));
        aborted.resolve(String((job.signal.reason as Error).message));
      },
      reply.id,
    );
    const sent = rig.send({ type: "lre.settings.set", patch: { depth: { background: { on: false } } } });
    await Bun.sleep(50);
    expect(readyYet).toBe(false);
    go.resolve();
    expect(await aborted.promise).toBe("Work between turns was turned off");
    rig.body(await sent);
    await rig.rt.depthSettled();
  });
});

describe("a chat's own allowances", () => {
  test("hold over the user's for that chat alone, are refused when malformed, and go back to the user's when cleared", async () => {
    const rig = new Rig();
    await readyLoopback(rig);
    const chatId = await rig.worldChat();
    const other = await rig.worldChat();
    const yours = (await rig.rt.settings.get(rig.host.userId)).depth.budget;
    const set = async (allowances: unknown) => rig.send({ type: "lre.bootstrap", chatId, op: "allowances", allowances } as never);
    expect(rig.body(await set({ live: 0, room: "none" }))).toMatchObject({ view: { allowances: { own: { live: 0, room: "none" }, yours: yours.allowances, interval: yours.interval } } });
    expect((await chatBudget(rig.host, chatId as ChatId, rig.host.userId, yours)).allowances).toEqual({ ...yours.allowances, live: 0, room: "none" });
    expect((await chatBudget(rig.host, other as ChatId, rig.host.userId, yours)).allowances).toEqual(yours.allowances);
    expect((await set({ live: -1 })).type).toBe("lre.error");
    expect((await set({ epic: 2 })).type).toBe("lre.error");
    expect(rig.body(await set({}))).toMatchObject({ view: { allowances: { own: {} } } });
    expect((await chatBudget(rig.host, chatId as ChatId, rig.host.userId, yours)).allowances).toEqual(yours.allowances);
  });
});

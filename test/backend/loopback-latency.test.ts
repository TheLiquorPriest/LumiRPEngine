// The tagger under load, and a dry run on the loopback (DEPTH-PLAN §3.5, R11, §3.13). Core waits on
// the required prompt interceptor for at most `interceptorTimeoutMs` (30 s) and stops the reply past
// it, so the tagger never waits on a chat's ledger queue, which a bootstrap can keep busy for minutes:
// it answers at once with the queue held and many operations behind it. A dry run of a world chat on
// the loopback gets no token, and LumiRPEngine keeps the narrator's prompt it would compose instead.

import { describe, expect, test } from "bun:test";
import type { PromptInterceptorInput, PromptMessage } from "../../src/backend/host";
import { LOOPBACK_MODEL } from "../../src/shared/loopback";
import { readyLoopback } from "../support/relay";
import { Rig } from "../support/rig";

const PROMPT: PromptMessage[] = [
  { role: "system", content: "You are the narrator of this story.", history: false, worldInfo: false },
  { role: "user", content: "I walk into the shop.", history: true, worldInfo: false },
];

async function setup(port: number) {
  const rig = new Rig();
  const { connectionId } = await readyLoopback(rig, port);
  rig.host.contextConnectionId = connectionId;
  const chatId = await rig.worldChat();
  const input = (over: Partial<PromptInterceptorInput> = {}): PromptInterceptorInput => ({ chatId, userId: rig.host.userId, generationType: "normal", dryRun: false, connectionId, presetId: null, messages: PROMPT, ...over });
  return { rig, chatId, input };
}

/** Holds the chat's ledger queue, as a bootstrap's long run does, with `queued` more operations behind it; `release` lets them all go. */
function holdQueue(rig: Rig, chatId: Parameters<Rig["rt"]["ledger"]["with"]>[0], queued: number): { release: () => Promise<void> } {
  const held = Promise.withResolvers<void>();
  const ops = [rig.rt.ledger.with(chatId, rig.host.userId, () => held.promise), ...Array.from({ length: queued }, () => rig.rt.ledger.with(chatId, rig.host.userId, () => undefined))];
  return {
    release: async () => {
      held.resolve();
      await Promise.all(ops);
    },
  };
}

describe("the tagger with the chat's ledger queue busy", () => {
  test("tags a world chat's generation at once, well inside the interceptor's 30 s", async () => {
    const { rig, chatId, input } = await setup(7871);
    rig.host.sendUser(chatId, "I walk into the shop.");
    await rig.host.settle();
    const g = await rig.host.begin(chatId, { type: "normal" });
    expect(typeof g.parameters?.lre_turn).toBe("string");
    const queue = holdQueue(rig, chatId, 200);
    const started = performance.now();
    // The same generation assembled again while the queue is held: the newer token stands.
    const verdict = await rig.rt.loopback.tag(input());
    expect(performance.now() - started).toBeLessThan(1000);
    expect(typeof verdict.parameters?.lre_turn).toBe("string");
    expect(verdict.parameters?.lre_turn).not.toBe(g.parameters?.lre_turn);
    await queue.release();
  });

  test("stops an untied world-chat reply at once, and answers a dry run at once", async () => {
    const { rig, chatId, input } = await setup(7872);
    const queue = holdQueue(rig, chatId, 200);
    const started = performance.now();
    await expect(rig.rt.loopback.tag(input())).rejects.toThrow("couldn't tie this world chat's reply");
    expect(await rig.rt.loopback.tag(input({ dryRun: true }))).toEqual({});
    expect(performance.now() - started).toBeLessThan(1000);
    await queue.release();
  });
});

describe("a dry run on the loopback", () => {
  test("gets no token; the narrator's prompt LumiRPEngine would send is kept and logged, for a world chat only", async () => {
    const { rig, chatId, input } = await setup(7873);
    expect(await rig.rt.loopback.tag(input({ dryRun: true }))).toEqual({});
    const kept = rig.rt.loopback.dryRunOf(chatId, rig.host.userId);
    expect(kept?.messages.map((m) => [m.role, m.content])).toEqual([
      ["system", "You are the narrator of this story."],
      ["user", "I walk into the shop."],
    ]);
    expect(rig.host.logs.some((l) => l.startsWith("info: [LumiRPEngine] a dry run of this world chat") && l.includes("2 messages"))).toBe(true);
    // Another account never reads it.
    expect(rig.rt.loopback.dryRunOf(chatId, "someone-else" as typeof rig.host.userId)).toBeNull();
    // A chat that isn't a world chat keeps nothing.
    const plain = rig.host.createChat("Hi.");
    expect(await rig.rt.loopback.tag(input({ chatId: plain, dryRun: true }))).toEqual({});
    expect(rig.rt.loopback.dryRunOf(plain, rig.host.userId)).toBeNull();
  });
});

describe("a dry run in GM → Depth → Turn", () => {
  test("the Turn view's read carries the chat's last dry run on the loopback, and nothing before one", async () => {
    const { rig, chatId, input } = await setup(7874);
    rig.body(await rig.send({ type: "lre.bootstrap", chatId, op: "opt", on: true }));
    expect(rig.body(await rig.send({ type: "lre.depth", chatId, op: "scene" })).dryRun).toBeNull();
    await rig.rt.loopback.tag(input({ dryRun: true }));
    const dryRun = rig.body(await rig.send({ type: "lre.depth", chatId, op: "scene" })).dryRun as { at: number; messages: unknown[] } | null;
    expect(typeof dryRun?.at).toBe("number");
    expect(dryRun?.messages.length).toBeGreaterThan(0);
  });
});

describe("a dry run in GM → This chat → Inspector", () => {
  test("a world chat off depth: the Inspector's read carries the narrator's prompt its last dry run would send, and nothing before one", async () => {
    const { rig, chatId, input } = await setup(7875);
    expect(rig.body(await rig.send({ type: "lre.depth", chatId, op: "dry_run" })).dryRun).toBeNull();
    await rig.rt.loopback.tag(input({ dryRun: true }));
    const dryRun = rig.body(await rig.send({ type: "lre.depth", chatId, op: "dry_run" })).dryRun as { at: number; messages: { role: string; content: string }[] } | null;
    expect(typeof dryRun?.at).toBe("number");
    expect(dryRun?.messages.map((m) => [m.role, m.content])).toEqual([
      ["system", "You are the narrator of this story."],
      ["user", "I walk into the shop."],
    ]);
  });

  test("an Impersonate's dry run keeps the prompt its narrator would write the player's next message from: the body as given", async () => {
    const { rig, chatId, input } = await setup(7876);
    await rig.rt.loopback.tag(input({ dryRun: true, generationType: "impersonate" }));
    const dryRun = rig.body(await rig.send({ type: "lre.depth", chatId, op: "dry_run" })).dryRun as { messages: { role: string; content: string }[] } | null;
    expect(dryRun?.messages.map((m) => m.content)).toEqual(["You are the narrator of this story.", "I walk into the shop."]);
  });
});

describe("a world chat's generation with no relay running", () => {
  test("puts a flag on the chat saying why, with Settings → Loopback; a running relay puts none", async () => {
    const rig = new Rig();
    // A loopback connection by its model alone, with no relay of the player's registered.
    rig.host.connectionProfiles.push({ id: "conn-bare", name: "Loopback", models: [LOOPBACK_MODEL], provider: "custom", url: "http://127.0.0.1:7875/v1" });
    rig.host.contextConnectionId = "conn-bare";
    const chatId = await rig.worldChat();
    rig.host.sendUser(chatId, "I walk into the shop.");
    await rig.host.settle();
    const g = await rig.host.begin(chatId, { type: "normal" });
    expect(typeof g.parameters?.lre_turn).toBe("string");
    await rig.host.settle();
    const said = rig.host.chat(chatId).messages.findLast((m) => m.isUser);
    const chip = (await rig.rt.chips.list(chatId, rig.host.userId)).find((c) => c.id === `needs_loopback:relay:${said?.id}`);
    expect(chip).toMatchObject({ kind: "needs_loopback", messageId: said?.id, label: "The loopback relay isn't running", actions: [{ id: "loopback", label: "Settings → Loopback", input: { type: "settings", label: "Settings → Loopback", page: "loopback" } }], expires: "next_send" });
    expect(chip?.detail).toContain("start one with the line in Settings → Loopback");

    const ready = await setup(7876);
    ready.rig.host.sendUser(ready.chatId, "I walk into the shop.");
    await ready.rig.host.settle();
    await ready.rig.host.begin(ready.chatId, { type: "normal" });
    await ready.rig.host.settle();
    expect((await ready.rig.rt.chips.list(ready.chatId, ready.rig.host.userId)).filter((c) => c.id.startsWith("needs_loopback:relay:"))).toEqual([]);
  });
});

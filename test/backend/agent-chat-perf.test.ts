// What a long agents chat costs once it is open (DESIGN §9.6), on a smaller chat than the perf
// script's (`scripts/perf/agent-chat.ts`), played in-test by the same scripted models and opened again
// as after a restart, the backend talking to the host through a port that copies what crosses it and
// counts its round trips. The GM's warm reads take a couple of round trips, however long the chat;
// the state view reuses what its first build worked out, so warm builds, and the views pushed during
// a turn, cost a fraction of that first build. Bounds are generous ratios, never timings.

import { expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import { dumpHost, ipcPort, restoreHost } from "../../scripts/perf/fixture";
import { AGENT_CHAT_PAGE, agentChat, playTurn, replyText, scripted, userText } from "../support/agent-chat";
import { FakeHost } from "../support/fake-host";
import { Rig } from "../support/rig";

const TURNS = 40;
const WARM_VIEWS = 5;

const median = (xs: readonly number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

/** Everything the backend started is done: the host's events and writes, and the pushes they asked for. */
async function settled(rig: Rig): Promise<void> {
  await rig.host.settle();
  await rig.rt.push.settle();
  await rig.host.settle();
}

test("on a long agents chat opened again, warm GM reads take two round trips at most, and views after the first reuse what it worked out", async () => {
  // The chat, played in one backend.
  let turn = 0;
  const played = new FakeHost();
  played.quietReply = scripted(() => turn);
  const player = new Rig({ shipped: true, minds: true, host: played, port: (h) => ipcPort(h) });
  const chatId = await agentChat(player);
  for (; turn < TURNS; turn++) await playTurn(player, chatId, turn);
  await settled(player);
  expect(player.rt.ledger.errors).toEqual([]);

  // Opened again in another, as after a restart.
  const host = restoreHost(dumpHost(played));
  host.quietReply = scripted(() => turn);
  const trips = { n: 0 };
  const rig = new Rig({ shipped: true, minds: true, host, port: (h) => ipcPort(h, { trips }) });
  const timed = async (fn: () => Promise<unknown>): Promise<number> => {
    const t0 = performance.now();
    await fn();
    return performance.now() - t0;
  };
  const first = await timed(() => rig.rt.view(chatId, rig.host.userId));
  const warm: number[] = [];
  for (let i = 0; i < WARM_VIEWS; i++) warm.push(await timed(() => rig.rt.view(chatId, rig.host.userId)));
  rig.body(await rig.send({ type: "lre.hello", chatId }, AGENT_CHAT_PAGE));
  await settled(rig);

  // Each GM read, asked twice: the second is warm.
  const reads: Record<string, number> = {};
  for (const request of [{ type: "lre.workspace", op: "list" }, { type: "lre.workspace", op: "session" }, { type: "lre.assistant", op: "get" }] as const) {
    const ask = async (): Promise<number> => {
      const before = trips.n;
      rig.body(await rig.send({ ...request, chatId } as JsonObject, AGENT_CHAT_PAGE));
      return trips.n - before;
    };
    await ask();
    reads[`${request.type} ${request.op}`] = await ask();
  }

  // One more turn: the views its pushes build.
  const pushed: number[] = [];
  const view = rig.rt.view.bind(rig.rt);
  rig.rt.view = async (id, userId) => {
    const t0 = performance.now();
    const v = await view(id, userId);
    pushed.push(performance.now() - t0);
    return v;
  };
  await rig.turn(chatId, userText(turn), replyText(turn, 0));
  await settled(rig);
  rig.rt.view = view;
  expect(rig.rt.ledger.errors).toEqual([]);

  expect(reads).toEqual({ "lre.workspace list": expect.any(Number), "lre.workspace session": expect.any(Number), "lre.assistant get": expect.any(Number) });
  for (const n of Object.values(reads)) expect(n).toBeLessThanOrEqual(2);
  // A warm build costs a fraction of the first, which folds the chat.
  expect(median(warm) * 5).toBeLessThan(first);
  // A turn's pushed views together cost well under as many first builds.
  expect(pushed.length).toBeGreaterThan(0);
  expect(pushed.reduce((s, ms) => s + ms, 0) * 4).toBeLessThan(first * pushed.length);
}, 120_000);

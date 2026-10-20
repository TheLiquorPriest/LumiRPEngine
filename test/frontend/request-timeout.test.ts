// The tab's wait for each answer is the user's Engine requests timeout (Settings → Timeouts): the
// hello's answer carries it and every settings answer updates it; "none" waits for good, and a
// request that runs out says which setting to raise.

import { describe, expect, test } from "bun:test";
import { ProtocolClient, type Transport } from "../../src/frontend/protocol-client";
import { PROTOCOL_VERSION } from "../../src/shared/protocol";

function rig() {
  let deliver: (payload: unknown) => void = () => undefined;
  const sent: { type: string; reqId: string }[] = [];
  const transport: Transport = {
    send: (payload) => void sent.push(payload as { type: string; reqId: string }),
    subscribe(handler) {
      deliver = handler;
      return () => undefined;
    },
  };
  const timers: { fn: () => void; ms: number }[] = [];
  const client = new ProtocolClient(transport, { schedule: (fn) => fn(), timers: { set: (fn, ms) => timers.push({ fn, ms }), clear: () => undefined } });
  const answer = (request: string, body: unknown) => {
    const last = sent.at(-1);
    deliver({ lre: PROTOCOL_VERSION, type: "lre.result", reqId: last?.reqId, request, body });
  };
  return { client, timers, answer };
}

describe("the request timeout", () => {
  test("is the user's setting, from the hello's answer and from each settings answer", async () => {
    const { client, timers, answer } = rig();
    const hello = client.open(null);
    expect(timers.at(-1)?.ms).toBe(300_000);
    answer("lre.hello", { accepted: true, agentApi: 1, requestMs: 900_000 });
    await hello;
    void client.send({ type: "lre.settings.get" });
    expect(timers.at(-1)?.ms).toBe(900_000);
    answer("lre.settings.get", { settings: { timeouts: { requestMs: 2_700_000 } }, extraction: {} });
    void client.send({ type: "lre.settings.get" });
    expect(timers.at(-1)?.ms).toBe(2_700_000);
    answer("lre.settings.get", { settings: { timeouts: { requestMs: "none" } }, extraction: {} });
    const count = timers.length;
    void client.send({ type: "lre.settings.get" });
    expect(timers.length).toBe(count);
  });

  test("one that runs out names the setting to raise", async () => {
    const { client, timers } = rig();
    const reply = client.send({ type: "lre.settings.get" });
    timers.at(-1)?.fn();
    const message = await reply;
    expect(message).toMatchObject({ type: "lre.error", code: "unavailable" });
    expect(message.type === "lre.error" ? message.message : "").toContain("No reply from the engine within 5 min (Settings → Timeouts → Engine requests)");
  });
});

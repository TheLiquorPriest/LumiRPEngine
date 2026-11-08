// The guard fails closed on the loopback (the depth release's security review, M4; DEPTH-PLAN §3.14):
// a world chat's reply whose GENERATION_STARTED LumiRPEngine never heard can't be tied to a turn,
// so the guard stops it and the chat says the reply didn't start, rather than let it go on untagged
// to run as passthrough with no engine run and no record. The next reply whose start is heard plays.

import { expect, test } from "bun:test";
import { readyLoopback } from "../support/relay";
import { Rig } from "../support/rig";

test("a world chat's reply on the loopback whose start wasn't heard is stopped by the guard, and the chat says so; the next one plays", async () => {
  const rig = new Rig();
  const { host } = rig;
  const { connectionId } = await readyLoopback(rig, 7861);
  host.contextConnectionId = connectionId;
  const chatId = await rig.worldChat();
  host.sendUser(chatId, "I walk into the shop.");
  await host.settle();
  host.lost.add("GENERATION_STARTED");
  const unheard = await host.begin(chatId, { type: "normal" });
  expect(unheard.halted).toBe("cancelled");
  expect(unheard.parameters?.lre_turn).toBeUndefined();
  const view = rig.body(await rig.send({ type: "lre.state.get", chatId })).view as { chips: { kind: string; label: string; detail?: string }[] };
  const flag = view.chips.find((c) => c.kind === "engine_failed");
  expect(flag?.label).toBe("The reply didn't start, so nothing was generated");
  expect(flag?.detail).toContain("didn't hear this reply start");
  const heard = await host.begin(chatId, { type: "normal" });
  expect(heard.halted).toBeUndefined();
  expect(typeof heard.parameters?.lre_turn).toBe("string");
});

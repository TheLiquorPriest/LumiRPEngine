// The rig's scripted models (PlanScenarios-2 items 4 and 8): each agent answers from its own list whatever order its
// calls come in, a call held at a gate stays open until the scenario opens it, and a reply's delays run in real time.

import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { definitionsOf, identify, paced, RigModels } from "../../../scripts/proof/rig/scripts";

const GUIDANCE = resolve(import.meta.dir, "..", "..", "..", "guidance");

test("every shipped agent is told by the opening words of its own definition, and a request that holds none or two is no agent's", () => {
  const definitions = definitionsOf(GUIDANCE);
  expect([...definitions.keys()]).toContain("author");
  expect([...definitions.keys()]).toContain("gm");
  const author = [{ role: "system", content: `before ${definitions.get("author")} after` }];
  expect(identify(author, definitions)).toEqual({ agent: "author" });
  expect(identify([{ role: "system", content: "nothing of theirs" }], definitions)).toHaveProperty("fault");
  const both = [{ role: "system", content: `${definitions.get("author")} ${definitions.get("gm")}` }];
  expect(identify(both, definitions)).toHaveProperty("fault");
});

test("a reply's delays are set in its pieces: to the first thinking, the first word, between words, and its end", () => {
  const out = paced([{ thinking: "hm" }, { text: "one" }, { text: "two" }], { firstThinking: 10, firstWord: 30, between: 5, end: 7 });
  expect(out).toEqual([{ wait: 10 }, { thinking: "hm" }, { wait: 20 }, { text: "one" }, { wait: 5 }, { text: "two" }, { wait: 7 }]);
});

test("a call held at a gate stays open until the gate is opened, and delays run in real time", async () => {
  const definitions = definitionsOf(GUIDANCE);
  const models = new RigModels({ definitions });
  const gate = models.gate();
  models.add("gm", { pieces: [{ hold: gate }, { text: "held reply" }] });
  const { streamFn, model } = await models.source.agentModel({ user: "u", connectionId: null, model: null });
  // The transcript context the harness gives carries a brand that only its own code makes; the rig reads only its messages.
  const contextOf = (agent: string) => ({ messages: [{ role: "system", content: definitions.get(agent) ?? "", timestamp: 0 }] }) as unknown as Parameters<typeof streamFn>[1];
  const stream = await streamFn(model, contextOf("gm"), {});
  let done = false;
  void stream.result().then(() => (done = true));
  // A held call is open as long as nothing opens its gate: the stream is given a moment, once, to show it goes on.
  await Bun.sleep(60);
  expect(done).toBe(false);
  gate.open();
  const message = await stream.result();
  expect(JSON.stringify(message.content)).toContain("held reply");
  expect(models.seen.map((s) => s.agent)).toEqual(["gm"]);

  models.add("author", { pieces: paced([{ text: "slow" }], { firstWord: 120 }) });
  const started = Date.now();
  await (await streamFn(model, contextOf("author"), {})).result();
  expect(Date.now() - started).toBeGreaterThanOrEqual(110);
});

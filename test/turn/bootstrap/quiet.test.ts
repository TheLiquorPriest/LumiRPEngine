// Nothing starts the bootstrap but the player (plan §12, §13.5): ten turns of a chat with a past the window
// leaves out, covered by nothing, start no job of any kind, and the chat's page lists no bootstrap job.
// Played through the stand-in Lumiverse on the scripted model. Every name and text is invented.

import { afterEach, expect, test } from "bun:test";
import { BOOTSTRAP_CHAT_PATH, type BootstrapChat } from "../../../src/turn/bootstrap";
import { CHAT, CONNECTION, PRESET, replying, settledTurn, USER } from "../bed";
import { type BootBed, openBootBed } from "./rig";

let boot: BootBed | null = null;
afterEach(async () => {
  await boot?.b.close();
  boot = null;
});

test("ten turns of a chat that has no bootstrap job start none, nor any other job", async () => {
  const past = Array.from({ length: 12 }, (_, i) => ({ id: `m-past-${i}`, role: i % 2 === 0 ? ("assistant" as const) : ("user" as const), content: `An older line of the story, number ${i + 1}.` }));
  boot = await openBootBed({ global: "history:\n  window: 4\n", messages: past, answers: Array.from({ length: 10 }, (_, i) => replying(`Wren answers, the ${i + 1}th time.`)) });
  const { b, call } = boot;
  for (let i = 0; i < 10; i++) {
    b.host.send(CHAT, `I ask Wren about the lamp, the ${i + 1}th time.`);
    const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
    expect(out.error).toBeNull();
    await settledTurn(b, out.generationId!);
  }
  expect(b.model.requests).toHaveLength(10);
  expect((await b.turns.harness.jobs.list({ user: USER })).jobs).toEqual([]);
  const page = await call<BootstrapChat>("GET", BOOTSTRAP_CHAT_PATH, { chat: CHAT });
  expect(page.body.underWay).toEqual([]);
  // The past the window leaves out is there, uncovered: what a bootstrap would be for, had the player started one.
  expect(page.body.facts.history).toMatchObject({ known: true, messages: 32, leftOut: 28, covered: 0 });
});

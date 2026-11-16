// The tools' answers keep the values of their last use: each line a call says is kept, with the fields it was filled with, as the answers
// part's last use in that call's chat, and a chat that never said a line has none. Every name is invented.

import { expect, test } from "bun:test";
import type { JsonObject, Scope } from "rp-harness/contract";
import { engineTools } from "../../src/iface/index";
import { CHAT, rig, USER } from "./rig";

test("a refusal said in chat A is kept with its fields for chat A, and chat B has none", async () => {
  const kept = new Map<string, Record<string, JsonObject>>();
  const t = await rig({
    lastUse: (scope: Scope, part, lines) => {
      const key = `${scope.chat}/${part}`;
      kept.set(key, { ...(kept.get(key) ?? {}), ...lines });
    },
  });
  const tools = new Map((await engineTools(t.deps)).map((x) => [x.name, x]));
  const run = (chat: string) => tools.get("world_apply")!.run({ operations: [{ op: "move", who: "nobody_here", to: "the cellar" }] }, { scope: { user: USER, chat, session: "s-1", turn: t.turn.id }, agent: { id: "gm-1", definition: "gm" }, run: "run-1", callId: `call-${Math.random()}`, signal: new AbortController().signal, onUpdate: () => undefined });
  await run(CHAT);
  const a = kept.get(`${CHAT}/engine-answers`);
  expect(a).toBeDefined();
  expect(a?.unknown).toMatchObject({ name: "nobody_here", op: "move" });
  expect(kept.get("chat-b/engine-answers")).toBeUndefined();
});

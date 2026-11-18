// A world's quest whose way on an action makes hold (plan §8.3: only an agent moves it): the answer of the act says the quest can move
// on and gives the call that moves it, the world state says it at the next turn, and the turn's card says the flag that was set. Every
// name here is invented.

import { expect, test } from "bun:test";
import type { JsonObject } from "rp-harness/contract";
import { trackStanding } from "../../src/engine/tracks";
import { playAnswers } from "../../src/play/service";
import { worldState } from "../../src/store/world-state";
import { RPE_GUIDANCE } from "../../src/tree";
import { changeSaid } from "../../src/turn/card-words";
import { POV, SHIPPED_LAYOUT } from "../store/fixtures";
import { familyRig, SRC } from "./families/kit";
import { texts } from "./rig";

test("an action's flag that opens a quest's way on is told to the Author, with the call that moves it, and said in words", async () => {
  const t = await familyRig((w) => {
    w.tracks.errand = {
      id: "errand",
      kind: "quest",
      label: "The warden's errand",
      start: "go",
      visibility: "public",
      stages: { go: { label: "Set out", next: [{ to: "done", when: "flag('letter_given')" }], objectives: [{ label: "Hand the warden the letter", when: "flag('letter_given')" }] }, done: { label: "Handed over", next: [] } },
    };
    w.actions.give_letter = { id: "give_letter", label: "Hand over the letter", params: {}, requires: [], outcomes: { default: [{ type: "story.flag", args: { name: "letter_given", value: true } }] }, duration: "5" };
  });
  const r = await t.call("world_apply", { operations: [{ op: "act", action: "give_letter", who: POV, ...SRC } as JsonObject] });
  expect(r.error).toBeUndefined();
  expect(texts(r).join("\n")).toContain(`This lets the quest The warden's errand [errand] move on from Set out to Handed over. Nothing moves it but a call: world_apply with {"op":"quest","quest":"errand","stage":"done","outcome":"met"}, and your reason as why.`);

  // The quest has not moved: its objective is met and its way on holds, as the pages read it.
  const state = t.s.stateAt(t.turn.id).state.world;
  const doc = t.deps.env.worlds(state.revision);
  if (doc === undefined) throw new Error("the rig's world is kept");
  const standing = trackStanding(t.deps.env.registry, { state, ctx: t.deps.env.registry.context(doc, state) });
  expect([state.tracks.errand?.stage ?? "go", standing.objectives(doc.tracks.errand as never, "go"), standing.way("errand")]).toEqual(["go", [{ label: "Hand the warden the letter", met: true }], { from: "go", to: "done", fails: false }]);

  // The turn's card says the flag in words; the next turn's world state says the way on, with its call.
  const flag = t.s.changes(t.turn.id).find((c) => c.op === "story.flag");
  expect(flag === undefined ? undefined : changeSaid(await playAnswers(RPE_GUIDANCE), t.deps.env.registry, doc, state, flag)).toBe("The story flag “letter given” is set");
  await t.writes.run(() => t.s.tieTurn(t.turn.id, { message: "msg-1", hash: "hash-1" }), "tying the turn");
  const next = await t.writes.run(() => t.s.beginTurn({ chat: t.turn.chat, kind: "normal" }), "the next turn");
  expect(worldState(t.s, { chat: t.turn.chat, turn: next.id, layout: SHIPPED_LAYOUT, charsPerToken: 4 }).text).toContain(`The warden's errand [errand] (quest): Set out. Its way on to Handed over holds now: nothing moves it but a call, world_apply with {"op":"quest","quest":"errand","stage":"done","outcome":"met"} and your reason as why`);
});

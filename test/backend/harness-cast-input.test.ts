// What an agent passes a tool is what a model said: every string of a call's arguments is
// neutralised where the call enters the engine (`runHarnessTool`), before any tool reads it, so no
// tool stores or echoes a host macro, a `<user>`-style shorthand or a control character, and a tool
// added later is covered without anyone thinking of it. Proven through the bridge's own turn on
// tools of three kinds: one of the old engines' that stages through the writer, one of the harness
// engine's own that is given JSON text among its arguments, and one that writes the world's draft
// from JSON text.

import { describe, expect, test } from "bun:test";
import { worldBuild } from "../../src/backend/agents/tools/harness-ports";
import type { JsonObject } from "../../src/shared/json";
import { HOME } from "../support/tools";
import { noModelCalls } from "./harness-cast-kit";
import { AUTHOR, beginTurn, harnessChat, stateOf } from "./harness-driver";

/** What the host's macro engine would act on, or a control character. */
const HAZARD = /\{\{|<(?:user|char|bot)>|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/i;

/** Every string in `value`, an object's keys among them. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "object" && value !== null) return Object.entries(value).flatMap(([key, inner]) => [key, ...strings(inner)]);
  return [];
}

describe("what an agent passes a tool", () => {
  test("is neutralised before any tool reads it: a macro, a shorthand and a control character reach neither the state, the world's draft nor an answer", async () => {
    const { rig, chatId } = await harnessChat();
    // New people land with the turn here, so what was stored can be read back.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { gm_spawn: { mode: "auto" } } } }));
    const build = await worldBuild(rig.rt, chatId, rig.host.userId);
    if (!build) throw new Error("the harness chat plays no world");
    const before = { state: new Set(strings(await stateOf(rig, chatId))), draft: new Set(strings((await build.edit({ op: "get" })).draft)) };

    const turn = await beginTurn(rig, chatId, "I ask who keeps the lamps lit.");
    const calls: [string, JsonObject][] = [
      ["item_make", { name: "a {{getvar::k}} lantern", at: HOME, why: "a lantern hangs by the door <user>" }],
      ["person_make", { name: "Brann {{user}} \u0001x\u0002", place: HOME, why: "the lamplighter comes by", fields: JSON.stringify({ occupation: "lamplighter to {{char}}" }) }],
      ["world_put", { collection: "lore", id: "old_lamps", value: JSON.stringify({ title: "The {{user}} lamps", content: "<char> lit them\u0002 once.", keys: ["lamps"], links: [] }) }],
    ];
    const answers: unknown[] = [];
    for (const [name, args] of calls) answers.push(JSON.parse((await turn.call(AUTHOR, name, args)).text));
    answers.push(await turn.answer(AUTHOR, "commit"));
    await turn.finish("Brann does, Mara says.");

    const stored = strings(await stateOf(rig, chatId)).filter((s) => !before.state.has(s));
    const drafted = strings((await build.edit({ op: "get" })).draft).filter((s) => !before.draft.has(s));
    expect([...stored, ...drafted, ...strings(answers)].filter((s) => HAZARD.test(s))).toEqual([]);
    // The neutralised forms are what was kept: the lantern in play, and the lore entry in the draft, its JSON still read as JSON.
    expect(stored).toContain("a ｛｛getvar::k｝｝ lantern");
    expect(drafted).toContain("The ｛｛user｝｝ lamps");
    expect(drafted).toContain("＜char＞ lit them once.");
    noModelCalls(rig);
  });
});

// The Stance section in the prompt (DESIGN §6.2, §6.6): the shipped note leads it, it spends the
// section budget at its own rank like any section, a world's own sections rank it, and the helpers'
// fact lines leave it out.

import { describe, expect, test } from "bun:test";
import { DEFAULT_SECTIONS, sectionTokens } from "../../src/backend/book";
import { factLines } from "../../src/backend/turn-steps";
import { createRegistry } from "../../src/engine/registry-impl";
import { placeOfEntity } from "../../src/engine/scope";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";
import { Rig } from "../support/rig";

/** What a dry run of the chat's next prompt carried, by section label: a clipped section isn't there. */
async function sent(rig: Rig, chatId: string, budget: number): Promise<Map<string, string>> {
  rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { tokens: { sections: budget } } } }));
  await rig.host.dryRun(chatId);
  const out = new Map<string, string>();
  for (const m of rig.host.lastInterceptor?.mutated ?? []) {
    const label = /^\[([^\]]+)\]\n/.exec(m.content ?? "")?.[1];
    if (label !== undefined) out.set(label, m.content ?? "");
  }
  return out;
}

describe("the Stance section on the section budget", () => {
  test("it opens with the shipped note, goes last by default, and goes where a world ranks it", async () => {
    const rig = new Rig({ shipped: true });
    // The host can't count: every section is priced by the estimate, so the same text costs the same.
    rig.host.tokenCount = null;
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const first = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId: first }));
    const all = await sent(rig, first, 100_000);
    const stance = all.get("Stance") ?? "";
    const note = (DEFAULT_SECTIONS.stance?.template ?? "").split("{{lines}}")[0] ?? "";
    expect(note.trim()).not.toBe("");
    expect(stance.startsWith(`[Stance]\n${note}`)).toBe(true);
    expect(stance).toContain("Danny Okafor");
    // A budget of exactly what the other sections cost: Stance, ranked last, is the one left out.
    const others = [...all].filter(([label]) => label !== "Stance").reduce((sum, [, text]) => sum + sectionTokens(text), 0);
    const tight = await sent(rig, first, others);
    expect([...tight.keys()].sort()).toEqual([...all.keys()].filter((label) => label !== "Stance").sort());
    // A world that ranks Stance just after the Scene keeps it on the same budget; a section ranked after it gives way.
    const sections = { ...DEFAULT_SECTIONS, stance: { ...DEFAULT_SECTIONS.stance!, rank: 2.5 } };
    for (const [id, value] of Object.entries(sections)) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "sections", id, value }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const second = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId: second }));
    const ranked = await sent(rig, second, others);
    expect(ranked.get("Stance")).toBe(stance);
    const left = [...all.keys()].filter((label) => !ranked.has(label));
    expect(left.length).toBeGreaterThan(0);
    for (const label of left) expect(Object.values(sections).find((s) => s.label === label)?.rank ?? 0).toBeGreaterThan(2.5);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("the helpers' fact lines leave it out: a cue is for the narrator to play, not a fact to state", () => {
    const reg = createRegistry(ALL_PACKS);
    const world = modernUsWorld("w", "R");
    world.entities.maya!.cues = [{ text: "keeps glancing at the back room", flag: "back_room_found" }];
    const state = startState(world);
    state.entities.maya!.fields.place = placeOfEntity(state, world.pov);
    const stance = reg.renderers.filter((r) => r.slot === "stance").flatMap((r) => r.render(reg.context(world, state)));
    expect(stance.join("\n")).toContain("keeps glancing at the back room");
    const facts = factLines(reg, world, state, []);
    expect(facts.some((line) => line.startsWith("Maya Chen"))).toBe(true);
    expect(facts.join("\n")).not.toContain("keeps glancing at the back room");
  });
});

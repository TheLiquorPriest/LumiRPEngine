// The Stance section in the prompt (DESIGN §6.2, §6.6): the shipped note leads it, it spends the
// section budget at its own rank like any section, a world's own sections rank it, its cues ride last
// and count in nothing the player sees, and the helpers' fact lines leave it out.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import { DEFAULT_SECTIONS, sectionTokens } from "../../src/backend/book";
import { factLines } from "../../src/backend/turn-steps";
import { createRegistry } from "../../src/engine/registry-impl";
import { placeOfEntity } from "../../src/engine/scope";
import { ALL_PACKS } from "../../src/packs/index";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";
import { Rig } from "../support/rig";

/**
 * What the chat's next reply's prompt carried, by section label (a clipped section isn't there): the
 * last reply is swiped as a Re-narrate, so each call renders the same turn's sections again.
 */
async function sent(rig: Rig, chatId: string, budget: number): Promise<Map<string, string>> {
  rig.body(await rig.send({ type: "lre.settings.set", patch: { swipeDefault: "renarrate", modelUse: { tokens: { sections: budget } } } }));
  const g = await rig.host.start(chatId, { type: "regenerate" });
  const out = new Map<string, string>();
  for (const m of rig.host.assembled) {
    const label = /^\[([^\]]+)\]\n/.exec(m.content)?.[1];
    if (label !== undefined) out.set(label, m.content);
  }
  await rig.host.finish(g, "Quiet.");
  return out;
}

const CUE = "keeps checking his phone and pockets it when you look";

/** A Port Alder chat where Danny has a cue for secret lore whose gate is `gate`: kept while it doesn't hold. */
async function cueChat(rig: Rig, gate: string): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const { draft } = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })) as { draft: { entities: Record<string, JsonObject> } };
  const lore = { id: "bookmaker", title: "The bookmaker's ledger", content: "Danny owes a bookmaker in Green Bay more than he makes in a season.", keys: [], links: [], secret: true, gate };
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id: "bookmaker", value: lore }));
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: "danny_okafor", value: { ...draft.entities.danny_okafor, cues: [{ text: CUE, lore: "bookmaker" }] } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return chatId;
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

  test("its cues ride in what the budget has left, and the Context panel shows the same whether a cue's secret is kept or out", async () => {
    const rig = new Rig({ shipped: true });
    rig.host.tokenCount = null;
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { tokens: { sections: 100_000 } } } }));
    const kept = await cueChat(rig, "false");
    const out = await cueChat(rig, "true");
    for (const chatId of [kept, out]) await rig.turn(chatId, "I look around.", "Quiet.");
    // The narrator gets the cue only while its secret is kept; the player's Context row for Stance is the same either way.
    const row = (chatId: string) => rig.rt.inspectorRecords(chatId)?.at(-1)?.sections.find((s) => s.slot === "stance");
    expect(row(kept)).toBeDefined();
    expect(row(kept)).toEqual(row(out));
    expect((await sent(rig, out, 100_000)).get("Stance")).not.toContain(CUE);
    const all = await sent(rig, kept, 100_000);
    const stance = all.get("Stance") ?? "";
    expect(stance).toContain(CUE);
    // Room for every section's own lines and no more: Stance goes in without its cue rather than being left out.
    const bare = stance
      .split("\n")
      .filter((line) => !line.includes(CUE))
      .join("\n");
    const others = [...all].filter(([label]) => label !== "Stance").reduce((sum, [, text]) => sum + sectionTokens(text), 0);
    expect((await sent(rig, kept, others + sectionTokens(bare))).get("Stance")).toBe(bare);
    expect((await sent(rig, kept, others + sectionTokens(stance))).get("Stance")).toBe(stance);
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

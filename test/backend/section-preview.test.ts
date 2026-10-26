// GM → This chat → Sections' preview (DESIGN §6.11): what each section would give the narrator,
// built as a turn builds it, so for the same state it is the text the turn delivers; the GM's caps
// and scopes apply, a fact beyond the player character's shows its mark, and a section switched off
// says so.

import { describe, expect, test } from "bun:test";
import { DEFAULT_SECTIONS } from "../../src/backend/book";
import type { Delivered } from "../../src/backend/ledger-io";
import { markedText } from "../../src/engine/feed";
import { editRequest } from "../../src/frontend/requests";
import type { JsonObject } from "../../src/shared/json";
import type { EditOp, ResultBodies } from "../../src/shared/protocol";
import { Rig } from "../support/rig";

const SECRET = "Vex Morrow";
const lurker: Record<string, JsonObject> = { lurker: { id: "lurker", kind: "person", name: SECRET, tier: "background", fields: { place: "harbor_street_114" }, relations: [], visibility: "secret" } };
const crowd: Record<string, JsonObject> = Object.fromEntries(["ana", "ben", "cal", "dee"].map((id): [string, JsonObject] => [id, { id, kind: "person", name: `${id.toUpperCase()} Neighbour`, tier: "background", fields: { place: "harbor_street_114" }, relations: [] }]));

/** A Port Alder chat with these people in it. */
async function alder(rig: Rig, entities: Record<string, JsonObject>): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
  for (const [id, value] of Object.entries(entities)) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "entities", id, value }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return chatId;
}

async function edit(rig: Rig, chatId: string, op: EditOp): Promise<void> {
  rig.body(await rig.send(editRequest(chatId, [op]) as unknown as Record<string, unknown>));
}

async function preview(rig: Rig, chatId: string): Promise<ResultBodies["lre.sections"]> {
  return rig.body(await rig.send({ type: "lre.sections", chatId })) as unknown as ResultBodies["lre.sections"];
}

const bullets = (content: string | null | undefined): string[] => (content ?? "").split("\n").filter((l) => l.startsWith("- "));

describe("the section preview", () => {
  test("for the state a turn delivers from, each section the turn doesn't write itself is the text it delivers", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alder(rig, { ...lurker, ...crowd });
    // A scope that marks, and a cap, so both are in what is compared.
    await edit(rig, chatId, { op: "feed", section: "people", to: { scope: "gm" } });
    await edit(rig, chatId, { op: "feed", section: "place", to: { maxLines: 2 } });
    const pairs: { delivered: Delivered; previewed: ResultBodies["lre.sections"] }[] = [];
    const deliver = rig.rt.deliver.bind(rig.rt);
    rig.rt.deliver = async (input) => {
      const previewed = await rig.rt.previewSections(input.chatId, input.userId, input.core, input.observed);
      const delivered = await deliver(input);
      pairs.push({ delivered, previewed });
      return delivered;
    };
    await rig.turn(chatId, "I look around.", "Quiet.");
    const pair = pairs.at(-1);
    if (!pair) throw new Error("no turn was delivered");
    const byLabel = new Map([...pair.delivered.fills.values()].map((content) => [/^\[([^\]]+)\]/.exec(content)?.[1] ?? "", content]));
    // The turn writes Outcome, Montage, the Outline and Scene's elapsed time itself; Minds ranks by the player's words.
    const compared = pair.previewed.sections.filter((s) => !["outcome", "montage", "outline", "scene", "minds"].includes(s.slot));
    expect(compared.filter((s) => s.status === "sent").length).toBeGreaterThan(1);
    for (const s of compared) expect(s.status === "sent" ? s.content : null).toBe(byLabel.get(s.label) ?? null);
  });

  test("the GM's cap and scope apply: the cut lines are counted, and a fact beyond the player character's shows its mark", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alder(rig, { ...lurker, ...crowd });
    const people = (await preview(rig, chatId)).sections.find((s) => s.slot === "people");
    expect(people?.content ?? "").not.toContain(SECRET);
    const all = bullets(people?.content).length;
    expect(all).toBeGreaterThan(2);
    await edit(rig, chatId, { op: "feed", section: "people", to: { maxLines: 2 } });
    const capped = (await preview(rig, chatId)).sections.find((s) => s.slot === "people");
    expect(bullets(capped?.content)).toHaveLength(2);
    expect(capped?.cut).toBeGreaterThan(0);
    await edit(rig, chatId, { op: "feed", section: "people", to: { scope: "gm" } });
    const marked = (await preview(rig, chatId)).sections.find((s) => s.slot === "people");
    expect(bullets(marked?.content)).toContain(`- ${markedText({ text: `${SECRET} is here.`, known: "gm" })}`);
    expect(marked?.marked).toBeGreaterThan(0);
  });

  test("a section switched off is told as off, with no text, and every section is listed in prompt order", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alder(rig, crowd);
    await edit(rig, chatId, { op: "feed", section: "gear", to: { enabled: false } });
    const out = await preview(rig, chatId);
    const gear = out.sections.find((s) => s.slot === "gear");
    expect(gear?.status).toBe("off");
    expect(gear?.content).toBeNull();
    const shipped = Object.values(DEFAULT_SECTIONS).sort((a, b) => a.rank - b.rank).map((s) => s.id);
    expect(out.sections.map((s) => s.slot)).toEqual(shipped);
  });
});

describe("what the sections say, in words", () => {
  test("the shipped Port Alder chat: steps name their quest, pockets aren't worn, regard has no numbers, a building isn't at itself", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alder(rig, {});
    await edit(rig, chatId, { op: "feed", section: "property", to: { scope: "gm" } });
    const sections = (await preview(rig, chatId)).sections;
    const text = (slot: string): string[] => bullets(sections.find((s) => s.slot === slot)?.content);
    // A quest's open step is a line of its own that says which quest it is: no bare list item inside the list.
    const quest = text("quest");
    expect(quest.length).toBeGreaterThan(0);
    expect(quest.filter((l) => l.startsWith("- - "))).toEqual([]);
    // What sits in a pocket and what is worn on the wrist are told apart.
    const gear = text("gear");
    const keys = gear.find((l) => l.includes("Keys"));
    const watch = gear.find((l) => l.includes("Wristwatch"));
    expect(keys).toBeDefined();
    expect(keys).not.toBe(watch);
    // How people feel toward the player character is in words.
    const feel = text("people").filter((l) => l.includes("toward you"));
    expect(feel.length).toBeGreaterThan(0);
    for (const l of feel) expect(l).not.toMatch(/\d/);
    // A building named for its place says so once.
    for (const l of text("property")) expect(l).not.toMatch(/^- (.+) at \1\b/);
  });

  test("someone here at work reads as a sentence in People, Stance and the turn's Outline, never \"is work\"", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await alder(rig, {});
    await edit(rig, chatId, { op: "move", entity: "danny_okafor", to: "harbor_street_114" });
    await edit(rig, chatId, { op: "set", entity: "danny_okafor", field: "activity", value: "work" });
    const sections = (await preview(rig, chatId)).sections;
    const about = (slot: string): string[] => bullets(sections.find((s) => s.slot === slot)?.content).filter((l) => l.includes("Danny Okafor"));
    // The raw value stands bare nowhere: not after "is", not in brackets.
    const bare = /\bis work\b|\(work\)|: work\b/;
    const lines = [...about("people"), ...about("stance")];
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(l).not.toMatch(bare);
    await rig.turn(chatId, "I nod to Danny.", "Danny nods back.");
    const outline = rig.host.assembled.find((e) => e.content.startsWith("[Outline]"))?.content ?? "";
    for (const l of outline.split("\n").filter((x) => x.includes("Danny Okafor"))) expect(l).not.toMatch(bare);
    // Someone here doing nothing in particular is simply here.
    await edit(rig, chatId, { op: "set", entity: "danny_okafor", field: "activity", value: "idle" });
    expect(bullets((await preview(rig, chatId)).sections.find((s) => s.slot === "people")?.content)).toContain("- Danny Okafor is here.");
  });
});

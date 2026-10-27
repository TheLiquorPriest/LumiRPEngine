// A world's own wording of a built-in section (DESIGN §6, `sectionTemplates`): one section reworded
// at a time, without listing the world's sections, reaches what the turn delivers and the GM's
// preview; Build's Reset puts the built-in text back; a world without it reads the built-in text.

import { describe, expect, test } from "bun:test";
import { SectionTemplateField, sectionTemplatesPatch } from "../../src/frontend/build/section-template";
import { TextInput } from "../../src/frontend/build/schema-form";
import { Button } from "../../src/frontend/components";
import type { JsonObject } from "../../src/shared/json";
import type { JsonPatchOp, ResultBodies } from "../../src/shared/protocol";
import { DEFAULT_SECTIONS } from "../../src/shared/sections";
import type { WorldDoc } from "../../src/shared/world";
import { Rig } from "../support/rig";
import { propsOf } from "../support/tree";

const OWN = "The people around you, each to be written exactly as their line gives them.\n{{lines}}";
const crowd: Record<string, JsonObject> = Object.fromEntries(["ana", "ben"].map((id): [string, JsonObject] => [id, { id, kind: "person", name: `${id.toUpperCase()} Neighbour`, tier: "background", fields: { place: "harbor_street_114" }, relations: [] }]));

/** The built-in text a section opens with, before its lines. */
const note = (id: string): string => (DEFAULT_SECTIONS[id]?.template ?? "").split("{{lines}}")[0] ?? "";

/** Port Alder with two neighbours on the street; `ops` patch its draft before the commit. */
async function alder(rig: Rig, ops: JsonPatchOp[] = []): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
  for (const [id, value] of Object.entries(crowd)) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "entities", id, value }));
  if (ops.length > 0) rig.body(await rig.send({ type: "lre.editor", op: "patch", worldId, base: draft.base, ops }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base }));
  return worldId;
}

async function chatOf(rig: Rig, worldId: string): Promise<string> {
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return chatId;
}

async function previewed(rig: Rig, chatId: string, slot: string): Promise<string> {
  const body = rig.body(await rig.send({ type: "lre.sections", chatId })) as unknown as ResultBodies["lre.sections"];
  return body.sections.find((s) => s.slot === slot)?.content ?? "";
}

describe("a world's wording of a built-in section", () => {
  test("reaches the delivered section and the preview, the other built-in sections keeping theirs", async () => {
    const rig = new Rig({ shipped: true });
    const empty: Pick<WorldDoc, "sectionTemplates"> = {};
    const worldId = await alder(rig, sectionTemplatesPatch(empty, "people", OWN));
    const doc = rig.body(await rig.send({ type: "lre.world", op: "get", worldId })).world as unknown as WorldDoc;
    // Only the one section is stored, and the world still lists none of its own.
    expect(doc.sectionTemplates).toEqual({ people: OWN });
    expect(doc.sections).toEqual({});
    const chatId = await chatOf(rig, worldId);
    const preview = await previewed(rig, chatId, "people");
    expect(preview.startsWith(`[People]\n${OWN.split("{{lines}}")[0]}`)).toBe(true);
    expect(preview).toContain("ANA Neighbour");
    await rig.turn(chatId, "I look around.", "Quiet.");
    const people = rig.host.section("People");
    expect(people.startsWith(`[People]\n${OWN.split("{{lines}}")[0]}`)).toBe(true);
    expect(people).toContain("ANA Neighbour");
    expect(rig.host.section("Scene").startsWith(`[Scene]\n${note("scene")}`)).toBe(true);
  });

  test("Reset puts the built-in text back, and a world without any wording reads the built-in text", async () => {
    // The field's Reset hands back the built-in text, and saving it stores no wording at all.
    const changes: string[] = [];
    const field = SectionTemplateField({ value: OWN, defaultText: DEFAULT_SECTIONS.people?.template ?? null, issues: [], onChange: (v) => changes.push(v) });
    const reset = propsOf(field, Button).find((p) => p.children === "Reset to default");
    if (typeof reset?.onClick !== "function") throw new Error("no Reset to default");
    (reset.onClick as () => void)();
    expect(changes).toEqual([DEFAULT_SECTIONS.people?.template ?? ""]);
    const ops = sectionTemplatesPatch({ sectionTemplates: { people: OWN } }, "people", changes[0] ?? "");
    expect(ops).toEqual([{ op: "remove", path: "/sectionTemplates" }]);

    const rig = new Rig({ shipped: true });
    const worldId = await alder(rig, [{ op: "add", path: "/sectionTemplates", value: { people: OWN } }, ...ops]);
    const doc = rig.body(await rig.send({ type: "lre.world", op: "get", worldId })).world as unknown as WorldDoc;
    expect(doc.sectionTemplates).toBeUndefined();
    const chatId = await chatOf(rig, worldId);
    expect((await previewed(rig, chatId, "people")).startsWith(`[People]\n${note("people")}`)).toBe(true);
    await rig.turn(chatId, "I look around.", "Quiet.");
    expect(rig.host.section("People").startsWith(`[People]\n${note("people")}`)).toBe(true);
  });

  test("must keep {{lines}}: the field says so, and a write without it is refused", async () => {
    const field = SectionTemplateField({ value: "The people here.", defaultText: null, issues: [], onChange: () => {} });
    const issues = propsOf(field, TextInput)[0]?.issues as { message: string }[] | undefined;
    expect(issues?.map((i) => i.message).join(" ")).toContain("{{lines}}");
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const reply = await rig.send({ type: "lre.editor", op: "patch", worldId, base: null, ops: [{ op: "add", path: "/sectionTemplates", value: { people: "The people here." } }] });
    expect(reply.type).toBe("lre.error");
  });
});

// The offline tools on the starter worlds: check, playtest, check world, and the guide, docs, schema and templates.

import { describe, expect, test } from "bun:test";
import { templateFile } from "../../src/cli/offline";
import { callTool } from "../../src/cli/tools";
import type { ToolContext } from "../../src/cli/tools";
import { client, FakeLumiverse } from "./fake-lumiverse";

async function call(ctx: ToolContext, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; data: Record<string, unknown>; isError: boolean }> {
  const result = await callTool(name, args, ctx);
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(result.text) as Record<string, unknown>;
  } catch {
    // prose answers stay text
  }
  return { text: result.text, data, isError: result.isError === true };
}

describe("offline tools", () => {
  const files = { "manor.json": JSON.stringify(templateFile("mystery_manor")), "broken.json": "{ not json" };
  const { ctx } = client(new FakeLumiverse(), { files });

  test("check, playtest and check world run a starter with the bundled engine", async () => {
    const check = await call(ctx, "lre_check", { path: "manor.json" });
    expect(check.data).toMatchObject({ ok: true, loads: true, errors: 0, world: { id: "mystery_manor", name: "Mystery manor" } });
    expect((check.data.contents as Record<string, number>).entities).toBeGreaterThan(5);
    // Every entity is counted under its own kind (the manor's people are its own `character` kind), most first.
    const manor = templateFile("mystery_manor") as { world: { entities: Record<string, { kind: string }> } };
    const expected: Record<string, number> = {};
    for (const e of Object.values(manor.world.entities)) expected[e.kind] = (expected[e.kind] ?? 0) + 1;
    expect(check.data.entityKinds).toEqual(expected);
    const counts = Object.values(check.data.entityKinds as Record<string, number>);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    const play = await call(ctx, "lre_playtest", { path: "manor.json", turns: ["look around", "wait an hour"] });
    expect((play.data.turns as { user: string }[]).map((t) => t.user)).toEqual(["look around", "wait an hour"]);
    const days = await call(ctx, "lre_check_world", { path: "manor.json", days: 1 });
    expect((days.data.days as { user: string }[]).map((t) => t.user)).toEqual(["Day 1"]);
    expect(days.text.length).toBeLessThan(24_000);
    const broken = await call(ctx, "lre_check", { path: "broken.json" });
    expect(broken.data).toMatchObject({ ok: false, loads: false });
    expect((await call(ctx, "lre_check", { path: "nowhere.json" })).text).toContain("Can't read nowhere.json");
    expect((await call(ctx, "lre_playtest", { path: "manor.json" })).text).toContain("Give turns");
  });

  test("check lists the macro hazards a world carries and the lint errors that would stop a commit", async () => {
    const file = templateFile("fantasy_town") as { world: Record<string, unknown> };
    const world = { ...file.world, pov: "nobody", lore: { ...(file.world.lore as object), note: { id: "note", title: "Note", content: "Hello {{user}}", keys: [], links: [] } } };
    const check = await call(ctx, "lre_check", { world });
    expect(check.data).toMatchObject({ ok: false, loads: true });
    expect(check.data.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "missing_pov", severity: "error" })]));
    expect(check.data.macroHazards).toEqual(expect.arrayContaining([{ path: "lore.note.content", macro: "{{user}}" }]));
  });

  test("guide, docs, schema, templates and template answer within one answer", async () => {
    const guide = await call(ctx, "lre_guide");
    expect(guide.text).toContain("# Writing LumiRPEngine worlds: a guide for agents");
    // Larger than one answer: all of it but its largest sections, which it names for a second call.
    expect(guide.text.length).toBeLessThanOrEqual(24_000);
    for (const heading of ["## How to work on a user's world", "## Character minds", "## Before you commit"]) expect(guide.text).toContain(heading);
    for (const left of ["Money", "Holdings and property"]) {
      expect(guide.text).not.toContain(`\n## ${left}\n`);
      expect(guide.text).toMatch(new RegExp(`read each with topic when the work needs it: .*"${left}" \\([\\d,]+ characters\\)`));
    }
    const money = await call(ctx, "lre_guide", { topic: "Money" });
    expect(money.text.startsWith("## Money\n")).toBe(true);
    expect(money.text).toContain("### Flows: money that moves on its own");
    const holdings = await call(ctx, "lre_guide", { topic: "Holdings and property" });
    expect(holdings.text.startsWith("## Holdings and property\n")).toBe(true);
    expect(holdings.text).toContain("### Property");
    expect((await call(ctx, "lre_guide", { topic: "A revealed secret starts one stage earlier" })).text).toContain('"when": "true"');
    expect((await call(ctx, "lre_docs", { query: "account opening", doc: "reference" })).text).toContain("REFERENCE.md ›");
    expect((await call(ctx, "lre_docs", { query: "x", doc: "nope" })).isError).toBe(true);
    expect((await call(ctx, "lre_schema", { pointer: "/properties/pov" })).text).toContain("the world schema (lre-world-v1) at /properties/pov");
    expect((await call(ctx, "lre_schema", { schema: "map" })).isError).toBe(false);
    const template = await call(ctx, "lre_template", { id: "modern_slice_of_life", pointer: "/world/tables" });
    expect(template.text).toContain("economy.catalog");
    for (const answer of [guide, template]) expect(answer.text.length).toBeLessThanOrEqual(24_000);
  });
});

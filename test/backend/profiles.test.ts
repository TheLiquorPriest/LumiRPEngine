// Build's "Start from a profile…" (DESIGN §11) through the editor path: one write to the draft,
// linted; again, nothing changes; conflicts kept or taken as asked. A chat on the committed world
// offers Use a skill with one option per skill and its odds, and Play → You shows the profile's sheet.

import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import type { LintIssue } from "../../src/shared/protocol";
import type { PaletteView, SheetSectionView } from "../../src/shared/state-view";
import type { WorldDoc } from "../../src/shared/world";
import { Rig } from "../support/rig";

/** The draft and lint an editor reply carries (the backend's own document). */
function draftOf(body: Record<string, unknown>): { doc: WorldDoc; errors: LintIssue[] } {
  if (!isRecord(body.draft) || !Array.isArray(body.lint)) throw new Error("no draft");
  // The reply is the backend's own document and lint, restated as their types.
  const lint = body.lint as unknown as LintIssue[];
  return { doc: body.draft as unknown as WorldDoc, errors: lint.filter((i) => i.severity === "error") };
}

describe("Start from a profile", () => {
  test("a profile goes into the draft in one linted write, and again changes nothing", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Brindlemere", "fantasy_town");
    const apply = async (choices: Record<string, string> = {}) => draftOf(rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "profile", profile: "modern", choices })));
    const first = await apply();
    expect(first.errors).toEqual([]);
    expect(first.doc.ruleset?.profile).toBe("modern");
    expect(first.doc.kinds.character?.fields.defense).toBeDefined();
    expect(Object.keys(first.doc.tables)).toEqual(expect.arrayContaining(["modern.levels", "modern.skills", "modern.saves"]));
    expect((await apply()).doc).toEqual(first.doc);
    expect((await rig.send({ type: "lre.editor", worldId, base: null, op: "profile", profile: "d20", choices: {} })).type).toBe("lre.error");
  });

  test("a conflicting item is kept unless the request takes the profile's", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Brindlemere", "fantasy_town");
    rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "put", collection: "checks", id: "initiative", value: { id: "initiative", dice: "1d6" } }));
    const send = async (choices: Record<string, string>) => draftOf(rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "profile", profile: "fifth", choices })));
    expect((await send({})).doc.checks.initiative).toEqual({ id: "initiative", dice: "1d6" });
    expect((await send({ "checks.initiative": "profile" })).doc.checks.initiative?.dice).toBe("d20");
  });

  test("a chat on the committed world offers each skill with its odds, and Play → You shows the profile's sheet", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Brindlemere", "fantasy_town");
    rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "profile", profile: "modern", choices: {} }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Good morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.body(await rig.send({ type: "lre.hello", chatId }));
    const view = rig.latestView(chatId);
    // The snapshot is the backend's own view model, restated as its parts' types.
    const palette = (isRecord(view) ? view.palette : null) as unknown as PaletteView | null;
    const skills = palette?.entries.find((e) => e.action === "skill_check");
    expect(skills?.options.map((o) => o.label)).toEqual(["Athletics", "Drive", "Stealth", "Computers", "Investigate", "Repair", "Notice", "Read People", "First Aid", "Persuade", "Deceive", "Intimidate"]);
    expect(skills?.options[0]?.params).toEqual({ skill: "athletics" });
    expect(skills?.options.every((o) => o.odds !== undefined)).toBe(true);
    const panels = isRecord(view) && isRecord(view.panels) ? view.panels : {};
    const you = panels["sheets.you"];
    const sections = (isRecord(you) ? you.sections : null) as unknown as SheetSectionView[] | null;
    expect(sections?.map((s) => s.title)).toEqual(["Vitals", "Abilities", "Saves", "Skills"]);
  });
});

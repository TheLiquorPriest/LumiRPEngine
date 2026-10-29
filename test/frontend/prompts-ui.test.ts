// Settings → Agents → Prompts (DESIGN §6.12): every editable text has its editor on its page, once;
// saving sends the user's own text, the shipped text word for word sends none and Reset sends null;
// a text with a bad placeholder, without one it must keep or past the length allowed can't be saved;
// and the patch it sends lands as the backend stores it.

import { describe, expect, test } from "bun:test";
import { ownTextCount, promptGroups, promptTextPatch } from "../../src/frontend/settings/agent-prompts";
import { PROMPT_PAGES, PROMPTS, promptDef, sectionPromptId, type PromptDef } from "../../src/shared/prompts";
import { Rig } from "../support/rig";

function def(id: string): PromptDef {
  const found = promptDef(id);
  if (!found) throw new Error(`no text ${id}`);
  return found;
}

describe("the Prompts page", () => {
  test("lists every editable text on its own page, once", () => {
    const listed = PROMPT_PAGES.flatMap((page) => promptGroups(page).flatMap((group) => group.defs.map((d) => d.id)));
    expect([...listed].sort()).toEqual(PROMPTS.map((d) => d.id).sort());
  });

  test("saves your own text, none for the shipped text, null on Reset, and nothing it can't send", () => {
    const scene = def(sectionPromptId("scene"));
    const id = scene.id;
    expect(promptTextPatch(scene, "Mine.\n{{lines}}", 20_000)).toEqual({ prompts: { texts: { [id]: "Mine.\n{{lines}}" } } });
    expect(promptTextPatch(scene, `${scene.text}\n`, 20_000)).toEqual({ prompts: { texts: { [id]: null } } });
    expect(promptTextPatch(scene, null, 20_000)).toEqual({ prompts: { texts: { [id]: null } } });
    expect(promptTextPatch(scene, "No lines.", 20_000)).toBeNull();
    expect(promptTextPatch(scene, "{{lines}} and {{nope}}", 20_000)).toBeNull();
    expect(promptTextPatch(scene, "Longer.\n{{lines}}", 5)).toBeNull();
    // A part of the narrator rules left empty is the user's own: that part is no longer sent.
    expect(promptTextPatch(def("narrator.preset_lead"), "", 20_000)).toEqual({ prompts: { texts: { "narrator.preset_lead": "" } } });
  });

  test("what it saves is what the backend keeps, and the home row counts your own texts", async () => {
    const rig = new Rig();
    const mine = promptTextPatch(def("narrator.preset_lead"), "", 20_000);
    if (!mine) throw new Error("not saved");
    rig.body(await rig.send({ type: "lre.settings.set", patch: mine }));
    const { prompts } = await rig.rt.settings.get(rig.host.userId);
    expect(prompts.texts["narrator.preset_lead"]).toBe("");
    expect(ownTextCount(prompts)).toBe(1);
  });
});

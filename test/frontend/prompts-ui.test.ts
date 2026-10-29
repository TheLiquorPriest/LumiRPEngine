// Settings → Agents → Prompts (DESIGN §6.12): every editable text has its editor on its page, once;
// saving sends the user's own text, the shipped text word for word sends none and Reset sends null;
// a text with a bad placeholder, without one it must keep or past the length allowed can't be saved;
// and the patch it sends lands as the backend stores it. A role's text has Test, which sends
// `lre.prompts test` with the text as written and shows whether it passed or, in words, why not.

import { describe, expect, test } from "bun:test";
import { ownTextCount, promptGroups, PromptTestRow, promptTestRequest, promptTextPatch, testable } from "../../src/frontend/settings/agent-prompts";
import { Button } from "../../src/frontend/components";
import { PROMPT_PAGES, PROMPTS, promptDef, sectionPromptId, type PromptDef } from "../../src/shared/prompts";
import type { PromptTestView } from "../../src/shared/protocol";
import { Rig } from "../support/rig";
import { labelled, propsOf } from "../support/tree";

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

describe("Test for a role's text", () => {
  const answer = def("role.read.extract.answer");
  /** Every text the row shows, flattened. */
  const words = (node: unknown): string => JSON.stringify(node);

  test("is on every role text, and on no other page's", () => {
    expect(testable(answer)).toBe(true);
    expect(testable(def("role.intent.system"))).toBe(true);
    expect(PROMPTS.filter((d) => d.page === "main" || d.page === "gm").some(testable)).toBe(false);
  });

  test("its button sends lre.prompts test with the text as written, on the open chat", () => {
    const sent: unknown[] = [];
    const row = PromptTestRow({ label: answer.label, text: "Output JSON only.", problems: [], busy: false, state: undefined, send: (text) => sent.push(promptTestRequest("chat-1", answer.id, text)) });
    const button = labelled(row, Button, `Test ${answer.label} on this chat`);
    expect(button.disabled).toBe(false);
    (button.onClick as () => void)();
    expect(sent).toEqual([{ type: "lre.prompts", op: "test", chatId: "chat-1", id: answer.id, text: "Output JSON only." }]);
  });

  test("can't be pressed while the text has a problem or a Test runs, and shows what the last one found", () => {
    const row = (state: "running" | PromptTestView | undefined, problems: string[] = []) => PromptTestRow({ label: answer.label, text: "x", problems, busy: false, state, send: () => undefined });
    expect(labelled(row(undefined, ["unknown placeholder {{nope}}"]), Button, `Test ${answer.label} on this chat`).disabled).toBe(true);
    expect(labelled(row("running"), Button, `Test ${answer.label} on this chat`).disabled).toBe(true);
    expect(words(row({ ok: true, problems: [], left: [] }))).toContain("Passed: the role's answer kept its contract.");
    expect(words(row({ ok: true, problems: [], left: [] }))).not.toContain("Left out");
    expect(words(row({ ok: true, problems: [], left: ["the player's message: none comes right before the latest reply"] }))).toContain("Left out of its task: the player's message: none comes right before the latest reply.");
    const failed = words(row({ ok: false, problems: ["the answer breaks its contract: proposals: is required"], left: [] }));
    expect(failed).toContain("Failed: ");
    expect(failed).toContain("The answer breaks its contract: proposals: is required");
    expect(propsOf(row(undefined), Button).length).toBe(1);
  });
});

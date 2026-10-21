// The inferred-checks control (DESIGN §11) in its three places, each round-tripping through the
// backend: Settings → Checks saves the user's policy for new chats (or none, by the chat's realism),
// GM → This chat → Checks previews and applies the running chat's with an `infer` marker, and
// Build's ruleset editor commits the world's default, which a new chat then plays by. The controls
// are walked as rendered trees (no DOM), their buttons and switches pressed through the props the
// screen hands them.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import { InferredWorld } from "../../src/frontend/build/ruleset-editor";
import { Button, HostSwitch, NumberStepper, Seg } from "../../src/frontend/components";
import { Choice } from "../../src/frontend/adjudication-form";
import { GuidanceLine, InferredForm } from "../../src/frontend/inferred-form";
import { sheetPreviewRequest } from "../../src/frontend/requests";
import { chatInferChange, InferredSeed } from "../../src/frontend/settings/inferred";
import { DEFAULT_GUIDANCE, inferredDefaults, type InferredChecks, type SheetSkill } from "../../src/shared/inferred";
import type { JsonObject } from "../../src/shared/json";
import type { MarkerPreview } from "../../src/shared/protocol";
import type { UserSettings } from "../../src/shared/settings";
import type { WorldDoc } from "../../src/shared/world";
import { Rig } from "../support/rig";
import { labelled, press, propsOf } from "../support/tree";

const MODE = "Read typed attempts as checks";
const ALL_SKILLS = "Every skill the sheet has";

/** What one press on the inferred-checks form in `tree` hands its screen: the form rendered, `act` pressing its controls, the edited policy handed on. */
function edit(tree: unknown, act: (form: unknown) => void): InferredChecks {
  const props = propsOf(tree, InferredForm)[0];
  if (!props) throw new Error("no inferred-checks form");
  let picked: InferredChecks | null = null;
  act(InferredForm({ ...(props as Parameters<typeof InferredForm>[0]), onChange: (next) => (picked = next) }));
  if (!picked) throw new Error("the form handed nothing on");
  (props.onChange as (next: InferredChecks) => void)(picked);
  return picked;
}

/** The Reset button under the guidance lines. */
function resetLines(form: unknown): void {
  const reset = propsOf(form, Button).find((p) => p.children === "Reset the lines");
  if (typeof reset?.onClick !== "function") throw new Error("no Reset");
  reset.onClick();
}

describe("the inferred-checks control", () => {
  test("Settings → Checks saves the user's policy for new chats, field by field, and By the chat's realism goes back to none", async () => {
    const rig = new Rig();
    const skills: SheetSkill[] = [
      { id: "athletics", label: "Athletics" },
      { id: "stealth", label: "Stealth" },
    ];
    const settings = async (): Promise<UserSettings> => rig.body(await rig.send({ type: "lre.settings.get" })).settings as UserSettings;
    const save = async (act: (tree: unknown) => void): Promise<UserSettings> => {
      let patch: JsonObject | null = null;
      act(InferredSeed({ settings: await settings(), skills, busy: false, patch: (p) => (patch = p) }));
      if (!patch) throw new Error("nothing saved");
      return rig.body(await rig.send({ type: "lre.settings.set", patch })).settings as UserSettings;
    };
    const before = await settings();
    expect(before.inferred).toBeNull();
    // No form while new chats go by their realism: there's no policy of the user's to edit.
    expect(propsOf(InferredSeed({ settings: before, skills, busy: false, patch: () => undefined }), InferredForm)).toHaveLength(0);
    // My own starts from what the user's realism defaults would play.
    const mine = await save((tree) => press(labelled(tree, Seg, "Inferred checks for new chats"), "mine"));
    expect(mine.inferred).toEqual(inferredDefaults(before.realism.preset, before.realism.levels.sheets));
    await save((tree) => edit(tree, (form) => press(labelled(form, Seg, MODE), "auto")));
    await save((tree) => edit(tree, (form) => press(labelled(form, Choice, "Which attempts"), "uncertain")));
    await save((tree) => edit(tree, (form) => press(labelled(form, Choice, "Who rolls"), "everyone")));
    await save((tree) => edit(tree, (form) => press(labelled(form, HostSwitch, ALL_SKILLS), false)));
    await save((tree) => edit(tree, (form) => press(labelled(form, HostSwitch, "Athletics"), false)));
    // A hardest band below the easiest carries the easiest down with it.
    await save((tree) => edit(tree, (form) => press(labelled(form, Choice, "Hardest difficulty"), "trivial")));
    await save((tree) => edit(tree, (form) => press(labelled(form, Choice, "Hardest difficulty"), "heroic")));
    await save((tree) => edit(tree, (form) => press(labelled(form, Choice, "What the narrator is told"), "roll")));
    await save((tree) => edit(tree, (form) => press(labelled(form, Seg, "Others' numbers"), "shown")));
    await save((tree) => edit(tree, (form) => press(labelled(form, GuidanceLine, "After a failure, tell the narrator"), "{who} fumbles {attempt}.")));
    const edited = await save((tree) => edit(tree, (form) => press(labelled(form, NumberStepper, "Most rolls a turn"), 4)));
    const policy: InferredChecks = { mode: "auto", when: "uncertain", who: "everyone", skills: ["stealth"], difficulty: { lowest: "trivial", highest: "heroic" }, detail: "roll", others: "shown", guidance: { pass: DEFAULT_GUIDANCE.pass, fail: "{who} fumbles {attempt}." }, most: 4 };
    expect(edited.inferred).toEqual(policy);
    // A restart reads the saved policy back.
    expect((rig.body(await rig.restart().send({ type: "lre.settings.get" })).settings as UserSettings).inferred).toEqual(policy);
    const reset = await save((tree) => edit(tree, resetLines));
    expect(reset.inferred?.guidance).toEqual(DEFAULT_GUIDANCE);
    const back = await save((tree) => edit(tree, (form) => press(labelled(form, HostSwitch, ALL_SKILLS), true)));
    expect(back.inferred?.skills).toBeNull();
    const none = await save((tree) => press(labelled(tree, Seg, "Inferred checks for new chats"), "realism"));
    expect(none.inferred).toBeNull();
  });

  test("Off greys out everything but the mode", () => {
    const off: InferredChecks = { ...inferredDefaults("grounded", 3), mode: "off" };
    const form = InferredForm({ value: off, skills: [{ id: "stealth", label: "Stealth" }], skillsHelp: "", onChange: () => undefined });
    const controls = [Seg, Choice, HostSwitch, NumberStepper, GuidanceLine, Button].flatMap((type) => propsOf(form, type));
    expect(controls.filter((p) => p.label === MODE).map((p) => p.disabled === true)).toEqual([false]);
    const rest = controls.filter((p) => p.label !== MODE);
    expect(rest.length).toBeGreaterThanOrEqual(10);
    expect(rest.every((p) => p.disabled === true)).toBe(true);
  });

  test("GM → This chat → Checks previews the change, then applies it as a marker from the next turn; the policy in force sends nothing", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Brindlemere", "fantasy_town");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await rig.turn(chatId, "I look around.", "The square is quiet.");
    const controls = async () => {
      const c = (await rig.rt.view(chatId, rig.host.userId)).controls;
      if (!c) throw new Error("no controls");
      return c;
    };
    const { inferred: before, skills } = await controls();
    // The form lists this chat's world's skills, edited as the screen keeps its draft.
    let draft = before;
    const form = () => h(InferredForm, { value: draft, skills, skillsHelp: "", onChange: (p: InferredChecks) => (draft = p) });
    edit(form(), (f) => press(labelled(f, Seg, MODE), "auto"));
    edit(form(), (f) => press(labelled(f, HostSwitch, ALL_SKILLS), false));
    edit(form(), (f) => press(labelled(f, HostSwitch, "Wits"), false));
    const picked = draft;
    expect([picked.mode, picked.skills]).toEqual(["auto", ["brawn", "grace", "heart"]]);
    const ask = chatInferChange(chatId, before, picked, true);
    if (!ask) throw new Error("no preview");
    const preview = rig.body(await rig.send(ask)).preview as MarkerPreview;
    expect(preview.lines.length).toBeGreaterThan(0);
    // A preview writes nothing.
    expect((await controls()).inferred).toEqual(before);
    const change = chatInferChange(chatId, before, picked);
    if (!change) throw new Error("no marker");
    rig.body(await rig.send(change));
    expect((await controls()).inferred).toEqual(picked);
    expect(chatInferChange(chatId, picked, structuredClone(picked))).toBeNull();
  });

  test("Build's ruleset editor commits the world's default, its skills the sheet's, which a new chat plays by", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Brindlemere", "fantasy_town");
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
    const doc = draft.draft as WorldDoc;
    const ruleset = structuredClone(doc.ruleset ?? {}) as unknown as JsonObject;
    const skills = (rig.body(await rig.send(sheetPreviewRequest(worldId, ruleset))).skills ?? []) as SheetSkill[];
    expect(skills.length).toBeGreaterThan(0);
    const start = inferredDefaults(doc.realism.preset, doc.realism.levels.sheets);
    let inferred: JsonObject | undefined;
    const card = () => InferredWorld({ value: inferred, start, skills, skillsHelp: "", disabled: false, onChange: (next) => (inferred = next) });
    expect(propsOf(card(), InferredForm)).toHaveLength(0);
    press(labelled(card(), HostSwitch, "This world sets how typed attempts are read as checks"), true);
    expect(inferred as unknown).toEqual(start);
    edit(card(), (form) => press(labelled(form, Seg, MODE), "auto"));
    edit(card(), (form) => press(labelled(form, Choice, "Easiest difficulty"), "tricky"));
    edit(card(), (form) => press(labelled(form, HostSwitch, ALL_SKILLS), false));
    edit(card(), (form) => press(labelled(form, HostSwitch, "Heart"), false));
    const world = edit(card(), (form) => press(labelled(form, Seg, "Others' numbers"), "shown"));
    expect([world.mode, world.difficulty.lowest, world.skills, world.others]).toEqual(["auto", "tricky", ["brawn", "wits", "grace"], "shown"]);
    rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: draft.base, part: "ruleset", value: { ...ruleset, inferred: world as unknown as JsonObject } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const controls = (await rig.rt.view(chatId, rig.host.userId)).controls;
    expect(controls?.inferred).toEqual(world);
    // Build lists the skills the chat's sheet has.
    expect(controls?.skills).toEqual(skills);
    // Switched off, the world sets none, and new chats take the user's setting.
    press(labelled(card(), HostSwitch, "This world sets how typed attempts are read as checks"), false);
    expect(inferred).toBeUndefined();
  });
});

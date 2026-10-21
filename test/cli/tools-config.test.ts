// Settings, the preset and diagnostics through the agent's tools, against the real backend.

import { describe, expect, test } from "bun:test";
import { toolsFor } from "../../src/cli/tools";
import { cliRig } from "../support/cli-rig";

describe("settings through the tools", () => {
  test("a section reads as Settings has it; a patch lands as the page's would, a named preset made Custom, and what came out otherwise is said", async () => {
    const { rig, call, raw } = await cliRig();
    const userId = rig.host.userId;
    // A small section comes back whole, as its JSON.
    const read = await raw("lre_settings", { section: "realism", pointer: "/levels" });
    expect(read.text.startsWith("your LumiRPEngine settings at /settings/realism/levels")).toBe(true);
    expect(JSON.parse(read.text.slice(read.text.indexOf("\n\n") + 2))).toEqual((await rig.rt.settings.get(userId)).realism.levels);
    // The whole holds the settings and each change type's effective mode.
    const whole = await raw("lre_settings");
    expect(Object.keys(JSON.parse(whole.text.slice(whole.text.indexOf("\n\n") + 2)) as object)).toEqual(["settings", "extractionModes"]);

    const set = await call("lre_settings_set", { patch: { realism: { levels: { money: 4 } }, adjudication: { riskyAt: 0.4 }, timeouts: { requestMs: -5 } } });
    const stored = await rig.rt.settings.get(userId);
    expect(stored.realism).toMatchObject({ preset: "custom", levels: { money: 4 } });
    // A named adjudication preset ignores its fields: without Custom the change would be dropped.
    expect(stored.adjudication).toMatchObject({ preset: "custom", riskyAt: 0.4 });
    expect(set.changed).toEqual(expect.arrayContaining(["realism", "adjudication"]));
    expect(set.presets).toEqual([expect.stringContaining("realism.preset"), expect.stringContaining("adjudication.preset")]);
    expect(set.adjusted).toEqual([expect.objectContaining({ pointer: "/timeouts/requestMs", sent: -5 })]);
    expect(Array.isArray(set.caveats)).toBe(true);
    // A named preset expands as Settings' own pick does.
    await call("lre_settings_set", { patch: { realism: { preset: "story" } } });
    expect((await rig.rt.settings.get(userId)).realism.preset).toBe("story");
  });

  test("a setting no page writes is refused, naming the sections", async () => {
    const { raw } = await cliRig();
    const refused = await raw("lre_settings_set", { patch: { realisms: { preset: "story" } } });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("there is no setting realisms");
  });
});

describe("the preset through the tools", () => {
  test("the card reads the active preset's blocks, and adding them writes the preset once; again adds nothing", async () => {
    const { rig, call } = await cliRig();
    rig.host.activeChat = await rig.worldChat();
    const card = (await call("lre_preset")).card as { preset: { name: string } | null; blocks: { target: string; state: string }[] };
    expect(card.preset?.name).toBe("Default");
    expect(card.blocks.find((b) => b.target === "judge")?.state).toBe("missing");
    const added = await call("lre_preset_add_blocks");
    expect(added.added).toEqual(expect.arrayContaining(["RPEngine · judge", "RPEngine · narrator"]));
    expect(rig.host.presetBlocks.map((b) => b.name)).toContain("RPEngine · judge");
    expect(rig.host.presetWrites).toBe(1);
    expect((await call("lre_preset_add_blocks")).added).toEqual([]);
    expect(rig.host.presetWrites).toBe(1);
  });
});

describe("diagnostics through the tools", () => {
  test("the records come back only behind spoilers; clearing forgets them", async () => {
    const { rig, call } = await cliRig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "Quiet morning.");
    const userId = rig.host.userId;
    const kept = (await rig.rt.diag.records(chatId, userId)).length;
    expect(kept).toBeGreaterThan(0);
    const gated = await call("lre_diag", { chatId });
    expect(gated).toMatchObject({ chatId, records: kept });
    expect(gated.list).toBeUndefined();
    const open = await call("lre_diag", { chatId, spoilers: true, last: 2 });
    expect((open.list as unknown[]).length).toBe(Math.min(2, kept));
    await call("lre_diag_clear", { chatId });
    expect(await rig.rt.diag.records(chatId, userId)).toEqual([]);
  });
});

describe("read-only mode", () => {
  test("hides the setup tools that write, and refuses them before anything is sent", async () => {
    const { rig, raw } = await cliRig();
    const listed = toolsFor(true).map((t) => t.name);
    for (const name of ["lre_settings_set", "lre_preset_add_blocks", "lre_diag_clear", "lre_activity_dismiss"]) expect(listed).not.toContain(name);
    for (const name of ["lre_settings", "lre_settings_caveats", "lre_preset", "lre_diag"]) expect(listed).toContain(name);
    const before = await rig.rt.settings.get(rig.host.userId);
    const refused = await raw("lre_settings_set", { patch: { swipeDefault: before.swipeDefault === "rerun" ? "renarrate" : "rerun" } }, true);
    expect(refused.isError).toBe(true);
    expect((await rig.rt.settings.get(rig.host.userId)).swipeDefault).toBe(before.swipeDefault);
  });
});

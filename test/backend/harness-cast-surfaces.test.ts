// The game master's surfaces the harness adds a tool for (`harness-tools/surfaces.ts`): a place made
// in play taken out again, a saved set forgotten, the effects `gm_effect` runs, and what the reply's
// writer is given of the world. And the two lore tools that keep a file, which the harness lists
// again: with a workspace port the file is written there, without one it goes through the writer as
// on the old engines.
//
// The writes here land for real: the writer is the engine's own, and a staged operation is applied to
// the chat's head, so what a tool says it changed is read back from the world.

import { describe, expect, test } from "bun:test";
import { worldBuild } from "../../src/backend/agents/tools/harness-ports";
import { setsOf } from "../../src/shared/things";
import { madePlaces } from "../../src/engine/places-in-play";
import { stateOf } from "../support/mind-chat";
import { attachBook, bookEntry, HOME } from "../support/tools";
import { answer, authorEnv as author, MARA, memoryFiles as workspace, noModelCalls, refusal } from "./harness-cast-kit";

describe("a place made in play", () => {
  test("is taken out again by place_remove; one of the world's own is refused, with where it is changed", async () => {
    const { rig, chatId, env } = await author();
    await answer(env, "place_make", { name: "the back room", parent: HOME, as: "room", why: "the story walks into a back room" });
    // A place made in play is the chat's, kept in its state (the world's document never has it), under its name as the engine writes one.
    const idOf = async (): Promise<string | undefined> => madePlaces((await stateOf(rig, chatId)).state).find((place) => place.name === "The back room")?.id;
    const id = await idOf();
    expect(id).toBeDefined();
    // Only checked: the answer says what it would change, and the place stays.
    const checked = await answer(env, "place_remove", { place: "the back room", dry: true });
    expect(checked.checked).toMatchObject({ changeType: "gm_edit" });
    expect(await idOf()).toBe(id);
    const removed = await answer(env, "place_remove", { place: "the back room" });
    expect(removed.staged).toMatchObject({ changeType: "gm_edit" });
    expect(await idOf()).toBeUndefined();
    // The world's own places are the world document's: the refusal says so.
    const own = await refusal(env, "place_remove", { place: HOME });
    expect(own).toContain("Build");
    // No place named: the refusal names the argument.
    expect(await refusal(env, "place_remove", {})).toContain("place");
    expect(await refusal(env, "place_remove", { place: "a cellar no one made" })).toContain("a cellar no one made");
    noModelCalls(rig);
  });
});

describe("a saved set", () => {
  test("is forgotten by set_drop, by its name; one the person doesn't have is refused with the sets they do have", async () => {
    const { rig, chatId, env } = await author();
    const sets = async (): Promise<string[]> => Object.values(setsOf((await stateOf(rig, chatId)).state.entities[MARA]?.fields)).map((s) => s.name);
    // Nothing saved yet: the refusal says so, in words that tell what to do.
    const none = await refusal(env, "set_drop", { who: MARA, set: "Work" });
    expect(none).toContain("no saved set called Work");
    expect(none).toContain("none");
    await answer(env, "item_make", { name: "grey scarf", in: MARA, why: "she is wearing a grey scarf" });
    await answer(env, "item_wear", { item: "grey scarf", who: MARA });
    await answer(env, "set_save", { who: MARA, name: "Work", kind: "outfit" });
    expect(await sets()).toEqual(["Work"]);
    const other = await refusal(env, "set_drop", { who: MARA, set: "Sunday best" });
    expect(other).toContain("Work");
    const dropped = await answer(env, "set_drop", { who: MARA, set: "work" });
    expect(dropped.staged).toMatchObject({ changeType: "item_set" });
    expect(await sets()).toEqual([]);
    // The things in it stay.
    expect(Object.values((await stateOf(rig, chatId)).state.entities).some((e) => e.name === "grey scarf")).toBe(true);
    expect(await refusal(env, "set_drop", { who: "someone the world doesn't have", set: "Work" })).toContain("someone the world doesn't have");
    noModelCalls(rig);
  });
});

describe("the effects the game master may run", () => {
  test("gm_effects lists each with its arguments, narrows by search, and says so when nothing matches", async () => {
    const { rig, env } = await author();
    const all = (await answer(env, "gm_effects")) as { effects: { effect: string; args: string[]; optional?: string[] }[]; note: string };
    const ids = all.effects.map((e) => e.effect);
    expect(ids).toEqual([...ids].sort());
    // Only effects a GM edit may run are listed, each one the registry has.
    for (const e of all.effects) expect({ effect: e.effect, gm: rig.rt.registry.effects.get(e.effect)?.gm }).toEqual({ effect: e.effect, gm: true });
    expect(all.effects.length).toBe([...rig.rt.registry.effects.values()].filter((e) => e.gm === true).length);
    expect(all.effects.find((e) => e.effect === "economy.open_account")).toEqual({ effect: "economy.open_account", args: ["party"], optional: ["product", "name"] });
    expect(all.note).toContain("gm_effect");
    const accounts = (await answer(env, "gm_effects", { search: "account" })) as { effects: { effect: string }[] };
    expect(accounts.effects.length).toBeGreaterThan(0);
    expect(accounts.effects.every((e) => e.effect.includes("account"))).toBe(true);
    expect(accounts.effects.length).toBeLessThan(all.effects.length);
    const nothing = await refusal(env, "gm_effects", { search: "zeppelin" });
    expect(nothing).toContain("zeppelin");
    expect(nothing).toContain("without search");
    noModelCalls(rig);
  });

  test("an effect it lists runs through gm_effect with the arguments it names", async () => {
    const { rig, chatId, env } = await author();
    const before = Object.keys((await stateOf(rig, chatId)).state.entities).length;
    const out = await answer(env, "gm_effect", { effect: "economy.open_account", args: JSON.stringify({ party: MARA, name: "Rainy day" }) });
    expect(out.staged).toBeDefined();
    expect(Object.keys((await stateOf(rig, chatId)).state.entities).length).toBeGreaterThan(before);
    noModelCalls(rig);
  });
});

describe("the sections the reply's writer is given", () => {
  test("sections_read gives each section's settings, and with the runtime's builder its status and tokens; one section's text when named", async () => {
    const { rig, chatId, env } = await author();
    // Where the call can't have the sections built: each section's settings, and a line saying so.
    const bare = (await answer(env, "sections_read")) as { sections: { section: string; status?: string; settings: Record<string, unknown> }[]; note?: string };
    expect(bare.sections.length).toBeGreaterThan(3);
    expect(bare.note).toContain("settings");
    expect(bare.sections.every((s) => s.status === undefined)).toBe(true);
    const build = await worldBuild(rig.rt, chatId, rig.host.userId);
    const full = { ...env, build };
    const built = (await answer(full, "sections_read")) as { sections: { section: string; status?: string; tokens?: number; text?: string; settings: Record<string, unknown> }[]; budget: { sections: number } };
    expect(built.sections.map((s) => s.section)).toEqual(bare.sections.map((s) => s.section));
    expect(built.sections.every((s) => typeof s.status === "string")).toBe(true);
    expect(built.sections.every((s) => s.text === undefined)).toBe(true);
    expect(built.budget.sections).toBeGreaterThan(0);
    const sent = built.sections.find((s) => s.status === "sent");
    if (!sent) throw new Error("no section is sent");
    const one = (await answer(full, "sections_read", { section: sent.section })) as { sections: { section: string; text?: string }[] };
    expect(one.sections.map((s) => s.section)).toEqual([sent.section]);
    expect((one.sections[0]?.text ?? "").length).toBeGreaterThan(0);
    // A section this chat set (gm_feed) says so.
    await answer(full, "gm_feed", { section: sent.section, settings: JSON.stringify({ maxLines: 3 }) });
    const set = (await answer(full, "sections_read", { section: sent.section })) as { sections: { settings: Record<string, unknown> }[] };
    expect(set.sections[0]?.settings).toMatchObject({ maxLines: 3, setInThisChat: true });
    const unknown = await refusal(full, "sections_read", { section: "no_such_section" });
    expect(unknown).toContain("no_such_section");
    expect(unknown).toContain(sent.section);
    noModelCalls(rig);
  });
});

describe("a lore entry kept as a file", () => {
  test("lore_draft and lore_save write to the harness's workspace when the call has one, and say where", async () => {
    const { rig, chatId, env, staged } = await author();
    const { bookId, ids } = await attachBook(rig, chatId, "Harbor notes", [bookEntry("The ferry", "The ferry runs on the hour until nine.")]);
    const files = workspace();
    const filed = { ...env, files };
    const drafted = (await answer(filed, "lore_draft", { id: "the_ferry_times", text: "The ferry runs every half hour in summer." })) as { staged: { changeType: string; lands: string } };
    expect(drafted.staged.changeType).toBe("workspace");
    expect(drafted.staged.lands).toContain("lore-drafts/the_ferry_times.md");
    expect(files.files.get("lore-drafts/the_ferry_times.md")?.text).toBe("---\nlore: the_ferry_times\ntitle: the_ferry_times\n---\nThe ferry runs every half hour in summer.");
    // The same draft again replaces it: the write is based on the version there.
    await answer(filed, "lore_draft", { id: "the_ferry_times", text: "The ferry runs every half hour." });
    expect(files.files.get("lore-drafts/the_ferry_times.md")?.text).toContain("every half hour.");
    // A draft goes under lore-drafts/: the tool's own rule still holds.
    expect(await refusal(filed, "lore_draft", { id: "the_ferry_times", text: "x", path: "notes/ferry.md" })).toContain("lore-drafts/");
    const index = (await answer(filed, "lore_index")) as { books?: unknown };
    expect(index).toBeDefined();
    const entry = ids[0];
    if (entry === undefined) throw new Error("the book has no entry");
    // A World Info entry is named by its book and its own id, as lore_index gives it.
    const saved = (await answer(filed, "lore_save", { id: `${bookId}/${entry}` })) as { staged: { lands: string } };
    expect(saved.staged.lands).toContain("lore/");
    expect([...files.files.values()].some((f) => f.path.startsWith("lore/") && f.text.includes("The ferry runs on the hour until nine."))).toBe(true);
    // Nothing went through the writer's own staging: the files are the workspace's.
    expect(staged).toEqual([]);
    noModelCalls(rig);
  });

  test("without a workspace port the file goes through the writer, as on the old engines", async () => {
    const { rig, env, staged } = await author();
    const drafted = (await answer(env, "lore_draft", { id: "the_ferry_times", text: "The ferry runs every half hour in summer." })) as { staged: { changeType: string } };
    expect(drafted.staged.changeType).toBe("workspace");
    expect(staged).toEqual([{ kind: "ws_write", path: "lore-drafts/the_ferry_times.md", text: "---\nlore: the_ferry_times\ntitle: the_ferry_times\n---\nThe ferry runs every half hour in summer." }]);
    noModelCalls(rig);
  });
});

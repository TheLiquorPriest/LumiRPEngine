// The Files page, read from its view as drawn and from the calls behind it: the tree level by level, each
// file with its kind and whether it is in force, replaced or switched off; a file opened as text, and
// what can be done with it by what it is (yours edited, deleted, which for one in place of a default is
// the reset, and compared with the default; a shipped one edited as yours and switched off); what an
// update changed under a file of yours; the agents' suggestions, accepted as proposed or edited, or
// dismissed; and which route each control calls, with what.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { TreeFileEntry } from "../../src/ui/api";
import { filesCalls, filesControl, type FilesShown, FilesView, type FilesViewProps, NO_FILES, type OpenFile } from "../../src/ui/pages/files";
import { when } from "../../src/ui/words";
import { askingClient, settle } from "./asking";
import { CHAT } from "./recorded";
import { FILES, FILES_NO_CHAT, STACKS, SUGGESTIONS, TEXTS, TURN_DIFF, UPDATED } from "./tree-recorded";
import { banners, elements, expand, press, textOf } from "./vnodes";

const LISTED: FilesShown = { ...NO_FILES, files: FILES, loading: false };

function entryAt(path: string): TreeFileEntry {
  const found = FILES.find((f) => f.path === path);
  if (found === undefined) throw new Error(`no file ${path}`);
  return found;
}

/** A file opened and read, as the page holds it. */
function opened(path: string, over: Partial<OpenFile> = {}): OpenFile {
  const entry = entryAt(path);
  const text = TEXTS[path] ?? "";
  return { path, file: { path, level: entry.level, kind: entry.kind, bytes: entry.bytes, editable: entry.editable, text }, problem: null, mode: "read", draft: { text, level: entry.level === "shipped" ? "global" : entry.level }, diff: null, ...over };
}

function view(shown: Partial<FilesShown> = {}, chat: string | null = CHAT) {
  const asked: unknown[] = [];
  const props: FilesViewProps = {
    chat,
    shown: { ...LISTED, ...shown },
    onOpen: (path) => asked.push({ open: path }),
    onClose: () => asked.push("close"),
    onMode: (mode) => asked.push({ mode }),
    onDraft: (draft) => asked.push({ draft }),
    onSave: () => asked.push("save"),
    onRemove: () => asked.push("remove"),
    onSwitch: (path, level, off) => asked.push({ switch: path, level, off }),
    onDiff: () => asked.push("diff"),
    onEdit: (id) => asked.push({ edit: id }),
    onEditText: (text) => asked.push({ editText: text }),
    onLevel: (id, level) => asked.push({ level: id, to: level }),
    onAccept: (id) => asked.push({ accept: id }),
    onDismiss: (id) => asked.push({ dismiss: id }),
    onStack: (agent) => asked.push({ stack: agent }),
  };
  const tree = expand(h(FilesView, props));
  return { tree, text: textOf(tree), asked };
}

/** The element that holds a file's row, by its path. */
function rowOf(tree: unknown, path: string) {
  const found = elements(tree).find((e) => e.props["data-file"] === path);
  if (found === undefined) throw new Error(`no row for ${path}`);
  return found;
}

const buttonsOf = (tree: unknown): string[] => elements(tree).filter((e) => e.type === "button").map((e) => textOf(e.props.children));

describe("the Files page", () => {
  test("it shows the tree by level, each file with its kind and whether it is in force, replaced by a nearer file, or switched off; and an update under a file of yours is said on it", () => {
    const { tree, text } = view();
    expect(text).not.toContain("Not available yet");
    // The levels, farthest first, each with how many files it holds.
    const summaries = elements(tree)
      .filter((e) => e.type === "summary")
      .map((e) => textOf(e.props.children));
    expect(summaries).toEqual(["Shipped (7)", "Yours (2)", "This character's (1)", "This chat's (3)"]);
    expect(textOf(rowOf(tree, "@shipped/TURN.md").props.children)).toContain("guidancereplaced by @global/TURN.md");
    expect(textOf(rowOf(tree, "@shipped/rules/perceptions.md").props.children)).toContain("switched off");
    expect(textOf(rowOf(tree, "@shipped/WRITING.md").props.children)).toContain("in force");
    expect(textOf(rowOf(tree, "@shipped/rules/examples/weather.md").props.children)).toContain("not in force");
    expect(textOf(rowOf(tree, "persistent-workspace/moira.md").props.children)).toContain("agents' notes");
    expect(textOf(rowOf(tree, "turns/0031-turn-31/world-state.md").props.children)).toContain("generated");
    // Only the file of yours whose default an update changed is marked so.
    const marked = FILES.filter((f) => textOf(rowOf(tree, f.path).props.children).includes("the default changed")).map((f) => f.path);
    expect(marked).toEqual(["@global/TURN.md"]);
    // A row opens its file.
    const listed = view();
    press(rowOf(listed.tree, "WORLD.md"), "WORLD.md");
    expect(listed.asked).toEqual([{ open: "WORLD.md" }]);
  });

  test("a file no agent reads, such as what the migration put under imported/, is said to be kept, and opened it says how it comes into force; a config, notes and a skill's own files are not", () => {
    const file = (path: string, over: Partial<TreeFileEntry> = {}): TreeFileEntry => ({ path, level: "global", kind: "yours", bytes: 64, item: null, applies: true, replacedBy: null, off: false, offIn: [], editable: true, shipped: null, defaultChanged: null, ...over });
    const files = [
      ...FILES,
      file("@global/imported/.agents/lamplighter.md"),
      file("@global/imported/.agents/lamplighter.original.json"),
      file("@global/imported/GUIDANCE.md"),
      file("@global/.skills/tides/SKILL.md", { item: "skills/tides" }),
      file("@global/.skills/tides/table.md"),
      file("RPE.yml", { level: "chat" }),
    ];
    const kept = (tree: unknown) => files.filter((f) => textOf(rowOf(tree, f.path).props.children).includes("kept, read by no agent")).map((f) => f.path);
    const listed = view({ files });
    expect(kept(listed.tree)).toEqual(["@global/imported/.agents/lamplighter.md", "@global/imported/.agents/lamplighter.original.json", "@global/imported/GUIDANCE.md"]);
    // None of them is said to be in force; the configs and a skill's own file, which are read by their place, still are.
    for (const path of kept(listed.tree)) expect(textOf(rowOf(listed.tree, path).props.children)).not.toContain("in force");
    for (const path of ["@global/RPE-global.yml", "RPE.yml", "@global/.skills/tides/table.md"]) expect(textOf(rowOf(listed.tree, path).props.children)).toContain("in force");

    const how = "To put it in force, move it to where its kind is read from at the same level, or copy from it.";
    const path = "@global/imported/.agents/lamplighter.md";
    const open = view({ files, open: { path, file: { path, level: "global", kind: "yours", bytes: 64, editable: true, text: "---\nname: lamplighter\n---\nKeep the lamp.\n" }, problem: null, mode: "read", draft: { text: "", level: "global" }, diff: null } });
    expect(textOf(rowOf(open.tree, path).props.children)).toContain(how);
    expect(textOf(rowOf(view({ files, open: opened("@global/TURN.md") }).tree, "@global/TURN.md").props.children)).not.toContain(how);
  });

  test("a file of yours opens as text, never as markup, with the update under it said; it is edited, compared with the default, and deleting it is the reset, which the page says", () => {
    const shown = view({ open: opened("@global/TURN.md") });
    const panel = rowOf(shown.tree, "@global/TURN.md");
    const said = textOf(panel.props.children);
    expect(said).toContain("Weigh what the player is after first, <em>before</em> anything else.");
    expect(elements(panel.props.children).some((e) => e.type === "em" || e.props.dangerouslySetInnerHTML !== undefined)).toBe(false);
    expect(said).toContain(`An update changed the shipped default on ${when(UPDATED)}, after this file was last written.`);
    expect(buttonsOf(panel.props.children)).toEqual(["@global/TURN.md", "Edit", "Reset to the default", "Compare with the default", "Close"]);
    press(panel, "Edit");
    press(panel, "Reset to the default");
    press(panel, "Compare with the default");
    press(panel, "Close");
    expect(shown.asked).toEqual([{ mode: "edit" }, { mode: "delete" }, "diff", "close"]);

    const asking = view({ open: opened("@global/TURN.md", { mode: "delete" }) });
    expect(asking.text).toContain("Delete @global/TURN.md? It takes the place of the shipped @shipped/TURN.md, so deleting it is the reset to the default.");
    press(asking.tree, "Delete it");
    press(asking.tree, "Keep it");
    expect(asking.asked).toEqual(["remove", { mode: "read" }]);
    // A file of yours with no default of its name is simply deleted.
    expect(buttonsOf(rowOf(view({ open: opened("persistent-workspace/moira.md") }).tree, "persistent-workspace/moira.md").props.children)).toEqual(["persistent-workspace/moira.md", "Edit", "Delete", "Close"]);
    // A generated file is only read.
    expect(buttonsOf(rowOf(view({ open: opened("turns/0031-turn-31/world-state.md") }).tree, "turns/0031-turn-31/world-state.md").props.children)).toEqual(["turns/0031-turn-31/world-state.md", "Close"]);
  });

  test("a shipped file is edited as yours and switched off, for every chat or in this chat; a name switched off is switched on again; with no chat open, at your own level alone", () => {
    const writing = view({ open: opened("@shipped/WRITING.md") });
    const panel = rowOf(writing.tree, "@shipped/WRITING.md");
    expect(buttonsOf(panel.props.children)).toEqual(["@shipped/WRITING.md", "Edit as yours", "Switch off for every chat", "Switch off in this chat", "Close"]);
    press(panel, "Switch off for every chat");
    press(panel, "Switch off in this chat");
    expect(writing.asked).toEqual([
      { switch: "@shipped/WRITING.md", level: "global", off: true },
      { switch: "@shipped/WRITING.md", level: "chat", off: true },
    ]);
    // Your own config's `off:` list names it: only that Switch on is offered.
    const off = view({ open: opened("@shipped/rules/perceptions.md") });
    expect(buttonsOf(rowOf(off.tree, "@shipped/rules/perceptions.md").props.children)).toEqual(["@shipped/rules/perceptions.md", "Edit as yours", "Switch on for every chat", "Close"]);
    press(off.tree, "Switch on for every chat");
    expect(off.asked).toEqual([{ switch: "@shipped/rules/perceptions.md", level: "global", off: false }]);
    const alone = view({ files: FILES_NO_CHAT, open: opened("@shipped/WRITING.md") }, null);
    expect(buttonsOf(rowOf(alone.tree, "@shipped/WRITING.md").props.children)).toEqual(["@shipped/WRITING.md", "Edit as yours", "Switch off", "Close"]);
    expect(elements(alone.tree).filter((e) => e.type === "summary").map((e) => textOf(e.props.children))).toEqual(["Shipped (7)", "Yours (2)"]);
  });

  test("a name switched off is offered Switch on only at a level whose off: list names it, since anywhere else it changes nothing; where two lists name it, or one this page does not write, the page says so", () => {
    const PERCEPTIONS = "@shipped/rules/perceptions.md";
    const offIn = (levels: TreeFileEntry["offIn"], chat: string | null = CHAT) => {
      const files = (chat === null ? FILES_NO_CHAT : FILES).map((f) => (f.path === PERCEPTIONS ? { ...f, offIn: levels } : f));
      const shown = view({ files, open: opened(PERCEPTIONS) }, chat);
      const row = rowOf(shown.tree, PERCEPTIONS);
      return { buttons: buttonsOf(row.props.children).filter((b) => b.startsWith("Switch")), words: elements(row).filter((e) => e.props["data-off-in"] !== undefined).map((e) => textOf(e.props.children)), shown };
    };
    expect(offIn(["chat"])).toMatchObject({ buttons: ["Switch on in this chat"], words: [] });
    expect(offIn(["global"], null)).toMatchObject({ buttons: ["Switch on"], words: [] });
    const both = offIn(["global", "chat"]);
    expect(both).toMatchObject({ buttons: ["Switch on for every chat", "Switch on in this chat"], words: ["The off: list of your own config and this chat's config names it. It is on again once no list does."] });
    press(both.shown.tree, "Switch on in this chat");
    expect(both.shown.asked).toEqual([{ switch: PERCEPTIONS, level: "chat", off: false }]);
    expect(offIn(["shipped"])).toMatchObject({ buttons: [], words: ["The off: list of the shipped config names it. It is on again once no list does, and this page does not change the shipped config."] });
    expect(offIn(["character", "chat"])).toMatchObject({ buttons: ["Switch on in this chat"], words: ["The off: list of this character's config and this chat's config names it. It is on again once no list does, and this page does not change this character's config."] });
  });

  test("editing shows the text and where it is to be saved; saving, and how the file differs from the default and what the update changed of it", () => {
    const editing = view({ open: opened("@shipped/WRITING.md", { mode: "edit", draft: { text: "Write short.", level: "chat" } }) });
    const box = elements(editing.tree).find((e) => e.type === "textarea");
    expect(box?.props.value).toBe("Write short.");
    (box?.props.onInput as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value: "Write shorter." } });
    const options = elements(rowOf(editing.tree, "@shipped/WRITING.md")).filter((e) => e.type === "option");
    expect(options.map((o) => [o.props.value, o.props.selected, textOf(o.props.children)])).toEqual([
      ["global", false, "Yours, for every chat"],
      ["character", false, "This character's"],
      ["chat", true, "This chat's"],
    ]);
    press(editing.tree, "Save");
    press(editing.tree, "Cancel");
    expect(editing.asked).toEqual([{ draft: { text: "Write shorter.", level: "chat" } }, "save", { mode: "read" }]);

    const compared = view({ open: opened("@global/TURN.md", { diff: { answer: TURN_DIFF, problem: null } }) });
    const diffs = elements(compared.tree).filter((e) => e.props.class === "rpe-pre rpe-diff");
    expect(diffs.map((d) => textOf(d.props.children))).toEqual([
      "  # The turn\n  \n- Weigh what the player is after first.\n+ Weigh what the player is after first, <em>before</em> anything else.\n  Then decide how deep the turn goes.\n+ Keep the keeper's secrets until the story earns them.\n  \n",
      "  # The turn\n  \n- Weigh intent first.\n+ Weigh what the player is after first.\n  Then decide how deep the turn goes.\n  \n",
    ]);
    expect(compared.text).toContain("From the shipped @shipped/TURN.md to this file:");
    expect(compared.text).toContain(`What the update of ${when(UPDATED)} changed in the shipped default:`);
    const failed = view({ open: opened("@global/TURN.md", { diff: { answer: null, problem: "The tree has no file @global/TURN.md." } }) });
    expect(banners(failed.tree)).toEqual([{ title: "The difference could not be read", text: "The difference could not be readThe tree has no file @global/TURN.md." }]);
  });

  test("each control calls its route with the chat; what was saved is opened, the listing read again after each change, and RPE's refusal kept in its words", async () => {
    const { client, asked } = askingClient();
    const states: FilesShown[] = [];
    const control = filesControl(filesCalls(client, CHAT), (s) => states.push(s));
    const last = (key: string) => asked.filter((a) => a.key === key).at(-1);
    const count = (key: string): number => asked.filter((a) => a.key === key).length;
    expect(asked.map((a) => [a.key, a.query])).toEqual([
      ["GET /api/v1/files", { chat: CHAT }],
      ["GET /api/v1/suggestions", { chat: CHAT, state: "open" }],
    ]);
    last("GET /api/v1/files")?.answer({ files: FILES });
    await settle();
    expect(states.at(-1)?.files).toEqual(FILES);

    // A file opened before the first is read: the first's answer is let go.
    control.open("@shipped/TURN.md");
    const first = last("GET /api/v1/files/*");
    control.open("@shipped/WRITING.md");
    const second = last("GET /api/v1/files/*");
    expect([first?.params, first?.query, second?.params]).toEqual([{ "*": "@shipped/TURN.md" }, { chat: CHAT }, { "*": "@shipped/WRITING.md" }]);
    first?.answer({ path: "@shipped/TURN.md", level: "shipped", kind: "yours", bytes: 1, editable: false, text: "the first" });
    second?.answer({ path: "@shipped/WRITING.md", level: "shipped", kind: "yours", bytes: 1, editable: false, text: "the second" });
    await settle();
    expect(states.at(-1)?.open).toMatchObject({ path: "@shipped/WRITING.md", file: { text: "the second" }, draft: { text: "the second", level: "global" } });

    // Saved as yours: written where asked, and what was written is opened, with the listing read again.
    control.mode("edit");
    control.draft({ text: "Write short.", level: "chat" });
    control.save();
    expect(last("PUT /api/v1/files/*")).toMatchObject({ params: { "*": "@shipped/WRITING.md" }, body: { level: "chat", text: "Write short.", chat: CHAT } });
    expect(states.at(-1)?.busy).toBe(true);
    last("PUT /api/v1/files/*")?.answer({ file: { ...entryAt("WORLD.md"), path: "WRITING.md" } });
    await settle();
    expect(last("GET /api/v1/files/*")?.params).toEqual({ "*": "WRITING.md" });
    expect([count("GET /api/v1/files"), count("GET /api/v1/suggestions")]).toEqual([2, 2]);
    expect(states.at(-1)).toMatchObject({ busy: false, open: { path: "WRITING.md", mode: "read" } });

    // Deleted: the file is closed, and the listing read again.
    control.mode("delete");
    control.remove();
    expect(last("DELETE /api/v1/files/*")).toMatchObject({ params: { "*": "WRITING.md" }, query: { chat: CHAT } });
    last("DELETE /api/v1/files/*")?.answer({ removed: "WRITING.md" });
    await settle();
    expect(states.at(-1)?.open).toBeNull();
    expect(count("GET /api/v1/files")).toBe(3);

    // Switched off in this chat; refused, in RPE's words, under the file.
    control.switchName("@shipped/TURN.md", "chat", true);
    expect(last("PUT /api/v1/files-off/*")).toMatchObject({ params: { "*": "@shipped/TURN.md" }, body: { level: "chat", off: true, chat: CHAT } });
    last("PUT /api/v1/files-off/*")?.fail(new Error("`off:` in RPE.yml is not a list of names: make it one, then try again."));
    await settle();
    expect(states.at(-1)).toMatchObject({ busy: false, refusal: { at: "file", words: "`off:` in RPE.yml is not a list of names: make it one, then try again." } });
    expect(count("GET /api/v1/files")).toBe(3);

    // Compared with the default; the file's text, answered after the difference was asked for, still shows.
    control.open("@global/TURN.md");
    control.diff();
    expect(last("GET /api/v1/files-diff/*")).toMatchObject({ params: { "*": "@global/TURN.md" }, query: { chat: CHAT } });
    last("GET /api/v1/files-diff/*")?.answer(TURN_DIFF);
    last("GET /api/v1/files/*")?.answer({ path: "@global/TURN.md", level: "global", kind: "yours", bytes: 1, editable: true, text: "the user's" });
    await settle();
    expect(states.at(-1)?.open).toMatchObject({ file: { text: "the user's" }, diff: { answer: TURN_DIFF, problem: null } });

    // A file closed before its text came is not opened again by it; and once the page has left, nothing more is shown.
    control.open("WORLD.md");
    control.close();
    last("GET /api/v1/files/*")?.answer({ path: "WORLD.md", level: "chat", kind: "yours", bytes: 1, editable: true, text: "late" });
    await settle();
    expect(states.at(-1)?.open).toBeNull();
    control.refresh();
    const seen = states.length;
    control.stop();
    last("GET /api/v1/files")?.answer({ files: [] });
    await settle();
    expect(states.length).toBe(seen);
  });

  test("with no chat open, no call names one", async () => {
    const { client, asked } = askingClient();
    const control = filesControl(filesCalls(client, null), () => undefined);
    control.open("@global/TURN.md");
    control.draft({ text: "x", level: "global" });
    control.save();
    control.switchName("@shipped/WRITING.md", "global", true);
    expect(asked.map((a) => [a.key, a.query ?? null, a.body ?? null])).toEqual([
      ["GET /api/v1/files", {}, null],
      ["GET /api/v1/suggestions", { state: "open" }, null],
      ["GET /api/v1/files/*", {}, null],
      ["PUT /api/v1/files/*", null, { level: "global", text: "x" }],
      ["PUT /api/v1/files-off/*", null, { level: "global", off: true }],
    ]);
  });
});

describe("an agent's stack, on the Files page", () => {
  test("for an agent chosen from those the chat's view defines, every part it is given in order, where each comes from, and why one is left out", () => {
    const choosing = view();
    const select = elements(elements(choosing.tree).find((e) => e.props["data-section"] === "stack")).find((e) => e.type === "select");
    expect(elements(select?.props.children).map((o) => o.props.value)).toEqual(["", "author", "gm"]);
    (select?.props.onChange as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value: "gm" } });
    expect(choosing.asked).toEqual([{ stack: "gm" }]);
    const shown = view({ stack: { agent: "author", parts: STACKS.author?.parts ?? [], problem: null } });
    const parts = elements(shown.tree).filter((e) => typeof e.props["data-part"] === "string");
    expect(parts.map((p) => textOf(p.props.children))).toEqual([
      "ALL-AGENTS · @shipped/ALL-AGENTS.md · Shipped · in the opening block",
      "rules/perceptions · @shipped/rules/perceptions.md · Shipped · in the opening block · left out: switched off",
      "AGENTS · @character/AGENTS.md · This character's · in the opening block",
      "WORLD · WORLD.md · This chat's · in the opening block",
      "SIMULATION · SIMULATION.md · This chat's · in the opening block · left out: no file at any level",
      "WRITING · @shipped/WRITING.md · Shipped · in the opening block",
      "author · @shipped/.agents/author.md · Shipped · in the opening block",
      "TURN · @global/TURN.md · Yours · in the opening block",
      "SWIPE · @shipped/SWIPE.md · Shipped · with the briefing",
    ]);
    expect(banners(view({ stack: { agent: "scribe", parts: null, problem: "There is no agent scribe." } }).tree)).toEqual([{ title: "The stack could not be read", text: "The stack could not be readThere is no agent scribe." }]);
    // With no chat open there is no stack to show: the route is a chat's.
    expect(elements(view({ files: FILES_NO_CHAT }, null).tree).some((e) => e.props["data-section"] === "stack")).toBe(false);
  });

  test("choosing an agent calls its route with the chat and the agent; only the stack asked for last is shown", async () => {
    const { client, asked } = askingClient();
    const states: FilesShown[] = [];
    const control = filesControl(filesCalls(client, CHAT), (s) => states.push(s));
    control.stack("author");
    control.stack("gm");
    const stacks = asked.filter((a) => a.key === "GET /api/v1/files-stack");
    expect(stacks.map((a) => a.query)).toEqual([
      { chat: CHAT, agent: "author" },
      { chat: CHAT, agent: "gm" },
    ]);
    stacks[1]?.answer(STACKS.gm);
    stacks[0]?.answer(STACKS.author);
    await settle();
    expect(states.at(-1)?.stack).toEqual({ agent: "gm", parts: STACKS.gm?.parts ?? [], problem: null });
  });
});

describe("the agents' suggestions, on the Files page", () => {
  const listed: FilesShown = { ...LISTED, suggestions: { list: SUGGESTIONS, problem: null, editing: null, levels: {} } };
  const item = (tree: unknown, id: number) => {
    const found = elements(tree).find((e) => e.props["data-suggestion"] === id);
    if (found === undefined) throw new Error(`no suggestion ${id}`);
    return found;
  };

  test("each open suggestion says its file, who filed it, in which turn and why, as text, and what it would change", () => {
    const { tree, text } = view(listed);
    expect(text).toContain("Suggestions (2)");
    const world = textOf(item(tree, 7).props.children);
    expect(world).toContain("WORLD.md");
    expect(world).toContain(`From the author (a1) in turn-31 · ${when(SUGGESTIONS[0]?.at ?? 0)}`);
    expect(world).toContain("The story leans on the keeper's log; <b>saying</b> how the lamp is kept stops it being made up each turn.");
    expect(elements(item(tree, 7).props.children).some((e) => e.type === "b")).toBe(false);
    expect(world).toContain("What it would change:  # Calder Point\n  \n  A lighthouse on a cold coast, a day's walk from the village.\n+ The lamp is lit at dusk and kept until dawn; the keeper logs each hour.\n");
    // Where each is written unless another level is chosen: a chat's file in the chat, a shipped one as yours.
    const chosen = (id: number) => elements(item(tree, id).props.children).filter((e) => e.type === "option" && e.props.selected === true).map((e) => e.props.value);
    expect([chosen(7), chosen(6)]).toEqual([["chat"], ["global"]]);
    // With no chat open, each says whose chat it is.
    expect(textOf(item(view(listed, null).tree, 6).props.children)).toContain("chat chat-calder");
    expect(view({ ...LISTED, suggestions: { list: [], problem: null, editing: null, levels: {} } }).text).toContain("No suggestion is open.");
  });

  test("each is accepted as proposed or edited, at the level chosen, or dismissed; a refusal shows under it in RPE's words", () => {
    const shown = view(listed);
    const world = item(shown.tree, 7);
    press(world, "Accept");
    press(world, "Edit, then accept");
    press(world, "Dismiss");
    const select = elements(world.props.children).find((e) => e.type === "select");
    (select?.props.onChange as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value: "global" } });
    expect(shown.asked).toEqual([{ accept: 7 }, { edit: 7 }, { dismiss: 7 }, { level: 7, to: "global" }]);

    const editing = view({ ...listed, suggestions: { ...listed.suggestions, editing: { id: 7, text: "Edited." } }, refusal: { at: 7, words: "Suggestion 7 was dismissed already." } });
    const edited = item(editing.tree, 7);
    expect(elements(edited.props.children).find((e) => e.type === "textarea")?.props.value).toBe("Edited.");
    press(edited, "Accept as edited");
    press(edited, "Cancel");
    expect(editing.asked).toEqual([{ accept: 7 }, { edit: null }]);
    expect(banners(edited.props.children)).toEqual([{ title: "RPE did not make that change", text: "RPE did not make that changeSuggestion 7 was dismissed already." }]);
    // The other suggestion shows no refusal of its own.
    expect(banners(item(editing.tree, 6).props.children)).toEqual([]);
  });

  test("accepting calls its route with the level and, edited, the text; dismissing calls its own; the files and suggestions are read again after each", async () => {
    const { client, asked } = askingClient();
    const states: FilesShown[] = [];
    const control = filesControl(filesCalls(client, CHAT), (s) => states.push(s));
    const last = (key: string) => asked.filter((a) => a.key === key).at(-1);
    last("GET /api/v1/suggestions")?.answer({ suggestions: SUGGESTIONS });
    await settle();
    control.accept(6);
    expect(last("POST /api/v1/suggestions/:id/accept")).toMatchObject({ params: { id: "6" }, body: { level: "global" } });
    last("POST /api/v1/suggestions/:id/accept")?.answer({ suggestion: { ...SUGGESTIONS[1], state: "accepted" }, file: null });
    await settle();
    expect(asked.filter((a) => a.key === "GET /api/v1/suggestions").length).toBe(2);
    expect(asked.filter((a) => a.key === "GET /api/v1/files").length).toBe(2);

    control.edit(7);
    control.editText("The lamp is kept from dusk to dawn.");
    control.level(7, "character");
    control.accept(7);
    expect(last("POST /api/v1/suggestions/:id/accept")).toMatchObject({ params: { id: "7" }, body: { level: "character", text: "The lamp is kept from dusk to dawn." } });
    last("POST /api/v1/suggestions/:id/accept")?.fail(new Error("Suggestion 7 was dismissed already."));
    await settle();
    expect(states.at(-1)).toMatchObject({ busy: false, refusal: { at: 7, words: "Suggestion 7 was dismissed already." }, suggestions: { editing: { id: 7 } } });

    control.dismiss(7);
    expect(last("POST /api/v1/suggestions/:id/dismiss")).toMatchObject({ params: { id: "7" }, body: undefined });
  });
});

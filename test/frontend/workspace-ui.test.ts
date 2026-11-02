// GM → Workspace (C8 `lre.workspace`): the browser's areas (Notes, Learned, Transcripts folded until
// opened, the Pins file), folders first and names in natural order (scene-9 before scene-10), each
// row's chips for who wrote it, at which reply, who may read it and how it stands, and its empty
// state; New note's path dialog and its request; a file's pane and its controls (Save and Revert
// once the draft changes, Ctrl+S, the ask before a draft with changes not saved is left, Pin or
// Unpin by state, Rename or move, Delete, asking first for a learned note); a transcript read-only;
// and the requests each control sends, as the literal objects, with each change's result handed to
// `changed` in its sentence. Rendered trees are walked with no DOM, with a recording `request` in
// place of the backend. The files are the starter world's (Port Alder).

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { Button, Empty, Field, Seg } from "../../src/frontend/components";
import { ChipRow, guardDraft, moveProblem, newNoteFolder, newNoteProblem, PathDialog, type PathDialogState, provenanceWords, READERS_NOTES, SESSION_PAGE, sizeWords, workspaceControls, WorkspaceBrowser, type WorkspaceBrowserProps, type WorkspaceBody, type WorkspaceControls, WorkspaceFilePane, type WorkspaceFilePaneProps, type WorkspaceResult } from "../../src/frontend/gm/workspace";
import { fileChips, naturalCompare, treeFiles, workspaceArea, workspaceGroups, workspaceTree } from "../../src/frontend/gm/workspace-tree";
import type { SessionView, WorkspaceFileView } from "../../src/shared/protocol";
import { propsOf, type Props } from "../support/tree";

const CHAT = "chat-port-alder";

const MARCUS: WorkspaceFileView = { path: "notes/marcus.md", hash: "1".repeat(32), size: 412, pinned: true, readers: "everyone", learned: false, provenance: { role: "assistant", key: "assistant.op-4-1", turn: 4 } };
const ANCHOR: WorkspaceFileView = { path: "lore-drafts/rusty-anchor.md", hash: "2".repeat(32), size: 1280, pinned: false, readers: "everyone", learned: false, provenance: { role: "scene_lore", key: "scene_lore.op-2-3", turn: 2 } };
const FLEET: WorkspaceFileView = { path: "plans/fleet-contract.md", hash: "3".repeat(32), size: 1, pinned: false, readers: "gm", learned: false, provenance: { role: "gm", key: "gm.op-0-1", turn: null } };
const DANNY: WorkspaceFileView = { path: "notes/danny.md", hash: "4".repeat(32), size: 96, pinned: false, readers: "gm", learned: false, provenance: { turn: 3 } };
const FILES = [MARCUS, ANCHOR, FLEET, DANNY];

const JORDAN: WorkspaceFileView = { path: "learned/jordan.md", hash: "6".repeat(32), size: 40, pinned: true, readers: "pov", learned: true, provenance: { role: "assistant", turn: null } };
const SCENE_9: WorkspaceFileView = { path: "notes/scenes/scene-9.md", hash: "7".repeat(32), size: 20, pinned: false, readers: "gm", learned: false, provenance: { role: "scene_lore", turn: 9 } };
const SCENE_10: WorkspaceFileView = { path: "notes/scenes/scene-10.md", hash: "8".repeat(32), size: 22, pinned: false, readers: "gm", learned: false, provenance: { role: "scene_lore", turn: 10 } };
const REPLY_9: WorkspaceFileView = { path: "transcripts/reply-0009.md", hash: "9".repeat(32), size: 5000, pinned: false, readers: "gm", learned: false, transcript: true, provenance: { turn: 9 } };
const REPLY_10: WorkspaceFileView = { path: "transcripts/reply-0010.md", hash: "a".repeat(32), size: 5200, pinned: false, readers: "gm", learned: false, transcript: true, provenance: { turn: 10 } };
const PINS: WorkspaceFileView = { path: ".pins.json", hash: "b".repeat(32), size: 60, pinned: false, readers: "gm", learned: false, provenance: { role: "gm", turn: 2 } };
/** Every area, listed out of order as the backend may. */
const ALL = [PINS, REPLY_10, SCENE_10, JORDAN, MARCUS, REPLY_9, ANCHOR, SCENE_9, FLEET, DANNY];

const MARCUS_TEXT = "# Marcus Delgado\n\nOwes on the shop. Won't say so to Jordan.";

/** The words a rendered tree shows, in order. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

/** The one Button reading `label`. */
function button(tree: unknown, label: string): Props {
  const found = propsOf(tree, Button).filter((p) => textOf(p.children) === label);
  const [only] = found;
  if (found.length !== 1 || !only) throw new Error(`${found.length} buttons reading ${label}`);
  return only;
}

function click(props: Props): void {
  const onClick = props.onClick;
  if (typeof onClick !== "function") throw new Error("not a button");
  onClick();
}

/** A backend stand-in: records each request, answers with `answer`'s result (null: it failed, as `app.request` resolves after its toast). */
function recorder(answer: (body: WorkspaceBody) => WorkspaceResult | null) {
  const sent: WorkspaceBody[] = [];
  const events: string[] = [];
  const listed: WorkspaceFileView[][] = [];
  const said: [string, WorkspaceResult][] = [];
  const controls = workspaceControls(
    CHAT,
    async (body) => {
      sent.push(body);
      return answer(body);
    },
    {
      files: (files) => {
        events.push("files");
        listed.push(files);
      },
      changed: async (text, result) => {
        events.push("changed");
        said.push([text, result]);
      },
    },
  );
  return { controls, sent, events, listed, said };
}

/** The browser over `files`, its callbacks recorded. */
function browser(files: readonly WorkspaceFileView[] | null, over: Partial<WorkspaceBrowserProps> = {}) {
  const calls: [string, unknown][] = [];
  const tree = WorkspaceBrowser({
    files,
    session: undefined,
    selected: null,
    busy: false,
    open: (_key, start) => start,
    onToggle: (key, open) => void calls.push(["toggle", [key, open]]),
    onOpen: (page) => void calls.push(["open", page]),
    onNew: () => void calls.push(["new", null]),
    ...over,
  });
  return { tree, calls };
}

/** The rows the browser lists, as their paths in order. */
const rowPaths = (tree: unknown): unknown[] => propsOf(tree, "button").flatMap((p) => (p["data-lre-ws-file"] !== undefined ? [p["data-lre-ws-file"]] : []));

/** A file's pane, its callbacks recorded and its runs collected so a test can wait for them. */
function pane(controls: WorkspaceControls, over: Partial<WorkspaceFilePaneProps> = {}) {
  const runs: Promise<unknown>[] = [];
  const calls: [string, unknown][] = [];
  const props: WorkspaceFilePaneProps = {
    file: MARCUS,
    text: MARCUS_TEXT,
    draft: MARCUS_TEXT,
    busy: false,
    controls,
    run: (action) => void runs.push(action()),
    confirm: async (title) => {
      calls.push(["confirm", title]);
      return true;
    },
    onDraft: (text) => void calls.push(["draft", text]),
    onSaved: (text) => void calls.push(["saved", text]),
    onRevert: () => void calls.push(["revert", null]),
    onMove: () => void calls.push(["move", null]),
    onDeleted: () => void calls.push(["deleted", null]),
    onBack: () => void calls.push(["back", null]),
    ...over,
  };
  return { tree: WorkspaceFilePane(props), runs, calls };
}

/** The path dialog for `state`, what it hands back recorded. */
function dialog(state: PathDialogState, paths: readonly string[] = ALL.map((f) => f.path), busy = false) {
  const calls: [string, unknown][] = [];
  const tree = PathDialog({ state, paths, busy, onChange: (next) => void calls.push(["change", next]), onSubmit: () => void calls.push(["submit", null]), onCancel: () => void calls.push(["cancel", null]) });
  return { tree, calls };
}

function submitForm(tree: unknown): boolean {
  const [form] = propsOf(tree, "form");
  let prevented = false;
  (form?.onSubmit as (event: unknown) => void)({ preventDefault: () => void (prevented = true) });
  return prevented;
}

const AFTER: WorkspaceFileView[] = [{ ...MARCUS, hash: "5".repeat(32), size: 70 }, ANCHOR];
const CHANGED: WorkspaceResult = { files: AFTER, pending: false, undo: "chip-ws-1" };

describe("GM → Workspace: the browser", () => {
  test("groups the files by area, Notes, Learned, Transcripts and the Pins file, each folders first and in natural order", () => {
    expect(ALL.map((f) => workspaceArea(f.path))).toEqual(["pins", "transcripts", "notes", "learned", "notes", "transcripts", "notes", "notes", "notes", "notes"]);
    const groups = workspaceGroups(ALL);
    expect(groups.map((g) => [g.area, treeFiles(g.nodes).map((f) => f.path)])).toEqual([
      ["notes", ["lore-drafts/rusty-anchor.md", "notes/scenes/scene-9.md", "notes/scenes/scene-10.md", "notes/danny.md", "notes/marcus.md", "plans/fleet-contract.md"]],
      ["learned", ["learned/jordan.md"]],
      ["transcripts", ["transcripts/reply-0009.md", "transcripts/reply-0010.md"]],
      ["pins", [".pins.json"]],
    ]);
    // The rows list in the same order, under their areas' headings.
    const { tree } = browser(ALL);
    expect(rowPaths(tree)).toEqual(groups.flatMap((g) => treeFiles(g.nodes).map((f) => f.path)));
    expect(propsOf(tree, "details").filter((p) => p["data-lre-ws-area"] !== undefined).map((p) => [p["data-lre-ws-area"], textOf((p.children as unknown[])[0])])).toEqual([
      ["notes", "Notes6"],
      ["learned", "Learned1"],
      ["transcripts", "Transcripts2"],
      ["pins", "Pins file1"],
    ]);
    // An area's own folder isn't listed again: learned/ and transcripts/ files sit straight under their areas.
    expect(groups.find((g) => g.area === "learned")?.nodes.map((n) => n.kind)).toEqual(["file"]);
  });

  test("sorts folders before files and digits as numbers: scene-9 before scene-10, reply-9 before reply-10", () => {
    expect(["reply-10.md", "reply-9.md", "Reply-2.md", "reply-1.md"].sort(naturalCompare)).toEqual(["reply-1.md", "Reply-2.md", "reply-9.md", "reply-10.md"]);
    const tree = workspaceTree([DANNY, SCENE_10, MARCUS, SCENE_9], "notes/");
    expect(tree.map((n) => [n.kind, n.name])).toEqual([
      ["folder", "scenes"],
      ["file", "danny.md"],
      ["file", "marcus.md"],
    ]);
    const [scenes] = tree;
    expect(scenes?.kind === "folder" ? [scenes.path, scenes.count, scenes.children.map((n) => n.name)] : null).toEqual(["notes/scenes/", 2, ["scene-9.md", "scene-10.md"]]);
    // A folder row says how many files it holds and folds over them, open until you fold it.
    const { tree: list, calls } = browser([DANNY, SCENE_10, MARCUS, SCENE_9]);
    const folder = propsOf(list, "details").find((p) => p["data-lre-ws-folder"] === "notes/scenes/");
    expect([folder?.open, textOf(folder?.children)]).toEqual([true, expect.stringContaining("scenes2 files")]);
    (folder?.onToggle as (event: unknown) => void)({ currentTarget: { open: false } });
    expect(calls).toEqual([["toggle", ["folder:notes/scenes/", false]]]);
  });

  test("Transcripts start folded and the other areas open; a choice made stands", () => {
    const areas = (tree: unknown) => propsOf(tree, "details").flatMap((p) => (p["data-lre-ws-area"] !== undefined ? [[p["data-lre-ws-area"], p.open]] : []));
    expect(areas(browser(ALL).tree)).toEqual([
      ["notes", true],
      ["learned", true],
      ["transcripts", false],
      ["pins", true],
    ]);
    const chosen = browser(ALL, { open: (key, start) => (key === "area:transcripts" ? true : key === "area:notes" ? false : start) }).tree;
    expect(areas(chosen)).toEqual([
      ["notes", false],
      ["learned", true],
      ["transcripts", true],
      ["pins", true],
    ]);
  });

  test("a row opens its file, the open one is marked current, New note asks for a path, the session opens in the pane", () => {
    const session: SessionView = { summary: "SUMMARY", summaryKnowledge: "gm", turns: 3, tokens: 4200, segments: [], reads: { knowledge: "pov", turns: 3, tokens: 1200, summary: false }, missing: 0, rollback: "pending" };
    const { tree, calls } = browser(FILES, { selected: MARCUS.path, session });
    const rows = propsOf(tree, "button").filter((p) => p["data-lre-ws-file"] !== undefined);
    expect(rows.map((r) => [r["data-lre-ws-file"], r["aria-current"]])).toEqual([
      ["lore-drafts/rusty-anchor.md", undefined],
      ["notes/danny.md", undefined],
      ["notes/marcus.md", "true"],
      ["plans/fleet-contract.md", undefined],
    ]);
    for (const row of rows) click(row);
    click(button(tree, "New note"));
    const sessionRow = propsOf(tree, "button").find((p) => p["data-lre-ws-session"] !== undefined);
    expect(textOf(sessionRow?.children)).toContain("The main agent's session");
    expect((propsOf(sessionRow?.children, ChipRow)[0]?.chips as { text: string }[]).map((c) => c.text)).toEqual(["3 turns", "~4,200 tokens", "Summarized", "Rollback waits"]);
    if (sessionRow) click(sessionRow);
    expect(calls).toEqual([["open", "lore-drafts/rusty-anchor.md"], ["open", "notes/danny.md"], ["open", "notes/marcus.md"], ["open", "plans/fleet-contract.md"], ["new", null], ["open", SESSION_PAGE]]);
    expect(textOf(tree)).toContain("4 files · 1 pinned");
    // While a request is in flight, or before the list comes, New note waits.
    expect(button(browser(FILES, { busy: true }).tree, "New note").disabled).toBe(true);
    expect(button(browser(null).tree, "New note").disabled).toBe(true);
  });

  test("with no files, it says what the workspace is; until the list comes, that it is being read", () => {
    const empty = browser([]).tree;
    expect(rowPaths(empty)).toEqual([]);
    const [note] = propsOf(empty, Empty);
    expect(textOf(note?.children)).toContain("the notes the agents keep for this chat");
    expect(textOf(note?.children)).toContain("follow the story");
    const reading = browser(null).tree;
    expect(rowPaths(reading)).toEqual([]);
    expect(textOf(reading)).toContain("Reading the workspace…");
  });
});

describe("GM → Workspace: provenance and status chips", () => {
  const words = (file: WorkspaceFileView) => fileChips(file).map((c) => `${c.kind}:${c.text}`);

  test("each file says who wrote it, at which reply, who may read it, and Pinned, Learned or Read-only", () => {
    expect(words(MARCUS)).toEqual(["who:GM assistant", "reply:Reply 4", "readers:Everyone's", "pinned:Pinned"]);
    expect(words(ANCHOR)).toEqual(["who:Scene lore", "reply:Reply 2", "readers:Everyone's"]);
    expect(words(FLEET)).toEqual(["who:You (GM)", "reply:Before reply 1", "readers:GM only"]);
    expect(words(DANNY)).toEqual(["who:The turn", "reply:Reply 3", "readers:GM only"]);
    expect(words({ ...DANNY, provenance: { turn: null } })).toEqual(["who:The turn", "reply:This turn", "readers:GM only"]);
    expect(words(JORDAN)).toEqual(["who:GM assistant", "reply:Before reply 1", "readers:Your character's", "pinned:Pinned", "learned:Learned"]);
    expect(words(REPLY_10)).toEqual(["who:The turn", "reply:Reply 10", "readers:GM only", "read-only:Read-only"]);
    // Each chip says in full what it means, for its tooltip.
    expect(fileChips(FLEET).map((c) => c.title)).toEqual(["Written by you, the GM", "Written before the first reply", "Who may read it: GM only"]);
  });

  test("a row and a file's pane carry the file's chips; the sentence form stays for the record", () => {
    const { tree } = browser([JORDAN]);
    const [chips] = propsOf(tree, ChipRow);
    expect(chips?.chips).toEqual(fileChips(JORDAN));
    expect(textOf(tree)).toContain("40 characters");
    const page = pane(recorder(() => CHANGED).controls).tree;
    expect(propsOf(page, ChipRow).map((p) => [p.label, p.chips])).toEqual([["About this file", fileChips(MARCUS)]]);
    // Rendered, a chip is its words, its kind for its style and its meaning as its tooltip.
    const rendered = ChipRow({ chips: fileChips(MARCUS), label: "About this file" });
    expect(propsOf(rendered, "span").filter((p) => p["data-chip"] !== undefined).map((p) => [p["data-chip"], p.title, textOf(p.children)])).toEqual(fileChips(MARCUS).map((c) => [c.kind, c.title, c.text]));
    expect([MARCUS, ANCHOR, FLEET, DANNY, { ...DANNY, provenance: { turn: null } }, REPLY_9].map(provenanceWords)).toEqual(["GM assistant · reply 4", "Scene lore · reply 2", "You · before the first reply", "The turn's own · reply 3", "Written by the turn under way", "The turn's transcript · reply 9"]);
    expect([0, 1, 4120].map(sizeWords)).toEqual(["0 characters", "1 character", "4,120 characters"]);
  });
});

describe("GM → Workspace: New note", () => {
  const paths = ALL.map((f) => f.path);

  test("asks for a whole, valid, free path outside transcripts/, saying what's wrong once it is one you typed", () => {
    expect(newNoteProblem("notes/", paths)).toContain("Type the note's path");
    expect(newNoteProblem("notes/../harbor.md", paths)).toContain("A path is names joined by /");
    expect(newNoteProblem(MARCUS.path, paths)).toBe("There is already a file at notes/marcus.md.");
    expect(newNoteProblem("transcripts/reply-0011.md", paths)).toContain("read-only");
    expect(newNoteProblem("notes/harbor.md", paths)).toBeNull();
    expect(newNoteProblem("learned/harbor master.md", paths)).toBeNull();
    const at = (value: string) => dialog({ mode: "new", from: null, value, readers: "gm" }).tree;
    const error = (value: string) => propsOf(at(value), Field).find((p) => p.label === "Path")?.error;
    // A folder waiting for its name is no mistake yet.
    expect(["notes/", "notes/../harbor.md", MARCUS.path, "notes/harbor.md"].map(error)).toEqual([null, newNoteProblem("notes/../harbor.md", paths), "There is already a file at notes/marcus.md.", null]);
    expect(["notes/", MARCUS.path, "notes/harbor.md"].map((v) => button(at(v), "Create").disabled)).toEqual([true, true, false]);
    expect(button(dialog({ mode: "new", from: null, value: "notes/harbor.md", readers: "gm" }, paths, true).tree, "Create").disabled).toBe(true);
    expect(textOf(at("notes/harbor.md"))).toContain("New note");
  });

  test("starts in the open note's folder, else notes/; typing, who may read it, Create and Cancel reach the tab", () => {
    expect([null, SESSION_PAGE, MARCUS.path, JORDAN.path, REPLY_9.path, ".pins.json", "top.md"].map(newNoteFolder)).toEqual(["notes/", "notes/", "notes/", "learned/", "notes/", "notes/", "notes/"]);
    const state: PathDialogState = { mode: "new", from: null, value: "notes/", readers: "gm" };
    const { tree, calls } = dialog(state);
    const input = propsOf(tree, "input").find((p) => p.id === "lre-workspace-path");
    (input?.onInput as (event: unknown) => void)({ currentTarget: { value: "notes/harbor.md" } });
    const [seg] = propsOf(tree, Seg);
    expect([seg?.label, seg?.value]).toEqual(["Who may read it", "gm"]);
    (seg?.onChange as (v: string) => void)("pov");
    expect(textOf(tree)).toContain(READERS_NOTES.gm);
    // Create sends nothing while the path can't take it, but the form never reloads the page.
    expect(submitForm(tree)).toBe(true);
    click(button(tree, "Cancel"));
    const ready = dialog({ ...state, value: "notes/harbor.md" });
    expect(submitForm(ready.tree)).toBe(true);
    expect(calls).toEqual([
      ["change", { ...state, value: "notes/harbor.md" }],
      ["change", { ...state, readers: "pov" }],
      ["cancel", null],
    ]);
    expect(ready.calls).toEqual([["submit", null]]);
  });

  test("Create writes the note empty with who may read it, sets the list and hands the result to changed", async () => {
    const created: WorkspaceResult = { files: [...FILES, { ...DANNY, path: "notes/harbor.md", size: 0, readers: "pov", provenance: { role: "gm", turn: 4 } }], pending: false, undo: "chip-ws-2" };
    const r = recorder(() => created);
    expect(await r.controls.create("notes/harbor.md", "pov", () => void r.events.push("opened"))).toBe(true);
    expect(r.sent).toEqual([{ type: "lre.workspace", op: "write", chatId: CHAT, path: "notes/harbor.md", text: "", readers: "pov" }]);
    expect(r.said).toEqual([["Created notes/harbor.md", created]]);
    expect(r.events).toEqual(["files", "opened", "changed"]);
    expect(await recorder(() => null).controls.create("notes/harbor.md", "gm")).toBe(false);
  });
});

describe("GM → Workspace: editing a file", () => {
  test("Save and Revert wait for a change to the draft, which the bar says isn't saved; typing reaches the draft", () => {
    const { controls } = recorder(() => CHANGED);
    const clean = pane(controls);
    expect(propsOf(clean.tree, "div").some((p) => p["data-lre-workspace-file"] === "notes/marcus.md")).toBe(true);
    expect([button(clean.tree, "Save").disabled, button(clean.tree, "Revert").disabled]).toEqual([true, true]);
    expect(textOf(clean.tree)).toContain("Saved · 59 characters");
    const changed = pane(controls, { draft: `${MARCUS_TEXT}\nSaw Dale Whitcomb at the Rusty Anchor.` });
    expect([button(changed.tree, "Save").disabled, button(changed.tree, "Revert").disabled]).toEqual([false, false]);
    expect(textOf(changed.tree)).toContain("Not saved");
    click(button(changed.tree, "Revert"));
    expect(changed.calls).toEqual([["revert", null]]);
    const area = propsOf(clean.tree, "textarea")[0];
    expect(area?.["aria-label"]).toBe("Text of notes/marcus.md");
    (area?.onInput as (event: unknown) => void)({ currentTarget: { value: "Marcus: the fleet contract." } });
    expect(clean.calls).toEqual([["draft", "Marcus: the fleet contract."]]);
    // Nothing goes while a request is in flight.
    const busy = pane(controls, { draft: "changed", busy: true }).tree;
    expect(["Save", "Revert", "Unpin", "Rename or move", "Delete"].map((label) => button(busy, label).disabled)).toEqual([true, true, true, true, true]);
    expect(propsOf(clean.tree, Button).map((p) => textOf(p.children))).toEqual(["Revert", "Save", "Unpin", "Rename or move", "Delete"]);
    expect(propsOf(pane(controls, { file: ANCHOR }).tree, Button).map((p) => textOf(p.children))).toEqual(["Revert", "Save", "Pin", "Rename or move", "Delete"]);
    // The pins file is never pinned itself.
    expect(propsOf(pane(controls, { file: PINS }).tree, Button).map((p) => textOf(p.children))).toEqual(["Revert", "Save", "Rename or move", "Delete"]);
  });

  test("Ctrl+S or ⌘S saves a changed draft and nothing else; the request sends the draft and hands the result to changed", async () => {
    const r = recorder(() => CHANGED);
    const draft = `${MARCUS_TEXT}\nSaw Dale Whitcomb at the Rusty Anchor.`;
    const key = (tree: unknown, event: { key: string; ctrlKey?: boolean; metaKey?: boolean }) => {
      let prevented = false;
      (propsOf(tree, "textarea")[0]?.onKeyDown as (e: unknown) => void)({ ...event, preventDefault: () => void (prevented = true) });
      return prevented;
    };
    const clean = pane(r.controls);
    expect(key(clean.tree, { key: "s", ctrlKey: true })).toBe(true);
    const page = pane(r.controls, { draft });
    expect(key(page.tree, { key: "s" })).toBe(false);
    expect(key(page.tree, { key: "S", metaKey: true })).toBe(true);
    await Promise.all([...clean.runs, ...page.runs]);
    expect(r.sent).toEqual([{ type: "lre.workspace", op: "write", chatId: CHAT, path: "notes/marcus.md", text: draft }]);
    expect(r.listed).toEqual([AFTER]);
    expect(r.said).toEqual([["Saved notes/marcus.md", CHANGED]]);
    expect(page.calls).toEqual([["saved", draft]]);
    expect(r.events).toEqual(["files", "changed"]);
  });

  test("a save that failed keeps the draft: no list, no notice, nothing saved", async () => {
    const r = recorder(() => null);
    const page = pane(r.controls, { draft: "Marcus owes Dale Whitcomb." });
    click(button(page.tree, "Save"));
    await Promise.all(page.runs);
    expect(r.sent).toEqual([{ type: "lre.workspace", op: "write", chatId: CHAT, path: "notes/marcus.md", text: "Marcus owes Dale Whitcomb." }]);
    expect([r.listed, r.said, page.calls]).toEqual([[], [], []]);
  });

  test("leaving a draft with changes not saved asks first, and stays when you keep it; a saved one leaves at once", async () => {
    const asked: [string, string, string][] = [];
    const left: string[] = [];
    const answer = (ok: boolean) => async (title: string, message: string, label: string) => {
      asked.push([title, message, label]);
      return ok;
    };
    expect(await guardDraft(null, answer(false), () => void left.push("clean"))).toBe(true);
    expect(asked).toEqual([]);
    expect(await guardDraft(MARCUS.path, answer(false), () => void left.push("kept"))).toBe(false);
    expect(await guardDraft(MARCUS.path, answer(true), () => void left.push("discarded"))).toBe(true);
    expect(left).toEqual(["clean", "discarded"]);
    expect(asked).toEqual([
      ["Discard your changes?", "notes/marcus.md has changes you haven't saved. Leave it and they're gone.", "Discard"],
      ["Discard your changes?", "notes/marcus.md has changes you haven't saved. Leave it and they're gone.", "Discard"],
    ]);
  });

  test("a file that is gone says so, with nothing to press", () => {
    const { controls } = recorder(() => CHANGED);
    const { tree } = pane(controls, { text: null, draft: "" });
    expect(propsOf(tree, Button)).toEqual([]);
    expect(textOf(propsOf(tree, Empty)[0]?.children)).toContain("This file is gone");
  });
});

describe("GM → Workspace: a transcript", () => {
  test("opens read-only: its text, its Read-only chip, nothing to edit, pin, move or delete", () => {
    const { controls } = recorder(() => CHANGED);
    const { tree } = pane(controls, { file: REPLY_9, text: "# Reply 9\n\nscene: workspace_write notes/harbor.md", draft: "# Reply 9\n\nscene: workspace_write notes/harbor.md" });
    expect(propsOf(tree, Button)).toEqual([]);
    expect(propsOf(tree, "textarea")).toEqual([]);
    expect(propsOf(tree, Seg)).toEqual([]);
    const [pre] = propsOf(tree, "pre");
    expect([pre?.["aria-label"], textOf(pre?.children)]).toEqual(["Text of transcripts/reply-0009.md, read-only", "# Reply 9\n\nscene: workspace_write notes/harbor.md"]);
    expect(textOf(tree)).toContain("read-only");
    expect(propsOf(tree, ChipRow)[0]?.chips).toEqual(fileChips(REPLY_9));
    // Nothing moves into transcripts/ either.
    expect(moveProblem(MARCUS.path, "transcripts/marcus.md", [])).toContain("read-only");
  });
});

describe("GM → Workspace: the requests", () => {
  test("list and read on open ask for the chat's files and the file's text", async () => {
    const r = recorder((body) => (body.op === "list" ? { files: FILES } : body.op === "read" && body.path === MARCUS.path ? { text: MARCUS_TEXT } : { text: null }));
    expect(await r.controls.list()).toEqual(FILES);
    expect(await r.controls.read(MARCUS.path)).toBe(MARCUS_TEXT);
    expect(await r.controls.read("notes/priya.md")).toBeNull();
    expect(r.sent).toEqual([
      { type: "lre.workspace", op: "list", chatId: CHAT },
      { type: "lre.workspace", op: "read", chatId: CHAT, path: "notes/marcus.md" },
      { type: "lre.workspace", op: "read", chatId: CHAT, path: "notes/priya.md" },
    ]);
    // A read that failed (its error said in a toast) is no text at all.
    const failed = recorder(() => null);
    expect(await failed.controls.read(MARCUS.path)).toBeUndefined();
    expect(await failed.controls.list()).toBeNull();
  });

  test("Unpin and Pin send the file's new state", async () => {
    const r = recorder(() => CHANGED);
    const pinned = pane(r.controls);
    click(button(pinned.tree, "Unpin"));
    const unpinned = pane(r.controls, { file: ANCHOR, text: "The Rusty Anchor", draft: "The Rusty Anchor" });
    click(button(unpinned.tree, "Pin"));
    await Promise.all([...pinned.runs, ...unpinned.runs]);
    expect(r.sent).toEqual([
      { type: "lre.workspace", op: "pin", chatId: CHAT, path: "notes/marcus.md", pinned: false },
      { type: "lre.workspace", op: "pin", chatId: CHAT, path: "lore-drafts/rusty-anchor.md", pinned: true },
    ]);
    expect(r.said).toEqual([
      ["Unpinned notes/marcus.md", CHANGED],
      ["Pinned lore-drafts/rusty-anchor.md", CHANGED],
    ]);
  });

  test("Who may read it shows the file's readers and sends the one chosen", async () => {
    const r = recorder(() => CHANGED);
    const page = pane(r.controls);
    const [seg] = propsOf(page.tree, Seg);
    expect([seg?.label, seg?.value, (seg?.options as { value: string; label: string }[] | undefined)?.map((o) => o.label)]).toEqual(["Who may read it", "everyone", ["GM only", "Everyone's, secrets marked", "Your character's"]]);
    expect(textOf(page.tree)).toContain(READERS_NOTES.everyone);
    (seg?.onChange as (v: string) => void)("gm");
    await Promise.all(page.runs);
    expect(r.sent).toEqual([{ type: "lre.workspace", op: "readers", chatId: CHAT, path: "notes/marcus.md", readers: "gm" }]);
    expect(r.said).toEqual([["Who may read notes/marcus.md: GM only", CHANGED]]);
  });

  test("Rename or move opens the path dialog, open only to a new, valid, free path on the same side of learned/", async () => {
    const r = recorder(() => CHANGED);
    const page = pane(r.controls);
    click(button(page.tree, "Rename or move"));
    expect(page.calls).toEqual([["move", null]]);
    const paths = FILES.map((f) => f.path);
    const at = (value: string) => dialog({ mode: "move", from: MARCUS.path, value, readers: MARCUS.readers }, paths).tree;
    expect(propsOf(at(MARCUS.path), Seg)).toEqual([]);
    expect(textOf(at(MARCUS.path))).toContain("Rename or move notes/marcus.md");
    expect([MARCUS.path, "notes/../marcus.md", FLEET.path, "learned/marcus.md", "notes/marcus-delgado.md"].map((v) => button(at(v), "Move").disabled)).toEqual([true, true, true, true, false]);
    const why = (value: string) => propsOf(at(value), Field).find((p) => p.label === "Path")?.error;
    expect([MARCUS.path, FLEET.path, "notes/marcus-delgado.md"].map(why)).toEqual([null, "There is already a file at plans/fleet-contract.md.", null]);
    expect(moveProblem(MARCUS.path, MARCUS.path, paths)).toBe("Type the path to move it to.");
    expect(moveProblem("learned/jordan.md", "notes/jordan.md", [])).toContain("learned/");
    expect(moveProblem("learned/jordan.md", "learned/people/jordan.md", [])).toBeNull();
    expect(moveProblem(MARCUS.path, "people/marcus delgado.md", paths)).toBeNull();
  });

  test("Move sends from and to, and the pane follows the file once the list has it, before the GM view reloads", async () => {
    const moved: WorkspaceResult = { files: [{ ...MARCUS, path: "notes/marcus-delgado.md" }, ANCHOR], pending: true, undo: null };
    const r = recorder(() => moved);
    await r.controls.move(MARCUS.path, "notes/marcus-delgado.md", () => void r.events.push("moved"));
    expect(r.sent).toEqual([{ type: "lre.workspace", op: "move", chatId: CHAT, from: "notes/marcus.md", to: "notes/marcus-delgado.md" }]);
    expect(r.said).toEqual([["Moved notes/marcus.md to notes/marcus-delgado.md", moved]]);
    expect(r.events).toEqual(["files", "moved", "changed"]);
  });

  test("Delete sends the path and closes the pane, its Undo in the notice; a learned note asks first, having none", async () => {
    const r = recorder(() => CHANGED);
    const page = pane(r.controls, { file: ANCHOR, text: "The Rusty Anchor", draft: "The Rusty Anchor" });
    click(button(page.tree, "Delete"));
    await Promise.all(page.runs);
    expect(r.sent).toEqual([{ type: "lre.workspace", op: "delete", chatId: CHAT, path: "lore-drafts/rusty-anchor.md" }]);
    expect(r.said).toEqual([["Deleted lore-drafts/rusty-anchor.md", CHANGED]]);
    expect(page.calls).toEqual([["deleted", null]]);
    // Kept: nothing sent.
    const learned = recorder(() => CHANGED);
    const kept = pane(learned.controls, { file: JORDAN, text: "Jordan", draft: "Jordan", confirm: async () => false });
    click(button(kept.tree, "Delete"));
    await Promise.all(kept.runs);
    expect([learned.sent, kept.calls]).toEqual([[], []]);
    const gone = pane(learned.controls, { file: JORDAN, text: "Jordan", draft: "Jordan" });
    click(button(gone.tree, "Delete"));
    await Promise.all(gone.runs);
    expect(gone.calls).toEqual([
      ["confirm", "Delete the learned note"],
      ["deleted", null],
    ]);
    expect(learned.sent).toEqual([{ type: "lre.workspace", op: "delete", chatId: CHAT, path: "learned/jordan.md" }]);
  });
});

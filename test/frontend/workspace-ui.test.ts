// GM → Workspace (C8 `lre.workspace`): the list's rows (path, who wrote it and when, size, Pinned) and
// its empty state; a file's page and its controls (Save until the draft changes, Pin or Unpin by
// state, Move only to a new, valid, free path, Delete); and the requests each control sends, as the
// literal objects, with each change's result handed to `changed` in its sentence. The pages are
// walked as rendered trees (no DOM), with a recording `request` in place of the backend.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { Badge, Button, Empty, Field, ListRow, Seg } from "../../src/frontend/components";
import { moveProblem, provenanceWords, READERS_NOTES, sizeWords, workspaceControls, WorkspaceFilePage, WorkspaceList, type WorkspaceBody, type WorkspaceControls, type WorkspaceFilePageProps, type WorkspaceResult } from "../../src/frontend/gm/workspace";
import type { WorkspaceFileView } from "../../src/shared/protocol";
import { propsOf, type Props } from "../support/tree";

const CHAT = "chat-port-alder";

const MARCUS: WorkspaceFileView = { path: "notes/marcus.md", hash: "1".repeat(32), size: 412, pinned: true, readers: "everyone", learned: false, provenance: { role: "assistant", key: "assistant.op-4-1", turn: 4 } };
const ANCHOR: WorkspaceFileView = { path: "lore-drafts/rusty-anchor.md", hash: "2".repeat(32), size: 1280, pinned: false, readers: "everyone", learned: false, provenance: { role: "scene_lore", key: "scene_lore.op-2-3", turn: 2 } };
const FLEET: WorkspaceFileView = { path: "plans/fleet-contract.md", hash: "3".repeat(32), size: 1, pinned: false, readers: "gm", learned: false, provenance: { role: "gm", key: "gm.op-0-1", turn: null } };
const DANNY: WorkspaceFileView = { path: "notes/danny.md", hash: "4".repeat(32), size: 96, pinned: false, readers: "gm", learned: false, provenance: { turn: 3 } };
const FILES = [MARCUS, ANCHOR, FLEET, DANNY];

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

/** A file's page, its callbacks recorded and its runs collected so a test can wait for them. */
function filePage(controls: WorkspaceControls, over: Partial<WorkspaceFilePageProps> = {}) {
  const runs: Promise<unknown>[] = [];
  const calls: [string, unknown][] = [];
  const props: WorkspaceFilePageProps = {
    file: MARCUS,
    text: MARCUS_TEXT,
    draft: MARCUS_TEXT,
    moveTo: MARCUS.path,
    paths: FILES.map((f) => f.path),
    busy: false,
    controls,
    run: (action) => void runs.push(action()),
    onDraft: (text) => void calls.push(["draft", text]),
    onMoveTo: (path) => void calls.push(["moveTo", path]),
    onSaved: (text) => void calls.push(["saved", text]),
    onMoved: (to) => void calls.push(["moved", to]),
    onBack: () => void calls.push(["back", null]),
    ...over,
  };
  return { tree: WorkspaceFilePage(props), runs, calls };
}

const AFTER: WorkspaceFileView[] = [{ ...MARCUS, hash: "5".repeat(32), size: 70 }, ANCHOR];
const CHANGED: WorkspaceResult = { files: AFTER, pending: false, undo: "chip-ws-1" };

describe("GM → Workspace: the list", () => {
  test("each row shows its path, who wrote it and at which reply, who may read it, its size and Pinned or Learned, in path order", () => {
    const opened: string[] = [];
    const tree = WorkspaceList({ files: FILES, onOpen: (path) => opened.push(path) });
    expect(propsOf(tree, "div").some((p) => p["data-lre-gm-list"] === "workspace")).toBe(true);
    const rows = propsOf(tree, ListRow);
    expect(rows.map((r) => [r.title, r.subtitle, r.value, r.id])).toEqual([
      ["lore-drafts/rusty-anchor.md", "Scene lore · reply 2 · Everyone's, secrets marked", "1,280 characters", "scene_lore.op-2-3"],
      ["notes/danny.md", "The turn's own · reply 3 · GM only", "96 characters", undefined],
      ["notes/marcus.md", "GM assistant · reply 4 · Everyone's, secrets marked", "412 characters", "assistant.op-4-1"],
      ["plans/fleet-contract.md", "You · before the first reply · GM only", "1 character", "gm.op-0-1"],
    ]);
    // Only the pinned file carries the badge.
    expect(rows.map((r) => (r.badge ? [(r.badge as VNode).type === Badge, textOf(r.badge)] : null))).toEqual([null, null, [true, "Pinned"], null]);
    for (const row of rows) click(row);
    expect(opened).toEqual(["lore-drafts/rusty-anchor.md", "notes/danny.md", "notes/marcus.md", "plans/fleet-contract.md"]);
    // A learned note says so, and who may read it.
    const learned: WorkspaceFileView = { path: "learned/jordan.md", hash: "6".repeat(32), size: 40, pinned: true, readers: "pov", learned: true, provenance: { role: "assistant", turn: null } };
    const [row] = propsOf(WorkspaceList({ files: [learned], onOpen: () => undefined }), ListRow);
    expect([row?.subtitle, textOf(row?.badge)]).toEqual(["GM assistant · before the first reply · Your character's", "Learned · Pinned"]);
  });

  test("with no files, it says what the workspace is; until the list comes, that it is being read", () => {
    const empty = WorkspaceList({ files: [], onOpen: () => undefined });
    expect(propsOf(empty, ListRow)).toEqual([]);
    const [note] = propsOf(empty, Empty);
    expect(textOf(note?.children)).toContain("the notes the agents keep for this chat");
    expect(textOf(note?.children)).toContain("follow the story");
    const reading = WorkspaceList({ files: null, onOpen: () => undefined });
    expect(propsOf(reading, ListRow)).toEqual([]);
    expect(textOf(reading)).toBe("Reading the workspace…");
  });

  test("provenance, size and the move check in words", () => {
    expect([MARCUS, ANCHOR, FLEET, DANNY, { ...DANNY, provenance: { turn: null } }].map(provenanceWords)).toEqual(["GM assistant · reply 4", "Scene lore · reply 2", "You · before the first reply", "The turn's own · reply 3", "Written by the turn under way"]);
    expect([0, 1, 4120].map(sizeWords)).toEqual(["0 characters", "1 character", "4,120 characters"]);
    const paths = FILES.map((f) => f.path);
    expect(moveProblem(MARCUS.path, MARCUS.path, paths)).toBe("Type the path to move it to.");
    expect(moveProblem(MARCUS.path, "notes/../marcus.md", paths)).toContain("A path is names joined by /");
    expect(moveProblem(MARCUS.path, "notes//marcus.md", paths)).toContain("A path is names joined by /");
    expect(moveProblem(MARCUS.path, FLEET.path, paths)).toBe("There is already a file at plans/fleet-contract.md.");
    expect(moveProblem(MARCUS.path, "people/marcus delgado.md", paths)).toBeNull();
  });
});

describe("GM → Workspace: a file's page", () => {
  test("Save waits for a change to the draft; Pin or Unpin follows the file; Delete is there", () => {
    const { controls } = recorder(() => CHANGED);
    const page = filePage(controls);
    expect(propsOf(page.tree, "div").some((p) => p["data-lre-workspace-file"] === "notes/marcus.md")).toBe(true);
    expect(button(page.tree, "Save").disabled).toBe(true);
    expect(button(filePage(controls, { draft: `${MARCUS_TEXT}\nSaw Dale Whitcomb at the Rusty Anchor.` }).tree, "Save").disabled).toBe(false);
    // Nothing goes while a request is in flight.
    const busy = filePage(controls, { draft: "changed", busy: true }).tree;
    expect(["Save", "Unpin", "Move", "Delete"].map((label) => button(busy, label).disabled)).toEqual([true, true, true, true]);
    expect(propsOf(page.tree, Button).map((p) => textOf(p.children))).toEqual(["Save", "Unpin", "Move", "Delete"]);
    expect(propsOf(filePage(controls, { file: ANCHOR }).tree, Button).map((p) => textOf(p.children))).toEqual(["Save", "Pin", "Move", "Delete"]);
    // Typing reaches the draft.
    const area = propsOf(page.tree, "textarea")[0];
    (area?.onInput as (event: unknown) => void)({ currentTarget: { value: "Marcus: the fleet contract." } });
    expect(page.calls).toEqual([["draft", "Marcus: the fleet contract."]]);
  });

  test("Move is open only to a new, valid path no listed file has, and says why not", () => {
    const { controls } = recorder(() => CHANGED);
    const at = (moveTo: string) => filePage(controls, { moveTo }).tree;
    const field = (tree: unknown) => propsOf(tree, "input").find((p) => p.id === "lre-workspace-move");
    expect(button(at(MARCUS.path), "Move").disabled).toBe(true);
    expect(button(at("notes/../marcus.md"), "Move").disabled).toBe(true);
    expect(button(at(FLEET.path), "Move").disabled).toBe(true);
    expect(button(at("notes/marcus-delgado.md"), "Move").disabled).toBe(false);
    // Why not, under the path: nothing while it is the file's own path, the reason once it is another.
    const why = (moveTo: string) => propsOf(at(moveTo), Field).find((p) => p.label === "New path")?.error;
    expect([MARCUS.path, "notes/../marcus.md", FLEET.path, "notes/marcus-delgado.md"].map(why)).toEqual([null, moveProblem(MARCUS.path, "notes/../marcus.md", []), "There is already a file at plans/fleet-contract.md.", null]);
    const page = filePage(controls);
    (field(page.tree)?.onInput as (event: unknown) => void)({ currentTarget: { value: "notes/marcus-delgado.md" } });
    expect(page.calls).toEqual([["moveTo", "notes/marcus-delgado.md"]]);
  });

  test("a file that is gone says so, with nothing to press", () => {
    const { controls } = recorder(() => CHANGED);
    const { tree } = filePage(controls, { text: null, draft: "" });
    expect(propsOf(tree, Button)).toEqual([]);
    expect(textOf(propsOf(tree, Empty)[0]?.children)).toContain("This file is gone");
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

  test("the edit and save request: Save sends the draft as the file's text, sets the list and hands the result to changed", async () => {
    const r = recorder(() => CHANGED);
    const draft = `${MARCUS_TEXT}\nSaw Dale Whitcomb at the Rusty Anchor.`;
    const page = filePage(r.controls, { draft });
    click(button(page.tree, "Save"));
    await Promise.all(page.runs);
    expect(r.sent).toEqual([{ type: "lre.workspace", op: "write", chatId: CHAT, path: "notes/marcus.md", text: draft }]);
    expect(r.listed).toEqual([AFTER]);
    expect(r.said).toEqual([["Saved notes/marcus.md", CHANGED]]);
    expect(page.calls).toEqual([["saved", draft]]);
    expect(r.events).toEqual(["files", "changed"]);
  });

  test("a save that failed keeps the draft: no list, no notice, nothing saved", async () => {
    const r = recorder(() => null);
    const page = filePage(r.controls, { draft: "Marcus owes Dale Whitcomb." });
    click(button(page.tree, "Save"));
    await Promise.all(page.runs);
    expect(r.sent).toEqual([{ type: "lre.workspace", op: "write", chatId: CHAT, path: "notes/marcus.md", text: "Marcus owes Dale Whitcomb." }]);
    expect([r.listed, r.said, page.calls]).toEqual([[], [], []]);
  });

  test("Unpin and Pin send the file's new state", async () => {
    const r = recorder(() => CHANGED);
    const pinned = filePage(r.controls);
    click(button(pinned.tree, "Unpin"));
    const unpinned = filePage(r.controls, { file: ANCHOR, text: "The Rusty Anchor", draft: "The Rusty Anchor", moveTo: ANCHOR.path });
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

  test("Who may read it shows the file's readers and sends the one chosen; a move across learned/ is refused before it is sent", async () => {
    const r = recorder(() => CHANGED);
    const page = filePage(r.controls);
    const [seg] = propsOf(page.tree, Seg);
    expect([seg?.label, seg?.value, (seg?.options as { value: string; label: string }[] | undefined)?.map((o) => o.label)]).toEqual(["Who may read it", "everyone", ["GM only", "Everyone's, secrets marked", "Your character's"]]);
    expect(textOf(page.tree)).toContain(READERS_NOTES.everyone);
    const choose = seg?.onChange;
    if (typeof choose !== "function") throw new Error("no choice");
    choose("gm");
    await Promise.all(page.runs);
    expect(r.sent).toEqual([{ type: "lre.workspace", op: "readers", chatId: CHAT, path: "notes/marcus.md", readers: "gm" }]);
    expect(r.said).toEqual([["Who may read notes/marcus.md: GM only", CHANGED]]);
    expect(moveProblem("learned/jordan.md", "notes/jordan.md", [])).toContain("learned/");
    expect(moveProblem("notes/marcus.md", "learned/marcus.md", [])).toContain("learned/");
    expect(moveProblem("learned/jordan.md", "learned/people/jordan.md", [])).toBeNull();
  });

  test("Move sends from and to, and the page follows the file once the list has it, before the GM view reloads", async () => {
    const moved: WorkspaceResult = { files: [{ ...MARCUS, path: "notes/marcus-delgado.md" }, ANCHOR], pending: true, undo: null };
    const r = recorder(() => moved);
    const page = filePage(r.controls, {
      moveTo: "notes/marcus-delgado.md",
      onMoved: (to) => void r.events.push(`moved ${to}`),
    });
    click(button(page.tree, "Move"));
    await Promise.all(page.runs);
    expect(r.sent).toEqual([{ type: "lre.workspace", op: "move", chatId: CHAT, from: "notes/marcus.md", to: "notes/marcus-delgado.md" }]);
    expect(r.said).toEqual([["Moved notes/marcus.md to notes/marcus-delgado.md", moved]]);
    expect(r.events).toEqual(["files", "moved notes/marcus-delgado.md", "changed"]);
  });

  test("Delete sends the path and goes back to the list", async () => {
    const r = recorder(() => CHANGED);
    const page = filePage(r.controls, { file: ANCHOR, text: "The Rusty Anchor", draft: "The Rusty Anchor", moveTo: ANCHOR.path });
    click(button(page.tree, "Delete"));
    await Promise.all(page.runs);
    expect(r.sent).toEqual([{ type: "lre.workspace", op: "delete", chatId: CHAT, path: "lore-drafts/rusty-anchor.md" }]);
    expect(r.said).toEqual([["Deleted lore-drafts/rusty-anchor.md", CHANGED]]);
    expect(page.calls).toEqual([["back", null]]);
  });
});

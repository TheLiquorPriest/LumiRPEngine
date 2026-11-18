// The Files page: a folder read a page at a time with a search across levels, a file read in pieces, what RPH
// does with each file in its words, a new file at a level, and a file of his under imported/ moved to where its
// kind is read from.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { TreeFileRow, TreeListed } from "../../../src/shared/api";
import { FilesView, type FilesViewProps, NO_FILES, startOf, addressOf } from "../../../src/ui/pages/files";
import { importedTarget, KINDS, viewPathAt } from "../../../src/ui/pages/files/kinds";
import { filesControl, type FilesShown } from "../../../src/ui/pages/files/model";
import { standingOf, unreadIn } from "../../../src/ui/pages/files/standing";
import { askingClient, settle } from "../asking";
import { RpeError } from "../../../src/ui/client";
import { elements, expand, press, textOf } from "../vnodes";
import { filesCalls } from "../../../src/ui/pages/files";

function row(path: string, over: Partial<TreeFileRow> = {}): TreeFileRow {
  return { path, level: "global", kind: "yours", bytes: 100, item: null, applies: true, replacedBy: null, off: false, offIn: [], editable: true, shipped: null, defaultChanged: null, ...over };
}
const listed = (entry: TreeFileRow): TreeListed => ({ name: entry.path.split("/").at(-1) ?? entry.path, path: entry.path, folder: false, level: entry.level, entry });

function view(shown: Partial<FilesShown>, chat: string | null = "chat-calder") {
  const calls: string[] = [];
  const noop = (name: string) => () => void calls.push(name);
  const props: FilesViewProps = {
    chat,
    shown: { ...NO_FILES, ...shown },
    onFolder: (p) => void calls.push(`folder:${p}`),
    onSearch: (w) => void calls.push(`search:${w}`),
    onMore: noop("more"),
    onOpen: (p) => void calls.push(`open:${p}`),
    onClose: noop("close"),
    onPiece: noop("piece"),
    onMode: (m) => void calls.push(`mode:${m}`),
    onPin: (path, level, agent, pinned) => void calls.push(`pin:${path}:${level}:${agent}:${pinned}`),
    onPinning: noop("pinning"),
    onDraft: noop("draft"),
    onSave: noop("save"),
    onRemove: noop("remove"),
    onSwitch: noop("switch"),
    onDiff: noop("diff"),
    onEdit: noop("edit"),
    onEditText: noop("edit-text"),
    onLevel: noop("level"),
    onAccept: noop("accept"),
    onDismiss: noop("dismiss"),
    onStack: noop("stack"),
    onApply: noop("apply"),
    onMake: (path, level) => void calls.push(`make:${level}:${path}`),
    onMakeFolder: (p) => void calls.push(`make-folder:${p}`),
    onMove: (from, to) => void calls.push(`move:${from}>${to}`),
    onCopy: noop("copy"),
    onRemoveFolder: (p, all) => void calls.push(`remove-folder:${p}:${all}`),
    onKeepFolder: noop("keep-folder"),
  };
  const tree = expand(h(FilesView, props));
  return { tree, text: textOf(tree), calls };
}

describe("the Files page", () => {
  test("a folder opens a page at a time and the search goes across the levels; the address names a folder or a file", async () => {
    const { client, asked } = askingClient();
    const seen: FilesShown[] = [];
    const control = filesControl(filesCalls(client, "chat-calder"), () => ({ entries: 2, bytes: 100 }), (s) => seen.push(s));
    // The first page of the chat's top, two entries, and the next after "b".
    expect(asked[0]).toMatchObject({ key: "GET /api/v1/files-list", query: { chat: "chat-calder", folder: "", limit: 2 } });
    asked[0]?.answer({ folder: "", items: [listed(row("@global/a.md")), listed(row("@global/b.md"))], next: "b", levels: ["global", "chat"], stopped: null });
    await settle();
    control.more();
    expect(asked.at(-1)).toMatchObject({ query: { folder: "", after: "b", limit: 2 } });
    control.search("lamp");
    expect(asked.at(-1)).toMatchObject({ key: "GET /api/v1/files-list", query: { search: "lamp", limit: 2 } });
    control.stop();
    expect(seen.at(-1)?.browse.search).toBe("lamp");
    expect(startOf(["@global/rules/"])).toEqual({ folder: "@global/rules", file: null });
    expect(startOf(["@global/rules/x.md"])).toEqual({ folder: "@global/rules", file: "@global/rules/x.md" });
    expect(addressOf("@global/rules", null)).toEqual(["@global/rules/"]);
  });

  test("a file opens its first piece, and the next piece goes behind it", async () => {
    const { client, asked } = askingClient();
    let last: FilesShown = NO_FILES;
    const control = filesControl(filesCalls(client, null), () => ({ entries: 5, bytes: 10 }), (s) => (last = s));
    control.open("@global/TURN.md");
    const read = asked.find((a) => a.key === "GET /api/v1/files/*");
    expect(read).toMatchObject({ query: { offset: 0, length: 10 } });
    read?.answer({ path: "@global/TURN.md", level: "global", kind: "yours", bytes: 25, editable: true, text: "0123456789", from: 0, to: 10, more: true });
    await settle();
    control.piece();
    const next = asked.filter((a) => a.key === "GET /api/v1/files/*").at(-1);
    expect(next).toMatchObject({ query: { offset: 10, length: 10 } });
    next?.answer({ path: "@global/TURN.md", level: "global", kind: "yours", bytes: 25, editable: true, text: "abcdefghij", from: 10, to: 20, more: true });
    await settle();
    expect(last.open?.file?.text).toBe("0123456789abcdefghij");
    control.stop();
  });

  test("each file says in RPH's words what it does with it: held out, an example, read by no agent, a config", () => {
    expect(standingOf(row("@global/rules/a.md", { item: "rules/a", applies: false, held: "needs" }), false).words).toContain("held out: a file its needs: names is not in force");
    expect(standingOf(row("@global/rules/b.md", { item: "rules/b", applies: false, held: "broken", problems: ["no agents"] }), false).words).toContain("its header does not parse");
    expect(standingOf(row("@shipped/rules/examples/c.md", { level: "shipped", item: "rules/c", applies: false }), false).words).toBe("an example, never in force");
    expect(standingOf(row("@global/imported/GUIDANCE.md"), true).words).toBe("kept, read by no agent");
    expect(standingOf(row("@global/RPE-global.yml", { isConfig: true }), false).words).toBe("a level's config file");
    expect(unreadIn([listed(row("@global/imported/GUIDANCE.md")), listed(row("@global/TURN.md", { item: "TURN" }))]).has("@global/imported/GUIDANCE.md")).toBe(true);
  });

  test("a file of his under imported/ offers to be moved to where its kind is read from, and a new file is made at a level that holds its kind", () => {
    expect(importedTarget("@global/imported/agents/x.md")).toBe("@global/.agents/x.md");
    expect(importedTarget("imported/skills/s1/SKILL.md")).toBe(".skills/s1/SKILL.md");
    expect(importedTarget("imported/GUIDANCE.md")).toBe("AGENTS.md");
    expect(importedTarget("@global/imported/.prompts/p.md")).toBe("@global/.prompts/p.md");
    expect(importedTarget("@global/rules/x.md")).toBeNull();
    const opened = { path: "@global/imported/agents/x.md", file: { path: "@global/imported/agents/x.md", level: "global" as const, kind: "yours" as const, bytes: 3, editable: true, text: "abc" }, piece: false, problem: null, mode: "read" as const, draft: { text: "abc", level: "global" as const }, diff: null };
    const entry = row("@global/imported/agents/x.md");
    const page = view({ open: opened, browse: { ...NO_FILES.browse, loading: false, items: [listed(entry)] } });
    press(page.tree, "Move it to where its kind is read from");
    expect(page.calls).toContain("move:@global/imported/agents/x.md>@global/.agents/x.md");
    // A rule is made at the chat's own level at its top, at yours under its own folder; AGENTS.md has a place only in a chat's levels.
    const rule = KINDS.find((k) => k.id === "rule");
    expect(viewPathAt("chat", rule?.at("engine-silent", "chat") ?? "")).toBe("rules/engine-silent.md");
    expect(viewPathAt("global", rule?.at("engine-silent", "global") ?? "")).toBe("@global/.rules/engine-silent.md");
    expect(KINDS.find((k) => k.id === "agents-md")?.levels(null)).toEqual([]);
    expect(elements(page.tree).some((e) => e.props["data-open"] === "@global/imported/agents/x.md")).toBe(true);
  });

  test("a file says which agents it is pinned for, unpinning takes one away, and a pin is made for the agent chosen at the level chosen", () => {
    const opened = { path: "persistent-workspace/tide-table.md", file: { path: "persistent-workspace/tide-table.md", level: "chat" as const, kind: "notes" as const, bytes: 3, editable: true, text: "abc" }, piece: false, problem: null, mode: "read" as const, draft: { text: "abc", level: "chat" as const }, diff: null };
    const entry = row("persistent-workspace/tide-table.md", { pinnedFor: [{ agent: "gm", level: "chat" }] });
    const page = view({ open: opened, agents: ["gm", "keeper"], pinning: { agent: "keeper", level: "global" }, browse: { ...NO_FILES.browse, loading: false, items: [listed(entry)] } });
    expect(page.text).toContain("Pinned for gm, in the config of this chat's");
    press(page.tree, "Unpin");
    press(page.tree, "Pin");
    expect(page.calls).toEqual(["pin:persistent-workspace/tide-table.md:chat:gm:false", "pin:persistent-workspace/tide-table.md:global:keeper:true"]);
  });

  test("a folder of his is deleted from its row: at once where it is empty; where it holds anything the page asks, in what RPE says it holds, and sends it again with contents", async () => {
    const folder: TreeListed = { name: "walk", path: "skills/walk", folder: true, level: "chat", entry: null };
    // A file is open, so the page does not show the form for a new file, which this test does not render.
    const opened = { path: "WORLD.md", file: { path: "WORLD.md", level: "chat" as const, kind: "yours" as const, bytes: 3, editable: true, text: "abc" }, piece: false, problem: null, mode: "read" as const, draft: { text: "abc", level: "chat" as const }, diff: null };
    const page = view({ open: opened, browse: { ...NO_FILES.browse, loading: false, items: [folder, { ...folder, name: "x", path: "@shipped/.skills/x", level: "shipped" }, { ...folder, name: "@global", path: "@global", level: "global" }] } });
    press(page.tree, "Delete");
    expect(page.calls).toEqual(["remove-folder:skills/walk:false"]);

    const { client, asked } = askingClient();
    let last: FilesShown = NO_FILES;
    const control = filesControl(filesCalls(client, "chat-calder"), () => ({ entries: 5, bytes: 10 }), (s) => (last = s));
    control.removeFolder("skills/walk", false);
    const first = asked.filter((a) => a.key === "DELETE /api/v1/files/*").at(-1);
    expect(first).toMatchObject({ params: { "*": "skills/walk" }, query: { chat: "chat-calder" } });
    first?.fail(new RpeError(409, "skills/walk holds 2 files, which would be deleted with it: nothing was deleted."));
    await settle();
    expect(last.deleting).toEqual({ path: "skills/walk", words: "skills/walk holds 2 files, which would be deleted with it: nothing was deleted." });
    expect(last.refusal).toBeNull();
    const asking = view({ open: opened, deleting: last.deleting });
    expect(asking.text).toContain("holds 2 files");
    press(asking.tree, "Delete it with all it holds");
    expect(asking.calls).toEqual(["remove-folder:skills/walk:true"]);
    control.removeFolder("skills/walk", true);
    const again = asked.filter((a) => a.key === "DELETE /api/v1/files/*").at(-1);
    expect(again).toMatchObject({ query: { chat: "chat-calder", contents: true } });
    again?.answer({ removed: "skills/walk" });
    await settle();
    expect(last.deleting).toBeNull();
    // Any other refusal is kept in its words, and nothing is asked.
    control.removeFolder("sessions", false);
    asked.filter((a) => a.key === "DELETE /api/v1/files/*").at(-1)?.fail(new RpeError(403, "sessions is not yours to change: RPE makes it again."));
    await settle();
    expect(last.deleting).toBeNull();
    expect(last.refusal).toEqual({ at: "make", words: "sessions is not yours to change: RPE makes it again." });
    control.stop();
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadGuidance, type TemplatePart } from "rp-harness";
import type { HostTool, JsonObject, ToolResult } from "rp-harness/contract";
import { createFolderHost } from "rp-harness/hosts/folder";
import { castTools } from "../../src/cast/index";
import { baseHistory, charactersOf } from "../../src/cast/record";
import { castViews } from "../../src/cast/views";
import { shippedTexts } from "../../src/iface/texts";
import { CHAT, openTable, type Table, tokensOf, USER } from "./rig";

let dir = "";
let layout: TemplatePart | undefined;

beforeAll(async () => {
  // The shipped base layout, loaded the way the agents' guidance is: as the shipped level of a folder host.
  dir = mkdtempSync(join(tmpdir(), "rpe-cast-lore-"));
  mkdirSync(join(dir, "files", "defaults", ".prompts"), { recursive: true });
  copyFileSync(resolve(import.meta.dir, "../../guidance/.prompts/cast-base.md"), join(dir, "files", "defaults", ".prompts", "cast-base.md"));
  mkdirSync(join(dir, "files", "chats", "hero", "c1"), { recursive: true });
  mkdirSync(join(dir, "host", "chats", "c1"), { recursive: true });
  writeFileSync(join(dir, "host", "chats", "c1", "chat.json"), JSON.stringify({ character: "hero" }));
  const host = await createFolderHost({ dir, user: "u1" });
  const part = await loadGuidance(host.files, { user: "u1", chat: "c1", session: "s1" }).part("cast-base");
  if (part?.format !== "template") throw new Error("The shipped cast-base part did not load as a template.");
  layout = part;
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function dataOf(r: ToolResult): JsonObject {
  for (const p of r.content) {
    if (p.type !== "text") continue;
    try {
      return JSON.parse(p.text) as JsonObject;
    } catch {
      // A line, not data.
    }
  }
  throw new Error(`no data in ${JSON.stringify(r.content)}`);
}

async function bench(): Promise<{ t: Table; call(name: string, args: JsonObject, turn?: string | null): Promise<ToolResult> }> {
  const t = await openTable();
  const tools = new Map<string, HostTool>((await castTools({ store: t.store, writes: t.writes, files: shippedTexts(), sources: t.shelf.reader, now: () => 7 })).map((x) => [x.name, x]));
  return {
    t,
    async call(name, args, turn = null) {
      const scope = { user: USER, chat: CHAT, session: "s-1", ...(turn !== null ? { turn } : {}) };
      return (tools.get(name) as HostTool).run(args, { scope, agent: { id: "author-1", definition: "author" }, run: "run-1", callId: "c", signal: new AbortController().signal, onUpdate: () => undefined });
    },
  };
}

async function baseText(t: Table): Promise<string> {
  const views = await castViews(["base"], { store: t.store, user: USER, chat: CHAT, turn: null, character: "Mira", present: [], sources: t.shelf.reader, layouts: layout === undefined ? {} : { base: layout }, tokens: tokensOf });
  return views[0]?.text ?? "";
}

describe("lore stays the authority for what it defines", () => {
  test("a bound entry whose revision changes marks the base older than it; nothing is rewritten; redrawing the base clears the mark", async () => {
    const b = await bench();
    b.t.shelf.put("entry", "e-31", "Mira Thornwood", "r1");
    const turn = await b.t.begin();
    await b.call(
      "cast_update",
      {
        operations: [
          { op: "cast", who: "Mira", as: "principal" },
          { op: "bind", who: "Mira", entry: "e-31", defines: "background" },
          { op: "base", who: "Mira", seed: "A herbalist who left the guild.", background: "Raised in the guild's hall." },
        ],
      },
      turn.id,
    );
    await b.t.tie(turn);
    const before = dataOf(await b.call("cast_query", { who: "Mira", part: "base" }));
    expect(before.base).toEqual({ seed: { text: "A herbalist who left the guild.", version: 1 }, background: { text: "Raised in the guild's hall.", version: 1 } });
    expect(await baseText(b.t)).not.toContain("older");

    // The player edits the entry in Lumiverse: its revision changes.
    b.t.shelf.put("entry", "e-31", "Mira Thornwood", "r2");
    const marked = dataOf(await b.call("cast_query", { who: "Mira", part: "base" }));
    expect(marked.base).toEqual({
      seed: { text: "A herbalist who left the guild.", version: 1 },
      background: { text: "Raised in the guild's hall.", version: 1 },
      older_than: [{ kind: "entry", id: "e-31", defines: "background", title: "Mira Thornwood", newer_than_base: true }],
    });
    const mira = charactersOf(b.t.db, USER, [CHAT])[0]?.id ?? "";
    expect(baseHistory(b.t.db, USER, mira).map((v) => [v.part, v.version, v.text])).toEqual([
      ["seed", 1, "A herbalist who left the guild."],
      ["background", 1, "Raised in the guild's hall."],
    ]);
    const text = await baseText(b.t);
    expect(text).toContain("- entry e-31: Mira Thornwood, for background (changed since the base was drawn from it)");
    expect(text).toContain("This base is older than a source marked here.");

    // The Author redraws the part the entry defines: the base now stands on the entry as it is.
    const redraw = await b.call("cast_update", { operations: [{ op: "base", who: "Mira", background: "Raised in the guild's hall, and thrown out of it at sixteen." }] });
    expect(dataOf(redraw).operations).toEqual([expect.objectContaining({ now: { seed: { text: "A herbalist who left the guild.", version: 1 }, background: { text: "Raised in the guild's hall, and thrown out of it at sixteen.", version: 2 } } })]);
    expect(dataOf(await b.call("cast_query", { who: "Mira", part: "sources" })).sources).toEqual([{ kind: "entry", id: "e-31", defines: "background", title: "Mira Thornwood" }]);
    expect(await baseText(b.t)).not.toContain("older");
  });

  test("a source gone from Lumiverse, or bound after the base was drawn, marks the base too; with no base there is nothing to be older than", async () => {
    const b = await bench();
    b.t.shelf.put("entry", "e-31", "Mira Thornwood", "r1");
    b.t.shelf.put("entry", "e-40", "The Herbalists' Guild", "g1");
    const turn = await b.t.begin();
    await b.call("cast_update", { operations: [{ op: "cast", who: "Mira", as: "principal" }, { op: "bind", who: "Mira", entry: "e-31" }] }, turn.id);
    const sources = async () => dataOf(await b.call("cast_query", { who: "Mira", part: "sources" }, turn.id)).sources;
    expect(await sources()).toEqual([{ kind: "entry", id: "e-31", title: "Mira Thornwood" }]);

    await b.call("cast_update", { operations: [{ op: "base", who: "Mira", seed: "A herbalist." }, { op: "bind", who: "Mira", entry: "e-40", defines: "background" }] }, turn.id);
    expect(await sources()).toEqual([
      { kind: "entry", id: "e-31", title: "Mira Thornwood" },
      { kind: "entry", id: "e-40", defines: "background", title: "The Herbalists' Guild", newer_than_base: true },
    ]);
    b.t.shelf.remove("entry", "e-31");
    expect(await sources()).toEqual([
      { kind: "entry", id: "e-31", gone: true, newer_than_base: true },
      { kind: "entry", id: "e-40", defines: "background", title: "The Herbalists' Guild", newer_than_base: true },
    ]);
    const marks = await baseText(b.t);
    expect(marks).toContain("- entry e-31 (no longer in Lumiverse)\n- entry e-40: The Herbalists' Guild, for background (bound after the base was drawn)");
    expect(marks).toContain("This base is older than a source marked here.");
  });
});

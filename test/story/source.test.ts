// A story write names where it comes from: a write that names no source is applied and marked unsourced, one citing a message keeps
// that source on its change, an invention with no gap check is marked so. Every name is invented.

import { expect, test } from "bun:test";
import type { JsonObject, ToolResult } from "rp-harness/contract";
import { shippedTexts } from "../../src/iface/texts";
import { storyTools } from "../../src/story/index";
import { CHAT, openTable, USER } from "./rig";

test("a thread recorded with no source is applied and marked unsourced; a beat citing a message keeps it; an invention with no gap check is marked so", async () => {
  const t = await openTable();
  const tools = new Map((await storyTools({ store: t.store, writes: t.writes, files: shippedTexts(), overlay: () => ({ unknown: "no lore here" }), now: () => 7 })).map((x) => [x.name, x]));
  await t.play();
  const turn = await t.begin();
  const call = (operations: JsonObject[]): Promise<ToolResult> =>
    tools.get("story_record")!.run({ operations }, { scope: { user: USER, chat: CHAT, session: "s-1", turn: turn.id }, agent: { id: "author-1", definition: "author" }, run: "run-1", callId: `call-${Math.random()}`, signal: new AbortController().signal, onUpdate: () => undefined });
  const said = (r: ToolResult): string => JSON.stringify(r.content);

  const bare = await call([{ op: "thread", text: "Who pays Hale's wages?", kind: "question" }]);
  expect(bare.error).toBeUndefined();
  expect(bare.marks).toContain("unsourced");
  expect(said(bare)).toContain("names no source");

  const cited = await call([{ op: "beat", text: "Hale names his price.", source: { from: "prose", message: "m-2" } }]);
  expect(cited.error).toBeUndefined();
  expect(cited.marks).toBeUndefined();

  const invented = await call([{ op: "future", text: "The bridge is washed out.", source: "invented" }]);
  expect(invented.marks).toEqual(expect.arrayContaining(["invented", "no-gap-check"]));

  const rows = t.s.changes(turn.id);
  expect(rows.map((r) => [r.source, r.cite])).toEqual([[null, null], ["prose", { message: "m-2" }], ["invented", { consent_by: "none" }]]);
});

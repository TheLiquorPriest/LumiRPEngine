// An id the story record does not hold is answered with the ids it does hold, and with nothing near when it holds none of that part.

import { describe, expect, test } from "bun:test";
import type { HostTool, JsonObject, ToolResult } from "rp-harness/contract";
import { shippedTexts } from "../../src/iface/texts";
import { storyTools } from "../../src/story/index";
import { CHAT, openTable, USER } from "./rig";

const texts = (r: ToolResult): string[] => r.content.flatMap((p) => (p.type === "text" ? [p.text] : []));

describe("near ids", () => {
  test("story_query for an id the record does not hold names the ids of its part, and says when the record holds none", async () => {
    const t = await openTable();
    const tools = new Map<string, HostTool>((await storyTools({ store: t.store, writes: t.writes, files: shippedTexts(), overlay: () => ({ unknown: "no lore here" }), now: () => 7 })).map((x) => [x.name, x]));
    const call = (name: string, args: JsonObject, turn: string): Promise<ToolResult> =>
      (tools.get(name) as HostTool).run(args, { scope: { user: USER, chat: CHAT, session: "s-1", turn }, agent: { id: "author-1", definition: "author" }, run: "run-1", callId: "c", signal: new AbortController().signal, onUpdate: () => undefined });
    const first = await t.begin();
    const opened = JSON.parse(texts(await call("story_record", { operations: [{ op: "scene", new: true, title: "The ferry" }, { op: "scene", new: true, title: "The far bank" }] }, first.id)).find((x) => x.startsWith("{")) as string) as { operations: JsonObject[] };
    const [one, two] = opened.operations.map((o) => String(o.id));
    const missed = texts(await call("story_query", { id: "sc-12" }, first.id))[0] as string;
    expect(missed).toContain(`${one}`);
    expect(missed).toContain(`${two}`);
    expect(texts(await call("story_query", { id: "th-999", part: "thread" }, first.id))[0]).toContain("holds no thread yet");
  });
});

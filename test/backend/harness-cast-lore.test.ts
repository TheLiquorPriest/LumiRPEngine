// The two lore tools that keep a file (`lore_save`, `lore_draft` in `tools/lore.ts`), which the old
// engines have and the harness lists again. On the harness the file is the harness's workspace's,
// where each mind's files and the agents' own are too: a saved entry stays under lore/, a new
// entry's id is held to the engine's own form, and the file is a workspace note under the player's
// mode for those. A draft's front matter holds what it is given as data on every engine.
//
// What a path, an id and a front matter come to is read on the kit's stand-in turn, whose writer is
// the engine's own. What a mode does is played through the bridge's real turn, the workspace given
// as whoever mounts LumiAH gives it. An agent of the old engines calls through `toolsFor`.

import { describe, expect, test } from "bun:test";
import type { ToolOutcome } from "../../src/backend/agents/runtime";
import { toolsFor } from "../../src/backend/agents/tools/registry";
import type { AgentOp } from "../../src/backend/agents/tools/writer";
import { renderPrompt } from "../../src/backend/prompts";
import { toolText, toolTextId } from "../../src/shared/agent-tools";
import { WRITE_NOTE } from "../../src/shared/agent-tools-write";
import { HARNESS_NOTE } from "../../src/shared/harness-texts";
import { HARNESS_DESCRIBED, SURFACE_NOTE } from "../../src/shared/harness-texts-surfaces";
import type { JsonObject } from "../../src/shared/json";
import { workspaceOf } from "../../src/engine/workspace";
import type { Rig } from "../support/rig";
import { agentTools, attachBook, bookEntry, toolEnv } from "../support/tools";
import { answer, authorEnv, landingWriter, memoryFiles, refusal } from "./harness-cast-kit";
import { AUTHOR, beginTurn, harnessChat, noModelCalls, stateOf, toolsOf } from "./harness-driver";

/** A registry text as shipped, filled: what a tool answers when the user changed nothing. */
const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);

const FERRY = "The ferry runs on the hour until nine.";

/** One call of a lore tool as an agent of the old engines makes it: no harness turn, no workspace port, and a writer that keeps the files it was asked to stage. */
async function oldCall(rig: Rig, chatId: string, name: string, args: JsonObject): Promise<{ out: ToolOutcome; staged: AgentOp[] }> {
  const staged: AgentOp[] = [];
  const env = toolEnv(rig, chatId, "gm", landingWriter(rig, chatId, staged));
  const tool = toolsFor({ world: (await env.reader.view()).world, tiers: ["gm"], families: ["lore"], texts: {}, env }).find((t) => t.name === name);
  if (!tool) throw new Error(`the old engines have no tool ${name}`);
  return { out: await tool.run(args, { signal: new AbortController().signal, agentId: "agent_test", role: "assistant", callId: `call_${name}` }), staged };
}

/** A draft's text read back: the lines of its front matter, between its two fences, and the body after them. */
function draftOf(text: string): { fields: string[]; body: string } {
  const lines = text.split("\n");
  const end = lines.indexOf("---", 1);
  return { fields: lines.slice(1, end), body: lines.slice(end + 1).join("\n") };
}

describe("a lore entry saved as a file", () => {
  test("on the harness it goes under lore/ and nowhere else, with the workspace or without it; the old engines save where they always could", async () => {
    const { rig, chatId, env, staged } = await authorEnv();
    const { bookId, ids } = await attachBook(rig, chatId, "Harbor notes", [bookEntry("The ferry", FERRY)]);
    const id = `${bookId}/${ids[0] ?? ""}`;
    const files = memoryFiles();
    // A mind's core file is the user's to write, and stands in the same workspace.
    const core = "Mara keeps her word, and counts what she is owed.";
    await files.write("minds/mara/core.md", core, null);
    const filed = { ...env, files };
    for (const path of ["minds/mara/core.md", "notes/ferry.md", "lore-drafts/ferry.md", "Lore/ferry.md"]) {
      for (const on of [filed, env]) expect(await refusal(on, "lore_save", { id, path })).toBe(note(SURFACE_NOTE.lorePath, { path }));
    }
    // A path that starts in the folder and leaves it is no workspace path at all: the writer's own rule, which the port's write waits on.
    expect(await refusal(filed, "lore_save", { id, path: "lore/../minds/mara/core.md" })).toContain("isn't a workspace path");
    expect([files.files.get("minds/mara/core.md")?.text, files.files.size, staged]).toEqual([core, 1, []]);
    // Under the folder: the file the call names, or one named after the entry.
    await answer(filed, "lore_save", { id, path: "lore/harbor/ferry.md" });
    await answer(filed, "lore_save", { id });
    expect([files.files.get("lore/harbor/ferry.md")?.text, [...files.files.keys()].filter((path) => path.startsWith("lore/")).length]).toEqual([FERRY, 2]);

    // An agent of the old engines saves an entry wherever a workspace file may go, as before.
    const old = await oldCall(rig, chatId, "lore_save", { id, path: "notes/ferry.md" });
    expect([old.out.error, old.staged]).toEqual([undefined, [{ kind: "ws_write", path: "notes/ferry.md", text: FERRY }]]);
    noModelCalls(rig);
  });
});

describe("a lore draft", () => {
  /** An id that, written raw into a front matter, would add two fields of its own. */
  const BREAKING = "new-entry\ntitle: Injected\nsecret: false";

  test("its front matter holds its two fields whatever an id or a title holds: a line break, a colon, a fence or a quote stays that field's value", async () => {
    const { rig, chatId, env } = await authorEnv();
    const titles = ["The quay", "The ferry: winter hours", 'The "old" pier', "---", "Tides\n---\nsecret: false"];
    const { bookId, ids } = await attachBook(rig, chatId, "Harbor notes", titles.map((title, i) => bookEntry(title, `Entry ${i + 1} of the harbor notes.`)));
    const files = memoryFiles();
    const filed = { ...env, files };
    const text = "The first line of the draft.\n---\ntitle: a line of the body, not of the front matter";
    const written: string[][] = [];
    for (const entry of ids) {
      // The entry as the tools name and title it: what the draft says it is a draft of.
      const read = (await answer(filed, "lore_read", { id: `${bookId}/${entry}` })) as { id: string; title: string };
      await answer(filed, "lore_draft", { id: read.id, text });
      const draft = draftOf(files.files.get(`lore-drafts/${read.id}.md`)?.text ?? "");
      expect(draft.body).toBe(text);
      expect(draft.fields.length).toBe(2);
      written.push([read.title, draft.fields[1] ?? ""]);
    }
    // A title that is one plain line is written as it is, its quotes too; one that could start a field, a comment or a fence is written as one quoted string, on its field's own line. (A book's entry has a one-line title: its line breaks read as spaces before any tool sees them.)
    expect(written.map(([title]) => title)).toEqual(["The quay", "The ferry: winter hours", 'The "old" pier', "---", "Tides --- secret: false"]);
    expect(written.map(([, line]) => line)).toEqual(["title: The quay", 'title: "The ferry: winter hours"', 'title: The "old" pier', 'title: "---"', 'title: "Tides --- secret: false"']);

    // The one function writes it for the old engines too, where a new entry goes by whatever id the call gives.
    for (const id of [BREAKING, "---", "pier: notes"]) {
      const old = await oldCall(rig, chatId, "lore_draft", { id, text });
      const file = old.staged[0];
      if (file?.kind !== "ws_write") throw new Error("the old engines' lore_draft staged no file");
      expect(draftOf(file.text)).toEqual({ fields: [`lore: ${JSON.stringify(id)}`, `title: ${JSON.stringify(id)}`], body: text });
    }
    // And a plain id reads as it always did.
    expect((await oldCall(rig, chatId, "lore_draft", { id: "the_ferry_times", text: FERRY })).staged).toEqual([{ kind: "ws_write", path: "lore-drafts/the_ferry_times.md", text: `---\nlore: the_ferry_times\ntitle: the_ferry_times\n---\n${FERRY}` }]);
    noModelCalls(rig);
  });

  test("of a new entry takes an id in the engine's own form on the harness, and is refused any other with what an id is; the old engines take the id they are given", async () => {
    const { rig, chatId, env, staged } = await authorEnv();
    const files = memoryFiles();
    for (const id of ["The Mill", "the-mill", "../mill", "mill.md", BREAKING]) {
      for (const on of [{ ...env, files }, env]) expect(await refusal(on, "lore_draft", { id, text: FERRY })).toBe(note(SURFACE_NOTE.loreId, { id }));
    }
    expect([files.files.size, staged]).toEqual([0, []]);
    await answer({ ...env, files }, "lore_draft", { id: "the_mill", text: FERRY });
    expect([...files.files.keys()]).toEqual(["lore-drafts/the_mill.md"]);
    const old = await oldCall(rig, chatId, "lore_draft", { id: "The Mill", text: FERRY });
    expect(old.staged).toEqual([{ kind: "ws_write", path: "lore-drafts/The_Mill.md", text: `---\nlore: The Mill\ntitle: The Mill\n---\n${FERRY}` }]);
    noModelCalls(rig);
  });
});

describe("a lore file and the player's mode for workspace notes", () => {
  const PIER: JsonObject = { id: "old_pier", title: "The old pier", content: "The old pier burned in the year of the long fog.", keys: ["pier"], links: [] };
  const DRAFT = { id: "pier_fire", text: "The pier burned in the year of the long fog, and no one rebuilt it." };
  const PATHS = ["lore-drafts/pier_fire.md", "lore/old_pier.md"];

  /** A harness chat that holds one lore entry, its workspace given as LumiAH's mount gives one, under `mode` when one is set. */
  async function filing(mode?: "confirm" | "never"): Promise<{ rig: Rig; chatId: string; kept: () => string[] }> {
    const { rig, chatId } = await harnessChat({ put: { lore: { old_pier: PIER } } });
    const files = memoryFiles();
    rig.rt.harness.files = () => files;
    if (mode) rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { workspace: { mode } } } }));
    return { rig, chatId, kept: () => [...files.files.keys()].sort() };
  }

  test("as shipped both are written to the workspace at once, and each is described on the harness in the harness's own words", async () => {
    const { rig, chatId, kept } = await filing();
    // What an agent is told the tools do here says where the file goes; the old engines send their own text, as before.
    const listed = await toolsOf(rig, chatId);
    const old = await agentTools(rig, chatId, "gm", { tiers: ["gm"] });
    for (const name of ["lore_save", "lore_draft"]) {
      const described = listed.find((t) => t.name === name)?.description ?? "";
      expect(described).toBe(note(HARNESS_DESCRIBED[name] ?? ""));
      expect(described).toContain("written to the workspace at once");
      expect(old.find((t) => t.name === name)?.description).toBe(toolText(name)?.text ?? "");
      expect(note(toolTextId(name))).not.toBe(described);
    }
    const turn = await beginTurn(rig, chatId, "I ask what became of the old pier.");
    expect((await turn.answer(AUTHOR, "lore_draft", DRAFT)).staged).toMatchObject({ changeType: "workspace", mode: "auto", lands: note(HARNESS_NOTE.filed, { path: PATHS[0] ?? "" }) });
    expect((await turn.answer(AUTHOR, "lore_save", { id: "old_pier" })).staged).toMatchObject({ changeType: "workspace", mode: "auto", lands: note(HARNESS_NOTE.filed, { path: PATHS[1] ?? "" }) });
    expect(kept()).toEqual([...PATHS].sort());
    noModelCalls(rig);
  });

  test("set to Confirm both wait on the reply's review card and the workspace holds neither; Apply keeps them", async () => {
    const { rig, chatId, kept } = await filing("confirm");
    const turn = await beginTurn(rig, chatId, "I ask what became of the old pier.");
    for (const [name, args] of [["lore_draft", DRAFT], ["lore_save", { id: "old_pier" }]] as const) expect((await turn.answer(AUTHOR, name, args)).staged).toMatchObject({ changeType: "workspace", mode: "confirm", lands: note(WRITE_NOTE.stagedReview) });
    const committed = (await turn.answer(AUTHOR, "commit")).committed as { landed: string[][]; review: string[][]; refused: unknown[] };
    expect([committed.landed, committed.review.length, committed.refused]).toEqual([[], 2, []]);
    await turn.finish("The pier burned in the year of the long fog, Mara says.");
    expect([kept(), Object.keys(workspaceOf(await stateOf(rig, chatId)))]).toEqual([[], []]);

    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    const cards = rig.body(await rig.send({ type: "lre.review", chatId, op: "apply", turn: `${reply.id}:0` })).cards as { items: { changeType: string; status: string }[] }[];
    expect(cards[0]?.items.map((item) => [item.changeType, item.status])).toEqual([["workspace", "applied"], ["workspace", "applied"]]);
    // Applied through the writer, as a file that waited always is: kept with the chat's own files.
    expect(Object.keys(workspaceOf(await stateOf(rig, chatId))).sort()).toEqual([...PATHS].sort());
    noModelCalls(rig);
  });

  test("set to Never both are refused, and nothing is written or staged", async () => {
    const { rig, chatId, kept } = await filing("never");
    const turn = await beginTurn(rig, chatId, "I ask what became of the old pier.");
    for (const [name, args] of [["lore_draft", DRAFT], ["lore_save", { id: "old_pier" }]] as const) expect(JSON.parse(await turn.refusal(AUTHOR, name, args))).toMatchObject({ refused: { code: "mode_never" } });
    expect((await turn.answer(AUTHOR, "commit")).committed).toMatchObject({ landed: [], review: [], refused: [] });
    await turn.finish("The pier burned in the year of the long fog, Mara says.");
    expect([kept(), Object.keys(workspaceOf(await stateOf(rig, chatId)))]).toEqual([[], []]);
    noModelCalls(rig);
  });
});

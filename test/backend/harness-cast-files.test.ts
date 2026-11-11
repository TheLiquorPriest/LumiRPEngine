// A mind's own files and its notes folded into its summary on the harness engine
// (`harness-tools/files.ts`), and what `mind_view` shows of both. The workspace is the kit's
// in-memory one (`memoryFiles`), as the harness's port gives one; the notes are recorded through the
// engine's own memory event, and what `mind_consolidate` stages is applied by the engine's reducer.
//
// What the player's mode for characters' minds does to a fold and to a file is played through the
// bridge's real turn (`harness-driver.ts`), the workspace given as whoever mounts LumiAH gives it:
// a mode is the turn's to keep, and a stand-in turn keeps none.

import { describe, expect, test } from "bun:test";
import type { HarnessFile, HarnessFiles } from "../../src/backend/agents/tools/harness-ports";
import type { ToolEnv } from "../../src/backend/agents/tools/registry";
import { memoryData } from "../../src/backend/minds";
import { renderPrompt } from "../../src/backend/prompts";
import { WRITE_NOTE } from "../../src/shared/agent-tools-write";
import { HARNESS_AGENT, HARNESS_NOTE } from "../../src/shared/harness-texts";
import { FILES_NOTE } from "../../src/shared/harness-texts-files";
import type { JsonObject } from "../../src/shared/json";
import { MIND_LENGTH_DEFAULTS, MINDS_EVENTS, type MindNote } from "../../src/shared/minds";
import { AGENT_CHANGE_LABEL } from "../../src/shared/settings";
import { readCharacter } from "../../src/packs/minds/core/state";
import { stateOf } from "../support/mind-chat";
import type { Rig } from "../support/rig";
import { POV, recordFix } from "../support/tools";
import { answer, applied, call, castChat, castEnv, castTurn, type CastTurn, JOSS, MARA, memoryFiles, noModelCalls, refusal, turnChat, type TurnSetup } from "./harness-cast-kit";
import { type Agent, AUTHOR, beginJob, beginTurn } from "./harness-driver";

/** A registry text as shipped, filled: what a tool answers when the user changed nothing. */
const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);

const FILE_TOOLS = ["mind_files", "mind_file_read", "mind_file_write"] as const;
const NOW = "Tired. The rent is late again, and Joss knows it.";

/** A character's agent in a turn of its own, with the workspace `files` when given one. */
async function mindEnv(rig: Rig, chatId: string, files?: HarnessFiles, setup: TurnSetup = {}): Promise<{ mind: ToolEnv; turn: CastTurn }> {
  const turn = await castTurn(rig, chatId, { main: false, ...setup });
  return { turn, mind: { ...castEnv(rig, chatId, turn, HARNESS_AGENT.character), ...(files ? { files } : {}) } };
}

/** `who` remembers `notes`, recorded as the memory step records them: checked by the engine's validator, written as its event. */
async function remember(rig: Rig, chatId: string, who: string, notes: { text: string; salience: number }[], summary: string): Promise<MindNote[]> {
  const { state, world } = await stateOf(rig, chatId);
  const data = memoryData(rig.rt.registry, world, state, who, { notes, summary }, [], MIND_LENGTH_DEFAULTS);
  if (!data) throw new Error("the engine took no memory of it");
  await recordFix(rig, chatId, `notes-${who}`, [{ type: MINDS_EVENTS.memory, data: data as unknown as JsonObject }]);
  return data.notes;
}

describe("a mind's own files", () => {
  test("a mind lists, reads and writes its own files whole, a stale version is refused with the current one, and mind_view names what it keeps", async () => {
    const { rig, chatId } = await castChat();
    const files = memoryFiles();
    const { mind, turn } = await mindEnv(rig, chatId, files);

    // Nothing kept yet: the list is empty and says how a file is made.
    expect(await answer(mind, "mind_files", { who: "Mara" })).toEqual({ files: [], note: note(FILES_NOTE.noFiles) });
    expect(await refusal(mind, "mind_file_read", { who: "Mara", file: "now.md" })).toBe(note(FILES_NOTE.noFileYet, { file: "now.md" }));
    expect((await call(mind, "mind_view", { who: "Mara" })).text).not.toContain(note(FILES_NOTE.viewFiles));

    // A new file, in Mara's own folder of the workspace.
    const made = await answer(mind, "mind_file_write", { who: "Mara", file: "now.md", text: NOW });
    expect(made).toEqual({ written: { file: "now.md", size: NOW.length, version: "v1" }, note: note(FILES_NOTE.written) });
    expect([...files.files.keys()]).toEqual([`minds/${MARA}/now.md`]);
    expect(await answer(mind, "mind_files", { who: "Mara" })).toEqual({ files: [{ file: "now.md", size: NOW.length }], note: note(FILES_NOTE.filesNext) });
    expect(await answer(mind, "mind_file_read", { who: "Mara", file: "now.md" })).toEqual({ file: "now.md", text: NOW, size: NOW.length, version: "v1" });

    // Written on the version it read; the same version again is stale, and the refusal gives the current one.
    const next = `${NOW} Ask him today.`;
    expect((await answer(mind, "mind_file_write", { who: "Mara", file: "now.md", text: next, version: "v1" })).written).toEqual({ file: "now.md", size: next.length, version: "v2" });
    expect(await refusal(mind, "mind_file_write", { who: "Mara", file: "now.md", text: "Never mind.", version: "v1" })).toBe(note(FILES_NOTE.stale, { file: "now.md", given: "v1", version: "v2" }));
    expect(files.files.get(`minds/${MARA}/now.md`)?.text).toBe(next);
    // A version named for a file not kept; no version replaces the file as it stands.
    expect(await refusal(mind, "mind_file_write", { who: "Mara", file: "plans.md", text: "Fix the gutter.", version: "v2" })).toBe(note(FILES_NOTE.staleNew, { file: "plans.md", given: "v2" }));
    expect((await answer(mind, "mind_file_write", { who: "Mara", file: "now.md", text: "" })).written).toEqual({ file: "now.md", size: 0, version: "v3" });
    await answer(mind, "mind_file_write", { who: "Mara", file: "now.md", text: next });
    expect(await refusal(mind, "mind_file_read", { who: "Mara", file: "people.md" })).toBe(note(FILES_NOTE.noFile, { file: "people.md", files: "now.md" }));
    expect(await refusal(mind, "mind_file_write", { who: "Mara", file: "now.md" })).toContain("mind_file_write needs text");
    expect(await refusal(mind, "mind_file_read", { who: "Mara" })).toContain("mind_file_read needs file");

    // What the workspace itself refuses is said in its words.
    const full: HarnessFiles = { ...files, write: async () => ({ refused: { code: "too_large", reason: "the file is larger than the workspace takes", version: "v4" } }) };
    expect(await refusal({ ...mind, files: full }, "mind_file_write", { who: "Mara", file: "now.md", text: next })).toBe(note(FILES_NOTE.writeRefused, { file: "now.md", reason: "the file is larger than the workspace takes" }));

    // Its view names the file and its size, never its text; a file is the workspace's, not a change of the turn.
    const seen = (await call(mind, "mind_view", { who: "Mara" })).text;
    expect(seen.startsWith("You are Mara.")).toBe(true);
    expect(seen).toContain(`${note(FILES_NOTE.viewFiles)}\n${note(FILES_NOTE.viewFile, { file: "now.md", size: String(next.length) })}`);
    expect(seen).not.toContain(NOW);
    expect([turn.character, turn.changes]).toEqual([MARA, []]);
    noModelCalls(rig);
  });

  test("a name stays in the mind's own folder, core.md is the user's, and no one else's files are reached", async () => {
    const { rig, chatId } = await castChat();
    const files = memoryFiles();
    const core = "Mara keeps her word, and counts what she is owed.";
    const hiding = "Two months behind. Stay out of her way.";
    await files.write(`minds/${MARA}/core.md`, core, null);
    await files.write(`minds/${JOSS}/now.md`, hiding, null);
    const { mind, turn } = await mindEnv(rig, chatId, files);

    // No name names a folder, another ending or anything that leaves the mind's own.
    for (const file of ["../joss/now.md", `../${JOSS}/now.md`, "notes/now.md", "/now.md", "now.txt", "now", ".md", "my notes.md", "now.md.md", ".."]) {
      for (const tool of ["mind_file_read", "mind_file_write"]) expect(await refusal(mind, tool, { who: "Mara", file, text: "Mine now." })).toBe(note(FILES_NOTE.badName, { file, tool }));
    }

    // The user's core is read, and never written, whatever case its name is given in.
    expect(await answer(mind, "mind_file_read", { who: "Mara", file: "core.md" })).toMatchObject({ text: core, version: "v1" });
    for (const file of ["core.md", "Core.md", "CORE.md"]) expect(await refusal(mind, "mind_file_write", { who: "Mara", file, text: "Mara forgives every debt.", version: "v1" })).toBe(note(FILES_NOTE.coreIsUsers, { name: "Mara" }));

    // Mara's list holds her own file only, and Joss's is no one's to name but his own mind's.
    expect((await answer(mind, "mind_files", { who: "Mara" })).files).toEqual([{ file: "core.md", size: core.length }]);
    expect(await refusal(mind, "mind_file_read", { who: "Mara", file: "now.md" })).toBe(note(FILES_NOTE.noFile, { file: "now.md", files: "core.md" }));
    for (const tool of FILE_TOOLS) expect(await refusal(mind, tool, { who: "Joss", file: "now.md", text: "Pay up." })).toBe(note(HARNESS_NOTE.otherMind, { self: "Mara", other: "Joss", tool }));
    expect([...files.files.values()].map((f) => [f.path, f.version])).toEqual([[`minds/${MARA}/core.md`, "v1"], [`minds/${JOSS}/now.md`, "v2"]]);

    // Joss's own mind reaches his, and only his.
    const joss = await mindEnv(rig, chatId, files);
    expect((await answer(joss.mind, "mind_files", { who: "Joss" })).files).toEqual([{ file: "now.md", size: hiding.length }]);

    // No workspace on this chat: said plainly, and the mind's view goes on without files.
    const bare = await mindEnv(rig, chatId);
    for (const tool of FILE_TOOLS) expect(await refusal(bare.mind, tool, { who: "Mara", file: "now.md", text: NOW })).toBe(note(FILES_NOTE.noWorkspace));
    expect((await call(bare.mind, "mind_view", { who: "Mara" })).text).not.toContain(note(FILES_NOTE.viewFiles));

    // The files are a person's own mind's: not the author's, not another agent's, and the player's character has no mind.
    for (const role of [HARNESS_AGENT.author, HARNESS_AGENT.gm, HARNESS_AGENT.knowledge]) {
      const other = await castTurn(rig, chatId, { main: role === HARNESS_AGENT.author });
      for (const tool of FILE_TOOLS) expect(await refusal({ ...castEnv(rig, chatId, other, role), files }, tool, { who: "Mara", file: "now.md", text: NOW })).toBe(note(HARNESS_NOTE.notCharacter, { tool }));
    }
    const pov = (await stateOf(rig, chatId)).state.entities[POV]?.name ?? "";
    const player = await mindEnv(rig, chatId, files);
    for (const tool of FILE_TOOLS) expect(await refusal(player.mind, tool, { who: POV, file: "now.md", text: NOW })).toBe(note(HARNESS_NOTE.playerMind, { name: pov }));
    expect([turn.changes, player.turn.character, files.files.size]).toEqual([[], null, 2]);
    noModelCalls(rig);
  });

  test("a file and its name are no longer than the player allows: past either the call is refused with the limit, and nothing is written", async () => {
    const { rig, chatId } = await castChat();
    const files = memoryFiles();
    const count = (n: number): string => n.toLocaleString("en-US");
    const shipped = (await rig.rt.settings.get(rig.host.userId)).agents.harnessLimits;
    const { mind } = await mindEnv(rig, chatId, files);

    // As shipped: a file of exactly the longest length is written, and one character more is refused with both lengths.
    const full = "z".repeat(shipped.mindFileChars);
    expect((await answer(mind, "mind_file_write", { who: "Mara", file: "now.md", text: full })).written).toMatchObject({ size: shipped.mindFileChars });
    expect(await refusal(mind, "mind_file_write", { who: "Mara", file: "now.md", text: `${full}z` })).toBe(note(FILES_NOTE.fileLong, { file: "now.md", size: count(shipped.mindFileChars + 1), max: count(shipped.mindFileChars) }));
    expect(files.files.get(`minds/${MARA}/now.md`)?.text.length).toBe(shipped.mindFileChars);
    // A name is held to its own length, whichever tool names the file, and is answered with its length instead of being said back.
    const longest = `${"n".repeat(shipped.mindFileNameChars - 3)}.md`;
    const longer = `n${longest}`;
    expect((await answer(mind, "mind_file_write", { who: "Mara", file: longest, text: NOW })).written).toMatchObject({ file: longest });
    for (const tool of ["mind_file_read", "mind_file_write"]) expect(await refusal(mind, tool, { who: "Mara", file: longer, text: NOW })).toBe(note(FILES_NOTE.nameLong, { size: count(longer.length), max: count(shipped.mindFileNameChars), tool }));
    expect([...files.files.keys()].sort()).toEqual([`minds/${MARA}/${longest}`, `minds/${MARA}/now.md`]);

    // The limits are the player's settings: set lower, the turn that begins after holds to the new ones.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { harnessLimits: { mindFileChars: 40, mindFileNameChars: 12 } } } }));
    const tight = await mindEnv(rig, chatId, files);
    expect(await refusal(tight.mind, "mind_file_write", { who: "Mara", file: "plans.md", text: "p".repeat(41) })).toBe(note(FILES_NOTE.fileLong, { file: "plans.md", size: "41", max: "40" }));
    expect(await refusal(tight.mind, "mind_file_write", { who: "Mara", file: "tomorrow-list.md", text: NOW })).toBe(note(FILES_NOTE.nameLong, { size: "16", max: "12", tool: "mind_file_write" }));
    expect((await answer(tight.mind, "mind_file_write", { who: "Mara", file: "plans.md", text: "p".repeat(40) })).written).toMatchObject({ file: "plans.md", size: 40 });
    // A file already there under a longer name is none the mind's tools take: it isn't listed.
    expect(((await answer(tight.mind, "mind_files", { who: "Mara" })).files as { file: string }[]).map((f) => f.file)).toEqual(["now.md", "plans.md"]);
    noModelCalls(rig);
  });
});

describe("a mind's notes folded into its summary", () => {
  test("mind_view shows the notes due as a consolidation reads them, and mind_consolidate stages the engine's own event for exactly those", async () => {
    const { rig, chatId } = await castChat();
    // One note kept: of three, the two that matter least are due.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { memory: { notes: { keep: 1 } } } } }));
    const notes = await remember(
      rig,
      chatId,
      MARA,
      [
        { text: "Joss owes two months of rent.", salience: 5 },
        { text: "The kettle's lid is cracked.", salience: 1 },
        { text: "Ilse borrowed the ladder.", salience: 2 },
      ],
      "Mara lets the rooms upstairs.",
    );
    const [rent, kettle, ladder] = notes.map((n) => n.id);
    const { mind, turn } = await mindEnv(rig, chatId);

    const seen = (await call(mind, "mind_view", { who: "Mara" })).text;
    const fold = seen.slice(seen.indexOf(note(FILES_NOTE.viewFold, { chars: "1,800" })));
    expect(fold.startsWith("## Upkeep")).toBe(true);
    expect(fold).toContain("mind_consolidate");
    expect(fold).toContain("## Your summary\nMara lets the rooms upstairs.");
    expect(fold.slice(fold.indexOf("## Older notes to fold in")).split("\n").slice(1).map((l) => l.slice(l.lastIndexOf(": ") + 2))).toEqual(["The kettle's lid is cracked.", "Ilse borrowed the ladder."]);
    expect(turn.changes).toEqual([]);

    const summary = "Mara lets the rooms upstairs. Ilse has her ladder; the kettle wants a new lid.";
    const done = await answer(mind, "mind_consolidate", { who: "Mara", summary });
    expect(done).toEqual({ consolidated: { who: { id: MARA, name: "Mara" }, notes: 2, lands: note(WRITE_NOTE.staged) } });
    expect(turn.changes.map((c) => [c.changeType, c.proposal, c.lines])).toEqual([["mind", undefined, ["Mara's older notes folded into their summary"]]]);
    const events = turn.changes[0]?.events ?? [];
    expect<unknown>(events).toEqual([{ type: MINDS_EVENTS.consolidated, data: { entity: MARA, at: (await stateOf(rig, chatId)).state.clock, notes: [kettle, ladder], summary } }]);

    // The engine's reducer takes it: the folded notes are gone, the one kept stays, and the summary is the mind's.
    const after = await applied(rig, chatId, events);
    expect(readCharacter(after.before, MARA).notes.map((n) => n.id)).toEqual([rent, kettle, ladder]);
    expect(readCharacter(after.state, MARA)).toMatchObject({ notes: [{ id: rent }], summary, consolidated: after.before.clock });

    // A summary past the user's length is cut as a classic consolidation's is, and the answer says so.
    const settings = turn.settings;
    const short = await mindEnv(rig, chatId, undefined, { settings: { ...settings, minds: { ...settings.minds, lengths: { ...settings.minds.lengths, summary: 30 } } } });
    const cut = await answer(short.mind, "mind_consolidate", { who: "Mara", summary });
    expect(cut).toMatchObject({ consolidated: { notes: 2 }, cut: { summary: 1 }, note: note(HARNESS_NOTE.cut) });
    expect(short.turn.changes[0]?.events[0]).toMatchObject({ data: { summary: "Mara lets the rooms upstairs…" } });

    // Once it is in the state the tools read, nothing is due: the view drops the heading, and a second fold is refused with what to do.
    await recordFix(rig, chatId, "folded", events);
    const again = await mindEnv(rig, chatId);
    expect((await call(again.mind, "mind_view", { who: "Mara" })).text).not.toContain("## Upkeep");
    expect(await refusal(again.mind, "mind_consolidate", { who: "Mara", summary })).toBe(note(FILES_NOTE.nothingDue));
    expect(again.turn.changes).toEqual([]);
    noModelCalls(rig);
  });

  test("nothing due, folding switched off, no summary, the player's character and any agent but a character are refused, each with what to do", async () => {
    const { rig, chatId } = await castChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { memory: { notes: { keep: 1 } } } } }));
    await remember(rig, chatId, MARA, [{ text: "Joss owes two months of rent.", salience: 5 }, { text: "The kettle's lid is cracked.", salience: 1 }], "Mara lets the rooms upstairs.");
    const summary = "Joss owes me, and I mean to collect.";

    // Joss holds no notes: nothing of his is due.
    const joss = await mindEnv(rig, chatId);
    expect(await refusal(joss.mind, "mind_consolidate", { who: "Joss", summary })).toBe(note(FILES_NOTE.nothingDue));
    expect((await call(joss.mind, "mind_view", { who: "Joss" })).text).not.toContain("## Upkeep");

    // Mara's are due, but a fold needs its summary, and it is her own mind's alone.
    const mara = await mindEnv(rig, chatId);
    expect(await refusal(mara.mind, "mind_consolidate", { who: "Mara" })).toContain("mind_consolidate needs summary");
    expect(await refusal(mara.mind, "mind_consolidate", { who: "Joss", summary })).toBe(note(HARNESS_NOTE.otherMind, { self: "Mara", other: "Joss", tool: "mind_consolidate" }));

    // Where the world or the user has notes fade out instead, nothing is folded and the view asks for nothing.
    const settings = mara.turn.settings;
    const off = await mindEnv(rig, chatId, undefined, { settings: { ...settings, minds: { ...settings.minds, memory: { ...settings.minds.memory, consolidate: { enabled: false } } } } });
    expect(await refusal(off.mind, "mind_consolidate", { who: "Mara", summary })).toBe(note(FILES_NOTE.foldOff));
    expect((await call(off.mind, "mind_view", { who: "Mara" })).text).not.toContain("## Upkeep");

    for (const role of [HARNESS_AGENT.author, HARNESS_AGENT.gm, HARNESS_AGENT.chronicler]) {
      const other = await castTurn(rig, chatId, { main: role === HARNESS_AGENT.author });
      expect(await refusal(castEnv(rig, chatId, other, role), "mind_consolidate", { who: "Mara", summary })).toBe(note(HARNESS_NOTE.notCharacter, { tool: "mind_consolidate" }));
      expect(other.changes).toEqual([]);
    }
    const pov = (await stateOf(rig, chatId)).state.entities[POV]?.name ?? "";
    const player = await mindEnv(rig, chatId);
    expect(await refusal(player.mind, "mind_consolidate", { who: POV, summary })).toBe(note(HARNESS_NOTE.playerMind, { name: pov }));
    expect([joss.turn.changes, mara.turn.changes, off.turn.changes, player.turn.changes]).toEqual([[], [], [], []]);
    noModelCalls(rig);
  });
});

describe("the player's mode for characters' minds, for a fold and a file", () => {
  const MIND: Agent = { id: "mara-now", role: HARNESS_AGENT.character };
  const LATER: Agent = { id: "mara-after", role: HARNESS_AGENT.character };
  const KEPT = "Mara lets the rooms upstairs.";
  const FOLDED = "Mara lets the rooms upstairs. The kettle wants a new lid.";

  /** A harness chat under `mode`, its workspace given as LumiAH's mount gives one, where Mara holds a note due to fold into her summary. */
  async function minded(mode: "confirm" | "never"): Promise<{ rig: Rig; chatId: string; files: HarnessFiles & { files: Map<string, HarnessFile> } }> {
    const { rig, chatId } = await turnChat();
    const files = memoryFiles();
    rig.rt.harness.files = () => files;
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { mind: { mode } }, minds: { memory: { notes: { keep: 1 } } } } }));
    await remember(rig, chatId, MARA, [{ text: "Joss owes two months of rent.", salience: 5 }, { text: "The kettle's lid is cracked.", salience: 1 }], KEPT);
    return { rig, chatId, files };
  }

  test("set to Never, a fold and a file are refused, in the turn and after the reply: the summary stands and the workspace holds nothing", async () => {
    const { rig, chatId, files } = await minded("never");
    const never = { refused: { code: "mode_never" } };
    const turn = await beginTurn(rig, chatId, "I ask Mara about the rent.");
    expect(JSON.parse(await turn.refusal(MIND, "mind_consolidate", { who: "Mara", summary: FOLDED }))).toMatchObject(never);
    // The file's refusal is the tool's own, in the words every change set to Never is refused in.
    expect(JSON.parse(await turn.refusal(MIND, "mind_file_write", { who: "Mara", file: "now.md", text: NOW }))).toEqual({ refused: { code: "mode_never", reason: note(WRITE_NOTE.never, { type: AGENT_CHANGE_LABEL.mind }) } });
    expect((await turn.answer(AUTHOR, "commit")).committed).toMatchObject({ landed: [], review: [], refused: [] });
    await turn.finish("Mara says the rent was due on the first.");
    const job = await beginJob(rig, turn, "job-upkeep");
    expect(JSON.parse(await job.refusal(LATER, "mind_consolidate", { who: "Mara", summary: FOLDED }))).toMatchObject(never);
    expect(JSON.parse(await job.refusal(LATER, "mind_file_write", { who: "Mara", file: "now.md", text: NOW }))).toMatchObject(never);
    const mara = readCharacter((await stateOf(rig, chatId)).state, MARA);
    expect([mara.summary, mara.notes.length, files.files.size]).toEqual([KEPT, 2, 0]);
    noModelCalls(rig);
  });

  test("set to Confirm, a fold waits on the reply's review card and Apply makes it; a file, which no card could make, is refused with why", async () => {
    const { rig, chatId, files } = await minded("confirm");
    const turn = await beginTurn(rig, chatId, "I ask Mara about the rent.");
    expect((await turn.answer(MIND, "mind_consolidate", { who: "Mara", summary: FOLDED })).consolidated).toMatchObject({ notes: 1, lands: note(WRITE_NOTE.stagedReview) });
    expect(JSON.parse(await turn.refusal(MIND, "mind_file_write", { who: "Mara", file: "now.md", text: NOW }))).toEqual({ refused: { code: "mode_confirm", reason: note(FILES_NOTE.fileAsks, { type: AGENT_CHANGE_LABEL.mind, file: "now.md" }) } });
    const committed = (await turn.answer(AUTHOR, "commit")).committed as { landed: string[][]; review: string[][]; refused: unknown[] };
    expect([committed.landed, committed.review, committed.refused]).toEqual([[], [["Mara's older notes folded into their summary"]], []]);
    await turn.finish("Mara says the rent was due on the first.");
    // After the reply a file is refused the same way: a job has no card that could make one either.
    const job = await beginJob(rig, turn, "job-upkeep");
    expect(JSON.parse(await job.refusal(LATER, "mind_file_write", { who: "Mara", file: "now.md", text: NOW }))).toMatchObject({ refused: { code: "mode_confirm" } });
    expect([readCharacter((await stateOf(rig, chatId)).state, MARA).summary, files.files.size]).toEqual([KEPT, 0]);

    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    const cards = rig.body(await rig.send({ type: "lre.review", chatId, op: "apply", turn: `${reply.id}:0` })).cards as { items: { changeType: string; status: string }[] }[];
    expect(cards[0]?.items.map((item) => [item.changeType, item.status])).toEqual([["mind", "applied"]]);
    const mara = readCharacter((await stateOf(rig, chatId)).state, MARA);
    expect([mara.summary, mara.notes.map((n) => n.text), files.files.size]).toEqual([FOLDED, ["Joss owes two months of rent."], 0]);
    noModelCalls(rig);
  });

  test("as shipped, a file is written to the workspace the bridge gives the call, at once", async () => {
    const { rig, chatId } = await turnChat();
    const files = memoryFiles();
    rig.rt.harness.files = () => files;
    const turn = await beginTurn(rig, chatId, "I ask Mara about the rent.");
    expect((await turn.answer(MIND, "mind_file_write", { who: "Mara", file: "now.md", text: NOW })).written).toMatchObject({ file: "now.md", size: NOW.length });
    expect(files.files.get(`minds/${MARA}/now.md`)?.text).toBe(NOW);
    noModelCalls(rig);
  });
});

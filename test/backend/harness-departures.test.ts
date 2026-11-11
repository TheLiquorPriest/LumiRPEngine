// Where a reply says something against its turn (docs/HARNESS.md: "The reply serves the turn"). On
// the harness the turn decides what happens and the reply is written to tell it: what the reply says
// against what the turn decided or the world holds is never written into the world. The chronicler
// notes it on the reply (`story_departure`), a line each, kept on the reply's record outside the
// world. The reply's flag lists the lines and says what the player can do, and the next turn's
// author is told, to steer the story back.

import { describe, expect, test } from "bun:test";
import { departuresOf, recHarnessOf } from "../../src/backend/harness/record";
import { renderPrompt } from "../../src/backend/prompts";
import { TOOL_NOTE, toolArgTextId } from "../../src/shared/agent-tools";
import { HARNESS_AGENT, HARNESS_NOTE, HARNESS_TEXT } from "../../src/shared/harness-texts";
import { DEPARTURE_LIMITS, STORY_NOTE, STORY_TOOL } from "../../src/shared/harness-texts-story";
import type { JsonObject } from "../../src/shared/json";
import type { Rec } from "../../src/shared/ledger";
import type { Chip } from "../../src/shared/state-view";
import { placeOfEntity } from "../../src/engine/scope";
import type { Rig } from "../support/rig";
import { HOME } from "../support/tools";
import { type Agent, AUTHOR, beginJob, beginTurn, claimOf, harnessChat, noModelCalls, OKORO, type Run, recordOn, stateOf, turnRecord } from "./harness-driver";

const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);
const DEPART = STORY_TOOL.departure;

/** The chronicler of a job after the reply, and the game master's agent, which only reads. */
const CHRONICLER: Agent = { id: "job-chronicler", role: HARNESS_AGENT.chronicler };
const GM: Agent = { id: "job-gm", role: HARNESS_AGENT.gm };

const BRIEF = "- Okoro knocks and comes in from the street.";
const REPLY = "Nobody knocks. Okoro is still across town, and the kitchen stays quiet.";
const OKORO_LINE = "The reply has Okoro stay across town; the world has him in the kitchen.";
const KETTLE_LINE = "The reply has the kettle cold; the world has it boiled.";

/** A turn whose author brings Okoro into the kitchen and commits, and whose reply says he never came; then the chronicler's job, after the reply. */
async function departingTurn(rig: Rig, chatId: string): Promise<{ turn: Run; job: Run; replyId: string }> {
  const turn = await beginTurn(rig, chatId, "I wait for Okoro.");
  await turn.answer(AUTHOR, "gm_move", { entity: "Okoro", to: HOME });
  await turn.answer(AUTHOR, "commit", {});
  // Before its reply there is nothing to hold to the turn: the tool says when it is for.
  expect(await turn.refusal(AUTHOR, DEPART, { lines: [OKORO_LINE] })).toBe(note(STORY_NOTE.departAfterReply));
  await turn.writer(BRIEF);
  await turn.written(REPLY);
  if (!turn.generation) throw new Error("no generation");
  await rig.host.finish(turn.generation, REPLY);
  await turn.end("done", { record: turnRecord(turn, { jobs: [{ id: "job-after", agent: HARNESS_AGENT.chronicler, state: "queued" }] }) });
  const job = await beginJob(rig, turn, "job-after");
  return { turn, job, replyId: head(rig, chatId).id };
}

/** The chat's last reply. */
function head(rig: Rig, chatId: string) {
  const reply = rig.host.head(chatId);
  if (!reply) throw new Error("no reply");
  return reply;
}

/** The record a reply holds with its harness part set apart: what every hash of the record and every fold reads, and the part that holds the lines. */
async function parts(rig: Rig, chatId: string, replyId: string): Promise<{ rec: Rec | null; rest: Omit<Rec, "harness"> | null }> {
  const rec = await recordOn(rig, chatId, replyId);
  if (!rec) return { rec, rest: null };
  const { harness: _harness, ...rest } = rec;
  return { rec, rest };
}

/** The chips the chat's view shows on a message. */
async function chipsOn(rig: Rig, chatId: string, messageId: string): Promise<Chip[]> {
  return (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === messageId);
}

/** A reply's flag of departure, if it has one. */
async function flagOn(rig: Rig, chatId: string, messageId: string): Promise<Chip | undefined> {
  return (await chipsOn(rig, chatId, messageId)).find((c) => c.id.startsWith("departed:"));
}

/** The world's guidance the engine gives the chat's next run, as its author reads it. */
async function guidanceOf(rig: Rig, chatId: string): Promise<string> {
  const guidance = (await claimOf(rig, chatId))?.guidance;
  return guidance && "text" in guidance ? guidance.text : "";
}

describe("a reply that says something against its turn", () => {
  test("the chronicler notes it on the reply's record, a line each: the world keeps what the turn decided, and nothing else of the record moves", async () => {
    const { rig, chatId } = await harnessChat();
    const { turn, job, replyId } = await departingTurn(rig, chatId);
    const before = await parts(rig, chatId, replyId);
    const world = await stateOf(rig, chatId);
    expect(departuresOf(before.rec)).toEqual([]);

    expect(await job.answer(CHRONICLER, DEPART, { lines: [OKORO_LINE] })).toEqual({ departures: { lines: [OKORO_LINE], lands: note(STORY_NOTE.departed) } });
    const after = await parts(rig, chatId, replyId);
    expect(departuresOf(after.rec)).toEqual([OKORO_LINE]);
    // Nothing of the world moved, nor any part of the record a hash or a fold reads: Okoro is where the turn put him.
    expect(await stateOf(rig, chatId)).toEqual(world);
    expect(placeOfEntity(world, OKORO)).toBe(HOME);
    expect(after.rest).toEqual(before.rest);
    // The record's harness part keeps everything else it held: the turn, and LumiAH's record of it.
    expect({ ...recHarnessOf(after.rec), departures: undefined }).toEqual({ ...recHarnessOf(before.rec), departures: undefined });

    // More lines come after those it holds; one it holds already is kept once, and one line given as text is a list of one.
    expect(await job.answer(CHRONICLER, DEPART, { lines: [OKORO_LINE, KETTLE_LINE] })).toMatchObject({ departures: { lines: [OKORO_LINE, KETTLE_LINE] } });
    expect(await job.answer(CHRONICLER, DEPART, { lines: `  ${KETTLE_LINE}  ` })).toMatchObject({ departures: { lines: [OKORO_LINE, KETTLE_LINE] } });
    // LumiAH's record written again for the reply (a job of the turn ending) keeps them.
    expect(await rig.rt.harness.anchor(chatId, rig.host.userId, replyId, 0, turnRecord(turn, { at: 2 }) as unknown as JsonObject)).toBe(true);
    const anchored = await recordOn(rig, chatId, replyId);
    expect(recHarnessOf(anchored)?.record).toMatchObject({ at: 2 });
    expect(departuresOf(anchored)).toEqual([OKORO_LINE, KETTLE_LINE]);
    expect(await stateOf(rig, chatId)).toEqual(world);
    noModelCalls(rig);
  });

  test("what a call may give is held to what a reply keeps, and a refused call keeps nothing", async () => {
    const { rig, chatId } = await harnessChat();
    const { job, replyId } = await departingTurn(rig, chatId);
    const missing = note(TOOL_NOTE.missing, { tool: DEPART, arg: "lines", text: note(toolArgTextId(DEPART, "lines")) });
    const unreadable: JsonObject[] = [{}, { lines: [] }, { lines: ["  ", ""] }, { lines: 3 }, { lines: [OKORO_LINE, 4] }];
    for (const args of unreadable) expect({ args, out: await job.refusal(CHRONICLER, DEPART, args) }).toEqual({ args, out: missing });
    const many = Array.from({ length: DEPARTURE_LIMITS.lines + 1 }, (_, i) => `Line ${i + 1}: the reply says one thing, and the world holds another.`);
    expect(await job.refusal(CHRONICLER, DEPART, { lines: many })).toBe(note(STORY_NOTE.departMany, { most: "8", count: "9" }));
    const longest = "x".repeat(DEPARTURE_LIMITS.chars);
    expect(await job.refusal(CHRONICLER, DEPART, { lines: [OKORO_LINE, `${longest}y`] })).toBe(note(STORY_NOTE.departLong, { at: "2", chars: "201", most: "200" }));
    // The agent that only reads is refused at the gate, before the tool runs.
    expect(JSON.parse(await job.refusal(GM, DEPART, { lines: [OKORO_LINE] })).refused.code).toBe("no_writer");
    expect(departuresOf(await recordOn(rig, chatId, replyId))).toEqual([]);

    // A line as long as a line may be is kept. A reply keeps eight in all: a call that would take it past that keeps nothing, where a line it holds already adds nothing to count.
    await job.answer(CHRONICLER, DEPART, { lines: [longest, OKORO_LINE] });
    await job.answer(CHRONICLER, DEPART, { lines: many.slice(0, 6) });
    expect(await job.refusal(CHRONICLER, DEPART, { lines: [OKORO_LINE, many[8] ?? ""] })).toBe(note(STORY_NOTE.departFull, { held: "8", most: "8" }));
    expect(await job.answer(CHRONICLER, DEPART, { lines: [OKORO_LINE] })).toMatchObject({ departures: { lines: [longest, OKORO_LINE, ...many.slice(0, 6)] } });
    expect(departuresOf(await recordOn(rig, chatId, replyId))).toHaveLength(DEPARTURE_LIMITS.lines);

    // Another telling of the reply shown: the first one's record is off the chat's path and takes no lines, and the new one has none.
    const again = await beginTurn(rig, chatId, null, { type: "swipe" });
    await again.finish("Okoro comes in from the street.");
    expect(JSON.parse(await job.refusal(CHRONICLER, DEPART, { lines: [KETTLE_LINE] }))).toEqual({ refused: { code: "off_path", reason: note(HARNESS_NOTE.offPath) } });
    expect(departuresOf(await recordOn(rig, chatId, replyId))).toEqual([]);
    noModelCalls(rig);
  });

  test("the reply's flag lists each line and says what the player can do: Regenerate on the last reply, and the next message", async () => {
    const { rig, chatId } = await harnessChat();
    const { job, replyId } = await departingTurn(rig, chatId);
    expect(await flagOn(rig, chatId, replyId)).toBeUndefined();
    await job.answer(CHRONICLER, DEPART, { lines: [OKORO_LINE, KETTLE_LINE] });
    const flag = await flagOn(rig, chatId, replyId);
    expect(flag).toMatchObject({ id: `departed:${replyId}:0`, kind: "degraded", label: "The reply doesn't match the world", actions: [{ id: "regenerate", label: "Regenerate" }], expires: "never" });
    const [lead, ...lines] = flag?.detail?.split("\n") ?? [];
    expect(lines).toEqual([OKORO_LINE, KETTLE_LINE]);
    expect(lead).toContain("Regenerate");
    expect(lead).toContain("next message");

    // Played on, the reply is no longer the last: its flag stays with its lines, and offers no Regenerate, which only plays the last reply again.
    const next = await beginTurn(rig, chatId, "I give up waiting.");
    await next.finish("You put the kettle away.");
    const earlier = await flagOn(rig, chatId, replyId);
    expect(earlier?.actions).toEqual([]);
    expect(earlier?.detail?.split("\n").slice(1)).toEqual([OKORO_LINE, KETTLE_LINE]);
    expect(earlier?.detail).not.toContain("Regenerate");
    expect(await flagOn(rig, chatId, head(rig, chatId).id)).toBeUndefined();
    noModelCalls(rig);
  });

  test("a reply no turn was played for says on its flag what the player can do too: Regenerate on the last reply, nothing on an earlier one", async () => {
    const { rig, chatId } = await harnessChat();
    const stopped = await beginTurn(rig, chatId, "I wait for Okoro.");
    if (!stopped.generation) throw new Error("no generation");
    await rig.host.stop(stopped.generation, "Nobody knocks");
    await stopped.end("stopped");
    const unplayedOn = async (messageId: string) => (await chipsOn(rig, chatId, messageId)).find((c) => c.id.startsWith("unplayed:"));
    const replyId = head(rig, chatId).id;
    const flag = await unplayedOn(replyId);
    expect(flag?.actions).toEqual([{ id: "regenerate", label: "Regenerate" }]);
    expect(flag?.detail).toContain("Regenerate");
    const next = await beginTurn(rig, chatId, "I go to the door.");
    await next.finish("The step is empty.");
    const earlier = await unplayedOn(replyId);
    expect(earlier?.actions).toEqual([]);
    expect(earlier?.detail).not.toContain("Regenerate");
    noModelCalls(rig);
  });

  test("the next turn's author is told of the last reply's lines first, once", async () => {
    const { rig, chatId } = await harnessChat();
    const { job } = await departingTurn(rig, chatId);
    await job.answer(CHRONICLER, DEPART, { lines: [OKORO_LINE, KETTLE_LINE] });
    const next = await beginTurn(rig, chatId, "I look at the door.");
    const told = await guidanceOf(rig, chatId);
    expect(told.startsWith(`${note(HARNESS_TEXT.departed, { lines: `- ${OKORO_LINE}\n- ${KETTLE_LINE}` })}\n\n`)).toBe(true);
    // The world it reads is the turn's, not the reply's.
    expect(placeOfEntity(await stateOf(rig, chatId), OKORO)).toBe(HOME);
    await next.finish("Okoro is at the table.");
    // The reply after it says nothing against its turn, so the author after that is told nothing of it.
    await beginTurn(rig, chatId, "I sit down.");
    expect(await guidanceOf(rig, chatId)).not.toContain(OKORO_LINE);
    noModelCalls(rig);
  });

  test("a Continue's turn keeps the lines the reply holds: the reply still says what they are about", async () => {
    const { rig, chatId } = await harnessChat();
    const { turn, job, replyId } = await departingTurn(rig, chatId);
    await job.answer(CHRONICLER, DEPART, { lines: [OKORO_LINE] });
    const more = await beginTurn(rig, chatId, null, { type: "continue" });
    await more.finish(" Still nobody comes.");
    const rec = await recordOn(rig, chatId, replyId);
    expect(recHarnessOf(rec)?.turns).toEqual([turn.turn, more.turn]);
    expect(departuresOf(rec)).toEqual([OKORO_LINE]);
    noModelCalls(rig);
  });
});

describe("a record's lines of departure, as they are read", () => {
  test("a record without them has none, and a damaged one gives what it can", () => {
    expect(departuresOf(null)).toEqual([]);
    expect(departuresOf({})).toEqual([]);
    expect(departuresOf({ harness: { turns: ["t1"] } })).toEqual([]);
    expect(recHarnessOf({ harness: { turns: ["t1"] } })).toEqual({ turns: ["t1"] });
    const damaged = { harness: { turns: ["t1"], departures: [OKORO_LINE, 3, "", "  ", KETTLE_LINE] } } as unknown as Pick<Rec, "harness">;
    expect(departuresOf(damaged)).toEqual([OKORO_LINE, KETTLE_LINE]);
    expect(recHarnessOf(damaged)).toEqual({ turns: ["t1"], departures: [OKORO_LINE, KETTLE_LINE] });
    expect(departuresOf({ harness: { turns: ["t1"], departures: "a line" } } as unknown as Pick<Rec, "harness">)).toEqual([]);
    const tooMany = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`);
    expect(departuresOf({ harness: { turns: ["t1"], departures: tooMany } })).toEqual(tooMany.slice(0, DEPARTURE_LIMITS.lines));
  });
});

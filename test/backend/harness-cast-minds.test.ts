// A person's own mind on the harness engine (`harness-tools/minds.ts`), played through the bridge's
// real turn: who is given the turn as written once its reply is saved, and what the player's mode
// for characters' minds does to a decision and a memory, in the turn and in a job after the reply.
// What a tool stages there is committed, carded and recorded as a real turn's is.
//
// And what the knowledge agent reads of a turn (`knowledge_scene`), its secrets marked. Through the
// bridge too: whether a view marks is the bridge's to say, by the definition the agent runs as.

import { describe, expect, test } from "bun:test";
import { renderPrompt } from "../../src/backend/prompts";
import { WRITE_NOTE } from "../../src/shared/agent-tools-write";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import { FILES_NOTE } from "../../src/shared/harness-texts-files";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import { readCharacter } from "../../src/packs/minds/core/state";
import { HOME } from "../support/tools";
import { type Agent, AUTHOR, BRANN, beginJob, beginTurn, harnessChat, MARA, noModelCalls, OKORO, stateOf } from "./harness-driver";

/** A registry text as shipped, filled: what a tool answers when the user changed nothing. */
const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);

/** A character's agent, by its handle: one agent is one person's mind for its whole run. */
const mind = (id: string): Agent => ({ id, role: HARNESS_AGENT.character });

describe("the turn as written, once its reply is saved", () => {
  const SAID = "I lean in and whisper to Mara that the cellar key is under the third step.";
  const REPLY = 'Mara nods. "Under the third step. Not a word," she whispers back.';
  /** What only someone who heard the turn could know of it. */
  const KEPT = "third step";

  test("is given to whoever heard it and to no one else: someone elsewhere, and someone who came in after it was said, read their own mind and record no memory of it", async () => {
    const { rig, chatId } = await harnessChat({ minds: true });
    const turn = await beginTurn(rig, chatId, SAID);
    // Before the reply the mind step's own rule holds: Mara is with the player character and reads the message, Okoro is elsewhere and reads nothing of it.
    expect((await turn.call(mind("mara-now"), "mind_view", { who: "Mara" })).text).toContain(SAID);
    const before = await turn.call(mind("okoro-now"), "mind_view", { who: "Okoro" });
    expect([before.error, before.text.includes(KEPT)]).toEqual([undefined, false]);
    // Brann walks in once it is said: with the player character at the turn's end, without having heard it.
    await turn.answer(AUTHOR, "gm_move", { entity: "Brann", to: HOME });
    await turn.finish(REPLY);

    const job = await beginJob(rig, turn, "job-memories");
    const mara = (await job.call(mind("mara-after"), "mind_view", { who: "Mara" })).text;
    expect([mara.includes("## The turn just written"), mara.includes(SAID), mara.includes(REPLY)]).toEqual([true, true, true]);
    for (const [handle, who] of [["okoro-after", "Okoro"], ["brann-after", "Brann"]] as const) {
      const seen = await job.call(mind(handle), "mind_view", { who });
      expect({ who, error: seen.error, kept: seen.text.includes(KEPT), written: seen.text.includes("## The turn just written"), why: seen.text.includes(note(FILES_NOTE.viewAbsent)) }).toEqual({ who, error: undefined, kept: false, written: false, why: true });
      expect(await job.refusal(mind(handle), "mind_remember", { who, notes: [{ text: "The cellar key is under the third step.", salience: 5 }] })).toBe(note(FILES_NOTE.rememberAbsent));
    }
    // Mara's memory of it is recorded; the two who didn't hear it hold none.
    await job.answer(mind("mara-after"), "mind_remember", { who: "Mara", notes: [{ text: "He told me where the cellar key is.", salience: 4 }] });
    const state = await stateOf(rig, chatId);
    expect([MARA, OKORO, BRANN].map((id) => readCharacter(state, id).notes.map((n) => n.text))).toEqual([["He told me where the cellar key is."], [], []]);
    noModelCalls(rig);
  });
});

describe("the player's mode for characters' minds", () => {
  const DECISION = { who: "Mara", monologue: "He is stalling again.", intent: "Ask Joss for the rent today.", mood: "tired" };
  const MEMORY = { who: "Mara", notes: [{ text: "He asked about the rent before I could.", salience: 3 }] };

  /** What a staged change set to Never is refused with. */
  const NEVER = { refused: { code: "mode_never" } };

  test("set to Never, a decision and a memory are refused where they are staged, in the turn and after the reply, and nothing of them is recorded", async () => {
    const { rig, chatId } = await harnessChat({ minds: true });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { mind: { mode: "never" } } } }));
    const turn = await beginTurn(rig, chatId, "I ask Mara about the rent.");
    expect(JSON.parse(await turn.refusal(mind("mara-now"), "mind_decide", DECISION))).toMatchObject(NEVER);
    expect(JSON.parse(await turn.refusal(mind("mara-now"), "mind_remember", MEMORY))).toMatchObject(NEVER);
    // Nothing was staged: the author's commit has nothing of a mind's to land, to ask about or to refuse.
    expect((await turn.answer(AUTHOR, "commit")).committed).toMatchObject({ landed: [], review: [], refused: [] });
    await turn.finish("Mara says the rent was due on the first.");
    const job = await beginJob(rig, turn, "job-memory");
    expect(JSON.parse(await job.refusal(mind("mara-after"), "mind_remember", MEMORY))).toMatchObject(NEVER);
    const mara = readCharacter(await stateOf(rig, chatId), MARA);
    expect([mara.mind, mara.notes]).toEqual([null, []]);
    noModelCalls(rig);
  });

  test("set to Confirm, a decision made in the turn and a memory made after the reply wait on the reply's review card, and Apply records both", async () => {
    const { rig, chatId } = await harnessChat({ minds: true });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { mind: { mode: "confirm" } } } }));
    const turn = await beginTurn(rig, chatId, "I ask Mara about the rent.");
    expect((await turn.answer(mind("mara-now"), "mind_decide", DECISION)).decided).toMatchObject({ intent: DECISION.intent, lands: note(WRITE_NOTE.stagedReview) });
    const committed = (await turn.answer(AUTHOR, "commit")).committed as { landed: string[][]; review: string[][]; refused: unknown[] };
    expect([committed.landed, committed.review.length, committed.refused]).toEqual([[], 1, []]);
    await turn.finish("Mara says the rent was due on the first.");
    const job = await beginJob(rig, turn, "job-memory");
    expect((await job.answer(mind("mara-after"), "mind_remember", MEMORY)).remembered).toMatchObject({ notes: 1, lands: note(WRITE_NOTE.stagedReview) });

    // Both are on the reply's card, and neither is in the world until the player says so.
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    const cardOf = async (op: "get" | "apply"): Promise<string[][]> => {
      const cards = rig.body(await rig.send({ type: "lre.review", chatId, op, turn: `${reply.id}:0` })).cards as { turn: string; items: { changeType: string; status: string }[] }[];
      return (cards.find((card) => card.turn === `${reply.id}:0`)?.items ?? []).map((item) => [item.changeType, item.status]);
    };
    expect(await cardOf("get")).toEqual([["mind", "open"], ["mind", "open"]]);
    const waiting = readCharacter(await stateOf(rig, chatId), MARA);
    expect([waiting.mind, waiting.notes]).toEqual([null, []]);
    expect(await cardOf("apply")).toEqual([["mind", "applied"], ["mind", "applied"]]);
    const mara = readCharacter(await stateOf(rig, chatId), MARA);
    expect([mara.mind?.intent, mara.notes.map((n) => n.text)]).toEqual([DECISION.intent, MEMORY.notes.map((n) => n.text)]);
    noModelCalls(rig);
  });
});

describe("what the knowledge agent reads of a turn", () => {
  const CLAIM = "Joss owes Mara two months of rent.";
  const PLAIN = "The kettle's lid is cracked.";
  const KNOWLEDGE: Agent = { id: "knowledge-now", role: HARNESS_AGENT.knowledge };

  test("knowledge_scene marks a fact someone keeps wherever it lists it, as knowledge_what_knows marks it, and names someone no one knows of as the reads name them; a plain fact and a plain name read as they are", async () => {
    // Brann stands where the player character wakes, and the world keeps them secret.
    const { rig, chatId } = await harnessChat({ minds: true, put: { entities: { [BRANN]: { id: BRANN, kind: "character", name: "Brann", tier: "background", visibility: "secret", fields: { place: HOME }, relations: [] } } } });
    rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, knowledge: true }));
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { learn: { mode: "auto" } } } }));
    const turn = await beginTurn(rig, chatId, "I put the kettle on and ask who is in today.");
    // Joss tells Mara, who keeps it to herself; what both saw happen is no one's secret.
    await turn.answer(KNOWLEDGE, "knowledge_infer", {
      who: ["Mara", "Joss"],
      facts: [{ ref: "n1", claim: CLAIM, matters: "Mara may press Joss for it." }, { ref: "n2", claim: PLAIN, matters: "Whoever pours next may be scalded." }],
      learned: [{ fact: "n1", how: "told", by: "Joss", who: ["Mara"], keptFrom: ["everyone"] }, { fact: "n2", how: "witnessed" }],
    });

    // The mark a read gives the kept fact: known to Mara, who holds it, and kept from everyone else.
    const held = (await turn.answer(KNOWLEDGE, "knowledge_what_knows", { person: "Mara" })).facts as { fact: string; claim: string }[];
    const kept = held.find((fact) => fact.claim.startsWith(CLAIM));
    expect(kept?.claim).toBe(secretMarkText(CLAIM, ["Mara"], "everyone", SECRET_MARK_WORDING));
    const mark = (kept?.claim ?? "").slice(CLAIM.length);

    const scene = (await turn.call(KNOWLEDGE, "knowledge_scene", {})).text.split("\n");
    // Listed among the facts in play and in Mara's own holdings: each line carries that mark, after its own words.
    const listing = scene.filter((line) => line.startsWith(`- [${kept?.fact ?? ""}] `));
    expect(listing.length).toBeGreaterThan(1);
    expect(listing.filter((line) => !line.includes(CLAIM) || !line.endsWith(mark))).toEqual([]);
    expect(scene.filter((line) => line.includes(PLAIN) && line.includes("[secret;"))).toEqual([]);
    // Who could perceive the turn: the secret person by the name the reads give them, anyone else by their own.
    expect(scene).toContain(`- ${secretMarkText("Brann", [], "everyone", SECRET_MARK_WORDING)} (id: brann): there throughout`);
    expect(scene).toContain("- Mara (id: mara): there throughout");
    noModelCalls(rig);
  });
});

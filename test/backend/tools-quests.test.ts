// The quests family (INC1-SPEC R3a) on Port Alder: the quest log under the player character's
// knowledge (the secret of Marcus's debt only as its masked row, under its stand-in id), every track
// under everyone's with the secret's words and its unrevealed truth marked as kept from everyone, the
// GM's every stage and truth, and what moves a track on by knowledge.

import { describe, expect, test } from "bun:test";
import { STARTER_WORLDS } from "../../src/packs/index";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import { objectiveLabel, type WorldDoc } from "../../src/shared/world";
import { alderChat, answerOf, callTool } from "../support/tools";

const PORT_ALDER = (STARTER_WORLDS["modern_slice_of_life"] as (id: string, name: string) => WorldDoc)("w", "Port Alder");
const SECRET = PORT_ALDER.tracks.s_shop_trouble;
const LABEL = SECRET?.label ?? "";
/** What Marcus isn't saying: the shop's debt, the truth at the secret's last stage, unrevealed from the start. */
const TRUTH = SECRET?.stages.truth?.truth ?? "";
const FLEET = PORT_ALDER.tracks.q_fleet_contract;

/** Text marked as a secret no one is named as knowing, in the shipped wording. */
const kept = (text: string): string => secretMarkText(text, [], "everyone", SECRET_MARK_WORDING);

interface Row {
  id: string;
  label: string;
  kind: string;
  stage: string;
  status: string;
  cue?: string;
  stageId?: string;
  visibility?: string;
}

interface Stage {
  id: string;
  label: string;
  stage: string;
  since?: string;
  cue?: string;
  objectives: { label: string; done: boolean }[];
  hints: string[];
  truths: string[];
  secrets?: { stage: string; truth: string; current?: true }[];
  stageId?: string;
  visibility?: string;
  stages?: { id: string; label: string; truth?: string; revealed?: boolean; current?: true }[];
}

interface Moves {
  id: string;
  label: string;
  stage: string;
  todo?: string[];
  hints?: string[];
  stageId?: string;
  next?: { to: { id: string; label: string }; when: string; holds: boolean; gate?: { when: string; holds: boolean } }[];
  objectives?: { label: string; when: string; done: boolean }[];
}

describe("the quests tools", () => {
  test("quests_tracks under the player character's knowledge is Play's quest log: the public quests, the secret only as its masked row under its stand-in id", async () => {
    const { rig, chatId } = await alderChat();
    const out = await callTool(rig, chatId, "pov", "quests_tracks");
    expect(out.error).toBeUndefined();
    const { tracks } = JSON.parse(out.text) as { tracks: Row[] };
    expect(tracks.map((t) => t.id)).toEqual(expect.arrayContaining(["q_fleet_contract", "q_pontoon_weekend"]));
    expect(tracks.find((t) => t.id === "q_fleet_contract")).toMatchObject({ label: FLEET?.label, kind: "quest", stage: FLEET?.stages.kickoff?.label, status: "active" });
    const masked = tracks.find((t) => t.kind === "secret");
    expect(masked).toMatchObject({ label: "Something is going on", stage: "", cue: SECRET?.stages.cue?.cue, status: "active" });
    expect(masked?.id.startsWith("~")).toBe(true);
    for (const hidden of ["s_shop_trouble", LABEL, TRUTH, "[secret;"]) expect(out.text).not.toContain(hidden);
    // The quest log has no agendas, and nothing of the GM's.
    expect(tracks.some((t) => t.kind === "agenda" || t.visibility !== undefined || t.stageId !== undefined)).toBe(false);
  });

  test("quests_stage under the player character's knowledge: the masked row by its stand-in, never the secret by its own id or label", async () => {
    const { rig, chatId } = await alderChat();
    const { tracks } = await answerOf<{ tracks: Row[] }>(rig, chatId, "pov", "quests_tracks");
    const standIn = tracks.find((t) => t.kind === "secret")?.id ?? "";
    const out = await callTool(rig, chatId, "pov", "quests_stage", { track: standIn });
    expect(JSON.parse(out.text)).toMatchObject({ id: standIn, label: "Something is going on", stage: "", objectives: [], truths: [] });
    expect((JSON.parse(out.text) as Stage).since).toBeUndefined();
    for (const hidden of ["s_shop_trouble", LABEL, TRUTH]) expect(out.text).not.toContain(hidden);
    for (const said of ["s_shop_trouble", LABEL]) {
      const refused = await callTool(rig, chatId, "pov", "quests_stage", { track: said });
      expect(refused.error).toBe(true);
      expect(refused.text).not.toContain(TRUTH);
    }
  });

  test("under everyone every track, the secret's label and stage marked as kept from everyone, and its truth marked where quests_stage gives it", async () => {
    const { rig, chatId } = await alderChat();
    const { tracks } = await answerOf<{ tracks: Row[] }>(rig, chatId, "everyone", "quests_tracks");
    expect(tracks.find((t) => t.id === "s_shop_trouble")).toMatchObject({ label: kept(LABEL), kind: "secret", stage: kept(SECRET?.stages.cue?.label ?? ""), status: "active" });
    expect(tracks.find((t) => t.id === "q_fleet_contract")).toMatchObject({ label: FLEET?.label, stage: FLEET?.stages.kickoff?.label });
    expect(tracks.some((t) => t.kind === "agenda")).toBe(true);
    const stage = await answerOf<Stage>(rig, chatId, "everyone", "quests_stage", { track: "s_shop_trouble" });
    expect(stage).toMatchObject({ id: "s_shop_trouble", label: kept(LABEL), cue: SECRET?.stages.cue?.cue, truths: [] });
    expect(stage.secrets).toEqual([{ stage: kept(SECRET?.stages.truth?.label ?? ""), truth: kept(TRUTH) }]);
    expect(typeof stage.since).toBe("string");
    expect(stage.stages).toBeUndefined();
  });

  test("the GM reads every stage's truth plain, the secret's visibility, and only the kinds asked for", async () => {
    const { rig, chatId } = await alderChat();
    const { tracks } = await answerOf<{ tracks: Row[] }>(rig, chatId, "gm", "quests_tracks", { kind: "secret" });
    expect(tracks).toEqual([expect.objectContaining({ id: "s_shop_trouble", label: LABEL, visibility: "secret", stageId: "cue" })]);
    const stage = await answerOf<Stage>(rig, chatId, "gm", "quests_stage", { track: "What Marcus isn't saying" });
    expect(stage).toMatchObject({ id: "s_shop_trouble", label: LABEL, stageId: "cue", visibility: "secret" });
    expect(stage.stages?.find((s) => s.id === "truth")).toMatchObject({ truth: TRUTH, revealed: false });
    expect(stage.stages?.find((s) => s.id === "cue")).toMatchObject({ current: true });
    expect(JSON.stringify(stage)).not.toContain("[secret;");
    const wrong = await callTool(rig, chatId, "gm", "quests_tracks", { kind: "side_quest" });
    expect(wrong.error).toBe(true);
    expect(wrong.text).toContain("quest, secret, puzzle, agenda");
  });

  test("quests_moves: the GM's ways on from the kickoff with what each needs, and under the player character's knowledge only what is still to do", async () => {
    const { rig, chatId } = await alderChat();
    const gm = await answerOf<Moves>(rig, chatId, "gm", "quests_moves", { track: "q_fleet_contract" });
    expect(gm.stageId).toBe("kickoff");
    expect(gm.next).toEqual([{ to: { id: "trial", label: FLEET?.stages.trial?.label ?? "" }, when: "flag('fleet_deal_accepted')", holds: false }]);
    expect(gm.objectives?.length).toBeGreaterThan(0);
    expect(gm.objectives?.every((o) => o.when !== "" && !o.done)).toBe(true);
    const out = await callTool(rig, chatId, "pov", "quests_moves", { track: "The Fleet Contract" });
    const pov = JSON.parse(out.text) as Moves;
    expect(pov).toMatchObject({ id: "q_fleet_contract", todo: (FLEET?.stages.kickoff?.objectives ?? []).map(objectiveLabel), hints: [] });
    expect(pov.next).toBeUndefined();
    expect(out.text).not.toContain("flag(");
  });

  test("quests_moves under everyone: the secret's way on, its words marked", async () => {
    const { rig, chatId } = await alderChat();
    const moves = await answerOf<Moves>(rig, chatId, "everyone", "quests_moves", { track: "s_shop_trouble" });
    expect(moves).toMatchObject({ label: kept(LABEL), stage: kept(SECRET?.stages.cue?.label ?? ""), stageId: "cue" });
    expect(moves.next?.[0]).toMatchObject({ to: { id: "rumor", label: kept(SECRET?.stages.rumor?.label ?? "") }, when: SECRET?.stages.cue?.next[0]?.when, holds: false });
  });
});

// The people tools on Port Alder (INC1-SPEC R3a): who there is, one person's sheet, where someone is
// and how someone regards others, under each view. Everyone's marks each restricted thing (Marcus's
// house, a secret place; Vex Morrow, a person no one may see) in the user's wording; the GM's reads
// everything, with its visibility and the GM's own data.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import type { Rig } from "../support/rig";
import { alderChat, answerOf, callTool, HOME, KNOWLEDGE, POV, recordFix } from "../support/tools";

/** A person no one may see, at the player character's home: a test's own, never Port Alder's. */
const VEX: JsonObject = { id: "vex_morrow", kind: "character", name: "Vex Morrow", tier: "background", visibility: "secret", fields: { place: HOME }, relations: [] };
const VEX_MARKED = secretMarkText("Vex Morrow", [], "everyone", SECRET_MARK_WORDING);
/** Marcus's house: a secret place, which no one sees, not even from inside. */
const BIRCH = "12 Birch Lane";
const BIRCH_MARKED = secretMarkText(BIRCH, [], "everyone", SECRET_MARK_WORDING);
const HOME_REF = { id: HOME, name: "114 Harbor Street" };

interface Ref {
  id: string;
  name: string;
  visibility?: string;
}

interface Shown {
  id?: string;
  name: string;
  visibility?: string;
}

interface Found extends Ref {
  kind: string;
  place?: Shown;
  lastSeen?: { place: Shown; at: string };
}

interface Where {
  person: Ref;
  here?: boolean;
  place?: Shown;
  path?: Ref[];
  doing?: string;
  lastSeen?: { place: Shown; at: string };
  together?: boolean;
}

interface Sheet {
  person: Ref;
  kind: { id: string; label: string };
  place?: Shown;
  details?: string[];
  fields?: { id: string; label: string; value: unknown }[];
  relations: { type: string; to: Ref; words?: string }[];
  agent?: boolean;
  schedules?: { label: string; summary: string }[];
  lore: { id: string; title: string; text: string }[];
}

interface RegardRead {
  person: Ref;
  regard: { toward: Ref; words?: string; axes: { axis: string; band: string; value?: number }[] }[];
}

let shared: Promise<{ rig: Rig; chatId: string }> | null = null;

/** One Port Alder chat for the tests that only read, with Vex Morrow at the player character's home. */
function chat(): Promise<{ rig: Rig; chatId: string }> {
  shared ??= alderChat({ put: { entities: { vex_morrow: VEX } } });
  return shared;
}

describe("the people tools on Port Alder", () => {
  test("people_find lists everyone, each where they are, a secret marked under everyone's knowledge and with its visibility under the GM's", async () => {
    const { rig, chatId } = await chat();
    const everyone = await answerOf<{ people: Found[] }>(rig, chatId, "everyone", "people_find");
    expect(everyone.people.find((p) => p.id === "vex_morrow")).toEqual({ id: "vex_morrow", name: VEX_MARKED, kind: "character", place: HOME_REF });
    expect(everyone.people.find((p) => p.id === "marcus_delgado")?.place).toEqual({ id: "birch_lane_12", name: BIRCH_MARKED });

    const gm = await answerOf<{ people: Found[] }>(rig, chatId, "gm", "people_find");
    expect(gm.people.find((p) => p.id === "vex_morrow")).toMatchObject({ name: "Vex Morrow", visibility: "secret" });
    expect(gm.people.find((p) => p.id === "marcus_delgado")?.place).toEqual({ id: "birch_lane_12", name: BIRCH, visibility: "secret" });
  });

  test("people_find narrows by part of a name, a kind and a place", async () => {
    const { rig, chatId } = await chat();
    const names = async (knowledge: "everyone", args: JsonObject): Promise<string[]> => (await answerOf<{ people: Found[] }>(rig, chatId, knowledge, "people_find", args)).people.map((p) => p.name);
    expect(await names("everyone", { name: "KOWAL" })).toEqual(["Helen Kowalczyk", "Jess Kowalczyk", "Maddie Kowalczyk"]);
    const robot = await callTool(rig, chatId, "everyone", "people_find", { kind: "robot" });
    expect(robot.error).toBe(true);
    expect(robot.text).toContain("people_find doesn't take robot as kind");
    expect(await names("everyone", { place: "Port Alder" })).toEqual(expect.arrayContaining(["Dale Whitcomb", "Marcus Delgado", "Priya Nair", VEX_MARKED]));
  });

  test("people_where: Marcus, away at his secret house, is there, the house marked under everyone's knowledge", async () => {
    const { rig, chatId } = await chat();
    const everyone = await answerOf<Where>(rig, chatId, "everyone", "people_where", { person: "marcus_delgado" });
    expect(everyone.place).toEqual({ id: "birch_lane_12", name: BIRCH_MARKED });
    expect(everyone.path?.map((p) => p.name)).toEqual(["Lakeshore County", "Port Alder"]);
    expect(everyone.together).toBe(false);
    expect((await answerOf<Where>(rig, chatId, "everyone", "people_where", { person: "Danny Okafor" })).together).toBe(true);

    const gm = await answerOf<Where>(rig, chatId, "gm", "people_where", { person: "Marcus Delgado" });
    expect(gm.place).toEqual({ id: "birch_lane_12", name: BIRCH, visibility: "secret" });
    expect(typeof gm.doing).toBe("string");
  });

  test("someone who parted from the player character is where they went, not with it", async () => {
    const { rig, chatId } = await alderChat();
    await recordFix(rig, chatId, "fix_danny_to_work", [{ type: "set", entity: "danny_okafor", field: "place", value: "alder_automotive" }]);
    const everyone = await answerOf<Where>(rig, chatId, "everyone", "people_where", { person: "Danny Okafor" });
    expect(everyone.place).toEqual({ id: "alder_automotive", name: "Alder Automotive" });
    expect(everyone.together).toBe(false);
  });

  test("a hidden person is marked under everyone's knowledge, secret under the GM's", async () => {
    const { rig, chatId } = await chat();
    const everyone = await answerOf<Where>(rig, chatId, "everyone", "people_where", { person: "Vex Morrow" });
    expect(everyone.person).toEqual({ id: "vex_morrow", name: VEX_MARKED });
    expect(everyone.place).toEqual(HOME_REF);
    expect(everyone.together).toBe(true);

    const gm = await answerOf<Where>(rig, chatId, "gm", "people_where", { person: "Vex Morrow" });
    expect(gm.person).toEqual({ id: "vex_morrow", name: "Vex Morrow", visibility: "secret" });
  });

  test("people_sheet: the GM's Character sheet marked or whole, and the lore about them", async () => {
    const { rig, chatId } = await chat();
    for (const knowledge of KNOWLEDGE) expect((await answerOf<Sheet>(rig, chatId, knowledge, "people_sheet", { person: "Danny Okafor" })).person.id).toBe("danny_okafor");

    const everyone = await answerOf<Sheet>(rig, chatId, "everyone", "people_sheet", { person: "Marcus Delgado" });
    expect(everyone.place).toEqual({ id: "birch_lane_12", name: BIRCH_MARKED });
    expect(everyone.fields?.find((f) => f.id === "home")?.value).toEqual({ id: "birch_lane_12", name: BIRCH_MARKED });
    expect(everyone.relations.filter((r) => r.type === "regard").map((r) => r.to.id)).toEqual(expect.arrayContaining(["danny_okafor", "priya_nair", "dale_whitcomb", POV]));

    const gm = await answerOf<Sheet>(rig, chatId, "gm", "people_sheet", { person: "Marcus Delgado" });
    expect(gm.place).toEqual({ id: "birch_lane_12", name: BIRCH, visibility: "secret" });
    expect(gm.agent).toBe(true);
    expect(gm.schedules?.length).toBeGreaterThan(0);
    expect(gm.lore.map((l) => l.id)).toContain("lore_marcus");
  });

  test("people_regard: every regard, axis by axis", async () => {
    const { rig, chatId } = await chat();
    const everyone = await answerOf<RegardRead>(rig, chatId, "everyone", "people_regard", { person: "Danny Okafor" });
    expect(everyone.regard.map((r) => r.toward.name)).toEqual(["Dale Whitcomb", "Jess Kowalczyk", "Jordan Ellis", "Marcus Delgado", "Priya Nair"]);
    for (const r of everyone.regard) expect(r.axes.map((a) => a.axis)).toEqual(["Warmth", "Trust", "Respect"]);

    const gm = await answerOf<RegardRead>(rig, chatId, "gm", "people_regard", { person: "Danny Okafor", toward: "Marcus Delgado" });
    expect(gm.regard.map((r) => r.toward.id)).toEqual(["marcus_delgado"]);
    expect(gm.regard[0]?.words).toBe("warm");
  });
});

// The people tools on Port Alder (INC1-SPEC R3a): who there is, one person's sheet, where someone is
// and how someone regards others, under each knowledge. The player character's reads as Play:
// someone away only where and when it last saw them, and never Marcus's house (a secret place), Vex
// Morrow (a person no one may see) or another's mind; everyone's marks each restricted thing in the
// user's wording; the GM's reads everything, with its visibility and the GM's own data.

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
/** What the player character's knowledge answers to another's mind. */
const BEYOND = "Jordan Ellis doesn't know that, and you read the world as Jordan Ellis knows it.";

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
  test("people_find lists everyone each knowledge may name, each where it knows them to be", async () => {
    const { rig, chatId } = await chat();
    const pov = await answerOf<{ people: Found[] }>(rig, chatId, "pov", "people_find");
    expect(pov.people.map((p) => p.name)).toEqual(["Dale Whitcomb", "Danny Okafor", "Helen Kowalczyk", "Jess Kowalczyk", "Jordan Ellis", "Maddie Kowalczyk", "Marcus Delgado", "Nora Whitfield", "Priya Nair", "Sam Reyes"]);
    expect(pov.people.find((p) => p.id === "danny_okafor")).toEqual({ id: "danny_okafor", name: "Danny Okafor", kind: "character", place: HOME_REF });
    // Marcus is away and the player character hasn't seen him since the story began: nothing of where he is.
    expect(pov.people.find((p) => p.id === "marcus_delgado")).toEqual({ id: "marcus_delgado", name: "Marcus Delgado", kind: "character" });
    const povText = (await callTool(rig, chatId, "pov", "people_find")).text;
    expect(povText).not.toContain("Vex");
    expect(povText).not.toContain("Birch");

    const everyone = await answerOf<{ people: Found[] }>(rig, chatId, "everyone", "people_find");
    expect(everyone.people.find((p) => p.id === "vex_morrow")).toEqual({ id: "vex_morrow", name: VEX_MARKED, kind: "character", place: HOME_REF });
    expect(everyone.people.find((p) => p.id === "marcus_delgado")?.place).toEqual({ id: "birch_lane_12", name: BIRCH_MARKED });

    const gm = await answerOf<{ people: Found[] }>(rig, chatId, "gm", "people_find");
    expect(gm.people.find((p) => p.id === "vex_morrow")).toMatchObject({ name: "Vex Morrow", visibility: "secret" });
    expect(gm.people.find((p) => p.id === "marcus_delgado")?.place).toEqual({ id: "birch_lane_12", name: BIRCH, visibility: "secret" });
  });

  test("people_find narrows by part of a name, a kind and a place, a place by what the knowledge knows of where people are", async () => {
    const { rig, chatId } = await chat();
    const names = async (knowledge: "pov" | "everyone", args: JsonObject): Promise<string[]> => (await answerOf<{ people: Found[] }>(rig, chatId, knowledge, "people_find", args)).people.map((p) => p.name);
    expect(await names("pov", { name: "KOWAL" })).toEqual(["Helen Kowalczyk", "Jess Kowalczyk", "Maddie Kowalczyk"]);
    expect(await names("pov", { kind: "character" })).toHaveLength(10);
    const robot = await callTool(rig, chatId, "pov", "people_find", { kind: "robot" });
    expect(robot.error).toBe(true);
    expect(robot.text).toContain("people_find doesn't take robot as kind");
    // In Port Alder as the player character knows it: those with it at 114 Harbor Street; where the rest are it doesn't know.
    expect(await names("pov", { place: "Port Alder" })).toEqual(["Danny Okafor", "Helen Kowalczyk", "Jess Kowalczyk", "Jordan Ellis", "Maddie Kowalczyk"]);
    expect(await names("everyone", { place: "Port Alder" })).toEqual(expect.arrayContaining(["Dale Whitcomb", "Marcus Delgado", "Priya Nair", VEX_MARKED]));
    expect(await callTool(rig, chatId, "pov", "people_find", { place: BIRCH })).toEqual({ text: `No such place here: ${BIRCH}.`, error: true });
  });

  test("people_where: someone with the player character is where they are; Marcus, away at his secret house, is only not with it", async () => {
    const { rig, chatId } = await chat();
    const danny = await answerOf<Where>(rig, chatId, "pov", "people_where", { person: "Danny" });
    expect(danny).toMatchObject({ person: { id: "danny_okafor", name: "Danny Okafor" }, here: true, place: HOME_REF });
    expect(typeof danny.doing).toBe("string");

    const marcus = await callTool(rig, chatId, "pov", "people_where", { person: "Marcus Delgado" });
    expect(JSON.parse(marcus.text)).toEqual({ person: { id: "marcus_delgado", name: "Marcus Delgado" }, here: false });
    expect(marcus.text).not.toContain("Birch");

    const everyone = await answerOf<Where>(rig, chatId, "everyone", "people_where", { person: "marcus_delgado" });
    expect(everyone.place).toEqual({ id: "birch_lane_12", name: BIRCH_MARKED });
    expect(everyone.path?.map((p) => p.name)).toEqual(["Lakeshore County", "Port Alder"]);
    expect(everyone.together).toBe(false);
    expect((await answerOf<Where>(rig, chatId, "everyone", "people_where", { person: "Danny Okafor" })).together).toBe(true);

    const gm = await answerOf<Where>(rig, chatId, "gm", "people_where", { person: "Marcus Delgado" });
    expect(gm.place).toEqual({ id: "birch_lane_12", name: BIRCH, visibility: "secret" });
    expect(typeof gm.doing).toBe("string");
  });

  test("someone who parted from the player character is only where and when it last saw them", async () => {
    const { rig, chatId } = await alderChat();
    await recordFix(rig, chatId, "fix_danny_to_work", [{ type: "set", entity: "danny_okafor", field: "place", value: "alder_automotive" }]);
    const out = await callTool(rig, chatId, "pov", "people_where", { person: "Danny Okafor" });
    const pov = JSON.parse(out.text) as Where;
    expect(pov.here).toBe(false);
    expect(pov.lastSeen?.place).toEqual(HOME_REF);
    expect(typeof pov.lastSeen?.at).toBe("string");
    expect(pov.place).toBeUndefined();
    expect(pov.doing).toBeUndefined();
    expect(out.text).not.toContain("Alder Automotive");

    const everyone = await answerOf<Where>(rig, chatId, "everyone", "people_where", { person: "Danny Okafor" });
    expect(everyone.place).toEqual({ id: "alder_automotive", name: "Alder Automotive" });
    expect(everyone.together).toBe(false);
  });

  test("a hidden person is no one under the player character's knowledge, marked under everyone's, secret under the GM's", async () => {
    const { rig, chatId } = await chat();
    expect(await callTool(rig, chatId, "pov", "people_where", { person: "Vex Morrow" })).toEqual({ text: "No such person here: Vex Morrow.", error: true });
    expect(await callTool(rig, chatId, "pov", "people_sheet", { person: "vex_morrow" })).toEqual({ text: "No such person here: vex_morrow.", error: true });

    const everyone = await answerOf<Where>(rig, chatId, "everyone", "people_where", { person: "Vex Morrow" });
    expect(everyone.person).toEqual({ id: "vex_morrow", name: VEX_MARKED });
    expect(everyone.place).toEqual(HOME_REF);
    expect(everyone.together).toBe(true);

    const gm = await answerOf<Where>(rig, chatId, "gm", "people_where", { person: "Vex Morrow" });
    expect(gm.person).toEqual({ id: "vex_morrow", name: "Vex Morrow", visibility: "secret" });
  });

  test("people_sheet: what the player character may see of someone, the GM's Character sheet marked or whole, and the lore about them", async () => {
    const { rig, chatId } = await chat();
    for (const knowledge of KNOWLEDGE) expect((await answerOf<Sheet>(rig, chatId, knowledge, "people_sheet", { person: "Danny Okafor" })).person.id).toBe("danny_okafor");

    const danny = await answerOf<Sheet>(rig, chatId, "pov", "people_sheet", { person: "Danny Okafor" });
    expect(danny.kind).toEqual({ id: "character", label: "Character" });
    expect(danny.details).toEqual(expect.arrayContaining(["age 31", "home 114 Harbor Street"]));
    // What he is doing is told as Cast tells it, never as a detail; his regard only toward the player character.
    expect(danny.details?.some((d) => d.startsWith("activity"))).toBe(false);
    expect(danny.relations.filter((r) => r.type === "regard").map((r) => r.to.id)).toEqual([POV]);
    expect(danny.lore.map((l) => l.id)).toContain("lore_danny");

    const marcus = await callTool(rig, chatId, "pov", "people_sheet", { person: "Marcus Delgado" });
    expect(marcus.text).not.toContain("Birch");
    expect(marcus.text).not.toContain("birch_lane_12");

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

  test("people_regard: under the player character's knowledge only regard toward it, or its own; under the others every regard, axis by axis", async () => {
    const { rig, chatId } = await chat();
    const pov = await answerOf<RegardRead>(rig, chatId, "pov", "people_regard", { person: "Danny Okafor" });
    expect(pov.regard.map((r) => r.toward)).toEqual([{ id: POV, name: "Jordan Ellis" }]);
    expect(pov.regard[0]?.words).toBe("warm");
    expect(await callTool(rig, chatId, "pov", "people_regard", { person: "Danny Okafor", toward: "Marcus Delgado" })).toEqual({ text: BEYOND, error: true });
    // Jordan regards no one yet.
    expect((await answerOf<RegardRead>(rig, chatId, "pov", "people_regard", { person: "Jordan Ellis" })).regard).toEqual([]);

    const everyone = await answerOf<RegardRead>(rig, chatId, "everyone", "people_regard", { person: "Danny Okafor" });
    expect(everyone.regard.map((r) => r.toward.name)).toEqual(["Dale Whitcomb", "Jess Kowalczyk", "Jordan Ellis", "Marcus Delgado", "Priya Nair"]);
    for (const r of everyone.regard) expect(r.axes.map((a) => a.axis)).toEqual(["Warmth", "Trust", "Respect"]);

    const gm = await answerOf<RegardRead>(rig, chatId, "gm", "people_regard", { person: "Danny Okafor", toward: "Marcus Delgado" });
    expect(gm.regard.map((r) => r.toward.id)).toEqual(["marcus_delgado"]);
    expect(gm.regard[0]?.words).toBe("warm");
  });
});

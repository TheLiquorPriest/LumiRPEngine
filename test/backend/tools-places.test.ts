// The places tools on Port Alder (INC1-SPEC R3a): a place read whole, who and what is at a place, and
// the way between two places, under each knowledge. The player character's never names Marcus's house
// (a secret place) nor Vex Morrow (a person no one may see), and knows who and what is at a place
// only where it stands; everyone's marks each restricted thing in the user's wording; the GM's reads
// everything with its visibility. World Info about a place is marked, or left out, by the knowledge.

import { describe, expect, test } from "bun:test";
import { STARTER_WORLDS } from "../../src/packs/index";
import type { AgentKnowledge } from "../../src/shared/agent-tools";
import type { JsonObject } from "../../src/shared/json";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import type { WorldDoc } from "../../src/shared/world";
import type { Rig } from "../support/rig";
import { agentTools, alderChat, answerOf, attachBook, bookEntry, callTool, HOME, lreFields } from "../support/tools";

const PORT_ALDER = (STARTER_WORLDS["modern_slice_of_life"] as (id: string, name: string) => WorldDoc)("w", "Port Alder");
/** A person no one may see, at the player character's home: a test's own, never Port Alder's. */
const VEX: JsonObject = { id: "vex_morrow", kind: "character", name: "Vex Morrow", tier: "background", visibility: "secret", fields: { place: HOME }, relations: [] };
const VEX_MARKED = secretMarkText("Vex Morrow", [], "everyone", SECRET_MARK_WORDING);
/** Marcus's house: a secret place, which no one sees, not even from inside. */
const BIRCH = "12 Birch Lane";
const BIRCH_MARKED = secretMarkText(BIRCH, [], "everyone", SECRET_MARK_WORDING);
const BIRCH_DESCRIPTION = String(PORT_ALDER.places.birch_lane_12?.fields.description ?? "").trim();
const HOME_REF = { id: HOME, name: "114 Harbor Street" };
const SHOP_REF = { id: "alder_automotive", name: "Alder Automotive" };
/** What the player character's knowledge answers about a place it isn't at. */
const BEYOND = "Jordan Ellis doesn't know that, and you read the world as Jordan Ellis knows it.";

const FERRY = "FERRY-MARK: the ferry runs twice a day.";
const DEBT = "DEBT-MARK: Marcus owes the marina three months of slip fees.";
const WRECK = "WRECK-MARK: the old boat went down with the marina's records aboard.";
const DOCK = "DOCK-MARK: the dock is stone.";
const SEEN = "SEEN-MARK: Jordan saw the boat go down from the breakwater.";

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

interface PlaceRead {
  place: Ref;
  path: Ref[];
  description?: string;
  inside: Ref[];
  waysOut: { place: Ref; minutes?: number }[];
  lore: { id: string; title: string; text: string; secret?: true }[];
}

interface Contents {
  place: Ref;
  people: (Ref & { place?: Shown; doing?: string })[];
  things: (Ref & { kind: string })[];
}

interface RouteRead {
  from: Shown;
  to: Shown;
  routes: { mode: string; minutes: number; distanceKm: number; legs: { from: Shown; to: Shown; minutes: number }[] }[];
  none?: string[];
}

let shared: Promise<{ rig: Rig; chatId: string }> | null = null;

/** One Port Alder chat for the tests that only read, with Vex Morrow at the player character's home. */
function chat(): Promise<{ rig: Rig; chatId: string }> {
  shared ??= alderChat({ put: { entities: { vex_morrow: VEX } } });
  return shared;
}

describe("the places tools on Port Alder", () => {
  test("places_read: where a place sits, what it is, the places inside it and the ways out, as each knowledge sees them", async () => {
    const { rig, chatId } = await chat();
    const shop = await answerOf<PlaceRead>(rig, chatId, "pov", "places_read", { place: "Alder Automotive" });
    expect(shop.place).toEqual(SHOP_REF);
    expect(shop.path.map((p) => p.name)).toEqual(["Lakeshore County", "Port Alder"]);
    expect(shop.description).toContain("A three-bay repair shop");
    // A route runs from the shop to Marcus's house too: not a way out the player character knows of.
    expect(shop.waysOut.map((w) => w.place.id)).toEqual(["harbor_street_114", "shoreline_fuel"]);
    for (const w of shop.waysOut) expect(typeof w.minutes).toBe("number");
    expect(shop.lore.map((l) => l.id)).toContain("lore_shop");
    expect((await callTool(rig, chatId, "pov", "places_read", { place: "Alder Automotive" })).text).not.toContain("Birch");

    const everyone = await answerOf<PlaceRead>(rig, chatId, "everyone", "places_read", { place: "alder_automotive" });
    expect(everyone.waysOut.map((w) => w.place.name)).toContain(BIRCH_MARKED);
    const gm = await answerOf<PlaceRead>(rig, chatId, "gm", "places_read", { place: "alder_automotive" });
    expect(gm.waysOut.map((w) => w.place)).toContainEqual({ id: "birch_lane_12", name: BIRCH, visibility: "secret" });

    // Port Alder holds Marcus's house: only everyone's knowledge and the GM's have it among the places inside.
    const town = await callTool(rig, chatId, "pov", "places_read", { place: "Port Alder" });
    expect((JSON.parse(town.text) as PlaceRead).inside.map((p) => p.name)).toEqual(expect.arrayContaining(["114 Harbor Street", "Alder Automotive", "Alder Harbor Marina"]));
    expect(town.text).not.toContain("Birch");
    expect((await answerOf<PlaceRead>(rig, chatId, "everyone", "places_read", { place: "Port Alder" })).inside.map((p) => p.name)).toContain(BIRCH_MARKED);

    expect(await callTool(rig, chatId, "pov", "places_read", { place: BIRCH })).toEqual({ text: `No such place here: ${BIRCH}.`, error: true });
    const house = await answerOf<PlaceRead>(rig, chatId, "everyone", "places_read", { place: BIRCH });
    expect(house.place).toEqual({ id: "birch_lane_12", name: BIRCH_MARKED });
    expect(house.description).toBe(secretMarkText(BIRCH_DESCRIPTION, [], "everyone", SECRET_MARK_WORDING));
  });

  test("World Info about a place is told as each knowledge reads it: a secret marked with who knows it, or left out", async () => {
    const { rig, chatId } = await alderChat();
    const about = { extensions: lreFields({ links: [HOME] }) };
    await attachBook(rig, chatId, "Harbor notes", [
      bookEntry("The ferry", `${FERRY}\n{{// Secret (known to Marcus): ${DEBT}}}`, about),
      bookEntry("The wreck", `{{// Secret: ${WRECK}}}`, about),
      bookEntry("The dock", `${DOCK}\n{{// Secret (known to Jordan): ${SEEN}}}`, about),
    ]);
    const lore = async (knowledge: AgentKnowledge): Promise<PlaceRead["lore"]> => (await answerOf<PlaceRead>(rig, chatId, knowledge, "places_read", { place: HOME })).lore;

    // The player character reads what anyone may, and its own secret; Marcus's and the wreck's are left out.
    const pov = (await lore("pov")).map((l) => l.text).join("\n");
    for (const told of [FERRY, DOCK, SEEN]) expect(pov).toContain(told);
    for (const kept of [DEBT, WRECK]) expect(pov).not.toContain(kept);

    const everyone = (await lore("everyone")).map((l) => l.text);
    expect(everyone).toContain(secretMarkText(DEBT, ["Marcus Delgado"], "everyone", SECRET_MARK_WORDING));
    expect(everyone).toContain(secretMarkText(WRECK, [], "everyone", SECRET_MARK_WORDING));
    expect(everyone).toContain(secretMarkText(SEEN, ["Jordan Ellis"], "everyone", SECRET_MARK_WORDING));
    expect(everyone.some((t) => t.includes(FERRY))).toBe(true);

    const gm = await lore("gm");
    for (const secret of [DEBT, WRECK, SEEN]) expect(gm.find((l) => l.text === secret)).toMatchObject({ secret: true });
    for (const plain of [FERRY, DOCK]) expect(gm.some((l) => l.text.includes(plain) && l.secret === undefined)).toBe(true);
  });

  test("places_contents: who and what is at a place now; the player character knows it only where it stands", async () => {
    const { rig, chatId } = await chat();
    const home = await callTool(rig, chatId, "pov", "places_contents", { place: HOME });
    const pov = JSON.parse(home.text) as Contents;
    expect(pov.people.map((p) => p.name)).toEqual(["Danny Okafor", "Helen Kowalczyk", "Jess Kowalczyk", "Jordan Ellis", "Maddie Kowalczyk"]);
    for (const p of pov.people) expect(p.place).toEqual(HOME_REF);
    // Jordan's pickup is parked outside; nothing of Vex Morrow, standing right there.
    expect(pov.things.map((t) => t.id)).toContain("pov_truck");
    expect(home.text).not.toContain("Vex");
    expect(await callTool(rig, chatId, "pov", "places_contents", { place: "Alder Automotive" })).toEqual({ text: BEYOND, error: true });
    // Inside Port Alder the player character sees those with it, and nothing lying loose in the town itself.
    const town = await answerOf<Contents>(rig, chatId, "pov", "places_contents", { place: "Port Alder" });
    expect(town.people.map((p) => p.id)).toEqual(pov.people.map((p) => p.id));
    expect(town.things).toEqual([]);

    const everyone = await answerOf<Contents>(rig, chatId, "everyone", "places_contents", { place: HOME });
    expect(everyone.people.find((p) => p.id === "vex_morrow")).toMatchObject({ name: VEX_MARKED, place: HOME_REF });
    const gm = await answerOf<Contents>(rig, chatId, "gm", "places_contents", { place: HOME });
    expect(gm.people.find((p) => p.id === "vex_morrow")).toMatchObject({ name: "Vex Morrow", visibility: "secret" });

    const shop = await answerOf<Contents>(rig, chatId, "everyone", "places_contents", { place: "Alder Automotive" });
    expect(shop.things.map((t) => t.id)).toEqual(expect.arrayContaining(["fleet_contract_draft", "pov_toolbox", "spare_relay"]));
    const all = await answerOf<Contents>(rig, chatId, "everyone", "places_contents", { place: "Port Alder" });
    expect(all.people.find((p) => p.id === "marcus_delgado")?.place).toEqual({ id: "birch_lane_12", name: BIRCH_MARKED });
    expect(all.people.find((p) => p.id === "priya_nair")?.place).toEqual({ id: "port_alder", name: "Port Alder" });
  });

  test("places_route: each way of travelling from where the player character is, or only the one named", async () => {
    const { rig, chatId } = await chat();
    const pov = await answerOf<RouteRead>(rig, chatId, "pov", "places_route", { to: "Alder Automotive" });
    expect(pov.from).toEqual(HOME_REF);
    expect(pov.to).toEqual(SHOP_REF);
    const walk = pov.routes.find((r) => r.mode === "walk");
    const road = pov.routes.find((r) => r.mode === "road");
    expect(walk?.legs.at(-1)?.to).toEqual(SHOP_REF);
    expect(walk !== undefined && road !== undefined && road.minutes < walk.minutes).toBe(true);
    expect(pov.none).toContain("water");
    expect((await answerOf<RouteRead>(rig, chatId, "pov", "places_route", { to: "Alder Automotive", mode: "walk" })).routes.map((r) => r.mode)).toEqual(["walk"]);
    expect(await callTool(rig, chatId, "pov", "places_route", { to: "Alder Automotive", mode: "boat" })).toEqual({ text: "places_route doesn't take boat as mode; it takes one of: walk, road, offroad, water.", error: true });
    expect(await callTool(rig, chatId, "pov", "places_route", { to: BIRCH })).toEqual({ text: `No such place here: ${BIRCH}.`, error: true });

    const everyone = await answerOf<RouteRead>(rig, chatId, "everyone", "places_route", { to: "birch_lane_12", from: "Alder Automotive", mode: "walk" });
    expect(everyone.from).toEqual(SHOP_REF);
    expect(everyone.to).toEqual({ id: "birch_lane_12", name: BIRCH_MARKED });
    expect(everyone.routes).toHaveLength(1);
    const gm = await answerOf<RouteRead>(rig, chatId, "gm", "places_route", { to: BIRCH, from: "alder_automotive" });
    expect(gm.to).toEqual({ id: "birch_lane_12", name: BIRCH, visibility: "secret" });
    expect(gm.routes.find((r) => r.mode === "walk")?.legs.at(-1)?.to).toEqual({ id: "birch_lane_12", name: BIRCH, visibility: "secret" });
  });

  test("a place argument names no place under the player character's knowledge, and every place under the GM's", async () => {
    const { rig, chatId } = await chat();
    for (const name of ["places_read", "places_contents", "places_route"]) {
      const pov = (await agentTools(rig, chatId, "pov")).find((t) => t.name === name);
      const gm = (await agentTools(rig, chatId, "gm")).find((t) => t.name === name);
      expect(JSON.stringify(pov?.parameters)).not.toContain("birch_lane_12");
      expect(JSON.stringify(gm?.parameters)).toContain("birch_lane_12");
    }
  });
});

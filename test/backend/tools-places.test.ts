// The places tools on Port Alder (INC1-SPEC R3a): a place read whole, who and what is at a place, and
// the way between two places, under each view. Everyone's names Marcus's house (a secret place) and
// Vex Morrow (a person no one may see), each marked in the user's wording; the GM's reads everything
// with its visibility. World Info about a place is marked by the view, never left out.

import { describe, expect, test } from "bun:test";
import { STARTER_WORLDS } from "../../src/packs/index";
import type { ToolView } from "../../src/shared/agent-tools";
import type { JsonObject } from "../../src/shared/json";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import type { WorldDoc } from "../../src/shared/world";
import type { Rig } from "../support/rig";
import { agentTools, alderChat, answerOf, attachBook, bookEntry, callTool, HOME, KNOWLEDGE, lreFields } from "../support/tools";

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
  test("places_read: where a place sits, what it is, the places inside it and the ways out, a secret marked or with its visibility", async () => {
    const { rig, chatId } = await chat();
    const shop = await answerOf<PlaceRead>(rig, chatId, "everyone", "places_read", { place: "Alder Automotive" });
    expect(shop.place).toEqual(SHOP_REF);
    expect(shop.path.map((p) => p.name)).toEqual(["Lakeshore County", "Port Alder"]);
    expect(shop.description).toContain("A three-bay repair shop");
    for (const w of shop.waysOut) expect(typeof w.minutes).toBe("number");
    expect(shop.lore.map((l) => l.id)).toContain("lore_shop");

    const everyone = await answerOf<PlaceRead>(rig, chatId, "everyone", "places_read", { place: "alder_automotive" });
    expect(everyone.waysOut.map((w) => w.place.name)).toContain(BIRCH_MARKED);
    const gm = await answerOf<PlaceRead>(rig, chatId, "gm", "places_read", { place: "alder_automotive" });
    expect(gm.waysOut.map((w) => w.place)).toContainEqual({ id: "birch_lane_12", name: BIRCH, visibility: "secret" });

    // Port Alder holds Marcus's house, marked as kept from everyone.
    expect((await answerOf<PlaceRead>(rig, chatId, "everyone", "places_read", { place: "Port Alder" })).inside.map((p) => p.name)).toContain(BIRCH_MARKED);

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
    const lore = async (knowledge: ToolView): Promise<PlaceRead["lore"]> => (await answerOf<PlaceRead>(rig, chatId, knowledge, "places_read", { place: HOME })).lore;

    const everyone = (await lore("everyone")).map((l) => l.text);
    expect(everyone).toContain(secretMarkText(DEBT, ["Marcus Delgado"], "everyone", SECRET_MARK_WORDING));
    expect(everyone).toContain(secretMarkText(WRECK, [], "everyone", SECRET_MARK_WORDING));
    expect(everyone).toContain(secretMarkText(SEEN, ["Jordan Ellis"], "everyone", SECRET_MARK_WORDING));
    expect(everyone.some((t) => t.includes(FERRY))).toBe(true);

    const gm = await lore("gm");
    for (const secret of [DEBT, WRECK, SEEN]) expect(gm.find((l) => l.text === secret)).toMatchObject({ secret: true });
    for (const plain of [FERRY, DOCK]) expect(gm.some((l) => l.text.includes(plain) && l.secret === undefined)).toBe(true);
  });

  test("places_contents: who and what is at a place now, a secret marked or with its visibility", async () => {
    const { rig, chatId } = await chat();
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
    const route = await answerOf<RouteRead>(rig, chatId, "everyone", "places_route", { to: "Alder Automotive" });
    expect(route.from).toEqual(HOME_REF);
    expect(route.to).toEqual(SHOP_REF);
    const walk = route.routes.find((r) => r.mode === "walk");
    const road = route.routes.find((r) => r.mode === "road");
    expect(walk?.legs.at(-1)?.to).toEqual(SHOP_REF);
    expect(walk !== undefined && road !== undefined && road.minutes < walk.minutes).toBe(true);
    expect(route.none).toContain("water");
    expect((await answerOf<RouteRead>(rig, chatId, "everyone", "places_route", { to: "Alder Automotive", mode: "walk" })).routes.map((r) => r.mode)).toEqual(["walk"]);
    expect(await callTool(rig, chatId, "everyone", "places_route", { to: "Alder Automotive", mode: "boat" })).toEqual({ text: "places_route doesn't take boat as mode; it takes one of: walk, road, offroad, water.", error: true });

    const everyone = await answerOf<RouteRead>(rig, chatId, "everyone", "places_route", { to: "birch_lane_12", from: "Alder Automotive", mode: "walk" });
    expect(everyone.from).toEqual(SHOP_REF);
    expect(everyone.to).toEqual({ id: "birch_lane_12", name: BIRCH_MARKED });
    expect(everyone.routes).toHaveLength(1);
    const gm = await answerOf<RouteRead>(rig, chatId, "gm", "places_route", { to: BIRCH, from: "alder_automotive" });
    expect(gm.to).toEqual({ id: "birch_lane_12", name: BIRCH, visibility: "secret" });
    expect(gm.routes.find((r) => r.mode === "walk")?.legs.at(-1)?.to).toEqual({ id: "birch_lane_12", name: BIRCH, visibility: "secret" });
  });

  test("a place argument names every place, a secret one too, under everyone's knowledge and the GM's", async () => {
    const { rig, chatId } = await chat();
    for (const name of ["places_read", "places_contents", "places_route"]) {
      for (const knowledge of KNOWLEDGE) expect(JSON.stringify((await agentTools(rig, chatId, knowledge)).find((t) => t.name === name)?.parameters)).toContain("birch_lane_12");
    }
  });
});

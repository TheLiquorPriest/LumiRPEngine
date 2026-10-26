// The turn's actions as the narrator is told them (DESIGN §6.2 Outcome, the Outline's beats), on Port
// Alder: each names what it was about, where it started, the time it took and what it changed, in the
// player's words, so the reply can't have the player character still about to do what the engine played.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import type { JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";

/** Port Alder's player character. */
const POV = "pov";

const INTERPRET_MARK = "You map a player's typed input";
const TYPED = "I take the letter from Marcus, fold it into my jacket, and tell him I'll walk over to Bluebird Coffee and get us both a coffee.";
/** The message read as Take, Go to and Buy, in that order. */
const READ: JsonObject = { action: "take", params: { item: "unsigned_letter" }, confidence: 0.9, more: [{ action: "go", params: { to: "bluebird_coffee" }, text: "I walk over to Bluebird Coffee" }, { action: "buy", params: { item: "coffee", qty: 2 }, text: "get us both a coffee" }] };
/** Port Alder's puzzle of the township pickup, "The truck that won't start". */
const TRUCK = "p_township_truck";

/**
 * A Port Alder chat with the player character and `holder` at Alder Automotive, `holder` carrying
 * the unsigned letter; Vex Morrow is someone the POV can't see (unless `world.vex` is false), and
 * `world.puts` adds more. With `truckOpen` the truck puzzle is one the player knows of.
 */
async function atTheShop(holder: "marcus_delgado" | "vex_morrow", truckOpen = false, world: { vex?: boolean; puts?: [string, JsonObject][] } = {}): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const put = async (collection: string, id: string, value: JsonObject): Promise<void> => {
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection, id, value }));
  };
  const { draft } = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })) as { draft: { pov: string; entities: Record<string, JsonObject & { fields: JsonObject }>; tracks: Record<string, JsonObject> } };
  for (const id of [draft.pov, "marcus_delgado"]) {
    const e = draft.entities[id];
    if (!e) throw new Error(`no ${id}`);
    await put("entities", id, { ...e, fields: { ...e.fields, place: "alder_automotive" } });
  }
  if (world.vex ?? true) await put("entities", "vex_morrow", { id: "vex_morrow", kind: "character", name: "Vex Morrow", tier: "background", visibility: "secret", fields: { place: "alder_automotive" }, relations: [] });
  await put("entities", "unsigned_letter", { id: "unsigned_letter", kind: "item", name: "Unsigned letter", tier: "background", fields: { owner: holder }, relations: [{ type: "in", to: holder }] });
  if (truckOpen) await put("tracks", TRUCK, { ...draft.tracks[TRUCK], visibility: "public" });
  for (const [collection, value] of world.puts ?? []) await put(collection, String(value.id), value);
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify(READ) : "{}");
  return { rig, chatId };
}

const lines = (section: string): string[] => section.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
const IDS = ["unsigned_letter", "marcus_delgado", "bluebird_coffee", "alder_automotive", "vex_morrow"];

describe("the turn's actions in words (Outcome and Outline)", () => {
  test("a take, a walk and a buy each name the item and its giver, the places, the time and the amount, in order, with no id", async () => {
    const { rig, chatId } = await atTheShop("marcus_delgado");
    await rig.turn(chatId, TYPED, "You fold the letter away.");
    for (const section of ["Outcome", "Outline"]) {
      const told = lines(rig.host.section(section));
      const take = told.findIndex((l) => l.includes("Unsigned letter") && l.includes("Marcus Delgado"));
      const walk = told.findIndex((l) => l.includes("Alder Automotive") && l.includes("Bluebird Coffee") && /\d+ min/.test(l));
      const buy = told.findIndex((l) => /coffee/i.test(l) && /\$\d+\.\d\d/.test(l));
      expect(take).toBeGreaterThanOrEqual(0);
      expect(walk).toBeGreaterThan(take);
      expect(buy).toBeGreaterThan(walk);
      for (const id of IDS) expect(told.join("\n")).not.toContain(id);
    }
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("an action about someone the player character can't see never names them", async () => {
    const { rig, chatId } = await atTheShop("vex_morrow");
    await rig.turn(chatId, TYPED, "You fold the letter away.");
    for (const section of ["Outcome", "Outline"]) {
      const told = rig.host.section(section);
      expect(told).toContain("Unsigned letter");
      expect(told).not.toContain("Vex");
      expect(told).not.toContain("Morrow");
    }
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("an answer the read gave as someone the player character can't see is never told: the message didn't say it, so it is no answer", async () => {
    const { rig, chatId } = await atTheShop("marcus_delgado", true);
    rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify({ action: "answer", params: { puzzle: TRUCK, answer: "Vex Morrow" }, confidence: 0.9 }) : "{}");
    await rig.turn(chatId, "I give my answer: whoever was in the shop last night.", "Marcus wipes his hands and says nothing.");
    for (const section of ["Outcome", "Outline"]) expect(rig.host.section(section)).not.toMatch(/Answer \(|Vex|Morrow/);
    // The next reply is told the answer didn't happen, in words that still don't name them.
    rig.host.quietReply = () => "{}";
    await rig.turn(chatId, "I look around the shop.", "The shop is quiet.");
    const outcome = rig.host.section("Outcome");
    expect(outcome).toContain("doesn't say the answer itself");
    expect(outcome).not.toMatch(/Vex|Morrow/);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("the player's own answer is told the narrator as in a world without anyone hidden, or any secret entry, going by it", async () => {
    /** The Answer line of the Outcome and of the Outline once the player typed `typed`, read as answering `answer`. */
    const told = async (typed: string, answer: string, world: { vex?: boolean; puts?: [string, JsonObject][] }): Promise<string[]> => {
      const { rig, chatId } = await atTheShop("marcus_delgado", true, world);
      rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify({ action: "answer", params: { puzzle: TRUCK, answer }, confidence: 0.9 }) : "{}");
      await rig.turn(chatId, typed, "Marcus shakes his head.");
      return ["Outcome", "Outline"].map((section) => lines(rig.host.section(section)).find((l) => l.startsWith("Answer")) ?? "");
    };
    const vex = await told("I answer: Vex.", "Vex", { vex: false });
    for (const line of vex) expect(line).toContain("Vex");
    expect(await told("I answer: Vex.", "Vex", {})).toEqual(vex);
    // A secret entry whose key is the player's own word.
    const mill = { id: "mill_fire", title: "The fire at the old mill", content: "The mill fire was set for the insurance money.", keys: ["mill"], links: [], secret: true, gate: "false", audience: [] };
    const said = await told("I answer: the mill.", "the mill", { vex: false });
    for (const line of said) expect(line).toContain("the mill");
    expect(await told("I answer: the mill.", "the mill", { vex: false, puts: [["lore", mill]] })).toEqual(said);
  });

  test("arriving ends the walk, and the lines read as the narrator's own words: a count with its thing, whose routine comes next, no notation", async () => {
    const { rig, chatId } = await atTheShop("marcus_delgado");
    await rig.turn(chatId, TYPED, "You fold the letter away.");
    // State: once at Bluebird Coffee the player character isn't still travelling, and the walk's line doesn't say so.
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
    expect(state?.entities[POV]?.fields.activity).not.toBe("travel");
    const outcome = rig.host.section("Outcome");
    const outline = rig.host.section("Outline");
    for (const told of [outcome, outline]) {
      expect(told).not.toMatch(/travel/i);
      // Buy's count reads with what it counts.
      expect(told).toContain("2 coffees");
      expect(told).not.toMatch(/\bqty\b/i);
    }
    // No line, and not the section's lead, leans on notation the narrator must decode.
    expect(outcome).not.toContain("→");
    // The routine slot coming up (work at 07:00, the turn ending before it) says whose it is.
    const due = lines(outline).find((l) => l.includes("07:00"));
    expect(due).toMatch(/\byou\b/i);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

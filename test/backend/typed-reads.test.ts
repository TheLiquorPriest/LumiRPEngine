// Every typed message reaches `interpret` while its step is on (DESIGN §5.2): whether a message
// holds an action is the read's call, never a word list's. A message no list would have known plays
// as its action, a stage direction too, and a line of dialogue is read and answered as none. A
// world's step template saved on the retired `classifier` signal runs on every typed message.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { createRegistry } from "../../src/engine/registry-impl";
import { lintWorld, migrateWorld } from "../../src/engine/authoring";
import { placeOfEntity } from "../../src/engine/scope";
import type { JsonObject } from "../../src/shared/json";
import { ALL_PACKS } from "../../src/packs/index";
import { Rig } from "../support/rig";
import { baseWorld } from "../packs/support";

const INTERPRET_MARK = "You map a player's typed input";
const NONE: JsonObject = { action: null, params: {}, confidence: 0.9, reason: "no action" };

/** A Port Alder chat on the default settings, with a roof above the POV's building. */
async function alder(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "places", id: "harbor_roof", value: { id: "harbor_roof", name: "Roof", parent: "harbor_street_114", fields: {} } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId };
}

/** `interpret` answers `read(the typed text, its prompt)`; every other step reads nothing. Returns the interpret calls made. */
function reading(rig: Rig, read: (text: string, system: string) => JsonObject): QuietRequest[] {
  const asked: QuietRequest[] = [];
  rig.host.quietReply = (req: QuietRequest) => {
    const system = req.messages[0]?.content ?? "";
    if (!system.includes(INTERPRET_MARK)) return "{}";
    asked.push(req);
    return JSON.stringify(read(req.messages[1]?.content ?? "", system));
  };
  return asked;
}

async function povPlace(rig: Rig, chatId: string): Promise<string | null> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  return placeOfEntity(state, "pov");
}

describe("every typed message reaches interpret", () => {
  test("'I head up to the roof', in words no list knew, plays as the move", async () => {
    const { rig, chatId } = await alder();
    // The model finds the roof among the places it was given.
    const move: JsonObject = { action: "go", params: { to: "harbor_roof" }, confidence: 0.9 };
    const asked = reading(rig, (text, system) => (/\broof\b/i.test(text) && system.includes("harbor_roof") ? move : NONE));
    await rig.turn(chatId, "I head up to the roof.", "The tar paper is warm underfoot.");
    expect(asked).toHaveLength(1);
    expect(await povPlace(rig, chatId)).toBe("harbor_roof");
  });

  test("a stage direction gets its action", async () => {
    const { rig, chatId } = await alder();
    const move: JsonObject = { action: "go", params: { to: "bluebird_coffee" }, confidence: 0.9 };
    const asked = reading(rig, (text) => (text.includes("heads over to Bluebird") ? move : NONE));
    await rig.turn(chatId, "[Jordan heads over to Bluebird]", "The bell over the door jangles.");
    expect(asked).toHaveLength(1);
    expect(await povPlace(rig, chatId)).toBe("bluebird_coffee");
  });

  test("a line of dialogue is read too, and the read's none plays it as roleplay", async () => {
    const { rig, chatId } = await alder();
    const asked = reading(rig, () => ({ action: null, params: {}, confidence: 0.95, reason: "speech only" }));
    await rig.turn(chatId, "“Nice day, isn't it?”", "Marcus squints at the sky and shrugs.");
    expect(asked).toHaveLength(1);
    expect(await povPlace(rig, chatId)).toBe("harbor_street_114");
    const head = rig.host.head(chatId);
    const kinds = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === head?.id).map((c) => c.kind);
    expect(kinds).not.toContain("not_action");
    expect(kinds).not.toContain("read_failed");
    expect(kinds).not.toContain("decline");
  });
});

describe("a world saved while the classifier gated typed steps", () => {
  test("its step template's classifier signal reads as typed input, which lint knows", () => {
    const w = baseWorld();
    w.steps.tips = { id: "tips", purpose: "choices", template: "Suggest a next move.", output: "text", signals: ["classifier", "reply", "typed_input"] };
    w.steps.quiet = { id: "quiet", purpose: "brief", template: "Brief.", output: "text", signals: ["scene_change"] };
    const migrated = migrateWorld(w);
    expect(migrated.steps.tips?.signals).toEqual(["typed_input", "reply"]);
    expect(migrated.steps.quiet).toBe(w.steps.quiet);
    expect(lintWorld(migrated, createRegistry(ALL_PACKS)).filter((i) => i.code === "unknown_signal")).toEqual([]);
    // A world with nothing retired comes back as it was.
    expect(migrateWorld(migrated)).toBe(migrated);
  });
});

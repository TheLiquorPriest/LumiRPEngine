// The state view on live chats (fake host): a turn's change chip and Journal line list only what the
// fold applied, so an undone event, or one a rebased view dropped, isn't listed; the palette's picks.

import { describe, expect, test } from "bun:test";
import { fixRequest, paletteRequest } from "../../src/frontend/requests";
import type { FieldFixTarget, StateView } from "../../src/shared/state-view";
import { Rig } from "../support/rig";
import { toChain } from "../../src/backend/ledger-io";
import { POV } from "../support/test-pack";
import { turnLines } from "../../src/backend/view";
import { createRegistry } from "../../src/engine/registry-impl";
import { materializeAll } from "../../src/engine/materialize";
import { coarsen } from "../../src/engine/simulate";
import { runTimelapse } from "../../src/engine/time";
import { Working } from "../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { startState } from "../packs/support";

const EXTRACT_MARK = "propose concrete state changes";

/** Every line the turn's change chips show for `messageId`. */
function changeText(view: StateView, messageId: string): string {
  return view.chips
    .filter((c) => c.kind === "change" && c.messageId === messageId)
    .flatMap((c) => [c.label, c.detail ?? ""])
    .join("\n");
}

/** The Journal's turn entry for `messageId`. */
function noteText(view: StateView, messageId: string): string {
  return view.journal
    .filter((n) => n.kind === "note" && n.messageId === messageId)
    .map((n) => n.text)
    .join("\n");
}

describe("change chip and Journal list what applied", () => {
  test("a typed purchase undone with Not an action leaves no change chip or Journal line for it", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld("Gumballs");
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "actions", id: "gumball", value: { id: "gumball", label: "Buy a gumball", params: {}, requires: [], outcomes: { default: [{ type: "add", args: { entity: POV, field: "cash", delta: -25 } }] }, duration: "1", lexicon: ["gumball"] } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.host.quietReply = (req) => (req.messages[0]?.content.includes(EXTRACT_MARK) ? "{}" : JSON.stringify({ action: "gumball", params: {}, probabilities: { gumball: 1 } }));
    const before = Number(await rig.cashOf(chatId));
    await rig.turn(chatId, "I get a gumball from the machine.", "It rattles out.");
    const head = rig.host.head(chatId);
    if (!head) throw new Error("no reply");
    const bought = await rig.rt.view(chatId, rig.host.userId);
    expect(changeText(bought, head.id)).toContain("$0.25");
    expect(noteText(bought, head.id)).toContain("$0.25");
    const chip = bought.chips.find((c) => c.kind === "not_action");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip?.id, choice: "undo" }));
    expect(Number(await rig.cashOf(chatId))).toBe(before);
    const undone = await rig.rt.view(chatId, rig.host.userId);
    expect(changeText(undone, head.id)).not.toContain("$0.25");
    expect(noteText(undone, head.id)).not.toContain("$0.25");
    // The turn still took its minute.
    expect(undone.chips.some((c) => c.kind === "elapsed" && c.messageId === head.id)).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("an automatic read undone with its Undo chip leaves no change chip or Journal line for it", async () => {
    const rig = new Rig();
    rig.host.quietReply = (req) => (req.messages[0]?.content.includes(EXTRACT_MARK) ? JSON.stringify({ proposals: [{ type: "condition", entity: POV, field: "cash", delta: -40 }] }) : "{}");
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I pay the bus fare.", "You tap your fare and sit down.");
    const head = rig.host.head(chatId);
    if (!head) throw new Error("no reply");
    const read = await rig.rt.view(chatId, rig.host.userId);
    expect(changeText(read, head.id)).toContain("$0.40");
    expect(noteText(read, head.id)).toContain("$0.40");
    const undo = read.chips.find((c) => c.kind === "undo");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: undo?.id, choice: "undo" }));
    const undone = await rig.rt.view(chatId, rig.host.userId);
    expect(changeText(undone, head.id)).not.toContain("$0.40");
    expect(noteText(undone, head.id)).not.toContain("$0.40");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a rebased head whose purchase no longer fits lists no change for it, the Keep report does, and a conversion lists it again", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld("Payday");
    // Sam's wallet is an account he owns (so its postings are his to see); the test pack's guard keeps
    // an own account from going below zero.
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "kinds", id: "account", value: { id: "account", label: "Account", fields: { owner: { type: "text" } } } }));
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: "wallet", value: { id: "wallet", kind: "account", name: "Wallet", tier: "background", fields: { owner: POV }, relations: [] } }));
    const posting = (id: string, label: string, amount: number, memo: string) => ({ id, label, params: {}, requires: [], outcomes: { default: [{ type: "post", args: { lines: [{ account: "wallet", amount }, { account: `economy.external:${amount >= 0 ? "job" : "shop"}`, amount: -amount }], memo } }] }, duration: "1", lexicon: [id] });
    for (const action of [posting("deposit", "Deposit pay", 10000, "Payday"), posting("soda", "Buy a soda", -2000, "Bought a soda"), posting("tire", "Buy a tire", -9000, "Bought a tire")]) {
      rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "actions", id: action.id, value: action }));
    }
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const act = async (action: string, reply: string): Promise<string> => {
      rig.body(await rig.send({ type: "lre.action", chatId, action, params: {}, source: "palette" }));
      const g = await rig.host.start(chatId, { type: "normal" });
      await rig.host.finish(g, reply);
      const head = rig.host.head(chatId);
      if (!head) throw new Error("no reply");
      return head.id;
    };
    await act("deposit", "Payday.");
    const soda = await act("soda", "You buy a soda.");
    // The other swipe of that turn bought nothing; the tire is bought on it.
    rig.host.addSwipe(chatId, soda, "You walk past the machine.");
    await rig.host.settle();
    const tire = await act("tire", "You pay Marcus for the tire.");
    const made = await rig.rt.view(chatId, rig.host.userId);
    expect(changeText(made, tire)).toContain("Bought a tire");
    expect(noteText(made, tire)).toContain("Bought a tire");
    // Back to the soda: the tire no longer fits what is left, so the head's record drops it.
    rig.host.navigate(chatId, soda, 0);
    await rig.host.settle();
    const rebased = await rig.rt.view(chatId, rig.host.userId);
    const dropped = rebased.keepReport.find((k) => k.messageId === tire && k.status === "dropped");
    expect(dropped?.text).toContain("Bought a tire");
    expect(changeText(rebased, tire)).not.toContain("Bought a tire");
    expect(noteText(rebased, tire)).not.toContain("Bought a tire");
    // Converted to a manual adjustment, it applies on this branch after all, and is listed again.
    if (!dropped || "marker" in dropped.ref) throw new Error("no dropped purchase");
    rig.body(await rig.send({ type: "lre.keep", chatId, choice: "convert", messageId: tire, parentPath: dropped.parentPath, refs: [dropped.ref] }));
    const converted = await rig.rt.view(chatId, rig.host.userId);
    expect(converted.keepReport.some((k) => k.messageId === tire && k.status === "converted")).toBe(true);
    expect(changeText(converted, tire)).toContain("Bought a tire");
    expect(noteText(converted, tire)).toContain("Bought a tire");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("after a five-day timelapse across a payday, a turn's Journal lines keep the payday, its payroll posting and the card statement, as its change chip does", () => {
    const reg = createRegistry(ALL_PACKS);
    const make = STARTER_WORLDS.modern_slice_of_life;
    if (!make) throw new Error("no Port Alder starter");
    const world = make("pa", "Port Alder");
    const s0 = startState(world);
    const w = new Working(reg, world, s0);
    materializeAll(reg, w, world.pov, "run");
    const lapse = runTimelapse(reg, w, { type: "duration", minutes: 5 * 1440 }, { runSeed: "run", overrides: { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } });
    if ("code" in lapse) throw new Error(lapse.reason);
    const lines = turnLines(reg, world, w.state, coarsen(reg, world, s0, w.events));
    expect(lines).toHaveLength(8);
    for (const line of ["Payday:", "Payroll:", "Statement:"]) expect(lines.some((l) => l.startsWith(line))).toBe(true);
  });
});

describe("palette: Take from a kit", () => {
  test("a kit's pieces still in it are its second pick, each with how many are left; the picks go out as kit and piece", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const entry = (await rig.rt.view(chatId, rig.host.userId)).palette?.entries.find((e) => e.action === "take_piece");
    const kit = entry?.options.find((o) => o.params.kit === "pov_toolbox");
    expect(kit?.label).toBe("Mechanic's toolbox");
    expect(kit?.disabled).toBeUndefined();
    expect(kit?.next?.param).toBe("piece");
    expect(kit?.next?.label).toBe("Piece");
    const pieces = kit?.next?.options ?? [];
    expect(pieces.length).toBeGreaterThan(0);
    expect(pieces.length).toBeLessThanOrEqual(12);
    for (const p of pieces) {
      expect(Object.keys(p.params)).toEqual(["piece"]);
      expect(p.label.startsWith(`${String(p.params.piece)} (`)).toBe(true);
      expect(p.label).toMatch(/ \([1-9]\d* left\)$/);
    }
    const all = entry?.options.flatMap((o) => [o, ...(o.next?.options ?? [])]) ?? [];
    expect(all.some((o) => o.disabled?.includes("needs piece"))).toBe(false);
    // The toolbox is at the garage, so from home each piece is judged off, in the player's words.
    expect(pieces.every((p) => p.disabled === "Not possible here and now")).toBe(true);
    // The palette sends the picks merged.
    const [first] = pieces;
    if (!entry || !kit || !first) throw new Error("no piece");
    expect(paletteRequest(entry, [kit, first], chatId).params).toEqual({ kit: "pov_toolbox", piece: first.params.piece });
  });

  test("a piece the palette offers at the kit is taken when the turn runs", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.body(await rig.send({ type: "lre.fix", chatId, entity: "pov", field: "place", value: "alder_automotive" }));
    const kitOption = async () => (await rig.rt.view(chatId, rig.host.userId)).palette?.entries.find((e) => e.action === "take_piece")?.options.find((o) => o.params.kit === "pov_toolbox");
    // Before the first turn the palette judges at the levels that turn will use. With "Use my
    // settings" on, that's the user's realism (Story: gear 1, too coarse for kit pieces) ...
    rig.body(await rig.send({ type: "lre.settings.set", patch: { overrideWorldDefaults: true } }));
    expect((await kitOption())?.next?.options.every((p) => p.disabled === "Not possible here and now")).toBe(true);
    // ... and by default it's the world's own (Port Alder's Simulation: gear 4).
    rig.body(await rig.send({ type: "lre.settings.set", patch: { overrideWorldDefaults: false } }));
    const entry = (await rig.rt.view(chatId, rig.host.userId)).palette?.entries.find((e) => e.action === "take_piece");
    const kit = entry?.options.find((o) => o.params.kit === "pov_toolbox");
    const piece = kit?.next?.options.find((p) => p.disabled === undefined);
    if (!entry || !kit || !piece) throw new Error("no piece on offer at the garage");
    const request = paletteRequest(entry, [kit, piece], chatId);
    rig.body(await rig.send({ ...request }));
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "You pull it from the drawer.");
    const view = await rig.rt.view(chatId, rig.host.userId);
    // ... and the turn takes it.
    expect(view.chips.filter((c) => c.kind === "decline").map((c) => `${c.label} ${c.detail ?? ""}`)).toEqual([]);
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const state = core?.renderState(toChain(await rig.host.chats.messages(chatId, rig.host.userId)))?.state;
    expect(Object.values(state?.entities ?? {}).some((e) => e.fields.from_kit === "pov_toolbox")).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("HUD ✎ fixes for weather and scene type", () => {
  test("each has a ✎ target, and its fix shows in the pill and the details", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const view = () => rig.rt.view(chatId, rig.host.userId);
    const fixTo = async (target: FieldFixTarget | undefined, value: string) => {
      if (!target) throw new Error("no fix target");
      rig.body(await rig.send(fixRequest(target, value, chatId)));
    };

    const start = await view();
    const weather = start.hud?.fixes.weather;
    // Weather lives on the region over the player; the options are its climate's states.
    expect(weather?.field).toBe("weather");
    expect(weather?.entity).not.toBe("pov");
    const other = weather?.options?.find((o) => o.value !== weather.value);
    if (!other || typeof other.value !== "string") throw new Error("no other weather state");
    await fixTo(weather, other.value);
    const wet = await view();
    expect(wet.hud?.weather?.startsWith(other.label)).toBe(true);
    expect(wet.hud?.fixes.weather?.value).toBe(other.value);

    // The scene type: the world's types, plus following the place.
    const scene = wet.hud?.fixes.scene;
    expect(scene?.options?.map((o) => o.value)).toEqual(["", "conversation", "action", "exploration", "downtime", "work"]);
    expect(scene?.value).toBe("");
    await fixTo(scene, "work");
    const working = await view();
    expect(working.scene?.sceneType).toBe("work");
    expect(working.controls?.time.sceneType).toBe("work");
    expect(working.hud?.fixes.scene?.value).toBe("work");
    await fixTo(working.hud?.fixes.scene, "");
    expect((await view()).scene?.sceneType).toBe(start.scene?.sceneType);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the player layer lists only the people and places the player may know", () => {
  test("a secret person standing in the room and a place not yet found stay out of Present, the palette, the map and the ✎", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
    const here = STARTER_WORLDS.modern_slice_of_life?.("a", "Alder").entities.pov?.fields.place;
    const person = (id: string, name: string, extra: Record<string, unknown>) => ({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id, value: { id, kind: "person", name, tier: "background", fields: { place: here }, relations: [], ...extra } });
    rig.body(await rig.send(person("lurker", "The Lurker", { visibility: "secret" })));
    rig.body(await rig.send(person("visitor", "Pat Visitor", {})));
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "places", id: "smugglers_cove", value: { id: "smugglers_cove", name: "Smugglers' Cove", fields: {}, visibility: "discoverable" } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const view = await rig.rt.view(chatId, rig.host.userId);
    expect(view.scene?.present.map((p) => p.name)).toContain("Pat Visitor");
    expect(view.scene?.present.map((p) => p.name)).not.toContain("The Lurker");
    const targets = view.palette?.entries.flatMap((e) => e.options.map((o) => o.label)) ?? [];
    expect(targets).toContain("Pat Visitor");
    expect(targets).not.toContain("The Lurker");
    expect(JSON.stringify(view.panels["castlife.cast"])).not.toContain("The Lurker");
    for (const shown of [view.hud?.fixes.place?.options, view.panels["space.map"], targets]) expect(JSON.stringify(shown)).not.toContain("Smugglers");
    expect(view.hud?.fixes.place?.options?.some((o) => o.value === here)).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

// GM edits (DESIGN §7): `lre.edit` operations, each checked and resolved through the core effects,
// all or none, as one `fix` entry with Undo; Remove takes an entity out of every player surface and
// every process, and Restore brings it back.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import type { EditOp } from "../../src/shared/protocol";
import type { WorldDoc } from "../../src/shared/world";
import { toChain } from "../../src/backend/ledger-io";
import { paramCandidates } from "../../src/engine/resolve";
import { lod1Agents } from "../../src/engine/simulate";
import type { WorldState } from "../../src/engine/state";
import { canSeeEntity } from "../../src/engine/visibility";
import { Rig } from "../support/rig";
import { POV } from "../support/test-pack";

/** A test-world chat with a bounded and a locked field, a box holding a coin, a typed relation, a second place, a track and an action that names a person. */
async function chat(rig: Rig): Promise<string> {
  const worldId = await rig.newWorld();
  const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
  const put = async (collection: string, id: string, value: JsonObject) => rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection, id, value }));
  await put("kinds", "person", { id: "person", label: "Person", fields: { cash: { type: "money" }, mood: { type: "text" }, detail: { type: "text" }, grit: { type: "number", min: 1, max: 5 }, secret: { type: "text", locked: true }, xp: { type: "number" } } });
  await put("kinds", "box", { id: "box", label: "Box", fields: {} });
  await put("relations", "rival", { id: "rival", label: "Rival", from: "person", to: "person", cardinality: "many_many", symmetric: false, fields: { heat: { type: "number", min: 0, max: 10 } } });
  await put("entities", "chest", { id: "chest", kind: "box", name: "Chest", tier: "background", fields: { place: "home" }, relations: [] });
  await put("entities", "coin", { id: "coin", kind: "box", name: "Coin", tier: "background", fields: {}, relations: [{ type: "in", to: "chest" }] });
  await put("places", "cellar", { id: "cellar", name: "Cellar", fields: {} });
  await put("tracks", "feud", { id: "feud", kind: "quest", label: "The feud", start: "simmer", visibility: "public", stages: { simmer: { label: "Simmering", next: [] }, boil: { label: "Boiling over", next: [] } } });
  await put("actions", "talk", { id: "talk", label: "Talk to", params: { to: { type: "ref", ref: "person" } }, requires: [], outcomes: { default: [] }, duration: "1" });
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base }));
  const chatId = rig.host.createChat("Morning, Sam.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "look around", "Quiet.");
  return chatId;
}

async function folded(rig: Rig, chatId: string): Promise<{ state: WorldState; world: WorldDoc }> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const render = core?.renderState(toChain(await rig.host.chats.messages(chatId, rig.host.userId)));
  if (!render) throw new Error("no state");
  return render;
}

async function edit(rig: Rig, chatId: string, ...ops: EditOp[]): Promise<void> {
  rig.body(await rig.send({ type: "lre.edit", chatId, ops }));
}

async function refused(rig: Rig, chatId: string, ...ops: EditOp[]): Promise<string> {
  const reply = await rig.send({ type: "lre.edit", chatId, ops });
  if (reply.type !== "lre.error") throw new Error(`${JSON.stringify(ops)} was accepted`);
  return reply.message;
}

describe("GM edits", () => {
  test("fields: any field, locked ones too, typed and bounded; add stops at the bounds; one submit is all or none", async () => {
    const rig = new Rig();
    const chatId = await chat(rig);
    await edit(rig, chatId, { op: "set", entity: POV, field: "secret", value: "under the mat" }, { op: "set", entity: "dev", field: "grit", value: 2 });
    expect(await refused(rig, chatId, { op: "set", entity: "dev", field: "grit", value: 8 })).toContain("between 1 and 5");
    await edit(rig, chatId, { op: "add", entity: "dev", field: "grit", delta: 10 }, { op: "add", entity: POV, field: "xp", delta: 40 });
    expect(await refused(rig, chatId, { op: "add", entity: POV, field: "mood", delta: 1 })).toContain("isn't a number");
    // A later operation that fails takes the earlier ones with it.
    expect(await refused(rig, chatId, { op: "set", entity: POV, field: "mood", value: "grim" }, { op: "set", entity: "nobody", field: "mood", value: "x" })).toContain("nobody");
    const { state } = await folded(rig, chatId);
    expect(state.entities[POV]?.fields).toMatchObject({ secret: "under the mat", xp: 40, mood: "fine" });
    expect(state.entities.dev?.fields.grit).toBe(5);
  });

  test("relations: added through the link effect with their kinds and fields checked, edited and removed", async () => {
    const rig = new Rig();
    const chatId = await chat(rig);
    await edit(rig, chatId, { op: "link", rel: "rival", from: POV, to: "dev", fields: { heat: 3 } });
    expect(await refused(rig, chatId, { op: "link", rel: "rival", from: POV, to: "dev", fields: { heat: 11 } })).toContain("between 0 and 10");
    expect(await refused(rig, chatId, { op: "link", rel: "rival", from: POV, to: "chest" })).toContain("person");
    expect(await refused(rig, chatId, { op: "link", rel: "nemesis", from: POV, to: "dev" })).toContain("no relation type");
    await edit(rig, chatId, { op: "link", rel: "rival", from: POV, to: "dev", fields: { heat: 7 } });
    expect((await folded(rig, chatId)).state.entities[POV]?.relations).toEqual([{ type: "rival", to: "dev", fields: { heat: 7 } }]);
    await edit(rig, chatId, { op: "unlink", rel: "rival", from: POV, to: "dev" });
    expect((await folded(rig, chatId)).state.entities[POV]?.relations).toEqual([]);
    expect(await refused(rig, chatId, { op: "unlink", rel: "rival", from: POV, to: "dev" })).toContain("no rival");
  });

  test("placement: move to a place, into and out of a container, never inside itself; set an owner", async () => {
    const rig = new Rig();
    const chatId = await chat(rig);
    await edit(rig, chatId, { op: "move", entity: "dev", to: "cellar" }, { op: "put", entity: "coin", into: null }, { op: "set", entity: "coin", field: "owner", value: POV });
    let { state } = await folded(rig, chatId);
    expect(state.entities.dev?.fields.place).toBe("cellar");
    expect(state.entities.coin).toMatchObject({ relations: [], fields: { place: "home", owner: POV } });
    await edit(rig, chatId, { op: "put", entity: "coin", into: "dev" });
    ({ state } = await folded(rig, chatId));
    expect(state.entities.coin?.relations).toEqual([{ type: "in", to: "dev" }]);
    expect(state.entities.coin?.fields.place).toBeNull();
    expect(await refused(rig, chatId, { op: "put", entity: "dev", into: "coin" })).toContain("can't go inside");
    expect(await refused(rig, chatId, { op: "move", entity: "dev", to: "atlantis" })).toContain("atlantis");
  });

  test("accounts, tracks and entity state", async () => {
    const rig = new Rig();
    const chatId = await chat(rig);
    await edit(rig, chatId, { op: "adjust", account: POV, cents: 500 });
    // The test pack guards an own account against going below zero, as the economy does.
    expect(await refused(rig, chatId, { op: "adjust", account: POV, cents: -900 })).toContain("can't cover");
    await edit(rig, chatId, { op: "stage", track: "feud", to: "boil" }, { op: "entity", entity: "dev", tier: "supporting", agent: false, levels: { money: 3 } });
    expect(await refused(rig, chatId, { op: "stage", track: "feud", to: "explode" })).toContain("explode");
    expect(await refused(rig, chatId, { op: "entity", entity: "dev", tier: "legend" })).toContain("legend");
    expect(await refused(rig, chatId, { op: "entity", entity: POV, agent: true })).toContain("point of view");
    const { state } = await folded(rig, chatId);
    expect(state.accounts[POV]).toBe(500);
    expect(state.accounts["economy.external:correction"]).toBe(-500);
    expect(state.tracks.feud?.stage).toBe("boil");
    expect(state.entities.dev).toMatchObject({ tier: "supporting", agent: false, levels: { money: 3 } });
    // Back to the tier's level, and an agent again, caught up to now.
    await edit(rig, chatId, { op: "entity", entity: "dev", agent: true, levels: { money: null } });
    const after = (await folded(rig, chatId)).state;
    expect(after.entities.dev?.levels).toEqual({});
    expect(lod1Agents(after)).toContain("dev");
  });

  test("spawn: a new entity through the spawn effect, at its place and tier", async () => {
    const rig = new Rig();
    const chatId = await chat(rig);
    await edit(rig, chatId, { op: "spawn", kind: "person", name: "Mara", id: "mara", place: "cellar", tier: "supporting" });
    expect((await folded(rig, chatId)).state.entities.mara).toMatchObject({ kind: "person", name: "Mara", tier: "supporting", fields: { place: "cellar" } });
    expect(await refused(rig, chatId, { op: "spawn", kind: "person", name: "Mara", id: "mara" })).toContain("taken");
    expect(await refused(rig, chatId, { op: "spawn", kind: "dragon", name: "Smaug" })).toContain("dragon");
  });

  test("Remove takes an entity out of every player surface and process; Restore and Undo bring it back", async () => {
    const rig = new Rig();
    const chatId = await chat(rig);
    await edit(rig, chatId, { op: "move", entity: POV, to: "home" }, { op: "move", entity: "dev", to: "home" }, { op: "link", rel: "knows", from: POV, to: "dev" }, { op: "put", entity: "coin", into: "dev" });
    const shown = async () => {
      const view = await rig.rt.view(chatId, rig.host.userId);
      const { state, world } = await folded(rig, chatId);
      const talk = world.actions.talk;
      if (!talk) throw new Error("no talk action");
      return {
        scene: view.scene?.present.map((p) => p.id) ?? [],
        palette: paramCandidates(rig.rt.registry, world, state, talk, "to"),
        agents: lod1Agents(state),
        seen: canSeeEntity(world, state, POV, "dev"),
        coinSeen: canSeeEntity(world, state, POV, "coin"),
      };
    };
    expect(await shown()).toEqual({ scene: ["dev"], palette: ["dev"], agents: ["dev"], seen: true, coinSeen: true });
    await edit(rig, chatId, { op: "despawn", entity: "dev" });
    expect(await shown()).toEqual({ scene: [], palette: [], agents: [], seen: false, coinSeen: false });
    let { state } = await folded(rig, chatId);
    // Its relations went, everyone's relations to it too; what it carries stays with it.
    expect(state.entities[POV]?.relations).toEqual([]);
    expect(state.entities.coin?.relations).toEqual([{ type: "in", to: "dev" }]);
    expect(await refused(rig, chatId, { op: "despawn", entity: POV })).toContain("point of view");
    // The GM edits a removed entity, then restores it.
    await edit(rig, chatId, { op: "set", entity: "dev", field: "mood", value: "back" });
    await edit(rig, chatId, { op: "restore", entity: "dev" });
    expect(await shown()).toEqual({ scene: ["dev"], palette: ["dev"], agents: ["dev"], seen: true, coinSeen: true });
    ({ state } = await folded(rig, chatId));
    expect(state.entities.dev?.fields.mood).toBe("back");
    // Undo on the Remove brings back the relations it took, too.
    await edit(rig, chatId, { op: "despawn", entity: "dev" });
    const undo = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "fix").at(-1);
    if (!undo) throw new Error("no Undo chip");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: undo.id, choice: "undo" }));
    ({ state } = await folded(rig, chatId));
    expect(state.entities.dev?.fields.gone).toBe(false);
  });

  test("each GM edit is its own Journal line, which the player sees only where visibility allows", async () => {
    const rig = new Rig();
    const chatId = await chat(rig);
    await edit(rig, chatId, { op: "link", rel: "knows", from: POV, to: "dev" });
    await edit(rig, chatId, { op: "set", entity: "dev", field: "mood", value: "sour" });
    await edit(rig, chatId, { op: "spawn", kind: "person", name: "Mara", id: "mara" }, { op: "set", entity: "mara", field: "visibility", value: "secret" }, { op: "set", entity: "mara", field: "detail", value: "a spy" });
    const lines = (await rig.rt.view(chatId, rig.host.userId)).journal.filter((n) => n.kind === "fix").map((n) => n.text);
    expect(lines.some((l) => l.includes("sour"))).toBe(true);
    expect(lines.some((l) => l.includes("spy") || l.includes("Mara"))).toBe(false);
  });

  test("an edit held through a reply that no longer applies when it finishes is refused with a notice", async () => {
    const rig = new Rig();
    const chatId = await chat(rig);
    await edit(rig, chatId, { op: "link", rel: "knows", from: POV, to: "dev" });
    rig.host.sendUser(chatId, "look around");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    // Each is checked against the state the reply is written from, then held until it finishes;
    // the first to land takes the relation the second needs.
    const unlink: EditOp = { op: "unlink", rel: "knows", from: POV, to: "dev" };
    expect(rig.body(await rig.send({ type: "lre.edit", chatId, ops: [unlink] })).pending).toBe(true);
    expect(rig.body(await rig.send({ type: "lre.edit", chatId, ops: [unlink] })).pending).toBe(true);
    await rig.host.finish(g, "Quiet again.");
    const notices = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "refused");
    expect(notices.map((c) => c.label)).toEqual(["Your correction didn't apply after the reply"]);
    expect((await folded(rig, chatId)).state.entities[POV]?.relations).toEqual([]);
  });

  test("malformed edits are refused before anything is read", async () => {
    const rig = new Rig();
    const chatId = await chat(rig);
    for (const ops of [[], [{ op: "teleport", entity: POV }], [{ op: "set", entity: POV, field: "mood" }], [{ op: "add", entity: POV, field: "xp", delta: "9" }], "everything"]) {
      const reply = await rig.send({ type: "lre.edit", chatId, ops });
      expect(reply.type === "lre.error" ? reply.code : "accepted").toBe("bad_request");
    }
  });
});

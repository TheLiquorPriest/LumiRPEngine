// GM edits (DESIGN §7): `lre.edit` operations, each checked and resolved through the core effects,
// all or none, as one `fix` entry with Undo; Remove takes an entity out of every player surface and
// every process, and Restore brings it back.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { hashJson } from "../../src/shared/hash";
import type { JsonObject } from "../../src/shared/json";
import type { EditOp } from "../../src/shared/protocol";
import type { GmView } from "../../src/shared/state-view";
import type { WorldDoc } from "../../src/shared/world";
import { toChain } from "../../src/backend/ledger-io";
import { referenceFold } from "../../src/engine/ledger/reference";
import { paramCandidates } from "../../src/engine/resolve";
import { scheduleOwners } from "../../src/engine/schedules";
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
  // Not shown to players: only Build and the GM side see it.
  await put("classifications", "role", { id: "role", label: "Role", multiple: false, values: { ally: { label: "Ally" }, foe: { label: "Foe" } } });
  // Shown to players: Cast groups by it, and a change to it reaches their Journal.
  await put("classifications", "side", { id: "side", label: "Side", multiple: false, shown: true, values: { town: { label: "Townsfolk" }, guild: { label: "Guild" } } });
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

/** The head's state by both folds, which agree (DESIGN §14, L1). */
async function bothFolds(rig: Rig, chatId: string): Promise<WorldState> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("no ledger");
  const chain = toChain(await rig.host.chats.messages(chatId, rig.host.userId));
  const reference = referenceFold(core.foldInput(chain), rig.rt.registry);
  expect(hashJson(core.fold(chain).state)).toBe(hashJson(reference.state));
  return reference.state;
}

/** A Port Alder chat as the starter ships it (its people public, none known yet), whose replies' new acquaintances are read as made. */
async function portAlder(rig: Rig): Promise<string> {
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { knows: { mode: "auto" } } } }));
  rig.host.quietReply = () => "{}";
  return chatId;
}

/** Whether the player character knows Danny at the head, by both folds. */
async function knowsDanny(rig: Rig, chatId: string): Promise<boolean> {
  return (await bothFolds(rig, chatId)).entities.pov?.relations.some((r) => r.type === "knows" && r.to === "danny_okafor") === true;
}

/** A read that has the player character meet Danny; every other model call answers with nothing. */
const meetsDanny = (req: QuietRequest): string => ((req.messages[0]?.content ?? "").includes("propose concrete state changes") ? JSON.stringify({ proposals: [{ type: "knows", fact: "danny_okafor" }] }) : "{}");

/** Edits a reply and reads it again with its Re-read edit chip. */
async function reread(rig: Rig, chatId: string, messageId: string, text: string): Promise<void> {
  rig.host.editMessage(chatId, messageId, text);
  await rig.host.settle();
  const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "reread" && c.messageId === messageId);
  if (!chip) throw new Error("no Re-read chip");
  rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "reread" }));
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
    const { state: after, world } = await folded(rig, chatId);
    expect(after.entities.dev?.levels).toEqual({});
    expect(lod1Agents(world, after)).toContain("dev");
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
        agents: lod1Agents(world, state),
        seen: canSeeEntity(rig.rt.registry, world, state, POV, "dev"),
        coinSeen: canSeeEntity(rig.rt.registry, world, state, POV, "coin"),
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

  test("an edit held through a reply lands after it even where what it edits changed meanwhile, passing over what is already so", async () => {
    const rig = new Rig();
    const chatId = await chat(rig);
    await edit(rig, chatId, { op: "link", rel: "knows", from: POV, to: "dev" }, { op: "spawn", kind: "box", name: "Crate", id: "crate", place: "home" });
    rig.host.sendUser(chatId, "look around");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    // Each is checked against the state the reply is written from, then held until it finishes. The
    // first to land changes what the later ones were made against: the second unlink asks for what is
    // already so, and the coin taken out of the chest is no longer in it when it goes into the crate.
    const held: EditOp[] = [
      { op: "unlink", rel: "knows", from: POV, to: "dev" },
      { op: "unlink", rel: "knows", from: POV, to: "dev" },
      { op: "put", entity: "coin", into: null },
      { op: "put", entity: "coin", into: "crate" },
    ];
    for (const op of held) expect(rig.body(await rig.send({ type: "lre.edit", chatId, ops: [op] })).pending).toBe(true);
    await rig.host.finish(g, "Quiet again.");
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "refused")).toEqual([]);
    const { state } = await folded(rig, chatId);
    expect(state.entities[POV]?.relations).toEqual([]);
    expect(state.entities.coin?.relations).toEqual([{ type: "in", to: "crate" }]);
    // The GM view keeps no refusal; each edit that changed something is in force, and the second
    // unlink, already so when it landed, adds none of its own.
    const gm = rig.body(await rig.send({ type: "lre.gm", chatId })) as unknown as GmView;
    expect(gm.refused).toEqual([]);
    expect(gm.edits).toHaveLength(4);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("an unlink a Re-read already made so keeps its request, so reading the reply as it was again doesn't bring the link back", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await portAlder(rig);
    rig.host.quietReply = meetsDanny;
    await rig.turn(chatId, "I wave at the mechanic.", "Danny waves back and tells you his name.");
    expect(await knowsDanny(rig, chatId)).toBe(true);
    await edit(rig, chatId, { op: "unlink", rel: "knows", from: "pov", to: "danny_okafor" });
    expect(await knowsDanny(rig, chatId)).toBe(false);
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    // Edited so that the two never meet: the unlink is already so after the new read.
    rig.host.quietReply = () => "{}";
    await reread(rig, chatId, reply.id, "Nobody waves back.");
    expect(await knowsDanny(rig, chatId)).toBe(false);
    // Edited back: the read has them meet again, and the GM's unlink is made again after it.
    rig.host.quietReply = meetsDanny;
    await reread(rig, chatId, reply.id, "Danny waves back and tells you his name.");
    expect(await knowsDanny(rig, chatId)).toBe(false);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("on a later reply that a Re-read of an earlier one puts on a rebased view, an edit already so there reads as nothing made: no chip, no Journal line", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await portAlder(rig);
    rig.host.quietReply = meetsDanny;
    await rig.turn(chatId, "I wave at the mechanic.", "Danny waves back and tells you his name.");
    const earlier = rig.host.head(chatId);
    if (!earlier) throw new Error("no reply");
    rig.host.quietReply = () => "{}";
    await rig.turn(chatId, "I wait.", "Nothing much happens.");
    const later = rig.host.head(chatId);
    if (!later) throw new Error("no reply");
    await edit(rig, chatId, { op: "unlink", rel: "knows", from: "pov", to: "danny_okafor" });
    const shown = async () => {
      const view = await rig.rt.view(chatId, rig.host.userId);
      return { chips: view.chips.filter((c) => c.kind === "fix" && c.messageId === later.id).length, journal: view.journal.filter((n) => n.kind === "fix" && n.messageId === later.id).length };
    };
    expect(await shown()).toEqual({ chips: 1, journal: 1 });
    // The earlier reply, edited so that the two never meet and read again: the unlink is already so there.
    await reread(rig, chatId, earlier.id, "Nobody waves back.");
    expect(await knowsDanny(rig, chatId)).toBe(false);
    expect(await shown()).toEqual({ chips: 0, journal: 0 });
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("malformed edits are refused before anything is read", async () => {
    const rig = new Rig();
    const chatId = await chat(rig);
    for (const ops of [[], [{ op: "teleport", entity: POV }], [{ op: "set", entity: POV, field: "mood" }], [{ op: "add", entity: POV, field: "xp", delta: "9" }], [{ op: "classify", entity: "dev", class: { role: "ally" }, tags: [] }], "everything"]) {
      const reply = await rig.send({ type: "lre.edit", chatId, ops });
      expect(reply.type === "lre.error" ? reply.code : "accepted").toBe("bad_request");
    }
  });

  test("classify: classes and tags for this chat, checked against the world's facets, matched by selectors, carried through a swipe", async () => {
    const rig = new Rig();
    const chatId = await chat(rig);
    const owners = async () => {
      const { state, world } = await folded(rig, chatId);
      return scheduleOwners(rig.rt.registry, world, state, { id: "allies", owner: { class: { role: ["ally"] }, tag: ["regular"] }, target: "activity", recurrence: { every: "day" }, slots: [{ start: "09:00", end: "10:00", value: "chat" }] });
    };
    expect(await owners()).toEqual([]);
    expect(await refused(rig, chatId, { op: "classify", entity: "dev", class: { mood: ["ally"] }, tags: [] })).toContain("mood");
    expect(await refused(rig, chatId, { op: "classify", entity: "dev", class: { role: ["villain"] }, tags: [] })).toContain("villain");
    expect(await refused(rig, chatId, { op: "classify", entity: "dev", class: {}, tags: [] })).toContain("nothing to change");
    await edit(rig, chatId, { op: "classify", entity: "dev", class: { role: ["ally"] }, tags: ["regular"] });
    expect(await owners()).toEqual(["dev"]);
    // The facet is hidden and tags never reach Play: the player's Journal line names neither.
    const lines = (await rig.rt.view(chatId, rig.host.userId)).journal.filter((n) => n.kind === "fix").map((n) => n.text);
    expect(lines.some((l) => l.includes("Ally") || l.includes("regular"))).toBe(false);
    const gm = rig.body(await rig.send({ type: "lre.gm", chatId })) as unknown as GmView;
    expect(gm.entities.find((e) => e.id === "dev")).toMatchObject({ class: { role: ["ally"] }, tags: ["regular"] });
    // A Re-run of the reply carries the edit, as it carries every GM edit.
    const g = await rig.host.start(chatId, { type: "swipe" });
    await rig.host.finish(g, "Quiet, still.");
    expect(await owners()).toEqual(["dev"]);
  });

  test("classify: the player's line says only what changed on facets players can see, never a hidden facet or a tag", async () => {
    const rig = new Rig();
    const chatId = await chat(rig);
    await edit(rig, chatId, { op: "link", rel: "knows", from: POV, to: "dev" });
    // Lower-cased: a line names a facet mid-sentence ("Dev's side is now Guild").
    const seen = async () => {
      const view = await rig.rt.view(chatId, rig.host.userId);
      return { journal: view.journal.filter((n) => n.kind === "fix").map((n) => n.text.toLowerCase()), chip: (view.chips.filter((c) => c.kind === "fix").at(-1)?.detail ?? "").toLowerCase() };
    };
    const hidden = ["role", "foe", "traitor"];
    // A visible facet set: the line names it and its new value.
    await edit(rig, chatId, { op: "classify", entity: "dev", class: { side: ["town"] }, tags: [] });
    let now = await seen();
    expect(now.chip).toContain("townsfolk");
    const before = now.journal.length;
    // Only a hidden facet and a tag change: no Journal line, and the Corrected chip names nothing.
    await edit(rig, chatId, { op: "classify", entity: "dev", class: { side: ["town"], role: ["foe"] }, tags: ["traitor"] });
    now = await seen();
    expect(now.journal.length).toBe(before);
    for (const word of [...hidden, "townsfolk", "side"]) expect(now.chip).not.toContain(word);
    // The visible facet cleared: the line says so, and still names nothing hidden.
    await edit(rig, chatId, { op: "classify", entity: "dev", class: { role: ["foe"] }, tags: ["traitor"] });
    now = await seen();
    expect(now.journal.length).toBe(before + 1);
    expect(now.chip).toContain("side");
    for (const word of [...hidden, "townsfolk"]) expect(now.chip).not.toContain(word);
    // Changed from one visible value to another: the new one is named.
    await edit(rig, chatId, { op: "classify", entity: "dev", class: { side: ["guild"] }, tags: [] });
    now = await seen();
    expect(now.chip).toContain("guild");
    for (const word of [...hidden, "townsfolk"]) expect(now.chip).not.toContain(word);
    for (const line of now.journal) for (const word of hidden) expect(line).not.toContain(word);
  });

  test("a GM edit's chip is the GM's, and for what the player didn't see it names only whom they know, never where they went", async () => {
    const latest = async (rig: Rig, chatId: string) => (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "fix").at(-1);
    const rig = new Rig();
    const chatId = await chat(rig);
    // Moving someone the player knows: another person's moves are never worded for the player, so
    // the chip says whom it was about, and not the cellar they were moved to.
    await edit(rig, chatId, { op: "link", rel: "knows", from: POV, to: "dev" });
    await edit(rig, chatId, { op: "move", entity: "dev", to: "cellar" });
    const moved = await latest(rig, chatId);
    expect(moved?.detail).toContain("Dev");
    expect(moved?.detail).not.toContain("Cellar");
    // A ✎ correction of the player's reads as theirs, not as the GM's.
    rig.body(await rig.send({ type: "lre.fix", chatId, entity: POV, field: "mood", value: "calm" }));
    expect((await latest(rig, chatId))?.label).not.toBe(moved?.label);
    // Someone the player has never met is named nowhere on it.
    const other = new Rig();
    const otherChat = await chat(other);
    await edit(other, otherChat, { op: "move", entity: "dev", to: "cellar" });
    const unseen = await latest(other, otherChat);
    for (const word of ["Dev", "Cellar"]) expect(unseen?.detail).not.toContain(word);
    expect(unseen?.label).toBe(moved?.label);
  });
});

describe("GM view", () => {
  test("loads on request with everything, removed and secret entities included, and is never pushed with the state", async () => {
    const rig = new Rig();
    const chatId = await chat(rig);
    await edit(rig, chatId, { op: "despawn", entity: "dev" }, { op: "set", entity: "chest", field: "visibility", value: "secret" }, { op: "link", rel: "rival", from: POV, to: "dev", fields: { heat: 2 } });
    expect(Object.keys((await rig.rt.view(chatId, rig.host.userId)).panels)).not.toContain("core.gm");
    expect(rig.host.sent.some((m) => (m.type === "lre.state.snapshot" && "core.gm" in m.view.panels) || (m.type === "lre.state.delta" && m.ops.some((op) => op.path.includes("core.gm"))))).toBe(false);
    const gm = rig.body(await rig.send({ type: "lre.gm", chatId })) as unknown as GmView;
    const entity = (id: string) => gm.entities.find((e) => e.id === id);
    expect(entity("dev")).toMatchObject({ gone: true, agent: true });
    expect(entity("chest")?.visibility).toBe("secret");
    expect(entity("coin")?.holder).toBe("chest");
    expect(entity(POV)?.fields.find((f) => f.id === "grit")).toMatchObject({ type: "number", min: 1, max: 5 });
    expect(entity(POV)?.fields.find((f) => f.id === "secret")?.locked).toBe(true);
    expect(gm.places.map((p) => p.id).sort()).toEqual(["cellar", "home"]);
    expect(gm.tracks.find((t) => t.id === "feud")?.stages.map((s) => s.id)).toEqual(["simmer", "boil"]);
    expect(gm.relationTypes.some((r) => r.id === "rival" && r.fields.some((f) => f.id === "heat" && f.max === 10))).toBe(true);
    // The edit is listed in full, the removed entity named, though the player's Journal can't name it.
    expect(gm.edits[0]?.lines.some((l) => l.includes("Dev is gone"))).toBe(true);
  });
});

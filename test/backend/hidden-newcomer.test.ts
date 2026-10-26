// A reply that introduces someone (a `spawn` proposal) by the name of a person the POV may not know
// (DESIGN §7, §9.4): the newcomer is handled as one nobody could tell from that person, so nothing the
// player sees, and nothing the next reply is told, says such a person exists; only the log says why.
// A name the POV may know is that person already: a Not tracked receipt says so, and the next reply
// is told nothing (DESIGN §9.5); a name nobody has spawns.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import type { JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "propose concrete state changes";
const NAME = "Vex Morrow";

/**
 * A test-world chat with `extra` entities (and a pier the POV hasn't been to) whose reply introduces
 * Vex Morrow, spawns applying automatically; then a quiet turn, whose prompt carries what the next
 * reply is told. With `undo`, the newcomer's Undo chip is pressed before that turn.
 */
async function vexWalksIn(extra: JsonObject[], undo = false) {
  const rig = new Rig();
  const worldId = await rig.newWorld();
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "places", id: "pier", value: { id: "pier", name: "The pier", fields: {} } }));
  for (const e of extra) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: String(e.id), value: e }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning, Sam.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { spawn: { mode: "auto" } } } }));
  const logsBefore = rig.host.logs.length;
  rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK) ? JSON.stringify({ proposals: [{ type: "spawn", kind: "person", name: NAME, role: "courier" }] }) : "{}");
  await rig.turn(chatId, `I wave at ${NAME} as she walks in.`, `${NAME} walks in, shakes off the rain and waves back.`);
  const view = await rig.rt.view(chatId, rig.host.userId);
  const notes = (await rig.rt.outcomeNotes.list(chatId, rig.host.userId)).map((n) => n.text);
  const logs = rig.host.logs.slice(logsBefore);
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!core || !state) throw new Error("the chat has no state");
  // The ids of the characters the reply introduced as Vex Morrow, before and after an Undo.
  const newcomers = Object.keys(state.entities).filter((id) => state.entities[id]?.name === NAME && state.entities[id]?.fields.spawned === "narration");
  let undone: string[] | null = null;
  if (undo) {
    const chip = view.chips.find((c) => c.kind === "undo" && c.label.includes(NAME));
    if (!chip) throw new Error("no Undo chip");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "undo" }));
    const after = core.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
    undone = Object.keys(after.entities).filter((id) => after.entities[id]?.name === NAME && after.entities[id]?.fields.spawned === "narration");
  }
  rig.host.quietReply = () => "{}";
  await rig.turn(chatId, "I look around.", "The room is quiet.");
  const told = rig.host.assembled.map((e) => e.content).join("\n");
  return { view, shown: JSON.stringify(view), notes, logs, state, told, newcomers, undone };
}

const person = (id: string, name: string, fields: JsonObject, visibility?: string): JsonObject => ({ id, kind: "person", name, tier: "background", fields, relations: [], ...(visibility ? { visibility } : {}) });

describe("a reply that introduces someone by a hidden person's name", () => {
  test("with no one by that name, the newcomer arrives as before, and her Undo takes her back out", async () => {
    const free = await vexWalksIn([], true);
    expect(free.newcomers).toHaveLength(1);
    expect(free.view.chips.some((c) => c.kind === "undo" && c.label.includes(NAME))).toBe(true);
    expect(free.undone).toEqual([]);
  });

  for (const [hiding, vex] of [
    ["secret, in the same room", person("vex", NAME, { place: "home" }, "secret")],
    ["unmet, elsewhere", person("vex", NAME, { place: "pier" })],
  ] as const) {
    test(`someone ${hiding}: no chip, no note and nothing the player sees says she exists; the log says why`, async () => {
      const hidden = await vexWalksIn([vex]);
      expect(hidden.newcomers).toEqual([]);
      expect(hidden.view.chips.filter((c) => `${c.label} ${c.detail ?? ""}`.includes("Vex"))).toEqual([]);
      expect(hidden.notes).toEqual([]);
      for (const said of ["Vex", "exists"]) {
        expect(hidden.shown).not.toContain(said);
        expect(hidden.told).not.toContain(said);
      }
      expect(hidden.logs.some((l) => l.includes("dropped") && l.includes(NAME))).toBe(true);
    });
  }

  test("someone the POV knows: Not tracked on today's receipt, and the next reply is told nothing", async () => {
    const known = await vexWalksIn([person("vex", NAME, { place: "home" })]);
    expect(known.newcomers).toEqual([]);
    expect(known.view.chips.filter((c) => c.kind === "decline")).toEqual([]);
    expect(known.view.chips.filter((c) => c.kind === "untracked").map((c) => c.detail)).toEqual([`${NAME} already exists. The story stands as told, and the next reply isn't told otherwise.`]);
    expect(known.notes).toEqual([]);
  });

  test("an authored hidden person whose id a name would make: no visible 'exists', and the authored one stays as written", async () => {
    const authored = await vexWalksIn([person("npc_vex_morrow", "The Courier", { place: "pier" }, "secret")]);
    expect(authored.view.chips.filter((c) => `${c.label} ${c.detail ?? ""}`.includes("exists"))).toEqual([]);
    expect(authored.notes.filter((n) => n.includes("exists"))).toEqual([]);
    expect(authored.shown).not.toContain("exists");
    expect(authored.state.entities.npc_vex_morrow?.name).toBe("The Courier");
    // Nothing the POV may know is called Vex Morrow, so she arrives, under an id of her own.
    expect(authored.newcomers).toHaveLength(1);
    expect(authored.newcomers[0]).not.toBe("npc_vex_morrow");
    expect(authored.view.chips.some((c) => c.kind === "undo" && c.label.includes(NAME))).toBe(true);
  });
});

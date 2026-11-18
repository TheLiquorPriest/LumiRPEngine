// A rule set put on a chat's world, and a row added to its tables: a new revision of the world the chat moves to (its other chats stay),
// what the world has of its own kept, the chat's level of the rules' domain put on, and one Undo of the Upgrade takes it all back.
// Every world and chat here is invented.

import { expect, test } from "bun:test";
import type { JsonObject, ToolCtx, ToolResult } from "rp-harness/contract";
import { type EngineDeps, engineTools, shippedTexts, stateScan } from "../../src/iface/index";
import { presetAdjudication } from "../../src/shared/adjudication";
import { D20_COLUMNS, d20Schema } from "../../src/shared/d20";
import type { WorldDoc } from "../../src/shared/world";
import { addRow, applyRules, RulesRefused, type RulesDeps } from "../../src/worlds/rules";
import { makeBed, USER, worldsOn } from "../build-mode/bed";
import { PORTS, texts, wordsFromFiles } from "../iface/rig";

/** A world of the starters, its own `ruleset` part set first when it is given, with two chats on it. */
async function world(own?: WorldDoc["ruleset"]) {
  const bed = makeBed();
  const service = worldsOn(bed);
  const made = await service.create(USER, "Fernwick", "fantasy_town");
  let revision = made.revision;
  if (own !== undefined) {
    await service.draft(USER, made.world.id, { op: "set", part: "ruleset", value: own as never });
    revision = (await service.commit(USER, made.world.id, { base: made.revision, source: "build" })).revision;
  }
  const s = bed.store.user(USER);
  await bed.writes.run(() => {
    s.createChat({ id: "c", world: made.world.id, revision });
    s.createChat({ id: "other", world: made.world.id, revision });
  });
  const deps: RulesDeps = { worlds: service, s, registry: bed.store.env.registry, writes: bed.writes, user: USER, chat: "c" };
  const at = (chat: string) => s.headState(chat).state.world;
  return { service, made: { ...made, revision }, deps, at };
}

test("a rule set is put on the chat's world as a revision only this chat moves to; the world's own is kept unless named, and one Undo takes it back", async () => {
  const { service, made, deps, at } = await world({ adjudication: presetAdjudication("narrative") });
  const head = async () => (await service.read(USER, made.world.id)).world;
  // Said first, and nothing changed.
  const plan = await applyRules(deps, { rules: "classic", take: [], preview: true });
  expect(plan.added.length).toBeGreaterThan(0);
  expect(plan.kept.map((i) => i.path)).toEqual(["ruleset.adjudication"]);
  expect((await service.read(USER, made.world.id)).revision).toBe(made.revision);
  expect(at("c").revision).toBe(made.revision);

  const done = await applyRules(deps, { rules: "classic", take: [], preview: false });
  expect(done.revision).not.toBe(made.revision);
  expect((await service.read(USER, made.world.id)).revision).toBe(done.revision ?? "");
  expect(at("c").revision).toBe(done.revision ?? "");
  expect(at("other").revision).toBe(made.revision);
  expect(at("c").realism.levels.d20).toBe(1);
  expect(done.level).toEqual({ was: 0, now: 1 });
  expect(done.noSheet.count).toBeGreaterThan(0);
  // The world's own was kept, and its draft in Build left as it was.
  expect((await head()).ruleset?.adjudication?.preset).toBe("narrative");
  expect((await service.draft(USER, made.world.id, { op: "get" })).stored).toBe(false);

  // Said again: nothing more to add, so no revision; with its path named, the rule set's replaces the world's own.
  expect((await applyRules(deps, { rules: "classic", take: [], preview: false })).revision).toBeNull();
  const taken = await applyRules(deps, { rules: "classic", take: ["ruleset.adjudication"], preview: false });
  expect(taken.taken.map((i) => i.path)).toEqual(["ruleset.adjudication"]);
  expect((await head()).ruleset?.adjudication?.preset).toBe("balanced");
  await expect(applyRules(deps, { rules: "classic", take: ["ruleset.sheet"], preview: false })).rejects.toBeInstanceOf(RulesRefused);
  await expect(applyRules(deps, { rules: "nonsense", take: [], preview: false })).rejects.toBeInstanceOf(RulesRefused);

  // The Undo of each Upgrade puts the chat back on the revision it came from, and the first its level too.
  await service.chats.undoUpgrade(USER, "c", taken.edit ?? "");
  expect(at("c").revision).toBe(done.revision ?? "");
  await service.chats.undoUpgrade(USER, "c", done.edit ?? "");
  expect(at("c").revision).toBe(made.revision);
  expect(at("c").realism.levels.d20 ?? 0).toBe(0);
});

test("a row is added to one of the rules' tables as a revision the chat moves to; a row that cannot work says why and writes nothing", async () => {
  const { service, made, deps, at } = await world();
  // A world with a traits table of the layer's shape (the data sets bring their own).
  await service.draft(USER, made.world.id, { op: "set", part: "ruleset", value: { d20: { tables: { traits: "d20.traits" } } } });
  const traits = { id: "d20.traits", pack: "d20", schema: d20Schema("traits"), revision: "r", label: "Traits", columns: D20_COLUMNS.traits, rows: {} };
  await service.draft(USER, made.world.id, { op: "put", collection: "tables", id: "d20.traits", value: traits as never });
  const kept = await service.commit(USER, made.world.id, { base: made.revision, source: "build" });
  await service.chats.upgrade(USER, "c", kept.revision);

  await expect(addRow(deps, { table: "feat", id: "power_attack", row: { label: "Power Attack" } })).rejects.toMatchObject({ code: "bad_row" });
  const added = await addRow(deps, { table: "feat", id: "power_attack", row: { label: "Power Attack", kind: "feat", text: "A penalty to hit for damage." } });
  expect(added.replaced).toBe(false);
  expect(added.revision).not.toBe(kept.revision);
  expect(at("c").revision).toBe(added.revision ?? "");
  expect(at("other").revision).toBe(made.revision);
  const row = (await service.read(USER, made.world.id)).world.tables["d20.traits"]?.rows.power_attack as unknown as { label: string };
  expect(row.label).toBe("Power Attack");
  // As given again, nothing is made; changed, it is a new revision.
  expect((await addRow(deps, { table: "feat", id: "power_attack", row: { label: "Power Attack", kind: "feat", text: "A penalty to hit for damage." } })).same).toBe(true);
  const changed = await addRow(deps, { table: "feat", id: "power_attack", row: { label: "Power Attack", kind: "feat", text: "More." } });
  expect(changed.replaced).toBe(true);
  expect(changed.revision).not.toBe(added.revision);
  const doc: WorldDoc = (await service.read(USER, made.world.id)).world;
  expect(Object.keys(doc.tables["d20.traits"]?.rows ?? {})).toEqual(["power_attack"]);
});

test("the tools say each answer in a line of the answers' file, and a row that cannot work says why", async () => {
  const bed = makeBed();
  const service = worldsOn(bed);
  const made = await service.create(USER, "Fernwick", "fantasy_town");
  const s = bed.store.user(USER);
  await bed.writes.run(() => s.createChat({ id: "tool-chat", world: made.world.id, revision: made.revision }));
  const turn = await bed.writes.run(() => s.beginTurn({ chat: "tool-chat", kind: "new" }));
  const deps: EngineDeps = { store: s, env: bed.store.env, writes: bed.writes, files: shippedTexts(), search: stateScan, ...PORTS, worlds: service };
  const tools = new Map((await engineTools(deps)).map((x) => [x.name, x]));
  const run = async (name: string, args: JsonObject): Promise<ToolResult> => {
    const ctx: ToolCtx = { scope: { user: USER, chat: "tool-chat", session: "s-1", turn: turn.id }, agent: { id: "gm-1", definition: "gm" }, run: "run-1", callId: `call-${Math.random()}`, signal: new AbortController().signal, onUpdate: () => undefined };
    return tools.get(name)!.run(args, ctx);
  };
  expect(tools.get("rules_apply")).toMatchObject({ lane: "engine", tier: "write" });
  const plan = await run("rules_apply", { rules: "classic", preview: true });
  expect(plan.error).toBeUndefined();
  wordsFromFiles(plan);
  expect(texts(plan).join(" ")).toContain("Nothing was changed");
  const done = await run("rules_apply", { rules: "classic" });
  expect(done.error).toBeUndefined();
  wordsFromFiles(done);
  expect(texts(done).join(" ")).toContain("no sheet yet");
  const bad = await run("rules_add", { table: "feat", id: "power_attack", row: { label: "Power Attack" } });
  expect(bad.error).toBe(true);
  wordsFromFiles(bad);
  const unknown = await run("rules_apply", { rules: "nonsense" });
  expect(unknown.error).toBe(true);
  wordsFromFiles(unknown);
});

// The world's document as an agent reads and edits it on the harness (`harness-tools/world.ts`):
// Build's own draft, lint, commit and Upgrade, through the store itself. Every write here is real:
// what a tool says it wrote is read back from the world's draft through the same port, and what it
// says is played is read back from the chat.

import { describe, expect, test } from "bun:test";
import schemaJson from "../../schemas/lre-world-v1.schema.json";
import { worldBuild, type WorldBuild } from "../../src/backend/agents/tools/harness-ports";
import type { ToolEnv } from "../../src/backend/agents/tools/registry";
import { WORLD_COLLECTIONS } from "../../src/backend/worlds";
import { renderPrompt } from "../../src/backend/prompts";
import { COLLECTION_SHAPES, PART_SHAPES, shapeTextId } from "../../src/shared/harness-texts-shapes";
import { HARNESS_AGENT, HARNESS_NOTE } from "../../src/shared/harness-texts";
import { WORLD_NOTE } from "../../src/shared/harness-texts-world";
import { isRecord, type JsonObject } from "../../src/shared/json";
import { MAP_SCHEMA } from "../../src/shared/maps";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import type { WorldDoc } from "../../src/shared/world";
import { stateOf } from "../support/mind-chat";
import { Rig } from "../support/rig";
import { HOME, POV } from "../support/tools";
import { answer, castChat, castEnv, castTurn, landingWriter, MARA, noModelCalls, refusal, type TurnSetup } from "./harness-cast-kit";
import { AUTHOR, beginTurn, harnessChat } from "./harness-driver";

/** A registry text as shipped, filled: what a tool answers when the user changed nothing. */
const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);

/**
 * The author's env on a fresh cast chat with the way to its world's document, and that way itself,
 * to read the store back. `as` gives the env of another turn on the same chat: a caller of another
 * tier, or a turn whose answers hold less.
 */
async function worldEnv(): Promise<{ rig: Rig; chatId: string; env: ToolEnv; build: WorldBuild; as: (setup: TurnSetup) => Promise<ToolEnv> }> {
  const { rig, chatId } = await castChat();
  await auto(rig);
  const build = await worldBuild(rig.rt, chatId, rig.host.userId);
  if (!build) throw new Error("the cast chat plays no world");
  const as = async (setup: TurnSetup): Promise<ToolEnv> => ({ ...castEnv(rig, chatId, await castTurn(rig, chatId, setup), HARNESS_AGENT.author, landingWriter(rig, chatId)), build });
  return { rig, chatId, build, as, env: await as({}) };
}

/** The world's document pinned to Auto (Settings → Changes from the reply), as a user pins it: what it ships with is `harness-world-made.test.ts`'s. */
async function auto(rig: Rig): Promise<void> {
  rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { world_document: { mode: "auto" } } } }));
}

/** The draft as the store has it now. */
async function draftOf(build: WorldBuild): Promise<{ doc: WorldDoc; stored: boolean; version: number }> {
  const got = await build.edit({ op: "get" });
  return { doc: got.draft, stored: got.stored, version: got.version };
}

const PIER: JsonObject = { title: "The old pier", content: "The old pier burned in the year of the long fog.", keys: ["pier"], links: [] };
const text = (value: JsonObject | JsonObject[]): string => JSON.stringify(value);

describe("world_status", () => {
  test("says the revision the chat plays, the head, and how the draft stands, with its lint", async () => {
    const { rig, env, build } = await worldEnv();
    const head = await build.head();
    expect(await answer(env, "world_status")).toMatchObject({ playing: head, head, behind: false, draft: { stored: false, base: head } });
    // An item whose kind the world doesn't have: the draft is stored, and its lint has the error.
    await answer(env, "world_put", { collection: "entities", id: "brann", value: text({ kind: "no_such_kind", name: "Brann", tier: "background", fields: {}, relations: [] }) });
    const after = await answer(env, "world_status");
    const stored = await draftOf(build);
    expect(after).toMatchObject({ draft: { stored: true, version: stored.version, base: head } });
    const lint = after.lint as { errors: number; issues: { severity: string; path: string }[] };
    expect(lint.errors).toBeGreaterThan(0);
    expect(lint.issues[0]).toMatchObject({ severity: "error" });
    expect(lint.issues.some((i) => i.path.includes("brann"))).toBe(true);
    // A call with no way to the world's document says so.
    expect(await refusal({ ...env, build: null }, "world_status")).toContain("can't be reached");
    noModelCalls(rig);
  });
});

describe("world_read", () => {
  test("reads the draft at a pointer, or the revision the chat plays; a long value comes back as an outline", async () => {
    const { rig, env, build } = await worldEnv();
    const { doc } = await draftOf(build);
    const mara = await answer(env, "world_read", { pointer: `/entities/${MARA}` });
    expect(mara).toMatchObject({ source: "draft", pointer: `/entities/${MARA}`, value: { id: MARA, name: "Mara" } });
    expect((await answer(env, "world_read", { pointer: `/entities/${MARA}/name` })).value).toBe("Mara");
    expect((await answer(env, "world_read", { pointer: "/calendar/dayParts/0" })).value).toEqual(doc.calendar.dayParts[0] as unknown as JsonObject);
    // The whole document is longer than one answer: its outline says what each member holds.
    const root = await answer(env, "world_read");
    expect(root.value).toBeUndefined();
    expect(root.outline).toMatchObject({ entities: { object: Object.keys(doc.entities).length }, name: { text: doc.name.length }, lenientPricing: doc.lenientPricing });
    expect(String(root.note)).toContain("longer pointer");
    // What the chat plays hasn't what the draft was given since.
    await answer(env, "world_put", { collection: "lore", id: "old_pier", value: text(PIER) });
    expect((await answer(env, "world_read", { pointer: "/lore/old_pier/title" })).value).toBe("The old pier");
    const playing = await refusal(env, "world_read", { pointer: "/lore/old_pier/title", source: "playing" });
    expect(playing).toContain("no member old_pier");
    expect(await answer(env, "world_read", { pointer: `/entities/${MARA}/name`, source: "playing" })).toMatchObject({ source: "playing", revision: await build.head(), value: "Mara" });
    noModelCalls(rig);
  });

  test("an outline too long for one answer is cut, and read on from its last member", async () => {
    const { rig, as, build } = await worldEnv();
    const { doc } = await draftOf(build);
    const settings = await rig.rt.settings.get(rig.host.userId);
    const env = await as({ settings: { ...settings, agents: { ...settings.agents, clipChars: 200 } } });
    const ids = Object.keys(doc.entities);
    const seen: string[] = [];
    let after: string | undefined;
    for (let page = 0; page < ids.length && seen.length < ids.length; page++) {
      const part = await answer(env, "world_read", { pointer: "/entities", ...(after !== undefined ? { after } : {}) });
      const shown = Object.keys(part.outline as JsonObject);
      expect(shown.length).toBeGreaterThan(0);
      seen.push(...shown);
      after = shown[shown.length - 1];
      if (seen.length < ids.length) expect(String(part.more)).toContain(`after: ${after}`);
      else expect(part.more).toBeUndefined();
    }
    expect(seen).toEqual(ids);
    expect(await refusal(env, "world_read", { pointer: "/entities", after: "nobody" })).toContain("no member nobody");
    noModelCalls(rig);
  });

  test("a pointer that names nothing is refused with what there is at its last good step", async () => {
    const { rig, env } = await worldEnv();
    const member = await refusal(env, "world_read", { pointer: `/entities/${MARA}/nmae` });
    expect(member).toContain(`"/entities/${MARA}" has no member nmae`);
    expect(member).toContain("name");
    expect(await refusal(env, "world_read", { pointer: "/calendar/dayParts/99" })).toContain("read by index from 0");
    expect(await refusal(env, "world_read", { pointer: `/entities/${MARA}/name/first` })).toContain(`Read it at /entities/${MARA}/name`);
    expect(await refusal(env, "world_read", { pointer: "entities" })).toContain("starts with /");
    expect(await refusal(env, "world_read", { source: "head" })).toContain("draft, playing");
    noModelCalls(rig);
  });
});

// ---------------------------------------------------------------- the shapes against the schema

type Node = Record<string, unknown>;

/** Every member name `node` may hold, at any depth, through the schema's own references and the map schema's. */
function memberNames(node: unknown, root: Node, out = new Set<string>(), seen = new Set<unknown>()): Set<string> {
  if (!isRecord(node) || seen.has(node)) return out;
  seen.add(node);
  if (typeof node.$ref === "string") {
    const own = node.$ref.startsWith("#/$defs/");
    const next: Node = own ? root : (MAP_SCHEMA as unknown as Node);
    memberNames(own ? (root.$defs as Node)[node.$ref.slice("#/$defs/".length)] : next, next, out, seen);
  }
  if (isRecord(node.properties)) {
    for (const [name, value] of Object.entries(node.properties)) {
      out.add(name);
      memberNames(value, root, out, seen);
    }
  }
  for (const key of ["items", "additionalProperties"]) memberNames(node[key], root, out, seen);
  for (const key of ["anyOf", "oneOf", "allOf"]) for (const option of Array.isArray(node[key]) ? (node[key] as unknown[]) : []) memberNames(option, root, out, seen);
  return out;
}

/** The members `node` requires, read through a reference. */
function requiredOf(node: Node, root: Node): string[] {
  if (typeof node.$ref === "string") return node.$ref.startsWith("#/$defs/") ? requiredOf((root.$defs as Node)[node.$ref.slice("#/$defs/".length)] as Node, root) : requiredOf(MAP_SCHEMA as unknown as Node, MAP_SCHEMA as unknown as Node);
  return Array.isArray(node.required) ? (node.required as string[]) : [];
}

describe("world_shape", () => {
  const schema = schemaJson as unknown as Node;
  const props = schema.properties as Record<string, Node>;
  // The two parts that are no member of the document: `meta` writes these of the root's, and `tiers` the tiers with the spawn tier.
  const META = ["name", "pov", "start", "seedMode", "lenientPricing", "currency", "narrator", "spawnCap", "placeCap", "placesPerTurn", "lifeStates", "mapSettings", "loreBooks"];
  const pick = (names: readonly string[]): Node => ({ type: "object", properties: Object.fromEntries(names.map((name) => [name, props[name]])), required: names.filter((name) => (schema.required as string[]).includes(name)) });
  const items: [string, string, Node, string[]][] = [
    ...Object.entries(COLLECTION_SHAPES).map(([name, shape]): [string, string, Node, string[]] => [name, shape, props[name]?.additionalProperties as Node, []]),
    ...Object.entries(PART_SHAPES).map(([name, shape]): [string, string, Node, string[]] => {
      if (name === "meta") return [name, shape, pick(META), []];
      if (name === "tiers") return [name, shape, pick(["tiers", "spawnTier"]), requiredOf(props.tiers?.additionalProperties as Node, schema)];
      return [name, shape, props[name] as Node, []];
    }),
  ];

  test("there is a shape for every collection and every part of the document", () => {
    expect(Object.keys(COLLECTION_SHAPES).sort()).toEqual(Object.keys(WORLD_COLLECTIONS).sort());
    expect(Object.keys(PART_SHAPES).sort()).toEqual(["calendar", "loreIndex", "lorePins", "meta", "minds", "needs", "realism", "routineSettings", "ruleset", "tiers", "time"]);
    for (const [name, , node] of items) expect({ name, described: isRecord(node) }).toEqual({ name, described: true });
  });

  test.each(items)("the shape of %s names every member the schema requires, and none it lacks", (_name, shape, node, alsoRequired) => {
    const named = [...shape.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? "");
    expect(named.length).toBeGreaterThan(0);
    const members = memberNames(node, schema);
    expect(named.filter((name) => !members.has(name))).toEqual([]);
    expect([...requiredOf(node, schema), ...alsoRequired].filter((name) => !named.includes(name))).toEqual([]);
  });

  test("answers a collection's shape with examples to read, and a part's with where it is read", async () => {
    const { rig, env, build } = await worldEnv();
    const { doc } = await draftOf(build);
    const entities = await answer(env, "world_shape", { of: "entities" });
    expect(entities).toMatchObject({ collection: "entities", shape: COLLECTION_SHAPES.entities, items: Object.keys(doc.entities).length });
    const examples = entities.examples as string[];
    expect(examples.length).toBe(3);
    for (const pointer of examples) expect(isRecord((await answer(env, "world_read", { pointer })).value)).toBe(true);
    expect(String(entities.next)).toContain("world_put");
    const calendar = await answer(env, "world_shape", { of: "calendar" });
    expect(calendar).toMatchObject({ part: "calendar", shape: PART_SHAPES.calendar, at: ["/calendar"] });
    expect(isRecord((await answer(env, "world_read", { pointer: "/calendar" })).value)).toBe(true);
    expect(String(calendar.next)).toContain("world_set");
    // Every shape is a text of the registry, under its own id.
    for (const name of [...Object.keys(COLLECTION_SHAPES), ...Object.keys(PART_SHAPES)]) expect((await env.reader.view()).text(shapeTextId(name as keyof typeof PART_SHAPES)).length).toBeGreaterThan(0);
    const unknown = await refusal(env, "world_shape", { of: "quests" });
    expect(unknown).toContain("tracks");
    expect(unknown).toContain("calendar");
    expect(await refusal(env, "world_shape", {})).toContain("of");
    noModelCalls(rig);
  });
});

// ---------------------------------------------------------------- writes of the draft

describe("world_put and world_remove", () => {
  test("write one item whole, replace it, and take it out again", async () => {
    const { rig, env, build } = await worldEnv();
    const playing = await build.head();
    const added = await answer(env, "world_put", { collection: "lore", id: "old_pier", value: text(PIER) });
    expect(String(added.changed)).toContain("Added old_pier");
    expect(String(added.next)).toContain(`still plays revision ${playing}`);
    const first = await draftOf(build);
    // A new item written without its id takes its key.
    expect(first.doc.lore.old_pier).toMatchObject({ id: "old_pier", title: "The old pier" });
    expect(added.draft).toEqual({ version: first.version });
    const replaced = await answer(env, "world_put", { collection: "lore", id: "old_pier", value: { ...PIER, id: "old_pier", title: "The burned pier" } });
    expect(String(replaced.changed)).toContain("Replaced old_pier");
    expect((await draftOf(build)).doc.lore.old_pier?.title).toBe("The burned pier");
    const removed = await answer(env, "world_remove", { collection: "lore", id: "old_pier" });
    expect(String(removed.changed)).toContain("Removed old_pier");
    expect((await draftOf(build)).doc.lore.old_pier).toBeUndefined();
    noModelCalls(rig);
  });

  test("a write that brings an error says so in its answer's lint", async () => {
    const { rig, env } = await worldEnv();
    const put = await answer(env, "world_put", { collection: "entities", id: "brann", value: text({ kind: "no_such_kind", name: "Brann", tier: "background", fields: {}, relations: [] }) });
    const lint = put.lint as { errors: number; new: { severity: string; path: string; message: string }[] };
    expect(lint.errors).toBeGreaterThan(0);
    expect(lint.new[0]).toMatchObject({ severity: "error" });
    expect(lint.new.some((i) => i.path.includes("brann"))).toBe(true);
    noModelCalls(rig);
  });

  test("refusals say what to fix", async () => {
    const { rig, env, build } = await worldEnv();
    const notJson = await refusal(env, "world_put", { collection: "lore", id: "old_pier", value: "the old pier burned" });
    expect(notJson).toContain("JSON object");
    expect(notJson).toContain("world_shape");
    expect(await refusal(env, "world_put", { collection: "lore", id: "old_pier" })).toContain("value");
    expect(await refusal(env, "world_put", { collection: "lore", value: text(PIER) })).toContain("id");
    const collection = await refusal(env, "world_put", { collection: "quests", id: "old_pier", value: text(PIER) });
    expect(collection).toContain("tracks");
    // What the store refuses comes back in its words, with where the shape is found.
    const drawn = await refusal(env, "world_put", { collection: "lore", id: "old_pier", value: text({ ...PIER, map: "harbor" }) });
    expect(drawn).toContain("only a map marks what it draws");
    expect(drawn).toContain("world_shape (of: lore)");
    const none = await refusal(env, "world_remove", { collection: "lore", id: "old_pier" });
    expect(none).toContain("no old_pier");
    expect(await refusal(env, "world_remove", { collection: "entities", id: "nobody" })).toContain(MARA);
    expect(await refusal(env, "world_remove", { collection: "entities" })).toContain("id");
    expect((await draftOf(build)).stored).toBe(false);
    noModelCalls(rig);
  });

  test("a caller below the game master's tier is refused on every write, and reads all the same", async () => {
    const { rig, as, build } = await worldEnv();
    const reader = await as({ main: false });
    const writes: [string, JsonObject][] = [
      ["world_put", { collection: "lore", id: "old_pier", value: text(PIER) }],
      ["world_remove", { collection: "entities", id: MARA }],
      ["world_set", { part: "loreIndex", value: text({ terms: {}, topics: {} }) }],
      ["world_patch", { ops: text([{ op: "remove", path: `/entities/${MARA}` }]) }],
      ["world_discard", {}],
      ["world_commit", {}],
      ["world_upgrade", {}],
      ["world_restore", { revision: await build.head() }],
      ["world_keep", { things: ["anything"] }],
    ];
    for (const [name, args] of writes) expect({ name, refused: await refusal(reader, name, args) }).toEqual({ name, refused: expect.stringContaining("Only the game master's tier") });
    expect(await draftOf(build)).toMatchObject({ stored: false });
    for (const name of ["world_status", "world_read", "world_history", "world_made"]) expect(isRecord(await answer(reader, name))).toBe(true);
    expect((await answer(reader, "world_shape", { of: "lore" })).collection).toBe("lore");
    // Once the author granted it the game master's tier, it writes.
    const granted = await as({ main: false, tier: "gm" });
    await answer(granted, "world_put", { collection: "lore", id: "old_pier", value: text(PIER) });
    expect((await draftOf(build)).doc.lore.old_pier?.title).toBe("The old pier");
    noModelCalls(rig);
  });
});

describe("world_set", () => {
  test("writes one part whole; a part the document hasn't, or a value that is no object, is refused", async () => {
    const { rig, env, build } = await worldEnv();
    const calendar = (await answer(env, "world_read", { pointer: "/calendar" })).value as JsonObject;
    const zone = calendar.timeZone === "Europe/Lisbon" ? "Europe/Madrid" : "Europe/Lisbon";
    const set = await answer(env, "world_set", { part: "calendar", value: text({ ...calendar, timeZone: zone }) });
    expect(String(set.changed)).toContain("calendar");
    expect((await draftOf(build)).doc.calendar.timeZone).toBe(zone);
    // `meta` changes only the members it is given.
    const { doc } = await draftOf(build);
    await answer(env, "world_set", { part: "meta", value: text({ name: "Alder by the sea" }) });
    expect((await draftOf(build)).doc).toMatchObject({ name: "Alder by the sea", pov: doc.pov, start: doc.start });
    const part = await refusal(env, "world_set", { part: "weather", value: text({}) });
    expect(part).toContain("calendar");
    expect(part).toContain("routineSettings");
    expect(await refusal(env, "world_set", { part: "calendar", value: text([{ timeZone: zone }]) })).toContain("JSON object");
    expect(await refusal(env, "world_set", { part: "calendar" })).toContain("value");
    // The store's own refusal, with where the shape is found.
    const narrator = await refusal(env, "world_set", { part: "meta", value: text({ narrator: { knowledge: "everything" } }) });
    expect(narrator).toContain("narrator is");
    expect(narrator).toContain("world_shape (of: meta)");
    noModelCalls(rig);
  });
});

describe("world_patch", () => {
  test("changes the draft in place, all of its operations or none", async () => {
    const { rig, env, build } = await worldEnv();
    const before = (await draftOf(build)).doc;
    const zone = before.calendar.timeZone === "Europe/Lisbon" ? "Europe/Madrid" : "Europe/Lisbon";
    const patched = await answer(env, "world_patch", {
      ops: text([
        { op: "test", path: `/entities/${MARA}/name`, value: "Mara" },
        { op: "replace", path: "/calendar/timeZone", value: zone },
        { op: "add", path: "/lore/old_pier", value: { ...PIER, id: "old_pier" } },
      ]),
    });
    expect(String(patched.changed)).toContain("3 operations");
    const after = await draftOf(build);
    expect(after.doc.calendar.timeZone).toBe(zone);
    expect(after.doc.lore.old_pier?.title).toBe("The old pier");
    expect(patched.draft).toEqual({ version: after.version });
    // One operation that can't be made leaves the others unmade too.
    const missing = await refusal(env, "world_patch", { ops: text([{ op: "replace", path: "/calendar/timeZone", value: "UTC" }, { op: "replace", path: "/lore/no_such_entry/title", value: "x" }]) });
    expect(missing).toContain("Nothing was written");
    expect(missing).toContain("world_shape");
    expect((await draftOf(build)).doc.calendar.timeZone).toBe(zone);
    expect(await refusal(env, "world_patch", { ops: text([{ op: "replace", path: "/id", value: "another_world" }]) })).toContain("can't change /id");
    expect(await refusal(env, "world_patch", { ops: text({ op: "replace", path: "/calendar/timeZone", value: "UTC" }) })).toContain("JSON array");
    expect(await refusal(env, "world_patch", { ops: "replace the time zone" })).toContain("JSON array");
    expect(await refusal(env, "world_patch", {})).toContain("JSON array");
    expect((await draftOf(build)).version).toBe(after.version);
    noModelCalls(rig);
  });
});

describe("world_discard", () => {
  test("drops the draft; with none stored it says there is nothing to drop", async () => {
    const { rig, env, build } = await worldEnv();
    expect(await refusal(env, "world_discard")).toContain("nothing to drop");
    await answer(env, "world_put", { collection: "lore", id: "old_pier", value: text(PIER) });
    expect((await draftOf(build)).stored).toBe(true);
    // The draft is Build's working copy too: it is dropped only at the version the caller read.
    const stored = (await draftOf(build)).version;
    expect(await refusal(env, "world_discard")).toContain("version");
    const moved = await refusal(env, "world_discard", { version: stored + 5 });
    expect(moved).toContain(`The draft is at version ${stored} now, not ${stored + 5}`);
    expect((await draftOf(build)).stored).toBe(true);
    await answer(env, "world_discard", { version: stored });
    const after = await draftOf(build);
    expect(after.stored).toBe(false);
    expect(after.doc.lore.old_pier).toBeUndefined();
    noModelCalls(rig);
  });

  test("the arguments that narrow a read or guard a write: issues, limit, kind, and a commit's version", async () => {
    const { rig, env, build } = await worldEnv();
    // world_status lists every issue, or only the errors; the counts are of all of them either way.
    const all = (await answer(env, "world_status")) as { lint: { infos?: number; issues?: unknown[] } };
    const errors = (await answer(env, "world_status", { issues: "errors" })) as { lint: { infos?: number; issues?: unknown[] } };
    expect(errors.lint.infos).toBe(all.lint.infos);
    expect(errors.lint.issues).toBeUndefined();
    const which = await refusal(env, "world_status", { issues: "some" });
    expect(which).toContain("some");
    expect(which).toContain("errors");
    // world_history lists as many of the newest as asked for, and says how many more there are.
    await answer(env, "world_put", { collection: "lore", id: "old_pier", value: text(PIER) });
    await answer(env, "world_commit", { note: "the old pier" });
    const newest = (await answer(env, "world_history", { limit: 1 })) as { revisions: { head?: boolean }[]; more?: number };
    expect(newest.revisions).toHaveLength(1);
    expect(newest.revisions[0]?.head).toBe(true);
    expect(newest.more).toBeGreaterThan(0);
    // world_made takes only the things or only the places, and says so of anything else.
    const kind = await refusal(env, "world_made", { kind: "people" });
    expect(kind).toContain("people");
    expect(kind).toContain("places");
    // A commit that names the version it read commits nothing written since, unseen.
    await answer(env, "world_put", { collection: "lore", id: "old_pier", value: text({ ...PIER, id: "old_pier", title: "The old pier, rebuilt" }) });
    const version = (await draftOf(build)).version;
    expect(await refusal(env, "world_commit", { version: version - 1 })).toContain(`The draft is at version ${version} now`);
    expect((await draftOf(build)).stored).toBe(true);
    const headBefore = await build.head();
    await answer(env, "world_commit", { version });
    expect(await build.head()).not.toBe(headBefore);
    noModelCalls(rig);
  });
});

// ---------------------------------------------------------------- revisions

describe("world_commit, world_history and world_restore", () => {
  test("a draft with errors is refused with them; a clean one becomes the head, and an earlier revision is brought back as a draft", async () => {
    const { rig, env, build } = await worldEnv();
    const first = await build.head();
    expect(await refusal(env, "world_commit", { note: "nothing yet" })).toContain("nothing to commit");
    await answer(env, "world_put", { collection: "entities", id: "brann", value: text({ kind: "no_such_kind", name: "Brann", tier: "background", fields: {}, relations: [] }) });
    const errors = await refusal(env, "world_commit", { note: "Brann walks on" });
    expect(errors).toContain("Fix these");
    expect(errors).toContain("brann");
    expect(await build.head()).toBe(first);
    await answer(env, "world_remove", { collection: "entities", id: "brann" });
    await answer(env, "world_put", { collection: "lore", id: "old_pier", value: text(PIER) });
    await answer(env, "world_commit", { note: "The old pier's story" });
    const second = await build.head();
    expect(second).not.toBe(first);
    expect(await draftOf(build)).toMatchObject({ stored: false, doc: { lore: { old_pier: { title: "The old pier" } } } });

    const history = await answer(env, "world_history");
    expect(history).toMatchObject({ head: second, playing: first });
    const revisions = history.revisions as { revision: string; at: string; by: string; note?: string; head?: boolean; playing?: boolean }[];
    expect(revisions[0]).toMatchObject({ revision: second, by: "agent", note: "The old pier's story", head: true });
    expect(Number.isNaN(Date.parse(revisions[0]?.at ?? ""))).toBe(false);
    expect(revisions.find((r) => r.revision === first)).toMatchObject({ playing: true });
    expect(revisions.map((r) => r.revision)).toEqual((await build.history()).map((n) => n.revision).reverse());
    expect(await refusal({ ...env, build: null }, "world_history")).toContain("can't be reached");

    // The first revision again, as a draft to commit: the world's head stays until then.
    await answer(env, "world_restore", { revision: first });
    const draft = await draftOf(build);
    expect(draft.stored).toBe(true);
    expect(draft.doc.lore.old_pier).toBeUndefined();
    expect(await build.head()).toBe(second);
    const unknown = await refusal(env, "world_restore", { revision: "no_such_revision" });
    expect(unknown).toContain("world_history");
    expect(await refusal(env, "world_restore", {})).toContain("revision");
    noModelCalls(rig);
  });
});

describe("written, committed, played", () => {
  test("an item put in the draft reaches the chat once the draft is committed and the chat brought to it", async () => {
    // A turn as the bridge runs one: the author's calls cross the link, and the chat's ledger is the real one.
    const { rig, chatId } = await harnessChat();
    await auto(rig);
    const build = await worldBuild(rig.rt, chatId, rig.host.userId);
    if (!build) throw new Error("the harness chat plays no world");
    const first = await build.head();
    const turn = await beginTurn(rig, chatId, "I ask what became of the old pier.");
    await turn.answer(AUTHOR, "world_put", { collection: "lore", id: "old_pier", value: text(PIER) });
    // Written, not played: the chat's world hasn't it.
    expect((await stateOf(rig, chatId)).world.lore.old_pier).toBeUndefined();
    // Asked for in order and staged like every other change: nothing is made until the author commits.
    await turn.answer(AUTHOR, "world_commit", { note: "The old pier's story" });
    const staged = (await turn.answer(AUTHOR, "world_upgrade")).staged as { mode: string; lines: string[] };
    // The move in its own words, then what it would bring into play: the draft a waiting commit makes the head, against the revision played.
    expect(staged).toMatchObject({ mode: "auto", lines: ["Bring this chat to the head of its world, as it is when this is made (an Upgrade).", `What it brings of the world's document, against revision ${first}, which this chat plays (1):`, "lore: added The old pier (old_pier)"] });
    expect(await build.head()).toBe(first);
    const made = (await turn.answer(AUTHOR, "commit")).committed as { landed: string[][]; review: string[][]; refused: unknown[] };
    expect(made).toMatchObject({ review: [], refused: [] });
    const second = await build.head();
    expect(second).not.toBe(first);
    // What each came to is told with it: the new revision, and that the move waits for the turn's end.
    const told = made.landed.flat().join("\n");
    expect(told).toContain(`The draft is the world's revision ${second} now`);
    expect(told).toContain(`still plays revision ${first}`);
    expect(told).toContain(`the move to revision ${second} waits for this turn's end`);
    // Committed, not played: the chat still plays the revision it played.
    expect(await turn.answer(AUTHOR, "world_status")).toMatchObject({ playing: first, head: second, behind: true });
    expect((await turn.answer(AUTHOR, "world_read", { pointer: "/lore", source: "playing" })).value).not.toHaveProperty("old_pier");
    await turn.answer(AUTHOR, "time_pass", { minutes: 5 });
    await turn.finish("The pier burned in the year of the long fog, Mara says.");
    const played = await stateOf(rig, chatId);
    expect(played.state.revision).toBe(second);
    expect(played.world.lore.old_pier).toMatchObject({ title: "The old pier" });

    // The chat's next turn reads it of its world.
    const next = await beginTurn(rig, chatId, "I walk down to look at what is left of it.");
    expect(await next.answer(AUTHOR, "world_read", { pointer: "/lore/old_pier/title", source: "playing" })).toMatchObject({ revision: second, value: "The old pier" });
    expect(await next.answer(AUTHOR, "world_status")).toMatchObject({ playing: second, head: second, behind: false });
    expect(String((await next.answer(AUTHOR, "world_upgrade")).unchanged)).toContain("already");
    await next.finish("Black posts stand in the shallows.");

    // Outside a turn the move lands at once: back to the first revision, by name.
    const env = async (): Promise<ToolEnv> => ({ ...castEnv(rig, chatId, await castTurn(rig, chatId), HARNESS_AGENT.author, landingWriter(rig, chatId)), build });
    await answer(await env(), "world_upgrade", { to: first });
    expect((await stateOf(rig, chatId)).state.revision).toBe(first);
    expect((await stateOf(rig, chatId)).world.lore.old_pier).toBeUndefined();
    expect(await refusal(await env(), "world_read", { pointer: "/lore/old_pier", source: "playing" })).toContain("no member old_pier");
    // A revision the world hasn't is refused, with where its revisions are listed.
    const unknown = await refusal(await env(), "world_upgrade", { to: "no_such_revision" });
    expect(unknown).toContain("no revision no_such_revision");
    expect(unknown).toContain("world_history");
    expect((await stateOf(rig, chatId)).state.revision).toBe(first);
    noModelCalls(rig);
  });
});

describe("the world's document asks first", () => {
  /** The review card of the chat's last reply, applied whole: the player's Apply. */
  async function apply(rig: Rig, chatId: string): Promise<string[]> {
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    const cards = rig.body(await rig.send({ type: "lre.review", chatId, op: "apply", turn: `${reply.id}:0` })).cards as { items: { status: string }[] }[];
    return (cards[0]?.items ?? []).map((item) => item.status);
  }

  test("a user's saved Confirm still asks: a commit and the Upgrade that follows it wait on the review card, each listing what it would change against the world's head, and one Apply makes both", async () => {
    const { rig, chatId } = await harnessChat();
    await setMode(rig, "confirm");
    const build = await worldBuild(rig.rt, chatId, rig.host.userId);
    if (!build) throw new Error("the harness chat plays no world");
    const first = await build.head();
    const turn = await beginTurn(rig, chatId, "I ask what became of the old pier.");
    // Editing the draft is immediate, as Build's edits are: lore anyone may read, and someone the world keeps from the player's character.
    await turn.answer(AUTHOR, "world_put", { collection: "lore", id: "old_pier", value: text(PIER) });
    await turn.answer(AUTHOR, "world_put", { collection: "entities", id: "brann", value: text({ id: "brann", kind: "character", name: "Brann", tier: "background", visibility: "secret", fields: { place: HOME }, relations: [] }) });
    expect((await draftOf(build)).stored).toBe(true);
    const pov = (await stateOf(rig, chatId)).state.entities[POV]?.name ?? "";
    const hidden = `entities: changed ${secretMarkText("Brann (brann)", [], [pov], SECRET_MARK_WORDING)}`;
    const shown = "lore: added The old pier (old_pier)";
    const counted = note(WORLD_NOTE.changesHidden, { count: "1" });
    const commitLines = ["Commit the world's draft as the world's next revision (The old pier's story): every new chat of this world starts from it.", "What it commits, against the world's head (2):"];
    const moveLines = ["Bring this chat to the head of its world, as it is when this is made (an Upgrade).", `What it brings of the world's document, against revision ${first}, which this chat plays (2):`];
    // The agent that asks is told everything the commit would make part of the world, the one the world keeps secret marked as one.
    const asked = (await turn.answer(AUTHOR, "world_commit", { note: "The old pier's story" })).staged as { changeType: string; mode: string; lines: string[]; lands: string };
    expect(asked).toMatchObject({ changeType: "world_document", mode: "confirm" });
    expect([asked.lines.slice(0, 2), asked.lines.slice(2).sort()]).toEqual([commitLines, [hidden, shown].sort()]);
    expect(asked.lands).toContain("review card");
    // The move to what the commit makes is asked with it, and follows it: no revision is named. It lists what that revision would bring into play.
    const move = (await turn.answer(AUTHOR, "world_upgrade")).staged as { changeType: string; mode: string; lines: string[] };
    expect(move).toMatchObject({ changeType: "world_document", mode: "confirm" });
    expect([move.lines.slice(0, 2), move.lines.slice(2).sort()]).toEqual([moveLines, [hidden, shown].sort()]);
    // Nothing is committed: not by the tools, not by the author's commit, not by the reply.
    expect(await build.head()).toBe(first);
    const committed = (await turn.answer(AUTHOR, "commit")).committed as Committed;
    expect(committed.review).toEqual([asked.lines, move.lines]);
    await turn.finish("The pier burned in the year of the long fog, Mara says.");
    expect(await build.head()).toBe(first);
    expect((await stateOf(rig, chatId)).state.revision).toBe(first);
    // The review card lists the same for the player, who sees everything their Apply commits: what the world keeps from their character is counted there, never named.
    const reply = rig.host.head(chatId);
    const cards = rig.body(await rig.send({ type: "lre.review", chatId, op: "get", turn: `${reply?.id ?? ""}:0` })).cards as { items: { changeType: string; lines: string[] }[] }[];
    expect((cards[0]?.items ?? []).map((item) => [item.changeType, item.lines])).toEqual([["world_document", [...commitLines, shown, counted]], ["world_document", [...moveLines, shown, counted]]]);
    // One Apply makes both, in the order asked: the draft is the world's head, and the chat plays it.
    expect(await apply(rig, chatId)).toEqual(["applied", "applied"]);
    const second = await build.head();
    expect(second).not.toBe(first);
    expect((await draftOf(build)).stored).toBe(false);
    expect((await stateOf(rig, chatId)).state.revision).toBe(second);
    noModelCalls(rig);
  });

  /** What the author's commit answers. */
  type Committed = { landed: string[][]; review: string[][]; refused: { lines: string[]; reason: string }[] };

  /** The mode of the world's document, as the player sets it (Settings → Changes from the reply). */
  async function setMode(rig: Rig, mode: "auto" | "confirm" | "never"): Promise<void> {
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { world_document: { mode } } } }));
  }

  /**
   * One turn on a fresh chat: the draft written and its commit asked for under `from`, the mode set
   * to `to` while the turn runs, then the author's commit. The mode that counts is the one set when
   * the author commits.
   */
  async function changed(from: "auto" | "confirm", to: "auto" | "confirm" | "never"): Promise<{ rig: Rig; chatId: string; build: WorldBuild; first: string; lines: string[]; done: Committed }> {
    const { rig, chatId } = await harnessChat();
    await setMode(rig, from);
    const build = await worldBuild(rig.rt, chatId, rig.host.userId);
    if (!build) throw new Error("the harness chat plays no world");
    const first = await build.head();
    const turn = await beginTurn(rig, chatId, "I ask what became of the old pier.");
    await turn.answer(AUTHOR, "world_put", { collection: "lore", id: "old_pier", value: text(PIER) });
    const asked = (await turn.answer(AUTHOR, "world_commit")).staged as { mode: string; lines: string[] };
    expect(asked.mode).toBe(from);
    await setMode(rig, to);
    const done = (await turn.answer(AUTHOR, "commit")).committed as Committed;
    await turn.finish("The pier burned in the year of the long fog, Mara says.");
    return { rig, chatId, build, first, lines: asked.lines, done };
  }

  test("asked under Confirm and set to Auto before the author commits: it lands with the commit", async () => {
    const { rig, build, first, lines, done } = await changed("confirm", "auto");
    expect(done).toMatchObject({ review: [], refused: [] });
    expect(done.landed.some((landed) => landed[0] === lines[0])).toBe(true);
    expect(await build.head()).not.toBe(first);
    noModelCalls(rig);
  });

  test("asked under Auto and set to Confirm before the author commits: it goes to the review card, and Apply makes it", async () => {
    const { rig, chatId, build, first, lines, done } = await changed("auto", "confirm");
    expect(done.review).toEqual([lines]);
    expect(done.landed.flat()).not.toContain(lines[0]);
    expect(await build.head()).toBe(first);
    expect(await apply(rig, chatId)).toEqual(["applied"]);
    expect(await build.head()).not.toBe(first);
    noModelCalls(rig);
  });

  test("set to Never before the author commits, whatever it was asked under: it is refused, and the author is told why", async () => {
    for (const from of ["auto", "confirm"] as const) {
      const { rig, build, first, lines, done } = await changed(from, "never");
      expect(done.review).toEqual([]);
      expect(done.refused).toEqual([{ lines, reason: expect.stringContaining("The world's document") }]);
      expect(done.landed.flat()).not.toContain(lines[0]);
      expect(await build.head()).toBe(first);
      noModelCalls(rig);
    }
  });

  test("under Confirm a draft is neither dropped nor replaced by a revision until Apply", async () => {
    const { rig, chatId } = await harnessChat();
    await setMode(rig, "confirm");
    const build = await worldBuild(rig.rt, chatId, rig.host.userId);
    if (!build) throw new Error("the harness chat plays no world");
    const head = await build.head();
    const turn = await beginTurn(rig, chatId, "I ask what became of the old pier.");
    await turn.answer(AUTHOR, "world_put", { collection: "lore", id: "old_pier", value: text(PIER) });
    const version = (await draftOf(build)).version;
    const restore = (await turn.answer(AUTHOR, "world_restore", { revision: head })).staged as { lines: string[] };
    // The head's own copy: what the draft holds now is replaced, and against the head nothing then differs.
    expect(restore.lines).toEqual([`Make the world's draft a copy of revision ${head}: what the draft holds now is replaced.`, note(WORLD_NOTE.changesNone)]);
    const drop = (await turn.answer(AUTHOR, "world_discard", { version })).staged as { lines: string[] };
    expect(drop.lines[0]).toContain(`Drop the world's draft (version ${version})`);
    await turn.finish("Mara shrugs.");
    // Both wait: the draft still holds what was written to it.
    expect((await draftOf(build)).doc.lore.old_pier).toMatchObject({ title: "The old pier" });
    // Apply makes them in the order asked: the draft becomes the head's copy, then is dropped at the version the call named, which the restore moved on, so the drop is told as refused.
    const statuses = await apply(rig, chatId);
    expect(statuses[0]).toBe("applied");
    expect((await draftOf(build)).doc.lore.old_pier).toBeUndefined();
    noModelCalls(rig);
  });

  test("under Auto each is made at once; under Never every write of the document is refused, the draft's own edits too, and reads still answer", async () => {
    const { rig, env, build } = await worldEnv();
    const head = await build.head();
    await answer(env, "world_put", { collection: "lore", id: "old_pier", value: text(PIER) });
    // Auto (set by `worldEnv`), with a writer that lands what is staged at once, as a commit would.
    await answer(env, "world_commit");
    const second = await build.head();
    expect(second).not.toBe(head);
    await answer(env, "world_put", { collection: "lore", id: "old_pier", value: text({ ...PIER, id: "old_pier", title: "The old pier, rebuilt" }) });
    const version = (await draftOf(build)).version;
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { world_document: { mode: "never" } } } }));
    // An act on the document and an edit of its draft alike: each answered as the writer answers a change under Never, before anything is read of the call.
    const writes: [string, JsonObject][] = [
      ["world_commit", {}],
      ["world_discard", { version }],
      ["world_restore", { revision: head }],
      ["world_upgrade", { to: head }],
      ["world_put", { collection: "lore", id: "old_pier", value: text({ ...PIER, id: "old_pier", title: "The old pier, again" }) }],
      ["world_remove", { collection: "lore", id: "old_pier" }],
      ["world_set", { part: "meta", value: text({ name: "Another name" }) }],
      ["world_patch", { ops: text([{ op: "replace", path: "/name", value: "Another name" }]) }],
      ["world_keep", { things: ["anything"] }],
      ["world_place", { name: "The Old Mill", parent: HOME }],
      ["world_path", {}],
      ["world_map", {}],
      ["world_map_place", {}],
      ["world_map_link", {}],
      ["world_map_settings", {}],
    ];
    for (const [name, args] of writes) {
      const never = await refusal(env, name, args);
      expect({ name, refused: JSON.parse(never) as unknown }).toEqual({ name, refused: { refused: { code: "mode_never", reason: expect.stringContaining("The world's document") } } });
    }
    // Nothing happened: the head, the draft and the revision the chat plays are as they were.
    expect(await build.head()).toBe(second);
    expect((await draftOf(build)).version).toBe(version);
    // Reading is no write: the document, its draft and its history still answer.
    for (const name of ["world_status", "world_read", "world_history", "world_made"]) expect((await answer(env, name)) !== null).toBe(true);
    expect((await answer(env, "world_shape", { of: "lore" })).collection).toBe("lore");
    noModelCalls(rig);
  });
});

describe("what is closed to agents in the world's document", () => {
  const CHARACTER = { id: "c-pov", role: HARNESS_AGENT.character };

  test("who the player's character is, and what the engine holds agents to, no draft tool writes, under any mode: by patch, by a parent's patch, by a part or by a pack", async () => {
    for (const mode of ["auto", "confirm"] as const) {
      const { rig, chatId } = await harnessChat({ minds: true });
      rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { world_document: { mode } } } }));
      const build = await worldBuild(rig.rt, chatId, rig.host.userId);
      if (!build) throw new Error("the harness chat plays no world");
      const doc = (await draftOf(build)).doc as unknown as { realism: JsonObject; packs: Record<string, JsonObject & { config?: JsonObject }> };
      const turn = await beginTurn(rig, chatId, "I wait.");
      const closed = (paths: string): string => note(WORLD_NOTE.closed, { paths });
      const tries: [string, JsonObject, string][] = [
        ["world_patch", { ops: text([{ op: "replace", path: "/pov", value: MARA }]) }, "/pov"],
        ["world_patch", { ops: text([{ op: "add", path: "/spawnCap", value: 9999 }]) }, "/spawnCap"],
        ["world_patch", { ops: text([{ op: "add", path: "/lore/old_pier", value: PIER }, { op: "add", path: "/placeCap", value: 9999 }]) }, "/placeCap"],
        ["world_patch", { ops: text([{ op: "replace", path: "/realism", value: { ...doc.realism, claims: "anything goes" } }]) }, "/realism/claims"],
        ["world_set", { part: "meta", value: text({ pov: MARA }) }, "/pov"],
        ["world_set", { part: "meta", value: text({ name: "Alder", spawnCap: 9999, placesPerTurn: 99 }) }, "/spawnCap, /placesPerTurn"],
        ["world_set", { part: "realism", value: text({ ...doc.realism, claims: "anything goes" }) }, "/realism/claims"],
        ["world_put", { collection: "packs", id: "economy", value: text({ ...doc.packs.economy, config: { ...doc.packs.economy?.config, claimCap: 99999999 } }) }, "/packs/economy/config/claimCap"],
      ];
      // Each is refused with the paths it would change (a refused write also says where a shape is found, as any does).
      for (const [name, args, paths] of tries) expect({ mode, name, paths, says: (await turn.refusal(AUTHOR, name, args)).slice(0, closed(paths).length) }).toEqual({ mode, name, paths, says: closed(paths) });
      // Nothing was written, not even the open half of a patch; and what is open is written as before.
      expect((await draftOf(build)).stored).toBe(false);
      expect((await turn.answer(AUTHOR, "world_set", { part: "meta", value: text({ name: "Alder by the water" }) })).changed).toBeDefined();
      await turn.finish("Nothing happens.");
      // The player's character is who it was: a character's agent is still refused their mind.
      const state = (await stateOf(rig, chatId)).state;
      const next = await beginTurn(rig, chatId, "I wait again.");
      expect(await next.refusal(CHARACTER, "mind_view", { who: POV })).toBe(note(HARNESS_NOTE.playerMind, { name: state.entities[POV]?.name ?? "" }));
      noModelCalls(rig);
    }
  });

  test("nor does any agent commit, restore or bring into play the user's own change of one: each is refused where it is asked, with the paths", async () => {
    const { rig, chatId } = await harnessChat({ minds: true });
    await auto(rig);
    const build = await worldBuild(rig.rt, chatId, rig.host.userId);
    if (!build) throw new Error("the harness chat plays no world");
    const first = await build.head();
    // The user changes who their character is, in Build's own draft.
    rig.body(await rig.send({ type: "lre.editor", op: "set", worldId: build.worldId, base: null, part: "meta", value: { pov: MARA } }));
    const turn = await beginTurn(rig, chatId, "I wait.");
    // Committing it is theirs: no agent's commit makes it the head, whatever the mode.
    expect(await turn.refusal(AUTHOR, "world_commit")).toBe(note(WORLD_NOTE.closedCommit, { paths: "/pov" }));
    expect(await build.head()).toBe(first);
    // They commit it in Build; the chat still plays the revision it played.
    const second = String(rig.body(await rig.send({ type: "lre.world", op: "commit", worldId: build.worldId, base: null })).revision);
    expect([await build.head(), (await stateOf(rig, chatId)).state.revision]).toEqual([second, first]);
    // Bringing the chat to it is theirs too, named or as the head; and so is putting the old one back into the draft.
    const moves: JsonObject[] = [{}, { to: second }];
    for (const args of moves) expect(await turn.refusal(AUTHOR, "world_upgrade", args)).toBe(note(WORLD_NOTE.closedUpgrade, { revision: second, paths: "/pov" }));
    expect(await turn.refusal(AUTHOR, "world_restore", { revision: first })).toBe(note(WORLD_NOTE.closedRestore, { revision: first, paths: "/pov" }));
    expect((await turn.answer(AUTHOR, "commit")).committed).toMatchObject({ landed: [], review: [], refused: [] });
    await turn.finish("Nothing happens.");
    expect([(await stateOf(rig, chatId)).state.revision, (await draftOf(build)).stored]).toEqual([first, false]);
    noModelCalls(rig);
  });
});

describe("a turn stopped after it asked for an Upgrade", () => {
  /**
   * One turn that writes a place of the world's own and asks for the commit and the Upgrade, with
   * the author's own commit of the turn where `commits`, and is then stopped by the user; then what
   * the ledger folds and what the next turn's tools say.
   */
  async function stopped(mode: "auto" | "confirm", commits: boolean): Promise<{ rig: Rig; first: string; head: string; fold: string; status: { playing: string; head: string; behind: boolean }; found: boolean }> {
    const { rig, chatId } = await harnessChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { world_document: { mode } } } }));
    const build = await worldBuild(rig.rt, chatId, rig.host.userId);
    if (!build) throw new Error("the harness chat plays no world");
    const first = await build.head();
    const one = await beginTurn(rig, chatId, "I ask about the mill.");
    await one.answer(AUTHOR, "world_place", { name: "The Old Mill", parent: HOME });
    await one.answer(AUTHOR, "world_commit");
    await one.answer(AUTHOR, "world_upgrade");
    if (commits) await one.answer(AUTHOR, "commit");
    await one.end("stopped", { reason: "the user pressed Stop" });
    if (one.generation) await rig.host.stop(one.generation, "");
    await rig.host.settle();
    const fold = (await stateOf(rig, chatId)).state.revision;
    const two = await beginTurn(rig, chatId, "I look for the mill.");
    const status = (await two.answer(AUTHOR, "world_status")) as { playing: string; head: string; behind: boolean };
    const found = (await two.call(AUTHOR, "places_read", { place: "The Old Mill" })).error !== true;
    // The fold says the same while that turn runs, and once it has ended.
    expect((await stateOf(rig, chatId)).state.revision).toBe(fold);
    await two.finish("Nothing yet.");
    expect((await stateOf(rig, chatId)).state.revision).toBe(fold);
    return { rig, first, head: await build.head(), fold, status: { playing: status.playing, head: status.head, behind: status.behind }, found };
  }

  test("stopped before its author committed, whatever the mode: nothing was made, and the world's head, the ledger's fold and the next turn's tools agree on the revision that was played before", async () => {
    for (const mode of ["confirm", "auto"] as const) {
      const { rig, first, head, fold, status, found } = await stopped(mode, false);
      expect({ mode, head, fold, status, found }).toEqual({ mode, head: first, fold: first, status: { playing: first, head: first, behind: false }, found: false });
      noModelCalls(rig);
    }
  });

  test("stopped after its author committed: under Confirm the two waited on a card that no reply came to hold, so nothing was made; where the document lands by itself what the commit made stands, and the fold and the tools still answer one way", async () => {
    const asked = await stopped("confirm", true);
    expect({ head: asked.head, fold: asked.fold, status: asked.status, found: asked.found }).toEqual({ head: asked.first, fold: asked.first, status: { playing: asked.first, head: asked.first, behind: false }, found: false });
    noModelCalls(asked.rig);
    const landed = await stopped("auto", true);
    // The world's commit was the mode's to let land, and landed. Whichever revision the chat plays after the stop, everyone says the same one: the fold, the tools, and whether the place is there to read.
    expect(landed.head).not.toBe(landed.first);
    expect({ playing: landed.status.playing, head: landed.status.head, behind: landed.status.behind, found: landed.found }).toEqual({ playing: landed.fold, head: landed.head, behind: landed.fold !== landed.head, found: landed.fold === landed.head });
    noModelCalls(landed.rig);
  });
});

describe("what world_read shows of a secret", () => {
  test("a person and a lore entry the world keeps from the player's character are listed beside the value, each by its pointer and marked as every read marks one; the value stays the document's own", async () => {
    const SECRET_LORE: JsonObject = { title: "The cellar key", content: "The cellar key is under the third step.", keys: ["cellar"], links: [], visibility: "secret" };
    const { rig, chatId } = await harnessChat({ put: { entities: { brann: { id: "brann", kind: "character", name: "Brann", tier: "background", visibility: "secret", fields: { place: HOME }, relations: [] } }, lore: { cellar_key: SECRET_LORE, old_pier: PIER } } });
    const turn = await beginTurn(rig, chatId, "I look around.");
    const person = secretMarkText("/entities/brann: Brann", [], "everyone", SECRET_MARK_WORDING);
    for (const source of ["draft", "playing"]) {
      // The one read: its value unmarked, as the document has it, and beside it that it is a secret.
      const one = await turn.answer(AUTHOR, "world_read", { pointer: "/entities/brann", source });
      expect(one).toMatchObject({ value: { id: "brann", name: "Brann", visibility: "secret" }, secret: [person] });
      // Inside it, the same: a read of a secret's part is a read of the secret.
      expect((await turn.answer(AUTHOR, "world_read", { pointer: "/entities/brann/name", source })).secret).toEqual([person]);
      // A collection: each of its secrets by its pointer, and nothing for what anyone may read.
      const lore = await turn.answer(AUTHOR, "world_read", { pointer: "/lore", source });
      const listed = (lore.secret ?? []) as string[];
      expect(listed.filter((line) => line.startsWith("/lore/cellar_key: The cellar key")).map((line) => line.includes("[secret;"))).toEqual([true]);
      expect(listed.filter((line) => line.includes("old_pier"))).toEqual([]);
      expect((await turn.answer(AUTHOR, "world_read", { pointer: "/lore/old_pier", source })).secret).toBeUndefined();
      // The whole document, which comes back as an outline: its secrets are listed all the same.
      const root = (await turn.answer(AUTHOR, "world_read", { source })).secret as string[];
      expect(root).toContain(person);
    }
    noModelCalls(rig);
  });
});

describe("a draft begun on an older head", () => {
  test("is said by world_status and refused by world_commit with the reason, as Build's own commit refuses it; dropping it clears the way", async () => {
    const { rig, env, build } = await worldEnv();
    const first = await build.head();
    await answer(env, "world_put", { collection: "lore", id: "old_pier", value: text(PIER) });
    // A draft as another device left it: begun on the first head, stored while the head moved on.
    const stale = await draftOf(build);
    await answer(env, "world_commit");
    const second = await build.head();
    expect(second).not.toBe(first);
    await rig.host.storage.write(`worlds/${build.worldId}/draft.json`, JSON.stringify({ base: first, doc: { ...stale.doc, name: "Alder, as the other device left it" }, version: stale.version + 5 }), rig.host.userId);
    const status = (await answer(env, "world_status")) as { head: string; draft: { stored: boolean; base: string; version: number; stale?: string } };
    expect(status).toMatchObject({ head: second, draft: { stored: true, base: first } });
    expect(status.draft.stale ?? "").toContain(first);
    // The engine never rebases a draft: committing it would put back what was made head since, so it is refused with why and what to do.
    const refused = await refusal(env, "world_commit");
    expect(refused).toContain(first);
    expect(refused).toContain("world_discard");
    expect(await build.head()).toBe(second);
    // Dropping it is the way on: the working copy is the head again.
    await answer(env, "world_discard", { version: status.draft.version });
    expect(await answer(env, "world_status")).toMatchObject({ head: second, draft: { stored: false, base: second } });
    noModelCalls(rig);
  });
});

describe("an Upgrade before the chat's first turn", () => {
  /** A second revision of the chat's world, committed through Build's own requests. */
  async function secondRevision(rig: Rig, chatId: string): Promise<{ first: string; second: string }> {
    const run = await rig.rt.runOf(chatId, rig.host.userId);
    if (!run) throw new Error("the chat plays no world");
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId: run.worldId, base: null }));
    rig.body(await rig.send({ type: "lre.editor", op: "set", worldId: run.worldId, base: draft.base, part: "meta", value: { lenientPricing: true } }));
    return { first: run.revision, second: String(rig.body(await rig.send({ type: "lre.world", op: "commit", worldId: run.worldId, base: draft.base })).revision) };
  }

  test("Build's own Upgrade holds through the first turn of a classic chat", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const { first, second } = await secondRevision(rig, chatId);
    expect(second).not.toBe(first);
    expect(rig.body(await rig.send({ type: "lre.world", op: "upgrade", chatId, to: second }))).toMatchObject({ revision: second, pending: false });
    expect((await stateOf(rig, chatId)).state.revision).toBe(second);
    // The first turn starts the chat where the Upgrade left it, and the turns after it stay there.
    await rig.turn(chatId, "look around", "Quiet.");
    expect((await stateOf(rig, chatId)).state.revision).toBe(second);
    await rig.turn(chatId, "wait", "Time passes.");
    expect((await stateOf(rig, chatId)).state.revision).toBe(second);
  });

  test("Build's own Upgrade holds through the first turn of a harness chat, and a read shows it before that turn", async () => {
    const { rig, chatId } = await harnessChat();
    const build = await worldBuild(rig.rt, chatId, rig.host.userId);
    if (!build) throw new Error("the harness chat plays no world");
    const { second } = await secondRevision(rig, chatId);
    rig.body(await rig.send({ type: "lre.world", op: "upgrade", chatId, to: second }));
    // A read outside a turn, as a tool makes one, shows the revision the first turn will be played on.
    const env: ToolEnv = { ...castEnv(rig, chatId, await castTurn(rig, chatId)), build };
    expect(await answer(env, "world_status")).toMatchObject({ playing: second, head: second, behind: false });
    const turn = await beginTurn(rig, chatId, "I look around.");
    expect(await turn.answer(AUTHOR, "world_status")).toMatchObject({ playing: second, behind: false });
    await turn.finish("Quiet.");
    expect((await stateOf(rig, chatId)).state.revision).toBe(second);
    const next = await beginTurn(rig, chatId, "I wait.");
    expect(await next.answer(AUTHOR, "world_status")).toMatchObject({ playing: second, behind: false });
    await next.finish("Time passes.");
    noModelCalls(rig);
  });

  test("world_upgrade outside a turn lands at once, shows in every read, and holds through the first turn", async () => {
    // A chat as the bridge plays one, with no turn on it yet.
    const { rig, chatId } = await harnessChat();
    await auto(rig);
    const build = await worldBuild(rig.rt, chatId, rig.host.userId);
    if (!build) throw new Error("the harness chat plays no world");
    // An env built for each call, as the bridge builds one.
    const env = async (): Promise<ToolEnv> => ({ ...castEnv(rig, chatId, await castTurn(rig, chatId), HARNESS_AGENT.author, landingWriter(rig, chatId)), build });
    const first = await build.head();
    await answer(await env(), "world_put", { collection: "lore", id: "old_pier", value: text(PIER) });
    await answer(await env(), "world_commit");
    const second = await build.head();
    expect(second).not.toBe(first);
    await answer(await env(), "world_upgrade");
    // Made at once outside a turn: every read from here on shows it, before any turn.
    expect(await answer(await env(), "world_status")).toMatchObject({ playing: second, head: second, behind: false });
    expect(await answer(await env(), "world_read", { pointer: "/lore/old_pier/title", source: "playing" })).toMatchObject({ revision: second, value: "The old pier" });

    // The chat's first turn is played on it, and the turns after it.
    const turn = await beginTurn(rig, chatId, "I ask what became of the old pier.");
    expect(await turn.answer(AUTHOR, "world_status")).toMatchObject({ playing: second, behind: false });
    await turn.finish("The pier burned in the year of the long fog, Mara says.");
    const played = await stateOf(rig, chatId);
    expect(played.state.revision).toBe(second);
    expect(played.world.lore.old_pier).toMatchObject({ title: "The old pier" });
    const next = await beginTurn(rig, chatId, "I walk down to look.");
    expect(await next.answer(AUTHOR, "world_status")).toMatchObject({ playing: second, head: second, behind: false });
    await next.finish("Black posts stand in the shallows.");
    // Under Never the move back is refused in the writer's words, and the chat plays what it played.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { world_document: { mode: "never" } } } }));
    expect(await refusal(await env(), "world_upgrade", { to: first })).toContain("The world's document");
    expect((await stateOf(rig, chatId)).state.revision).toBe(second);
    noModelCalls(rig);
  });
});

// ---------------------------------------------------------------- keep in the world

describe("world_made and world_keep", () => {
  test("what the chat made in play is listed, and copied into the world's draft by name", async () => {
    const { rig, env, build } = await worldEnv();
    expect(String((await answer(env, "world_made")).note)).toContain("made nothing");
    expect(await refusal({ ...env, build: null }, "world_made")).toContain("can't be reached");
    await answer(env, "place_make", { name: "the back room", parent: HOME, as: "room", why: "the story walks into a back room" });
    await answer(env, "item_make", { name: "grey scarf", in: MARA, why: "she is wearing a grey scarf" });
    const made = await answer(env, "world_made");
    const places = made.places as { id: string; name: string; in: string; as: string; inDraft?: boolean }[];
    const things = made.things as { id: string; name: string; where: string; inDraft?: boolean }[];
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ name: "The back room", as: "room" });
    expect(places[0]?.inDraft).toBeUndefined();
    expect(places[0]?.in).toContain("114 Harbor Street");
    expect(things).toHaveLength(1);
    expect(things[0]?.where).toContain("Mara");
    expect(String(made.next)).toContain("world_keep");
    const id = places[0]?.id ?? "";
    const scarf = things[0]?.id ?? "";
    expect((await draftOf(build)).doc.places[id]).toBeUndefined();

    expect(await refusal(env, "world_keep", {})).toContain("Name what to keep");
    const nothing = await refusal(env, "world_keep", { places: ["a cellar no one made"] });
    expect(nothing).toContain("a cellar no one made");
    expect(nothing).toContain("world_made");
    expect((await draftOf(build)).stored).toBe(false);

    const kept = await answer(env, "world_keep", { places: ["The Back Room"], things: [things[0]?.name ?? ""] });
    expect(kept.kept).toEqual({ things: [scarf], places: [id] });
    expect(String(kept.changed)).toContain("1 of the things and 1 of the places");
    expect(String(kept.next)).toContain("world_commit");
    const draft = await draftOf(build);
    expect(draft.stored).toBe(true);
    expect(draft.doc.places[id]).toMatchObject({ name: "The back room", parent: HOME });
    expect(draft.doc.entities[scarf]).toMatchObject({ id: scarf });
    const after = await answer(env, "world_made");
    expect(after.places).toMatchObject([{ id, inDraft: true }]);
    expect(after.things).toMatchObject([{ id: scarf, inDraft: true }]);
    // Kept already: a second keep copies nothing, and says why.
    expect(await refusal(env, "world_keep", { places: [id] })).toContain("Nothing was kept");
    noModelCalls(rig);
  });
});

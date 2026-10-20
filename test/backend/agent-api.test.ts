// What outside clients rely on (DESIGN §23), on the fake host: writes to one world in turn, the
// working copy's version, `patch` and its guards and budget, `restore`, commits, history, the
// moved-head guard, `templates`, `chats`, the `lre.draft.changed` push and `lre.hello`'s `agentApi`.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashJson } from "../../src/shared/hash";
import { isRecord } from "../../src/shared/json";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import { measure } from "../../src/shared/json-patch";
import type { BackendToFrontend, DraftChanged, FrontendToBackend } from "../../src/shared/protocol";
import { AGENT_API, PROTOCOL_VERSION } from "../../src/shared/protocol";
import { channelId, ENGINE_EXTENSION, STUDIO_EXTENSION } from "../../src/shared/studio-bridge";
import type { RevisionNote, WorldDoc, WorldIndex } from "../../src/shared/world";
import { mapTemplate } from "../../src/shared/maps";
import { STARTER_WORLDS } from "../../src/packs/index";
import { createSpindleHost } from "../../src/backend/spindle-host";
import { DOC_DEPTH_CAP } from "../../src/backend/worlds";
import { Rig } from "../support/rig";
import { testWorld } from "../support/test-pack";

const place = (id: string, name = id): JsonObject => ({ id, name, fields: {} });

/** The rig's editor on one world, from `session` when named. */
function editorOf(rig: Rig, worldId: string) {
  const send = (op: Record<string, unknown>, session?: string): Promise<BackendToFrontend> => rig.send({ type: "lre.editor", worldId, base: null, ...op }, session);
  const ok = async (op: Record<string, unknown>, session?: string) => {
    const body = rig.body(await send(op, session));
    if (!isRecord(body.draft) || typeof body.version !== "number") throw new Error("not an editor result");
    return { draft: body.draft as unknown as WorldDoc, version: body.version, stored: body.stored, base: body.base, lint: body.lint };
  };
  return { send, ok, get: () => ok({ op: "get" }) };
}

function failure(reply: BackendToFrontend): { code: string; message: string } {
  if (reply.type !== "lre.error") throw new Error(`expected an error, got ${reply.type}`);
  return { code: reply.code, message: reply.message };
}

async function indexOf(rig: Rig, worldId: string): Promise<WorldIndex> {
  const worlds = rig.body(await rig.send({ type: "lre.world", op: "list" })).worlds;
  const index = Array.isArray(worlds) ? worlds.find((w) => isRecord(w) && w.id === worldId) : undefined;
  if (!isRecord(index)) throw new Error(`world ${worldId} isn't listed`);
  return index as unknown as WorldIndex;
}

async function historyOf(rig: Rig, worldId: string): Promise<RevisionNote[]> {
  const history = rig.body(await rig.send({ type: "lre.world", op: "get", worldId })).history;
  if (!Array.isArray(history)) throw new Error("no history");
  return history as unknown as RevisionNote[];
}

/** Requests handled at once, as the host delivers them: each without waiting for the others. */
async function together(rig: Rig, requests: Record<string, unknown>[]): Promise<BackendToFrontend[]> {
  const before = rig.host.sent.length;
  const ids = requests.map((_, i) => `together-${i}-${before}`);
  await Promise.all(requests.map((r, i) => rig.dispatch.handle({ lre: PROTOCOL_VERSION, reqId: ids[i], ...r } as unknown as FrontendToBackend, rig.host.userId)));
  await rig.host.settle();
  return ids.map((id) => {
    const reply = rig.host.sent.slice(before).find((m) => (m.type === "lre.result" || m.type === "lre.error") && m.reqId === id);
    if (!reply) throw new Error(`no reply to ${id}`);
    return reply;
  });
}

/** A value nested `depth` levels deep (arrays in arrays around a number). */
function nested(depth: number): JsonValue {
  let value: JsonValue = 1;
  for (let i = 0; i < depth; i++) value = [value];
  return value;
}

describe("one world's writes in turn", () => {
  test("puts and patches sent at once all land, each on the draft the one before it left", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const editor = { type: "lre.editor", worldId, base: null };
    const replies = await together(rig, [
      { ...editor, op: "put", collection: "places", id: "pier", value: place("pier") },
      { ...editor, op: "patch", ops: [{ op: "add", path: "/places/shed", value: place("shed") }] },
      { ...editor, op: "put", collection: "places", id: "barn", value: place("barn") },
      { ...editor, op: "patch", ops: [{ op: "replace", path: "/places/home/name", value: "Hearth" }] },
    ]);
    expect(replies.map((r) => r.type)).toEqual(["lre.result", "lre.result", "lre.result", "lre.result"]);
    const now = await editorOf(rig, worldId).get();
    expect(Object.keys(now.draft.places).sort()).toEqual(["barn", "home", "pier", "shed"]);
    expect(now.draft.places.home?.name).toBe("Hearth");
    expect(now.version).toBe(4);
  });

  test("two lore saves at once keep both entries, each under its own id", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const replies = await together(rig, [
      { type: "lre.lore", op: "save", chatId },
      { type: "lre.lore", op: "save", chatId },
    ]);
    const ids = replies.map((r) => String(rig.body(r).id));
    expect(new Set(ids).size).toBe(2);
    const worldId = String(rig.body(replies[0] ?? replies[1]!).worldId);
    const lore = (await editorOf(rig, worldId).get()).draft.lore;
    expect(ids.every((id) => lore[id]?.content === "Morning, Sam.")).toBe(true);
  });

  test("a Studio install and an editor write at once leave a draft begun on the installed head", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const next: WorldDoc = { ...testWorld(), id: worldId, name: "Testville" };
    next.places.pier = { id: "pier", name: "The pier", fields: {} };
    const [installed] = await Promise.all([
      rig.rt.worlds.commitRevision(worldId, next, rig.host.userId),
      rig.dispatch.handle({ lre: PROTOCOL_VERSION, reqId: "w", type: "lre.editor", worldId, base: null, op: "put", collection: "places", id: "shed", value: place("shed") } as unknown as FrontendToBackend, rig.host.userId),
    ]);
    const now = await editorOf(rig, worldId).get();
    expect([now.base, (await indexOf(rig, worldId)).head]).toEqual([installed.revision, installed.revision]);
    expect(Object.keys(now.draft.places).sort()).toEqual(["home", "pier", "shed"]);
  });
});

describe("the working copy's version", () => {
  test("each write counts one, and so does a discard; a stale version is refused and changes nothing", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    expect((await e.get()).version).toBe(0);
    expect((await e.ok({ op: "put", collection: "places", id: "pier", value: place("pier"), version: 0 })).version).toBe(1);
    expect(failure(await e.send({ op: "put", collection: "places", id: "barn", value: place("barn"), version: 0 })).code).toBe("conflict");
    expect(failure(await e.send({ op: "patch", ops: [{ op: "add", path: "/places/barn", value: place("barn") }], version: 7 })).code).toBe("conflict");
    expect(failure(await e.send({ op: "discard", version: 0 })).code).toBe("conflict");
    const kept = await e.get();
    expect([kept.version, Object.keys(kept.draft.places).sort()]).toEqual([1, ["home", "pier"]]);
    // Without a version, a write isn't checked.
    expect((await e.ok({ op: "put", collection: "places", id: "barn", value: place("barn") })).version).toBe(2);
    const discarded = await e.ok({ op: "discard", version: 2 });
    expect([discarded.version, discarded.stored, Object.keys(discarded.draft.places)]).toEqual([3, false, ["home"]]);
    expect((await e.ok({ op: "set", part: "meta", value: { name: "Again" } })).version).toBe(4);
  });

  test("no version names two states of a world: dropped drafts and the no-draft states each get their own", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    await e.ok({ op: "put", collection: "places", id: "pier", value: place("pier") });
    const held = (await e.ok({ op: "put", collection: "places", id: "barn", value: place("barn") })).version;
    expect(held).toBe(2);
    const dropped = (await e.ok({ op: "discard" })).version;
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) seen.push((await e.ok({ op: "put", collection: "places", id: `shed${i}`, value: place(`shed${i}`) })).version);
    expect([dropped, seen]).toEqual([3, [4, 5, 6]]);
    for (const stale of [held, dropped]) expect(failure(await e.send({ op: "patch", ops: [{ op: "remove", path: "/places/shed0" }], version: stale })).code).toBe("conflict");
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const after = await e.get();
    expect([after.version, after.stored, (await indexOf(rig, worldId)).draftVersion]).toEqual([7, false, 7]);
    expect((await e.ok({ op: "patch", ops: [{ op: "replace", path: "/name", value: "After" }] })).version).toBe(8);
    // An index from before the count was kept counts on from the stored draft's own count.
    const { draftVersion: _count, ...legacy } = await indexOf(rig, worldId);
    rig.host.files.set(`${rig.host.userId}/worlds/${worldId}/index.json`, JSON.stringify(legacy));
    expect((await e.ok({ op: "set", part: "meta", value: { name: "Later" } })).version).toBe(9);
    expect((await e.ok({ op: "discard" })).version).toBe(10);
    expect((await e.ok({ op: "set", part: "meta", value: { name: "Fresh" } })).version).toBe(11);
  });

  test("a client holding a world's first version can't write over what Build committed since", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    const read = (await e.get()).version;
    await e.ok({ op: "set", part: "meta", value: { name: "Build's name" } }, "build");
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }, "build"));
    expect(failure(await e.send({ op: "patch", version: read, ops: [{ op: "replace", path: "/name", value: "Agent's name" }] })).code).toBe("conflict");
    expect((await e.get()).draft.name).toBe("Build's name");
  });

  test("a draft stored before versions is a new draft, one above the world's count", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    const head = await e.get();
    const file = `${rig.host.userId}/worlds/${worldId}/draft.json`;
    rig.host.files.set(file, JSON.stringify({ base: head.base, doc: { ...head.draft, name: "Old draft" } }));
    const old = await e.get();
    expect([old.version, old.stored, old.draft.name]).toEqual([1, true, "Old draft"]);
    expect((await e.ok({ op: "patch", ops: [{ op: "replace", path: "/name", value: "Newer" }], version: 1 })).version).toBe(2);
    await e.ok({ op: "discard" });
    // One left by an older build after this world had counted drafts still reads as a draft.
    rig.host.files.set(file, JSON.stringify({ base: head.base, doc: { ...head.draft, name: "Older build's" } }));
    const again = await e.get();
    expect([again.version, again.stored, again.draft.name]).toEqual([4, true, "Older build's"]);
  });

  test("set writes only the parts it knows: any other name is refused and changes nothing", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    for (const part of ["entities", "__proto__", "pins", "id"]) expect(failure(await e.send({ op: "set", part, value: {} }))).toEqual({ code: "bad_request", message: `unknown part ${part}` });
    const after = await e.get();
    expect([after.stored, after.version, Object.keys(after.draft.entities).length > 0, Object.getPrototypeOf(after.draft) === Object.prototype]).toEqual([false, 0, true, true]);
  });
});

describe("dropping a draft", () => {
  test("a discard that can't record its count changes nothing, so a stale version stays refused", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    await e.ok({ op: "put", collection: "places", id: "pier", value: place("pier") });
    const held = (await e.ok({ op: "put", collection: "places", id: "barn", value: place("barn") })).version;
    const write = rig.host.storage.write;
    rig.host.storage.write = async (path, data, userId) => {
      if (path.endsWith("index.json.tmp")) throw new Error("disk full");
      return write(path, data, userId);
    };
    expect(failure(await e.send({ op: "discard" })).code).toBe("internal");
    rig.host.storage.write = write;
    const after = await e.get();
    expect([after.stored, after.version, Object.keys(after.draft.places).sort()]).toEqual([true, held, ["barn", "home", "pier"]]);
    await e.ok({ op: "put", collection: "places", id: "shed", value: place("shed") });
    expect(failure(await e.send({ op: "patch", version: held, ops: [{ op: "remove", path: "/places/shed" }] })).code).toBe("conflict");
  });

  test("a discard whose file won't go says so, and the file no longer reads as the draft", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    const held = (await e.ok({ op: "put", collection: "places", id: "pier", value: place("pier") })).version;
    const remove = rig.host.storage.remove;
    rig.host.storage.remove = async (path, userId) => {
      if (path.endsWith("draft.json")) throw new Error("EBUSY");
      return remove(path, userId);
    };
    const before = rig.host.sent.length;
    const refused = failure(await e.send({ op: "discard" }));
    rig.host.storage.remove = remove;
    expect(refused).toEqual({ code: "internal", message: "the draft is discarded, but its file couldn't be removed (EBUSY); it no longer reads as the draft" });
    expect(rig.host.sent.slice(before).filter((m) => m.type === "lre.draft.changed")).toEqual([{ lre: PROTOCOL_VERSION, type: "lre.draft.changed", worldId, version: held + 1, stored: false, base: (await indexOf(rig, worldId)).head }]);
    const after = await e.get();
    expect([after.stored, after.version, Object.keys(after.draft.places)]).toEqual([false, held + 1, ["home"]]);
    expect((await e.ok({ op: "set", part: "meta", value: { name: "Next" } })).version).toBe(held + 2);
  });

  test("a commit whose draft file won't go leaves no draft to lock the world out of committing", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    await e.ok({ op: "put", collection: "places", id: "pier", value: place("pier") });
    const remove = rig.host.storage.remove;
    rig.host.storage.remove = async (path, userId) => {
      if (path.endsWith("draft.json")) throw new Error("EBUSY");
      return remove(path, userId);
    };
    const committed = failure(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    rig.host.storage.remove = remove;
    const head = (await indexOf(rig, worldId)).head;
    expect(committed).toEqual({ code: "internal", message: `revision ${head} is the head now, but its file couldn't be removed (EBUSY); it no longer reads as the draft` });
    const later = await e.ok({ op: "put", collection: "places", id: "barn", value: place("barn") });
    expect([later.base, Object.keys(later.draft.places).sort()]).toEqual([head, ["barn", "home", "pier"]]);
    expect(String(rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null })).revision)).toBe((await indexOf(rig, worldId)).head);
  });

  test("a commit names the version it reviewed: a draft written since is refused, not committed", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    const reviewed = (await e.ok({ op: "put", collection: "places", id: "pier", value: place("pier") })).version;
    await e.ok({ op: "put", collection: "places", id: "barn", value: place("barn") }, "build");
    const head = (await indexOf(rig, worldId)).head;
    expect(failure(await rig.send({ type: "lre.world", op: "commit", worldId, base: null, version: reviewed }))).toEqual({ code: "conflict", message: `the draft changed since you read it (it is at version ${reviewed + 1} now); review it and commit again` });
    expect((await indexOf(rig, worldId)).head).toBe(head);
    expect(rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null, version: reviewed + 1 })).revision).not.toBe(head);
  });
});

describe("patch", () => {
  test("applies to the whole draft or a copy of the head, and a failed test changes nothing", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    const failed = failure(await e.send({ op: "patch", ops: [{ op: "add", path: "/places/pier", value: place("pier") }, { op: "test", path: "/places/home/name", value: "Not home" }] }));
    expect(failed).toEqual({ code: "conflict", message: "operation 2 (test /places/home/name): the value at /places/home/name isn't the one given" });
    const untouched = await e.get();
    expect([untouched.stored, untouched.version, Object.keys(untouched.draft.places)]).toEqual([false, 0, ["home"]]);
    // Only tests that pass: nothing to write, so no draft begins.
    expect((await e.ok({ op: "patch", ops: [{ op: "test", path: "/places/home/name", value: "Home" }] })).stored).toBe(false);
    const done = await e.ok({ op: "patch", ops: [{ op: "add", path: "/places/pier", value: place("pier") }, { op: "move", from: "/places/pier", path: "/places/quay" }, { op: "replace", path: "/name", value: "Harbor" }] });
    expect([done.version, done.stored, Object.keys(done.draft.places).sort(), done.draft.name, Array.isArray(done.lint)]).toEqual([1, true, ["home", "quay"], "Harbor", true]);
  });

  test("each guard refuses, naming the operation and its path, and leaves the draft as it was", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    const doc = (await e.get()).draft;
    const refused = async (ops: unknown[]) => failure(await e.send({ op: "patch", ops }));
    const long = "a".repeat(250);
    const cases: [unknown[], string, string][] = [
      [[{ op: "replace", path: "/id", value: "w_other" }], "bad_request", "operation 1 (replace /id): a patch can't change /id"],
      [[{ op: "replace", path: "/format", value: "lre-world-v2" }], "bad_request", "operation 1 (replace /format): a patch can't change /format"],
      [[{ op: "replace", path: "/engineVersion", value: "9.9.9" }], "bad_request", "operation 1 (replace /engineVersion): a patch can't change /engineVersion"],
      [[{ op: "add", path: "/pins/tables/x", value: "rev" }], "bad_request", "operation 1 (add /pins/tables/x): a patch can't change /pins"],
      [[{ op: "add", path: "/suppressed/-", value: "lore:x" }], "bad_request", "operation 1 (add /suppressed/-): a patch can't change /suppressed"],
      [[{ op: "test", path: "/id", value: doc.id }, { op: "replace", path: "", value: { ...doc, id: "w_other" } }], "bad_request", 'operation 2 (replace ""): a patch can\'t change /id'],
      [[{ op: "add", path: "/places/__proto__", value: place("x") }], "bad_request", 'operation 1 (add /places/__proto__): "__proto__" can\'t be a key'],
      [[{ op: "add", path: "/places/x", value: JSON.parse('{"id":"x","fields":{"__proto__":{"polluted":true}}}') as JsonValue }], "bad_request", 'operation 1 (add /places/x): "__proto__" can\'t be a key'],
      [[{ op: "copy", from: "/places/constructor", path: "/places/y" }], "bad_request", 'operation 1 (copy /places/y): "constructor" can\'t be a key'],
      [[{ op: "add", path: "/places/x", value: { ...place("x"), map: "m" } }], "bad_request", "operation 1 (add /places/x): only a map marks what it draws (map)"],
      [[{ op: "add", path: `/entities/${long}`, value: { id: long, kind: "person", name: "Long", tier: "background", fields: {}, relations: [] } }], "bad_request", `operation 1 (add /entities/${long}): entities ids are 1 to 200 characters long; this one is 250`],
      [[{ op: "add", path: "/places/", value: place("") }], "bad_request", "operation 1 (add /places/): places ids are 1 to 200 characters long; this one is 0"],
      [[{ op: "move", from: "/places/home", path: `/places/${long}` }], "bad_request", `operation 1 (move /places/${long}): places ids are 1 to 200 characters long; this one is 250`],
      [[{ op: "merge", path: "/places" }], "bad_request", 'operation 1: unknown op "merge" (add, remove, replace, move, copy or test)'],
      [[{ op: "add", path: "places/x", value: 1 }], "bad_request", 'operation 1 (add places/x): "places/x" isn\'t a JSON Pointer (it starts with "/", or is "" for the whole draft)'],
      [Array.from({ length: 501 }, () => ({ op: "test", path: "/id", value: doc.id })), "bad_request", "a patch has at most 500 operations; this one has 501"],
    ];
    for (const [ops, code, message] of cases) expect(await refused(ops)).toEqual({ code, message });
    expect(failure(await e.send({ op: "patch", ops: [{ op: "remove", path: "/start" }] }))).toEqual({ code: "validation", message: "the patch leaves the world malformed" });
    const after = await e.get();
    expect([after.stored, after.version, after.draft]).toEqual([false, 0, doc]);
    // The whole document replaced, its protected parts kept: allowed.
    expect((await e.ok({ op: "patch", ops: [{ op: "replace", path: "", value: { ...doc, name: "Whole" } }] })).draft.name).toBe("Whole");
    expect(Object.prototype.hasOwnProperty.call({}, "polluted")).toBe(false);
  });

  test("copies that double the draft stop at the patch's budget, and nothing is written", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    for (const from of ["/entities", ""]) {
      const reply = failure(await e.send({ op: "patch", ops: Array.from({ length: 24 }, (_, i) => ({ op: "copy", from, path: `/entities/c${i}` })) }));
      expect([reply.code, reply.message]).toEqual(["bad_request", expect.stringMatching(/^operation \d+ \(copy \/entities\/c\d+\): the patch brings in more than 4 MiB of JSON \(the values it adds and what it copies count\)$/)]);
    }
    expect([(await e.get()).stored, Object.keys((await e.get()).draft.entities).some((id) => id.startsWith("c"))]).toEqual([false, false]);
    // A copy well inside the budget is just a copy.
    expect(Object.keys((await e.ok({ op: "patch", ops: [{ op: "copy", from: "/places/home", path: "/places/home2" }] })).draft.places).sort()).toEqual(["home", "home2"]);
  });

  test("no write nests the world deeper than its cap, which the shipped starters sit well inside", async () => {
    for (const make of Object.values(STARTER_WORLDS)) expect(typeof measure(make("w", "w"), { size: Number.MAX_SAFE_INTEGER, depth: DOC_DEPTH_CAP / 2 })).toBe("object");
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    // /places/home/fields/x is four levels in, so a value of 60 levels reaches the cap of 64 exactly.
    expect(failure(await e.send({ op: "patch", ops: [{ op: "add", path: "/places/home/fields/deep", value: nested(DOC_DEPTH_CAP - 3) }] }))).toEqual({ code: "bad_request", message: `operation 1 (add /places/home/fields/deep): the value would nest the world deeper than ${DOC_DEPTH_CAP} levels` });
    expect(failure(await e.send({ op: "put", collection: "places", id: "deep", value: { ...place("deep"), fields: { x: nested(DOC_DEPTH_CAP) } } }))).toEqual({ code: "bad_request", message: `places deep nests deeper than ${DOC_DEPTH_CAP - 2} levels` });
    expect(failure(await e.send({ op: "set", part: "ruleset", value: { x: nested(DOC_DEPTH_CAP) } }))).toEqual({ code: "bad_request", message: `the ruleset part nests deeper than ${DOC_DEPTH_CAP - 1} levels` });
    // A copy that lands its value deeper counts too.
    await e.ok({ op: "patch", ops: [{ op: "add", path: "/places/home/fields/deep", value: nested(DOC_DEPTH_CAP - 4) }] });
    expect(failure(await e.send({ op: "patch", ops: [{ op: "copy", from: "/places/home/fields/deep", path: "/places/home/fields/deep/0/again" }] })).code).toBe("bad_request");
    // What fits commits: hashing never meets a document too deep for it.
    expect(rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null })).revision).toBeString();
  });

  test("an item the engine can't read is refused as validation, before anything is written", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    for (const [collection, id] of [["lore", "x"], ["entities", "x"]] as const) {
      const patched = failure(await e.send({ op: "patch", ops: [{ op: "add", path: `/${collection}/${id}`, value: {} }] }));
      const put = failure(await e.send({ op: "put", collection, id, value: {} }));
      for (const reply of [patched, put]) expect([reply.code, reply.message]).toEqual(["validation", expect.stringMatching(new RegExp(`^${collection} ${id}: the engine can't read it \\(.+\\); check it against the lre-world-v1 schema$`))]);
    }
    const after = await e.get();
    expect([after.stored, rig.host.files.has(`${rig.host.userId}/worlds/${worldId}/draft.json`)]).toEqual([false, false]);
    // An empty item of another collection reads as one with lint to fix, so it may be stored; it never crashes a request.
    for (const path of ["/places/x", "/routes/x", "/tables/x", "/checks/x"]) {
      const reply = await e.send({ op: "patch", ops: [{ op: "add", path, value: {} }] });
      expect(reply.type === "lre.error" ? reply.code : "applied").not.toBe("internal");
    }
    expect((await e.send({ op: "get" })).type).toBe("lre.result");
    expect(rig.host.logs.filter((l) => l.startsWith("error"))).toEqual([]);
  });

  test("a place a map draws is edited in its map: a patch to it is refused, one to the map redraws it", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    const drawn = await e.ok({ op: "put", collection: "maps", id: "yard", value: mapTemplate("node", "yard", "home") as unknown as JsonValue });
    const owned = Object.entries(drawn.draft.places).filter(([, p]) => isRecord(p) && p.map === "yard");
    const [id] = owned[0] ?? [];
    if (!id) throw new Error("the map drew no place");
    expect(failure(await e.send({ op: "patch", ops: [{ op: "replace", path: `/places/${id}/name`, value: "Renamed" }] }))).toEqual({ code: "bad_request", message: `operation 1 (replace /places/${id}/name): places ${id} is drawn by the map yard; edit it there` });
    expect(failure(await e.send({ op: "patch", ops: [{ op: "remove", path: `/places/${id}` }] })).message).toContain("is drawn by the map yard");
    const removed = await e.ok({ op: "patch", ops: [{ op: "remove", path: "/maps/yard" }] });
    expect(Object.values(removed.draft.places).some((p) => isRecord(p) && p.map === "yard")).toBe(false);
  });

  test("a table a write changes gets its content's revision and is pinned at it, a profile's included", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    const revisionOf = (t: { schema: unknown; columns: unknown; rows: unknown }) => hashJson({ schema: t.schema, columns: t.columns, rows: t.rows });
    const table = { id: "t.fees", pack: "test", schema: "lre-table/t.fees/v1", revision: "made-up", label: "Fees", columns: { cents: { type: "int" } }, rows: { toll: { cents: 100 } } };
    const added = await e.ok({ op: "patch", ops: [{ op: "add", path: "/tables/t.fees", value: table }] });
    const first = revisionOf(table);
    expect([added.draft.tables["t.fees"]?.revision, added.draft.pins.tables["t.fees"]]).toEqual([first, first]);
    const edited = await e.ok({ op: "patch", ops: [{ op: "replace", path: "/tables/t.fees/rows/toll/cents", value: 150 }] });
    const second = revisionOf({ ...table, rows: { toll: { cents: 150 } } });
    expect([edited.draft.tables["t.fees"]?.revision, edited.draft.pins.tables["t.fees"]]).toEqual([second, second]);
    // Build's table editor sends the table with the revision it read; the save gets the new content's.
    const saved = await e.ok({ op: "put", collection: "tables", id: "t.fees", value: { ...table, rows: { toll: { cents: 175 } }, revision: second } });
    const third = revisionOf({ ...table, rows: { toll: { cents: 175 } } });
    expect([saved.draft.tables["t.fees"]?.revision, saved.draft.pins.tables["t.fees"]]).toEqual([third, third]);
    expect((await e.ok({ op: "remove", collection: "tables", id: "t.fees" })).draft.pins.tables).toEqual({});

    const shipped = new Rig({ shipped: true });
    const fantasy = await shipped.newWorld("Fantasy", "fantasy_town");
    const profiled = await editorOf(shipped, fantasy).ok({ op: "profile", profile: "classic", choices: {} });
    const brought = Object.entries(profiled.draft.tables).filter(([id]) => id.startsWith("classic."));
    expect(brought.length).toBeGreaterThan(0);
    for (const [id, t] of brought) expect({ id, pin: profiled.draft.pins.tables[id] }).toEqual({ id, pin: revisionOf(t) });
  });
});

describe("restore, commits and history", () => {
  test("restore then commit makes that revision head again; a revision the world never had is not found", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    await e.ok({ op: "put", collection: "places", id: "pier", value: place("pier") });
    const first = String(rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null })).revision);
    await e.ok({ op: "put", collection: "places", id: "barn", value: place("barn") });
    const second = String(rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null })).revision);
    const restored = await e.ok({ op: "restore", revision: first });
    expect([restored.base, restored.stored, restored.version, Object.keys(restored.draft.places).sort()]).toEqual([second, true, 5, ["home", "pier"]]);
    expect(String(rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null })).revision)).toBe(first);
    const index = await indexOf(rig, worldId);
    expect([index.head, index.revisions.at(-1), index.revisions.length]).toEqual([first, first, 3]);
    expect(failure(await e.send({ op: "restore", revision: "0123456789abcdef0123456789abcdef" })).code).toBe("not_found");
  });

  test("every way a revision becomes head is noted: create, Build, an outside agent with its note, import and Studio installs", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    rig.body(await rig.send({ type: "lre.hello", chatId: null, client: { name: "lumirpengine", version: "0.1.0" } }, "agent-session"));
    await e.ok({ op: "put", collection: "places", id: "pier", value: place("pier") });
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null, note: "  Built from the CLI  " }, "agent-session"));
    await e.ok({ op: "put", collection: "places", id: "barn", value: place("barn") }, "build-session");
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null, note: `${"x".repeat(250)}` }, "build-session"));
    // Committing the head as it is makes nothing head, so it adds nothing.
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const head = (await indexOf(rig, worldId)).head;
    const next: WorldDoc = { ...testWorld(), id: worldId, places: { home: { id: "home", name: "Home", fields: {} }, studio: { id: "studio", name: "Studio", fields: {} } } };
    rig.host.rpcPool.port(STUDIO_EXTENSION).handle(`offer.${channelId(rig.host.userId)}`, [], async (requester) => {
      if (requester !== ENGINE_EXTENSION) throw new Error("not for you");
      return { offerId: "o1", doc: JSON.parse(JSON.stringify(next)) as JsonValue, mode: "revision", worldId, baseRevision: head, createdAt: 1 };
    });
    const offer = rig.body(await rig.send({ type: "lre.studio", op: "offer" })).offer;
    if (!isRecord(offer)) throw new Error("no offer");
    const versionBefore = (await e.get()).version;
    const before = rig.host.sent.length;
    rig.body(await rig.send({ type: "lre.studio", op: "install", offerId: "o1", hash: offer.hash }));
    const installed = (await indexOf(rig, worldId)).head;
    // The install moved the head under no draft: the working copy is a new state, with its own version.
    expect(rig.host.sent.slice(before).filter((m) => m.type === "lre.draft.changed")).toEqual([{ lre: PROTOCOL_VERSION, type: "lre.draft.changed", worldId, version: versionBefore + 1, stored: false, base: installed }]);
    expect((await e.get()).version).toBe(versionBefore + 1);
    const history = await historyOf(rig, worldId);
    expect(history.map((h) => [h.source, h.note])).toEqual([
      ["create", undefined],
      ["agent", "Built from the CLI"],
      ["build", "x".repeat(200)],
      ["studio", undefined],
    ]);
    expect(history.map((h) => h.revision).at(-1)).toBe(installed);
    expect(history.every((h, i) => typeof h.at === "number" && (i === 0 || h.at >= (history[i - 1]?.at ?? 0)))).toBe(true);
    // The list leaves the history out; it lives beside the index.
    const listed = rig.body(await rig.send({ type: "lre.world", op: "list" })).worlds;
    expect(Array.isArray(listed) && listed.every((w) => isRecord(w) && !("history" in w))).toBe(true);
    expect(JSON.parse(rig.host.files.get(`${rig.host.userId}/worlds/${worldId}/index.json`) ?? "{}")).not.toHaveProperty("history");

    const imported = rig.body(await rig.send({ type: "lre.world", op: "import", file: { format: "lre-world-export-v1", world: JSON.parse(JSON.stringify(testWorld())) as JsonValue } }));
    const importedId = isRecord(imported.world) ? String(imported.world.id) : "";
    expect((await historyOf(rig, importedId)).map((h) => h.source)).toEqual(["import"]);
    // A world from before history was kept has none.
    rig.host.files.delete(`${rig.host.userId}/worlds/${importedId}/history.json`);
    expect(await historyOf(rig, importedId)).toEqual([]);
  });

  test("a draft begun on an earlier head can't be committed over the head made since", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    const begun = await e.ok({ op: "put", collection: "places", id: "pier", value: place("pier") });
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    // A draft still on the first head, as one left from before the head moved.
    rig.host.files.set(`${rig.host.userId}/worlds/${worldId}/draft.json`, JSON.stringify({ base: begun.base, doc: { ...begun.draft, name: "Stale" }, version: 3 }));
    expect(failure(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }))).toEqual({ code: "conflict", message: "the world changed since this draft began; reload it" });
    expect((await indexOf(rig, worldId)).name).toBe("Testville");
    // Restoring a revision onto the head clears the way.
    await e.ok({ op: "restore", revision: (await indexOf(rig, worldId)).head });
    expect(rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null })).revision).toBe((await indexOf(rig, worldId)).head);
  });
});

describe("templates and chats", () => {
  test("templates lists every starter create takes, each with its template's blurb", async () => {
    const rig = new Rig({ shipped: true });
    const templates = rig.body(await rig.send({ type: "lre.world", op: "templates" })).templates;
    if (!Array.isArray(templates)) throw new Error("no templates");
    expect(templates.map((t) => (isRecord(t) ? t.id : null)).sort()).toEqual(Object.keys(STARTER_WORLDS).sort());
    for (const t of templates) {
      if (!isRecord(t) || typeof t.id !== "string") throw new Error("not a template");
      const source: unknown = JSON.parse(readFileSync(join(import.meta.dir, "../../data-src/templates", `${t.id.replace(/_/g, "-")}.json`), "utf8"));
      expect([typeof t.name === "string" && t.name.length > 0, t.summary]).toEqual([true, isRecord(source) ? source.blurb : null]);
      const created = rig.body(await rig.send({ type: "lre.world", op: "create", name: `From ${t.id}`, template: t.id }));
      expect(isRecord(created.world) && created.world.name).toBe(`From ${t.id}`);
    }
    expect(rig.body(await new Rig().send({ type: "lre.world", op: "templates" })).templates).toEqual([]);
  });

  test("chats lists the chats of worlds still there, each at the revision it plays now, one world's or one chat", async () => {
    const rig = new Rig();
    const alpha = await rig.newWorld("Alpha");
    const beta = await rig.newWorld("Beta");
    const attach = async (worldId: string) => {
      const chatId = rig.host.createChat("Morning, Sam.");
      rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
      return chatId;
    };
    const behind = await attach(alpha);
    const upgraded = await attach(alpha);
    const onBeta = await attach(beta);
    rig.host.createChat("A plain chat.");
    const first = (await indexOf(rig, alpha)).head;
    await editorOf(rig, alpha).ok({ op: "put", collection: "places", id: "pier", value: place("pier") });
    const second = String(rig.body(await rig.send({ type: "lre.world", op: "commit", worldId: alpha, base: null })).revision);
    expect(rig.body(await rig.send({ type: "lre.world", op: "upgrade", chatId: upgraded, to: second }))).toEqual({ revision: second, pending: false });
    const listed = async (filter: Record<string, string> = {}) => rig.body(await rig.send({ type: "lre.world", op: "chats", ...filter })).chats;
    const name = (chatId: string) => rig.host.chat(chatId).name;
    expect(await listed()).toEqual([
      { chatId: onBeta, name: name(onBeta), worldId: beta, revision: (await indexOf(rig, beta)).head, behind: false },
      { chatId: upgraded, name: name(upgraded), worldId: alpha, revision: second, behind: false },
      { chatId: behind, name: name(behind), worldId: alpha, revision: first, behind: true },
    ]);
    expect(await listed({ chatId: behind })).toEqual([{ chatId: behind, name: name(behind), worldId: alpha, revision: first, behind: true }]);
    rig.body(await rig.send({ type: "lre.world", op: "delete", worldId: beta }));
    expect(((await listed()) as unknown[]).length).toBe(2);
    expect(((await listed({ worldId: alpha })) as { chatId: string }[]).map((c) => c.chatId)).toEqual([upgraded, behind]);
    expect(failure(await rig.send({ type: "lre.world", op: "chats", worldId: beta })).code).toBe("not_found");
  });

  test("a chat whose ledger can't be read is still listed, with no revision and the reason", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await editorOf(rig, worldId).ok({ op: "put", collection: "places", id: "pier", value: place("pier") });
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    // The index loses the revision the chat started on.
    const key = `${rig.host.userId}/worlds/${worldId}/index.json`;
    rig.host.files.set(key, JSON.stringify({ ...JSON.parse(rig.host.files.get(key) ?? "{}"), revisions: "broken" }));
    rig.rt.forgetChat(chatId);
    const chats = rig.body(await rig.send({ type: "lre.world", op: "chats", worldId })).chats;
    expect(chats).toEqual([{ chatId, name: rig.host.chat(chatId).name, worldId, revision: null, behind: false, reason: expect.stringContaining("can't be") }]);
  });

  test("an Upgrade sent mid-turn says it is pending, and lands when the turn ends", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const run = rig.host.chat(chatId).metadata.lumi_rp_engine;
    const worldId = isRecord(run) ? String(run.worldId) : "";
    await editorOf(rig, worldId).ok({ op: "put", collection: "places", id: "pier", value: place("pier") });
    const to = String(rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null })).revision);
    rig.host.sendUser(chatId, "look around");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    expect(rig.body(await rig.send({ type: "lre.world", op: "upgrade", chatId, to }))).toEqual({ revision: to, pending: true });
    await rig.host.finish(g, "Quiet.");
    expect(rig.body(await rig.send({ type: "lre.world", op: "chats", chatId })).chats).toEqual([expect.objectContaining({ chatId, revision: to, behind: false })]);
  });

  test("the host's chat list pages through a list that shifts as it is read, and skips no chat", async () => {
    const order = Array.from({ length: 450 }, (_, i) => `c${i}`);
    let pages = 0;
    const spindle = {
      chats: {
        list: async (options: { limit: number; offset: number }) => {
          pages += 1;
          const page = order.slice(options.offset, options.offset + options.limit).map((id) => ({ id, name: id, metadata: {} }));
          // While the first page is answered, the user plays c300 (not read yet), which moves to the front; then c10 (read) is deleted.
          if (pages === 1) order.splice(0, 0, ...order.splice(order.indexOf("c300"), 1));
          if (pages === 2) order.splice(order.indexOf("c10"), 1);
          return { data: page, total: order.length };
        },
      },
    };
    Object.assign(globalThis, { spindle });
    try {
      const listed = new Set((await createSpindleHost().chats.list("u")).map((c) => c.id));
      expect(order.filter((id) => !listed.has(id))).toEqual([]);
    } finally {
      Object.assign(globalThis, { spindle: undefined });
    }
  });
});

describe("pushes and hello", () => {
  test("every change to a draft is pushed to all the user's sessions after the change's own reply, with its base", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const run = rig.host.chat(chatId).metadata.lumi_rp_engine;
    const worldId = isRecord(run) ? String(run.worldId) : "";
    const pushed = async (request: Record<string, unknown>) => {
      const before = rig.host.sent.length;
      const reply = await rig.send(request, "s1");
      const sent = rig.host.sent.slice(before);
      const at = sent.findIndex((m) => m.type === "lre.draft.changed");
      return { reply, push: at < 0 ? null : sent[at], to: rig.host.sentTo[before + at], after: at > sent.indexOf(reply) };
    };
    const push = (version: number, stored: boolean, base: string): DraftChanged => ({ lre: PROTOCOL_VERSION, type: "lre.draft.changed", worldId, version, stored, base });
    const first = (await indexOf(rig, worldId)).head;
    const put = await pushed({ type: "lre.editor", worldId, base: null, op: "put", collection: "places", id: "pier", value: place("pier") });
    expect([put.push, put.to, put.after]).toEqual([push(1, true, first), { userId: rig.host.userId }, true]);
    expect((await pushed({ type: "lre.editor", worldId, base: null, op: "get" })).push).toBeNull();
    const saved = await pushed({ type: "lre.lore", op: "save", chatId });
    expect([saved.push, saved.after]).toEqual([push(2, true, first), true]);
    const committed = await pushed({ type: "lre.world", op: "commit", worldId, base: null });
    const second = (await indexOf(rig, worldId)).head;
    expect(committed.push).toEqual(push(3, false, second));
    expect((await pushed({ type: "lre.editor", worldId, base: null, op: "restore", revision: first })).push).toEqual(push(4, true, second));
    expect((await pushed({ type: "lre.editor", worldId, base: null, op: "discard" })).push).toEqual(push(5, false, second));
    // A refused write, or a discard with nothing stored, changes nothing, so nothing is pushed.
    expect((await pushed({ type: "lre.editor", worldId, base: null, op: "put", collection: "places", id: "x", value: place("x"), version: 2 })).push).toBeNull();
    expect((await pushed({ type: "lre.editor", worldId, base: null, op: "discard" })).push).toBeNull();
  });

  test("hello answers the agent level, and an outside client's hello is logged to the user's diagnostics", async () => {
    const rig = new Rig();
    // The hello also tells the tab how long to wait for an answer (Settings → Timeouts → Engine requests).
    const { requestMs } = (await rig.rt.settings.get(rig.host.userId)).timeouts;
    expect(rig.body(await rig.send({ type: "lre.hello", chatId: null }, "browser"))).toEqual({ accepted: true, agentApi: AGENT_API, requestMs });
    expect(rig.body(await rig.send({ type: "lre.hello", chatId: null, client: { name: "lumirpengine\nforged: line", version: "0.1.0" } }, "cli"))).toEqual({ accepted: true, agentApi: AGENT_API, requestMs });
    expect(rig.host.userLogs.get(rig.host.userId)?.filter((l) => l.includes("outside client"))).toEqual(["info: [LumiRPEngine] outside client connected: lumirpengine forged: line 0.1.0"]);
    // The browser's session stays Build's.
    const worldId = await rig.newWorld();
    await editorOf(rig, worldId).ok({ op: "put", collection: "places", id: "pier", value: place("pier") });
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }, "browser"));
    expect((await historyOf(rig, worldId)).map((h) => h.source)).toEqual(["create", "build"]);
  });
});

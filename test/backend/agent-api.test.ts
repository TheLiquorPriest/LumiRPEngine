// What outside clients rely on (DESIGN §23), on the fake host: writes to one world in turn, the
// draft's version, `patch` and its guards, `restore`, commit notes and history, the moved-head
// guard, `templates`, `chats`, the `lre.draft.changed` push and `lre.hello`'s `agentApi`.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hashJson } from "../../src/shared/hash";
import { isRecord } from "../../src/shared/json";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import type { BackendToFrontend, FrontendToBackend } from "../../src/shared/protocol";
import { AGENT_API, PROTOCOL_VERSION } from "../../src/shared/protocol";
import { channelId, ENGINE_EXTENSION, STUDIO_EXTENSION } from "../../src/shared/studio-bridge";
import type { WorldDoc, WorldIndex } from "../../src/shared/world";
import { mapTemplate } from "../../src/shared/maps";
import { STARTER_WORLDS } from "../../src/packs/index";
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

describe("the draft's version", () => {
  test("each write counts one, a stale version is refused and changes nothing, and none stored is 0", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    expect((await e.get()).version).toBe(0);
    expect((await e.ok({ op: "put", collection: "places", id: "pier", value: place("pier"), version: 0 })).version).toBe(1);
    const stale = failure(await e.send({ op: "put", collection: "places", id: "barn", value: place("barn"), version: 0 }));
    expect(stale.code).toBe("conflict");
    expect(failure(await e.send({ op: "patch", ops: [{ op: "add", path: "/places/barn", value: place("barn") }], version: 7 })).code).toBe("conflict");
    expect(failure(await e.send({ op: "discard", version: 0 })).code).toBe("conflict");
    const kept = await e.get();
    expect([kept.version, Object.keys(kept.draft.places).sort()]).toEqual([1, ["home", "pier"]]);
    // Without a version (Build), a write goes ahead as before.
    expect((await e.ok({ op: "put", collection: "places", id: "barn", value: place("barn") })).version).toBe(2);
    const discarded = await e.ok({ op: "discard", version: 2 });
    expect([discarded.version, discarded.stored, Object.keys(discarded.draft.places)]).toEqual([0, false, ["home"]]);
    expect((await e.ok({ op: "set", part: "meta", value: { name: "Again" } })).version).toBe(1);
  });

  test("a draft stored before drafts counted their writes reads as version 1", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    const head = await e.get();
    rig.host.files.set(`${rig.host.userId}/worlds/${worldId}/draft.json`, JSON.stringify({ base: head.base, doc: { ...head.draft, name: "Old draft" } }));
    const old = await e.get();
    expect([old.version, old.stored, old.draft.name]).toEqual([1, true, "Old draft"]);
    expect((await e.ok({ op: "patch", ops: [{ op: "replace", path: "/name", value: "Newer" }], version: 1 })).version).toBe(2);
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
      [[{ op: "merge", path: "/places" }], "bad_request", 'operation 1: unknown op "merge" (add, remove, replace, move, copy or test)'],
      [[{ op: "add", path: "places/x", value: 1 }], "bad_request", 'operation 1 (add places/x): "places/x" isn\'t a JSON Pointer (it starts with "/", or is "" for the whole draft)'],
      [Array.from({ length: 501 }, () => ({ op: "test", path: "/id", value: doc.id })), "bad_request", "a patch has at most 500 operations; this one has 501"],
    ];
    for (const [ops, code, message] of cases) expect(await refused(ops)).toEqual({ code, message });
    const shape = failure(await e.send({ op: "patch", ops: [{ op: "remove", path: "/start" }] }));
    expect(shape).toEqual({ code: "validation", message: "the patch leaves the world malformed" });
    const after = await e.get();
    expect([after.stored, after.version, after.draft]).toEqual([false, 0, doc]);
    // The whole document replaced, its protected parts kept: allowed.
    expect((await e.ok({ op: "patch", ops: [{ op: "replace", path: "", value: { ...doc, name: "Whole" } }] })).draft.name).toBe("Whole");
    expect(Object.prototype.hasOwnProperty.call({}, "polluted")).toBe(false);
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

  test("a table a write changes gets its content's revision and is pinned at it, as Build's table saves are", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const e = editorOf(rig, worldId);
    const revisionOf = (t: { schema: string; columns: unknown; rows: unknown }) => hashJson({ schema: t.schema, columns: t.columns, rows: t.rows });
    const table = { id: "t.fees", pack: "test", schema: "lre-table/t.fees/v1", revision: "made-up", label: "Fees", columns: { cents: { type: "int" } }, rows: { toll: { cents: 100 } } };
    const added = await e.ok({ op: "patch", ops: [{ op: "add", path: "/tables/t.fees", value: table }] });
    const first = revisionOf(table);
    expect([added.draft.tables["t.fees"]?.revision, added.draft.pins.tables["t.fees"]]).toEqual([first, first]);
    const edited = await e.ok({ op: "patch", ops: [{ op: "replace", path: "/tables/t.fees/rows/toll/cents", value: 150 }] });
    const second = revisionOf({ ...table, rows: { toll: { cents: 150 } } });
    expect(second).not.toBe(first);
    expect([edited.draft.tables["t.fees"]?.revision, edited.draft.pins.tables["t.fees"]]).toEqual([second, second]);
    // Build's table editor sends the table with the revision it read; the save gets the new content's.
    const saved = await e.ok({ op: "put", collection: "tables", id: "t.fees", value: { ...table, rows: { toll: { cents: 175 } }, revision: second } });
    const third = revisionOf({ ...table, rows: { toll: { cents: 175 } } });
    expect([saved.draft.tables["t.fees"]?.revision, saved.draft.pins.tables["t.fees"]]).toEqual([third, third]);
    const gone = await e.ok({ op: "remove", collection: "tables", id: "t.fees" });
    expect(gone.draft.pins.tables).toEqual({});
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
    expect([restored.base, restored.stored, restored.version, Object.keys(restored.draft.places).sort()]).toEqual([second, true, 1, ["home", "pier"]]);
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
    rig.body(await rig.send({ type: "lre.studio", op: "install", offerId: "o1", hash: offer.hash }));
    const history = (await indexOf(rig, worldId)).history ?? [];
    expect(history.map((h) => [h.source, h.note])).toEqual([
      ["create", undefined],
      ["agent", "Built from the CLI"],
      ["build", "x".repeat(200)],
      ["studio", undefined],
    ]);
    expect(history.map((h) => h.revision).at(-1)).toBe((await indexOf(rig, worldId)).head);
    expect(history.every((h, i) => typeof h.at === "number" && (i === 0 || h.at >= (history[i - 1]?.at ?? 0)))).toBe(true);

    const imported = rig.body(await rig.send({ type: "lre.world", op: "import", file: { format: "lre-world-export-v1", world: JSON.parse(JSON.stringify(testWorld())) as JsonValue } }));
    const importedId = isRecord(imported.world) ? String(imported.world.id) : "";
    expect((await indexOf(rig, importedId)).history?.map((h) => h.source)).toEqual(["import"]);
    // A world from before history was kept has none until its next head.
    const old = await indexOf(rig, importedId);
    const { history: _history, ...legacy } = old;
    rig.host.files.set(`${rig.host.userId}/worlds/${importedId}/index.json`, JSON.stringify(legacy));
    expect((await indexOf(rig, importedId)).history).toBeUndefined();
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
    // Discarding it, or restoring onto the head, clears the way.
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
    // A runtime with templates but no descriptions of them lists none.
    expect(rig.body(await new Rig().send({ type: "lre.world", op: "templates" })).templates).toEqual([]);
  });

  test("chats lists the chats of worlds still there, each at the revision it plays now", async () => {
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
    rig.body(await rig.send({ type: "lre.world", op: "upgrade", chatId: upgraded, to: second }));
    const listed = async (worldId?: string) => rig.body(await rig.send({ type: "lre.world", op: "chats", ...(worldId ? { worldId } : {}) })).chats;
    const name = (chatId: string) => rig.host.chat(chatId).name;
    expect(await listed()).toEqual([
      { chatId: onBeta, name: name(onBeta), worldId: beta, revision: (await indexOf(rig, beta)).head, behind: false },
      { chatId: upgraded, name: name(upgraded), worldId: alpha, revision: second, behind: false },
      { chatId: behind, name: name(behind), worldId: alpha, revision: first, behind: true },
    ]);
    rig.body(await rig.send({ type: "lre.world", op: "delete", worldId: beta }));
    expect(((await listed()) as unknown[]).length).toBe(2);
    expect(((await listed(alpha)) as { chatId: string }[]).map((c) => c.chatId)).toEqual([upgraded, behind]);
    expect(failure(await rig.send({ type: "lre.world", op: "chats", worldId: beta })).code).toBe("not_found");
  });
});

describe("pushes and hello", () => {
  test("every change to a draft is pushed to all the user's sessions after the change's own reply", async () => {
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
    const put = await pushed({ type: "lre.editor", worldId, base: null, op: "put", collection: "places", id: "pier", value: place("pier") });
    expect([put.push, put.to, put.after]).toEqual([{ lre: PROTOCOL_VERSION, type: "lre.draft.changed", worldId, version: 1, stored: true }, { userId: rig.host.userId }, true]);
    expect((await pushed({ type: "lre.editor", worldId, base: null, op: "get" })).push).toBeNull();
    const saved = await pushed({ type: "lre.lore", op: "save", chatId });
    expect([saved.push, saved.after]).toEqual([{ lre: PROTOCOL_VERSION, type: "lre.draft.changed", worldId, version: 2, stored: true }, true]);
    const committed = await pushed({ type: "lre.world", op: "commit", worldId, base: null });
    expect(committed.push).toEqual({ lre: PROTOCOL_VERSION, type: "lre.draft.changed", worldId, version: 0, stored: false });
    const restored = await pushed({ type: "lre.editor", worldId, base: null, op: "restore", revision: (await indexOf(rig, worldId)).revisions[0] });
    expect(restored.push).toEqual({ lre: PROTOCOL_VERSION, type: "lre.draft.changed", worldId, version: 1, stored: true });
    const discarded = await pushed({ type: "lre.editor", worldId, base: null, op: "discard" });
    expect(discarded.push).toEqual({ lre: PROTOCOL_VERSION, type: "lre.draft.changed", worldId, version: 0, stored: false });
    // A refused write changed nothing, so nothing is pushed.
    expect((await pushed({ type: "lre.editor", worldId, base: null, op: "put", collection: "places", id: "x", value: place("x"), version: 5 })).push).toBeNull();
  });

  test("hello answers the agent level, and an outside client's hello is logged to the user's diagnostics", async () => {
    const rig = new Rig();
    expect(rig.body(await rig.send({ type: "lre.hello", chatId: null }, "browser"))).toEqual({ accepted: true, agentApi: AGENT_API });
    expect(rig.body(await rig.send({ type: "lre.hello", chatId: null, client: { name: "lumirpengine\nforged: line", version: "0.1.0" } }, "cli"))).toEqual({ accepted: true, agentApi: AGENT_API });
    expect(rig.host.userLogs.get(rig.host.userId)?.filter((l) => l.includes("outside client"))).toEqual(["info: [LumiRPEngine] outside client connected: lumirpengine forged: line 0.1.0"]);
    // The browser's session stays Build's.
    const worldId = await rig.newWorld();
    await editorOf(rig, worldId).ok({ op: "put", collection: "places", id: "pier", value: place("pier") });
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }, "browser"));
    expect((await indexOf(rig, worldId)).history?.map((h) => h.source)).toEqual(["create", "build"]);
  });
});

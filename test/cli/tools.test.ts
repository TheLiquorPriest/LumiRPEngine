// The tools over a fake Lumiverse: what each live tool asks LumiRPEngine for (the agent API's
// requests, exactly), what it answers the agent, and the offline tools on the starter worlds.

import { describe, expect, test } from "bun:test";
import { callTool } from "../../src/cli/tools";
import type { ToolContext } from "../../src/cli/tools";
import { templateFile } from "../../src/cli/offline";
import { client, FakeLumiverse } from "./fake-lumiverse";

async function call(ctx: ToolContext, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; data: Record<string, unknown>; isError: boolean }> {
  const result = await callTool(name, args, ctx);
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(result.text) as Record<string, unknown>;
  } catch {
    // prose answers stay text
  }
  return { text: result.text, data, isError: result.isError === true };
}

const person = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, kind: "person", name, tier: "background", fields: {}, relations: [], ...extra });

describe("live tools", () => {
  test("lre_worlds lists each world with its draft; lre_world reads the draft by default, the head and a revision by prefix", async () => {
    const fake = new FakeLumiverse();
    const w = fake.lre.seed("Brindlemere", "fantasy_town");
    const { ctx } = client(fake);
    expect((await call(ctx, "lre_worlds")).data).toEqual({ worlds: [{ id: w.index.id, name: "Brindlemere", head: w.index.head, revisions: 1, history: 1, draft: { stored: false, version: 0 } }] });
    const outline = await call(ctx, "lre_world", { worldId: w.index.id });
    expect(outline.text).toContain("none is stored, so this is its head");
    expect(outline.text).toContain("too big for one answer, so here is its outline");
    expect(outline.text).toMatch(/- entities: \d+ items \(/);
    expect(outline.text.length).toBeLessThan(24_000);
    const one = await call(ctx, "lre_world", { worldId: w.index.id, source: w.index.head.slice(0, 8), pointer: `/entities/${String(Object.keys(fake.lre.world(w.index.id).revisions.get(w.index.head)?.entities ?? {})[0])}` });
    expect(one.isError).toBe(false);
    expect(one.text).toContain(`the head of “Brindlemere” (${w.index.id}), revision ${w.index.head}`);
    const missing = await call(ctx, "lre_world", { worldId: w.index.id, pointer: "/entities/nobody_here" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("/entities holds");
    expect(fake.lre.sent("lre.editor", "get")[0]).toEqual({ type: "lre.editor", op: "get", worldId: w.index.id, base: null });
    expect(fake.lre.sent("lre.world", "get")).toEqual([{ type: "lre.world", op: "get", worldId: w.index.id, revision: w.index.head }]);
  });

  test("lre_edit patches the draft with the version and base it read, and reports what changed, lint and new macros", async () => {
    const fake = new FakeLumiverse();
    const w = fake.lre.seed("Alpha");
    const { ctx } = client(fake);
    const ops = [
      { op: "add", path: "/entities/mara", value: person("mara", "Mara") },
      { op: "add", path: "/lore/rumor", value: { id: "rumor", title: "A rumor", content: "Ask {{char}} about it.", keys: [], links: [] } },
    ];
    const edit = await call(ctx, "lre_edit", { worldId: w.index.id, ops });
    expect(edit.isError).toBe(false);
    expect(edit.data).toMatchObject({ worldId: w.index.id, version: 1, changed: { entities: { added: 1 }, lore: { added: 1 } }, macroHazards: [{ path: "lore.rumor.content", macro: "{{char}}" }] });
    expect(fake.lre.sent("lre.editor", "patch")).toEqual([{ type: "lre.editor", op: "patch", worldId: w.index.id, base: w.index.head, version: 0, ops }]);
    // A stale expectVersion is refused before anything is sent; a malformed op too.
    const stale = await call(ctx, "lre_edit", { worldId: w.index.id, ops: [{ op: "remove", path: "/entities/mara" }], expectVersion: 0 });
    expect(stale.isError).toBe(true);
    expect(stale.text).toContain("is at version 1, not 0");
    const bad = await call(ctx, "lre_edit", { worldId: w.index.id, ops: [{ op: "move", path: "/x" }] });
    expect(bad.text).toBe("ops[0]: move needs from, a JSON Pointer.");
    const refused = await call(ctx, "lre_edit", { worldId: w.index.id, ops: [{ op: "replace", path: "/entities/nobody/name", value: "x" }] });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("Nothing changed: LumiRPEngine refused the patch.");
    expect(fake.lre.sent("lre.editor", "patch")).toHaveLength(2);
  });

  test("lre_edit without expectVersion rereads once when someone wrote in between", async () => {
    const fake = new FakeLumiverse();
    const w = fake.lre.seed("Alpha");
    const { ctx } = client(fake);
    // Build writes between the tool's read and its patch: the first patch meets a moved version.
    const handle = fake.lre.handle.bind(fake.lre);
    let raced = false;
    fake.lre.handle = (r) => {
      if (r.type === "lre.editor" && r.op === "patch" && !raced) {
        raced = true;
        handle({ lre: 1, type: "lre.editor", reqId: "build", op: "patch", worldId: w.index.id, base: null, ops: [{ op: "add", path: "/entities/from_build", value: person("from_build", "Build") }] });
      }
      return handle(r);
    };
    const edit = await call(ctx, "lre_edit", { worldId: w.index.id, ops: [{ op: "add", path: "/entities/mara", value: person("mara", "Mara") }] });
    expect(edit.data.version).toBe(2);
    expect(Object.keys(w.draft?.doc.entities ?? {})).toEqual(expect.arrayContaining(["from_build", "mara"]));
    // The first patch is Build's own; the tool's met a moved version, read again and applied on version 1.
    expect(fake.lre.sent("lre.editor", "patch").map((r) => r.version)).toEqual([undefined, 0, 1]);
  });

  test("lre_draft, lre_diff, lre_commit with a note, and lre_history", async () => {
    const fake = new FakeLumiverse();
    const w = fake.lre.seed("Alpha");
    const { ctx } = client(fake);
    expect((await call(ctx, "lre_commit", { worldId: w.index.id })).text).toContain("There is no draft of “Alpha” to commit");
    await call(ctx, "lre_edit", { worldId: w.index.id, ops: [{ op: "add", path: "/entities/mara", value: person("mara", "Mara") }, { op: "replace", path: "/name", value: "Alpha Prime" }] });
    const draft = await call(ctx, "lre_draft", { worldId: w.index.id });
    expect(draft.data).toMatchObject({ stored: true, version: 1, headMoved: false, changes: { counts: { entities: { added: 1 }, name: { changed: 1 } } } });
    await call(ctx, "lre_edit", { worldId: w.index.id, ops: [{ op: "replace", path: "/entities/mara/name", value: "Mara Voss" }] });
    const diff = await call(ctx, "lre_diff", { worldId: w.index.id });
    expect(diff.data.changes).toEqual(expect.arrayContaining([expect.objectContaining({ key: "/entities/mara", label: "entities › Mara Voss (mara)", kind: "added" }), expect.objectContaining({ key: "/name", kind: "changed", fields: [{ path: "/name", kind: "changed", from: '"Alpha"', to: '"Alpha Prime"' }] })]));
    const commit = await call(ctx, "lre_commit", { worldId: w.index.id, note: "Add Mara" });
    expect(commit.isError).toBe(false);
    expect(fake.lre.sent("lre.world", "commit")).toEqual([{ type: "lre.world", op: "commit", worldId: w.index.id, base: w.index.history?.[0]?.revision, note: "Add Mara" }]);
    const history = await call(ctx, "lre_history", { worldId: w.index.id });
    expect((history.data.history as { source: string; note?: string; head?: true }[]).map((h) => [h.source, h.note ?? null, h.head ?? false])).toEqual([
      ["create", null, false],
      ["agent", "Add Mara", true],
    ]);
    // A changed field of a changed item shows as a pointer below it.
    await call(ctx, "lre_edit", { worldId: w.index.id, ops: [{ op: "replace", path: "/entities/mara/name", value: "Mara V." }] });
    const field = await call(ctx, "lre_diff", { worldId: w.index.id, from: "head", to: "draft" });
    expect(field.data.changes).toEqual([{ key: "/entities/mara", label: "entities › Mara V. (mara)", kind: "changed", fields: [{ path: "/entities/mara/name", kind: "changed", from: '"Mara Voss"', to: '"Mara V."' }] }]);
  });

  test("a commit LumiRPEngine refuses lists the lint errors; a moved head says so", async () => {
    const fake = new FakeLumiverse();
    const w = fake.lre.seed("Alpha");
    const { ctx } = client(fake);
    await call(ctx, "lre_edit", { worldId: w.index.id, ops: [{ op: "replace", path: "/pov", value: "ghost" }] });
    const refused = await call(ctx, "lre_commit", { worldId: w.index.id, note: "Break it" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("Not committed: the draft has");
    expect(refused.text).toContain("missing_pov");
    await call(ctx, "lre_discard", { worldId: w.index.id });
    await call(ctx, "lre_edit", { worldId: w.index.id, ops: [{ op: "replace", path: "/name", value: "Mine" }] });
    // Someone else commits another revision meanwhile.
    const stored = fake.lre.world(w.index.id);
    const draft = stored.draft;
    stored.draft = { base: stored.index.head, doc: { ...structuredClone(stored.revisions.get(stored.index.head) ?? fake.lre.world(w.index.id).revisions.values().next().value!), name: "Theirs" }, version: 1 };
    fake.lre.handle({ lre: 1, type: "lre.world", reqId: "other", op: "commit", worldId: w.index.id, base: null });
    stored.draft = draft;
    const moved = await call(ctx, "lre_commit", { worldId: w.index.id });
    expect(moved.isError).toBe(true);
    expect(moved.text).toContain("the head moved since");
  });

  test("lre_discard and lre_restore send the version they read", async () => {
    const fake = new FakeLumiverse();
    const w = fake.lre.seed("Alpha");
    const { ctx } = client(fake);
    const first = w.index.head;
    expect((await call(ctx, "lre_discard", { worldId: w.index.id })).data).toEqual({ worldId: w.index.id, discarded: false, note: "No draft was stored; there was nothing to discard." });
    await call(ctx, "lre_edit", { worldId: w.index.id, ops: [{ op: "replace", path: "/name", value: "Beta" }] });
    await call(ctx, "lre_commit", { worldId: w.index.id, note: "Rename" });
    const restored = await call(ctx, "lre_restore", { worldId: w.index.id, revision: first });
    // Versions count on across drafts: the committed one was 1, so the restored draft is 2.
    expect(restored.data).toMatchObject({ restored: first, version: 2, replaced: null });
    expect(fake.lre.sent("lre.editor", "restore")).toEqual([{ type: "lre.editor", op: "restore", worldId: w.index.id, base: null, version: 0, revision: first }]);
    const discarded = await call(ctx, "lre_discard", { worldId: w.index.id });
    expect(discarded.data).toMatchObject({ discarded: true, version: 0, dropped: { name: { changed: 1 } } });
    expect(fake.lre.sent("lre.editor", "discard")).toEqual([{ type: "lre.editor", op: "discard", worldId: w.index.id, base: null, version: 2 }]);
  });

  test("lre_world_delete refuses without the exact name, says what it would delete, and sends nothing", async () => {
    const fake = new FakeLumiverse();
    const w = fake.lre.seed("The Hall");
    fake.lre.chats = [{ chatId: "c1", name: "Night at the hall", worldId: w.index.id, revision: w.index.head, behind: false }];
    const { ctx } = client(fake);
    for (const confirm of [undefined, "the hall", "The Hall "]) {
      const refused = await call(ctx, "lre_world_delete", { worldId: w.index.id, ...(confirm !== undefined ? { confirm } : {}) });
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain("Not deleted");
      expect(refused.text).toContain("1 chat plays it (Night at the hall)");
      expect(refused.text).toContain('confirm set to its exact name: "The Hall"');
    }
    expect(fake.lre.sent("lre.world", "delete")).toEqual([]);
    const deleted = await call(ctx, "lre_world_delete", { worldId: w.index.id, confirm: "The Hall" });
    expect(deleted.data).toEqual({ deleted: w.index.id, name: "The Hall", worldsLeft: 0 });
    expect(fake.lre.sent("lre.world", "delete")).toEqual([{ type: "lre.world", op: "delete", worldId: w.index.id }]);
  });

  test("read-only refuses every write tool before anything reaches the host", async () => {
    const fake = new FakeLumiverse();
    const w = fake.lre.seed("Alpha");
    const { ctx } = client(fake, { readOnly: true });
    const writes: [string, Record<string, unknown>][] = [
      ["lre_world_create", { name: "X" }],
      ["lre_world_import", { world: { format: "lre-world-v1" } }],
      ["lre_edit", { worldId: w.index.id, ops: [{ op: "remove", path: "/entities/you" }] }],
      ["lre_commit", { worldId: w.index.id }],
      ["lre_discard", { worldId: w.index.id }],
      ["lre_restore", { worldId: w.index.id, revision: w.index.head }],
      ["lre_world_delete", { worldId: w.index.id, confirm: "Alpha" }],
      ["lre_attach", { worldId: w.index.id, chatId: "c1" }],
      ["lre_upgrade", { chatId: "c1" }],
    ];
    for (const [name, args] of writes) {
      const result = await call(ctx, name, args);
      expect({ name, isError: result.isError, ro: result.text.includes("read-only") }).toEqual({ name, isError: true, ro: true });
    }
    expect(fake.lre.received).toEqual([]);
    expect((await call(ctx, "lre_worlds")).isError).toBe(false);
  });

  test("lre_search finds words in heads and stored drafts, without a draft's unchanged items twice", async () => {
    const fake = new FakeLumiverse();
    const a = fake.lre.seed("Alpha");
    const b = fake.lre.seed("Beta");
    const { ctx } = client(fake);
    await call(ctx, "lre_edit", { worldId: a.index.id, ops: [{ op: "add", path: "/entities/keeper", value: person("keeper", "Old Keeper", { fields: { notes: "Tends the lighthouse lamp each night." } }) }] });
    await call(ctx, "lre_edit", { worldId: b.index.id, ops: [{ op: "add", path: "/places/lighthouse", value: { id: "lighthouse", name: "The lighthouse", fields: {} } }] });
    await call(ctx, "lre_commit", { worldId: b.index.id });
    await call(ctx, "lre_edit", { worldId: b.index.id, ops: [{ op: "replace", path: "/places/lighthouse/name", value: "The old lighthouse" }] });
    const found = await call(ctx, "lre_search", { query: "lighthouse" });
    const hits = found.data.hits as { worldId: string; source: string; collection: string; id: string; field: string; snippet: string }[];
    expect(hits.map((h) => [h.worldId, h.source, h.collection, h.id])).toEqual(
      expect.arrayContaining([
        [a.index.id, "draft", "entities", "keeper"],
        [b.index.id, "draft", "places", "lighthouse"],
        [b.index.id, "head", "places", "lighthouse"],
      ]),
    );
    expect(hits.find((h) => h.id === "keeper")).toMatchObject({ field: "/fields/notes", snippet: "Tends the lighthouse lamp each night." });
    // Each draft's unchanged POV and places never appear twice.
    expect(new Set(hits.map((h) => `${h.worldId} ${h.source} ${h.collection} ${h.id}`)).size).toBe(hits.length);
    const scoped = await call(ctx, "lre_search", { query: "old lighthouse", worldId: b.index.id, collections: ["places"], limit: 1 });
    expect(scoped.data.hits).toEqual([expect.objectContaining({ worldId: b.index.id, source: "draft", id: "lighthouse", label: "The old lighthouse" })]);
  });

  test("create, import, export, chats, attach and upgrade send the agent API's requests", async () => {
    const fake = new FakeLumiverse();
    const { ctx } = client(fake);
    const created = await call(ctx, "lre_world_create", { name: "Harrowmere", template: "mystery_manor" });
    expect(fake.lre.sent("lre.world", "create")).toEqual([{ type: "lre.world", op: "create", name: "Harrowmere", template: "mystery_manor" }]);
    const worldId = String(created.data.worldId);
    const unknown = await call(ctx, "lre_world_create", { name: "X", template: "nope" });
    expect(unknown.text).toContain('There is no starter "nope" on your Lumiverse. Its starters: fantasy_town');
    const file = templateFile("fantasy_town");
    const imported = await call(ctx, "lre_world_import", { world: file });
    expect(imported.isError).toBe(false);
    expect(fake.lre.sent("lre.world", "import")).toEqual([{ type: "lre.world", op: "import", file }]);
    const broken = await call(ctx, "lre_world_import", { world: { format: "lre-world-v1", id: "x" } });
    expect(broken.text).toContain("doesn't load as a world, so nothing was sent");
    expect(fake.lre.sent("lre.world", "import")).toHaveLength(1);
    const exported = await call(ctx, "lre_world_export", { worldId });
    expect(exported.text).toContain("characters 0–20000");
    expect(exported.text).toContain(`lumirpengine export ${worldId} --out <file>`);
    expect(fake.lre.sent("lre.world", "export")).toEqual([{ type: "lre.world", op: "export", worldId, revision: fake.lre.world(worldId).index.head }]);
    await call(ctx, "lre_attach", { worldId, chatId: "chat_1" });
    expect(fake.lre.sent("lre.world", "attach")).toEqual([{ type: "lre.world", op: "attach", worldId, chatId: "chat_1" }]);
    expect((await call(ctx, "lre_chats", { worldId })).data).toEqual({ chats: [{ chatId: "chat_1", name: "Chat", worldId, revision: fake.lre.world(worldId).index.head, behind: false }] });
    expect(fake.lre.sent("lre.world", "chats")).toEqual([{ type: "lre.world", op: "chats", worldId }]);
    // A newer head, then the Upgrade: previewed with secrets hidden, then applied with the default picks.
    await call(ctx, "lre_edit", { worldId, ops: [{ op: "replace", path: "/name", value: "Harrowmere Hall" }] });
    await call(ctx, "lre_commit", { worldId, note: "Rename" });
    const head = fake.lre.world(worldId).index.head;
    fake.lre.preview = {
      lines: [{ text: "Upgrade to the new revision", tone: "info" }],
      upgrade: {
        from: "a",
        to: head,
        tracks: [],
        entities: [
          { entity: "butler", name: "Hobbs", kind: "Person", status: "changed", changes: [{ id: "butler:name", label: "Name", from: "Hobbs", to: "Mr Hobbs", options: ["take", "keep"], pick: "take", why: "unchanged", targets: [{ entity: "butler", part: "name" }] }] },
          { entity: "killer", name: "Lady Vane", kind: "Person", status: "changed", secret: true, changes: [] },
        ],
      },
    };
    const preview = await call(ctx, "lre_upgrade", { chatId: "chat_1", preview: true });
    expect(fake.lre.sent("lre.marker")).toEqual([{ type: "lre.marker", chatId: "chat_1", kind: "migrate", to: head, preview: true }]);
    expect(preview.text).not.toContain("Lady Vane");
    expect(preview.data).toMatchObject({ hidden: 1, preview: { entities: [{ name: "Hobbs" }, { hidden: "A hidden change" }] } });
    expect((await call(ctx, "lre_upgrade", { chatId: "chat_1", preview: true, spoilers: true })).text).toContain("Lady Vane");
    const applied = await call(ctx, "lre_upgrade", { chatId: "chat_1" });
    expect(applied.data).toMatchObject({ chatId: "chat_1", revision: head });
    expect(fake.lre.sent("lre.world", "upgrade")).toEqual([{ type: "lre.world", op: "upgrade", chatId: "chat_1", to: head, merge: {} }]);
  });

  test("lre_status says who is signed in where, never the token, and what LumiRPEngine speaks there", async () => {
    const fake = new FakeLumiverse();
    const { ctx, token } = client(fake);
    const status = await call(ctx, "lre_status");
    expect(status.data).toMatchObject({ signedIn: true, lumiverse: fake.base, user: "tom", lumiRPEngine: { status: "running", version: "0.0.1", agentApi: 1 }, client: { agentApi: 1, worldFormat: "lre-world-v1" } });
    expect(status.text).not.toContain(token);
  });
});

describe("offline tools", () => {
  const files = { "manor.json": JSON.stringify(templateFile("mystery_manor")), "broken.json": "{ not json" };
  const { ctx } = client(new FakeLumiverse(), { files });

  test("check, playtest and check world run a starter with the bundled engine", async () => {
    const check = await call(ctx, "lre_check", { path: "manor.json" });
    expect(check.data).toMatchObject({ ok: true, errors: 0, world: { id: "mystery_manor", name: "Mystery manor" } });
    expect((check.data.contents as Record<string, number>).entities).toBeGreaterThan(5);
    const play = await call(ctx, "lre_playtest", { path: "manor.json", turns: ["look around", "wait an hour"] });
    expect((play.data.turns as { user: string }[]).map((t) => t.user)).toEqual(["look around", "wait an hour"]);
    const days = await call(ctx, "lre_check_world", { path: "manor.json", days: 1 });
    expect((days.data.days as { user: string }[]).map((t) => t.user)).toEqual(["Day 1"]);
    expect(days.text.length).toBeLessThan(24_000);
    const broken = await call(ctx, "lre_check", { path: "broken.json" });
    expect(broken.data).toMatchObject({ ok: false, loads: false });
    expect((await call(ctx, "lre_check", { path: "nowhere.json" })).text).toContain("Can't read nowhere.json");
    expect((await call(ctx, "lre_playtest", { path: "manor.json" })).text).toContain("Give turns");
  });

  test("check lists the macro hazards a world carries and the lint errors that would stop a commit", async () => {
    const file = templateFile("fantasy_town") as { world: Record<string, unknown> };
    const world = { ...file.world, pov: "nobody", lore: { ...(file.world.lore as object), note: { id: "note", title: "Note", content: "Hello {{user}}", keys: [], links: [] } } };
    const check = await call(ctx, "lre_check", { world });
    expect(check.data.ok).toBe(false);
    expect(check.data.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "missing_pov", severity: "error" })]));
    expect(check.data.macroHazards).toEqual(expect.arrayContaining([{ path: "lore.note.content", macro: "{{user}}" }]));
  });

  test("guide, docs, schema, templates and template answer within one answer", async () => {
    const guide = await call(ctx, "lre_guide");
    expect(guide.text).toContain("# Writing LumiRPEngine worlds: a guide for agents");
    expect((await call(ctx, "lre_guide", { topic: "A revealed secret starts one stage earlier" })).text).toContain('"when": "true"');
    expect((await call(ctx, "lre_docs", { query: "account opening", doc: "reference" })).text).toContain("REFERENCE.md ›");
    expect((await call(ctx, "lre_docs", { query: "x", doc: "nope" })).isError).toBe(true);
    expect((await call(ctx, "lre_schema", { pointer: "/properties/pov" })).text).toContain("the world schema (lre-world-v1) at /properties/pov");
    expect((await call(ctx, "lre_schema", { schema: "map" })).isError).toBe(false);
    const template = await call(ctx, "lre_template", { id: "modern_slice_of_life", pointer: "/world/tables" });
    expect(template.text).toContain("economy.catalog");
    for (const answer of [guide, template]) expect(answer.text.length).toBeLessThanOrEqual(24_000);
  });
});

// The tools over a fake Lumiverse: what each live tool asks LumiRPEngine for (the agent API's
// requests, exactly), what it answers the agent, and the offline tools on the starter worlds.

import { describe, expect, test } from "bun:test";
import { BODY_LIMIT } from "../../src/cli/read";
import { callTool } from "../../src/cli/tools";
import type { ToolContext } from "../../src/cli/tools";
import { templateFile } from "../../src/cli/offline";
import type { WorldDoc } from "../../src/shared/world";
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
    expect((await call(ctx, "lre_worlds")).data).toEqual({ worlds: [{ id: w.index.id, name: "Brindlemere", head: w.index.head, revisions: 1, draft: { stored: false, version: 0 } }] });
    const outline = await call(ctx, "lre_world", { worldId: w.index.id });
    // The version shows with no draft stored too: the next write's expectVersion names it.
    expect(outline.text).toContain(`the draft of “Brindlemere” (${w.index.id}), version 0: none is stored, so this is its head`);
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
    const first = w.index.head;
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
    expect(fake.lre.sent("lre.world", "commit")).toEqual([{ type: "lre.world", op: "commit", worldId: w.index.id, base: first, version: 2, note: "Add Mara" }]);
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
    // A version is never repeated: the commit counted one (2), so the restored draft is 3, and the discard counts one more.
    expect(restored.data).toMatchObject({ restored: first, version: 3, replaced: null });
    expect(fake.lre.sent("lre.editor", "restore")).toEqual([{ type: "lre.editor", op: "restore", worldId: w.index.id, base: null, version: 2, revision: first }]);
    const discarded = await call(ctx, "lre_discard", { worldId: w.index.id });
    expect(discarded.data).toMatchObject({ discarded: true, version: 4, dropped: { name: { changed: 1 } } });
    expect(fake.lre.sent("lre.editor", "discard")).toEqual([{ type: "lre.editor", op: "discard", worldId: w.index.id, base: null, version: 3 }]);
  });

  test("with expectVersion, lre_commit, lre_discard and lre_restore leave alone a draft the user wrote since", async () => {
    const fake = new FakeLumiverse();
    const w = fake.lre.seed("Alpha");
    const { ctx } = client(fake);
    const first = w.index.head;
    const mine = await call(ctx, "lre_edit", { worldId: w.index.id, ops: [{ op: "add", path: "/entities/mara", value: person("mara", "Mara") }] });
    const read = Number(mine.data.version);
    // The user goes on in Build after the agent's read.
    fake.lre.handle({ lre: 1, type: "lre.editor", reqId: "build", op: "patch", worldId: w.index.id, base: null, ops: [{ op: "add", path: "/entities/from_build", value: person("from_build", "Build") }] });
    const refusals: [string, Record<string, unknown>, string][] = [
      ["lre_discard", { worldId: w.index.id, expectVersion: read }, "Nothing discarded"],
      ["lre_commit", { worldId: w.index.id, note: "Add Mara", expectVersion: read }, "Not committed"],
      ["lre_restore", { worldId: w.index.id, revision: first, expectVersion: read }, "Nothing restored"],
    ];
    for (const [name, args, refused] of refusals) {
      const result = await call(ctx, name, args);
      expect([name, result.isError, result.text]).toEqual([name, true, expect.stringContaining(`${refused}: the draft of ${w.index.id} is at version ${read + 1}, not ${read}.`)]);
    }
    expect(fake.lre.sent("lre.editor", "discard")).toEqual([]);
    expect(fake.lre.sent("lre.editor", "restore")).toEqual([]);
    expect(fake.lre.sent("lre.world", "commit")).toEqual([]);
    expect(Object.keys(w.draft?.doc.entities ?? {})).toEqual(expect.arrayContaining(["mara", "from_build"]));
    // Against the version that holds the user's change too, the commit goes through.
    const committed = await call(ctx, "lre_commit", { worldId: w.index.id, note: "Add Mara", expectVersion: read + 1 });
    expect(committed.isError).toBe(false);
    expect(fake.lre.sent("lre.world", "commit")).toHaveLength(1);
    // With no draft stored the version still moves: the user's edit and Commit in Build count, so an edit meant for before them is refused.
    const before = Number((await call(ctx, "lre_draft", { worldId: w.index.id })).data.version);
    expect(before).toBe(read + 2);
    fake.lre.handle({ lre: 1, type: "lre.editor", reqId: "build", op: "patch", worldId: w.index.id, base: null, ops: [{ op: "replace", path: "/name", value: "Theirs" }] });
    fake.lre.handle({ lre: 1, type: "lre.world", reqId: "build", op: "commit", worldId: w.index.id, base: null });
    const late = await call(ctx, "lre_edit", { worldId: w.index.id, ops: [{ op: "replace", path: "/name", value: "Mine" }], expectVersion: before });
    expect(late.isError).toBe(true);
    expect(late.text).toContain(`is at version ${before + 2}, not ${before}`);
    expect(fake.lre.world(w.index.id).revisions.get(fake.lre.world(w.index.id).index.head)?.name).toBe("Theirs");
  });

  test("lre_commit sends the version it read, so a write that lands just before the commit isn't committed unseen", async () => {
    const fake = new FakeLumiverse();
    const w = fake.lre.seed("Alpha");
    const { ctx } = client(fake);
    await call(ctx, "lre_edit", { worldId: w.index.id, ops: [{ op: "add", path: "/entities/mara", value: person("mara", "Mara") }] });
    // Build writes between the tool's read and its commit.
    const handle = fake.lre.handle.bind(fake.lre);
    fake.lre.handle = (r) => {
      if (r.type === "lre.world" && r.op === "commit") handle({ lre: 1, type: "lre.editor", reqId: "build", op: "patch", worldId: w.index.id, base: null, ops: [{ op: "add", path: "/entities/from_build", value: person("from_build", "Build") }] });
      return handle(r);
    };
    const raced = await call(ctx, "lre_commit", { worldId: w.index.id, note: "Add Mara" });
    expect(raced.isError).toBe(true);
    expect(raced.text).toContain(`Not committed: the draft of ${w.index.id} is at version 2, not 1.`);
    expect(fake.lre.sent("lre.world", "commit")).toEqual([{ type: "lre.world", op: "commit", worldId: w.index.id, base: w.index.head, version: 1, note: "Add Mara" }]);
    expect(fake.lre.world(w.index.id).history).toHaveLength(1);
  });

  test("lre_world_delete previews without confirm, refuses a name that isn't exact, and deletes only with it", async () => {
    const fake = new FakeLumiverse();
    const w = fake.lre.seed("The Hall");
    fake.lre.chats = [{ chatId: "c1", name: "Night at the hall", worldId: w.index.id, revision: w.index.head, behind: false }];
    const { ctx } = client(fake);
    const preview = await call(ctx, "lre_world_delete", { worldId: w.index.id });
    expect(preview.isError).toBe(false);
    expect(preview.data).toMatchObject({ deleted: false, worldId: w.index.id, name: "The Hall", wouldDelete: { revisions: 1, draft: null }, chats: [{ chatId: "c1", name: "Night at the hall" }] });
    // What stays behind is the user's to clean up: the book in World Books, and chats without their world.
    expect(String(preview.data.afterwards)).toContain("Its chat loses its world");
    expect(String(preview.data.afterwards)).toContain('engine lore book ("LumiRPEngine · " and the world\'s name) stays in World Books, still attached to those chats');
    expect(String(preview.data.toDelete)).toContain('confirm set to its exact name: "The Hall"');
    for (const confirm of ["the hall", "The Hall "]) {
      const refused = await call(ctx, "lre_world_delete", { worldId: w.index.id, confirm });
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain(`Not deleted: confirm ${JSON.stringify(confirm)} isn't the world's exact name.`);
      expect(refused.text).toContain("Night at the hall");
    }
    expect(fake.lre.sent("lre.world", "delete")).toEqual([]);
    expect(fake.lre.worlds.has(w.index.id)).toBe(true);
    const deleted = await call(ctx, "lre_world_delete", { worldId: w.index.id, confirm: "The Hall" });
    expect(deleted.data).toMatchObject({ deleted: w.index.id, name: "The Hall", worldsLeft: 0 });
    expect(String(deleted.data.afterwards)).toContain("still in World Books");
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

  test("lre_search and lre_worlds go on past a world they can't read, and name it", async () => {
    const fake = new FakeLumiverse();
    const good = fake.lre.seed("Alpha");
    const bad = fake.lre.seed("Beta");
    const { ctx } = client(fake);
    await call(ctx, "lre_edit", { worldId: good.index.id, ops: [{ op: "add", path: "/entities/keeper", value: person("keeper", "Old Keeper", { fields: { notes: "Tends the lighthouse lamp." } }) }] });
    // Beta's draft can't be read: a broken file on the host, say.
    const handle = fake.lre.handle.bind(fake.lre);
    fake.lre.handle = (r) => (r.type === "lre.editor" && r.worldId === bad.index.id ? { lre: 1, type: "lre.error", reqId: r.reqId, code: "internal", message: "the draft file is unreadable" } : handle(r));
    const found = await call(ctx, "lre_search", { query: "lighthouse" });
    expect(found.isError).toBe(false);
    expect(found.data).toMatchObject({ hits: [{ worldId: good.index.id, id: "keeper" }], searched: { worlds: 1, drafts: 1 }, skipped: [{ worldId: bad.index.id, name: "Beta" }] });
    expect(JSON.stringify(found.data.skipped)).toContain("the draft file is unreadable");
    const listed = await call(ctx, "lre_worlds");
    expect(listed.isError).toBe(false);
    expect(listed.data).toMatchObject({ worlds: [{ id: good.index.id, draft: { stored: true, version: 1 } }, { id: bad.index.id, draft: null }], skipped: [{ worldId: bad.index.id, name: "Beta" }] });
    // With nothing readable at all, the search fails rather than answer "no hits".
    const alone = await call(ctx, "lre_search", { query: "lighthouse", worldId: bad.index.id });
    expect(alone.isError).toBe(true);
    expect(alone.text).toContain("No world could be searched");
  });

  test("a key that reaches a prototype is no change, and leaves the counts of later diffs alone", async () => {
    const fake = new FakeLumiverse();
    const odd = fake.lre.seed("Alpha");
    const plain = fake.lre.seed("Beta");
    // As JSON.parse makes it: "__proto__" an own key of the draft.
    const doc: unknown = JSON.parse(JSON.stringify(odd.revisions.get(odd.index.head)).replace(/^\{/, '{"__proto__":{"x":1},'));
    odd.draft = { base: odd.index.head, doc: doc as WorldDoc, version: 1 };
    const { ctx } = client(fake);
    try {
      const strange = await call(ctx, "lre_draft", { worldId: odd.index.id });
      expect(strange.data.changes).toEqual({ counts: {}, items: [], more: 0 });
      await call(ctx, "lre_edit", { worldId: plain.index.id, ops: [{ op: "add", path: "/entities/keeper", value: person("keeper", "Old Keeper") }] });
      const honest = await call(ctx, "lre_draft", { worldId: plain.index.id });
      expect(honest.data.changes).toMatchObject({ counts: { entities: { added: 1 } } });
      expect(Object.hasOwn(Object.prototype, "added")).toBe(false);
    } finally {
      // A failure here must not leak into the other tests.
      Reflect.deleteProperty(Object.prototype, "added");
    }
  });

  test("export pages never split a character in two: each page survives UTF-8, and the pages together are the file", async () => {
    const fake = new FakeLumiverse();
    const w = fake.lre.seed("Alpha");
    const { ctx } = client(fake);
    const exported = (): string => JSON.stringify({ format: "lre-world-export-v1", world: fake.lre.world(w.index.id).revisions.get(fake.lre.world(w.index.id).index.head) });
    await call(ctx, "lre_edit", { worldId: w.index.id, ops: [{ op: "add", path: "/entities/keeper", value: person("keeper", "Old Keeper", { fields: { notes: "@@" } }) }] });
    await call(ctx, "lre_commit", { worldId: w.index.id });
    // Put "🗡" (two UTF-16 units) where the first page ends: its first half the page's last unit.
    const notes = `${"x".repeat(BODY_LIMIT - 1 - exported().indexOf("@@"))}🗡 the blade${"y".repeat(BODY_LIMIT)}`;
    await call(ctx, "lre_edit", { worldId: w.index.id, ops: [{ op: "replace", path: "/entities/keeper/fields/notes", value: notes }] });
    await call(ctx, "lre_commit", { worldId: w.index.id });
    const whole = exported();
    expect(whole.charCodeAt(BODY_LIMIT - 1)).toBe("🗡".charCodeAt(0));
    const pages: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await call(ctx, "lre_world_export", { worldId: w.index.id, offset });
      const body = /^[^\n]*:\n\n([\s\S]*?)\n\n\((?:Continues: read on with offset (\d+)|That is the end)\.\)/.exec(page.text);
      if (body === null) throw new Error(`not a page: ${page.text.slice(0, 200)}`);
      // What reaches the user: each page as UTF-8, on stdout or in an MCP line.
      pages.push(Buffer.from(body[1] ?? "", "utf8").toString("utf8"));
      offset = body[2] === undefined ? null : Number(body[2]);
    }
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.join("")).toBe(whole);
    // An offset between the halves starts at the character.
    const between = await call(ctx, "lre_world_export", { worldId: w.index.id, offset: BODY_LIMIT });
    expect(between.text).toContain(`characters ${BODY_LIMIT - 1}–`);
    expect(between.text).toContain(":\n\n🗡 the blade");
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
    expect(applied.data).toMatchObject({ chatId: "chat_1", revision: head, pending: false });
    expect(fake.lre.sent("lre.world", "upgrade")).toEqual([{ type: "lre.world", op: "upgrade", chatId: "chat_1", to: head, merge: {} }]);
  });

  test("lre_upgrade asks about its one chat, says when the Upgrade waits for a turn to end, and won't guess at a chat it can't read", async () => {
    const fake = new FakeLumiverse();
    const w = fake.lre.seed("Alpha");
    const old = w.index.head;
    const { ctx } = client(fake);
    await call(ctx, "lre_edit", { worldId: w.index.id, ops: [{ op: "replace", path: "/name", value: "Alpha Prime" }] });
    await call(ctx, "lre_commit", { worldId: w.index.id, note: "Rename" });
    fake.lre.chats = [
      { chatId: "c1", name: "First", worldId: w.index.id, revision: old, behind: true },
      { chatId: "c2", name: "Second", worldId: w.index.id, revision: old, behind: true },
      { chatId: "c3", name: "Broken", worldId: w.index.id, revision: null, behind: false, reason: "its ledger is unreadable" },
    ];
    // Mid-turn: LumiRPEngine holds the marker until the turn ends.
    fake.lre.upgradePending = true;
    const applied = await call(ctx, "lre_upgrade", { chatId: "c2" });
    expect(applied.data).toMatchObject({ chatId: "c2", from: old, revision: w.index.head, pending: true });
    expect(String(applied.data.note)).toContain("lands when that turn ends");
    // Only c2's state was asked for, not every chat's.
    expect(fake.lre.sent("lre.world", "chats")).toEqual([{ type: "lre.world", op: "chats", chatId: "c2" }]);
    const broken = await call(ctx, "lre_upgrade", { chatId: "c3" });
    expect(broken.isError).toBe(true);
    expect(broken.text).toContain("can't read the state of chat c3 (its ledger is unreadable)");
    expect(fake.lre.sent("lre.world", "upgrade")).toHaveLength(1);
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

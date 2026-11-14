// The Files page's routes over a real tree, through RPE's own server (plan §5.2, §5.4, §14): the listing
// says which file of a name is taken and which replaces it; a file written as the user at a level becomes
// the file taken there; a replaced default shows its difference and resets; an update that changes a
// default under the user's own file leaves their file as it is and is reported; switching a name off
// writes the level's `off:` list, and RPH's own loader then finds it off; a page reaches nothing outside
// the tree, no shipped file is written or removed, and a call without a page's token is refused. Every
// name and text is invented.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, symlink, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { YAML } from "bun";
import { loadGuidance } from "rp-harness";
import type { App, RunningServer } from "../../src/app";
import { CHATS_FOLDER, type DefaultsDeps, layDefaults, type NoteFiles, TREE_MIGRATIONS, TreeChats, type TreeFileDiff, type TreeFileEntry, type TreeFiles, type TreeFileText, treeFiles, treeRoutes, type TreeStorage, type TreeSuggestionView, TreeSuggestions } from "../../src/tree/index";
import { bearer, type Bed, makeBed, makeKey, OWNER } from "../app/helpers";

const CHAT = "chat-bell";
const NAMES = { character: { id: "char-wren", name: "Wren Alder" }, chat: { name: "The Drowned Bell" } };

const SHIPPED_RPH: Record<string, string> = {
  "RPE-global.yml": "layered: [AGENTS]\noff: []\n",
  "ALL-AGENTS.md": "Every agent reads this.\n",
  ".agents/gm.md": "---\nname: gm\ndescription: Rules the scene.\n---\nThe shipped GM.\n",
  ".rules/consent.md": "---\ndescription: Asks before a hard turn.\nagents: all\n---\nAsk first.\n",
  ".rules/examples/nudge.md": "---\ndescription: An example.\nagents: all\n---\nA nudge.\n",
};
const SHIPPED_RPE: Record<string, string> = { "chat-defaults/WORLD.md": "# World\n", "chat-defaults/AGENTS.md": "Shipped chat agents.\n" };

async function put(folder: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), text);
  }
}

/** A config's `off:` list as it reads back. */
function offOf(text: string): unknown {
  const doc: unknown = YAML.parse(text);
  return typeof doc === "object" && doc !== null && "off" in doc ? doc.off : undefined;
}

describe("the Files page's routes", () => {
  let bed: Bed;
  let app: App;
  let server: RunningServer;
  let page: Record<string, string>;
  let chatFolder: string;
  /** How the shipped level is laid out at the app's start, and again by a test as an update would. */
  let defaults: DefaultsDeps;
  /** The folder standing for RPH's shipped files. */
  let rph: string;
  /** Where the turn lane keeps what RPH tells of agents' suggestions. */
  let suggestions: TreeSuggestions;
  /** Whether the test's chat has a turn going on. */
  let turning = false;
  /** The file port agents write through. */
  let port: TreeFiles;

  const call = async <T>(method: string, path: string, body?: unknown, headers: Record<string, string> = page): Promise<{ status: number; body: T }> => {
    const res = await fetch(`${server.url}${path}`, { method, headers: { ...headers, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: (await res.json()) as T };
  };
  const listing = async (): Promise<Map<string, TreeFileEntry>> => new Map((await call<{ files: TreeFileEntry[] }>("GET", `/api/v1/files?chat=${CHAT}`)).body.files.map((f) => [f.path, f]));

  beforeEach(async () => {
    bed = await makeBed();
    const sources = { rph: join(bed.root, "rph"), rpe: join(bed.root, "rpe") };
    rph = sources.rph;
    await put(sources.rph, SHIPPED_RPH);
    await put(sources.rpe, SHIPPED_RPE);
    app = await bed.open({
      areas: [
        {
          name: "tree",
          tables: { area: "files", migrations: TREE_MIGRATIONS },
          async mount(a) {
            defaults = { files: a.paths.files, scratch: a.paths.root, sources, writes: a.writes, now: () => Date.now() };
            await layDefaults(defaults);
            suggestions = new TreeSuggestions({ db: a.db, writes: a.writes, now: a.now });
            const chats = new TreeChats(a.db, a.writes, a.paths.files);
            port = treeFiles({ files: a.paths.files, user: OWNER, chats, turnFolder: async () => null, writes: a.writes, now: a.now });
            const stack = (user: string, chat: string, agent: string) => loadGuidance(port, { user, chat, session: "none" }).stackParts(agent);
            a.routes.add("tree", treeRoutes({ files: a.paths.files, chats, db: a.db, suggestions, turning: () => turning, stack }));
          },
        },
      ],
    });
    const folders = await new TreeChats(app.db, app.writes, app.paths.files).place(OWNER, CHAT, NAMES);
    chatFolder = join(app.paths.files, CHATS_FOLDER, folders.character, folders.chat);
    server = await app.start();
    page = bearer(await makeKey(app, "web"));
  });

  afterEach(async () => {
    await bed.remove();
  });

  test("the listing names each file's level, and which file of a name is taken; a shipped file written as the user at the chat's level is the chat's own and is taken there", async () => {
    let files = await listing();
    expect(files.get("@shipped/.agents/gm.md")).toMatchObject({ level: "shipped", kind: "yours", item: "agents/gm", applies: true, replacedBy: null, off: false, editable: false });
    expect(files.get("@shipped/.rules/examples/nudge.md")).toMatchObject({ item: "rules/examples/nudge", applies: false });
    expect(files.get("@shipped/RPE-global.yml")).toMatchObject({ item: null, applies: true, editable: false });

    const written = await call<{ file: TreeFileEntry }>("PUT", "/api/v1/files/@shipped/.agents/gm.md", { level: "chat", chat: CHAT, text: "---\nname: gm\ndescription: This chat's GM.\n---\nMine.\n" });
    expect(written.status).toBe(200);
    expect(written.body.file).toMatchObject({ path: "agents/gm.md", level: "chat", applies: true, editable: true });
    expect(await readFile(join(chatFolder, "agents", "gm.md"), "utf8")).toContain("Mine.");
    files = await listing();
    expect(files.get("@shipped/.agents/gm.md")).toMatchObject({ applies: false, replacedBy: "agents/gm.md" });

    // A layered instruction file is taken at every level that has one; any other replaces the farther one.
    await call("PUT", "/api/v1/files/@shipped/AGENTS.md", { level: "chat", chat: CHAT, text: "This chat's agents.\n" });
    await call("PUT", "/api/v1/files/@shipped/ALL-AGENTS.md", { level: "global", text: "My own for every agent.\n" });
    files = await listing();
    expect([files.get("@shipped/AGENTS.md"), files.get("AGENTS.md")].map((f) => [f?.applies, f?.replacedBy])).toEqual([
      [true, null],
      [true, null],
    ]);
    expect(files.get("@shipped/ALL-AGENTS.md")).toMatchObject({ applies: false, replacedBy: "@global/ALL-AGENTS.md" });

    const read = await call<TreeFileText>("GET", `/api/v1/files/agents/gm.md?chat=${CHAT}`);
    expect(read.body).toMatchObject({ path: "agents/gm.md", level: "chat", kind: "yours", editable: true });
    expect(read.body.text).toContain("Mine.");

    // The user's own file goes; the shipped one is taken again.
    expect((await call<{ removed: string }>("DELETE", `/api/v1/files/agents/gm.md?chat=${CHAT}`)).body).toEqual({ removed: "agents/gm.md" });
    expect((await listing()).get("@shipped/.agents/gm.md")).toMatchObject({ applies: true, replacedBy: null });
  });

  test("a replaced default shows its difference and resets; an update that changes it is reported, and the user's file is untouched", async () => {
    const mine = "---\nname: gm\ndescription: Rules the scene.\n---\nThe shipped GM.\nAnd my own line.\n";
    await call("PUT", "/api/v1/files/@shipped/.agents/gm.md", { level: "global", text: mine });
    const own = join(app.paths.files, ".agents", "gm.md");
    let diff = (await call<TreeFileDiff>("GET", `/api/v1/files-diff/@global/.agents/gm.md?chat=${CHAT}`)).body;
    expect(diff.shipped).toBe("@shipped/.agents/gm.md");
    expect(diff.lines.filter((l) => l.op !== "same")).toEqual([{ op: "added", text: "And my own line." }]);
    expect(diff.update).toBeNull();
    expect((await listing()).get("@global/.agents/gm.md")).toMatchObject({ shipped: "@shipped/.agents/gm.md", defaultChanged: null, applies: true });

    // An update ships a changed GM; the user's file was last written before it.
    const before = new Date(Date.now() - 3_600_000);
    await utimes(own, before, before);
    await writeFile(join(rph, ".agents", "gm.md"), "---\nname: gm\ndescription: Rules the scene.\n---\nThe shipped GM, steadier.\n");
    const changed = await layDefaults(defaults);
    expect(changed.map((c) => c.path)).toEqual([".agents/gm.md"]);
    expect(await readFile(own, "utf8")).toBe(mine);
    const entry = (await listing()).get("@global/.agents/gm.md");
    expect(entry?.defaultChanged).toBeGreaterThan(before.getTime());
    diff = (await call<TreeFileDiff>("GET", `/api/v1/files-diff/@global/.agents/gm.md?chat=${CHAT}`)).body;
    expect(diff.update?.lines.filter((l) => l.op !== "same")).toEqual([
      { op: "removed", text: "The shipped GM." },
      { op: "added", text: "The shipped GM, steadier." },
    ]);
    expect(diff.lines.filter((l) => l.op !== "same")).toEqual([
      { op: "removed", text: "The shipped GM, steadier." },
      { op: "added", text: "The shipped GM." },
      { op: "added", text: "And my own line." },
    ]);
    // Laid out again with nothing changed, nothing more is reported.
    expect(await layDefaults(defaults)).toEqual([]);

    // Reset: the user's file goes, and the shipped one, as updated, is taken.
    expect((await call("DELETE", "/api/v1/files/@global/.agents/gm.md")).status).toBe(200);
    expect((await listing()).get("@shipped/.agents/gm.md")).toMatchObject({ applies: true, replacedBy: null });
    expect((await call<TreeFileText>("GET", "/api/v1/files/@shipped/.agents/gm.md")).body.text).toContain("steadier");
  });

  test("a suggestion writes nothing until it is accepted, then writes the file as the user, edited or as proposed; a dismissed one writes nothing", async () => {
    const scope = { user: OWNER, chat: CHAT, session: "s-1", turn: "t-1" };
    const author = { id: "lead-1", definition: "author" };
    const world = await suggestions.file(scope, author, { target: { file: "WORLD.md" }, text: "# World\nA drowned bell under a grey sea.\n", reason: "The card and the lore say so." });
    const gm = await suggestions.file(scope, author, { target: { file: "@shipped/.agents/gm.md" }, text: "---\nname: gm\ndescription: Rules the scene.\n---\nKeep every roll in the open.\n", reason: "The player asked to see rolls." });
    const tone = await suggestions.file(scope, author, { target: { file: "WRITING.md" }, text: "Short sentences.\n", reason: "The replies run long." });
    expect(await suggestions.file(scope, author, { target: { lore: "entry-9" }, text: "x", reason: "y" })).toBeNull();
    if (world === null || gm === null || tone === null) throw new Error("a suggestion of a file was not kept");

    // Filed: shown, with what it would change, and nothing written.
    const open = (await call<{ suggestions: TreeSuggestionView[] }>("GET", `/api/v1/suggestions?chat=${CHAT}&state=open`)).body.suggestions;
    expect(open.map((s) => [s.id, s.path, s.state])).toEqual([
      [tone, "WRITING.md", "open"],
      [gm, "@shipped/.agents/gm.md", "open"],
      [world, "WORLD.md", "open"],
    ]);
    expect(open.find((s) => s.id === world)?.lines).toEqual([
      { op: "added", text: "# World" },
      { op: "added", text: "A drowned bell under a grey sea." },
    ]);
    expect((await listing()).has("WORLD.md")).toBe(false);

    // Accepted as proposed: the chat's own WORLD.md, the user's file.
    const accepted = await call<{ suggestion: { state: string }; file: TreeFileEntry }>("POST", `/api/v1/suggestions/${world}/accept`, {});
    expect(accepted.body).toMatchObject({ suggestion: { state: "accepted" }, file: { path: "WORLD.md", level: "chat", kind: "yours", applies: true } });
    expect(await readFile(join(chatFolder, "WORLD.md"), "utf8")).toBe("# World\nA drowned bell under a grey sea.\n");
    expect((await call("POST", `/api/v1/suggestions/${world}/accept`, {})).status).toBe(409);

    // A shipped file's suggestion is written, edited, as the user's own at the level they name.
    expect((await call("POST", `/api/v1/suggestions/${gm}/accept`, {})).status).toBe(400);
    const edited = await call<{ file: TreeFileEntry }>("POST", `/api/v1/suggestions/${gm}/accept`, { level: "global", text: "---\nname: gm\ndescription: Rules the scene.\n---\nShow rolls when asked.\n" });
    expect(edited.body.file).toMatchObject({ path: "@global/.agents/gm.md", applies: true });
    expect(await readFile(join(app.paths.files, ".agents", "gm.md"), "utf8")).toContain("Show rolls when asked.");

    // Dismissed: nothing written.
    expect((await call<{ suggestion: { state: string } }>("POST", `/api/v1/suggestions/${tone}/dismiss`)).body.suggestion.state).toBe("dismissed");
    expect((await listing()).has("WRITING.md")).toBe(false);
    expect((await call<{ suggestions: TreeSuggestionView[] }>("GET", `/api/v1/suggestions?chat=${CHAT}&state=open`)).body.suggestions).toEqual([]);
  });

  test("switching a shipped file off writes its name in the level's off: list, RPH's loader finds it off, and switching it on again takes the name out", async () => {
    await writeFile(app.paths.globalConfig, "# My own settings.\noff: [WORLD]\n");
    const switched = await call<{ file: TreeFileEntry }>("PUT", "/api/v1/files-off/@shipped/.rules/consent.md", { level: "global", off: true });
    expect(switched.status).toBe(200);
    expect(switched.body.file).toMatchObject({ path: "@shipped/.rules/consent.md", off: true, applies: false });
    const global = await readFile(app.paths.globalConfig, "utf8");
    expect(global.startsWith("# My own settings.\n")).toBe(true);
    expect(offOf(global)).toEqual(["WORLD", "rules/consent"]);

    const port = treeFiles({ files: app.paths.files, user: OWNER, chats: new TreeChats(app.db, app.writes, app.paths.files), turnFolder: async () => null, writes: app.writes, now: () => 0 });
    const consent = (await loadGuidance(port, { user: OWNER, chat: CHAT, session: "none" }).rules()).find((r) => r.name === "consent");
    expect(consent).toMatchObject({ inForce: false, why: "off" });

    // For one chat: the chat's own RPE.yml, made where there was none.
    await call("PUT", "/api/v1/files-off/@shipped/.agents/gm.md", { level: "chat", chat: CHAT, off: true });
    expect(offOf(await readFile(join(chatFolder, "RPE.yml"), "utf8"))).toEqual(["agents/gm"]);
    expect((await listing()).get("@shipped/.agents/gm.md")).toMatchObject({ off: true, applies: false });

    const on = await call<{ file: TreeFileEntry }>("PUT", "/api/v1/files-off/@shipped/.rules/consent.md", { level: "global", off: false });
    expect(on.body.file).toMatchObject({ off: false, applies: true });
    expect(offOf(await readFile(app.paths.globalConfig, "utf8"))).toEqual(["WORLD"]);
    expect((await call("PUT", "/api/v1/files-off/@shipped/RPE-global.yml", { level: "global", off: true })).status).toBe(400);
  });

  test("the listing says which levels' off: lists name a file: switched on at a level whose list does not name it, it stays off; at the one that does, it is on", async () => {
    await writeFile(app.paths.globalConfig, "off: [agents/gm]\n");
    await writeFile(join(chatFolder, "RPE.yml"), "off:\n  - .agents/gm.md\n");
    const gm = async () => (await listing()).get("@shipped/.agents/gm.md");
    expect(await gm()).toMatchObject({ off: true, offIn: ["global", "chat"] });
    expect((await listing()).get("@shipped/.rules/consent.md")).toMatchObject({ off: false, offIn: [] });

    await call("PUT", "/api/v1/files-off/@shipped/.agents/gm.md", { level: "chat", chat: CHAT, off: false });
    expect(await gm()).toMatchObject({ off: true, offIn: ["global"], applies: false });
    // The chat's list no longer names it: switching it on there again writes nothing, and the listing says why it is still off.
    const again = await call<{ file: TreeFileEntry }>("PUT", "/api/v1/files-off/@shipped/.agents/gm.md", { level: "chat", chat: CHAT, off: false });
    expect(again.body.file).toMatchObject({ off: true, offIn: ["global"] });

    await call("PUT", "/api/v1/files-off/@shipped/.agents/gm.md", { level: "global", off: false });
    expect(await gm()).toMatchObject({ off: false, offIn: [], applies: true });
  });

  test("a page reaches nothing outside the tree, writes no shipped or generated file, and without a page's token gets nothing", async () => {
    await writeFile(join(bed.root, "outside.md"), "Not the tree's.\n");
    await symlink(join(bed.root, "outside.md"), join(chatFolder, "linked.md"));
    await mkdir(join(chatFolder, "sessions", "s1"), { recursive: true });
    await writeFile(join(chatFolder, "sessions", "s1", "s1.jsonl"), "{}\n");

    for (const path of ["/api/v1/files/..%2F..%2Foutside.md", "/api/v1/files/%2E%2E/%2E%2E/outside.md", `/api/v1/files/linked.md?chat=${CHAT}`, "/api/v1/files/@global/defaults/ALL-AGENTS.md", "/api/v1/files/@global/chats", "/api/v1/files/a%5Cb.md"]) {
      const res = await call<{ error?: string }>("GET", path);
      expect({ path, status: res.status >= 400 && res.status < 500 }).toEqual({ path, status: true });
    }
    expect((await call("PUT", "/api/v1/files/@shipped/.agents/gm.md", { level: "shipped", text: "x" })).status).toBe(403);
    expect((await call("PUT", "/api/v1/files/sessions/s1/s1.jsonl", { level: "chat", chat: CHAT, text: "x" })).status).toBe(403);
    expect((await call("DELETE", "/api/v1/files/@shipped/.agents/gm.md")).status).toBe(403);
    expect((await call("PUT", "/api/v1/files/@shipped/.agents/gm.md", { level: "chat", text: "x" })).status).toBe(400);
    expect(await readFile(join(app.paths.files, "defaults", ".agents", "gm.md"), "utf8")).toBe(SHIPPED_RPH[".agents/gm.md"] ?? "");
    expect((await call("GET", "/api/v1/files", undefined, {})).status).toBe(401);
    expect((await call("PUT", "/api/v1/files/@global/ALL-AGENTS.md", { level: "global", text: "x" }, {})).status).toBe(401);
  });

  test("pruning on request is refused while one of the chat's turns goes on, and after it the old folders lose their snapshots", async () => {
    await writeFile(join(chatFolder, "RPE.yml"), "retention:\n  turnFolders: 1\n");
    for (const [n, hoursAgo] of [[1, 2], [2, 1]] as const) {
      const folder = join(chatFolder, "sessions", "s-1", "turns", `turn-${n}-abc${n}`);
      await mkdir(join(folder, "output"), { recursive: true });
      for (const f of ["turn.json", "briefing.md", "output/reply.md"]) await writeFile(join(folder, f), `${f}\n`);
      const begun = new Date(Date.now() - hoursAgo * 3_600_000);
      await utimes(join(folder, "turn.json"), begun, begun);
    }
    turning = true;
    expect((await call("POST", "/api/v1/files-prune", { chat: CHAT })).status).toBe(409);
    turning = false;
    expect((await call<{ pruned: { folders: number; files: number } }>("POST", "/api/v1/files-prune", { chat: CHAT })).body.pruned).toMatchObject({ folders: 1, files: 1 });
    expect((await listing()).has("sessions/s-1/turns/turn-1-abc1/briefing.md")).toBe(false);
    expect((await listing()).has("sessions/s-1/turns/turn-2-abc2/briefing.md")).toBe(true);
  });

  test("the Storage page gets what each chat's folder takes by area and the notes agents lean on; the Files page gets an agent's stack with where each part comes from", async () => {
    const scope = { user: OWNER, chat: CHAT, session: "s-1", turn: "t-1" };
    const author = { id: "lead-1", definition: "author" };
    for (const text of ["One.\n", "One, two.\n", "One, two, three.\n"]) expect((await port.write(scope, "persistent-workspace/ledger.md", { op: "write", text }, author)).status).toBe("written");
    expect((await port.write(scope, "persistent-workspace/long.md", { op: "write", text: "x".repeat(5_000) }, author)).status).toBe("written");
    await mkdir(join(chatFolder, "sessions", "s-1", "turns", "turn-1-t1"), { recursive: true });
    await writeFile(join(chatFolder, "sessions", "s-1", "turns", "turn-1-t1", "briefing.md"), "b".repeat(300));
    await writeFile(join(chatFolder, "sessions", "s-1", "s-1.jsonl"), "s".repeat(40));
    await writeFile(join(chatFolder, "WORLD.md"), "w".repeat(20));

    const storage = (await call<TreeStorage>("GET", "/api/v1/storage")).body;
    expect(storage.chats).toHaveLength(1);
    expect(storage.chats[0]).toMatchObject({ chat: CHAT, areas: { notes: 5_000 + "One, two, three.\n".length, turns: 300, sessions: 40, files: 20 } });
    expect(storage.chats[0]?.bytes).toBe(5_000 + 17 + 300 + 40 + 20);
    expect(storage.shipped).toBe(Object.values(SHIPPED_RPH).join("").length + Object.values(SHIPPED_RPE).join("").length);
    expect(storage.database).toBeGreaterThan(0);

    const notes = (await call<NoteFiles>("GET", `/api/v1/storage/notes?chat=${CHAT}&limit=1`)).body;
    expect(notes).toEqual({ largest: [{ path: "persistent-workspace/long.md", bytes: 5_000, writes: 1 }], rewritten: [{ path: "persistent-workspace/ledger.md", bytes: 17, writes: 3 }] });

    await call("PUT", "/api/v1/files/@shipped/.agents/gm.md", { level: "chat", chat: CHAT, text: "---\nname: gm\ndescription: This chat's GM.\nreads: [ALL-AGENTS, WORLD]\n---\nMine.\n" });
    const stack = (await call<{ agent: string; parts: { part: string; path: string; level: string; left?: string }[] }>("GET", `/api/v1/files-stack?chat=${CHAT}&agent=gm`)).body;
    expect(stack.agent).toBe("gm");
    expect(stack.parts.map((p) => [p.part, p.path, p.level])).toContainEqual(["ALL-AGENTS", "@shipped/ALL-AGENTS.md", "shipped"]);
    expect(stack.parts.map((p) => [p.path, p.level])).toContainEqual(["agents/gm.md", "chat"]);
    expect(stack.parts.map((p) => [p.path, p.level])).toContainEqual(["WORLD.md", "chat"]);
  });
});

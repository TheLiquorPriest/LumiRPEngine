// The Files page's routes over a real tree, through RPE's own server (plan §5.2, §5.4, §14): the listing
// says which file of a name is taken and which replaces it; a file written as the user at a level becomes
// the file taken there; a replaced default shows its difference and resets; an update that changes a
// default under the user's own file leaves their file as it is and is reported; switching a name off
// writes the level's `stack.off` list, and RPH's own loader then finds it off; a page reaches nothing outside
// the tree, no shipped file is written or removed, and a call without a page's token is refused. Every
// name and text is invented.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readdir, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { YAML } from "bun";
import type { FileProblem, RuleView } from "rp-harness/contract";
import type { App, RunningServer } from "../../src/app";
import { CHATS_FOLDER, ChatMeasurer, type DefaultsDeps, layDefaults, NO_CHAT, type NoteFiles, TREE_MIGRATIONS, TreeChats, type TreeFileDiff, type TreeFileEntry, type TreeFiles, type TreeFileText, treeFiles, treeRoutes, type TreeStorage, type SuggestionFiled, type TreeSuggestionView, TreeSuggestions } from "../../src/tree/index";
import { answeredProblems } from "../app/call";
import { bearer, type Bed, makeBed, makeKey, OWNER } from "../app/helpers";

const CHAT = "chat-bell";
const NAMES = { character: { id: "char-wren", name: "Wren Alder" }, chat: { name: "The Drowned Bell" } };
const GHOST = { character: { id: "char-heron", name: "Ghost Heron" }, chat: { name: "The Quiet Lamp" } };

const SHIPPED_RPH: Record<string, string> = {
  "RPE-global.yml": "stack:\n  layered: [AGENTS]\n  off: []\n",
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

/** A config's `stack.off` list as it reads back. */
function offOf(text: string): unknown {
  const doc: unknown = YAML.parse(text);
  const stack = typeof doc === "object" && doc !== null && "stack" in doc ? doc.stack : undefined;
  return typeof stack === "object" && stack !== null && "off" in stack ? stack.off : undefined;
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
  /** The chat's open session, if one is, and the chats whose opening block "Apply now" started afresh. */
  let open: string | null = null;
  const applied: string[] = [];
  /** What the routes told as written, in order. */
  const told: { user: string; chat: string | null; path: string; level: string }[] = [];
  /** Measures the chats' folders as the Storage page asks. */
  let measurer: ChatMeasurer;
  /** The file port agents write through. */
  let port: TreeFiles;
  /** The rules RPH lists for the chat, as the Rules page's switch finds one by its name. */
  let ruled: RuleView[] = [];
  /** What RPH finds wrong in the files, as the listing and a write's answer say it. */
  let flagged: FileProblem[] = [];

  const call = async <T>(method: string, path: string, body?: unknown, headers: Record<string, string> = page): Promise<{ status: number; body: T }> => {
    const res = await fetch(`${server.url}${path}`, { method, headers: { ...headers, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const answered = { status: res.status, body: (await res.json()) as T };
    // A reply is held to its route's declaration at run time, as RPE sends it.
    if (res.status === 200) expect({ method, path, problems: answeredProblems(app, method, path, answered.body) }).toEqual({ method, path, problems: [] });
    return answered;
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
          tables: [{ area: "files", migrations: TREE_MIGRATIONS }],
          async mount(a) {
            defaults = { files: a.paths.files, scratch: a.paths.root, sources, writes: a.writes, user: OWNER, now: () => Date.now() };
            await layDefaults(defaults);
            suggestions = new TreeSuggestions({ db: a.db, writes: a.writes, now: a.now });
            const chats = new TreeChats(a.db, a.writes, a.paths.files);
            port = treeFiles({ files: a.paths.files, user: OWNER, chats, turnFolder: async () => null, writes: a.writes, now: a.now });
            // The agent's stack is the harness's own `definitions.stack`, which this bed has none of.
            const stack = async () => [];
            const apply = async (_user: string, chat: string) => {
              if (open === null) return { session: null };
              applied.push(chat);
              return { session: open };
            };
            // A chat RPE has not played yet is placed by the names Lumiverse would give.
            const place = (user: string, chat: string) => chats.place(user, chat, GHOST);
            measurer = new ChatMeasurer({ files: a.paths.files, chats, now: a.now });
            a.routes.add("tree", treeRoutes({ files: a.paths.files, chats, db: a.db, writes: a.writes, now: a.now, backups: a.paths.backups, copiesKept: 3, measurer, suggestions, turning: () => turning, stack, preview: async () => ({ part: { fields: [], missing: [], problems: [] }, values: null }), apply, place, openSessions: async () => (open === null ? [] : [open]), guidance: () => ({ rules: async () => ruled, definitions: async () => [], stack: async () => [], external: async () => [], problems: async () => flagged }), written: (saved) => void told.push(saved) }));
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

  test("after two updates change a default he replaced its difference shows both, one an update took away is named, and Delete on a shipped file switches it off", async () => {
    const head = "---\nname: gm\ndescription: Rules the scene.\n---\n";
    const mine = `${head}The shipped GM.\nAnd my own line.\n`;
    await call("PUT", "/api/v1/files/@shipped/.agents/gm.md", { level: "global", text: mine });
    await call("PUT", "/api/v1/files/@shipped/.rules/consent.md", { level: "global", text: "---\ndescription: Mine.\nagents: all\n---\nAsk twice.\n" });
    // His file copied without its file time keeps its standing: what says it came after the updates is RPE's record.
    const own = join(app.paths.files, ".agents", "gm.md");
    const long = new Date(Date.now() - 3_600_000);
    await utimes(own, long, long);
    await writeFile(join(rph, ".agents", "gm.md"), `${head}The shipped GM, steadier.\n`);
    await layDefaults(defaults);
    await writeFile(join(rph, ".agents", "gm.md"), `${head}The shipped GM, steadier and kinder.\n`);
    await rm(join(rph, ".rules", "consent.md"));
    await layDefaults(defaults);
    expect(await readFile(own, "utf8")).toBe(mine);
    const diff = (await call<TreeFileDiff>("GET", `/api/v1/files-diff/@global/.agents/gm.md?chat=${CHAT}`)).body;
    expect(diff.updates?.map((u) => u.lines.filter((l) => l.op !== "same").map((l) => `${l.op}: ${l.text}`))).toEqual([
      ["removed: The shipped GM.", "added: The shipped GM, steadier."],
      ["removed: The shipped GM, steadier.", "added: The shipped GM, steadier and kinder."],
    ]);
    expect(diff.update?.lines.filter((l) => l.op !== "same").map((l) => `${l.op}: ${l.text}`)).toEqual(["removed: The shipped GM.", "added: The shipped GM, steadier and kinder."]);
    const files = await listing();
    expect(files.get("@global/.agents/gm.md")?.defaultChanged).toBeGreaterThan(0);
    expect(files.get("@global/.rules/consent.md")).toMatchObject({ shipped: null });
    expect(files.get("@global/.rules/consent.md")?.defaultRemoved).toBeGreaterThan(0);
    expect(await readFile(join(app.paths.files, ".rules", "consent.md"), "utf8")).toContain("Ask twice.");
    // Writing his file again starts from the default as it then stands.
    await call("PUT", "/api/v1/files/@global/.agents/gm.md", { level: "global", text: mine });
    expect((await listing()).get("@global/.agents/gm.md")?.defaultChanged).toBeNull();
    expect((await call<TreeFileDiff>("GET", `/api/v1/files-diff/@global/.agents/gm.md?chat=${CHAT}`)).body.update).toBeNull();

    // Delete on a shipped file writes its name in the off: list of the level it is deleted at, and the file stays.
    await call("DELETE", "/api/v1/files/@global/.agents/gm.md");
    const deleted = await call<{ removed: string; switchedOff: string }>("DELETE", `/api/v1/files/@shipped/.agents/gm.md?chat=${CHAT}`);
    expect(deleted.body).toEqual({ removed: "@shipped/.agents/gm.md", switchedOff: "chat" });
    expect(offOf(await readFile(join(chatFolder, "RPE.yml"), "utf8"))).toEqual(["agents/gm"]);
    expect((await listing()).get("@shipped/.agents/gm.md")).toMatchObject({ off: true, applies: false });
    const global = await call<{ removed: string; switchedOff: string }>("DELETE", "/api/v1/files/@shipped/.rules/examples/nudge.md");
    expect(global.body.switchedOff).toBe("global");
    expect(offOf(await readFile(app.paths.globalConfig, "utf8"))).toContain("rules/examples/nudge");
  });

  test("a suggestion writes nothing until it is accepted, then writes the file as the user, edited or as proposed; a dismissed one writes nothing", async () => {
    const scope = { user: OWNER, chat: CHAT, session: "s-1", turn: "t-1" };
    const author = { id: "lead-1", definition: "author" };
    const kept = async (filed: Promise<SuggestionFiled | null>): Promise<number | null> => {
      const f = await filed;
      return f !== null && f.kept ? f.id : null;
    };
    const world = await kept(suggestions.file(scope, author, { target: { file: "WORLD.md" }, text: "# World\nA drowned bell under a grey sea.\n", reason: "The card and the lore say so." }));
    const gm = await kept(suggestions.file(scope, author, { target: { file: "@shipped/.agents/gm.md" }, text: "---\nname: gm\ndescription: Rules the scene.\n---\nKeep every roll in the open.\n", reason: "The player asked to see rolls." }));
    const tone = await kept(suggestions.file(scope, author, { target: { file: "WRITING.md" }, text: "Short sentences.\n", reason: "The replies run long." }));
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
    expect(open.find((s) => s.id === gm)).toMatchObject({ level: "chat", levels: ["global", "character", "chat"] });
    expect(open.find((s) => s.id === world)).toMatchObject({ level: "chat" });
    const edited = await call<{ file: TreeFileEntry }>("POST", `/api/v1/suggestions/${gm}/accept`, { level: "global", text: "---\nname: gm\ndescription: Rules the scene.\n---\nShow rolls when asked.\n" });
    expect(edited.body.file).toMatchObject({ path: "@global/.agents/gm.md", applies: true });
    expect(await readFile(join(app.paths.files, ".agents", "gm.md"), "utf8")).toContain("Show rolls when asked.");

    // Dismissed: nothing written.
    expect((await call<{ suggestion: { state: string } }>("POST", `/api/v1/suggestions/${tone}/dismiss`)).body.suggestion.state).toBe("dismissed");
    expect((await listing()).has("WRITING.md")).toBe(false);
    expect((await call<{ suggestions: TreeSuggestionView[] }>("GET", `/api/v1/suggestions?chat=${CHAT}&state=open`)).body.suggestions).toEqual([]);
  });

  test("switching a shipped file off writes its name in the level's stack.off list, RPH's loader finds it off, and switching it on again takes the name out", async () => {
    await writeFile(app.paths.globalConfig, "# My own settings.\nstack:\n  off: [WORLD]\n");
    const switched = await call<{ file: TreeFileEntry }>("PUT", "/api/v1/files-off/@shipped/.rules/consent.md", { level: "global", off: true });
    expect(switched.status).toBe(200);
    expect(switched.body.file).toMatchObject({ path: "@shipped/.rules/consent.md", off: true, applies: false });
    const global = await readFile(app.paths.globalConfig, "utf8");
    expect(global.startsWith("# My own settings.\n")).toBe(true);
    expect(offOf(global)).toEqual(["WORLD", "rules/consent"]);

    // For one chat: the chat's own RPE.yml, made where there was none.
    await call("PUT", "/api/v1/files-off/@shipped/.agents/gm.md", { level: "chat", chat: CHAT, off: true });
    expect(offOf(await readFile(join(chatFolder, "RPE.yml"), "utf8"))).toEqual(["agents/gm"]);
    expect((await listing()).get("@shipped/.agents/gm.md")).toMatchObject({ off: true, applies: false });

    const on = await call<{ file: TreeFileEntry }>("PUT", "/api/v1/files-off/@shipped/.rules/consent.md", { level: "global", off: false });
    expect(on.body.file).toMatchObject({ off: false, applies: true });
    expect(offOf(await readFile(app.paths.globalConfig, "utf8"))).toEqual(["WORLD"]);
    expect((await call("PUT", "/api/v1/files-off/@shipped/RPE-global.yml", { level: "global", off: true })).status).toBe(400);
  });

  test("the listing says which levels' stack.off lists name a file: switched on at a level whose list does not name it, it stays off; at the one that does, it is on", async () => {
    await writeFile(app.paths.globalConfig, "stack:\n  off: [agents/gm]\n");
    await writeFile(join(chatFolder, "RPE.yml"), "stack:\n  off:\n    - .agents/gm.md\n");
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

  test("a write answers the file as the listing will show it: held out and with what RPH found wrong, in its words", async () => {
    flagged = [{ path: "rules/blank.md", message: "A rule starts with a header between two `---` lines." }];
    const written = await call<{ file: TreeFileEntry }>("PUT", "/api/v1/files/rules/blank.md", { level: "chat", chat: CHAT, text: "" });
    expect(written.body.file).toMatchObject({ path: "rules/blank.md", item: "rules/blank", applies: false, held: "broken", problems: ["A rule starts with a header between two `---` lines."] });
    flagged = [];
    expect((await call<{ file: TreeFileEntry }>("PUT", "/api/v1/files/rules/blank.md", { level: "chat", chat: CHAT, text: "---\ndescription: Be kind.\nagents: all\n---\nBe kind.\n" })).body.file).toMatchObject({ applies: true, held: null, problems: [] });
  });

  test("the Rules page's switch writes the one list the Files page writes, and a config holding that list under two forms of its key reads as both and is written back as one", async () => {
    ruled = [{ name: "consent", path: "@shipped/.rules/consent.md", level: "shipped", description: "Asks before a hard turn.", agents: "all", inForce: true, replaces: [] }];
    const config = join(chatFolder, "RPE.yml");
    await call("PUT", "/api/v1/files-off/@shipped/.agents/gm.md", { level: "chat", chat: CHAT, off: true });
    expect((await call("POST", "/api/v1/rules/consent/switch", { on: false, level: "chat", chat: CHAT })).status).toBe(200);
    const once = await readFile(config, "utf8");
    expect(offOf(once)).toEqual(["agents/gm", "rules/consent"]);
    expect(once.match(/off"?:/g)).toHaveLength(1);
    expect((await listing()).get("@shipped/.rules/consent.md")).toMatchObject({ off: true, offIn: ["chat"] });

    // The same list under both forms of its key, as a second writer left it: the listing reads both, and a switch writes one list.
    await writeFile(config, '# mine\nstack:\n  off: [rules/consent]\n  "off": [agents/gm]\n');
    expect((await listing()).get("@shipped/.rules/consent.md")).toMatchObject({ off: true, offIn: ["chat"] });
    expect((await listing()).get("@shipped/.agents/gm.md")).toMatchObject({ off: true, offIn: ["chat"] });
    ruled = [...ruled, { name: "perceptions", path: "@shipped/.rules/perceptions.md", level: "shipped", description: "Asks for perceptions.", agents: "all", inForce: true, replaces: [] }];
    expect((await call("POST", "/api/v1/rules/perceptions/switch", { on: false, level: "chat", chat: CHAT })).status).toBe(200);
    const joined = await readFile(config, "utf8");
    expect(joined.startsWith("# mine\n")).toBe(true);
    expect(joined.match(/off"?:/g)).toHaveLength(1);
    expect(offOf(joined)).toEqual(["rules/consent", "agents/gm", "rules/perceptions"]);
    expect((await call("PUT", "/api/v1/files-off/@shipped/.agents/gm.md", { level: "chat", chat: CHAT, off: false })).status).toBe(200);
    expect(offOf(await readFile(config, "utf8"))).toEqual(["rules/consent", "rules/perceptions"]);

    // A rule's example is never switched.
    ruled = [{ name: "nudge", path: "@shipped/.rules/examples/nudge.md", level: "shipped", description: "An example.", agents: "all", inForce: false, why: "example", replaces: [] }];
    expect((await call("POST", "/api/v1/rules/nudge/switch", { on: false, level: "chat", chat: CHAT })).status).toBe(409);
    expect((await call("POST", "/api/v1/rules/nowhere/switch", { on: false, level: "chat", chat: CHAT })).status).toBe(404);
  });

  test.skip("hardening: pinning a file for an agent writes it in the level's stack.pins with his words kept, unpinning takes it out, a file the view does not hold is refused, and a pin of a file that is gone or an agent no definition names is listed, not dropped", async () => {
    await writeFile(join(chatFolder, "WORLD.md"), "# World\n");
    await writeFile(join(chatFolder, "RPE.yml"), "# his own words\nstack:\n  off: []\n");
    const pinned = await call<{ file: TreeFileEntry }>("PUT", "/api/v1/files-pin/WORLD.md", { level: "chat", chat: CHAT, agent: "gm", pinned: true });
    expect(pinned.body.file).toMatchObject({ path: "WORLD.md", pinnedFor: [{ agent: "gm", level: "chat" }] });
    expect(await readFile(join(chatFolder, "RPE.yml"), "utf8")).toContain("# his own words");
    const again = await call<{ file: TreeFileEntry }>("PUT", "/api/v1/files-pin/WORLD.md", { level: "chat", chat: CHAT, agent: "gm", pinned: true });
    expect(again.body.file?.pinnedFor).toEqual([{ agent: "gm", level: "chat" }]);
    await call("PUT", "/api/v1/files-pin/WORLD.md", { level: "global", chat: CHAT, agent: "ghost", pinned: true });
    expect(await readFile(app.paths.globalConfig, "utf8")).toContain("ghost");
    expect((await listing()).get("WORLD.md")?.pinnedFor).toEqual([
      { agent: "ghost", level: "global" },
      { agent: "gm", level: "chat" },
    ]);
    expect((await call("PUT", "/api/v1/files-pin/NOPE.md", { level: "chat", chat: CHAT, agent: "gm", pinned: true })).status).toBeGreaterThanOrEqual(400);

    await rm(join(chatFolder, "WORLD.md"));
    const pins = (await call<{ pins: { file: string; agent: string; level: string; fileFound: boolean; agentNamed: boolean | null }[] }>("GET", `/api/v1/files-pins?chat=${CHAT}`)).body.pins;
    expect(pins).toEqual([
      { file: "WORLD.md", agent: "ghost", level: "global", fileFound: false, agentNamed: false },
      { file: "WORLD.md", agent: "gm", level: "chat", fileFound: false, agentNamed: true },
    ]);
    // A pin of a file that is gone is taken away all the same.
    await call("PUT", "/api/v1/files-pin/WORLD.md", { level: "chat", chat: CHAT, agent: "gm", pinned: false });
    await call("PUT", "/api/v1/files-pin/WORLD.md", { level: "global", chat: CHAT, agent: "ghost", pinned: false });
    expect((await call<{ pins: unknown[] }>("GET", `/api/v1/files-pins?chat=${CHAT}`)).body.pins).toEqual([]);
  });

  test("an agent's stack read ends with what it is handed at the start of a run: each file pinned for it, in the order the levels give them, with its text and the level that pins it, and a pin of a file that is gone says nothing is handed", async () => {
    await writeFile(join(chatFolder, "WORLD.md"), "# World\nA drowned bell.\n");
    await call("PUT", "/api/v1/files-pin/WORLD.md", { level: "chat", chat: CHAT, agent: "gm", pinned: true });
    await call("PUT", "/api/v1/files-pin/@shipped/ALL-AGENTS.md", { level: "global", agent: "gm", pinned: true });
    await call("PUT", "/api/v1/files-pin/WORLD.md", { level: "chat", chat: CHAT, agent: "author", pinned: true });
    const stack = async (agent: string) => (await call<{ handed: { from: string; ref: string; pinnedAt?: string; path?: string; level?: string; text?: string; problem?: string }[] }>("GET", `/api/v1/files-stack?agent=${agent}&chat=${CHAT}`)).body.handed;
    expect(await stack("gm")).toEqual([
      { from: "pin", ref: "@shipped/ALL-AGENTS.md", pinnedAt: "global", path: "@shipped/ALL-AGENTS.md", level: "shipped", text: "Every agent reads this.\n" },
      { from: "pin", ref: "WORLD.md", pinnedAt: "chat", path: "WORLD.md", level: "chat", text: "# World\nA drowned bell.\n" },
    ]);
    expect((await stack("author")).map((h) => h.ref)).toEqual(["WORLD.md"]);
    expect(await stack("nobody")).toEqual([]);
    await rm(join(chatFolder, "WORLD.md"));
    expect((await stack("gm")).at(-1)).toMatchObject({ from: "pin", ref: "WORLD.md", problem: expect.stringContaining("nothing is handed") });
  });

  test("a save, a delete, a move, a switch-off and a pin each call the written hook once with the chat, the path and the level, and a refused write calls nothing", async () => {
    told.length = 0;
    await call("PUT", "/api/v1/files/WORLD.md", { level: "chat", chat: CHAT, text: "# World\n" });
    expect(told).toEqual([{ user: OWNER, chat: CHAT, path: "WORLD.md", level: "chat" }]);
    await call("POST", "/api/v1/files-move", { chat: CHAT, from: "WORLD.md", to: "SIMULATION.md" });
    await call("PUT", "/api/v1/files-off/@shipped/.rules/consent.md", { level: "chat", chat: CHAT, off: true });
    await call("PUT", "/api/v1/files-pin/SIMULATION.md", { level: "chat", chat: CHAT, agent: "gm", pinned: true });
    await call("DELETE", `/api/v1/files/SIMULATION.md?chat=${CHAT}`);
    expect(told.map((t) => [t.path, t.level])).toEqual([
      ["WORLD.md", "chat"],
      ["SIMULATION.md", "chat"],
      ["@shipped/.rules/consent.md", "chat"],
      ["SIMULATION.md", "chat"],
      ["SIMULATION.md", "chat"],
    ]);
    told.length = 0;
    expect((await call("PUT", "/api/v1/files/@shipped/.agents/gm.md", { level: "shipped", text: "x" })).status).toBeGreaterThanOrEqual(400);
    expect((await call("PUT", "/api/v1/files-pin/NOPE.md", { level: "chat", chat: CHAT, agent: "gm", pinned: true })).status).toBeGreaterThanOrEqual(400);
    expect(told).toEqual([]);
  });

  test.skip("hardening: an agent's stack is read with or without a chat, Apply now renews the open session's block and says so, and with none open says the next one opens as the files stand", async () => {
    const withChat = await call<{ agent: string; parts: { kind: string; path: string; text?: string }[] }>("GET", `/api/v1/files-stack?agent=gm&chat=${CHAT}`);
    expect(withChat.body.parts.find((p) => p.kind === "definition")).toMatchObject({ path: "@shipped/.agents/gm.md" });
    await call("PUT", "/api/v1/files/@shipped/.agents/gm.md", { level: "chat", chat: CHAT, text: "---\nname: gm\ndescription: This chat's GM.\n---\nMine.\n" });
    expect((await call<{ parts: { kind: string; path: string }[] }>("GET", `/api/v1/files-stack?agent=gm&chat=${CHAT}`)).body.parts.find((p) => p.kind === "definition")).toMatchObject({ path: "agents/gm.md" });
    // With no chat, the stack the shipped and global levels give: no chat's own file is in it.
    const without = await call<{ parts: { kind: string; path: string }[] }>("GET", "/api/v1/files-stack?agent=gm");
    expect(without.status).toBe(200);
    expect(without.body.parts.find((p) => p.kind === "definition")).toMatchObject({ path: "@shipped/.agents/gm.md" });
    expect(without.body.parts.map((p) => p.path)).not.toContain("agents/gm.md");

    expect((await call<{ session: string | null; note: string }>("POST", "/api/v1/files-apply", { chat: CHAT })).body).toMatchObject({ session: null, note: expect.stringContaining("No session") });
    expect(applied).toEqual([]);
    open = "s-1";
    expect((await call<{ session: string | null }>("POST", "/api/v1/files-apply", { chat: CHAT })).body.session).toBe("s-1");
    expect(applied).toEqual([CHAT]);
  });

  test("he makes a folder, renames, moves and copies his own files; a shipped or generated path is refused with why; a file moved into rules/ is a rule, which the answer says", async () => {
    const moved = (from: string, to: string, kind: "move" | "copy" = "move") => call<{ path: string; file: TreeFileEntry | null; guidance: string | null }>("POST", `/api/v1/files-${kind}`, { chat: CHAT, from, to });
    expect((await call<{ path: string }>("POST", "/api/v1/files-folder", { chat: CHAT, path: "skills/harbor" })).body).toEqual({ path: "skills/harbor" });
    expect((await readdir(join(chatFolder, "skills", "harbor"))).length).toBe(0);
    expect((await call("POST", "/api/v1/files-folder", { chat: CHAT, path: "@shipped/.rules/mine" })).status).toBe(403);

    await call("PUT", "/api/v1/files/draft.md", { level: "chat", chat: CHAT, text: "---\ndescription: Be kind.\nagents: all\n---\nBe kind.\n" });
    const rule = await moved("draft.md", "rules/kind.md");
    expect(rule.body).toMatchObject({ path: "rules/kind.md", guidance: "rules", file: { item: "rules/kind", applies: true } });
    expect((await listing()).has("draft.md")).toBe(false);
    const copy = await moved("rules/kind.md", "@global/.rules/kind.md", "copy");
    expect(copy.body).toMatchObject({ path: "@global/.rules/kind.md", guidance: "rules", file: { level: "global" } });
    expect(await readFile(join(app.paths.files, ".rules", "kind.md"), "utf8")).toContain("Be kind.");
    expect((await moved("rules/kind.md", "@global/.rules/kind.md", "copy")).status).toBe(409);

    // A folder is renamed whole, and goes nowhere inside itself.
    const folder = await moved("skills/harbor", "skills/dock");
    expect(folder.body).toMatchObject({ path: "skills/dock", file: null, guidance: "skills" });
    expect((await moved("skills/dock", "skills/dock/in")).status).toBe(409);

    // Nothing shipped or generated is touched, or taken as a place.
    await mkdir(join(chatFolder, "sessions", "s1"), { recursive: true });
    await writeFile(join(chatFolder, "sessions", "s1", "s1.jsonl"), "{}\n");
    for (const [from, to] of [["@shipped/.agents/gm.md", "agents/gm.md"], ["sessions/s1/s1.jsonl", "notes.md"], ["rules/kind.md", "@shipped/.rules/kind.md"], ["rules/kind.md", "sessions/s1/kind.md"]] as const) {
      expect({ from, to, status: (await moved(from, to)).status }).toEqual({ from, to, status: 403 });
    }
    expect((await moved("rules/none.md", "rules/other.md")).status).toBe(404);
  });

  test("a folder of his is deleted when it is empty; one that holds anything is refused in words that say what it holds, until contents asks for it to go with all it holds; a shipped or generated folder is refused", async () => {
    await mkdir(join(chatFolder, "skills", "empty"), { recursive: true });
    expect((await call("DELETE", `/api/v1/files/skills/empty?chat=${CHAT}`)).status).toBe(200);
    await expect(readdir(join(chatFolder, "skills", "empty"))).rejects.toThrow();
    await mkdir(join(chatFolder, "skills", "walk", "assets"), { recursive: true });
    await writeFile(join(chatFolder, "skills", "walk", "SKILL.md"), "---\nname: walk\ndescription: Walks.\n---\nWalk.\n");
    await writeFile(join(chatFolder, "skills", "walk", "assets", "a.txt"), "a\n");
    const asked = await call<{ error: string }>("DELETE", `/api/v1/files/skills/walk?chat=${CHAT}`);
    expect(asked.status).toBe(409);
    expect(asked.body.error).toBe("skills/walk holds 2 files and 1 folder, which would be deleted with it: nothing was deleted.");
    expect((await readdir(join(chatFolder, "skills", "walk"))).sort()).toEqual(["SKILL.md", "assets"]);
    expect((await call<{ removed: string }>("DELETE", `/api/v1/files/skills/walk?chat=${CHAT}&contents=true`)).body).toEqual({ removed: "skills/walk" });
    await expect(readdir(join(chatFolder, "skills", "walk"))).rejects.toThrow();
    await mkdir(join(chatFolder, "sessions", "s2"), { recursive: true });
    expect((await call("DELETE", `/api/v1/files/sessions/s2?chat=${CHAT}&contents=true`)).status).toBe(403);
    expect((await call("DELETE", "/api/v1/files/@shipped/.rules/examples?contents=true")).status).toBe(403);
    expect((await call("DELETE", `/api/v1/files/skills/nowhere?chat=${CHAT}`)).status).toBe(404);
  });

  test("a shipped file or folder is only read by a copy, so its copy is the user's own at the level asked for; a copy into the shipped level is refused, and so is a move of a shipped file", async () => {
    const copy = await call<{ path: string; guidance: string | null }>("POST", "/api/v1/files-copy", { chat: CHAT, from: "@shipped/.rules/examples/nudge.md", to: "@global/.rules/nudge.md" });
    expect(copy.body).toMatchObject({ path: "@global/.rules/nudge.md", guidance: "rules" });
    expect(await readFile(join(app.paths.files, ".rules", "nudge.md"), "utf8")).toContain("A nudge.");
    expect((await call("POST", "/api/v1/files-copy", { chat: CHAT, from: "@shipped/WORLD.md", to: "WORLD.md" })).status).toBe(200);
    expect(await readFile(join(chatFolder, "WORLD.md"), "utf8")).toBe("# World\n");
    expect((await call("POST", "/api/v1/files-copy", { chat: CHAT, from: "@global/.rules/nudge.md", to: "@shipped/.rules/nudge.md" })).status).toBe(403);
    expect((await call("POST", "/api/v1/files-move", { chat: CHAT, from: "@shipped/.rules/examples/nudge.md", to: "rules/nudge.md" })).status).toBe(403);
  });

  test("a chat RPE has not played yet has its levels on the Files page: listing it places its folders, and writing its WORLD.md leaves the chat's file for its first turn", async () => {
    const ghost = "chat-lamp";
    expect(await app.db.query("SELECT 1 FROM tree_chat WHERE chat = ?").get(ghost)).toBeNull();
    const listed = await call<{ files: TreeFileEntry[] }>("GET", `/api/v1/files?chat=${ghost}`);
    expect(listed.status).toBe(200);
    const folders = new TreeChats(app.db, app.writes, app.paths.files).folders(OWNER, ghost);
    expect(folders).not.toBeNull();
    const lamp = join(app.paths.files, CHATS_FOLDER, folders?.character ?? "", folders?.chat ?? "");
    expect((await readdir(lamp)).sort()).toContain("rules");
    const written = await call<{ file: TreeFileEntry }>("PUT", "/api/v1/files/WORLD.md", { level: "chat", chat: ghost, text: "# A quiet lamp\n" });
    expect(written.body.file).toMatchObject({ path: "WORLD.md", level: "chat" });
    expect(await readFile(join(lamp, "WORLD.md"), "utf8")).toBe("# A quiet lamp\n");
    // Its window setting, written before it is played, is its own RPE.yml.
    await call("PUT", "/api/v1/files/RPE.yml", { level: "chat", chat: ghost, text: "retention:\n  turnFolders: 7\n" });
    expect(await readFile(join(lamp, "RPE.yml"), "utf8")).toContain("turnFolders: 7");
  });

  test.skip("hardening: the listing reads a folder a page at a time and finds files by name and by text across the levels; each rule stands as RPH finds it; a long file is read a range at a time", async () => {
    type Page = { folder: string; items: { name: string; path: string; folder: boolean; level: string; entry: TreeFileEntry | null }[]; next: string | null; levels: string[]; stopped: string | null };
    const list = (query: string) => call<Page>("GET", `/api/v1/files-list?chat=${CHAT}${query}`);
    const top = (await list("")).body;
    expect(top.items.slice(0, 3).map((i) => i.path)).toEqual(["@character", "@global", "@shipped"]);
    expect(top.levels).toEqual(["shipped", "global", "character", "chat"]);
    const first = (await list("&limit=2")).body;
    const second = (await list(`&limit=2&after=${encodeURIComponent(first.next ?? "")}`)).body;
    expect([...first.items, ...second.items].map((i) => i.path)).toEqual(top.items.slice(0, 4).map((i) => i.path));
    expect((await list("&folder=@shipped/.rules")).body.items.map((i) => i.path)).toEqual(["@shipped/.rules/examples", "@shipped/.rules/consent.md"]);
    expect((await list("&folder=@shipped/.rules/consent.md")).status).toBe(404);

    // A search finds by name and by text, in any level.
    expect((await list("&search=nudge")).body.items.map((i) => i.path)).toEqual(["@shipped/.rules/examples/nudge.md"]);
    expect((await list("&search=ask%20first")).body.items.map((i) => i.path)).toEqual(["@shipped/.rules/consent.md"]);

    // A rule whose needs: names what is not in force, and one whose header does not parse, are held out, and RPH's own words are given.
    await writeFile(join(chatFolder, "rules", "needy.md"), "---\ndescription: Needs a ghost.\nagents: all\nneeds: ghost-file\n---\nBoo.\n");
    await writeFile(join(chatFolder, "rules", "broken.md"), "---\nagents: [\n---\nx\n");
    const rules = new Map((await list("&folder=rules")).body.items.map((i) => [i.path, i.entry]));
    expect(rules.get("rules/needy.md")).toMatchObject({ applies: false, held: "needs" });
    expect(rules.get("rules/broken.md")).toMatchObject({ applies: false, held: "broken" });
    expect(rules.get("rules/broken.md")?.problems?.length).toBeGreaterThan(0);
    expect((await list("&folder=@shipped/.rules")).body.items.find((i) => i.path === "@shipped/.rules/consent.md")?.entry).toMatchObject({ applies: true, held: null, placeable: ["global", "character", "chat"], isConfig: false });
    await writeFile(join(chatFolder, "PROMPT-MAP.md"), "# The map\n");
    expect((await list("")).body.items.find((i) => i.path === "PROMPT-MAP.md")?.entry).toMatchObject({ kind: "generated", editable: false, editedOn: "Prompt" });

    // A session file of 20,000 lines is read a range at a time, never sent whole.
    await mkdir(join(chatFolder, "sessions", "s1"), { recursive: true });
    await writeFile(join(chatFolder, "sessions", "s1", "big.jsonl"), Array.from({ length: 20_000 }, (_, i) => `{"n":${i + 1}}`).join("\n") + "\n");
    const part = await call<TreeFileText>("GET", `/api/v1/files/sessions/s1/big.jsonl?chat=${CHAT}&line=100&lines=3`);
    expect(part.body).toMatchObject({ text: '{"n":100}\n{"n":101}\n{"n":102}\n', lines: 20_000, from: 100, to: 102, more: true, editable: false });
    const whole = await call<TreeFileText>("GET", `/api/v1/files/sessions/s1/big.jsonl?chat=${CHAT}`);
    expect(whole.body).toMatchObject({ from: 1, to: 500, lines: 20_000, more: true });
    expect(whole.body.text.split("\n").length).toBe(501);
    const bytes = await call<TreeFileText>("GET", `/api/v1/files/sessions/s1/big.jsonl?chat=${CHAT}&offset=0&length=9`);
    expect(bytes.body).toMatchObject({ text: '{"n":1}\n{', to: 9 });
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
    expect((await call("DELETE", `/api/v1/files/sessions/s1/s1.jsonl?chat=${CHAT}`)).status).toBe(403);
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

  test("the Storage page lists each kind with its count, size and how long it is kept, and a prune says first what goes, then takes exactly that: closed sessions' files, a deleted chat's other files, a backup he names", async () => {
    const kinds = (await call<{ kinds: { kind: string; name: string; count: number; bytes: number; kept: { by: string; setting?: string; value?: number | null } }[]; lastPrune: number | null }>("GET", "/api/v1/storage/kinds")).body;
    expect(kinds.kinds.map((k) => k.kind)).toEqual(["notes", "note-versions", "suggestions", "turn-folders", "turn-folders-pruned", "sessions", "yours", "shipped", "database", "migration-backups", "database-copies", "archives"]);
    expect(kinds.kinds.map((k) => k.name)).toEqual(["Agents' notes", "Versions of notes", "Suggestions", "Turn folders kept whole", "Turn folders pruned to what stays", "Session files", "Your own files", "The shipped level", "The database", "The migration's backups", "Copies of the database taken before a migration", "Archives rpe backup made"]);
    expect(kinds.kinds.find((k) => k.kind === "database-copies")?.kept).toEqual({ by: "setting", setting: "database.copiesKept", value: 3 });
    expect(kinds.kinds.find((k) => k.kind === "shipped")?.count).toBeGreaterThan(3);
    expect(kinds.lastPrune).toBeNull();

    // Closed sessions: asked first; the open one's files stay; the plan taken exactly.
    for (const [id, text] of [["s-1", "open"], ["s-2", "closed"]] as const) {
      await mkdir(join(chatFolder, "sessions", id, "turns", "turn-1-abc1"), { recursive: true });
      await writeFile(join(chatFolder, "sessions", id, `${id}.jsonl`), `${text}\n`);
      await writeFile(join(chatFolder, "sessions", id, "turns", "turn-1-abc1", "turn.json"), "{}\n");
    }
    open = "s-1";
    type Asked = { plan: string; removed: boolean; files: number; bytes: number; items: { kind: string; path: string; files: number }[] };
    const asked = await call<Asked>("POST", "/api/v1/storage-prune", { what: "sessions", chat: CHAT });
    expect(asked.body).toMatchObject({ removed: false, files: 2, items: [{ kind: "session", files: 2 }] });
    expect(asked.body.items[0]?.path.endsWith("sessions/s-2")).toBe(true);
    expect((await call("POST", "/api/v1/storage-prune", { what: "sessions", chat: CHAT, plan: "not-the-plan" })).status).toBe(409);
    turning = true;
    expect((await call("POST", "/api/v1/storage-prune", { what: "sessions", chat: CHAT })).status).toBe(409);
    turning = false;
    expect((await call<Asked>("POST", "/api/v1/storage-prune", { what: "sessions", chat: CHAT, plan: asked.body.plan })).body).toMatchObject({ removed: true, files: 2 });
    expect((await readdir(join(chatFolder, "sessions"))).sort()).toEqual(["s-1"]);
    expect((await call<{ lastPrune: number | null }>("GET", "/api/v1/storage/kinds")).body.lastPrune).toBeGreaterThan(0);

    // A backup goes only when he names it, after the same question.
    await mkdir(app.paths.backups, { recursive: true });
    await writeFile(join(app.paths.backups, "rpe-backup-old.tar"), "an archive\n");
    expect((await call("POST", "/api/v1/storage-prune", { what: "backup", name: "nothing-like-it" })).status).toBe(404);
    const backup = await call<Asked>("POST", "/api/v1/storage-prune", { what: "backup", name: "rpe-backup-old.tar" });
    expect(backup.body).toMatchObject({ removed: false, items: [{ kind: "backup", path: "rpe-backup-old.tar" }] });
    await call("POST", "/api/v1/storage-prune", { what: "backup", name: "rpe-backup-old.tar", plan: backup.body.plan });
    expect(await readdir(app.paths.backups)).not.toContain("rpe-backup-old.tar");

    // A chat Lumiverse deleted: its session files go when RPE hears, its other files stay, listed as a deleted chat's, and go when he prunes them.
    expect((await call("POST", "/api/v1/storage-prune", { what: "chat", chat: CHAT })).status).toBe(409);
    await writeFile(join(chatFolder, "WORLD.md"), "# World\n");
    await new TreeChats(app.db, app.writes, app.paths.files).deleted(OWNER, CHAT, 4_242);
    expect(await readdir(chatFolder)).not.toContain("sessions");
    expect((await call<TreeStorage>("GET", "/api/v1/storage")).body.chats.find((c) => c.chat === CHAT)).toMatchObject({ deleted: 4_242 });
    const gone = await call<Asked>("POST", "/api/v1/storage-prune", { what: "chat", chat: CHAT });
    expect(gone.body.items[0]).toMatchObject({ kind: "chat" });
    await call("POST", "/api/v1/storage-prune", { what: "chat", chat: CHAT, plan: gone.body.plan });
    expect(await readdir(join(chatFolder, ".."))).not.toContain(chatFolder.split("/").at(-1) ?? "");
  });

  test.skip("hardening: the Storage page gets what each chat's folder takes by area and the notes agents lean on; the Files page gets an agent's stack with where each part comes from", async () => {
    const scope = { user: OWNER, chat: CHAT, session: "s-1", turn: "t-1" };
    const author = { id: "lead-1", definition: "author" };
    for (const text of ["One.\n", "One, two.\n", "One, two, three.\n"]) expect((await port.write(scope, "persistent-workspace/ledger.md", { op: "write", text }, author)).status).toBe("written");
    expect((await port.write(scope, "persistent-workspace/long.md", { op: "write", text: "x".repeat(5_000) }, author)).status).toBe("written");
    await mkdir(join(chatFolder, "sessions", "s-1", "turns", "turn-1-t1"), { recursive: true });
    await writeFile(join(chatFolder, "sessions", "s-1", "turns", "turn-1-t1", "briefing.md"), "b".repeat(300));
    await writeFile(join(chatFolder, "sessions", "s-1", "s-1.jsonl"), "s".repeat(40));
    await writeFile(join(chatFolder, "WORLD.md"), "w".repeat(20));

    // Not measured yet: the page answers at once with nothing for the chat, which is measured meanwhile.
    expect((await call<TreeStorage>("GET", "/api/v1/storage")).body.chats[0]).toMatchObject({ chat: CHAT, bytes: 0, measured: null });
    await measurer.idle();
    const storage = (await call<TreeStorage>("GET", "/api/v1/storage")).body;
    expect(storage.chats).toHaveLength(1);
    expect(storage.chats[0]).toMatchObject({ chat: CHAT, areas: { notes: 5_000 + "One, two, three.\n".length, turns: 300, sessions: 40, files: 20 } });
    expect(storage.chats[0]?.bytes).toBe(5_000 + 17 + 300 + 40 + 20);
    expect(storage.shipped).toBe(Object.values(SHIPPED_RPH).join("").length + Object.values(SHIPPED_RPE).join("").length);
    expect(storage.database).toBeGreaterThan(0);
    // The chat's rows and the rest add up to the database.
    expect((storage.chats[0]?.rows ?? 0) + (storage.rest ?? 0)).toBe(storage.database);
    expect(storage.chats[0]?.rows).toBeGreaterThan(0);
    // A file the port writes is in the kept sizes at once, with no walk.
    await port.write(scope, "persistent-workspace/ledger.md", { op: "append", text: "More.\n" }, author);
    expect((await call<TreeStorage>("GET", "/api/v1/storage")).body.chats[0]?.areas.notes).toBe(5_000 + 17 + 6);
    expect((await call<TreeStorage>("GET", "/api/v1/storage?limit=1&after=zzz")).body).toMatchObject({ chats: [], next: null });

    const notes = (await call<NoteFiles>("GET", `/api/v1/storage/notes?chat=${CHAT}&limit=1`)).body;
    expect(notes).toEqual({ largest: [{ path: "persistent-workspace/long.md", bytes: 5_000, writes: 1 }], rewritten: [{ path: "persistent-workspace/ledger.md", bytes: 23, writes: 4 }] });

    await call("PUT", "/api/v1/files/@shipped/.agents/gm.md", { level: "chat", chat: CHAT, text: "---\nname: gm\ndescription: This chat's GM.\nreads: [ALL-AGENTS, WORLD]\n---\nMine.\n" });
    const stack = (await call<{ agent: string; parts: { part: string; path: string; level: string; left?: string }[] }>("GET", `/api/v1/files-stack?chat=${CHAT}&agent=gm`)).body;
    expect(stack.agent).toBe("gm");
    expect(stack.parts.map((p) => [p.part, p.path, p.level])).toContainEqual(["ALL-AGENTS", "@shipped/ALL-AGENTS.md", "shipped"]);
    expect(stack.parts.map((p) => [p.path, p.level])).toContainEqual(["agents/gm.md", "chat"]);
    expect(stack.parts.map((p) => [p.path, p.level])).toContainEqual(["WORLD.md", "chat"]);
  });
});

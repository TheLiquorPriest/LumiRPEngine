// `bun run build`: everything RPE ships, in dist/, each file stamped with one build id. Lumiverse
// installs the extension from git and loads the files built here as they are (dist/ is tracked, and
// Lumiverse builds nothing for an extension whose dist/ is), and a server runs RPE from the same files:
//
// - dist/rpe.js: the application (STANDALONE-PLAN §4.4, §4.6), one file that runs under Bun with
//   nothing installed beside it: RPH and pi are bundled in. What it reads from disk as it runs lies
//   beside it (`BESIDE_APP`): RPE's shipped guidance, RPH's own shipped files and the web app. In a
//   bundle every module's `import.meta.url` is the bundle's own, so each place is stamped into it as
//   a path from there; run from source, the code that finds a place takes the one in the source tree.
// - dist/backend.js and dist/frontend.js: the light extension (§4.3), as spindle.json names them. The
//   backend holds the door's half and nothing of the application (`APPLICATION`), and nothing
//   Lumiverse's install scan refuses (`install-scan.ts`): a backend the host would refuse to load
//   fails the build here, with what was found and where. The frontend is the extension's loader
//   around the UI's extension shell, put together here because neither may import the other
//   (test/standalone-boundaries.test.ts).
// - dist/ui/: the web app RPE serves at /ui/ (§14), the UI's web shell.
// - dist/rpe.files.json: the build's statement of itself (READINGS R-12): the hash of the app file and of
//   every file of the folders it reads beside it. The hash of the statement is stamped into the backend
//   (`process.env.RPE_STATED_HASH`), for the extension to state when it tells RPE a new app file has
//   arrived; RPE takes the file only when every file matches.
// - dist/agent-kit.js and dist/lumirpengine.js: today's command line and MCP server, kept where outside
//   harnesses run them and load the kit from (§4.4).
//
// The UI's two shells are named in one place (`UI_SHELLS`); `--no-pages` builds everything but the
// pages, for when the shells are not there. A build that misses an entry it needs says which and stops.
//
// The build id (DESIGN §23) is the source commit's short SHA, marked when the sources have uncommitted
// changes, a harness linked from its own checkout included (their code isn't the commit's), or the
// time when there is no git to ask. A bundle holds the same code wherever it is built: its inputs are
// listed (Bun's metafile), and the build fails, naming the file, when one lies outside this repository
// (Bun takes a package it doesn't find inside the repository from any node_modules above it, such as
// that of a Lumiverse checkout the repository sits in). The one exception is a harness linked from a
// checkout beside this one, until it is a pinned dependency: of it, a bundle may take its sources, its
// shipped files and the packages it installed for itself (`allowedRoots`).
//
// dist/ is replaced whole, and only once all of it is made: a build that fails leaves dist/ as it was.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import pkg from "../package.json";
import { statedHash, STATEMENT_FILE, statementOf, statementText } from "../src/app/build-statement";
import { installScan } from "./install-scan";
import { writeCallList } from "./ui/calls";
import { writePageList } from "./ui/pages";
import { writeSurfaceList } from "./ui/surfaces";

export const ROOT = resolve(import.meta.dir, "..");
export const DIST = join(ROOT, "dist");
/** Where a build is put together before it takes dist/'s place. */
const STAGE = join(DIST, ".next");

/** The UI's two shells: the one place the build names them. */
const UI_SHELLS = {
  /** Exports `mount`, which the extension's loader puts in Lumiverse's drawer. */
  extension: "src/ui/extension.tsx",
  /** The web shell's page: Bun emits it with the script it loads. */
  web: "src/ui/index.html",
} as const;

/** What a build makes, by name in dist/. spindle.json names the extension's two. */
export const OUT = { app: "rpe.js", backend: "backend.js", frontend: "frontend.js", ui: "ui", kit: "agent-kit.js", core: "lumirpengine.js", statement: STATEMENT_FILE } as const;

const ENTRIES = { app: "src/app/main.ts", backend: "src/ext/backend.ts", loader: "src/ext/loader.ts", kit: "src/cli/agent-kit.ts", core: "src/cli/main.ts" } as const;

/** The frontend's entry, written here and never to disk: the extension's loader around the UI's extension shell. */
const FRONTEND_ENTRY = join(ROOT, "scripts", "frontend-entry.ts");

/**
 * What the application reads from disk as it runs, beside itself in dist/: each stamped into it as a
 * path from the bundle's own URL, for the code that finds it to read as
 * `new URL(process.env.<stamp> ?? <its place from the source file>, import.meta.url)`.
 */
const BESIDE_APP = {
  /** RPE's shipped guidance, the repository's guidance/: the file tree's shipped level. */
  guidance: { stamp: "process.env.RPE_GUIDANCE_DIR", dir: "guidance" },
  /** RPH's own shipped files, the harness's guidance/: the level under RPE's shipped one. */
  harness: { stamp: "process.env.RPH_GUIDANCE_DIR", dir: "guidance-harness" },
  /** The web app, served at /ui/. */
  ui: { stamp: "process.env.RPE_UI_DIR", dir: OUT.ui },
} as const;

/** What a server needs of dist/ to run RPE: the application and what it reads beside itself. */
export const SERVER: readonly string[] = [OUT.app, OUT.statement, ...Object.values(BESIDE_APP).map(({ dir }) => dir)];

/**
 * Optional requires of packages nothing here installs, left in every bundle as a `require` of the
 * name, which fails where nothing beside the bundle provides it. `supports-color`: `debug`, which
 * Google's SDK brings in under pi-ai, asks for it inside a try/catch that swallows its absence, only to
 * pick more colours for its own lines, which print only when the DEBUG variable names them.
 */
const LEFT_OUT: readonly string[] = ["supports-color"];

/** What the extension's backend may not hold, by its path from the repository's root: the server's own areas, any package (pi, the SDKs), and the harness. */
const APPLICATION = /^(?:src\/(?:app|store|turn|tree|iface|cast|story|lore|migrate|ui|cli)\/|node_modules\/|\.\.\/)/;

/** Builds everything but the pages. */
const NO_PAGES = "--no-pages";

class Failure extends Error {}

function fail(words: string): never {
  throw new Failure(words);
}

function git(cwd: string, args: readonly string[]): string | null {
  const run = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
  return run.exitCode === 0 ? run.stdout.toString() : null;
}

/** Whether `dir` is the top of a git checkout of its own. */
function ownCheckout(dir: string): boolean {
  const top = git(dir, ["rev-parse", "--show-toplevel"])?.trim();
  return top !== undefined && realpathSync(top) === realpathSync(dir);
}

/** Where a bundle may take a file from: this repository, and of the harness, where it lies elsewhere, its sources, its shipped files and the packages it installed for itself. */
export function allowedRoots(root: string, harness: string | null): string[] {
  return harness === null ? [root] : [root, ...["src", "guidance", "node_modules"].map((part) => join(harness, part))];
}

/** The inputs, as Bun's metafile names them (from `cwd`), that lie under none of `roots`. */
export function outsideOf(inputs: readonly string[], cwd: string, roots: readonly string[]): string[] {
  return inputs.map((input) => resolve(cwd, input)).filter((path) => !roots.some((root) => path.startsWith(root + sep)));
}

/** The files of `folder` that ship from the package at `root`, each by its path from `folder`: in a checkout, what git would commit (tracked, or new and not ignored, so an editor's or the system's own files stay out); in an installed package, all of it. */
function shippedFiles(root: string, folder: string): string[] {
  if (ownCheckout(root)) {
    const listed = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", folder]);
    if (listed === null) fail(`git can't list ${join(root, folder)}`);
    // Tracked files deleted in the working tree are listed too: what ships is what is there.
    return listed.split("\0").filter((path) => path !== "" && statSync(join(root, path), { throwIfNoEntry: false })?.isFile() === true).map((path) => relative(folder, path));
  }
  return readdirSync(join(root, folder), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => relative(join(root, folder), join(entry.parentPath, entry.name)));
}

/** Copies `folder` of the package at `root` into `into`. */
function copyShipped(root: string, folder: string, into: string): void {
  const files = shippedFiles(root, folder);
  if (files.length === 0) fail(`${join(root, folder)} has nothing to ship`);
  for (const file of files) {
    const to = join(into, file);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(root, folder, file), to);
  }
}

/** Bundles one entry with `config`, and fails when it doesn't build or took a file from outside `roots`; its inputs by their paths from the repository's root, and its outputs. */
async function bundle(what: string, config: Bun.BuildConfig, roots: readonly string[]): Promise<{ inputs: string[]; outputs: string[] }> {
  const result = await Bun.build({ external: [...LEFT_OUT], ...config, metafile: true, throw: false });
  if (!result.success) fail(`${what} did not build:\n${result.logs.map((log) => `  ${String(log)}`).join("\n")}`);
  const inputs = Object.keys(result.metafile?.inputs ?? {});
  if (inputs.length === 0) fail(`Bun lists no inputs for ${what}`);
  const outside = outsideOf(inputs, process.cwd(), roots);
  if (outside.length > 0) fail(`${what} took ${outside.join(", ")} from outside the repository: install it here, or add it to LEFT_OUT if nothing needs it.`);
  return { inputs: inputs.map((input) => relative(ROOT, resolve(process.cwd(), input))), outputs: result.outputs.map((output) => output.path) };
}

/** Bundles `entry` to the one file `out` in the stage. */
async function oneFile(what: string, entry: string, out: string, target: "bun" | "node" | "browser", define: Record<string, string>, roots: readonly string[], more: Partial<Bun.BuildConfig> = {}): Promise<string[]> {
  const { inputs, outputs } = await bundle(what, { entrypoints: [entry], outdir: STAGE, naming: out, target, define, ...more }, roots);
  if (outputs.length !== 1) fail(`${what} came out as ${outputs.length} files where Lumiverse and Bun load one: ${outputs.map((path) => relative(STAGE, path)).join(", ")}`);
  return inputs;
}

function run(command: readonly string[]): { code: number; out: string; err: string } {
  const ran = Bun.spawnSync([...command], { cwd: STAGE, stdout: "pipe", stderr: "pipe" });
  return { code: ran.exitCode, out: ran.stdout.toString().trim(), err: ran.stderr.toString().trim() };
}

function sizeWords(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MiB` : `${(bytes / 1024).toFixed(1)} KiB`;
}

/** Every file under `dir`, with its size. */
function filesUnder(dir: string): { path: string; size: number }[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
    .map((path) => ({ path, size: statSync(path).size }));
}

/** Puts what the stage holds in dist/'s place, leaving nothing of an earlier build. */
function publish(): void {
  for (const name of readdirSync(DIST)) if (join(DIST, name) !== STAGE) rmSync(join(DIST, name), { recursive: true, force: true });
  for (const name of readdirSync(STAGE)) renameSync(join(STAGE, name), join(DIST, name));
  rmSync(STAGE, { recursive: true, force: true });
}

async function main(argv: readonly string[]): Promise<number> {
  try {
    const unknown = argv.filter((arg) => arg !== NO_PAGES);
    if (unknown.length > 0) fail(`the build takes no ${unknown.join(" ")}; it takes ${NO_PAGES} alone, to build everything but the pages.`);
    const pages = !argv.includes(NO_PAGES);
    if (!Bun.semver.satisfies(Bun.version, pkg.engines.bun)) fail(`this is Bun ${Bun.version}, and the build needs Bun ${pkg.engines.bun}: run it with that Bun.`);

    const needed: (readonly [path: string, what: string])[] = [
      [ENTRIES.app, "the application's entry"],
      [ENTRIES.backend, "the extension's backend entry"],
      [ENTRIES.kit, "the agent kit's entry"],
      [ENTRIES.core, "the command line's entry"],
      ...(pages ? ([[ENTRIES.loader, "the extension's loader"], [UI_SHELLS.extension, "the UI's extension shell"], [UI_SHELLS.web, "the UI's web shell"]] as const) : []),
    ];
    const missing = needed.filter(([path]) => !existsSync(join(ROOT, path)));
    if (missing.length > 0) {
      const onlyPages = missing.every(([path]) => path === UI_SHELLS.extension || path === UI_SHELLS.web);
      fail(`${missing.map(([path, what]) => `${what}, ${path},`).join(" and ")} ${missing.length === 1 ? "is" : "are"} not there.${onlyPages ? ` To build everything but the pages: bun run build ${NO_PAGES}` : ""}`);
    }
    const link = join(ROOT, "node_modules", "rp-harness");
    if (!existsSync(link)) fail("rp-harness is not installed in node_modules: the application carries it, and its shipped files go beside the application.");
    const harness = realpathSync(link);

    // Bun's metafile names each input by its path from here.
    process.chdir(ROOT);
    // The shells offer the pages the folders hold, so the list of them is made from the folders first.
    if (pages) {
      writePageList();
      writeCallList();
      writeSurfaceList();
    }
    const seconds = Math.floor(Date.now() / 1000);
    const sha = git(ROOT, ["rev-parse", "--short=8", "HEAD"])?.trim() ?? null;
    const sources = ["src", "guidance", "docs", "schemas", "package.json", "bun.lock", "tsconfig.json", "bunfig.toml", "scripts/build.ts"];
    const harnessSha = ownCheckout(harness) ? (git(harness, ["rev-parse", "--short=8", "HEAD"])?.trim() ?? null) : null;
    const linked = harnessSha === null ? null : { sha: harnessSha, changed: (git(harness, ["status", "--porcelain", "--", "src", "guidance", "package.json", "bun.lock"]) ?? "").trim() !== "" };
    const dirty = sha !== null && ((git(ROOT, ["status", "--porcelain", "--", ...sources]) ?? "").trim() !== "" || linked?.changed === true);
    // A harness that is a checkout of its own beside this one is not named by this repository's commit,
    // so the id names it too: a rebuild after a change to the harness alone is another build, and a
    // running RPE moves onto it. Installed from the lockfile, the commit here names it already.
    const built = sha === null ? null : linked === null ? sha : `${sha}-rph.${linked.sha}`;
    const id = built === null ? String(seconds) : dirty ? `${built}-dirty.${seconds}` : built;
    const stamp = { "process.env.LRE_BUILD_ID": JSON.stringify(id) };
    const roots = allowedRoots(ROOT, harness);

    rmSync(STAGE, { recursive: true, force: true });
    mkdirSync(STAGE, { recursive: true });

    // The application. `ignoreDCEAnnotations`: pi-ai declares its modules free of side effects and
    // loads each provider's API with `import()`; with the annotations honoured, Bun's bundler leaves
    // such a module's start to whoever imports it the plain way, and a function of pi-ai's called
    // before any API was used once found its module's state missing (an agent's session that ended
    // threw). Ignored, every module the bundle imports is started as the bundle starts, as the sources
    // run unbundled, which is what every other test exercises.
    const beside = Object.fromEntries(Object.values(BESIDE_APP).map(({ stamp: name, dir }) => [name, JSON.stringify(`./${dir}/`)]));
    await oneFile("the application", join(ROOT, ENTRIES.app), OUT.app, "bun", { ...stamp, ...beside }, roots, { ignoreDCEAnnotations: true });
    const version = run([process.execPath, join(STAGE, OUT.app), "--version"]);
    if (version.code !== 0 || version.out !== `rpe ${id}`) fail(`${OUT.app} --version said "${version.out}" (exit ${version.code}${version.err === "" ? "" : `, ${version.err}`}), not "rpe ${id}"`);
    copyShipped(ROOT, "guidance", join(STAGE, BESIDE_APP.guidance.dir));
    copyShipped(harness, "guidance", join(STAGE, BESIDE_APP.harness.dir));

    if (pages) {
      const from = (path: string): string => relative(dirname(FRONTEND_ENTRY), join(ROOT, path));
      const entry = [`import { loader } from ${JSON.stringify(from(ENTRIES.loader))};`, `import { mount } from ${JSON.stringify(from(UI_SHELLS.extension))};`, "export const setup = loader(mount);", ""].join("\n");
      // Both UI bundles are minified: the page loads the extension's frontend on every visit to Lumiverse, and the web app on every visit to RPE.
      await oneFile("the extension's frontend", FRONTEND_ENTRY, OUT.frontend, "browser", stamp, roots, { files: { [FRONTEND_ENTRY]: entry }, minify: true });
      const web = await bundle("the web app", { entrypoints: [join(ROOT, UI_SHELLS.web)], outdir: join(STAGE, OUT.ui), target: "browser", define: stamp, minify: true }, roots);
      if (!web.outputs.some((path) => path === join(STAGE, OUT.ui, "index.html"))) fail(`the web app came out without ${OUT.ui}/index.html, which RPE serves at /ui/`);
    }

    // The build's statement of its files, once all of them are staged; its hash goes into the backend.
    const statement = statementText(await statementOf(STAGE, id));
    writeFileSync(join(STAGE, OUT.statement), statement);
    const stated = { ...stamp, "process.env.RPE_STATED_HASH": JSON.stringify(statedHash(statement)) };

    const backendInputs = await oneFile("the extension's backend", join(ROOT, ENTRIES.backend), OUT.backend, "bun", stated, roots);
    const held = backendInputs.filter((input) => APPLICATION.test(input));
    if (held.length > 0) fail(`the extension's backend holds what belongs to the application: ${held.join(", ")}`);
    const refused = installScan(readFileSync(join(STAGE, OUT.backend), "utf8"));
    if (refused.length > 0) fail(`Lumiverse's install scan would refuse ${OUT.backend}:\n${refused.map((hit) => `  ${hit.what}, near: ${hit.near}`).join("\n")}`);

    await oneFile("the agent kit", join(ROOT, ENTRIES.kit), OUT.kit, "node", stamp, roots);
    await oneFile("the command line", join(ROOT, ENTRIES.core), OUT.core, "node", stamp, roots);
    // The command line runs under Bun 1.4+ or Node 22+: under the Bun building it, and under Node too where there is one.
    for (const runtime of [process.execPath, Bun.which("node")]) {
      if (runtime === null) continue;
      const ran = run([runtime, join(STAGE, OUT.core), "--version"]);
      if (ran.code !== 0) fail(`${OUT.core} --version failed under ${runtime}: ${ran.err}`);
    }

    publish();

    const rows: [path: string, size: string, what: string][] = [];
    const add = (name: string, what: string): void => {
      rows.push([`dist/${name}`, sizeWords(statSync(join(DIST, name)).size), what]);
    };
    const folder = (name: string, what: string): void => {
      const files = filesUnder(join(DIST, name));
      rows.push([`dist/${name}/`, sizeWords(files.reduce((sum, file) => sum + file.size, 0)), `${files.length} files: ${what}`]);
    };
    add(OUT.app, "the application");
    add(OUT.statement, "the hash of every file a server runs or reads beside the application");
    folder(BESIDE_APP.guidance.dir, "RPE's shipped guidance");
    folder(BESIDE_APP.harness.dir, "RPH's own shipped files");
    add(OUT.backend, "the extension's backend");
    if (pages) {
      add(OUT.frontend, "the extension's frontend");
      for (const file of filesUnder(join(DIST, OUT.ui))) rows.push([`dist/${relative(DIST, file.path)}`, sizeWords(file.size), "the web app"]);
    }
    add(OUT.kit, "the agent kit");
    add(OUT.core, "the command line and MCP server");
    const width = Math.max(...rows.map(([path]) => path.length));
    console.log(`build ${id}${linked === null ? "" : `, with rp-harness ${linked.sha}${linked.changed ? " and its uncommitted changes" : ""}`}`);
    for (const [path, size, what] of rows) console.log(`  ${path.padEnd(width)}  ${size.padStart(10)}  ${what}`);
    if (!pages) console.log(`Without the pages (${NO_PAGES}): this build has no dist/${OUT.frontend} and no dist/${OUT.ui}/.`);
    return 0;
  } catch (error) {
    rmSync(STAGE, { recursive: true, force: true });
    if (!(error instanceof Failure)) throw error;
    console.error(`build: ${error.message}`);
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));

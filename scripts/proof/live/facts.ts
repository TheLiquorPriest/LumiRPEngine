// What a bed run stood on, read from what is running (PlanScenarios-3 items 6 and 10): Lumiverse's version from
// its own diagnostics route (`src/routes/system.routes.ts:35-71`, what its Diagnostics panel reports); RPE's and
// RPH's commits from the build RPE says it runs (`rpe status`'s builds route, `src/app/app.ts:142`), checked
// against the checkout the scripts run from, since a run proves nothing about a build it is not; every agent's
// connection, model, reply form, effort and streaming from RPE's own routes (its files, its settings, its
// connections); and the guidance each play's chat stood on, from the files route, with the floor's readers
// (`scripts/proof/lib/read.ts`). A run whose RPE does not report its commits is refused.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord } from "../../../src/shared/json";
import type { ConnectionShown } from "../../../src/shared/api";
import type { AgentFacts, GuidanceFacts } from "../route/host";
import type { RpeReader } from "../lib/read";
import { folderTree, gitTree, installedRph } from "../lib/record";
import type { Lumiverse } from "../../testbed/lib/lumiverse";

/** A build id as RPE stamps it (`scripts/build.ts`): RPE's commit as eight digits, RPH's after `-rph.` where RPH is a checkout of its own, and `-dirty.<seconds>` for a tree with changes. */
export interface BuildId {
  rpe: string;
  rph: string | null;
  dirty: boolean;
}

const BUILD = /^([0-9a-f]{8})(?:-rph\.([0-9a-f]{8}))?(-dirty\.\d+)?$/;

/** The build id's parts; null for a text that is not one (a build made without git is the time it was made, which names no commit). */
export function parseBuild(id: string): BuildId | null {
  const found = BUILD.exec(id.trim());
  return found === null ? null : { rpe: found[1] ?? "", rph: found[2] ?? null, dirty: found[3] !== undefined };
}

/** The build the running RPE says it is, from its builds route; refused when it says none. */
export async function runningBuild(rpe: { base: string; token: string }): Promise<string> {
  const reply = await fetch(`${rpe.base}/api/v1/status/builds`, { headers: { Accept: "application/json", Authorization: `Bearer ${rpe.token}` } });
  if (!reply.ok) throw new Error(`RPE's builds route answered ${reply.status}: the run's RPE does not report its build`);
  const body: unknown = await reply.json();
  const running = isRecord(body) && isRecord(body.builds) ? body.builds.running : undefined;
  if (typeof running !== "string" || running.trim() === "") throw new Error("RPE's builds route names no running build: the run's RPE does not report its commits");
  return running.trim();
}

/** A git command's output in `repo`, or null where git fails. */
function git(repo: string, args: string[]): string | null {
  const done = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "ignore" });
  return done.exitCode === 0 ? done.stdout.toString().trim() : null;
}

/** The commit RPE's manifest names for `rp-harness`: the hex after the `#` of its name. */
export function manifestPin(manifest: unknown): string | null {
  const name = isRecord(manifest) && isRecord(manifest.dependencies) ? manifest.dependencies["rp-harness"] : undefined;
  const found = typeof name === "string" ? /#([0-9a-f]+)$/.exec(name) : null;
  return found?.[1] ?? null;
}

/** The commit the installed `rp-harness` is: its own tag, which `bun install` leaves in the package. */
export function installedRphCommit(repo: string): string | null {
  const tag = join(repo, "node_modules", "rp-harness", ".bun-tag");
  return existsSync(tag) ? readFileSync(tag, "utf8").trim() : null;
}

/**
 * RPE's and RPH's commits for a run: the running build's, which must be this checkout's (the scripts run from the
 * checkout the build was made from: a build that is not it proves nothing here), RPH's from the install.
 */
export function commitsOf(repo: string, running: string): { rpe: { commit: string; dirty: boolean }; rph: { commit: string; pin: string | null } } {
  const build = parseBuild(running);
  if (build === null) throw new Error(`RPE says it runs build "${running}", which names no commit: the run's RPE does not report its commits`);
  const head = git(repo, ["rev-parse", "HEAD"]);
  if (head === null) throw new Error(`${repo} is not a git checkout, so the run's RPE commit cannot be checked against it`);
  if (!head.startsWith(build.rpe)) throw new Error(`the running RPE is build ${running}, and the checkout the scripts run from is at ${head.slice(0, 8)}: the run would prove nothing about either`);
  const installed = installedRphCommit(repo);
  if (installed === null) throw new Error(`${join(repo, "node_modules", "rp-harness")} holds no .bun-tag: RPH is not installed from a commit, so the run's RPH commit is not known`);
  if (build.rph !== null && !installed.startsWith(build.rph)) throw new Error(`the running RPE says its RPH is ${build.rph}, and the installed one is ${installed.slice(0, 8)}`);
  const manifest: unknown = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  return { rpe: { commit: head, dirty: build.dirty }, rph: { commit: installed, pin: manifestPin(manifest) } };
}

/** Lumiverse's version, as its diagnostics give it. */
export async function lumiverseVersion(host: Pick<Lumiverse, "call">): Promise<string> {
  const info = await host.call<unknown>("GET", "/api/v1/system/info");
  const version = isRecord(info) && isRecord(info.backend) ? info.backend.version : undefined;
  if (typeof version !== "string" || version.trim() === "") throw new Error("Lumiverse's diagnostics name no version");
  return version.trim();
}

const FENCE = /^---[ \t]*$/;

/** The header of an agent definition: the YAML between the two `---` lines at the top, as RPH reads it; an empty record where there is none that parses. */
export function headerOf(text: string): Record<string, unknown> {
  const lines = (text.startsWith("\uFEFF") ? text.slice(1) : text).replace(/\r\n?/g, "\n").split("\n");
  if (!FENCE.test(lines[0] ?? "")) return {};
  const end = lines.findIndex((line, i) => i > 0 && FENCE.test(line));
  if (end === -1) return {};
  try {
    const header: unknown = Bun.YAML.parse(lines.slice(1, end).join("\n"));
    return isRecord(header) ? header : {};
  } catch {
    return {};
  }
}

/** The agents RPE runs and what each runs on, from RPE's files, settings and connections (no chat: the user's own level over the shipped one). */
export async function agentFacts(rpe: RpeReader): Promise<AgentFacts[]> {
  const [files, settings, shown] = await Promise.all([rpe.view(""), rpe.settings(""), rpe.connections()]);
  const view = (key: string): unknown => settings.settings.find((s) => s.key === key)?.value;
  const form = view("reply.form");
  const streamAnyway = Array.isArray(view("reply.streamAnyway")) ? (view("reply.streamAnyway") as unknown[]).filter((v): v is string => typeof v === "string") : [];
  const byConnection = (prefix: string, c: ConnectionShown): unknown => settings.settings.find((s) => s.key.startsWith(prefix) && (s.connection?.id === c.id || s.connection?.name === c.name) && s.value !== null)?.value;
  const agents: AgentFacts[] = [];
  const named = files.filter((f) => f.level === "shipped" && /^@shipped\/\.agents\/[^/]+\.md$/.test(f.path)).map((f) => f.path);
  for (const path of named) {
    const name = path.replace(/^@shipped\/\.agents\//, "").replace(/\.md$/, "");
    // The user's own definition of the same name stands in the shipped one's place, as the tree gives it.
    const own = files.find((f) => f.path === `.agents/${name}.md` && f.kind === "yours");
    const header = headerOf(await rpe.viewFile("", own?.path ?? path));
    const wanted = typeof header.model === "string" && header.model.trim() !== "" ? header.model.trim() : "default";
    const connection = wanted === "default" ? shown.connections.find((c) => c.id === shown.default) : shown.connections.find((c) => c.name === wanted || c.id === wanted);
    if (connection === undefined) throw new Error(`the ${name} agent runs on "${wanted}", and RPE's connections hold no such connection${wanted === "default" ? " (RPE has no default one)" : ""}`);
    if (connection.model === undefined || connection.model === "") throw new Error(`RPE's connection ${connection.name} names no model, so the ${name} agent's model is not known`);
    const forms = byConnection("reply.forms.", connection);
    const replyForm = typeof forms === "string" ? forms : typeof form === "string" ? form : "tags";
    const effort = byConnection("effort.connections.", connection) ?? header.effort ?? connection.effort ?? "inherit";
    agents.push({ agent: name, connection: connection.name, model: connection.model, replyForm, effort: String(effort), streams: replyForm === "tags" || streamAnyway.includes(connection.id) || streamAnyway.includes(connection.name) });
  }
  if (agents.length === 0) throw new Error("RPE's shipped tree holds no agent definition, so the run's agents are not known");
  return agents;
}

/**
 * The guidance a chat stands on: the shipped tree RPE serves it, each layer of the user's own it sees, the build's own
 * shipped folders at `commit`, and the names the levels' configs switch. A shipped file an `off:` list switches off is
 * shown by the files route (`off`, `offIn`); a name `layered:` takes at every level is one the shipped tree holds that
 * a nearer level also holds and the route does not mark as replaced. RPE's routes show no `added:` list, so an added
 * file is seen only as a file of its level in the layers.
 */
export async function guidanceOf(rpe: RpeReader, chat: string, repo: string, commit: string): Promise<GuidanceFacts> {
  const [trees, files] = await Promise.all([rpe.trees(chat), rpe.view(chat)]);
  const layered = [...new Set(files.filter((f) => f.level === "shipped" && f.item !== null && !f.item.includes("/") && f.replacedBy === null && files.some((g) => g.item === f.item && g.level !== "shipped")).map((f) => f.item ?? ""))];
  return {
    served: trees.shipped,
    build: { rph: folderTree(installedRph(repo)), rpe: gitTree(repo, commit, "guidance") },
    layers: trees.layers,
    names: { off: trees.off.map((o) => ({ name: o.path, levels: o.offIn })), layered, added: [] },
  };
}

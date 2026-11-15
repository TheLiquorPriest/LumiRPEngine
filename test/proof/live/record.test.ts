// The bed run's record is made from what is running (PlanScenarios-3 items 6 and 10): a run whose RPE does not
// report its commits is refused; RPE's and RPH's commits are the running build's, which must be the checkout the
// scripts run from; each agent's connection, model, reply form, effort and streaming come from RPE's own routes;
// and a recorded bed with a guidance file in a chat's own level gives facts that make the run a trial, a clean one
// a verdict (`standingFromFacts`, the runner's own).

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectionsShown, SettingsReply, SettingView } from "../../../src/shared/api";
import type { TreeFileEntry } from "../../../src/ui/api";
import { agentFacts, commitsOf, guidanceOf, headerOf, manifestPin, parseBuild, runningBuild } from "../../../scripts/proof/live/facts";
import { RpeReader } from "../../../scripts/proof/lib/read";
import { folderTree, gitTree, sha256, shippedOf, type Layer, type TreeFile } from "../../../scripts/proof/lib/record";
import { standingFromFacts } from "../../../scripts/proof/route/runner";
import { standingOf } from "../../../scripts/proof/route/evidence";
import type { PinHow } from "../../../scripts/proof/route/pin";
import { fakeHeld } from "../route/fake";

const HOW: PinHow = { from: "rph-repository", stage: "before-publishing", bundlesFile: null };

const git = (repo: string, ...args: string[]): string => {
  const done = Bun.spawnSync(["git", "-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], { stdout: "pipe", stderr: "pipe" });
  if (done.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${done.stderr.toString()}`);
  return done.stdout.toString().trim();
};

let dir: string;
let repo: string;
let head: string;
const RPH_COMMIT = "6ca92995b1cd6e10c3978439871e8b72e527ecf8";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "rpe-record-"));
  repo = join(dir, "rpe");
  mkdirSync(join(repo, "guidance"), { recursive: true });
  writeFileSync(join(repo, "guidance", "TURN.md"), "Write the turn as the scene asks.\n");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ dependencies: { "rp-harness": `git+https://rph.invalid/RPHarness.git#${RPH_COMMIT}` } }));
  mkdirSync(join(repo, "node_modules", "rp-harness", "guidance"), { recursive: true });
  writeFileSync(join(repo, "node_modules", "rp-harness", "guidance", "rules.md"), "Keep to the tags.\n");
  writeFileSync(join(repo, "node_modules", "rp-harness", ".bun-tag"), RPH_COMMIT);
  git(repo, "init", "-q");
  git(repo, "add", "guidance", "package.json");
  git(repo, "commit", "-q", "-m", "first");
  head = git(repo, "rev-parse", "HEAD");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("a build id is read for the commits it names, and a build that names none is not one", () => {
  expect(parseBuild("0123abcd")).toEqual({ rpe: "0123abcd", rph: null, dirty: false });
  expect(parseBuild("0123abcd-rph.89abcdef-dirty.1731700000")).toEqual({ rpe: "0123abcd", rph: "89abcdef", dirty: true });
  expect(parseBuild("1731700000")).toBeNull();
  expect(parseBuild("rig-1")).toBeNull();
});

test("a run whose RPE does not report its commits is refused, whichever way it fails to", async () => {
  expect(() => commitsOf(repo, "1731700000", HOW)).toThrow("does not report its commits");
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (request) => (new URL(request.url).pathname === "/api/v1/status/builds" ? Response.json({ builds: {} }) : new Response("no", { status: 404 })) });
  try {
    await expect(runningBuild({ base: `http://127.0.0.1:${server.port}`, token: "key" })).rejects.toThrow("does not report its commits");
    await expect(runningBuild({ base: `http://127.0.0.1:${server.port}/nowhere`, token: "key" })).rejects.toThrow("does not report its build");
  } finally {
    void server.stop(true);
  }
});

test("RPE's commit is the running build's, held to the checkout, and RPH's is the installed commit against the manifest's pin, with how the pin was held", () => {
  const facts = commitsOf(repo, head.slice(0, 8), HOW);
  expect(facts).toEqual({ rpe: { commit: head, dirty: false }, rph: { commit: RPH_COMMIT, pin: RPH_COMMIT, held: { name: `git+https://rph.invalid/RPHarness.git#${RPH_COMMIT}`, from: "rph-repository", stage: "before-publishing", bundles: null } } });
  expect(commitsOf(repo, `${head.slice(0, 8)}-dirty.1731700000`, HOW).rpe.dirty).toBe(true);
  expect(() => commitsOf(repo, "ffffffff", HOW)).toThrow("would prove nothing");
  expect(() => commitsOf(repo, `${head.slice(0, 8)}-rph.ffffffff`, HOW)).toThrow("the installed one is 6ca92995");
  expect(manifestPin({ dependencies: { "rp-harness": "github:TheLiquorPriest/RPHarness#abc123" } })).toBe("abc123");
  expect(manifestPin({ dependencies: {} })).toBeNull();
});

/** RPE's routes as a recorded bed gives them. */
class Recorded extends RpeReader {
  chatLayer: TreeFile[] = [];
  constructor(private readonly served: TreeFile[]) {
    super("http://127.0.0.1:1", "none");
  }
  override async trees(): Promise<{ shipped: TreeFile[]; layers: Layer[]; off: { path: string; offIn: ("global" | "character" | "chat")[] }[] }> {
    return { shipped: this.served, layers: this.chatLayer.length === 0 ? [] : [{ level: "chat", files: this.chatLayer }], off: [] };
  }
  override async view(): Promise<TreeFileEntry[]> {
    return [];
  }
}

const served = (): TreeFile[] => shippedOf(folderTree(join(repo, "node_modules", "rp-harness", "guidance")), gitTree(repo, head, "guidance"));
const RPH = { commit: RPH_COMMIT, pin: RPH_COMMIT, pinned: true, held: fakeHeld(RPH_COMMIT) };
const RPE = { commit: "x", dirty: false };

test("a recorded bed with a guidance file in the chat's own level gives facts that make the run a trial, a clean one a verdict", async () => {
  const clean = new Recorded(served());
  const facts = await guidanceOf(clean, "chat-1", repo, head);
  expect(facts.served.length).toBeGreaterThan(0);
  expect(facts.names).toEqual({ off: [], layered: [], added: [] });
  expect(standingOf(RPE, RPH, standingFromFacts(facts)).is).toBe("verdict");

  const own = new Recorded(served());
  own.chatLayer = [{ path: ".rules/TURN.md", sha256: sha256("Do as I say.") }];
  const trial = standingOf(RPE, RPH, standingFromFacts(await guidanceOf(own, "chat-1", repo, head)));
  expect(trial.is).toBe("trial");
  expect(trial.why.join(" ")).toContain("guidance");

  // A shipped tree that is not the build's is a trial too.
  const changed = new Recorded(served().map((f, i) => (i === 0 ? { ...f, sha256: sha256("another") } : f)));
  expect(standingOf(RPE, RPH, standingFromFacts(await guidanceOf(changed, "chat-1", repo, head))).is).toBe("trial");
});

/** RPE's files, settings and connections as a recorded bed gives them. */
class Agents extends RpeReader {
  constructor(
    private readonly shown: ConnectionsShown,
    private readonly views: SettingView[],
    private readonly definitions: Record<string, string>,
  ) {
    super("http://127.0.0.1:1", "none");
  }
  override async view(): Promise<TreeFileEntry[]> {
    return Object.keys(this.definitions).map((name) => ({ path: `@shipped/.agents/${name}.md`, level: "shipped", kind: "yours", bytes: 1, item: `agents/${name}`, applies: true, replacedBy: null, off: false, offIn: [], editable: false, shipped: null, defaultChanged: null }));
  }
  override async viewFile(_chat: string, path: string): Promise<string> {
    return this.definitions[path.replace(/^@shipped\/\.agents\//, "").replace(/\.md$/, "")] ?? "";
  }
  override async settings(): Promise<SettingsReply> {
    return { chat: null, files: [], settings: this.views, facts: [] };
  }
  override async connections(): Promise<ConnectionsShown> {
    return this.shown;
  }
}

const view = (key: string, value: SettingView["value"], connection?: { id: string; name: string }): SettingView => ({ key, name: key, about: "", effect: "use", effectWords: "at its next use", row: null, value, default: null, from: null, file: null, set: [], joined: false, takes: { type: "text" }, takesWords: "", none: null, orNone: false, levels: [], passed: null, ...(connection ? { connection } : {}) });

test("each agent's connection, model, reply form, effort and streaming come from RPE's routes", async () => {
  const shown: ConnectionsShown = {
    connections: [
      { id: "c1", name: "Lamp", provider: "deepseek", model: "model-a", effort: "low", auth: "key", default: true, key: { set: true }, limitsInForce: null },
      { id: "c2", name: "Other", provider: "openai-compatible", model: "model-b", auth: "key", default: false, key: { set: true }, limitsInForce: null },
    ],
    default: "c1",
    providers: [],
  };
  const definitions = { author: "---\nname: author\nmodel: default\neffort: high\n---\nBody.", gm: "---\nname: gm\nmodel: Other\n---\nBody." };
  const views = [view("reply.form", "tags"), view("reply.forms.Other", "two-step", { id: "c2", name: "Other" }), view("reply.streamAnyway", []), view("effort.connections.Other", "medium", { id: "c2", name: "Other" })];
  expect(await agentFacts(new Agents(shown, views, definitions))).toEqual([
    { agent: "author", connection: "Lamp", model: "model-a", replyForm: "tags", effort: "high", streams: true },
    { agent: "gm", connection: "Other", model: "model-b", replyForm: "two-step", effort: "medium", streams: false },
  ]);
  // A two-step connection named in `reply.streamAnyway` streams.
  const streaming = [view("reply.form", "tags"), view("reply.forms.Other", "two-step", { id: "c2", name: "Other" }), view("reply.streamAnyway", ["Other"])];
  expect((await agentFacts(new Agents(shown, streaming, definitions))).find((a) => a.agent === "gm")?.streams).toBe(true);
  expect(headerOf("no header")).toEqual({});
});

test("an agent that runs on a connection RPE does not have is named, and no agent at all is refused", async () => {
  const none: ConnectionsShown = { connections: [], default: null, providers: [] };
  await expect(agentFacts(new Agents(none, [], { author: "---\nmodel: default\n---\n" }))).rejects.toThrow("RPE has no default one");
  await expect(agentFacts(new Agents(none, [], {}))).rejects.toThrow("holds no agent definition");
});

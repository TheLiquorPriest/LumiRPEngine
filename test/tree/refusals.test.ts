// A write refused for where it is carries, for the words the tools answer with, where that writer may
// write: an agent the notes folder and its turn's four folders, RPH itself the session's folder too,
// and with no turn RPE knows, the notes folder alone. The words come from the shipped tree as laid.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { SHIPPED_GUIDANCE } from "rp-harness/helpers";
import { loadGuidance } from "../../src/app/guidance";
import type { AgentRef, Refused, Scope } from "rp-harness/contract";
import { KIT_SEED } from "rp-harness/testing/kit";
import { RPE_GUIDANCE } from "../../src/tree/index";
import { type LaidTree, layTree } from "./fixtures";

const scope = KIT_SEED.scope;
const agent: AgentRef = { id: "kit-agent-1", definition: "kit-scribe", parent: "kit-lead" };
const notes = "persistent-workspace/";
const session = `sessions/${scope.session}/`;
const turn = `${session}turns/turn-1-kitturn1/`;
const turnFolders = ["queries", "scratch", "output", "cache"].map((f) => `${turn}${f}/`);

let place: string;
let tree: LaidTree;

beforeAll(async () => {
  place = await mkdtemp(join(tmpdir(), "rpe-refusals-"));
  tree = await layTree(KIT_SEED, place, { sources: { rph: SHIPPED_GUIDANCE, rpe: RPE_GUIDANCE } });
});

afterAll(async () => {
  await tree.close();
  await rm(place, { recursive: true, force: true });
});

async function refused(path: string, by: AgentRef | "harness", at: Scope = scope): Promise<Refused> {
  const result = await tree.port.write(at, path, { op: "write", text: "x\n" }, by);
  if (result.status !== "refused") throw new Error(`${path} was not refused: ${result.status}`);
  return result;
}

test("a path that is nowhere and outside every writable folder is refused with the writer's own writable folders", async () => {
  // Paths an agent might guess: a notes folder misnamed, a turn folder without its turn, a file that does not exist.
  for (const path of ["notes/plan.md", "scratch/draft.md", "kit-new.md", `${turn}draft.md`, `${session}notes.md`]) {
    expect({ path, writable: (await refused(path, agent)).writable }).toEqual({ path, writable: [notes, ...turnFolders] });
    if (!path.startsWith(session)) expect({ path, writable: (await refused(path, "harness")).writable }).toEqual({ path, writable: [notes, ...turnFolders, session] });
  }
  const noTurn = { user: scope.user, chat: scope.chat, session: scope.session };
  expect((await refused("scratch/draft.md", agent, noTurn)).writable).toEqual([notes]);
  expect((await refused("@shipped/TURN.md", agent)).writable).toEqual([notes, ...turnFolders]);
});

test("the words the tools answer such a refusal with, from the shipped tree, name the folders the agent may write in", async () => {
  const tools = await loadGuidance(tree.port, scope).part("tool-notices");
  if (tools?.format !== "lines") throw new Error("The shipped tree has no tool-notices part of lines.");
  const refusal = await refused("notes/plan.md", agent);
  const words = tools.line(`refused_${refusal.reason}`, { path: refusal.path, writable: refusal.writable });
  expect(words).toBeDefined();
  for (const folder of [notes, ...turnFolders]) expect(words).toContain(folder);
});

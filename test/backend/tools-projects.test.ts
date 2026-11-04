// Production projects' agent tools on Port Alder (DESIGN §26.5): orgs_read's projects part with the
// templates the shop may start from; gm_project's start from a template, checked by its dry run,
// proposed, and applied as one GM edit whose Undo takes it back; its refusals; and the story's
// project_note, noted for the reply's read within the story's bounds.

import { describe, expect, test } from "bun:test";
import { outsideReader } from "../../src/backend/agents/tools/read-view";
import type { ReadNotes } from "../../src/backend/agents/tools/registry";
import { toolsFor } from "../../src/backend/agents/tools/registry";
import { chatHead } from "../../src/backend/agents/tools/workspace";
import { type AgentOp, type OpPreview, opKey, outsideWriter } from "../../src/backend/agents/tools/writer";
import type { JsonObject } from "../../src/shared/json";
import type { ProjectsView } from "../../src/shared/projects";
import { projectRunOf } from "../../src/packs/economy/core/projects";
import { alderChat, answerOf, callTool } from "../support/tools";

const SHOP = "alder_automotive_co";

interface GmAnswer {
  checked?: OpPreview;
  proposed?: OpPreview;
}

/** The GM assistant's tools outside a turn, with its writer; and the story tier's, noting what it notes into `noted`. */
async function rigged() {
  const { rig, chatId } = await alderChat();
  const user = rig.host.userId;
  const base = { userId: user, chatId, knowledge: "gm" as const };
  const reader = outsideReader(rig.rt, base);
  const agent = { ...base, reader, agent: { role: "assistant", id: "agent_test" }, signal: new AbortController().signal };
  const writer = outsideWriter(rig.rt, { ...agent, connectionId: null });
  const world = (await reader.view()).world;
  const gm = toolsFor({ world, tiers: ["read", "gm"], texts: {}, env: { ...agent, writer } });
  const noted: JsonObject[] = [];
  const notes: ReadNotes = { add: (fact) => (noted.push(fact), true) };
  const story = toolsFor({ world, tiers: ["story"], texts: {}, env: { ...agent, writer: null, notes } });
  const call = { signal: new AbortController().signal, agentId: "agent_test", role: "assistant", callId: "call" };
  const run = async (tools: typeof gm, name: string, args: JsonObject) => {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`no ${name}`);
    return tool.run(args, call);
  };
  const head = async () => (await chatHead(rig.rt, chatId, user))?.state;
  return { rig, chatId, user, writer, gm, story, noted, run, head };
}

describe("production projects' agent tools", () => {
  test("orgs_read's projects part lists what the shop may start, with its bands", async () => {
    const { rig, chatId } = await alderChat();
    const read = await answerOf<{ part: string; projects: ProjectsView | null }>(rig, chatId, "gm", "orgs_read", { org: "Alder Automotive", part: "projects" });
    expect(read.part).toBe("projects");
    expect(read.projects?.canStart).toBe(true);
    expect(read.projects?.templates.map((t) => t.id).sort()).toEqual(["building", "farm_season", "foundry", "oil_well", "water_well"]);
    const well = read.projects?.templates.find((t) => t.id === "water_well");
    expect(well?.cost.typical).toBe(4_150_000);
    expect(well?.unlocks).toEqual(["Makes Water well, its cost depreciated over 20 years where that's on", "Starts Water sales"]);
  });

  test("gm_project starts a water well from its template: checked, proposed, applied as one GM edit, and undone", async () => {
    const { rig, chatId, writer, gm, run, head } = await rigged();
    const args = { act: "start", org: "Alder Automotive", template: "water_well", name: "Shop well" };
    const dry = JSON.parse((await run(gm, "gm_project", { ...args, dry: true })).text) as GmAnswer;
    expect(dry.checked).toEqual(expect.objectContaining({ changeType: "org_rules" }));
    expect(dry.checked?.lines.join(" ")).toContain("Shop well");
    const proposed = (JSON.parse((await run(gm, "gm_project", args)).text) as GmAnswer).proposed;
    const op: AgentOp = { kind: "gm_edit", op: { op: "org", change: { do: "project", act: "start", org: SHOP, template: "water_well", name: "Shop well" } } };
    expect(proposed?.key).toBe(opKey(op));
    const result = await writer.apply([op], "Drill the shop a well");
    expect([result.applied, result.refused]).toEqual([[opKey(op)], []]);
    const state = await head();
    const id = Object.keys(state?.entities ?? {}).find((k) => state?.entities[k]?.kind === "project") ?? "";
    expect(state?.entities[id]?.name).toBe("Shop well");
    expect(projectRunOf(state!, id).status).toBe("active");
    // Its History line, the GM's.
    expect(JSON.stringify(state?.packs.orgs?.log)).toContain("Started Shop well");
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: result.chipId ?? "", choice: "undo" }))).toEqual({ applied: true, pending: false });
    const after = await head();
    expect(Object.values(after?.entities ?? {}).some((e) => e.kind === "project")).toBe(false);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("gm_project refuses an act or a template it doesn't have, naming the ones there are", async () => {
    const { rig, chatId } = await alderChat();
    const bad = await callTool(rig, chatId, "gm", "orgs_read", { org: "Alder Automotive", part: "projects" });
    expect(bad.error).toBeFalsy();
    const { gm, run } = await rigged();
    const act = await run(gm, "gm_project", { act: "finish", project: "x" });
    expect(act.error).toBe(true);
    expect(act.text).toContain("start");
    const template = await run(gm, "gm_project", { act: "start", org: "Alder Automotive", template: "gold_mine" });
    expect(template.error).toBe(true);
    expect(template.text).toContain("water_well");
  });

  test("project_note notes a setback for the reply's read within the story's bounds, and refuses one past them", async () => {
    const { writer, gm, story, noted, run, head } = await rigged();
    expect(gm.some((t) => t.name === "project_note")).toBe(false);
    const op: AgentOp = { kind: "gm_edit", op: { op: "org", change: { do: "project", act: "start", org: SHOP, template: "water_well", name: "Shop well" } } };
    await writer.apply([op], "Drill the shop a well");
    const state = await head();
    const id = Object.keys(state?.entities ?? {}).find((k) => state?.entities[k]?.kind === "project") ?? "";
    const ok = await run(story, "project_note", { project: "Shop well", days: 3, amount: 1200, why: "The permit office lost the forms" });
    expect(ok.error).toBeFalsy();
    expect(noted).toEqual([{ type: "project_note", project: id, text: "The permit office lost the forms", days: 3, cents: 120_000 }]);
    const far = await run(story, "project_note", { project: "Shop well", days: 45, why: "Floods" });
    expect(far.error).toBe(true);
    expect(far.text).toContain("bad_days");
    expect(noted.length).toBe(1);
  });
});

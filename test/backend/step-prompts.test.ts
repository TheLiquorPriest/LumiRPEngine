// The user's own prompt for a step (Settings → Steps and connections, DESIGN §5.2): it runs in place
// of the world's template, which runs in place of the built-in, with the effect a world template has
// on the purpose; a world's `effects` templates, calls of their own, still run beside it.

import { describe, expect, test } from "bun:test";
import { defaultSettings } from "../../src/backend/settings-store";
import { noFacts, runsOf } from "../../src/backend/turn-steps";
import type { ModelUseSettings } from "../../src/shared/settings";
import { baseWorld } from "../packs/support";
import { Rig } from "../support/rig";

/** Model use with the brief step on for every turn, and `template` as the user's own prompt for it. */
function briefOn(template?: string): ModelUseSettings {
  const modelUse = defaultSettings().modelUse;
  return { ...modelUse, steps: { ...modelUse.steps, brief: { enabled: true, signals: ["always"], ...(template !== undefined ? { template } : {}) } } };
}

describe("a step's own prompt", () => {
  test("the user's prompt beats the world's template, which beats the built-in", () => {
    const world = baseWorld();
    expect(runsOf(briefOn(), world, "brief", noFacts()).map((r) => r.template)).toEqual([null]);
    world.steps.house = { id: "house", purpose: "brief", template: "The world's brief.", output: "text", signals: [] };
    world.steps.changes = { id: "changes", purpose: "brief", template: "Effects of the world's.", output: "effects", signals: [] };
    expect(runsOf(briefOn(), world, "brief", noFacts(), { output: "text" }).map((r) => r.template?.template)).toEqual(["The world's brief."]);
    expect(runsOf(briefOn("My own brief."), world, "brief", noFacts(), { output: "text" }).map((r) => r.template?.template)).toEqual(["My own brief."]);
    // The world's effects template still runs as its own call; a blank prompt of the user's is none.
    expect(runsOf(briefOn("My own brief."), world, "brief", noFacts(), { output: "effects" }).map((r) => r.template?.template)).toEqual(["Effects of the world's."]);
    expect(runsOf(briefOn("  "), world, "brief", noFacts(), { output: "text" }).map((r) => r.template?.template)).toEqual(["The world's brief."]);
  });
});

// ---------------------------------------------------------------- the vars

/** A Port Alder chat whose brief template shows `{{gear}}`, `{{money}}` and `{{knowledge}}`, with `truth` as an unrevealed secret when given; the brief's prompt after one turn. */
async function briefPrompt(truth?: string): Promise<string> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "steps", id: "b", value: { id: "b", purpose: "brief", template: "BRIEF gear=[{{gear}}] money=[{{money}}] positions=[{{positions}}]", output: "text", signals: ["always"] } }));
  if (truth) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "tracks", id: "kit", value: { id: "kit", kind: "secret", label: "The kit", start: "hidden", visibility: "secret", stages: { hidden: { label: "Hidden", next: [], truth } } } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
  rig.host.quietReply = () => "{}";
  await rig.turn(chatId, "I look around the shop.", "The shop is quiet.");
  return rig.host.quietCalls.findLast((c) => (c.messages[0]?.content ?? "").startsWith("BRIEF "))?.messages[0]?.content ?? "";
}

describe("the vars a prompted step reads", () => {
  test("gear, money and positions hold what the player character has and who is with it, and a line with a secret is left out", async () => {
    const shown = await briefPrompt();
    const between = (name: string, text: string): string => new RegExp(`${name}=\\[([^\\]]*)\\]`).exec(text)?.[1] ?? "";
    expect(between("gear", shown)).toContain("Pocketknife");
    expect(between("money", shown)).toContain("$85.00");
    expect(between("positions", shown)).toContain("Danny Okafor is here.");
    // While the pocketknife is someone's secret, no line naming it reaches the step.
    const kept = await briefPrompt("Pocketknife");
    expect(kept).not.toContain("Pocketknife");
    expect(between("money", kept)).toContain("$85.00");
  });
});

// ---------------------------------------------------------------- Caveats' pre-flight

describe("Settings → Caveats' pre-flight", () => {
  test("a step on a deleted connection, or on a model its connection doesn't list, is flagged; one that exists isn't", async () => {
    const rig = new Rig();
    rig.host.activeConnection = { id: "main", name: "Main" };
    rig.host.connectionProfiles = [{ id: "fast", name: "Fast", models: ["small-1", "small-2"] }];
    const codes = async (): Promise<string[]> => (rig.body(await rig.send({ type: "lre.settings.caveats" })).caveats as { code: string }[]).map((c) => c.code);
    const route = (connectionId: string, model: string | null) => ({ modelUse: { steps: { brief: { enabled: true, signals: ["always"], route: { provider: "helper", connectionId, model } } } } });
    rig.body(await rig.send({ type: "lre.settings.set", patch: route("fast", "small-2") }));
    expect(await codes()).not.toContain("step_connection_missing");
    expect(await codes()).not.toContain("step_model_missing");
    rig.body(await rig.send({ type: "lre.settings.set", patch: route("fast", "small-9") }));
    expect(await codes()).toContain("step_model_missing");
    rig.body(await rig.send({ type: "lre.settings.set", patch: route("deleted", null) }));
    expect(await codes()).toContain("step_connection_missing");
  });
});

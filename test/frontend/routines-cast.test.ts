// #48, the player's and the author's screens: Build's review of Propose routines from lore (its
// proposals offered, ticked, edited and applied into a real backend's draft) and Cast's usual day.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { createRegistry } from "../../src/engine/registry-impl";
import { placeOfEntity } from "../../src/engine/scope";
import { Working } from "../../src/engine/working";
import { proposalWrites } from "../../src/frontend/build/jobs";
import { citedSources, citesSource, editedProposals, editProblems, offeredProposals, proposeOwners, reviewGroups, reviewProblems, reviewTicked } from "../../src/frontend/build/propose-routines";
import { dayPlan } from "../../src/packs/castlife/core/index";
import { routinePlayerView } from "../../src/packs/castlife/core/view";
import { usualDay } from "../../src/packs/castlife/ui/person";
import { ALL_PACKS } from "../../src/packs/index";
import type { JsonValue } from "../../src/shared/json";
import type { JobProposal } from "../../src/shared/protocol";
import { routineShapeProblems, type RoutineDef } from "../../src/shared/routines";
import type { WorldDoc } from "../../src/shared/world";
import { modernUsWorld } from "../packs/riverton";
import { startState } from "../packs/support";
import { Rig } from "../support/rig";

/** The draft as Build's forms read it: the packs' kinds merged in, the world's own winning. */
function formDoc(w: WorldDoc): WorldDoc {
  return { ...w, kinds: { ...Object.fromEntries(createRegistry(ALL_PACKS).kinds), ...w.kinds } };
}

async function draftOf(rig: Rig, worldId: string): Promise<WorldDoc> {
  return rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "get" })).draft as WorldDoc;
}

const said = (req: QuietRequest): string => req.messages.map((m) => m.content).join("\n");

/**
 * Port Alder with the job run for Danny and the Kowalczyks' household: Danny's trivia night and the
 * household's crossword rest on what their lore says, and Danny's trip to a dock the world doesn't
 * have is checked and kept with its problem.
 */
async function proposedForPortAlder(): Promise<{ rig: Rig; worldId: string; proposals: JobProposal[] }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  rig.host.quietReply = (req) =>
    said(req).includes("(danny_okafor;")
      ? JSON.stringify({
          routines: [
            { owner: "danny_okafor", id: "trivia", label: "Trivia night", activity: "socialize", kind: "fixed", at: "19:00", minutes: 120, days: { weekdays: [4] }, place: "rusty_anchor", source: { lore: "lore_anchor", quote: "a Thursday trivia night that gets competitive" }, confidence: 0.8 },
            { owner: "danny_okafor", id: "dock", label: "Checks the dock", activity: "leisure", kind: "flexible", window: { from: "10:00", to: "16:00" }, minutes: 60, place: "nowhere_dock", source: { lore: "lore_anchor", quote: "a deck over the harbor" }, confidence: 0.9 },
            { owner: "household_kowalczyk", id: "crossword", label: "The crossword", activity: "leisure", kind: "flexible", window: { from: "13:00", to: "16:00" }, minutes: 45, place: "home", source: { lore: "lore_helen", quote: "still does the crossword in pen" }, confidence: 0.85 },
          ],
          schedules: [],
        })
      : JSON.stringify({ routines: [], schedules: [] });
  const jobId = rig.body(await rig.send({ type: "lre.job", op: "start", kind: "propose_routines", worldId, input: { owners: ["danny_okafor", "household_kowalczyk"] } })).jobId;
  await rig.host.settle();
  const end = rig.host.sent.findLast((m) => m.type === "lre.job.update" && m.jobId === jobId && m.status !== "running");
  if (end?.type !== "lre.job.update" || !end.result || !("proposals" in end.result)) throw new Error("the job didn't end with proposals");
  return { rig, worldId, proposals: end.result.proposals };
}

/** A proposal with every source it carries taken out, or turned into an authored one. */
function unsourced(p: JobProposal, as: "none" | "authored"): JobProposal {
  const value = structuredClone(p.value) as unknown as RoutineDef;
  for (const block of value.blocks) {
    if (as === "none") delete block.source;
    else block.source = { type: "authored" };
  }
  return { ...p, id: `${p.id}_${as}`, key: `${p.key}_${as}`, value: value as unknown as JsonValue };
}

describe("Build → Propose routines from lore", () => {
  test("the review offers only proposals resting on lore or a sheet, by person and group, ticking those with nothing found against them", async () => {
    const { rig, worldId, proposals } = await proposedForPortAlder();
    const doc = formDoc(await draftOf(rig, worldId));
    const byKey = (key: string): JobProposal => {
      const p = proposals.find((x) => x.key.endsWith(key));
      if (!p) throw new Error(`no proposal for ${key} among ${proposals.map((x) => x.key).join(", ")}`);
      return p;
    };
    const trivia = byKey("trivia");
    const dock = byKey("dock");
    const crossword = byKey("crossword");
    // Two that rest on nothing a reader can check: never offered, wherever they'd come from.
    const all = [...proposals, unsourced(trivia, "none"), unsourced(trivia, "authored")];
    expect(all.filter((p) => citesSource(p)).map((p) => p.id)).toEqual(proposals.map((p) => p.id));
    const offered = offeredProposals(all);
    expect(offered.map((p) => p.id)).toEqual(proposals.map((p) => p.id));

    // Grouped by whom they're for, the household as a group.
    const groups = reviewGroups(offered, doc);
    expect(groups.map((g) => [g.owner, g.group, g.proposals.map((p) => p.id).sort()])).toEqual([
      ["danny_okafor", false, [dock.id, trivia.id].sort()],
      ["household_kowalczyk", true, [crossword.id]],
    ]);

    // The dock's problem is shown and keeps it unticked; the grounded ones start ticked.
    expect(reviewProblems(dock, doc).length).toBeGreaterThan(0);
    expect(reviewProblems(trivia, doc)).toEqual([]);
    expect(reviewProblems(crossword, doc)).toEqual([]);
    expect([...reviewTicked(offered, doc)].sort()).toEqual([crossword.id, trivia.id].sort());

    // Each shows the entry it rests on, by its title, with its quote.
    expect(citedSources(trivia, doc)).toEqual([{ key: "lore_anchor", type: "lore", entry: "lore_anchor", name: doc.lore.lore_anchor?.title ?? "", quote: "a Thursday trivia night that gets competitive" }]);
    expect(citedSources(crossword, doc).map((s) => [s.type, s.entry, s.quote])).toEqual([["lore", "lore_helen", "still does the crossword in pen"]]);

    // A routine of the same id put into the draft after the job ran: applying would replace it, so it's shown and unticked.
    const authored: RoutineDef = { id: trivia.key, label: "Darts", owner: "danny_okafor", blocks: [{ id: "darts", label: "Darts", activity: "leisure", kind: "fixed", at: "20:00", minutes: 60 }] };
    rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "put", collection: "routines", id: trivia.key, value: authored as unknown as JsonValue }));
    const changed = formDoc(await draftOf(rig, worldId));
    expect(reviewProblems(trivia, changed).length).toBe(1);
    expect(reviewTicked(offered, changed).has(trivia.id)).toBe(false);
    expect(reviewTicked(offered, changed).has(crossword.id)).toBe(true);
  });

  test("an edit is what's applied; the ticked go into the draft, and the unticked and the unsourced don't", async () => {
    const { rig, worldId, proposals } = await proposedForPortAlder();
    const doc = formDoc(await draftOf(rig, worldId));
    const trivia = proposals.find((p) => p.key.endsWith("trivia"));
    const dock = proposals.find((p) => p.key.endsWith("dock"));
    const crossword = proposals.find((p) => p.key.endsWith("crossword"));
    if (!trivia || !dock || !crossword) throw new Error("the job proposed too little");
    const all = [...proposals, unsourced(crossword, "none")];
    const offered = offeredProposals(all);
    // The author moves trivia night to 20:00 for 90 minutes in the routine form, which ticks it.
    const edited = structuredClone(trivia.value) as unknown as RoutineDef;
    const block = edited.blocks[0];
    if (!block || "off" in block) throw new Error("trivia has no block");
    block.at = "20:00";
    block.minutes = 90;
    const edits: Record<string, JsonValue> = { [trivia.id]: edited as unknown as JsonValue };
    const chosen = editedProposals(offered, edits);
    expect(editProblems(chosen.find((p) => p.id === trivia.id) ?? trivia)).toEqual([]);
    const accepted = new Set([...reviewTicked(offered, doc), trivia.id]);
    expect(accepted.has(dock.id)).toBe(false);

    for (const write of proposalWrites(worldId, chosen, accepted)) rig.body(await rig.send({ ...write }));
    const after = await draftOf(rig, worldId);
    const routines = after.routines ?? {};
    // The edit, not the proposal, is in the draft, still resting on its entry.
    expect(routines[trivia.key]?.blocks).toEqual([{ ...block, source: { type: "lore", entry: "lore_anchor", quote: "a Thursday trivia night that gets competitive" } }]);
    expect(routines[crossword.key]?.owner).toBe("household_kowalczyk");
    expect(routineShapeProblems(routines[crossword.key])).toEqual([]);
    expect(Object.keys(routines).sort()).toEqual([crossword.key, trivia.key].sort());

    // An edit that breaks the block's shape is told before it's applied.
    const broken = structuredClone(edited);
    const first = broken.blocks[0];
    if (first && !("off" in first)) first.minutes = 0;
    expect(editProblems({ ...trivia, value: broken as unknown as JsonValue }).length).toBeGreaterThan(0);
  });

  test("the start form offers the people and groups the job may read: no secret one, and never the player's character", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    const draft = await draftOf(rig, worldId);
    const danny = draft.entities.danny_okafor;
    if (!danny) throw new Error("no Danny");
    rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "put", collection: "entities", id: "danny_okafor", value: { ...danny, visibility: "secret" } as unknown as JsonValue }));
    const owners = proposeOwners(formDoc(await draftOf(rig, worldId)));
    const people = owners.people.map((o) => o.value);
    expect(people).toContain("jess_kowalczyk");
    expect(people).not.toContain("danny_okafor");
    expect(people).not.toContain(draft.pov);
    expect(people).not.toContain("household_kowalczyk");
    expect(owners.groups.map((o) => o.value)).toContain("household_kowalczyk");
    expect(owners.groups.map((o) => o.value)).not.toContain("jess_kowalczyk");
  });
});

describe("Cast → their usual day", () => {
  test("it shows only what the player's projection gives: a secret's block is absent, a secret entry is never named, and someone with no day in Cast shows none", () => {
    const reg = createRegistry(ALL_PACKS);
    const world = modernUsWorld("w", "Riverton");
    world.realism.levels.castlife = 3;
    world.tracks.b_secret = { id: "b_secret", kind: "agenda", label: "Poison the mayor", owner: "maya", start: "buy", visibility: "secret", stages: { buy: { label: "Buy arsenic", priority: 9, next: [] } } };
    world.lore.cafe_hours = { id: "cafe_hours", title: "Daybreak's hours", content: "Maya locks up the Daybreak Café every evening.", keys: [], links: [] };
    world.lore.maya_debts = { id: "maya_debts", title: "Maya's debts", content: "Maya pawns something every week to cover what she owes.", keys: [], links: [], secret: true, gate: "self.cash > 100000000" };
    // Maya's routine: a private block, one resting on the secret entry, and one on the public one.
    world.routines = {
      maya_days: {
        id: "maya_days",
        owner: "maya",
        blocks: [
          { id: "pawn", label: "Pawns her watch", activity: "errand", kind: "fixed", at: "16:00", minutes: 60, private: true, source: { type: "lore", entry: "maya_debts", quote: "pawns something every week" } },
          { id: "tally", label: "Tallies the week", activity: "leisure", kind: "fixed", at: "21:00", minutes: 45, source: { type: "lore", entry: "maya_debts", quote: "to cover what she owes" } },
          { id: "lock_up", label: "Locks up the café", activity: "work", kind: "fixed", at: "20:15", minutes: 30, source: { type: "lore", entry: "cafe_hours", quote: "locks up the Daybreak Café" } },
        ],
      },
    };
    const state = startState(world);
    const here = placeOfEntity(state, world.pov);
    const maya = state.entities.maya;
    if (!here || !maya) throw new Error("no POV place, or no Maya");
    maya.fields.place = here;
    const ctx = new Working(reg, world, state).ctx;
    // The planner, which isn't the player's, lays all of it.
    const laid = dayPlan(ctx, "maya").blocks.map((b) => b.label);
    for (const label of ["Pawns her watch", "Tallies the week", "Locks up the café", "Buy arsenic"]) expect(laid).toContain(label);

    const day = usualDay(routinePlayerView(ctx, "maya"));
    if (!day) throw new Error("Cast shows Maya a day, so her usual day shows");
    const shown = JSON.stringify(day);
    for (const secret of ["Pawns her watch", "Buy arsenic", "Poison the mayor", "Maya's debts", "maya_debts", "pawns something", "what she owes"]) expect(shown).not.toContain(secret);
    expect(day.rows.filter((r) => r.label === "Busy").length).toBeGreaterThanOrEqual(2);
    // The block resting on the secret entry still shows, as their routine; the public entry is named.
    const tally = day.rows.find((r) => r.label === "Tallies the week");
    const open = day.rows.find((r) => r.label === "Locks up the café");
    expect(tally?.source).toBeDefined();
    expect(open?.source).toContain("Daybreak's hours");
    expect(tally?.source).toBe(day.rows.find((r) => r.label === "Busy")?.source);
    // No place or company reaches it.
    for (const place of Object.values(world.places)) expect(shown).not.toContain(place.name);

    // Away from the POV, Cast shows Maya no day, and so no usual day.
    maya.fields.place = "office";
    expect(usualDay(routinePlayerView(new Working(reg, world, state).ctx, "maya"))).toBeNull();
    expect(usualDay(null)).toBeNull();
  });
});

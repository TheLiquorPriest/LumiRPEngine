// Propose routines from lore (DESIGN §13): the job reads the world's lore, the sheets and the places
// a few people and groups to a call, and proposes routine blocks and schedules that each rest on a
// lore entry or a sheet field they quote; every proposal is checked against the draft, a reply with
// problems the helper can fix is asked once more, and applying a proposal writes routine data into
// the draft through the editor. All on the fake host, with the fake model scripted per call.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import type { JobProposal } from "../../src/shared/protocol";
import { Rig } from "../support/rig";

/** The text of a call: its system prompt and its request. */
const said = (req: QuietRequest): string => req.messages.map((m) => m.content).join("\n");

/** Starts the job on the rig and returns its final update with its proposals. */
async function proposed(rig: Rig, worldId: string, input: Record<string, unknown> = {}) {
  const jobId = rig.body(await rig.send({ type: "lre.job", op: "start", kind: "propose_routines", worldId, input: JSON.parse(JSON.stringify(input)) })).jobId;
  await rig.host.settle();
  const end = rig.host.sent.findLast((m) => m.type === "lre.job.update" && m.jobId === jobId && m.status !== "running");
  if (end?.type !== "lre.job.update") throw new Error("the job didn't end");
  const result = end.result && "proposals" in end.result ? end.result : { proposals: [] as JobProposal[] };
  return { ...end, proposals: result.proposals, next: "next" in result ? result.next : undefined };
}

describe("Propose routines from lore", () => {
  test("a block rests on the lore entry it quotes, and comes back for its owner with the source named", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    rig.host.quietReply = (req) =>
      said(req).includes("(danny_okafor;")
        ? JSON.stringify({ routines: [{ owner: "danny_okafor", id: "trivia", label: "Trivia night", activity: "socialize", kind: "fixed", at: "19:00", minutes: 120, days: { weekdays: [4] }, place: "rusty_anchor", source: { lore: "lore_anchor", quote: "a Thursday trivia night that gets competitive" }, confidence: 0.8 }], schedules: [] })
        : JSON.stringify({ routines: [], schedules: [] });
    const end = await proposed(rig, worldId, { owners: ["danny_okafor"] });
    expect(end.status).toBe("done");
    expect(end.proposals).toHaveLength(1);
    const p = end.proposals[0];
    expect(p).toMatchObject({ collection: "routines", key: "danny_okafor_trivia", owner: "danny_okafor", source: "lore_anchor", sourceNames: { lore_anchor: "The Rusty Anchor" }, confidence: 0.8 });
    expect(p?.problems).toBeUndefined();
    expect(p?.value).toMatchObject({ id: "danny_okafor_trivia", owner: "danny_okafor", blocks: [{ id: "trivia", kind: "fixed", at: "19:00", minutes: 120, place: { place: "rusty_anchor" }, source: { type: "lore", entry: "lore_anchor", quote: "a Thursday trivia night that gets competitive" } }] });
  });
});

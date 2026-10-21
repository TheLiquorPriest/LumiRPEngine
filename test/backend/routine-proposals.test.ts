// Propose routines from lore (DESIGN §13): the job reads the world's lore, the sheets and the places
// a few people and groups to a call, and proposes routine blocks and schedules that each rest on a
// lore entry or a sheet field they quote; every proposal is checked against the draft, an answer with
// problems the helper can fix is asked once more, clashes are pointed out, a large world is read in
// passes, and applying a proposal writes routine data into the draft through the editor. All on the
// fake host with Port Alder, the fake model scripted per call.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { JobRunner } from "../../src/backend/jobs";
import { ROUTINE_MAX_CALLS, ROUTINE_OWNERS_PER_CALL } from "../../src/backend/routine-proposals";
import { isRecord } from "../../src/shared/json";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import type { JobProposal } from "../../src/shared/protocol";
import { routineShapeProblems, type RoutineGmView } from "../../src/shared/routines";
import { TimeoutFired } from "../../src/shared/timeouts";
import type { WorldDoc } from "../../src/shared/world";
import { Rig } from "../support/rig";

/** A new rig with Port Alder, its people's schedules and its 26 public lore entries. */
async function portAlder(): Promise<{ rig: Rig; worldId: string }> {
  const rig = new Rig({ shipped: true });
  return { rig, worldId: await rig.newWorld("Port Alder", "modern_slice_of_life") };
}

/** Writes one item to the draft, as Build's editor does. */
async function put(rig: Rig, worldId: string, collection: string, id: string, value: JsonValue): Promise<void> {
  rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "put", collection, id, value }));
}

async function draftOf(rig: Rig, worldId: string): Promise<WorldDoc> {
  return await rig.rt.worlds.working(worldId, rig.host.userId);
}

/** A person of Port Alder's kind with no ties to anyone. */
const stranger = (id: string, name: string, fields: JsonObject = {}): JsonValue => ({ id, kind: "character", name, tier: "background", fields: { home: "port_alder", ...fields }, relations: [] });

/** The people and groups a call proposes for, as its request heads them. */
function ownersOf(req: QuietRequest): string[] {
  const request = (req.messages[1]?.content ?? "").split("\n\nLore")[0] ?? "";
  return [...request.matchAll(/^### .+ \(([a-z0-9_]+); a (?:person|group),/gm)].map((m) => m[1] ?? "");
}

/** The whole text of a call. */
const said = (req: QuietRequest): string => req.messages.map((m) => m.content).join("\n");

/** A helper that answers each call with the items for the owners it is about, from `answers` (the first call's, then the repair's when there are two). */
function answering(answers: Record<string, { routines?: JsonValue[]; schedules?: JsonValue[] }[]>): (req: QuietRequest) => string {
  const asked = new Map<string, number>();
  return (req) => {
    const routines: JsonValue[] = [];
    const schedules: JsonValue[] = [];
    for (const owner of ownersOf(req)) {
      const turn = asked.get(owner) ?? 0;
      asked.set(owner, turn + 1);
      const list = answers[owner] ?? [];
      const answer = list[Math.min(turn, list.length - 1)];
      routines.push(...(answer?.routines ?? []));
      schedules.push(...(answer?.schedules ?? []));
    }
    return JSON.stringify({ routines, schedules });
  };
}

/**
 * A person in a flat of their own, which no lore names, with `count` long lore entries about them
 * (about 610 tokens each, past Import's 1,500 characters), each ending with its own marker.
 */
async function withLongLore(rig: Rig, worldId: string, id: string, name: string, count: number): Promise<void> {
  const first = name.split(" ")[0] ?? name;
  await put(rig, worldId, "places", `${id}_flat`, { id: `${id}_flat`, name: `${first}'s flat`, parent: "port_alder", fields: {} });
  await put(rig, worldId, "entities", id, stranger(id, name, { home: `${id}_flat`, description: `${first} keeps to a routine.` }));
  for (let i = 0; i < count; i++) await put(rig, worldId, "lore", `lore_${id}_${i}`, { id: `lore_${id}_${i}`, title: `${first} ${i}`, content: `${`${first} keeps to her habits. `.repeat(70)}Marker ${i} closes this entry.`, keys: [], links: [id] });
}

/** Starts the job on the rig and returns its final update, its proposals and where a second pass starts. */
async function proposed(rig: Rig, worldId: string, input: JsonObject = {}) {
  const jobId = rig.body(await rig.send({ type: "lre.job", op: "start", kind: "propose_routines", worldId, input })).jobId;
  await rig.host.settle();
  const end = rig.host.sent.findLast((m) => m.type === "lre.job.update" && m.jobId === jobId && m.status !== "running");
  if (end?.type !== "lre.job.update") throw new Error("the job didn't end");
  const result = end.result && "proposals" in end.result ? end.result : { proposals: [] as JobProposal[], next: undefined };
  return { status: end.status, message: end.message ?? "", proposals: result.proposals, next: result.next, byKey: new Map(result.proposals.map((p) => [p.key, p])) };
}

/** A fixed block of Danny's, resting on the Rusty Anchor's entry. */
const dannys = (o: JsonObject): JsonObject => ({ owner: "danny_okafor", kind: "fixed", minutes: 60, activity: "leisure", source: { lore: "lore_anchor", quote: "a Thursday trivia night that gets competitive" }, confidence: 0.8, ...o });

describe("Propose routines from lore", () => {
  test("a block rests on the lore entry it quotes, and comes back for its owner with the source named", async () => {
    const { rig, worldId } = await portAlder();
    rig.host.quietReply = answering({ danny_okafor: [{ routines: [dannys({ id: "trivia", label: "Trivia night", activity: "socialize", at: "19:00", minutes: 120, days: { weekdays: [4] }, place: "rusty_anchor" })] }] });
    const end = await proposed(rig, worldId, { owners: ["danny_okafor"] });
    expect(end.status).toBe("done");
    expect(end.proposals).toHaveLength(1);
    const p = end.proposals[0];
    expect(p).toMatchObject({ collection: "routines", key: "danny_okafor_trivia", owner: "danny_okafor", source: "lore_anchor", sourceNames: { lore_anchor: "The Rusty Anchor" }, confidence: 0.8 });
    expect(p?.problems).toBeUndefined();
    expect(p?.value).toEqual({ id: "danny_okafor_trivia", label: "Trivia night", owner: "danny_okafor", blocks: [{ id: "trivia", label: "Trivia night", activity: "socialize", kind: "fixed", at: "19:00", minutes: 120, days: { weekdays: [4] }, place: { place: "rusty_anchor" }, source: { type: "lore", entry: "lore_anchor", quote: "a Thursday trivia night that gets competitive" } }] });
    // The call read Danny's sheet, his schedules and the places, and the lore about him.
    const [call] = rig.host.quietCalls;
    expect(call ? ownersOf(call) : []).toEqual(["danny_okafor"]);
    const text = call ? said(call) : "";
    expect(text).toContain("- employer: alder_automotive (Alder Automotive)");
    expect(text).toContain("schedule danny_okafor_activity_1 (activity): Mon, Tue, Wed, Thu, Fri: 07:00–12:00 working on cars");
    expect(text).toContain("(lore: lore_danny)");
    expect(text).toContain("rusty_anchor: The Rusty Anchor");
  });

  test("a schedule rests on a sheet field: its activity and place schedules come back together, each with the source, and apply to the draft", async () => {
    const { rig, worldId } = await portAlder();
    await put(rig, worldId, "entities", "nadia_brooks", stranger("nadia_brooks", "Nadia Brooks", { employer: "alder_market", description: "Works the register at Alder Market from nine to five, Tuesday to Saturday." }));
    const shift = { owner: "nadia_brooks", id: "register", label: "On the register", activity: "work at the register", place: "work", recurrence: { every: "week", weekdays: [2, 3, 4, 5, 6] }, start: "9:00", end: "17:00", source: { sheet: "nadia_brooks", field: "description", quote: "from nine to five, Tuesday to Saturday" }, confidence: 0.9 };
    rig.host.quietReply = answering({ nadia_brooks: [{ schedules: [shift] }] });
    const end = await proposed(rig, worldId, { owners: ["nadia_brooks"] });
    expect(end.proposals.map((p) => p.key)).toEqual(["nadia_brooks_register_activity", "nadia_brooks_register_place"]);
    const source = { type: "sheet", entity: "nadia_brooks", field: "description", quote: "from nine to five, Tuesday to Saturday" };
    expect(end.byKey.get("nadia_brooks_register_activity")).toMatchObject({ collection: "schedules", owner: "nadia_brooks", sourceNames: { "nadia_brooks.description": "Nadia Brooks · description" }, value: { owner: "nadia_brooks", target: "activity", recurrence: { every: "week", weekdays: [2, 3, 4, 5, 6] }, slots: [{ start: "09:00", end: "17:00", value: "work at the register" }], pack: "castlife", source } });
    expect(end.byKey.get("nadia_brooks_register_place")).toMatchObject({ value: { target: "place", slots: [{ start: "09:00", end: "17:00", value: "alder_market" }], source } });
    expect(end.byKey.get("nadia_brooks_register_place")?.note).toContain("goes with schedules.nadia_brooks_register_activity");
    for (const p of end.proposals) await put(rig, worldId, p.collection, p.key, p.value);
    const draft = await draftOf(rig, worldId);
    expect(draft.schedules.nadia_brooks_register_activity?.slots).toEqual([{ start: "09:00", end: "17:00", value: "work at the register" }]);
    expect(draft.schedules.nadia_brooks_register_place?.source).toEqual(source as never);
  });

  test("a missing place, someone who isn't in the world and company with no ground are asked about once, then come back unticked with their problems", async () => {
    const { rig, worldId } = await portAlder();
    await put(rig, worldId, "entities", "nadia_brooks", stranger("nadia_brooks", "Nadia Brooks"));
    const wrong = [
      dannys({ id: "trivia", label: "Trivia night", at: "19:00", days: { weekdays: [4] }, place: "trivia_barn" }),
      dannys({ id: "boating", label: "Boating", at: "08:00", days: { weekdays: [0] }, place: "alder_harbor_marina", company: { ids: ["nobody_here"] } }),
      dannys({ id: "walks", label: "A walk in the park", at: "16:00", days: { weekdays: [6] }, place: "lakefront_park", company: { ids: ["nadia_brooks"] }, source: { lore: "lore_danny", quote: "he knows every engine in town by its sound" } }),
    ];
    rig.host.quietReply = answering({ danny_okafor: [{ routines: wrong }] });
    const end = await proposed(rig, worldId, { owners: ["danny_okafor"] });
    expect(rig.host.quietCalls).toHaveLength(2);
    const repair = said(rig.host.quietCalls[1] as QuietRequest);
    expect(repair).toContain("Your answer had these problems:");
    // A place or person the world doesn't have is named as Build's lint names it (`routineIssues`).
    expect(repair).toContain('routines[0] (Danny Okafor, "Trivia night"): Routine danny_okafor_trivia, block trivia: there\'s no place trivia_barn; it happens at home.');
    expect(repair).toContain('routines[1] (Danny Okafor, "Boating"): Routine danny_okafor_boating, block boating: its company matches nobody as a chat starts.');
    expect(repair).toContain('routines[2] (Danny Okafor, "A walk in the park"): Nadia Brooks (nadia_brooks) in its company has no tie to Danny Okafor, and the cited text doesn\'t name them together');
    expect(end.status).toBe("done");
    expect(end.proposals.map((p) => p.key)).toEqual(["danny_okafor_trivia", "danny_okafor_boating", "danny_okafor_walks"]);
    expect(end.proposals.every((p) => (p.problems?.length ?? 0) > 0)).toBe(true);
    expect(end.byKey.get("danny_okafor_trivia")?.problems).toEqual(["Routine danny_okafor_trivia, block trivia: there's no place trivia_barn; it happens at home."]);
    expect(end.proposals.every((p) => p.confidence < 0.7)).toBe(true);
    expect(end.message).toContain("3 proposal(s) have problems to look at; they start unticked.");
  });

  test("an answer whose quote isn't in its entry is asked once more, listing it; the repaired answer stands, and what the first had right stays", async () => {
    const { rig, worldId } = await portAlder();
    const trivia = dannys({ id: "trivia", label: "Trivia night", at: "19:00", minutes: 120, days: { weekdays: [4] }, place: "rusty_anchor" });
    const misquoted = { ...trivia, source: { lore: "lore_anchor", quote: "a Thursday quiz night that never ends" } };
    const burger = dannys({ id: "burger_night", label: "Burger night", activity: "dinner", at: "19:00", days: { weekdays: [3] }, place: "rusty_anchor", source: { lore: "lore_anchor", quote: "The burger is excellent" } });
    rig.host.quietReply = answering({ danny_okafor: [{ routines: [misquoted, burger] }, { routines: [trivia] }] });
    const end = await proposed(rig, worldId, { owners: ["danny_okafor"] });
    expect(rig.host.quietCalls).toHaveLength(2);
    expect(said(rig.host.quietCalls[1] as QuietRequest)).toContain('routines[0] (Danny Okafor, "Trivia night"): its quote isn\'t in lore_anchor: copy it word for word');
    expect(end.proposals.map((p) => [p.key, p.problems])).toEqual([
      ["danny_okafor_trivia", undefined],
      ["danny_okafor_burger_night", undefined],
    ]);
    expect(end.message).toBe("");
  });

  test("clashes are pointed out, never overridden: an authored schedule, a routine block already there, another proposal and where the story starts them; a repeat of the world is dropped", async () => {
    const { rig, worldId } = await portAlder();
    const gym = { id: "danny_gym", owner: "danny_okafor", blocks: [{ id: "gym", label: "Gym", activity: "training", kind: "fixed", at: "18:00", minutes: 60, days: { weekdays: [2] }, place: { place: "lakefront_park" } }] };
    await put(rig, worldId, "routines", "danny_gym", gym);
    rig.host.quietReply = answering({
      danny_okafor: [
        {
          routines: [
            // Monday morning at the clinic, while his schedules have him at the shop.
            dannys({ id: "checkup", label: "Checkup", activity: "checkup", at: "09:00", days: { weekdays: [1] }, place: "community_clinic" }),
            // Tuesday evening, over the gym block his routine already has.
            dannys({ id: "running", label: "Running", activity: "exercise", at: "18:30", days: { weekdays: [2] }, place: "dune_trails" }),
            // Thursday's trivia, and a game of chess an hour into it.
            dannys({ id: "trivia", label: "Trivia night", at: "19:00", minutes: 120, days: { weekdays: [4] }, place: "rusty_anchor" }),
            dannys({ id: "chess", label: "Chess", activity: "chess", at: "20:00", days: { weekdays: [4] }, place: "township_hall" }),
            // Monday at six, out at the market when the story starts at a quarter past in 114 Harbor Street.
            dannys({ id: "shopping", label: "Early shopping", activity: "shopping", at: "06:00", days: { weekdays: [1] }, place: "alder_market" }),
            // Friday evening at the Anchor: his schedules already have him there.
            dannys({ id: "drinks", label: "Drinks", activity: "socialize", at: "17:30", minutes: 240, days: { weekdays: [5] }, place: "rusty_anchor" }),
          ],
        },
      ],
    });
    const end = await proposed(rig, worldId, { owners: ["danny_okafor"] });
    // Clashes are the world's, not the helper's to fix: no repair call.
    expect(rig.host.quietCalls).toHaveLength(1);
    expect(end.byKey.get("danny_okafor_checkup")?.problems).toEqual(["it clashes with the schedule danny_okafor_activity_1", "it clashes with the schedule danny_okafor_place_1"]);
    expect(end.byKey.get("danny_okafor_running")?.problems).toEqual(["it clashes with the block gym of the routine danny_gym"]);
    expect(end.byKey.get("danny_okafor_trivia")?.problems).toBeUndefined();
    expect(end.byKey.get("danny_okafor_chess")?.problems).toEqual(["it clashes with the proposed block trivia"]);
    expect(end.byKey.get("danny_okafor_shopping")?.problems).toEqual(["it would take Danny Okafor from 114 Harbor Street as the story starts"]);
    expect(end.byKey.has("danny_okafor_drinks")).toBe(false);
    expect(end.message).toContain("1 repeated what the world already has");
    // The routine already there is untouched: no proposal writes it.
    expect(end.proposals.some((p) => p.key === "danny_gym")).toBe(false);
    expect((await draftOf(rig, worldId)).routines?.danny_gym).toEqual(gym as never);
  });

  test("a large world is read a few to a call within Import's calls, and a second pass continues where the first stopped", async () => {
    const { rig, worldId } = await portAlder();
    for (let i = 0; i < 40; i++) await put(rig, worldId, "entities", `walker_${String(i).padStart(2, "0")}`, stranger(`walker_${String(i).padStart(2, "0")}`, `Walker ${i}`, { description: "Walks the pier every morning." }));
    rig.host.quietReply = () => JSON.stringify({ routines: [], schedules: [] });
    const first = await proposed(rig, worldId);
    // A call starts only while its repair still has one of the pass's calls.
    expect(rig.host.quietCalls.length).toBe(ROUTINE_MAX_CALLS - 1);
    const read = rig.host.quietCalls.flatMap(ownersOf);
    expect(read).toHaveLength((ROUTINE_MAX_CALLS - 1) * ROUTINE_OWNERS_PER_CALL);
    expect(first.next).toEqual({ after: read.at(-1) ?? "" });
    expect(first.message).toContain("weren't read in this pass's 12 calls; continue for the rest.");
    rig.host.quietCalls.length = 0;
    const second = await proposed(rig, worldId, first.next ?? {});
    const rest = rig.host.quietCalls.flatMap(ownersOf);
    expect(rest.every((id) => id > (read.at(-1) ?? ""))).toBe(true);
    expect([...read, ...rest]).toEqual([...new Set([...read, ...rest])].sort());
    expect(second.next).toBeUndefined();
    expect(second.status).toBe("done");
  });

  test("Cancel stops the job; a call that runs out of time isn't asked again, and a pass with no answer says why", async () => {
    const { rig, worldId } = await portAlder();
    let calls = 0;
    rig.host.models.quiet = (_request, _userId, signal) => {
      calls++;
      const { promise, reject } = Promise.withResolvers<never>();
      signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true });
      return promise;
    };
    // A runner of its own, with no deadline on its calls: the rig's would hold every request until the job ended.
    const open = new JobRunner(rig.host, rig.rt.worlds, rig.rt.steps, rig.rt.settings, rig.rt.registry, () => null);
    const jobId = await open.start("propose_routines", worldId, { owners: ["danny_okafor", "helen_kowalczyk"] }, rig.host.userId);
    for (let i = 0; i < 1000 && calls === 0; i++) await Promise.resolve();
    expect(calls).toBe(1);
    await open.cancel(jobId, rig.host.userId);
    await open.idle();
    expect(rig.host.sent.findLast((m) => m.type === "lre.job.update" && m.jobId === jobId)).toMatchObject({ status: "cancelled" });
    expect(calls).toBe(1);

    // Its own deadline (Settings → Timeouts) ends a call, which isn't asked again; the job fails, saying why, when no call answered.
    const deadline = new AbortController();
    const jobs = new JobRunner(rig.host, rig.rt.worlds, rig.rt.steps, rig.rt.settings, rig.rt.registry, () => deadline.signal);
    calls = 0;
    const timed = await jobs.start("propose_routines", worldId, { owners: ["danny_okafor"] }, rig.host.userId);
    for (let i = 0; i < 1000 && calls === 0; i++) await Promise.resolve();
    expect(calls).toBe(1);
    deadline.abort(new TimeoutFired("jobCallMs", 600_000));
    await jobs.idle();
    expect(calls).toBe(1);
    const failed = rig.host.sent.findLast((m) => m.type === "lre.job.update" && m.jobId === timed);
    expect(failed).toMatchObject({ status: "failed" });
    expect(failed?.type === "lre.job.update" ? failed.message : "").toBe("no call answered: Import and Refine calls ran out after 10 min (Settings → Timeouts → Import and Refine calls)");
  });

  test("applied and committed, a proposed block is laid by the planner on its day, at its time and place, with its lore source in the GM's read of the day", async () => {
    const { rig, worldId } = await portAlder();
    rig.host.quietReply = answering({ danny_okafor: [{ routines: [dannys({ id: "trivia", label: "Trivia night", activity: "socialize", at: "19:00", minutes: 120, days: { weekdays: [4] }, place: "rusty_anchor" })] }] });
    const end = await proposed(rig, worldId, { owners: ["danny_okafor"] });
    for (const p of end.proposals) await put(rig, worldId, p.collection, p.key, p.value);
    const applied = (await draftOf(rig, worldId)).routines?.danny_okafor_trivia;
    expect(applied).toEqual(end.proposals[0]?.value as never);
    expect(routineShapeProblems(applied)).toEqual([]);
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const dayOf = async (day: number): Promise<RoutineGmView> => rig.body(await rig.send({ type: "lre.routine", chatId, op: "day", entity: "danny_okafor", view: "gm", day })).gm as RoutineGmView;
    const trivia = (view: RoutineGmView) => view.day.blocks.find((b) => b.origin.type === "routine" && b.origin.block === "trivia");
    // The story starts on a Monday, day 0: Thursday is day 3, and the block is laid there, from its routine, resting on the entry it quotes.
    const thursday = await dayOf(3);
    expect(trivia(thursday)).toMatchObject({ from: "19:00", to: "21:00", label: "Trivia night", activity: "socialize", place: "rusty_anchor", origin: { type: "routine", block: "trivia", source: { type: "lore", entry: "lore_anchor", quote: "a Thursday trivia night that gets competitive" } } });
    // Wednesday has no trivia night.
    expect(trivia(await dayOf(2))).toBeUndefined();
  });

  test("the job reads only what may reach the player: no secret lore, entry waiting for review, unknown known_by entry, secret person or secret field; a proposal carrying a secret's words is dropped", async () => {
    const { rig, worldId } = await portAlder();
    await put(rig, worldId, "lore", "lore_danny_nights", { id: "lore_danny_nights", title: "Danny's Wednesdays", content: "Danny meets the smugglers at the boathouse. It happens every Wednesday at midnight.", keys: ["Danny"], links: ["danny_okafor"], secret: true, gate: "false" });
    await put(rig, worldId, "lore", "lore_danny_jog", { id: "lore_danny_jog", title: "Danny's runs", content: "Danny jogs along the dunes at six.", keys: ["Danny"], links: ["danny_okafor"], source: { kind: "ai", status: "pending" } });
    await put(rig, worldId, "entities", "vera_lind", stranger("vera_lind", "Vera Lind"));
    await put(rig, worldId, "lore", "lore_vera", { id: "lore_vera", title: "Vera Lind", content: "Vera swims out past the breakwater at dawn.", keys: ["Danny"], links: ["danny_okafor", "vera_lind"], visibility: "known_by" });
    await put(rig, worldId, "entities", "ivy_ghost", { id: "ivy_ghost", kind: "character", name: "Ivy Marsh", tier: "background", fields: { home: "port_alder" }, relations: [{ type: "regard", to: "danny_okafor" }], visibility: "secret" });
    const draft = await draftOf(rig, worldId);
    const character = draft.kinds.character;
    if (!character) throw new Error("no character kind");
    await put(rig, worldId, "kinds", "character", { ...character, fields: { ...character.fields, sideline: { type: "text", label: "Sideline", visibility: "secret" } } } as unknown as JsonValue);
    const danny = draft.entities.danny_okafor;
    if (!danny) throw new Error("no Danny");
    await put(rig, worldId, "entities", "danny_okafor", { ...danny, fields: { ...danny.fields, sideline: "Moves crates for a man in Benton Harbor" } } as unknown as JsonValue);
    rig.host.quietReply = answering({
      danny_okafor: [
        {
          routines: [
            dannys({ id: "wednesdays", label: "Out late", at: "23:30", days: { weekdays: [3] }, place: "alder_harbor_marina", source: { lore: "lore_danny_nights", quote: "every Wednesday at midnight" } }),
            dannys({ id: "late", label: "It happens every Wednesday at midnight", at: "23:30", days: { weekdays: [3] }, place: "alder_harbor_marina" }),
            dannys({ id: "with_ivy", label: "Coffee", activity: "coffee", at: "08:00", days: { weekdays: [0] }, place: "bluebird_coffee", company: { ids: ["ivy_ghost"] }, source: { lore: "lore_bluebird", quote: "Half the town's business is conducted at its mismatched tables" } }),
          ],
        },
      ],
    });
    const end = await proposed(rig, worldId, { owners: ["danny_okafor", "ivy_ghost"] });
    // What the job gave the helper (a repair call repeats only the helper's own answer back to it).
    const text = said(rig.host.quietCalls[0] as QuietRequest);
    for (const hidden of ["smugglers", "every Wednesday at midnight", "jogs along the dunes", "swims out past the breakwater", "Ivy Marsh", "ivy_ghost", "sideline", "Benton Harbor"]) expect(text).not.toContain(hidden);
    // Neither the secret entry nor the secret's words reach a proposal; the secret person is no one's company.
    expect(end.proposals.map((p) => p.key)).toEqual(["danny_okafor_with_ivy"]);
    expect(end.proposals[0]?.problems).toEqual(['its company "ivy_ghost" isn\'t a person in the world']);
    expect(end.message).toContain("named weren't read: they aren't people or groups the job may read (ivy_ghost)");
    expect(end.message).toContain("1 cited nothing they rest on");
    expect(end.message).toContain("1 carried a secret's words");
  });

  test("a label names no one but its owner; dedupe keeps the most confident of the same item; a meal's id replaces it only on every day", async () => {
    const { rig, worldId } = await portAlder();
    const anchor = { lore: "lore_anchor", quote: "The burger is excellent" };
    rig.host.quietReply = answering({
      danny_okafor: [
        {
          routines: [
            dannys({ id: "drinks", label: "Drinks with Marcus", activity: "socialize", at: "20:00", days: { weekdays: [3] }, place: "rusty_anchor", company: { ids: ["marcus_delgado"] } }),
            dannys({ id: "burger", label: "Burger at the Anchor", activity: "dinner", at: "18:00", days: { weekdays: [2] }, place: "rusty_anchor", source: anchor, confidence: 0.6 }),
            dannys({ id: "burger", label: "Burger at the Anchor", activity: "dinner", at: "18:00", days: { weekdays: [2] }, place: "rusty_anchor", source: anchor, confidence: 0.75 }),
            dannys({ id: "dinner", label: "Sunday dinner out", activity: "dinner", at: "18:00", days: { weekdays: [0] }, place: "rusty_anchor", source: anchor }),
            { owner: "danny_okafor", id: "dinner", label: "Dinner at the Anchor", activity: "dinner", kind: "flexible", window: { from: "17:30", to: "20:00" }, minutes: 45, place: "rusty_anchor", source: anchor, confidence: 0.7 },
          ],
        },
      ],
    });
    const end = await proposed(rig, worldId, { owners: ["danny_okafor"] });
    expect(end.byKey.get("danny_okafor_drinks")?.problems).toEqual(['its label "Drinks with Marcus" names someone: the player reads labels, so say who in its company']);
    expect(end.proposals.filter((p) => p.key.startsWith("danny_okafor_burger")).map((p) => p.confidence)).toEqual([0.75]);
    expect(end.message).toContain("1 repeated another proposal");
    const blockIds = end.proposals.flatMap((p) => (isRecord(p.value) && Array.isArray(p.value.blocks) ? p.value.blocks.flatMap((b) => (isRecord(b) && typeof b.id === "string" ? [b.id] : [])) : []));
    // Sunday's dinner takes its own id; the every-day one replaces the usual dinner.
    expect(blockIds).toContain("sunday_dinner_out");
    expect(blockIds).toContain("dinner");
  });

  test("each person's lore goes in whole: every entry about them that fits the allowance, none cut", async () => {
    const { rig, worldId } = await portAlder();
    await withLongLore(rig, worldId, "nadia_brooks", "Nadia Brooks", 9);
    rig.host.quietReply = () => JSON.stringify({ routines: [], schedules: [] });
    const end = await proposed(rig, worldId, { owners: ["nadia_brooks"] });
    expect(end.status).toBe("done");
    const text = said(rig.host.quietCalls[0] as QuietRequest);
    for (let i = 0; i < 9; i++) {
      expect(text).toContain(`(lore: lore_nadia_brooks_${i})`);
      expect(text).toContain(`Marker ${i} closes this entry.`);
    }
    expect(end.message).not.toContain("left out");
  });

  test("a lower allowance leaves whole entries out, never part of one, and says whose and where to raise it", async () => {
    const { rig, worldId } = await portAlder();
    await withLongLore(rig, worldId, "nadia_brooks", "Nadia Brooks", 9);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { jobs: { routineLoreTokens: 1500 } } }));
    rig.host.quietReply = () => JSON.stringify({ routines: [], schedules: [] });
    const end = await proposed(rig, worldId, { owners: ["nadia_brooks"] });
    const text = said(rig.host.quietCalls[0] as QuietRequest);
    expect([...text.matchAll(/\(lore: lore_nadia_brooks_\d\)/g)].map((m) => m[0])).toEqual(["(lore: lore_nadia_brooks_0)", "(lore: lore_nadia_brooks_1)"]);
    expect(text).toContain("Marker 0 closes this entry.");
    expect(text).toContain("Marker 1 closes this entry.");
    expect(end.message).toContain('Lore past 1,500 tokens each was left out for Nadia Brooks (2 of 9 entries): raise "Lore each person or group reads" in Settings → Steps and connections → Build jobs, or turn on "all of it".');
  });

  test("people whose lore fills the allowance have calls of their own; with all of it they share one", async () => {
    const { rig, worldId } = await portAlder();
    await withLongLore(rig, worldId, "nadia_brooks", "Nadia Brooks", 3);
    await withLongLore(rig, worldId, "omar_reyes", "Omar Reyes", 3);
    rig.host.quietReply = () => JSON.stringify({ routines: [], schedules: [] });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { jobs: { routineLoreTokens: 2000 } } }));
    await proposed(rig, worldId, { owners: ["nadia_brooks", "omar_reyes"] });
    expect(rig.host.quietCalls.map(ownersOf)).toEqual([["nadia_brooks"], ["omar_reyes"]]);
    rig.host.quietCalls.length = 0;
    rig.body(await rig.send({ type: "lre.settings.set", patch: { jobs: { routineLoreTokens: "none" } } }));
    const end = await proposed(rig, worldId, { owners: ["nadia_brooks", "omar_reyes"] });
    expect(rig.host.quietCalls.map(ownersOf)).toEqual([["nadia_brooks", "omar_reyes"]]);
    const text = said(rig.host.quietCalls[0] as QuietRequest);
    for (const id of ["nadia_brooks", "omar_reyes"]) for (let i = 0; i < 3; i++) expect(text).toContain(`(lore: lore_${id}_${i})`);
    expect(end.message).not.toContain("left out");
  });

  test("a world with no one to read fails and says why", async () => {
    const rig = new Rig({ shipped: true });
    const created = rig.body(await rig.send({ type: "lre.world", op: "create", name: "Nobody" }));
    const id = isRecord(created.world) && typeof created.world.id === "string" ? created.world.id : "";
    const end = await proposed(rig, id);
    expect(end.status).toBe("failed");
    expect(end.message).toBe("the world has no people or groups the job may read; secret ones and the player character aren't proposed for");
  });
});

// What the reply told, recorded after it (`story_record`): the changes a reply's read records on
// the classic and agents engines, each through its own channel and under its own type's mode; and
// the two moves of the game master's that had no tool, a thing put away (`item_away`) and something
// taken out of what holds it (`gm_take_out`). What a rule about tiers, modes or a job says is played
// through the bridge's own turn; what a call may be given is read on a stand-in turn, whose staging
// only keeps what the engine's channels made.

import { describe, expect, test } from "bun:test";
import { renderPrompt } from "../../src/backend/prompts";
import { TOOL_NOTE, toolArgTextId } from "../../src/shared/agent-tools";
import { WRITE_NOTE } from "../../src/shared/agent-tools-write";
import { HARNESS_AGENT, HARNESS_NOTE } from "../../src/shared/harness-texts";
import { STORY_NOTE, STORY_TOOL, STORY_TYPES, type StoryType } from "../../src/shared/harness-texts-story";
import type { JsonObject } from "../../src/shared/json";
import type { WorldDoc } from "../../src/shared/world";
import { blankWorld, migrateWorld } from "../../src/engine/authoring";
import { lifeOf } from "../../src/engine/life";
import { placeOfEntity } from "../../src/engine/scope";
import { decodeMapView } from "../../src/packs/space/ui/view";
import { modernUsWorld } from "../packs/riverton";
import { Rig } from "../support/rig";
import { HOME, POV } from "../support/tools";
import { answer, applied, call, castChat, castEnv, castTurn, guardModel, ILSE, JOSS, landingWriter, MARA, noModelCalls, OKORO, refusal, turnChat } from "./harness-cast-kit";
import { type Agent, AUTHOR, beginJob, beginTurn, mount, playOn, type Run, recordOn, stateOf } from "./harness-driver";

const RECORD = STORY_TOOL.record;

const GM: Agent = { id: "gm-1", role: HARNESS_AGENT.gm };
const OWN: Agent = { id: "helper-1", role: "a_definition_of_the_users" };
const CHRONICLER: Agent = { id: "job-chronicler", role: HARNESS_AGENT.chronicler };

/** The garage across town, and the business that runs it. */
const GARAGE = "alder_automotive";
const SHOP = "Alder Automotive";

const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);
/** One change as a call writes it: its kind's argument, as JSON text. */
const change = (type: StoryType, fact: JsonObject): JsonObject => ({ [type]: JSON.stringify(fact) });

/** A turn played to its end with `reply`, and a job started after it: the chronicler's work. */
async function told(rig: Rig, chatId: string, reply: string): Promise<{ job: Run; replyId: string }> {
  const turn = await beginTurn(rig, chatId, "I ask Mara how the morning went.");
  // A job is held to whoever started it, so the author is heard from first.
  await turn.answer(AUTHOR, "time_clock");
  await turn.finish(reply);
  const job = await beginJob(rig, turn, "job-after");
  const head = rig.host.head(chatId);
  if (!head) throw new Error("no reply");
  return { job, replyId: head.id };
}

describe("what the reply told, recorded in a job after it", () => {
  test("a move, an injury, a payment and a death are recorded, each as its own type's change on the reply's record", async () => {
    const { rig, chatId } = await turnChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { transfer: { mode: "auto" }, life: { mode: "auto" } } } }));
    const { job, replyId } = await told(rig, chatId, "Joss heads off to the garage. Mara has cut her hand on a tin, so I press a twenty on her for plasters. The radio says old Ilse died in the night.");
    const before = await stateOf(rig, chatId);
    const recorded = (type: StoryType) => ({ staged: { changeType: type, lands: note(HARNESS_NOTE.recorded) } });
    expect(await job.answer(CHRONICLER, RECORD, change("location", { entity: "Joss", place: GARAGE }))).toMatchObject(recorded("location"));
    expect(await job.answer(CHRONICLER, RECORD, change("condition", { who: "Mara", condition: "injured" }))).toMatchObject(recorded("condition"));
    expect(await job.answer(CHRONICLER, RECORD, change("transfer", { from: POV, to: "Mara", amount: 20, method: "cash" }))).toMatchObject(recorded("transfer"));
    expect(await job.answer(CHRONICLER, RECORD, change("life", { entity: "Ilse", state: "dead" }))).toMatchObject(recorded("life"));
    const after = await stateOf(rig, chatId);
    expect({ joss: placeOfEntity(before, JOSS), ilse: lifeOf(before, ILSE) }).toEqual({ joss: HOME, ilse: "alive" });
    expect({ joss: placeOfEntity(after, JOSS), ilse: lifeOf(after, ILSE) }).toEqual({ joss: GARAGE, ilse: "dead" });
    expect(after.entities[MARA]?.fields.conditions).toMatchObject([{ id: "injured" }]);
    // The twenty left the player character's wallet, in minor units: an amount is written as the reply has it.
    expect((before.accounts.acct_pov_cash ?? 0) - (after.accounts.acct_pov_cash ?? 0)).toBe(2000);
    // Each is the reply's own, under the role that recorded it.
    expect((await recordOn(rig, chatId, replyId))?.post.map((p) => [p.kind, p.agent?.role])).toEqual([["confirm", "curator"], ["confirm", "curator"], ["confirm", "curator"], ["confirm", "curator"]]);
    noModelCalls(rig);
  });

  test("a type set to Never is refused, and one set to Confirm waits on the reply's review card, where Apply records it", async () => {
    const { rig, chatId } = await turnChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { location: { mode: "never" } } } }));
    const { job, replyId } = await told(rig, chatId, "Joss heads off to the garage. The radio says old Ilse died in the night.");
    expect(JSON.parse(await job.refusal(CHRONICLER, RECORD, change("location", { entity: "Joss", place: GARAGE })))).toMatchObject({ refused: { code: "mode_never", reason: note(WRITE_NOTE.never, { type: "location" }) } });
    expect(placeOfEntity(await stateOf(rig, chatId), JOSS)).toBe(HOME);
    // A death asks first as shipped: it is the player's to apply.
    expect(await job.answer(CHRONICLER, RECORD, change("life", { entity: "Ilse", state: "dead" }))).toMatchObject({ staged: { changeType: "life", lands: note(WRITE_NOTE.stagedReview) } });
    expect(lifeOf(await stateOf(rig, chatId), ILSE)).toBe("alive");
    const cards = rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards as { turn: string; placement: string; items: { status: string; source: string }[] }[];
    expect(cards.map((c) => ({ turn: c.turn, placement: c.placement, items: c.items.map((i) => [i.source, i.status]) }))).toEqual([{ turn: `${replyId}:0`, placement: "chips", items: [["read", "open"]] }]);
    rig.body(await rig.send({ type: "lre.review", chatId, op: "apply", turn: `${replyId}:0` }));
    expect(lifeOf(await stateOf(rig, chatId), ILSE)).toBe("dead");
    noModelCalls(rig);
  });

  test("only once the reply is written, and only by an agent at the story's tier", async () => {
    const { rig, chatId } = await turnChat();
    const move = change("location", { entity: "Joss", place: GARAGE });
    const turn = await beginTurn(rig, chatId, "I ask Mara how the morning went.");
    await turn.answer(AUTHOR, "time_clock");
    // Before the reply there is nothing it told: the author, who holds every tier, is told to record after it.
    expect(await turn.refusal(AUTHOR, RECORD, move)).toBe(note(STORY_NOTE.afterReply));
    await turn.finish("Joss heads off to the garage.");
    const job = await beginJob(rig, turn, "job-after");
    for (const agent of [GM, OWN]) expect({ agent: agent.role, refused: (await job.call(agent, RECORD, move)).error === true }).toEqual({ agent: agent.role, refused: true });
    expect(placeOfEntity(await stateOf(rig, chatId), JOSS)).toBe(HOME);
    noModelCalls(rig);
  });
});

/** What the stand-in turns below answer: a reply that names Mara and Joss and says what the facts quote. */
const REPLY = "Joss heads off to the garage. Mara took the job at Alder Automotive this morning, and she swims before work now, every weekday at half past six.";

/** A stand-in turn after its reply, as an agent of `tier` finds it. */
async function after(rig: Rig, chatId: string, tier: "read" | "story" = "story") {
  const turn = await castTurn(rig, chatId, { main: false, tier, reply: { messageId: "reply-1", text: REPLY } });
  return { turn, env: castEnv(rig, chatId, turn, HARNESS_AGENT.chronicler) };
}

describe("what a call of story_record may be given", () => {
  test("the tool holds its caller to the story's tier by itself, for a noted change and for time alike", async () => {
    const { rig, chatId } = await castChat();
    const { turn, env } = await after(rig, chatId, "read");
    expect(await refusal(env, RECORD, change("location", { entity: "Joss", place: GARAGE }))).toBe(note(WRITE_NOTE.noWriter));
    expect(await refusal(env, RECORD, change("time_advance", { minutes: 30 }))).toBe(note(WRITE_NOTE.noWriter));
    expect(turn.changes).toEqual([]);
    noModelCalls(rig);
  });

  test("one change a call, written as its kind's own fields, each name read as the id it names", async () => {
    const { rig, chatId } = await castChat();
    const { turn, env } = await after(rig, chatId);
    const types = STORY_TYPES.join(", ");
    expect(await refusal(env, RECORD, {})).toBe(note(STORY_NOTE.oneChange, { types, count: "0" }));
    expect(await refusal(env, RECORD, { ...change("location", { entity: "Joss", place: GARAGE }), ...change("life", { entity: "Ilse", state: "dead" }) })).toBe(note(STORY_NOTE.oneChange, { types, count: "2" }));
    // Words where the fields belong, and a field its kind doesn't take: nothing a call adds reaches the channel.
    expect(await refusal(env, RECORD, { location: "Joss went to the garage" })).toBe(note(STORY_NOTE.badFact, { type: "location", shape: note(toolArgTextId(RECORD, "location")) }));
    expect(await refusal(env, RECORD, change("routine", { entity: "Mara", change: "start", label: "Morning swim", days: "weekdays", by: "player" }))).toContain(note(STORY_NOTE.noField, { type: "routine", field: "by", fields: "entity, change, label, days, start, end, minutes, activity, place, with, replaces" }));
    expect(await refusal(env, RECORD, change("condition", { who: "Brann", condition: "tired" }))).toBe(note(TOOL_NOTE.noPerson, { name: "Brann" }));
    expect(turn.changes).toEqual([]);
    await answer(env, RECORD, change("location", { entity: "Joss", place: GARAGE }));
    expect(turn.changes.map((c) => c.proposal)).toEqual([{ type: "location", entity: JOSS, place: GARAGE }]);
    noModelCalls(rig);
  });

  test("a change is held to the reply where a reply's read is: an organization's quotes it, a week's is for someone it names, and an offer is the player's to take up", async () => {
    const { rig, chatId } = await castChat();
    const { turn, env } = await after(rig, chatId);
    const hired = { who: "Mara", change: "hired", org: SHOP };
    expect(await refusal(env, RECORD, change("employment", { ...hired, said: "Mara was taken on at the garage" }))).toBe(note(STORY_NOTE.notQuoted));
    expect(await refusal(env, RECORD, change("routine", { entity: "Ilse", change: "start", label: "Morning swim", days: "weekdays", start: "06:30", activity: "exercise" }))).toBe(note(STORY_NOTE.notNamed, { name: "Ilse" }));
    expect(await refusal(env, RECORD, change("agenda", { who: "Joss", offer: "fetch the plasters", said: "Joss heads off to the garage" }))).toBe(note(STORY_NOTE.offer));
    expect(turn.changes).toEqual([]);
    await answer(env, RECORD, change("employment", { ...hired, said: "Mara took the job at Alder Automotive this morning" }));
    await answer(env, RECORD, change("routine", { entity: "Mara", change: "start", label: "Morning swim", days: "weekdays", start: "06:30", activity: "exercise" }));
    // A week's change carries the reply's own message as its turn, which no call sets.
    expect(turn.changes.map((c) => [c.changeType, c.proposal?.turn ?? null])).toEqual([["employment", null], ["routine", "reply-1"]]);
    noModelCalls(rig);
  });

  test("a step is cut to the largest the player allows, and none is no change", async () => {
    const { rig, chatId } = await castChat();
    const warmer = change("regard", { from: "Mara", to: POV, delta: 10 });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { regard: { mode: "auto", maxDelta: 2 } } } }));
    const cut = await after(rig, chatId);
    await answer(cut.env, RECORD, warmer);
    expect(cut.turn.changes.map((c) => c.proposal)).toEqual([{ type: "regard", from: MARA, to: POV, delta: 2 }]);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { regard: { mode: "auto", maxDelta: 0 } } } }));
    const none = await after(rig, chatId);
    expect(await refusal(none.env, RECORD, warmer)).toBe(note(STORY_NOTE.noStep, { type: "regard" }));
    expect(none.turn.changes).toEqual([]);
    noModelCalls(rig);
  });

  test("time the telling added passes as the turn's own time does, and no farther than a reply may pass without asking", async () => {
    const { rig, chatId } = await castChat();
    const { turn, env } = await after(rig, chatId);
    const most = Math.min(turn.settings.time.askBeyondMinutes, turn.settings.agents.harnessLimits.timePassMinutes);
    expect(await refusal(env, RECORD, change("time_advance", { minutes: most + 1 }))).toBe(note(STORY_NOTE.timeAsk, { minutes: String(most) }));
    for (const minutes of [0, -5, "a while"]) expect(await refusal(env, RECORD, change("time_advance", { minutes }))).toBe(note(STORY_NOTE.timeMinutes));
    expect(turn.changes).toEqual([]);
    expect(await answer(env, RECORD, change("time_advance", { minutes: 30 }))).toMatchObject({ staged: { changeType: "time_advance" } });
    expect(turn.changes.map((c) => ({ type: c.changeType, time: c.time, proposal: c.proposal }))).toEqual([{ type: "time_advance", time: 30, proposal: { type: "time_advance", minutes: 30 } }]);
    const { state, before } = await applied(rig, chatId, turn.changes[0]?.events ?? []);
    expect(state.clock - before.clock).toBe(30);
    noModelCalls(rig);
  });

  test("every kind of change reaches its own channel: staged as what the channel makes of it, or refused in the channel's own words", async () => {
    const { rig, chatId } = await castChat();
    // A stack for a count to change: a box of twelve nails, made as the story's own tool makes a thing.
    await answer(castEnv(rig, chatId, await castTurn(rig, chatId), HARNESS_AGENT.author, landingWriter(rig, chatId)), "item_make", { name: "box of nails", at: HOME, qty: 12, why: "It stands on the sill." });
    const quoted = "Mara took the job at Alder Automotive this morning";
    const asked: Readonly<Record<StoryType, JsonObject>> = {
      location: { entity: "Joss", place: GARAGE },
      condition: { who: "Mara", condition: "tired", minutes: 90 },
      regard: { from: "Mara", to: POV, delta: 3 },
      transfer: { from: POV, to: "Mara", amount: 20 },
      quantity: { item: "box of nails", delta: -2 },
      life: { entity: "Ilse", state: "dying" },
      knows: { fact: OKORO },
      routine: { entity: "Mara", change: "start", label: "Morning swim", days: "weekdays", start: "06:30", activity: "exercise" },
      membership: { who: "Mara", org: SHOP, change: "join", said: quoted },
      employment: { who: "Mara", change: "hired", org: SHOP, said: quoted },
      // No plan, motion or request stands in this chat: each is answered by its own channel, which found none.
      agenda: { id: "no_such_item", status: "done", said: quoted },
      vote: { who: "Mara", org: SHOP, motion: "no_such_motion", vote: "for", said: quoted },
      approval: { who: "Mara", org: SHOP, request: "no_such_request", answer: "approve", said: quoted },
      time_advance: { minutes: 15 },
    };
    const made: Record<string, string | null> = {};
    for (const type of STORY_TYPES) {
      const { turn, env } = await after(rig, chatId);
      const out = await call(env, RECORD, change(type, asked[type]));
      const [staged] = turn.changes;
      // What a channel made holds on the chat's head, event by event.
      if (staged) await applied(rig, chatId, staged.events);
      made[type] = staged ? staged.changeType : (JSON.parse(out.text) as { refused: { code: string } }).refused.code;
    }
    expect(made).toEqual({ location: "location", condition: "condition", regard: "regard", transfer: "transfer", quantity: "quantity", life: "life", knows: "knows", routine: "routine", membership: "membership", employment: "employment", agenda: "not_found", vote: "missing_motion", approval: "missing_request", time_advance: "time_advance" });
    noModelCalls(rig);
  });
});

describe("a thing put away, and something taken out of what holds it", () => {
  test("in a turn the author takes a thing out of someone's hands and puts it back where it is kept, each landing with its commit", async () => {
    const { rig, chatId } = await turnChat();
    const turn = await beginTurn(rig, chatId, "I ask Mara where the tin whistle went.");
    await turn.answer(AUTHOR, "time_clock");
    /** Where the whistle is: the place it lies at, and who or what holds it. */
    const whistle = async (): Promise<{ place: string | null; held: string | null }> => {
      const state = await stateOf(rig, chatId);
      const [id, thing] = Object.entries(state.entities).find(([, e]) => e.name === "tin whistle") ?? [];
      return { place: id === undefined ? null : placeOfEntity(state, id), held: thing?.relations.find((r) => r.type === "in")?.to ?? null };
    };
    // Made at the garage, so that is where it is kept; then Mara pockets it at home.
    await turn.answer(AUTHOR, "item_make", { name: "tin whistle", at: GARAGE, why: "It hangs by the garage door." });
    await turn.answer(AUTHOR, "item_move", { item: "tin whistle", in: "Mara", why: "Mara pockets it." });
    await turn.answer(AUTHOR, "commit");
    await turn.finish("Mara turns out her pockets.");
    expect(await whistle()).toEqual({ place: HOME, held: MARA });
    const next = await beginTurn(rig, chatId, "I hold out my hand for it.");
    await next.answer(AUTHOR, "time_clock");
    // Taken out, it lies where she stands.
    await next.answer(AUTHOR, STORY_TOOL.takeOut, { entity: "tin whistle" });
    expect(await next.answer(AUTHOR, "commit")).toMatchObject({ committed: { refused: [], review: [] } });
    // Nothing holds it now, and the engine says so.
    expect(JSON.parse(await next.refusal(AUTHOR, STORY_TOOL.takeOut, { entity: "tin whistle" }))).toMatchObject({ refused: { code: "not_inside" } });
    // Put away, it is back where it is kept; there already, there is nothing to move.
    expect(await next.answer(AUTHOR, STORY_TOOL.away, { item: "tin whistle", why: "Back on its hook." })).toMatchObject({ staged: { changeType: "item_move" } });
    expect(await next.answer(AUTHOR, "commit")).toMatchObject({ committed: { refused: [], review: [] } });
    expect(await next.refusal(AUTHOR, STORY_TOOL.away, { item: "tin whistle", why: "Back on its hook." })).toBe(note(STORY_NOTE.awayNowhere, { name: "tin whistle" }));
    await next.finish("It goes back on its hook.");
    expect(await whistle()).toEqual({ place: GARAGE, held: null });
    noModelCalls(rig);
  });
});

/** A small inn with the grid system on: a taproom the player character starts in, a kitchen through a door, and walls no one walks. */
function inn(): WorldDoc {
  const w = blankWorld("w_inn", "Inn");
  // A chat runs only the packs its world turns on: Riverton's, the space pack among them.
  w.packs = structuredClone(modernUsWorld("w", "R").packs);
  w.mapSettings = { display: "fog", grid: { movement: true, sightRadius: 2 } };
  w.places = { town: { id: "town", name: "Saltmarsh", fields: {} }, inn: { id: "inn", name: "The Gull", parent: "town", fields: {} } };
  w.maps = { inn_ground: { id: "inn_ground", scope: "inn", layout: ["#########", "#ttt#kkk#", "#ttt+kkk#", "#########"], legend: { t: { place: "taproom" }, k: { place: "kitchen" } }, places: [{ id: "taproom", name: "Taproom" }, { id: "kitchen", name: "Kitchen" }] } };
  w.start = { ...w.start, place: "taproom" };
  const you = w.entities[w.pov];
  if (you) you.fields.place = "taproom";
  return migrateWorld(w);
}

describe("Walk here", () => {
  test("checks_odds answers what the map's Walk here asks, cell for cell, and action_play walks there", async () => {
    const rig = guardModel(new Rig({ shipped: true }));
    const imported = rig.body(await rig.send({ type: "lre.world", op: "import", file: { format: "lre-world-export-v1", world: inn() } })) as { world: { id: string } };
    const chatId = rig.host.createChat("Evening.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId: imported.world.id, chatId }));
    mount(rig);
    await playOn(rig, chatId, "harness");
    const turn = await beginTurn(rig, chatId, "I cross to the kitchen.");
    await turn.answer(AUTHOR, "time_clock");
    // A cell of the kitchen through the door, one of the taproom, and a wall.
    const kitchen = { x: 6, y: 1 };
    let walkable = 0;
    for (const cell of [kitchen, { x: 1, y: 2 }, { x: 4, y: 1 }]) {
      const walk = (rig.body(await rig.send({ type: "lre.map", op: "walk", chatId, ...cell })) as { walk?: { minutes: number; disabled?: string } }).walk;
      const odds = await turn.answer(GM, "checks_odds", { action: "step", params: JSON.stringify(cell) });
      expect({ cell, walk: odds.available === true ? { minutes: odds.minutes } : "no" }).toEqual({ cell, walk: walk?.disabled === undefined ? { minutes: walk?.minutes } : "no" });
      if (odds.available === true) walkable += 1;
    }
    expect(walkable).toBe(2);
    await turn.answer(AUTHOR, "action_play", { action: "step", params: JSON.stringify(kitchen) });
    await turn.answer(AUTHOR, "commit");
    await turn.finish("The kitchen is warm.");
    expect(decodeMapView((await rig.rt.view(chatId, rig.host.userId)).panels["space.map"])?.scopes.find((s) => s.grid?.pov)?.grid?.pov).toEqual(kitchen);
    noModelCalls(rig);
  });
});

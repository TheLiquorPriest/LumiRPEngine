// A fight on the harness engine, each tool called as the bridge calls it (`runHarnessTool`) against a
// real chat: Port Alder under the Modern profile, which brings combat rules, with the cast in the
// player character's kitchen. A fight is started, read, played round by round and ended through the
// combat pack itself, so what a round stages is compared with what the pack's own round service
// records for the same state, the same decisions and the same seeds. A call that isn't valid is
// answered with what to fix, and stages nothing.
//
// No tool here may reach a model: every test ends by checking that the engine made no model call.

import { describe, expect, test } from "bun:test";
import { rollSeed } from "../../src/backend/agents/tools/harness-tools/checks";
import { roundSeed } from "../../src/backend/agents/tools/harness-tools/fight";
import type { ToolEnv } from "../../src/backend/agents/tools/registry";
import { renderPrompt } from "../../src/backend/prompts";
import { WRITE_NOTE } from "../../src/shared/agent-tools-write";
import { hashJson, hashParts } from "../../src/shared/hash";
import { HARNESS_AGENT, HARNESS_NOTE } from "../../src/shared/harness-texts";
import { PLAY_NOTE } from "../../src/shared/harness-texts-play";
import type { JsonObject } from "../../src/shared/json";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import type { LedgerEvent } from "../../src/shared/ledger";
import { applyEffects } from "../../src/engine/effects";
import { ENGINE_EVENTS } from "../../src/engine/engine-pack";
import { materializeAll } from "../../src/engine/materialize";
import { optionalQuery, optionalService } from "../../src/engine/pack-kit";
import { resolveAction } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { runRulesOnEvents } from "../../src/engine/rules";
import { Working } from "../../src/engine/working";
import { Rig } from "../support/rig";
import { HOME, POV, recordFix } from "../support/tools";
import { answer, applied, call, castChat, castEnv, type CastTurn, castTurn, guardModel, ILSE, JOSS, MARA, noModelCalls, OKORO, refusal } from "./harness-cast-kit";
import { AUTHOR, beginTurn, mount, playOn } from "./harness-driver";

/** A registry text as shipped, filled: what a tool answers when the user changed nothing. */
const note = (id: string, vars: Record<string, string> = {}): string => renderPrompt(id, {}, vars);

const person = (id: string, name: string, here: boolean): JsonObject => ({ id, kind: "character", name, tier: "background", fields: here ? { place: HOME } : {}, relations: [] });

/** A Port Alder chat whose world has combat rules (the Modern profile's), with Mara, Joss and Ilse where the player character wakes and Okoro nowhere, and whoever `more` adds; its helper fails any model call. */
async function fightChat(more: readonly JsonObject[] = []): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true, minds: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "profile", profile: "modern", choices: {} }));
  for (const who of [person(MARA, "Mara", true), person(JOSS, "Joss", true), person(ILSE, "Ilse", true), person(OKORO, "Okoro", false), ...more]) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: String(who.id), value: who }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig: guardModel(rig), chatId };
}

interface Row {
  id: string;
  name: string;
  side: string;
  you: boolean;
  current: boolean;
  down: boolean;
  hp: { current: number; max: number } | null;
  wound: string | null;
}
interface Option {
  key: string;
  label: string;
}
interface Due {
  who: { id: string; name: string };
  round: number;
  options: Option[];
  decided?: string;
}
/** A fight as `fight_read` answers it, which `fight_start` and a round that leaves the fight on answer too. */
interface Fight {
  fight?: boolean;
  encounter: { round: number; turn: string; yours: boolean; order: Row[]; log: string[] };
  player: { id: string; name: string; up: boolean; out: boolean; actions: { action: string; params: JsonObject; label: string }[] };
  due: Due[];
  next: string;
}
/** What `mind_fight` answers a fighter that gives no choice. */
interface Seen {
  you: { id: string; name: string };
  fight: { round: number; turn: string; yours: boolean; order: Row[] };
  round: number;
  options: Option[];
  note: string;
}
interface Round extends Partial<Fight> {
  round: number;
  action?: { outcome: string; rolled: boolean; roll?: JsonObject };
  happened: string[];
  down: string[];
  ended: boolean;
  lands?: string;
}

const ATTACK = { action: "attack", params: { target: "Joss" } };
const types = (events: readonly LedgerEvent[]): string[] => events.map((e) => e.type);
const dataOf = (e: LedgerEvent | undefined): Record<string, unknown> => (e && "data" in e ? e.data : {});

/** The change a call staged last, written to the chat's head as a commit would land it: every event of it held by the engine's reducers first. */
async function land(rig: Rig, chatId: string, turn: CastTurn): Promise<LedgerEvent[]> {
  const events = turn.changes.at(-1)?.events ?? [];
  await applied(rig, chatId, events);
  await recordFix(rig, chatId, `fight-${hashJson(events).slice(0, 12)}`, events);
  return events;
}

/**
 * A fight against Joss started and landed in a turn whose dice put the player character first, or
 * Joss: initiative is the engine's, so the test looks for a seed that falls the way it needs.
 */
async function started(first: "player" | "joss"): Promise<{ rig: Rig; chatId: string; turn: CastTurn; author: ToolEnv; fight: Fight }> {
  for (let i = 0; i < 32; i++) {
    const { rig, chatId } = await fightChat();
    const turn = await castTurn(rig, chatId, { seed: `seed-${i}` });
    const author = castEnv(rig, chatId, turn);
    const fight = (await answer(author, "fight_start", { foes: ["Joss"] })) as unknown as Fight;
    if (fight.player.up !== (first === "player")) continue;
    await land(rig, chatId, turn);
    return { rig, chatId, turn, author, fight };
  }
  throw new Error(`no seed put ${first} first`);
}

/**
 * What the classic turn's combat segment records for a round on the head `author` reads (`planTurn`:
 * the pack's round service opened, the player character's action resolved and heard by the world's
 * rules, the service closed), with the decisions `given` recorded first and the seeds a harness
 * round draws from: the round's own (`roundSeed`: the turn and the fight as recorded, nothing a call
 * says), and for the action the one every played attempt rolls with (`rollSeed`: the turn, who
 * rolls, how many rolls the turn holds for them). A harness turn has no record of its own for the
 * roll, so the roll is recorded as the engine records any check it rolled. `rolled`: the action's
 * roll and its outcome.
 */
async function classicRound(rig: Rig, author: ToolEnv, turn: CastTurn, given: Record<string, string>, action: { action: string; params: JsonObject } | null): Promise<{ events: LedgerEvent[]; lines: string[]; rolled: { natural: number | null; total: number; outcome: string } | null }> {
  const head = await author.reader.view();
  const reg = rig.rt.registry;
  const w = new Working(reg, head.world, head.state);
  for (const [key, choice] of Object.entries(given)) expect(w.apply({ type: "combat.decision", data: { key, choice } })).toBeNull();
  const round = optionalService(w.ctx, "combat.round")?.(w, createRng(roundSeed(turn.seed, head.state)));
  if (!round) throw new Error("no combat rules");
  if (!action) return { lines: round.after(null), events: [...w.events], rolled: null };
  const seed = rollSeed(turn, POV);
  const resolution = resolveAction(reg, w, { action: action.action, actor: POV, params: action.params }, createRng(seed), { runSeed: turn.runSeed, judgement: null, heard: turn.said.user });
  const c = resolution.check;
  if (c) expect(w.apply({ type: ENGINE_EVENTS.check, data: { check: c.check.id, actor: POV, notation: c.notation, natural: c.natural, total: c.total, dc: c.dc, outcome: resolution.outcome ?? "" } })).toBeNull();
  if (resolution.events.length > 0) runRulesOnEvents(reg, w, resolution.events, { seed });
  return { lines: round.after({ resolution, params: action.params }), events: [...w.events], rolled: c ? { natural: c.natural, total: c.total, outcome: resolution.outcome ?? "" } : null };
}

describe("a world without combat rules", () => {
  test("has no fights: every fight tool says so, and says what to do instead", async () => {
    const { rig, chatId } = await castChat();
    const turn = await castTurn(rig, chatId);
    const author = castEnv(rig, chatId, turn);
    const none = note(PLAY_NOTE.noCombat);
    expect(await answer(author, "fight_read")).toEqual({ fight: false, note: none });
    expect(await refusal(author, "fight_start", { foes: ["Joss"] })).toBe(none);
    expect(await refusal(author, "fight_round", { tactics: true })).toBe(none);
    expect(await refusal(author, "fight_end")).toBe(none);
    const mind = castEnv(rig, chatId, await castTurn(rig, chatId, { main: false }), HARNESS_AGENT.character);
    expect(await refusal(mind, "mind_fight", { who: "Joss" })).toBe(note(PLAY_NOTE.mindNoTurn, { name: "Joss" }));
    expect(turn.changes).toEqual([]);
    noModelCalls(rig);
  });
});

describe("starting a fight", () => {
  test("fight_start runs the pack's own start at the player character's place, and refuses with why what can't be fought", async () => {
    const { rig, chatId } = await fightChat();
    const turn = await castTurn(rig, chatId);
    const author = castEnv(rig, chatId, turn);

    // Before one starts there is none to read, play or end.
    const noFight = note(PLAY_NOTE.noFight);
    expect(await answer(author, "fight_read")).toEqual({ fight: false, note: noFight });
    expect(await refusal(author, "fight_round", { tactics: true })).toBe(noFight);
    expect(await refusal(author, "fight_end")).toBe(noFight);

    // A foe has to be someone the world has, where the player character is.
    expect(await refusal(author, "fight_start", { foes: ["Nobody By That Name"] })).toContain("Nobody By That Name");
    expect(await refusal(author, "fight_start", { foes: ["Okoro"] })).toBe(note(PLAY_NOTE.noStart, { why: "Okoro isn't here to fight" }));
    // No one here is hostile to the player character, so a fight against no one in particular has no one in it.
    expect(await refusal(author, "fight_start")).toBe(note(PLAY_NOTE.noStart, { why: "there's no one to fight here" }));
    // Only the author starts one, in its turn and before the reply.
    expect(await refusal(castEnv(rig, chatId, null), "fight_start", { foes: ["Joss"] })).toBe(note(HARNESS_NOTE.noTurn));
    const whose = note(PLAY_NOTE.author, { tool: "fight_start" });
    expect(await refusal(castEnv(rig, chatId, await castTurn(rig, chatId, { main: false }), HARNESS_AGENT.gm), "fight_start", { foes: ["Joss"] })).toBe(whose);
    expect(await refusal(castEnv(rig, chatId, await castTurn(rig, chatId, { reply: { messageId: "m-reply", text: "They square up." } })), "fight_start", { foes: ["Joss"] })).toBe(whose);
    expect(turn.changes).toEqual([]);

    const first = await call(author, "fight_start", { foes: ["Joss", "Mara"] });
    const fight = JSON.parse(first.text) as Fight & { started: { lines: string[]; lands: string } };
    expect(fight.started).toEqual({ lines: turn.changes[0]?.lines ?? [], lands: note(WRITE_NOTE.staged) });
    // The player character's side against the two named; Ilse, who is there and no one's enemy, stays out of it.
    expect(fight.encounter.round).toBe(1);
    expect(fight.encounter.order.map((f) => [f.id, f.side]).sort()).toEqual([[JOSS, "foes"], [MARA, "foes"], [POV, "party"]]);
    expect(fight.player).toMatchObject({ id: POV, out: false });
    expect(fight.due.map((d) => d.who.id).sort()).toEqual([JOSS, MARA]);
    // Asked again before it lands, it is the same start, staged once.
    expect((await call(author, "fight_start", { foes: ["Joss", "Mara"] })).text).toBe(first.text);
    expect(turn.changes.map((c) => [c.changeType, c.time])).toEqual([["play", undefined]]);

    // One change: the fighters' detail, then the pack's own start, which holds on the head.
    const events = turn.changes[0]?.events ?? [];
    expect([...new Set(types(events))]).toEqual(["materialize", "combat.start"]);
    // In the order the initiative set, which is the encounter's.
    expect(dataOf(events.at(-1))).toMatchObject({ place: HOME, order: fight.encounter.order.map((f) => ({ id: f.id, side: f.side })) });
    // The initiative's dice are the turn's and the moment's: it is the pack's own start under a seed that holds nothing of whom the call named.
    const drawn = await author.reader.view();
    const own = new Working(rig.rt.registry, drawn.world, drawn.state);
    for (const id of [POV, JOSS, MARA]) materializeAll(rig.rt.registry, own, id, turn.runSeed);
    applyEffects(rig.rt.registry, own, [{ type: "combat.start", args: { foes: [JOSS, MARA] } }], { bindings: { self: POV }, rng: createRng(hashParts("lre.harness.fight.start", turn.seed, String(drawn.state.clock))), literal: true });
    expect(events).toEqual([...own.events]);
    await land(rig, chatId, turn);
    const read = (await answer(author, "fight_read")) as unknown as Fight;
    expect({ fight: read.fight, encounter: read.encounter, player: read.player, due: read.due, next: read.next }).toEqual({ fight: true, encounter: fight.encounter, player: fight.player, due: fight.due, next: fight.next });

    // One fight at a time.
    expect(await refusal(author, "fight_start", { foes: ["Ilse"] })).toBe(note(PLAY_NOTE.fightOn));
    noModelCalls(rig);
  });
});

describe("a fight's rounds", () => {
  test("the turns due before the player character's play first, by each fighter's decision; then the round with the player character's action, as the pack's round service records it", async () => {
    const { rig, chatId, turn, author, fight } = await started("joss");
    const name = fight.player.name;

    // Joss won the initiative: the encounter says who is up, and what Joss may choose from, each option by its key.
    const read = (await answer(author, "fight_read")) as unknown as Fight;
    expect(read).toMatchObject({ fight: true, encounter: { round: 1, turn: "Joss", yours: false }, player: { up: false, out: false }, next: note(PLAY_NOTE.nextOthers, { who: "Joss" }) });
    expect(read.due).toMatchObject([{ who: { id: JOSS, name: "Joss" }, round: 1 }]);
    expect(read.due[0]?.options.map((o) => [o.key, o.label])).toEqual([[`attack@${POV}`, `Attack ${name}`], ["end_turn@", "End turn"], ["total_defense@", "Total defense"]]);
    expect(read.due[0]?.decided).toBeUndefined();
    expect(((await answer(author, "fight_read", { who: "Joss" })) as unknown as Fight).due).toEqual(read.due);
    expect(await refusal(author, "fight_read", { who: "Ilse" })).toBe(note(PLAY_NOTE.notDue, { name: "Ilse" }));

    // The player character's action waits for the turns due before theirs; and no one's turn plays undecided.
    expect(await refusal(author, "fight_round", { ...ATTACK, tactics: true })).toBe(note(PLAY_NOTE.notUp, { up: "Joss", name }));
    expect(await refusal(author, "fight_round")).toBe(note(PLAY_NOTE.undecided, { who: "Joss" }));
    expect(await refusal(author, "fight_round", { decisions: "nonsense" })).toBe(note(PLAY_NOTE.badDecisions));
    expect(await refusal(author, "fight_round", { decisions: { Ilse: "end_turn@" } })).toBe(note(PLAY_NOTE.notDue, { name: "Ilse" }));
    expect(await refusal(author, "fight_round", { decisions: { Joss: "fly@" } })).toBe(note(PLAY_NOTE.badChoice, { name: "Joss", choice: "fly@", options: `attack@${POV}, end_turn@, total_defense@` }));
    expect(turn.changes.length).toBe(1);

    // Joss's turn by the author's decision: recorded first, then played by the pack, which takes it over its own tactic (an attack).
    const key = `combat:${String(dataOf(turn.changes[0]?.events.at(-1)).encounter)}:1:${JOSS}`;
    const decided = { [key]: "total_defense@" };
    const classic = await classicRound(rig, author, turn, decided, null);
    const opening = await call(author, "fight_round", { decisions: { Joss: "total_defense@" } });
    const opened = JSON.parse(opening.text) as Round;
    const events = turn.changes[1]?.events ?? [];
    expect(events).toEqual(classic.events);
    expect(types(events)).toEqual(["combat.decision", "combat.spend", "combat.act", "combat.turn"]);
    expect([dataOf(events[0]), dataOf(events[2]).action]).toEqual([{ key, choice: "total_defense@" }, "total_defense"]);
    expect(opened).toMatchObject({ round: 1, happened: classic.lines, down: [], ended: false, lands: note(WRITE_NOTE.staged), encounter: { round: 1, turn: "you", yours: true }, player: { up: true }, next: note(PLAY_NOTE.nextAction) });
    expect(opened.action).toBeUndefined();
    // While the fight goes on a round takes no time: the change says so, and the turn adds no tick of its own.
    expect([turn.changes[1]?.changeType, turn.changes[1]?.time]).toEqual(["play", 0]);
    // Played again before it lands it is the same round, with the same dice, staged once.
    expect((await call(author, "fight_round", { decisions: { Joss: "total_defense@" } })).text).toBe(opening.text);
    expect(turn.changes.length).toBe(2);
    await land(rig, chatId, turn);

    // The player character is up: the round needs their action, and the pack's own question for the turns after it is what is due.
    expect(await refusal(author, "fight_round", { tactics: true })).toBe(note(PLAY_NOTE.needsAction, { name }));
    const head = await author.reader.view();
    const asked = optionalQuery(head.ctx, "combat.choices")?.(head.ctx) ?? [];
    const due = ((await answer(author, "fight_read")) as unknown as Fight).due;
    expect(due.map((d) => ({ agent: d.who.id, options: d.options.map((o) => o.key), labels: Object.fromEntries(d.options.map((o) => [o.key, o.label])) }))).toEqual(asked.map((q) => ({ agent: q.agent, options: q.options, labels: q.labels })));
    expect(due.map((d) => d.round)).toEqual([2]);
    // Someone in the fight acts through its rounds, not on their own.
    expect(await refusal(author, "action_play", ATTACK)).toBe(note(PLAY_NOTE.inFight, { name }));

    // The round: the player character's attack is rolled as any played attempt is, from the turn and their own count of rolls, then Joss's turn by the pack's tactics, as the call says. The read shows no roll before it.
    expect(Object.keys(await answer(author, "checks_stakes", ATTACK)).filter((k) => ["roll", "rolled", "outcome"].includes(k))).toEqual([]);
    const segment = await classicRound(rig, author, turn, {}, { action: "attack", params: { target: JOSS } });
    const round = (await answer(author, "fight_round", { ...ATTACK, tactics: true })) as unknown as Round;
    expect(round.action).toMatchObject({ action: { id: "attack" }, actor: { id: POV }, outcome: segment.rolled?.outcome ?? "", rolled: segment.rolled !== null, ...(segment.rolled ? { roll: { natural: segment.rolled.natural, total: segment.rolled.total } } : {}) });
    expect(turn.changes[2]?.events).toEqual(segment.events);
    expect(round.happened).toEqual(segment.lines);
    expect(types(turn.changes[2]?.events ?? []).filter((t) => t === "combat.act").length).toBeGreaterThanOrEqual(1);
    await land(rig, chatId, turn);

    // On to the end by the pack's tactics: every round holds on the head, and the round that ends the fight leaves the turn's time open.
    let last = round;
    for (let i = 0; i < 24 && !last.ended; i++) {
      const now = (await answer(author, "fight_read")) as unknown as Fight;
      const classic = await classicRound(rig, author, turn, {}, now.player.up ? { action: "attack", params: { target: JOSS } } : null);
      last = (await answer(author, "fight_round", { ...(now.player.up ? ATTACK : {}), tactics: true })) as unknown as Round;
      expect([turn.changes.at(-1)?.events, last.happened]).toEqual([classic.events, classic.lines]);
      expect(turn.changes.at(-1)?.time).toBe(last.ended ? undefined : 0);
      await land(rig, chatId, turn);
    }
    expect(last).toMatchObject({ ended: true, next: note(PLAY_NOTE.ended) });
    expect(last.encounter).toBeUndefined();
    const end = dataOf(turn.changes.at(-1)?.events.find((e) => e.type === "combat.end"));
    expect(end.reason).toBe("over");
    // Whoever lost is down, by name.
    expect(last.down).toEqual([end.winner === "party" ? "Joss" : name]);
    expect(await answer(author, "fight_read")).toEqual({ fight: false, note: note(PLAY_NOTE.noFight) });
    noModelCalls(rig);
  });

  test("a round is the author's to play, before the reply; a choice the player character can't make is refused with the engine's reason", async () => {
    const { rig, chatId, turn, author, fight } = await started("player");
    expect(fight).toMatchObject({ player: { up: true }, next: note(PLAY_NOTE.nextAction) });
    expect(fight.player.actions.map((a) => [a.action, a.params])).toEqual([["attack", { target: JOSS }], ["end_turn", {}], ["total_defense", {}]]);

    expect(await refusal(castEnv(rig, chatId, null), "fight_round", { ...ATTACK, tactics: true })).toBe(note(HARNESS_NOTE.noTurn));
    const whose = note(PLAY_NOTE.author, { tool: "fight_round" });
    expect(await refusal(castEnv(rig, chatId, await castTurn(rig, chatId, { main: false }), HARNESS_AGENT.gm), "fight_round", { ...ATTACK, tactics: true })).toBe(whose);
    expect(await refusal(castEnv(rig, chatId, await castTurn(rig, chatId, { reply: { messageId: "m-reply", text: "They trade blows." } })), "fight_round", { ...ATTACK, tactics: true })).toBe(whose);
    // The action is read as action_play reads one: an action there is none of, a target who isn't in the fight.
    expect(await refusal(author, "fight_round", { action: "fly", tactics: true })).toContain("fight_round doesn't take fly as action");
    expect(await refusal(author, "fight_round", { action: "attack", params: { target: "Ilse" }, tactics: true })).toBe(note(HARNESS_NOTE.rollUnavailable, { why: "requires is_foe(self, target)" }));
    expect(turn.changes.length).toBe(1);

    // Another turn's seed draws other dice for the same round: across a few seeds the attack falls more than one way.
    const outcomes = new Set<string>();
    for (let i = 0; i < 16; i++) outcomes.add(((await answer(castEnv(rig, chatId, await castTurn(rig, chatId, { seed: `other-${i}` })), "fight_round", { ...ATTACK, tactics: true })) as unknown as Round).action?.outcome ?? "");
    expect(outcomes.size).toBeGreaterThan(1);
    noModelCalls(rig);
  });
});

describe("a fighter's own mind", () => {
  test("mind_fight answers the fight as that fighter perceives it and records its choice, which the round then plays", async () => {
    const { rig, chatId, turn, author, fight } = await started("joss");
    const name = fight.player.name;
    const theirs = await castTurn(rig, chatId, { main: false });
    const mind = castEnv(rig, chatId, theirs, HARNESS_AGENT.character);

    const seen = (await answer(mind, "mind_fight", { who: "Joss" })) as unknown as Seen;
    expect(seen).toMatchObject({ you: { id: JOSS, name: "Joss" }, round: 1, fight: { round: 1, turn: "you", yours: true }, note: note(PLAY_NOTE.mindChoose) });
    expect(seen.options).toEqual(fight.due[0]?.options);
    // Their own health exactly; the player character's only as a look tells it.
    const rows = seen.fight.order;
    expect(rows.find((f) => f.id === JOSS)).toMatchObject({ name: "You", you: true, hp: fight.encounter.order.find((f) => f.id === JOSS)?.hp ?? null });
    expect(rows.find((f) => f.id === POV)).toMatchObject({ name, you: false, hp: null, wound: "unhurt" });
    expect([theirs.character, theirs.changes]).toEqual([JOSS, []]);

    expect(await refusal(mind, "mind_fight", { who: "Joss", choice: "fly@" })).toBe(note(PLAY_NOTE.badChoice, { name: "Joss", choice: "fly@", options: `attack@${POV}, end_turn@, total_defense@` }));
    const chose = await answer(mind, "mind_fight", { who: "Joss", choice: "total_defense@" });
    expect(chose).toEqual({ decided: { choice: "total_defense@", label: "Total defense", round: 1, lands: note(WRITE_NOTE.staged) }, note: note(PLAY_NOTE.mindDecided) });
    const key = `combat:${String(dataOf(turn.changes[0]?.events.at(-1)).encounter)}:1:${JOSS}`;
    expect(theirs.changes).toEqual([{ key: theirs.changes[0]?.key ?? "", changeType: "mind", events: [{ type: "combat.decision", data: { key, choice: "total_defense@" } }], lines: [note(PLAY_NOTE.decided, { name: "Joss", round: "1", choice: "Total defense" })] }]);

    // Until the author commits it the round still waits for Joss; once it has landed the round plays it, with no word of tactics.
    expect(await refusal(author, "fight_round")).toBe(note(PLAY_NOTE.undecided, { who: "Joss" }));
    await land(rig, chatId, theirs);
    expect(((await answer(author, "fight_read")) as unknown as Fight).due[0]?.decided).toBe("total_defense@");
    const classic = await classicRound(rig, author, turn, {}, null);
    const round = (await answer(author, "fight_round")) as unknown as Round;
    expect(turn.changes.at(-1)?.events).toEqual(classic.events);
    expect([round.happened, dataOf(turn.changes.at(-1)?.events[1]).action]).toEqual([classic.lines, "total_defense"]);

    // The tool is a person's own: the author can't call it, no one decides for the player character or for someone else, and only a fighter has a turn.
    expect(await refusal(author, "mind_fight", { who: "Joss" })).toBe(note(HARNESS_NOTE.notCharacter, { tool: "mind_fight" }));
    expect(await refusal(mind, "mind_fight", {})).toContain("mind_fight needs who");
    expect(await refusal(mind, "mind_fight", { who: name })).toBe(note(HARNESS_NOTE.playerMind, { name }));
    expect(await refusal(mind, "mind_fight", { who: "Mara" })).toBe(note(HARNESS_NOTE.otherMind, { self: "Joss", other: "Mara", tool: "mind_fight" }));
    const ilse = castEnv(rig, chatId, await castTurn(rig, chatId, { main: false }), HARNESS_AGENT.character);
    expect(await refusal(ilse, "mind_fight", { who: "Ilse" })).toBe(note(PLAY_NOTE.mindNoTurn, { name: "Ilse" }));
    noModelCalls(rig);
  });
});

describe("ending a fight", () => {
  test("fight_end ends it as the story has it, or breaks it off as time moves on, through the pack's own effect and service", async () => {
    const { rig, chatId, turn, author } = await started("player");

    expect(await refusal(author, "fight_end", { winner: "nobody" })).toContain("fight_end doesn't take nobody as winner");
    const whose = note(PLAY_NOTE.author, { tool: "fight_end" });
    expect(await refusal(castEnv(rig, chatId, await castTurn(rig, chatId, { main: false }), HARNESS_AGENT.gm), "fight_end")).toBe(whose);
    expect(turn.changes.length).toBe(1);

    // The story decides who won: the pack's `combat.end` effect, as it stands.
    const ended = await answer(author, "fight_end", { winner: "foes" });
    expect(ended).toEqual({ ended: { lines: ["The fight is over: your side lost"], lands: note(WRITE_NOTE.staged) }, next: note(PLAY_NOTE.ended) });
    expect(turn.changes[1]).toMatchObject({ changeType: "play", lines: ["The fight is over: your side lost"] });
    expect(turn.changes[1]?.time).toBeUndefined();
    expect(turn.changes[1]?.events.map((e) => [e.type, dataOf(e).reason, dataOf(e).winner, dataOf(e).rounds])).toEqual([["combat.end", "effect", "foes", 1]]);
    await applied(rig, chatId, turn.changes[1]?.events ?? []);

    // Broken off, it ends as the classic turn ends one before a time skip: no one down, so no one won.
    const broke = await answer(author, "fight_end", { break_off: true });
    expect(broke).toMatchObject({ ended: { lines: ["The fight broke off as time moved on"] } });
    const head = await author.reader.view();
    const w = new Working(rig.rt.registry, head.world, head.state);
    optionalService(w.ctx, "combat.break_off")?.(w, "any seed");
    expect(turn.changes[2]?.events.map((e) => [e.type, dataOf(e)])).toEqual(w.events.map((e) => [e.type, dataOf(e)]));
    expect(dataOf(turn.changes[2]?.events[0])).toMatchObject({ reason: "skip", winner: null });

    // Landed, the fight is over: nothing is left to read, play or end.
    await land(rig, chatId, turn);
    const none = note(PLAY_NOTE.noFight);
    expect(await answer(author, "fight_read")).toEqual({ fight: false, note: none });
    expect(await refusal(author, "fight_round", { ...ATTACK, tactics: true })).toBe(none);
    expect(await refusal(author, "fight_end")).toBe(none);
    noModelCalls(rig);
  });

  test("a player character who is no longer where the fight is has left it: the next round ends the fight, and no one has to decide", async () => {
    const { rig, chatId, turn, author } = await started("joss");
    const head = await author.reader.view();
    const elsewhere = Object.keys(head.world.places).find((id) => id !== HOME) ?? "";
    const walked: LedgerEvent[] = [{ type: "set", entity: POV, field: "place", value: elsewhere }];
    await applied(rig, chatId, walked);
    await recordFix(rig, chatId, "walked-off", walked);

    expect(await answer(author, "fight_read")).toMatchObject({ fight: true, player: { up: false, out: true, actions: [] }, next: note(PLAY_NOTE.nextOut) });
    // Joss was up with a choice to make; the fight ends before anyone acts, as the pack ends one the player character left.
    const round = (await answer(author, "fight_round")) as unknown as Round;
    expect(round).toMatchObject({ ended: true, down: [], next: note(PLAY_NOTE.ended) });
    expect(round.happened[0]).toBe("You leave the fight.");
    expect(turn.changes.at(-1)?.events.map((e) => [e.type, dataOf(e).reason, dataOf(e).winner])).toEqual([["combat.end", "left", null]]);
    expect(turn.changes.at(-1)?.time).toBeUndefined();
    await land(rig, chatId, turn);
    expect(await answer(author, "fight_read")).toEqual({ fight: false, note: note(PLAY_NOTE.noFight) });
    noModelCalls(rig);
  });
});

describe("a fight through the bridge's own turn", () => {
  test("what a fight tool records is a change of the type the author plays, which Never refuses; and someone the world keeps secret is marked wherever a fight's answer names them, as every read marks one", async () => {
    // Brann stands where the player character wakes, and the world keeps them secret. Whether a view marks is the bridge's to say: the author's does.
    const { rig, chatId } = await fightChat([{ ...person("brann", "Brann", true), visibility: "secret" }]);
    mount(rig);
    await playOn(rig, chatId, "harness");
    const marked = secretMarkText("Brann", [], "everyone", SECRET_MARK_WORDING);

    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { play: { mode: "never" } } } }));
    const closed = await beginTurn(rig, chatId, "I square up to whoever is by the door.");
    expect(JSON.parse(await closed.refusal(AUTHOR, "fight_start", { foes: ["Brann"] }))).toMatchObject({ refused: { code: "mode_never" } });
    expect(await closed.answer(AUTHOR, "fight_read")).toMatchObject({ fight: false });
    await closed.finish("No one moves.");

    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { play: { mode: "auto" } } } }));
    const turn = await beginTurn(rig, chatId, "I square up to them after all.");
    const fight = (await turn.answer(AUTHOR, "fight_start", { foes: ["Brann"] })) as unknown as Fight & { started: { lines: string[] } };
    // By name wherever the answer names them: who is due, the encounter's order, and what the player character may do to them.
    expect(fight.due.map((d) => d.who)).toEqual([{ id: "brann", name: marked }]);
    expect(fight.encounter.order.map((f) => f.name).filter((name) => name.includes("Brann"))).toEqual([marked]);
    expect(fight.player.actions.find((a) => a.action === "attack")?.label).toBe(`Attack ${marked}`);
    // And in each line that tells of them: what was recorded, and what a round says happened.
    const unmarked = (lines: readonly string[]): string[] => lines.filter((line) => /brann/i.test(line) && !line.includes("[secret;"));
    expect(fight.started.lines.some((line) => /brann/i.test(line))).toBe(true);
    expect(unmarked(fight.started.lines)).toEqual([]);
    const read = (await turn.answer(AUTHOR, "fight_read")) as unknown as Fight;
    expect([read.due.map((d) => d.who.name), unmarked(read.encounter.log)]).toEqual([[marked], []]);
    const round = (await turn.answer(AUTHOR, "fight_round", fight.player.up ? { action: "attack", params: { target: "Brann" }, tactics: true } : { tactics: true })) as unknown as Round;
    // A round's own telling is the pack's, written for the player: it names them not at all, or marked.
    expect(round.happened.length).toBeGreaterThan(0);
    expect(unmarked(round.happened)).toEqual([]);
    // It all lands with the author's commit, as two changes the author played.
    const committed = (await turn.answer(AUTHOR, "commit")).committed as { landed: string[][]; review: string[][]; refused: unknown[] };
    expect([committed.landed.length, committed.review, committed.refused]).toEqual([2, [], []]);
    noModelCalls(rig);
  });
});

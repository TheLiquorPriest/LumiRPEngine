// A typed message's read belongs to its turn (DESIGN §5.1): the bridge keeps it for the words and the
// path the turn was read at. A later turn with the same words reads them again from where the story
// is then, and so does the same turn once an earlier message has changed under it; a Re-run of the
// turn, and its Re-run after "Not an action?", keep the read it was given.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { optionalQuery } from "../../src/engine/pack-kit";
import { placeOfEntity } from "../../src/engine/scope";
import type { JsonObject } from "../../src/shared/json";
import { activitySpanEnd } from "../../src/shared/world";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
/** Read from where the scene puts the player character: home → Bluebird Coffee, Bluebird Coffee → home. */
const ACROSS = "I head across to the other place.";
/** Read by the hour the scene shows: before half past six the market, from then on the coffee shop. */
const ERRAND = "I head out on my errand.";
const TO_COFFEE = "I walk to Bluebird Coffee.";

/** A Port Alder chat, the player character at home, whose `interpret` reads by the scene it is shown; `reads` counts its calls. */
async function alder(): Promise<{ rig: Rig; chatId: string; reads: { calls: number } }> {
  const rig = new Rig({ shipped: true });
  const reads = { calls: 0 };
  rig.host.quietReply = (req: QuietRequest) => {
    const system = req.messages[0]?.content ?? "";
    if (!system.includes(INTERPRET_MARK)) return "{}";
    reads.calls++;
    const text = req.messages[1]?.content ?? "";
    const atCoffee = /^Now: .*, at Bluebird Coffee \(bluebird_coffee\)/m.test(system);
    const early = /^Now: \S+ \S+ 06:[0-2]\d,/m.test(system);
    const to = text === ACROSS ? (atCoffee ? "harbor_street_114" : "bluebird_coffee") : text === ERRAND ? (early ? "alder_market" : "bluebird_coffee") : text === TO_COFFEE ? "bluebird_coffee" : null;
    const read: JsonObject = to ? { action: "go", params: { to }, confidence: 0.9 } : { action: null, params: {}, confidence: 0.9, reason: "no action" };
    return JSON.stringify(read);
  };
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId, reads };
}

async function where(rig: Rig, chatId: string): Promise<string | null> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  return placeOfEntity(state, "pov");
}

async function rerun(rig: Rig, chatId: string, reply: string): Promise<void> {
  const g = await rig.host.start(chatId, { type: "regenerate" });
  await rig.host.finish(g, reply);
}

/** "Not an action?" on the reply to the turn, as the player taps it. */
async function notAnAction(rig: Rig, chatId: string, messageId: string): Promise<void> {
  const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "not_action" && c.messageId === messageId);
  if (!chip) throw new Error("no Not an action? chip");
  rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "undo" }));
}

describe("a read belongs to its turn", () => {
  test("a later turn with the same words reads them again, from where the story is now", async () => {
    const { rig, chatId, reads } = await alder();
    await rig.turn(chatId, ACROSS, "You cross to Bluebird Coffee.");
    expect(await where(rig, chatId)).toBe("bluebird_coffee");
    await rig.turn(chatId, ACROSS, "You cross back home.");
    expect(await where(rig, chatId)).toBe("harbor_street_114");
    expect(reads.calls).toBe(2);
  });

  test("a Re-run of the turn keeps its read", async () => {
    const { rig, chatId, reads } = await alder();
    await rig.turn(chatId, ACROSS, "You cross to Bluebird Coffee.");
    await rerun(rig, chatId, "You cross over again.");
    expect(await where(rig, chatId)).toBe("bluebird_coffee");
    expect(reads.calls).toBe(1);
  });

  test("after Not an action?, its Re-run plays the words as roleplay without reading them again", async () => {
    const { rig, chatId, reads } = await alder();
    await rig.turn(chatId, ACROSS, "You cross to Bluebird Coffee.");
    await notAnAction(rig, chatId, rig.host.head(chatId)?.id ?? "");
    await rerun(rig, chatId, "You stay where you are.");
    expect(await where(rig, chatId)).toBe("harbor_street_114");
    expect(reads.calls).toBe(1);
  });

  test("once an earlier message changes under the turn, its Re-run reads it again", async () => {
    const { rig, chatId, reads } = await alder();
    // The first reply's second swipe has the player character stay home, and takes the scene's tick.
    await rig.turn(chatId, TO_COFFEE, "You walk over to Bluebird Coffee.");
    const first = rig.host.head(chatId)?.id ?? "";
    await notAnAction(rig, chatId, first);
    await rerun(rig, chatId, "You think better of it and stay home.");
    // From there, past half past six, the errand reads as the walk to Bluebird Coffee.
    await rig.turn(chatId, ERRAND, "You head out to Bluebird Coffee.");
    expect(await where(rig, chatId)).toBe("bluebird_coffee");
    // Back on the first swipe, whose walk was undone, the turn starts earlier: its Re-run reads the
    // same words from there, as the walk to the market.
    rig.host.navigate(chatId, first, 0);
    await rig.host.settle();
    await rerun(rig, chatId, "You head out to the market.");
    expect(await where(rig, chatId)).toBe("alder_market");
    expect(reads.calls).toBe(3);
  });
});

describe("Not an action? on a queued message", () => {
  /** How warmly Danny Okafor regards the player character (a gift's warmth is its largest part), in the chat as it folds now. */
  async function warmthOf(rig: Rig, chatId: string): Promise<number> {
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
    const world = state ? core?.worldAt(state.revision) : undefined;
    if (!state || !world) throw new Error("no state");
    const ctx = rig.rt.registry.context(world, state);
    return optionalQuery(ctx, "regard")?.(ctx, "danny_okafor", "pov", "warmth") ?? NaN;
  }

  test("undoes every action of the message, though an earlier one's activity ended while a later one played", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    // A bath whose span outlasts the gift, and a long read that sees it out: world actions of no effect of their own.
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "actions", id: "bath", value: { id: "bath", label: "Run a bath", params: {}, requires: [], outcomes: { default: [] }, duration: "1", activity: { type: "leisure", until: "clock + 60" }, lexicon: ["run a bath"] } }));
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "actions", id: "read", value: { id: "read", label: "Read", params: {}, requires: [], outcomes: { default: [] }, duration: "120", lexicon: ["read"] } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.host.quietReply = (req: QuietRequest) => {
      if (!(req.messages[0]?.content ?? "").includes(INTERPRET_MARK)) return "{}";
      return JSON.stringify({ action: "bath", params: {}, confidence: 0.9, more: [{ action: "give_gift", params: { target: "danny_okafor" }, text: "I give Danny his present" }, { action: "read", params: {}, text: "I read" }] });
    };
    const before = await warmthOf(rig, chatId);
    await rig.turn(chatId, "I run a bath, then give Danny his present, then read.", "You soak, hand Danny the parcel, and settle in with a book.");
    expect(await warmthOf(rig, chatId)).toBeGreaterThan(before + 4);
    await notAnAction(rig, chatId, rig.host.head(chatId)?.id ?? "");
    // The gift taken back with the rest; what the turn's hours did to regard on their own stays.
    expect(await warmthOf(rig, chatId)).toBeCloseTo(before, 0);
  });
});

describe("getting up before an out-of-character skip", () => {
  // The read interpret's rules ask for (its prompt and the time-skip catalog entry): the move out of
  // bed is the action and the hour its `then`. What a model makes of the rules isn't testable without
  // one; this holds the turn to what the read says.
  test("Get up plays, ending the night, and the hour is offered after it rather than slept through", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const BED = "I go back to bed.";
    const UP = "I get out of bed and make coffee. (OOC: skip an hour.)";
    rig.host.quietReply = (req: QuietRequest) => {
      if (!(req.messages[0]?.content ?? "").includes(INTERPRET_MARK)) return "{}";
      const text = req.messages[1]?.content ?? "";
      return JSON.stringify(text === BED ? { action: "sleep", params: {}, confidence: 0.9 } : text === UP ? { action: "get_up", params: {}, confidence: 0.9, then: { span: "an hour", minutes: 60 } } : { action: null, params: {}, confidence: 0.9 });
    };
    await rig.turn(chatId, BED, "You crawl back under the covers.");
    await rig.turn(chatId, UP, "You get up and put the kettle on.");
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const pov = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state.entities.pov;
    expect(pov?.fields.activity).toBe("idle");
    expect(activitySpanEnd(pov?.fields)).toBeNull();
    const chips = (await rig.rt.view(chatId, rig.host.userId)).chips;
    expect(chips.some((c) => c.kind === "timelapse_offer" && c.messageId === rig.host.head(chatId)?.id)).toBe(true);
  });
});

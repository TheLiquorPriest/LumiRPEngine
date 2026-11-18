// A panel's press, by its kind (plan §10.10, "A panel action"): one that is part of his next message is
// held as a request, shown in the chat's state view in the words the next briefing gives the Author, and
// taken back by the same press again; a palette entry that manages is marked as done at once. Send now
// puts the line in the chat as his message and starts the reply through Lumiverse's routes, and writes
// nothing while a turn runs, where RPE has no Lumiverse, or when nothing waits.

import { describe, expect, test } from "bun:test";
import { RouteError } from "../../src/app";
import type { LvMessage } from "../../src/adapter/lumiverse/rows";
import type { Writes } from "../../src/adapter/lumiverse/writes";
import { pressedLine } from "../../src/play/view";
import type { JsonObject } from "../../src/shared/json";
import { type Bed, CHAT, makeBed, USER, words } from "./bed";
import { actionOdds, findAction } from "../../src/engine/resolve";
import { neededWords, paramChoices } from "../../src/engine/param-words";
import { creditProducts } from "../../src/packs/economy/core/credit";
import { headOf } from "../../src/play/owner-edits";
import { orOf } from "../../src/shared/lines";
import type { PanelAsk } from "../../src/turn/requests";

/** A press of the starter world's palette that waits for the next message, as the taps route takes it. */
async function pressThatWaits(bed: Bed): Promise<{ kind: "action"; action: string; params: JsonObject; source: string }> {
  const view = await bed.state();
  const entry = view.palette?.entries.find((e) => e.atOnce !== true && e.group === "action" && e.amount === undefined && e.number === undefined && e.options.some((o) => o.disabled === undefined && o.next === undefined));
  const option = entry?.options.find((o) => o.disabled === undefined && o.next === undefined);
  if (entry === undefined || option === undefined) throw new Error("the starter world's palette has no press that waits");
  return { kind: "action", action: entry.action, params: option.params, source: "palette" };
}

/** What Lumiverse was asked to do as him: each line put in the chat, and each reply started. */
function lumiverse(): { writes: Pick<Writes, "appendMessage" | "startGeneration">; lines: string[]; started: number } {
  const out = { lines: [] as string[], started: 0, writes: {} as Pick<Writes, "appendMessage" | "startGeneration"> };
  out.writes = {
    appendMessage: async (_user, _chat, text) => {
      out.lines.push(text);
      return { id: `msg-${out.lines.length}` } as LvMessage;
    },
    startGeneration: async () => {
      out.started += 1;
      return `gen-${out.started}`;
    },
  };
  return out;
}

/** The refusal a route gives, its status and words. */
async function refusedWith(work: Promise<unknown>): Promise<{ status: number; words: string }> {
  try {
    await work;
  } catch (error) {
    if (error instanceof RouteError) return { status: error.status, words: error.message };
    throw error;
  }
  throw new Error("it was not refused");
}

describe("a press that is part of the next message", () => {
  test("is held and shown as waiting, in the briefing's words, until the same press takes it back", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    const before = await bed.state();
    expect(before.staged ?? null).toBeNull();
    expect(before.palette?.entries.find((e) => e.action === "pay")?.atOnce).toBe(true);
    const press = await pressThatWaits(bed);

    const held = await bed.service.tap(USER, CHAT, press);
    expect(held.asked !== undefined && "held" in held.asked ? held.asked.held?.kind : null).toBe("panel");
    const waiting = bed.requests.waiting(USER, CHAT);
    expect(waiting).toHaveLength(1);
    const asked = waiting[0]?.asked as PanelAsk;
    const shown = (await bed.state()).staged;
    expect(shown).toMatchObject({ request: waiting[0]?.id, action: press.action, from: "palette", what: asked.what, on: asked.on });
    expect(shown?.label).toBe(pressedLine(asked));

    const again = await bed.service.tap(USER, CHAT, press);
    expect(again.asked).toEqual({ held: null });
    expect(bed.requests.waiting(USER, CHAT)).toEqual([]);
    expect((await bed.state()).staged ?? null).toBeNull();
  });
});

describe("a press that manages", () => {
  test("is done at once with its Undo, and its answer says what was done in the words a press is shown in", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    const pay = (await bed.state()).palette?.entries.find((e) => e.action === "pay");
    const option = pay?.options.find((o) => o.disabled === undefined && o.next === undefined);
    if (pay?.amount === undefined || option === undefined) throw new Error("the starter world's palette has no Pay to press");
    const answer = await bed.service.tap(USER, CHAT, { kind: "action", action: "pay", params: { ...option.params, [pay.amount.param]: 1500 }, source: "palette" });
    expect(answer).toMatchObject({ applied: true });
    expect(answer.undo).not.toBeNull();
    expect(answer.asked).toBeUndefined();
    if (answer.reports.length > 0) expect(answer.words).toBe(words("applied_advised", { reports: answer.reports.join(" ") }));
    else expect(answer.words).toStartWith(`Done: ${pay.label}, on ${option.label}`);
  });
});

describe("what a press needs, in words", () => {
  test("a parameter left out is said by its label, and one that takes one of a list by the names the Money panel's offers show, never an id", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    const { registry, world, state } = headOf(bed.store, USER, CHAT);
    const ctx = registry.context(world, state);
    const products = creditProducts(ctx);
    const apply = findAction(registry, world, "apply_credit");
    if (apply === undefined) throw new Error("no Apply for credit");
    // The actions sheet offers each product by its name, as the Money panel's credit offers do, and sends its id.
    const entry = (await bed.state()).palette?.entries.find((e) => e.action === "apply_credit");
    expect(entry?.options.map((o) => [o.label, o.params.product])).toEqual(products.map((p) => [p.label, p.product]));
    // Left out, it is said by the same names.
    const failed = actionOdds(registry, world, state, { action: apply, params: {} }).failed;
    expect(failed?.reason).toBe(`Apply for credit needs you to choose the product: ${orOf(products.map((p) => p.label))}.`);
    expect(failed?.reason).not.toMatch(/_/);
    // A parameter that takes free words is said by its label, as a person gives it.
    const answer = findAction(registry, world, "answer");
    if (answer === undefined) throw new Error("no Answer");
    expect(neededWords(registry, world, answer, "answer", paramChoices(ctx, answer.params.answer, world.pov))).toBe("Answer needs the answer in your own words: say it in your message.");
  });
});

describe("Send now", () => {
  test("puts what waits in the chat as his message, in the words it was shown in, starts the reply, and it waits no more", async () => {
    const lv = lumiverse();
    const bed = makeBed(() => lv.writes);
    await bed.plays("modern_slice_of_life");
    const press = await pressThatWaits(bed);
    await bed.service.tap(USER, CHAT, press);
    const shown = (await bed.state()).staged;
    if (!shown) throw new Error("nothing waits");
    const played = await bed.service.playTap(USER, CHAT, { request: shown.request });
    expect(lv.lines).toEqual([shown.label]);
    expect(lv.started).toBe(1);
    expect(played).toEqual({ message: "msg-1", generation: "gen-1", request: shown.request });
    expect(bed.requests.waiting(USER, CHAT)).toEqual([]);
    expect((await bed.state()).staged ?? null).toBeNull();
    // Pressed again, nothing waits any more, and nothing more is written.
    expect(await refusedWith(bed.service.playTap(USER, CHAT, { request: shown.request }))).toEqual({ status: 404, words: words("no_request") });
    expect(lv.lines).toHaveLength(1);
  });

  test("writes nothing while a turn of the chat runs, nor where RPE has no Lumiverse, and what waits still waits", async () => {
    const lv = lumiverse();
    const bed = makeBed(() => lv.writes);
    await bed.plays("modern_slice_of_life");
    const press = await pressThatWaits(bed);
    await bed.service.tap(USER, CHAT, press);
    const request = bed.requests.waiting(USER, CHAT)[0]?.id ?? "";
    bed.running.add(CHAT);
    expect(await refusedWith(bed.service.playTap(USER, CHAT, { request }))).toEqual({ status: 409, words: words("turn_running") });
    expect(lv.lines).toEqual([]);
    const unconnected = makeBed();
    await unconnected.plays("modern_slice_of_life");
    await unconnected.service.tap(USER, CHAT, press);
    const waits = unconnected.requests.waiting(USER, CHAT)[0]?.id ?? "";
    expect(await refusedWith(unconnected.service.playTap(USER, CHAT, { request: waits }))).toEqual({ status: 409, words: words("no_lumiverse") });
    expect(unconnected.requests.waiting(USER, CHAT).map((r) => r.id)).toEqual([waits]);
  });

  test("a press played now from the palette puts its line in the chat and is answered as played", async () => {
    const lv = lumiverse();
    const bed = makeBed(() => lv.writes);
    await bed.plays("modern_slice_of_life");
    const press = await pressThatWaits(bed);
    const answer = await bed.service.tap(USER, CHAT, { ...press, now: true });
    expect(answer.asked).toMatchObject({ message: "msg-1", generation: "gen-1" });
    expect(bed.requests.waiting(USER, CHAT)).toEqual([]);
    expect(lv.lines).toHaveLength(1);
  });
});

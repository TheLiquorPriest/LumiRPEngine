// Today's panel actions, served by RPE: a tap that manages is recorded as the player's own change on the
// chat's newest turn, shows in the panels, is counted by the next turn's world state among what the
// turn before changed, and its Undo puts the state back; what is not served says so in the words of
// `.prompts/play-answers.md`; and one user's chat is not another's to change.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIX_THINGS_MAX } from "../../src/shared/protocol";
import type { StateView } from "../../src/shared/state-view";
import { worldState } from "../../src/store";
import { body, CHAT, GUIDANCE, makeBed, OTHER, panel, refusal, USER, words } from "./bed";

/** What the POV's bank accounts hold, as the money panel shows it. */
function banked(view: StateView): number {
  const overview = panel(view, "economy.money").overview;
  const line = typeof overview === "object" && overview !== null && !Array.isArray(overview) && Array.isArray(overview.breakdown) ? overview.breakdown.find((b) => typeof b === "object" && b !== null && !Array.isArray(b) && b.label === "Bank accounts") : undefined;
  if (typeof line !== "object" || line === null || Array.isArray(line) || typeof line.cents !== "number") throw new Error("no bank accounts in the money panel");
  return line.cents;
}

const PAY = { type: "lre.action", action: "pay", params: { to: "marcus_delgado", amount: 1500 }, source: "palette" };

describe("a tap that manages", () => {
  test("is recorded as the player's own on the chat's newest turn, shows in the panels, and its Undo puts the state back", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    const newest = await bed.turn();
    bed.listen();
    const before = banked(await bed.state());

    const paid = body(await bed.send(PAY), "lre.action");
    if (!("undo" in paid) || typeof paid.undo !== "string") throw new Error(`no Undo: ${JSON.stringify(paid)}`);
    expect({ applied: paid.applied, pending: paid.pending }).toEqual({ applied: true, pending: false });
    expect(banked(await bed.state())).toBe(before - 1500);
    const recorded = bed.store.user(USER).changes(newest.id);
    expect(recorded.length).toBeGreaterThan(0);
    expect(recorded.map((c) => ({ by: c.by, source: c.source, tapped: typeof c.cite === "object" && c.cite !== null && "tap" in c.cite }))).toEqual(recorded.map(() => ({ by: "player", source: "player", tapped: true })));
    expect(bed.heard.map((e) => ({ kind: e.kind, key: e.key, data: e.data }))).toEqual([{ kind: "state", key: "state", data: {} }]);

    expect(body(await bed.undo(paid.undo), "lre.chip")).toEqual({ applied: true, pending: false });
    expect(banked(await bed.state())).toBe(before);
    expect(bed.heard.map((e) => e.kind)).toEqual(["state", "state"]);
    // Undone once, it is not undone again.
    expect(body(await bed.undo(paid.undo), "lre.chip")).toEqual({ applied: false, pending: false });
    expect(banked(await bed.state())).toBe(before);
  });

  test("is counted by the next turn's world state among what the turn before changed", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    await bed.turn();
    body(await bed.send(PAY), "lre.action");
    const s = bed.store.user(USER);
    const next = await bed.writes.run(() => s.beginTurn({ chat: CHAT, kind: "normal" }));
    const block = worldState(s, { chat: CHAT, turn: next.id, layout: readFileSync(join(GUIDANCE, ".prompts", "world-state.md"), "utf8") });
    const engine = (block.sections.changed ?? []).find((l) => l.fields.lane === "engine");
    expect(engine?.fields.ops).toEqual({ list: expect.arrayContaining(["post"]) });
    expect(block.text).toContain("post");
  });

  test("as a ✎ moves the player character, and its Undo moves them back", async () => {
    const bed = makeBed();
    const { doc } = await bed.plays("fantasy_town");
    await bed.turn();
    const view = await bed.state();
    const from = view.hud?.place?.id;
    const to = view.hud?.fixes.place?.options?.map((o) => o.value).find((p) => typeof p === "string" && p !== from);
    if (typeof from !== "string" || typeof to !== "string") throw new Error("no place to move to");

    const fixed = body(await bed.send({ type: "lre.fix", entity: doc.pov, field: "place", value: to }), "lre.fix");
    if (typeof fixed.undo !== "string") throw new Error("no Undo");
    expect((await bed.state()).hud?.place?.id).toBe(to);
    expect(body(await bed.undo(fixed.undo), "lre.chip")).toEqual({ applied: true, pending: false });
    const back = await bed.state();
    expect({ hud: back.hud?.place?.id, scene: back.scene?.placeId }).toEqual({ hud: from, scene: from });
  });

  test("names no one the player character does not know, in the file's words, and records nothing", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    const newest = await bed.turn();
    expect(refusal(await bed.send({ ...PAY, params: { to: "stranger_nobody_knows", amount: 1500 } }))).toEqual({ code: "validation", message: words("not_known", { action: "Pay" }) });
    expect(refusal(await bed.send({ type: "lre.fix", things: [] }))).toEqual({ code: "bad_request", message: words("things_count", { most: FIX_THINGS_MAX }) });
    expect(bed.store.user(USER).changes(newest.id)).toEqual([]);
  });

  test("on a chat with no turn yet changes nothing, and says so", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    const before = banked(await bed.state());
    expect(refusal(await bed.send(PAY))).toEqual({ code: "unavailable", message: words("no_turn") });
    expect(banked(await bed.state())).toBe(before);
  });

  test("on another user's chat is refused, and so is the Undo of another user's tap", async () => {
    const bed = makeBed();
    await bed.plays("modern_slice_of_life");
    await bed.turn();
    const paid = body(await bed.send(PAY), "lre.action");
    const after = banked(await bed.state());
    expect(refusal(await bed.send(PAY, OTHER))).toEqual({ code: "not_world_chat", message: words("not_world") });
    if (!("undo" in paid) || typeof paid.undo !== "string") throw new Error("no Undo");
    expect(refusal(await bed.undo(paid.undo, OTHER))).toEqual({ code: "not_found", message: words("no_undo") });
    expect(banked(await bed.state())).toBe(after);
  });
});

describe("what is not served", () => {
  test("answers today's unavailable error in the file's words, and changes nothing", async () => {
    const bed = makeBed();
    await bed.plays("fantasy_town");
    const newest = await bed.turn();
    bed.listen();
    const asked: [Record<string, unknown>, string, Record<string, unknown>?][] = [
      // A tap from the palette with no words goes with the next message.
      [{ type: "lre.action", action: "timelapse", params: { target: { minutes: 60 } }, source: "palette" }, "next_message"],
      [{ type: "lre.action", action: "haul_stone", params: {}, source: "palette" }, "next_message"],
      // Send now, words, a chip: each plays at once.
      [{ type: "lre.action", action: "haul_stone", params: {}, source: "palette", now: true }, "plays_now"],
      [{ type: "lre.action", action: "haul_stone", params: {}, source: "command", text: "I haul the stone up the hill" }, "plays_now"],
      [{ type: "lre.chip", chip: "chip-1", choice: "confirm" }, "plays_now"],
      [{ type: "lre.things", scope: "gm", op: "list" }, "things"],
      [{ type: "lre.map", op: "walk", place: "market_square" }, "map"],
      [{ type: "lre.view.open", panel: "economy.money", entity: null }, "other", { type: "lre.view.open" }],
    ];
    for (const [message, line, fields] of asked) expect(refusal(await bed.send(message))).toEqual({ code: "unavailable", message: words(line, fields) });
    expect(bed.store.user(USER).changes(newest.id)).toEqual([]);
    expect(bed.heard).toEqual([]);
  });

  test("a chat's own choices read as RPE has them, each following and no engine of today's named; setting one is not served", async () => {
    const bed = makeBed();
    await bed.plays("fantasy_town");
    expect(body(await bed.send({ type: "lre.chat.knowledge", engines: true }), "lre.chat.knowledge")).toEqual({ knowledge: null, narrator: null });
    expect("engine" in (await bed.state())).toBe(false);
    expect(refusal(await bed.send({ type: "lre.chat.knowledge", knowledge: false }))).toEqual({ code: "unavailable", message: words("chat_choices") });
  });

  test("a message naming another chat than the path, or no message at all, is refused before anything is read", async () => {
    const bed = makeBed();
    await bed.plays("fantasy_town");
    await expect(bed.send({ ...PAY, chatId: "chat-elsewhere" })).rejects.toMatchObject({ status: 400 });
    await expect(bed.send({ type: "lre.action", action: "pay", source: "palette" })).rejects.toMatchObject({ status: 400 });
  });
});

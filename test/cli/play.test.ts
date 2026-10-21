// The chat tools (`lre_chat_state`, `lre_fix`, `lre_action`…) against the real backend on the fake
// host: each reads what the chat's page would show, and each write's effect shows in the chat's
// state as the next read gives it. The spoiler-gated ones refuse without `spoilers: true`, and a
// read-only client neither lists nor runs the writes.

import { describe, expect, test } from "bun:test";
import type { QuietResult } from "../../src/backend/host";
import { toolsFor } from "../../src/cli/tools";
import { isRecord } from "../../src/shared/json";
import type { CliRig } from "../support/cli-rig";
import { cliRig } from "../support/cli-rig";
import { plainMinds } from "../support/rig";

/** The frontend session the client's requests come from (cliRig's). */
const CLI_SESSION = "s_cli";

interface Played extends CliRig {
  chatId: string;
  /** The value a read tool answers at a pointer (the JSON after its header line). */
  read(name: string, args: Record<string, unknown>): Promise<unknown>;
}

/** A Port Alder chat attached through the tools, before or after one turn; `readOnly`: the client's later calls are. */
async function portAlder(options: { turn?: boolean; minds?: boolean; readOnly?: boolean } = {}): Promise<Played> {
  const cli = await cliRig({ shipped: true, ...(options.minds ? { minds: true } : {}) });
  const { rig } = cli;
  if (options.minds) rig.host.quietReply = plainMinds;
  const created = await cli.call("lre_world_create", { name: "Port Alder", template: "modern_slice_of_life" });
  const chatId = rig.host.createChat("Morning.");
  await cli.call("lre_attach", { worldId: String(created.worldId), chatId });
  if (options.turn !== false) await rig.turn(chatId, "Hello.", "A quiet morning on Harbor Street.");
  const raw: CliRig["raw"] = (name, args = {}, readOnly = options.readOnly === true) => cli.raw(name, args, readOnly);
  const read = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const result = await raw(name, { chatId, ...args });
    if (result.isError) throw new Error(`${name}: ${result.text}`);
    return JSON.parse(result.text.slice(result.text.indexOf("\n\n") + 2));
  };
  return { ...cli, raw, chatId, read };
}

/** What the backend sent the client's session besides the answers to its requests. */
const pushedToClient = (rig: CliRig["rig"]): string[] => rig.host.sent.flatMap((m, i) => (rig.host.sentTo[i]?.session === CLI_SESSION && m.type !== "lre.result" && m.type !== "lre.error" ? [m.type] : []));

describe("the chat tools", () => {
  test("lre_chat_state reads the page's view by pointer; the read is no page, so a reply waiting for one stays its page's to start", async () => {
    const { rig, chatId, raw, read } = await portAlder();
    const outline = await raw("lre_chat_state", { chatId });
    expect(outline.text).toContain("- hud: an object of 5 keys (clock, place, weather, cash, fixes)");
    expect(outline.text).toContain("- activity: null");
    expect(await read("lre_chat_state", { pointer: "/hud/place/id" })).toBe("harbor_street_114");
    // A turn the engine prepared for the page Lumiverse ran it for.
    rig.host.sendUser(chatId, "I stretch.");
    await rig.host.settle();
    expect((await rig.host.begin(chatId, { type: "normal", session: "desk" })).halted).toBe("cancelled");
    const [offered] = rig.host.restarts.splice(0);
    expect(offered?.session).toBe("desk");
    expect(await read("lre_chat_state", { pointer: "/activity/label" })).toBe("Waiting for the reply…");
    // The client was sent nothing of the chat's (no snapshot, no ask to start the reply), and the desk still holds the claim.
    expect(pushedToClient(rig)).toEqual([]);
    expect(rig.body(await rig.send({ type: "lre.restart", chatId, turn: offered?.turn ?? "" }, "desk")).start).toBe(true);
  });

  test("lre_fix sets a HUD fix and the clock; lre_chips lists its Undo, and lre_chip answers it", async () => {
    const { chatId, call, read } = await portAlder();
    expect(await read("lre_chat_state", { pointer: "/hud/weather" })).toBe("Clear");
    expect(await call("lre_fix", { chatId, fix: "weather", value: "rain" })).toMatchObject({ chatId, pending: false, fixed: { entity: "region_lakeshore_county", field: "weather", value: "rain" } });
    expect(await read("lre_chat_state", { pointer: "/hud/weather" })).toBe("Rain");
    const listed = (await call("lre_chips", { chatId })).chips;
    const undo = Array.isArray(listed) ? listed.filter(isRecord).find((c) => c.kind === "fix") : undefined;
    expect(undo).toMatchObject({ actions: [{ id: "undo", label: "Undo" }] });
    expect(await call("lre_chip", { chatId, chip: undo?.id, choice: "undo" })).toMatchObject({ applied: true, pending: false });
    expect(await read("lre_chat_state", { pointer: "/hud/weather" })).toBe("Clear");
    await call("lre_fix", { chatId, time: "2026-09-14 09:30" });
    expect(await read("lre_chat_state", { pointer: "/hud/clock/label" })).toBe("Mon 14 Sep 2026, 09:30");
  });

  test("lre_gm and lre_gm_edit need spoilers; a GM edit shows in the GM view and in Play", async () => {
    const { rig, chatId, call, raw, read } = await portAlder();
    const move = [{ op: "move", entity: "pov", to: "bluebird_coffee" }];
    const gated: [string, Record<string, unknown>][] = [
      ["lre_gm", {}],
      ["lre_minds", {}],
      ["lre_gm_edit", { ops: move }],
      ["lre_mind_edit", { ops: [{ op: "mind_pin", entity: "danny_okafor", level: "live" }] }],
      ["lre_minds_run", {}],
    ];
    const sent = rig.host.sent.length;
    for (const [name, args] of gated) {
      const refused = await raw(name, { chatId, ...args });
      expect({ name, isError: refused.isError, says: refused.text.includes("spoilers: true") }).toEqual({ name, isError: true, says: true });
    }
    // Refused before anything was asked of LumiRPEngine.
    expect(rig.host.sent.length).toBe(sent);
    expect(await read("lre_chat_state", { pointer: "/hud/place/id" })).toBe("harbor_street_114");
    expect(await read("lre_gm", { spoilers: true, pointer: "/edits" })).toEqual([]);
    expect(await call("lre_gm_edit", { chatId, spoilers: true, ops: move })).toMatchObject({ applied: 1, pending: false });
    expect(await read("lre_chat_state", { pointer: "/hud/place/id" })).toBe("bluebird_coffee");
    expect(await read("lre_gm", { spoilers: true, pointer: "/edits" })).toHaveLength(1);
  });

  test("lre_marker previews without writing, then sets a time control and the player-claims policy", async () => {
    const { chatId, call, read } = await portAlder();
    expect(await read("lre_chat_state", { pointer: "/controls/time/scale" })).toBe(1);
    const preview = await call("lre_marker", { chatId, kind: "time", control: "scale", to: 2, preview: true });
    expect(Array.isArray(preview.preview)).toBe(true);
    expect(await read("lre_chat_state", { pointer: "/controls/time/scale" })).toBe(1);
    expect(await call("lre_marker", { chatId, kind: "time", control: "scale", to: 2 })).toMatchObject({ set: "time", pending: false });
    expect(await read("lre_chat_state", { pointer: "/controls/time/scale" })).toBe(2);
    await call("lre_marker", { chatId, kind: "claims", to: { mode: "ask", capped: false } });
    expect(await read("lre_chat_state", { pointer: "/controls/realism/claims" })).toEqual({ mode: "ask", capped: false });
  });

  test("lre_keep settles a chat paused by an earlier edit, which the other writes refuse until then", async () => {
    const { rig, chatId, call, raw, read } = await portAlder();
    await rig.turn(chatId, "I check my phone.", "Nothing new.");
    const first = rig.host.chat(chatId).messages.find((m) => m.isUser);
    if (!first) throw new Error("no player message");
    rig.host.editMessage(chatId, first.id, "Good morning.");
    await rig.host.settle();
    expect(await read("lre_chat_state", { pointer: "/status" })).toBe("paused");
    const refused = await raw("lre_fix", { chatId, entity: "pov", field: "place", value: "bluebird_coffee" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("lre_keep");
    expect(await call("lre_keep", { chatId, choice: "keep", messageId: first.id })).toMatchObject({ choice: "keep", pending: false });
    expect(await read("lre_chat_state", { pointer: "/status" })).toBe("idle");
  });

  test("lre_view_open settles a panel's detail as opening it does; lre_inspector reads the engine runs", async () => {
    const { chatId, call, read } = await portAlder({ turn: false });
    expect(await read("lre_chat_state", { pointer: "/panels/economy.money/opened" })).toBe(false);
    expect(await call("lre_view_open", { chatId, panel: "economy.money" })).toMatchObject({ materialized: true, pending: false });
    expect(await read("lre_chat_state", { pointer: "/panels/economy.money/opened" })).toBe(true);
    expect(await read("lre_inspector", { pointer: "/generations" })).toEqual([]);
  });

  test("lre_timelapse and lre_action post the player's turn as the palette does; the engine prepares it and the page's reply plays it", async () => {
    const { rig, chatId, call, read } = await portAlder();
    expect(await read("lre_inspector", { pointer: "/generations" })).toHaveLength(1);
    const start = Number(await read("lre_chat_state", { pointer: "/hud/clock/minutes" }));
    const skip = await call("lre_timelapse", { chatId, target: { type: "duration", minutes: 60 } });
    expect(skip).toMatchObject({ action: "timelapse", messageId: expect.any(String) });
    expect(String(skip.reply)).toContain("the reply is started by Lumiverse, not by this client");
    // Lumiverse's generation for the new message, stopped while the engine prepares the turn, then started again by the page.
    const reply = async (text: string): Promise<void> => {
      const g = await rig.host.start(chatId, { type: "normal" });
      await rig.host.finish(g, text);
    };
    await reply("An hour slips by on the porch.");
    expect(Number(await read("lre_chat_state", { pointer: "/hud/clock/minutes" })) - start).toBeGreaterThanOrEqual(60);
    // Withdrawing needs a cash machine, and there is none on Harbor Street: the action is played, and declined, in the 3 minutes it takes.
    const withdraw = await call("lre_action", { chatId, action: "withdraw_cash", params: { account: "acct_pov_checking", amount: 2000 } });
    expect(withdraw).toMatchObject({ action: "withdraw_cash", messageId: expect.any(String) });
    const before = Number(await read("lre_chat_state", { pointer: "/hud/clock/minutes" }));
    await reply("You look around for a cash machine.");
    expect(Number(await read("lre_chat_state", { pointer: "/hud/clock/minutes" })) - before).toBe(3);
    const declined = (await call("lre_chips", { chatId })).chips;
    expect(declined).toContainEqual(expect.objectContaining({ kind: "decline", label: "Withdraw cash: declined" }));
  });

  test("the minds tools read, pin, run and cancel characters' minds behind spoilers", async () => {
    const { rig, chatId, call, read } = await portAlder({ minds: true });
    /** A part of Danny's entry, wherever closeness puts him in the list. */
    const danny = async (part: string): Promise<unknown> => {
      const characters = await read("lre_minds", { spoilers: true, pointer: "/characters" });
      const at = Array.isArray(characters) ? characters.findIndex((c) => isRecord(c) && c.entity === "danny_okafor") : -1;
      if (at < 0) throw new Error("no Danny");
      return read("lre_minds", { spoilers: true, pointer: `/characters/${at}${part}` });
    };
    expect(await danny("/fidelity/pin/gm")).toBeNull();
    await call("lre_mind_edit", { chatId, spoilers: true, ops: [{ op: "mind_pin", entity: "danny_okafor", level: "live" }] });
    expect(await danny("/fidelity/pin/gm")).toBe("live");
    const started = await call("lre_minds_run", { chatId, spoilers: true, who: ["danny_okafor"] });
    const runId = isRecord(started.run) ? started.run.runId : null;
    expect(typeof runId).toBe("string");
    expect(await read("lre_minds", { spoilers: true, pointer: "/run/status" })).toBe("done");
    expect(await read("lre_minds", { spoilers: true, pointer: "/run/runId" })).toBe(runId);
    // A run cancelled while it is under way records nothing: its minds are held at their model calls until then.
    const before = JSON.stringify(await danny("/mind"));
    const quiet = rig.host.models.quiet;
    const held: (() => void)[] = [];
    rig.host.models.quiet = (request, userId, signal) => {
      const { promise, resolve, reject } = Promise.withResolvers<QuietResult>();
      held.push(() => void quiet(request, userId, signal).then(resolve, reject));
      return promise;
    };
    const second = await call("lre_minds_run", { chatId, spoilers: true, who: ["danny_okafor"] });
    const secondId = isRecord(second.run) ? second.run.runId : null;
    expect(secondId).not.toBe(runId);
    expect(await call("lre_minds_cancel", { chatId, runId: secondId })).toMatchObject({ runId: secondId, stopped: true });
    rig.host.models.quiet = quiet;
    for (const go of held) go();
    await rig.host.settle();
    expect(await read("lre_minds", { spoilers: true, pointer: "/run/status" })).toBe("cancelled");
    expect(JSON.stringify(await danny("/mind"))).toBe(before);
  });

  test("a read-only client lists only the reads, and refuses every write before anything is sent", async () => {
    const { rig, chatId, raw, read } = await portAlder({ readOnly: true });
    const writes = ["lre_fix", "lre_gm_edit", "lre_mind_edit", "lre_marker", "lre_chip", "lre_keep", "lre_view_open", "lre_action", "lre_timelapse", "lre_minds_run", "lre_minds_cancel"];
    const listed = toolsFor(true).map((t) => t.name);
    for (const name of writes) expect({ name, listed: listed.includes(name) }).toEqual({ name, listed: false });
    for (const name of ["lre_chat_state", "lre_chips", "lre_inspector", "lre_gm", "lre_minds"]) expect(listed).toContain(name);
    const sent = rig.host.sent.length;
    for (const name of writes) {
      const refused = await raw(name, { chatId });
      expect({ name, refused: refused.isError === true && refused.text.includes("read-only") }).toEqual({ name, refused: true });
    }
    expect(rig.host.sent.length).toBe(sent);
    expect(await read("lre_chat_state", { pointer: "/hud/cash" })).toEqual({ cents: 8500 });
  });
});

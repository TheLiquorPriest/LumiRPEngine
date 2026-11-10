// The chat tools (`lre_chat_state`, `lre_fix`, `lre_action`…) against the real backend on the fake
// host: each reads what the chat's page would show, and each write's effect shows in the chat's
// state as the next read gives it. The spoiler-gated ones refuse without `spoilers: true`, and a
// read-only client neither lists nor runs the writes.

import { describe, expect, test } from "bun:test";
import { chatHead } from "../../src/backend/agents/tools/workspace";
import type { QuietResult } from "../../src/backend/host";
import { toolsFor } from "../../src/cli/tools";
import { madePlaces } from "../../src/engine/places-in-play";
import { isRecord } from "../../src/shared/json";
import type { CliRig } from "../support/cli-rig";
import { cliRig } from "../support/cli-rig";
import { expectMatch } from "../support/match";
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
    expect(await read("lre_chat_state", { pointer: "/hud/clock/label" })).toBe("Mon 14 Sep 2026, 9:30 AM");
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

  test("lre_gm with no part answers how many each part holds, never the whole view; part all reads it whole", async () => {
    const { rig, chatId, raw, read } = await portAlder();
    const answered = (from: number): string[] => rig.host.sent.slice(from).flatMap((m) => (m.type === "lre.result" ? [m.request] : []));
    const before = rig.host.sent.length;
    const outline = await read("lre_gm", { spoilers: true });
    expect(answered(before)).toEqual(["lre.gm.part"]);
    const whole = rig.body(await rig.send({ type: "lre.gm", chatId }));
    const count = (key: string): number => (Array.isArray(whole[key]) ? whole[key].length : -1);
    expect(isRecord(outline) ? outline.parts : null).toMatchObject({ entities: count("entities"), money: count("money"), orgs: count("orgs"), places: count("places"), held: 0, encounter: 0 });
    expect(isRecord(outline) ? outline.read : null).toContain('part "all"');
    const all = await raw("lre_gm", { chatId, spoilers: true, part: "all" });
    expect(all.text).toContain("too big for one answer");
    expect(all.text).toContain(`- entities: a list of ${count("entities")}`);
    expect((await raw("lre_gm", { chatId, spoilers: true, pointer: "/everything" })).text).toContain('The GM view has no part "everything"');
  });

  test("lre_gm_edit takes a thing's and a place's typed ops (ITEMS-SPEC §7.5): a thing moved, a place made, and the same place made again refused as there already", async () => {
    const { rig, chatId, call, raw } = await portAlder();
    const take = [{ op: "item", change: { do: "move", item: "pov_flashlight", to: { in: "pov" }, why: "Jordan takes the flashlight from the glovebox" } }];
    expect(await call("lre_gm_edit", { chatId, spoilers: true, ops: take })).toMatchObject({ applied: 1, pending: false });
    const booth = [{ op: "place", change: { do: "make", name: "Back booth", parent: "rusty_anchor", as: "spot", why: "the back booth at the Rusty Anchor" } }];
    expect(await call("lre_gm_edit", { chatId, spoilers: true, ops: booth })).toMatchObject({ applied: 1, pending: false });
    const again = await raw("lre_gm_edit", { chatId, spoilers: true, ops: booth });
    expect({ isError: again.isError, says: again.text.includes("Back booth is there already") }).toEqual({ isError: true, says: true });
    const head = await chatHead(rig.rt, chatId, rig.host.userId);
    if (!head) throw new Error("the chat has no head");
    expect(head.state.entities.pov_flashlight?.relations).toContainEqual({ type: "in", to: "pov" });
    expect(madePlaces(head.state).map((p) => [p.name, p.parent, p.made.as, p.made.by])).toEqual([["Back booth", "rusty_anchor", "spot", "gm"]]);
  });

  test("lre_gm_edit takes the org op (ORG-SPEC §7.5): a Shop foreman position and Danny appointed to it read back on lre_orgs' GM page, and its Undo puts him back", async () => {
    const { chatId, call } = await portAlder();
    const ops = [
      { op: "org", change: { do: "position", org: "alder_automotive_co", position: { id: "shop_foreman", title: "Shop foreman", powers: ["staff.hire"] } } },
      { op: "org", change: { do: "appoint", org: "alder_automotive_co", who: "danny_okafor", position: "shop_foreman", why: "Marcus wants someone running the floor" } },
    ];
    expect(await call("lre_gm_edit", { chatId, spoilers: true, ops })).toMatchObject({ applied: 2, pending: false });
    const dannyThere = async (): Promise<unknown> => {
      const people = (await call("lre_orgs", { chatId, org: "Alder Automotive", part: "people", spoilers: true })).people;
      return Array.isArray(people) ? people.filter(isRecord).find((p) => p.id === "danny_okafor")?.position : undefined;
    };
    expect(await dannyThere()).toEqual({ id: "shop_foreman", title: "Shop foreman" });
    const listed = (await call("lre_chips", { chatId })).chips;
    const undo = Array.isArray(listed) ? listed.filter(isRecord).find((c) => c.kind === "fix") : undefined;
    expect(await call("lre_chip", { chatId, chip: undo?.id, choice: "undo" })).toMatchObject({ applied: true, pending: false });
    expect(await dannyThere()).toEqual({ id: "mechanic", title: "Mechanic" });
  });

  test("lre_items_find needs spoilers, and answers the things words name, best first, each with where it is and whose", async () => {
    const { rig, chatId, call, raw } = await portAlder();
    const ids = (answer: Record<string, unknown>): unknown => (Array.isArray(answer.things) ? answer.things.map((t: unknown) => (isRecord(t) ? t.id : null)) : null);
    const sent = rig.host.sent.length;
    const refused = await raw("lre_items_find", { chatId, words: "the keys" });
    expect({ isError: refused.isError, says: refused.text.includes("spoilers: true") }).toEqual({ isError: true, says: true });
    expect(rig.host.sent.length).toBe(sent);
    // "The keys" are Jordan's first, as he would mean them, then the others' keys.
    const keys = await call("lre_items_find", { chatId, spoilers: true, words: "the keys" });
    expect(ids(keys)).toEqual(["pov_keys", "pontoon_keys", "shop_office_key"]);
    const home = [
      { id: "lakeshore_county", name: "Lakeshore County" },
      { id: "port_alder", name: "Port Alder" },
      { id: "harbor_street_114", name: "114 Harbor Street" },
      { id: "pov", name: "Jordan Ellis" },
    ];
    expect(Array.isArray(keys.things) ? keys.things[0] : null).toEqual({ id: "pov_keys", name: "Keys", type: "Key set (house, car fob, keyring)", size: "Pocket", where: home, whose: "Jordan Ellis's", owners: ["pov"], with: "pov" });
    // An owner's name narrows them; words nothing goes by find nothing, and say so.
    expect(ids(await call("lre_items_find", { chatId, spoilers: true, words: "Marcus's key" }))).toEqual(["shop_office_key"]);
    expect(await call("lre_items_find", { chatId, spoilers: true, words: "a purple elephant" })).toMatchObject({ things: [], note: "Nothing in the chat goes by those words: try fewer of them, or read lre_gm's /entities." });
  });

  test("lre_marker previews without writing, then sets a time control, the player-claims policy and inferred checks", async () => {
    const { chatId, call, read } = await portAlder();
    expect(await read("lre_chat_state", { pointer: "/controls/time/scale" })).toBe(1);
    const preview = await call("lre_marker", { chatId, kind: "time", control: "scale", to: 2, preview: true });
    expect(Array.isArray(preview.preview)).toBe(true);
    expect(await read("lre_chat_state", { pointer: "/controls/time/scale" })).toBe(1);
    expect(await call("lre_marker", { chatId, kind: "time", control: "scale", to: 2 })).toMatchObject({ set: "time", pending: false });
    expect(await read("lre_chat_state", { pointer: "/controls/time/scale" })).toBe(2);
    await call("lre_marker", { chatId, kind: "claims", to: { mode: "ask", capped: false } });
    expect(await read("lre_chat_state", { pointer: "/controls/realism/claims" })).toEqual({ mode: "ask", capped: false });
    // The policy in force, read back, changed and sent whole, as the guide tells an agent to.
    const inferred = await read("lre_chat_state", { pointer: "/controls/inferred" });
    if (!isRecord(inferred)) throw new Error("no inferred-checks policy");
    const off = inferred.mode === "off" ? "auto" : "off";
    await call("lre_marker", { chatId, kind: "infer", to: { ...inferred, mode: off } });
    expect(await read("lre_chat_state", { pointer: "/controls/inferred/mode" })).toBe(off);
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
    const { rig, chatId, call, raw, read } = await portAlder();
    expect(await read("lre_inspector", { pointer: "/generations" })).toHaveLength(1);
    const start = Number(await read("lre_chat_state", { pointer: "/hud/clock/minutes" }));
    const skip = await call("lre_timelapse", { chatId, target: { type: "duration", minutes: 60 } });
    expectMatch(skip, { action: "timelapse", messageId: expect.any(String) });
    expect(String(skip.reply)).toContain("the reply is started by Lumiverse, not by this client");
    // Lumiverse's generation for the new message, stopped while the engine prepares the turn, then started again by the page.
    const reply = async (text: string): Promise<void> => {
      const g = await rig.host.start(chatId, { type: "normal" });
      await rig.host.finish(g, text);
    };
    await reply("An hour slips by on the porch.");
    expect(Number(await read("lre_chat_state", { pointer: "/hud/clock/minutes" })) - start).toBeGreaterThanOrEqual(60);
    // A money action with no words is done at once, off screen: refused here, with no message posted, since Harbor Street has no cash machine.
    const atOnce = await raw("lre_action", { chatId, action: "withdraw_cash", params: { account: "acct_pov_checking", amount: 2000 } });
    expect({ isError: atOnce.isError, says: atOnce.text.includes("no cash machine") }).toEqual({ isError: true, says: true });
    // With words it plays as the player's turn, and is declined in the 3 minutes it takes.
    const withdraw = await call("lre_action", { chatId, action: "withdraw_cash", params: { account: "acct_pov_checking", amount: 2000 }, text: "I look for a cash machine to take out $20." });
    expectMatch(withdraw, { action: "withdraw_cash", messageId: expect.any(String) });
    const before = Number(await read("lre_chat_state", { pointer: "/hud/clock/minutes" }));
    await reply("You look around for a cash machine.");
    expect(Number(await read("lre_chat_state", { pointer: "/hud/clock/minutes" })) - before).toBe(3);
    const declined = (await call("lre_chips", { chatId })).chips;
    expect(declined).toContainEqual(expect.objectContaining({ kind: "decline", label: "Withdraw cash: declined" }));
  });

  test("lre_gm reads money by id or name, cut to one account; lre_orgs pages; a write made while a turn waits for the page is queued, listed in /held, then lands", async () => {
    const { rig, chatId, call, raw, read } = await portAlder();
    expect(await read("lre_gm", { spoilers: true, pointer: "/money/danny_okafor/party" })).toBe("danny_okafor");
    expect(await read("lre_gm", { spoilers: true, pointer: "/money/Danny Okafor/party" })).toBe("danny_okafor");
    expect(await read("lre_gm", { spoilers: true, party: "Danny Okafor", pointer: "/party" })).toBe("danny_okafor");
    const accounts = await read("lre_gm", { spoilers: true, party: "pov", account: "acct_pov_checking", pointer: "/accounts" });
    expect(Array.isArray(accounts) ? accounts.map((a: unknown) => (isRecord(a) ? a.id : null)) : null).toEqual(["acct_pov_checking"]);
    const paged = await raw("lre_orgs", { chatId, spoilers: true, pointer: "/organizations", from: 0, limit: 1 });
    expect(paged.text).toMatch(/entries 0–0 of \d+/);
    // The turn is prepared and waits for a page to start its reply (the desk's): a ✎ fix now waits for it.
    await call("lre_timelapse", { chatId, target: { type: "duration", minutes: 30 } });
    expect((await rig.host.begin(chatId, { type: "normal", session: "desk" })).halted).toBe("cancelled");
    const [offered] = rig.host.restarts.splice(0);
    expect(await call("lre_fix", { chatId, fix: "weather", value: "rain" })).toMatchObject({ pending: true, queued: "page" });
    expect(await read("lre_gm", { spoilers: true, part: "held" })).toEqual([expect.objectContaining({ waitsOn: "page" })]);
    expect(await read("lre_chat_state", { pointer: "/hud/weather" })).toBe("Clear");
    // The page starts the reply; once it is in, the fix lands.
    expect(rig.body(await rig.send({ type: "lre.restart", chatId, turn: offered?.turn ?? "" }, "desk")).start).toBe(true);
    const g = await rig.host.start(chatId, { type: "normal", session: "desk" });
    await rig.host.finish(g, "Half an hour passes on the porch.");
    expect(await read("lre_gm", { spoilers: true, part: "held" })).toEqual([]);
    expect(await read("lre_chat_state", { pointer: "/hud/weather" })).toBe("Rain");
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

// The calls the parity test makes of every chat and lore tool LumiRPEngine serves outside clients
// (INC3-SPEC U2's parity: each answers as the command line's own implementation did before it moved
// into the backend), on a Port Alder chat after one turn, with the clock frozen so ids and times
// read alike: every tool once or more, its spoilers gate and its typed GM edits (item, place, org)
// among them, refusals included. `test/cli/parity.golden.json` holds what the old modules answered.

import type { ToolResult } from "../../src/shared/tool-answer";
import type { CliRig } from "./cli-rig";

/** When the parity runs: frozen, so a run's ids and times are the same on every run. */
export const PARITY_CLOCK = new Date("2026-09-14T09:00:00.000Z");

/** One call of the script and its answer. */
export interface ParityCall {
  name: string;
  args: Record<string, unknown>;
  result: ToolResult;
}

/**
 * The script's calls with what differs from run to run read alike: the world's and the chat's ids
 * (made afresh on each run), the revision and read keys hashed from them, and how long a run took.
 */
export function normalized(calls: readonly ParityCall[], ids: { worldId: string; chatId: string }): ParityCall[] {
  const text = (s: string): string => s.split(ids.worldId).join("<world>").split(ids.chatId).join("<chat>").replace(/\b[0-9a-f]{32}\b/g, "<hash>").replace(/"ms": \d+/g, '"ms": 0');
  return calls.map((c) => ({ name: c.name, args: JSON.parse(text(JSON.stringify(c.args))) as Record<string, unknown>, result: { ...c.result, text: text(c.result.text) } }));
}

/** A Port Alder chat after one turn, then the script's calls through `call`, in order, each with its answer, read alike (`normalized`). */
export async function parityRun(cli: CliRig, call: (name: string, args: Record<string, unknown>) => Promise<ToolResult>): Promise<ParityCall[]> {
  const created = await cli.call("lre_world_create", { name: "Port Alder", template: "modern_slice_of_life" });
  const worldId = String(created.worldId);
  const chatId = cli.rig.host.createChat("Morning.");
  await cli.call("lre_attach", { worldId, chatId });
  await cli.rig.turn(chatId, "Hello.", "A quiet morning on Harbor Street.");
  const out: ParityCall[] = [];
  const run = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
    const result = await call(name, args);
    out.push({ name, args, result });
    return result;
  };
  const c = { chatId };
  await run("lre_chat_state", { ...c, pointer: "/hud" });
  await run("lre_chat_state", { ...c, pointer: "/controls", from: 0, limit: 2 });
  await run("lre_chips", c);
  await run("lre_inspector", { ...c, pointer: "/generations" });
  await run("lre_gm", c);
  await run("lre_gm", { ...c, spoilers: true });
  await run("lre_gm", { ...c, spoilers: true, entity: "Danny Okafor" });
  await run("lre_gm", { ...c, spoilers: true, party: "danny_okafor", account: "nothing_by_that_name" });
  await run("lre_gm", { ...c, spoilers: true, part: "entities", kind: "person", compact: true, from: 0, limit: 3 });
  await run("lre_sections", { ...c, spoilers: true, pointer: "", from: 0, limit: 3 });
  await run("lre_minds", { ...c, spoilers: true });
  await run("lre_items_find", { ...c, words: "the keys" });
  await run("lre_items_find", { ...c, spoilers: true, words: "the keys" });
  await run("lre_orgs", c);
  await run("lre_orgs", { ...c, org: "Alder Automotive", part: "people", spoilers: true });
  await run("lre_fix", { ...c, fix: "weather", value: "rain" });
  const chips = await run("lre_chips", c);
  const undo = /"id": "(fix:[^"]+)"/.exec(chips.text)?.[1] ?? "none";
  await run("lre_chip", { ...c, chip: undo, choice: "undo" });
  await run("lre_fix", { ...c, time: "2026-09-14 09:30" });
  await run("lre_gm_edit", { ...c, ops: [{ op: "move", entity: "pov", to: "bluebird_coffee" }] });
  await run("lre_gm_edit", { ...c, spoilers: true, ops: [{ op: "move", entity: "pov", to: "bluebird_coffee" }] });
  await run("lre_gm_edit", { ...c, spoilers: true, ops: [{ op: "item", change: { do: "move", item: "pov_flashlight", to: { in: "pov" }, why: "Jordan takes the flashlight from the glovebox" } }] });
  const booth = [{ op: "place", change: { do: "make", name: "Back booth", parent: "rusty_anchor", as: "spot", why: "the back booth at the Rusty Anchor" } }];
  await run("lre_gm_edit", { ...c, spoilers: true, ops: booth });
  await run("lre_gm_edit", { ...c, spoilers: true, ops: booth });
  await run("lre_gm_edit", { ...c, spoilers: true, ops: [{ op: "org", change: { do: "position", org: "alder_automotive_co", position: { id: "shop_foreman", title: "Shop foreman", powers: ["staff.hire"] } } }, { op: "org", change: { do: "appoint", org: "alder_automotive_co", who: "danny_okafor", position: "shop_foreman", why: "Marcus wants someone running the floor" } }] });
  await run("lre_mind_edit", { ...c, spoilers: true, ops: [{ op: "mind_pin", entity: "danny_okafor", level: "live" }] });
  await run("lre_mind_edit", { ...c, spoilers: true, ops: [{ op: "move", entity: "pov", to: "yard" }] });
  await run("lre_marker", { ...c, kind: "time", control: "scale", to: 2, preview: true });
  await run("lre_marker", { ...c, kind: "time", control: "scale", to: 2 });
  await run("lre_marker", { ...c, kind: "nonsense", to: 1 });
  await run("lre_view_open", { ...c, panel: "economy.money" });
  await run("lre_keep", { ...c, choice: "keep", messageId: "no_such_message" });
  await run("lre_action", { ...c, action: "withdraw_cash", params: { account: "acct_pov_checking", amount: 2000 } });
  await run("lre_day", { ...c, entity: "danny_okafor", view: "player" });
  await run("lre_day", { ...c, entity: "danny_okafor", view: "gm" });
  await run("lre_day", { ...c, entity: "danny_okafor", view: "gm", spoilers: true });
  await run("lre_routine_changes", c);
  await run("lre_routine_edit", { ...c, spoilers: true, ops: [{ op: "routine_follow", entity: "danny_okafor", mode: "no_invitations" }] });
  await run("lre_routine_changes", { ...c, spoilers: true });
  await run("lre_minds_run", c);
  await run("lre_minds_cancel", { ...c, runId: "no_such_run" });
  await run("lre_timelapse", { ...c, target: { type: "duration", minutes: 60 } });
  await run("lre_chat_state", { ...c, pointer: "/activity" });
  await run("lre_chat_state", { chatId: "c_nowhere" });
  await run("lre_lore_books", {});
  await run("lre_lore_books", c);
  await run("lre_lore_entries", { bookId: "no_such_book" });
  await run("lre_lore_index", { worldId });
  await run("lre_lore_pins", { worldId });
  await run("lre_lore_pins", c);
  await run("lre_lore_pins", { ...c, spoilers: true });
  await run("lre_lore_save", { ...c, text: "A quiet morning" });
  await run("lre_lore_fields", { bookId: "no_such_book", entryId: "e1", fields: null });
  await run("lre_chat_state", { ...c, bogus: true });
  return normalized(out, { worldId, chatId });
}

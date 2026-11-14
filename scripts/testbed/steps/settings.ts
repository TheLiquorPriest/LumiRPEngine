// Item 11 and the settings the later steps play under. Model choices that name a Lumiverse
// connection: the agents engine's main agent and the GM assistant of classic and agents chats are
// set to the test bed's Lumiverse connection (the helper model already names it on this account; the
// step only reads that). Without its own, the main agent finds no connection and its final review
// fails. A few kinds of change are pinned to ask first, so that turns leave confirm chips and review
// cards (Settings → Changes from the reply). All through the CLI's `settings-set`, Settings' patch.

import type { Ctx, Step } from "../lib/context";
import { say } from "../lib/record";

type Pick = { connectionId?: string | null };

interface Settings {
  helper?: Pick;
  agents?: { assistant?: Pick; main?: Pick; review?: { placement?: string } };
  extraction?: { [type: string]: { mode?: string } };
}

/** Kinds of change that ask first on every engine: where people go, how they regard one another, and things handed over. */
const ASK_FIRST = ["location", "regard", "item_hand"];
/** The agents engine's own agents given the Lumiverse connection by name. */
const AGENTS = ["assistant", "main"] as const;

export const settings: Step = {
  name: "settings",
  makes: "model choices naming a Lumiverse connection, and changes that ask first",
  async run(ctx: Ctx) {
    const read = async (): Promise<Settings> => (await ctx.socket.lre<{ settings: Settings }>("lre.settings.get")).settings;
    const now = await read();
    say(`the helper model names ${now.helper?.connectionId ?? "no connection (Lumiverse's active one)"}`);
    const unset = AGENTS.filter((agent) => now.agents?.[agent]?.connectionId !== ctx.connectionId);
    const pins = ASK_FIRST.filter((type) => now.extraction?.[type]?.mode !== "confirm");
    const patch: { [key: string]: unknown } = {};
    if (unset.length > 0) patch.agents = { ...Object.fromEntries(unset.map((agent) => [agent, { connectionId: ctx.connectionId, model: null }])), review: { placement: "chips" } };
    if (pins.length > 0) patch.extraction = Object.fromEntries(pins.map((type) => [type, { mode: "confirm" }]));
    if (Object.keys(patch).length === 0) {
      say("the settings stand as the test instance needs");
      return;
    }
    await ctx.cli.run(["settings-set", "--patch", JSON.stringify(patch)]);
    const after = await read();
    for (const agent of unset) {
      if (after.agents?.[agent]?.connectionId !== ctx.connectionId) throw new Error(`the ${agent} agent's connection didn't take`);
      ctx.log.log({ step: "settings", action: "changed", kind: "settings (settings.json)", id: `agents.${agent}.connectionId`, detail: { connectionId: ctx.connectionId } });
    }
    for (const type of pins) ctx.log.log({ step: "settings", action: "changed", kind: "settings (settings.json)", id: `extraction.${type}.mode`, detail: { mode: after.extraction?.[type]?.mode ?? null } });
  },
};

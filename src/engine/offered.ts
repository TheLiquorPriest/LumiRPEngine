// The actions a chat is offered (RULESET-DESIGN §3): the packs' and the world's own, less those of the tabletop rules layer while the chat's
// level of its domain is off. A world that leaves the layer out reads as off, and a chat that switches it off ("For this chat") has none of its
// actions on the player's actions sheet, in what the agents are told the world has, or among what a typed sentence may mean; a sheet's fields
// and everything else of it stay as they are, and switching it on again gives the actions back. The world's own action of the same id is the
// world's, offered whatever the level.

import { D20_PACK } from "../shared/d20";
import type { ActionDef } from "../shared/world";
import type { ReadContext } from "./registry";
import type { Registry } from "./registry-impl";

/** Whether the layer is switched off for this chat: its level of the domain, as the chat's point of view reads it, is 0. */
export function layerOff(ctx: ReadContext): boolean {
  return ctx.levelOf(ctx.world.pov, D20_PACK) < 1;
}

/** Every action the chat is offered, by id: the packs', less the layer's while it is off, and the world's own over a pack's of the same id. */
export function offeredActions(reg: Registry, ctx: ReadContext): Map<string, ActionDef> {
  const off = layerOff(ctx);
  const out = new Map<string, ActionDef>();
  for (const [id, a] of reg.actions) if (!(off && a.pack === D20_PACK)) out.set(id, a);
  for (const [id, a] of Object.entries(ctx.world.actions)) out.set(id, a);
  return out;
}

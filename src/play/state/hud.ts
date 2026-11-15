// The HUD the player reads: the clock, the place, the weather and the cash, and the ✎ each of them
// offers. Pure, over a world, its state, the pack panels already built and their read context.

import { calendarMonths, calendarOf, dayPartAt, formatClock, formatStamp, placeOffset } from "../../engine/calendar";
import { knownPlaceRefs } from "../../engine/character";
import { optionalQuery } from "../../engine/pack-kit";
import type { ReadContext } from "../../engine/registry";
import { placeOfEntity } from "../../engine/scope";
import type { WorldState } from "../../engine/state";
import { clockPaused, placeSceneType } from "../../engine/time";
import { canSeePlace, povPlace } from "../../engine/visibility";
import type { PanelId } from "../../shared/ids";
import type { JsonValue } from "../../shared/json";
import { isRecord } from "../../shared/json";
import type { HudView } from "../../shared/state-view";
import type { WorldDoc } from "../../shared/world";
import { knownSceneTypes } from "./scene";

export function hud(world: WorldDoc, state: WorldState, panels: Record<PanelId, JsonValue>, ctx: ReadContext): HudView {
  const cal = calendarOf(world);
  const pov = world.pov;
  const placeId = placeOfEntity(state, pov);
  // The pill and the ✎ name the POV's place as every player surface does: one it can't see is
  // "Somewhere", with no id.
  const shown = povPlace(ctx.registry, world, state);
  const offset = placeOffset(world, state.clock, placeId);
  const money = ctx.levelOf(pov, "money");
  const economy = panels["economy.money"];
  const band = isRecord(economy) && typeof economy.band === "string" ? economy.band : null;
  // The economy pack's panel knows the POV's cash accounts; without it, the POV's account or cash field.
  const panelCash = isRecord(economy) && isRecord(economy.cash) ? economy.cash : null;
  const cents = panelCash && typeof panelCash.cents === "number" ? panelCash.cents : (state.accounts[pov] ?? (typeof state.entities[pov]?.fields.cash === "number" ? Number(state.entities[pov]?.fields.cash) : null));
  const weatherPanel = panels["weather.weather"] ?? panels["weather.now"];
  const weather = isRecord(weatherPanel) && typeof weatherPanel.label === "string" ? weatherPanel.label : null;
  const fixes: HudView["fixes"] = {};
  // The clock's ✎ (DESIGN §12) sets a date and a time of day in the world's calendar, starting from
  // now as the pill reads it, local to the POV's place; it needs the calendar, as a Timelapse does.
  if (ctx.levelOf(pov, "calendar") >= 1) fixes.time = { type: "time", value: formatStamp(cal, state.clock, offset), ...calendarMonths(cal) };
  if (placeId) {
    // The ✎ offers the places the POV may see; a hidden one, even where it stands, is never offered,
    // nor named in another's path or as its parent (`knownPlaceRefs`), for the place sheet.
    const seen = (id: string): boolean => canSeePlace(ctx.registry, world, state, pov, id);
    const options = Object.values(world.places).filter((p) => seen(p.id));
    fixes.place = { entity: pov, field: "place", type: "ref", value: shown?.id ?? null, options: options.map((p) => ({ value: p.id, label: p.name })), places: knownPlaceRefs(world, seen) };
  }
  // Cash from the economy panel is the POV's cash accounts: its ✎ posts a correction to them
  // (`lre.fix`), so it needs one. Without the panel's cash, the ✎ sets the cash field the pill shows.
  const cashAccount = isRecord(economy) && Array.isArray(economy.accounts) && economy.accounts.some((a) => isRecord(a) && a.kind === "cash");
  if (money >= 2 && cents !== null && (typeof panelCash?.cents !== "number" || cashAccount)) fixes.cash = { entity: pov, field: "cash", type: "money", value: cents, min: 0 };
  // Weather lives on the region over the player; the weather pack knows its climate's states.
  const weatherFix = optionalQuery(ctx, "weather.fix")?.(ctx) ?? null;
  if (weatherFix) fixes.weather = weatherFix;
  // The scene type lives in the POV's `scene` field, which wins over its place's default until an
  // action, a rule or another fix sets it; "" goes back to following the place. The ✎ offers the
  // scene types the POV may know of (`knownSceneTypes`), and only those: it doesn't name the place
  // default's type, or count a pinned one as current, when that is another type.
  const pinned = state.entities[pov]?.fields.scene;
  if (state.entities[pov]) {
    const types = knownSceneTypes(ctx.registry, world, state);
    const label = (type: string) => `${type.charAt(0).toUpperCase()}${type.slice(1).replace(/_/g, " ")}`;
    const placeDefault = placeSceneType(world, state);
    const value = typeof pinned !== "string" || pinned === "" ? "" : types.has(pinned) ? pinned : null;
    fixes.scene = { entity: pov, field: "scene", type: "text", value, options: [{ value: "", label: types.has(placeDefault) ? `Place default (${label(placeDefault)})` : "Place default" }, ...[...types].map((type) => ({ value: type, label: label(type) }))] };
  }
  return {
    // Paused as the engine reads it: for the scene it was paused in, so a scene change shows the clock running.
    clock: { minutes: state.clock, label: formatClock(cal, state.clock, offset), dayPart: dayPartAt(cal, state.clock + offset).label, paused: clockPaused(world, state), scale: state.time.scale },
    place: shown,
    weather,
    cash: money === 0 ? null : money === 1 ? (band ? { band } : panelCash && typeof panelCash.band === "string" ? { band: panelCash.band } : null) : cents === null ? null : { cents },
    fixes,
  };
}

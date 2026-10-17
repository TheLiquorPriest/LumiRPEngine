// A new chat's starting markers (DESIGN §4.3, §9.1, §9.2, §11): the world revision, every domain
// level, the band caps, every time control and the adjudication policy, written once, with the first
// record that holds events. The world's own realism and time defaults come first and the user's
// settings fill in what the world leaves out; with "Use my settings" on, the user's settings replace
// the world's. The policy is the world ruleset's, unless the user's own replaces it or the world sets none.

import { readAdjudication } from "../shared/adjudication";
import type { Level } from "../shared/ids";
import { BANDS, DOMAINS, INTERRUPT_CLASSES } from "../shared/ids";
import { hasOwn, isRecord, safeKey } from "../shared/json";
import type { MarkerBody } from "../shared/ledger";
import type { TimeSettings, UserSettings } from "../shared/settings";
import type { WorldDoc } from "../shared/world";

const LEVELS: readonly Level[] = [0, 1, 2, 3, 4];

/** The value a document sets under a key: its own value only (a world is outside data). */
function at(map: unknown, key: string): unknown {
  return isRecord(map) && hasOwn(map, key) ? map[key] : undefined;
}

/** A level a document sets under a key: a whole number 0–4; anything else isn't one. */
function levelAt(map: unknown, key: string): Level | undefined {
  const v = at(map, key);
  return LEVELS.find((l) => l === v);
}

/**
 * The time controls a new chat starts with: the world's where it sets them, the user's for the rest
 * (the time scale, NPC calls, and any scene type, interrupt class or activity the world doesn't
 * name, or names with a value that isn't one).
 */
function worldFirstTime(user: TimeSettings, world: WorldDoc): TimeSettings {
  const w: unknown = world.time;
  const sceneTicks = { ...user.sceneTicks };
  const ticks = at(w, "sceneTicks");
  for (const [type, minutes] of Object.entries(isRecord(ticks) ? ticks : {})) if (safeKey(type) && typeof minutes === "number" && Number.isFinite(minutes)) sceneTicks[type] = minutes;
  const interrupts = { ...user.interrupts };
  for (const cls of INTERRUPT_CLASSES) {
    const policy = at(at(w, "interrupts"), cls);
    if (policy === "stop" || policy === "note" || policy === "ignore") interrupts[cls] = policy;
  }
  const speedThrough = { ...user.speedThrough };
  const speeds = at(w, "speedThrough");
  for (const [activity, s] of Object.entries(isRecord(speeds) ? speeds : {})) {
    if (safeKey(activity) && isRecord(s) && (s.mode === "offer" || s.mode === "auto") && typeof s.thresholdMinutes === "number" && Number.isFinite(s.thresholdMinutes)) speedThrough[activity] = { mode: s.mode, thresholdMinutes: s.thresholdMinutes };
  }
  const montage = at(w, "montage");
  const cap = at(w, "unitCap");
  const unitCap = isRecord(cap) && typeof cap.agentDays === "number" && Number.isFinite(cap.agentDays) && typeof cap.events === "number" && Number.isFinite(cap.events) ? { agentDays: cap.agentDays, events: cap.events } : user.unitCap;
  return { ...user, sceneTicks, interrupts, speedThrough, montage: montage === "key" || montage === "day" || montage === "week" ? montage : user.montage, unitCap };
}

/**
 * Starting markers for a chat on `revision` of `world`: `migrate`, a `resolve` for every domain's
 * level and for the band caps, a `time` marker for every time control, and `adjudicate`.
 */
export function startMarkersFrom(settings: UserSettings, world: WorldDoc, revision: string): MarkerBody[] {
  const mine = settings.overrideWorldDefaults;
  const out: MarkerBody[] = [{ kind: "migrate", to: revision }];
  for (const domain of DOMAINS) out.push({ kind: "resolve", domain, scope: { all: true }, to: (mine ? undefined : levelAt(world.realism.levels, domain)) ?? settings.realism.levels[domain] });
  for (const band of BANDS) {
    // A band the world caps at all is the world's whole say for it (an absent cap is the domain
    // level); the chat starts from those caps, so one the seed doesn't keep is lifted to 4.
    const authored = at(world.realism.tierCaps, band);
    const caps: unknown = mine || !isRecord(authored) ? settings.realism.tierCaps[band] : authored;
    for (const domain of DOMAINS) {
      const to = levelAt(caps, domain) ?? (at(authored, domain) !== undefined ? 4 : undefined);
      if (to !== undefined) out.push({ kind: "resolve", domain, scope: { tier: band }, to });
    }
  }
  const t = mine ? settings.time : worldFirstTime(settings.time, world);
  for (const [sceneType, minutes] of Object.entries(t.sceneTicks)) out.push({ kind: "time", control: "tick", scope: { sceneType }, to: minutes });
  out.push({ kind: "time", control: "scale", scope: { all: true }, to: t.scale });
  for (const cls of INTERRUPT_CLASSES) out.push({ kind: "time", control: "interrupt", scope: { interrupt: cls }, to: t.interrupts[cls] });
  for (const [activity, policy] of Object.entries(t.speedThrough)) out.push({ kind: "time", control: "speed_through", scope: { activity }, to: { mode: policy.mode, thresholdMinutes: policy.thresholdMinutes } });
  out.push({ kind: "time", control: "montage", scope: { all: true }, to: t.montage });
  out.push({ kind: "time", control: "unit_cap", scope: { all: true }, to: { agentDays: t.unitCap.agentDays, events: t.unitCap.events } });
  out.push({ kind: "time", control: "npc_calls", scope: { all: true }, to: t.npcCallsPerTimelapse });
  const authored = readAdjudication(world.ruleset?.adjudication);
  out.push({ kind: "adjudicate", to: authored && !settings.overrideWorldAdjudication ? authored : settings.adjudication });
  return out;
}

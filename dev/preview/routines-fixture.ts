// GM → Routines in the preview (DESIGN §8): each character's routine, schedules and day as the
// engine's read model gives them to the GM (`lre.routine {op: "day", view: "gm"}`), and who this chat
// changed (`{op: "changed"}`). This chat's changes are kept here, as the castlife slice keeps them, so
// the tab's controls apply and their Undo restores: Dev Patel's routine rests on his sheet and on the
// world's lore, the story switched a block off and you added one; Mr. Pemberton makes no invitations
// in this chat.

import { calendarOf, formatClock } from "../../src/engine/calendar";
import type { EntityId, ScheduleId } from "../../src/shared/ids";
import type { ChatRoutineSource, ChatScheduleChange, EffectiveBlock, EffectiveSchedule, InvitationView, LaidBlock, OwnerRef, RoutineBlock, RoutineBlockId, RoutineChangeSummary, RoutineEditOp, RoutineEntry, RoutineFollow, RoutineGmView, RoutineRole, SourceView, StoryHoldView } from "../../src/shared/routines";
import { BASIC_BLOCKS, DEFAULT_ROUTINE_SETTINGS, isOff, ROUTINE_MODE_LABEL } from "../../src/shared/routines";
import type { GmView } from "../../src/shared/state-view";
import { worldFixture } from "./fixtures";

/** This chat's routine changes, as the castlife slice keeps them. */
export interface PreviewRoutines {
  follow: Record<EntityId, RoutineFollow>;
  blocks: Record<EntityId, Record<RoutineBlockId, { value: RoutineEntry; source: ChatRoutineSource }>>;
  schedules: Record<EntityId, Record<ScheduleId, { value: ChatScheduleChange; source: ChatRoutineSource }>>;
}

const CAL = calendarOf(worldFixture());
const clock = (at: number): string => formatClock(CAL, at);

const CHAT: OwnerRef = { level: "chat", name: "This chat", rank: 0 };
const WORLD: OwnerRef = { level: "world", name: "Everyone", rank: 5 };
const BASIC: OwnerRef = { level: "builtin", name: "Basic needs", rank: 6 };
const own = (id: EntityId, name: string): OwnerRef => ({ level: "own", id, name, rank: 1 });

// Labels as the engine's `sourceView` gives them.
const AUTHORED: SourceView = { type: "authored", label: "Authored" };
const BUILTIN: SourceView = { type: "builtin", label: "Basic needs" };
const KIMS: SourceView = { type: "lore", entry: "kims_garage", title: "Kim's Garage", quote: "Dev opens up at half past seven and works till the light goes.", label: "Lore: Kim's Garage" };
const DINER: SourceView = { type: "lore", entry: "rosies_diner", title: "Rosie's Diner", quote: "Rosie's opens at six and closes at three.", label: "Lore: Rosie's Diner" };

function chatSource(source: ChatRoutineSource): SourceView {
  return source.type === "gm" ? { ...source, label: "The GM" } : { ...source, label: "The story" };
}

const basics = (): EffectiveBlock[] => BASIC_BLOCKS.map((block) => ({ block: structuredClone(block), routine: null, owner: BASIC, source: BUILTIN, off: false, shadowed: [] }));

/** The world's side of someone's routine: their basic needs, with blocks of their routines over them. */
function routineOf(blocks: { block: RoutineBlock; routine: string; owner: OwnerRef; source: SourceView }[]): EffectiveBlock[] {
  const out = basics();
  for (const b of blocks) {
    const i = out.findIndex((x) => x.block.id === b.block.id);
    const under = out[i];
    const next: EffectiveBlock = { block: b.block, routine: b.routine, owner: b.owner, source: b.source, off: false, shadowed: under ? [{ routine: under.routine, owner: under.owner, source: under.source, block: under.block }, ...under.shadowed] : [] };
    if (under) out[i] = next;
    else out.push(next);
  }
  return out;
}

interface Base {
  blocks: EffectiveBlock[];
  schedules: EffectiveSchedule[];
  day: LaidBlock[];
  story: StoryHoldView[];
  invitations: { made: InvitationView[]; received: InvitationView[] };
}

const NOW = 1902;
const TODAY = 1440;
/** Dev's flat: no place of the world's, so the read model names it only. */
const HOME: [string, string] = ["dev_flat", "Dev's flat"];
const laid = (from: string, to: string, label: string, activity: string, kind: LaidBlock["kind"], origin: LaidBlock["origin"], place: [string, string] | null, reasons: string[] = []): LaidBlock => {
  const at = (t: string) => TODAY + Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return { start: at(from), end: at(to), from, to, label, activity, place: place?.[0] ?? null, placeName: place?.[1] ?? null, kind, reasons, origin };
};

function devBase(): Base {
  const dev = own("npc_dev", "Dev Patel");
  const sheet: SourceView = { type: "sheet", entity: "npc_dev", field: "motive", quote: "Owes Kim's Garage for the jon boat parts", label: "Dev Patel · motive" };
  const night: SourceView = { type: "sheet", entity: "npc_dev", field: "tags", quote: "night_owl", label: "Dev Patel · tags" };
  const boat: RoutineBlock = { id: "jon_boat", label: "Work on the jon boat", activity: "leisure", kind: "flexible", window: { from: "18:00", to: "22:00" }, minutes: 120, perWeek: 3, place: { place: "garage" }, company: { who: { ids: ["pov"] }, invite: true }, priority: 3 };
  const sleep: RoutineBlock = { id: "sleep", label: "Sleep late", activity: "sleep", kind: "flexible", window: { from: "23:30", to: "02:00" }, minutes: 420, priority: 5, place: "home", needs: ["fatigue"] };
  const hoops: RoutineBlock = { id: "hoops", label: "Pick-up basketball", activity: "socialize", kind: "optional", window: { from: "19:00", to: "21:00" }, minutes: 90, perWeek: 1, chance: 0.5, place: { nearest: "park" }, days: { off: "only" } };
  const slot = (start: string, end: string, value: string) => ({ start, end, value, sourceView: AUTHORED });
  return {
    blocks: routineOf([
      { block: sleep, routine: "dev_days", owner: dev, source: night },
      { block: boat, routine: "dev_days", owner: dev, source: sheet },
      { block: hoops, routine: "town_evenings", owner: WORLD, source: AUTHORED },
    ]),
    schedules: [
      { schedule: "dev_shift", target: "place", owner: dev, source: KIMS, recurrence: { every: "week", weekdays: [1, 2, 3, 4, 5] }, slots: [{ ...slot("07:30", "16:30", "garage"), sourceView: KIMS }], shadowedBy: [], chat: null },
      { schedule: "mechanic_shift", target: "place", owner: { level: "kind", id: "mechanic", name: "Mechanic", rank: 3 }, source: AUTHORED, recurrence: { every: "week", weekdays: [1, 2, 3, 4, 5] }, slots: [slot("08:00", "17:00", "garage")], shadowedBy: ["dev_shift"], chat: null },
      { schedule: "dev_activity", target: "activity", owner: dev, source: AUTHORED, recurrence: { every: "day" }, slots: [slot("07:30", "16:30", "work"), slot("16:30", "07:30", "home")], shadowedBy: [], chat: null },
    ],
    day: [
      laid("00:00", "07:00", "Sleep late", "sleep", "sleep", { type: "routine", block: "sleep", owner: dev, source: night }, HOME, ["fatigue was high"]),
      laid("07:00", "07:30", "Breakfast", "breakfast", "other", { type: "routine", block: "breakfast", owner: BASIC, source: BUILTIN }, HOME),
      laid("07:30", "12:00", "Work", "work", "work", { type: "schedule", schedule: "dev_shift", owner: dev, source: KIMS }, ["garage", "Kim's Garage"]),
      laid("12:00", "12:45", "Lunch", "lunch", "other", { type: "routine", block: "lunch", owner: BASIC, source: BUILTIN }, ["garage", "Kim's Garage"], ["at work"]),
      laid("12:45", "16:30", "Work", "work", "work", { type: "schedule", schedule: "dev_shift", owner: dev, source: KIMS }, ["garage", "Kim's Garage"]),
      laid("17:00", "18:00", "At Rosie's Diner", "socialize", "other", { type: "plan", plan: "pl_dev_diner", source: "memory", made: NOW - 30 }, ["diner", "Rosie's Diner"], ["the story put him at the diner"]),
      laid("18:30", "20:30", "Work on the jon boat", "leisure", "free", { type: "routine", block: "jon_boat", owner: dev, source: sheet }, ["garage", "Kim's Garage"], ["2 of 3 this week", "invites you"]),
      laid("20:30", "21:30", "Dinner", "dinner", "other", { type: "routine", block: "dinner", owner: BASIC, source: BUILTIN }, HOME),
      laid("21:30", "23:30", "Free time", "leisure", "free", { type: "free" }, HOME),
    ],
    story: [{ field: "place", value: "diner", label: "At Rosie's Diner", since: NOW - 30, until: null, by: "story" }],
    invitations: {
      made: [{ key: "inv_boat", host: "npc_dev", hostName: "Dev Patel", guests: ["pov"], at: TODAY + 18 * 60 + 30, when: clock(TODAY + 18 * 60 + 30), place: "garage", placeName: "Kim's Garage", text: "Dev invites you to Kim's Garage at 18:30.", origin: { type: "routine", block: "jon_boat", source: sheet }, status: "planned" }],
      received: [{ key: "inv_banner", host: "npc_mara", hostName: "Mara Lopez", guests: ["npc_dev"], at: TODAY + 20 * 60, when: clock(TODAY + 20 * 60), place: "apartment", placeName: "Apartment 4B", text: "Mara asks Dev over to hang the banner at 20:00.", origin: { type: "plan", plan: "pl_mara_banner" }, status: "sent" }],
    },
  };
}

function rosieBase(): Base {
  const rosie = own("npc_rosie", "Rosie Alvarez");
  const open: RoutineBlock = { id: "open_diner", label: "Open the diner", activity: "work", kind: "fixed", at: "05:00", minutes: 30, days: { weekdays: [1, 2, 3, 4, 5, 6] }, place: { place: "diner" }, priority: 5 };
  return {
    blocks: routineOf([{ block: open, routine: "rosie_days", owner: rosie, source: DINER }]),
    schedules: [
      { schedule: "rosie_shift", target: "place", owner: rosie, source: DINER, recurrence: { every: "week", weekdays: [1, 2, 3, 4, 5, 6], except: ["thanksgiving"] }, slots: [{ start: "05:30", end: "14:00", value: "diner", sourceView: DINER }], shadowedBy: [], chat: null },
      { schedule: "crew_breakfast", target: "place", owner: { level: "selector", name: "Rosie's crew, allies and regulars", rank: 4 }, source: AUTHORED, recurrence: { every: "week", weekdays: [0] }, slots: [{ start: "08:00", end: "09:00", value: "diner", sourceView: AUTHORED }], shadowedBy: [], chat: null },
    ],
    day: [
      laid("05:00", "05:30", "Open the diner", "work", "work", { type: "routine", block: "open_diner", owner: rosie, source: DINER }, ["diner", "Rosie's Diner"]),
      laid("05:30", "14:00", "Work", "work", "work", { type: "schedule", schedule: "rosie_shift", owner: rosie, source: DINER }, ["diner", "Rosie's Diner"]),
    ],
    story: [],
    invitations: { made: [], received: [] },
  };
}

function pembertonBase(): Base {
  const pemberton = own("npc_pemberton", "Mr. Pemberton");
  const swim: RoutineBlock = { id: "swim", label: "Morning swim", activity: "leisure", kind: "fixed", at: "06:00", minutes: 45, place: { nearest: "pool" }, private: true };
  return {
    blocks: routineOf([{ block: swim, routine: "pemberton_days", owner: pemberton, source: { type: "lore", entry: "pemberton", title: "Mr. Pemberton", quote: "swims forty lengths before anyone else is up", label: "Lore: Mr. Pemberton" } }]),
    schedules: [],
    day: [laid("06:00", "06:45", "Morning swim", "leisure", "other", { type: "routine", block: "swim", owner: pemberton, source: AUTHORED }, null), laid("10:00", "11:00", "Meet the broker about the diner", "work", "work", { type: "plan", plan: "pl_pemberton_broker", source: "memory", made: 960 }, null, ["a story plan bends his day"])],
    story: [],
    invitations: { made: [], received: [] },
  };
}

const BASES: Record<string, () => Base> = { npc_dev: devBase, npc_rosie: rosieBase, npc_pemberton: pembertonBase };

/** The chat's changes the preview starts with: the story switched Dev's basketball off, you added his late coffee, and Mr. Pemberton makes no invitations. */
export function previewRoutines(): PreviewRoutines {
  const late: RoutineBlock = { id: "late_coffee", label: "Late coffee at Rosie's", activity: "leisure", kind: "optional", window: { from: "15:00", to: "17:00" }, minutes: 30, chance: 0.6, place: { place: "diner" } };
  return {
    follow: { npc_pemberton: { mode: "no_invitations", awareness: null, role: null, skips: null } },
    blocks: { npc_dev: { hoops: { value: { id: "hoops", off: true }, source: { type: "story", at: NOW - 620, turn: "m3" } }, late_coffee: { value: late, source: { type: "gm", at: NOW - 40 } } } },
    schedules: {},
  };
}

/** One character's routine as the GM reads it, this chat's changes over the world's; null for someone who isn't a character. */
export function routineGmFixture(entity: EntityId, routines: PreviewRoutines, gm: GmView): RoutineGmView | null {
  const c = gm.minds.characters.find((x) => x.entity === entity);
  const e = gm.entities.find((x) => x.id === entity);
  if (!c || !e) return null;
  const base = BASES[entity]?.() ?? { blocks: basics(), schedules: [], day: [], story: [], invitations: { made: [], received: [] } };
  const planned = e.agent && !e.gone && e.life.acts && (e.levels.find((l) => l.domain === "castlife")?.level ?? 0) >= 3;
  const blocks = base.blocks.map((b) => structuredClone(b));
  for (const [id, change] of Object.entries(routines.blocks[entity] ?? {})) {
    const i = blocks.findIndex((b) => b.block.id === id);
    const under = blocks[i];
    const next: EffectiveBlock = { block: structuredClone(change.value), routine: null, owner: CHAT, source: chatSource(change.source), off: isOff(change.value), shadowed: under ? [{ routine: under.routine, owner: under.owner, source: under.source, block: under.block }, ...under.shadowed] : [] };
    if (under) blocks[i] = next;
    else blocks.push(next);
  }
  const schedules = base.schedules.map((s) => {
    const change = routines.schedules[entity]?.[s.schedule];
    return change ? { ...s, chat: { ...structuredClone(change.value), source: chatSource(change.source) } } : s;
  });
  const chat = routines.follow[entity] ?? null;
  const settings = { ...DEFAULT_ROUTINE_SETTINGS };
  const mode = chat?.mode ?? "follows";
  return {
    entity,
    name: c.name,
    tier: c.fidelity.level,
    planned,
    follow: { mode, awareness: chat?.awareness ?? settings.awareness, role: chat?.role ?? settings.roles[c.fidelity.level], skips: chat?.skips ?? settings.skips[c.fidelity.level], chat },
    skip: null,
    settings,
    blocks,
    schedules,
    day: { index: 1, label: "Tuesday", blocks: planned && mode !== "off" ? base.day : planned ? base.day.filter((b) => b.origin.type !== "routine") : [] },
    story: base.story,
    invitations: mode === "follows" ? base.invitations : { made: [], received: base.invitations.received.filter((i) => i.origin.type !== "routine") },
  };
}

/** Everyone this chat changed, and what of them. */
export function routineChangedFixture(routines: PreviewRoutines, gm: GmView): RoutineChangeSummary[] {
  const ids = [...new Set([...Object.keys(routines.follow), ...Object.keys(routines.blocks), ...Object.keys(routines.schedules)])];
  return ids
    .map((entity) => ({
      entity,
      name: gm.entities.find((e) => e.id === entity)?.name ?? entity,
      follow: routines.follow[entity] ?? null,
      blocks: Object.entries(routines.blocks[entity] ?? {}).map(([block, c]) => ({ block, source: c.source, off: isOff(c.value) })),
      schedules: Object.entries(routines.schedules[entity] ?? {}).map(([schedule, c]) => ({ schedule, source: c.source, off: "off" in c.value })),
    }))
    .filter((s) => s.follow !== null || s.blocks.length > 0 || s.schedules.length > 0);
}

/** Everyone this chat set a routine role for, with it, as the castlife pack's `castlife.chat_roles` reads its slice: what the GM view carries. */
export function chatRolesFixture(routines: PreviewRoutines): { entity: EntityId; role: RoutineRole }[] {
  return Object.entries(routines.follow)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([entity, follow]) => (follow.role === null ? [] : [{ entity, role: follow.role }]));
}

/** Applies one of the GM's routine edits to this chat's changes, as the castlife slice folds it, and words it for the Journal. */
export function applyRoutineOp(routines: PreviewRoutines, op: RoutineEditOp, name: string, now: number): string {
  if (op.op === "routine_follow") {
    const was = routines.follow[op.entity] ?? { mode: null, awareness: null, role: null, skips: null };
    const next: RoutineFollow = { mode: op.mode === undefined ? was.mode : op.mode, awareness: op.awareness === undefined ? was.awareness : op.awareness, role: op.role === undefined ? was.role : op.role, skips: op.skips === undefined ? was.skips : op.skips };
    if (next.mode === null && next.awareness === null && next.role === null && next.skips === null) delete routines.follow[op.entity];
    else routines.follow[op.entity] = next;
    return `${name}: ${ROUTINE_MODE_LABEL[next.mode ?? "follows"].toLowerCase()}`;
  }
  if (op.op === "routine_block") {
    const blocks = (routines.blocks[op.entity] ??= {});
    if (op.value === null) delete blocks[op.block];
    else blocks[op.block] = { value: structuredClone(op.value), source: { type: "gm", at: now } };
    return op.value === null ? `${name}'s ${op.block.replace(/_/g, " ")}: as the world has it` : isOff(op.value) ? `${name}'s ${op.block.replace(/_/g, " ")}: off` : `${name}'s routine: ${op.value.label}`;
  }
  const schedules = (routines.schedules[op.entity] ??= {});
  if (op.value === null) delete schedules[op.schedule];
  else schedules[op.schedule] = { value: structuredClone(op.value), source: { type: "gm", at: now } };
  return `${name}'s ${op.schedule.replace(/_/g, " ")}: ${op.value === null ? "as the world has it" : "off" in op.value ? "off" : "their own version"}`;
}

// Build → Routines and Routines and the story (#48): the routine editor's and the tuning editor's
// writes, sent to a real backend's draft and read back as the world keeps them, the Timelapse
// sheet's Follow my routine starting at the world's default and travelling with the request, and a
// routine block's problem opening on that block.

import { describe, expect, test } from "bun:test";
import { createRegistry } from "../../src/engine/registry-impl";
import { issueRoute } from "../../src/frontend/build/check";
import { ownerLevel, type Owner, type OwnerLevel } from "../../src/frontend/build/owner-picker";
import { blankBlock, blockAt, blockFromSlot, blockKindChange, blockSlot, isNoRoutine, routineWrite } from "../../src/frontend/build/routine-editor";
import { RoutineRoleSettings, routineSettingsWrite } from "../../src/frontend/build/routine-settings";
import { HostSwitch, Seg } from "../../src/frontend/components";
import { FollowRoutineChoice } from "../../src/frontend/palette";
import { timelapseRequest } from "../../src/frontend/requests";
import { FIDELITIES } from "../../src/shared/minds";
import { ALL_PACKS } from "../../src/packs/index";
import type { JsonValue } from "../../src/shared/json";
import type { RoutineBlock, RoutineDef, RoutineSettings } from "../../src/shared/routines";
import { blockShapeProblems, DEFAULT_ROUTINE_SETTINGS, ROUTINE_AWARENESS, ROUTINE_INVITATIONS, ROUTINE_PLAN_BEND, ROUTINE_ROLES, ROUTINE_SOCIABILITY, routineSettingsOf, routineShapeProblems } from "../../src/shared/routines";
import type { StateView } from "../../src/shared/state-view";
import type { EntityDef, WorldDoc } from "../../src/shared/world";
import { Rig } from "../support/rig";
import { press, propsOf } from "../support/tree";

/** The draft as Build's forms read it: the packs' kinds merged in, the world's own winning. */
function formDoc(w: WorldDoc): WorldDoc {
  return { ...w, kinds: { ...Object.fromEntries(createRegistry(ALL_PACKS).kinds), ...w.kinds } };
}

/** A starter world in a real backend, with a household (a group) and a lore entry to rest blocks on; its draft, and someone in it. */
async function portAlder(): Promise<{ rig: Rig; worldId: string; person: EntityDef; send(request: Parameters<Rig["send"]>[0]): Promise<WorldDoc> }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const send = async (request: Parameters<Rig["send"]>[0]) => rig.body(await rig.send(request)).draft as WorldDoc;
  const draft = await send({ type: "lre.editor", worldId, base: null, op: "get" });
  const person = Object.values(draft.entities).find((e) => e.id !== draft.pov && ownerLevel(formDoc(draft), e.id) === "entity");
  if (!person) throw new Error("the starter has no one but the player");
  const household: EntityDef = { id: "the_hales", kind: "household", name: "The Hales", tier: person.tier, fields: {}, relations: [] };
  await send({ type: "lre.editor", worldId, base: null, op: "put", collection: "entities", id: household.id, value: household as unknown as JsonValue });
  await send({ type: "lre.editor", worldId, base: null, op: "put", collection: "lore", id: "harbor_gym", value: { id: "harbor_gym", title: "The harbor gym", content: "The night shift lifts at the harbor gym before dawn.", keys: [], links: [] } });
  return { rig, worldId, person, send };
}

describe("Build → Routines", () => {
  test("a routine at each owner level is created, edited and deleted in the draft", async () => {
    const { worldId, person, send } = await portAlder();
    const owners: [Owner, OwnerLevel][] = [
      [person.id, "entity"],
      ["the_hales", "group"],
      [person.kind, "kind"],
      [{ tier: [person.tier] }, "selector"],
      [undefined, "none"],
    ];
    for (const [owner, level] of owners) {
      const id = `days_${level}`;
      const routine: RoutineDef = { id, label: `Days (${level})`, ...(owner !== undefined ? { owner } : {}), blocks: [blankBlock("evening", "An evening out")] };
      let draft = await send(routineWrite(worldId, id, routine));
      const created = draft.routines?.[id];
      expect([level, created]).toEqual([level, routine]);
      expect([level, ownerLevel(formDoc(draft), created?.owner)]).toEqual([level, level]);
      expect([level, routineShapeProblems(created)]).toEqual([level, []]);
      // Everyone's routine keeps no owner at all, not an empty one.
      expect([level, created !== undefined && "owner" in created]).toEqual([level, owner !== undefined]);
      const edited: RoutineDef = { ...routine, label: "Edited", inherit: false, blocks: [...routine.blocks, blockKindChange(blankBlock("work", "Work"), "fixed"), { id: "lunch", off: true }] };
      draft = await send(routineWrite(worldId, id, edited));
      expect([level, draft.routines?.[id]]).toEqual([level, edited]);
      expect([level, routineShapeProblems(draft.routines?.[id])]).toEqual([level, []]);
      draft = await send({ type: "lre.editor", worldId, base: null, op: "remove", collection: "routines", id });
      expect([level, draft.routines?.[id]]).toEqual([level, undefined]);
    }
  });

  test("each block kind round-trips, and a change of kind keeps what still fits", async () => {
    const { worldId, person, send } = await portAlder();
    const flexible: RoutineBlock = {
      ...blankBlock("gym", "The gym"),
      window: { from: "05:00", to: "07:00" },
      minutes: 90,
      perWeek: 3,
      priority: 4,
      place: "here",
      days: { weekdays: [1, 3, 5], off: "never" },
      company: { who: { ids: [person.id] }, invite: true },
      needs: ["fun"],
      source: { type: "lore", entry: "harbor_gym", quote: "The night shift lifts at the harbor gym before dawn." },
    };
    const fixed = blockKindChange(flexible, "fixed");
    // A fixed block starts where the window opened, and has no window or times a week.
    expect([fixed.kind, fixed.at, fixed.window, fixed.perWeek, fixed.minutes, fixed.source]).toEqual(["fixed", "05:00", undefined, undefined, 90, flexible.source]);
    const optional: RoutineBlock = { ...blockKindChange(flexible, "optional"), chance: 0.25 };
    expect([optional.kind, optional.window, optional.perWeek, optional.at]).toEqual(["optional", flexible.window, 3, undefined]);
    // Back to flexible, the chance goes; from fixed, a window opens where it started.
    expect(blockKindChange(optional, "flexible").chance).toBeUndefined();
    expect(blockKindChange(fixed, "flexible").window?.from).toBe("05:00");
    const blocks = [flexible, { ...fixed, id: "opening" }, { ...optional, id: "swim", place: { place: Object.keys((await send({ type: "lre.editor", worldId, base: null, op: "get" })).places)[0] ?? "" } }];
    for (const block of blocks) expect([block.kind, blockShapeProblems(block)]).toEqual([block.kind, []]);
    const routine: RoutineDef = { id: "early", owner: person.id, blocks };
    const draft = await send(routineWrite(worldId, "early", routine));
    expect(draft.routines?.early).toEqual(routine);
    // The day bar draws a fixed block as it runs and a window as when it may start; moving an end moves them.
    expect(blockSlot(fixed)).toEqual({ start: "05:00", end: "06:30", value: "The gym" });
    expect(blockSlot(flexible)).toEqual({ start: "05:00", end: "07:00", value: "The gym" });
    expect(blockFromSlot(fixed, { start: "04:45", end: "06:30" })).toEqual({ ...fixed, at: "04:45", minutes: 105 });
    expect(blockFromSlot({ ...fixed, at: "23:00" }, { start: "23:00", end: "01:30" }).minutes).toBe(150);
    expect(blockFromSlot(flexible, { start: "06:00", end: "08:00" })).toEqual({ ...flexible, window: { from: "06:00", to: "08:00" } });
  });

  test("“No routine” saves for a character and a group, and keeps no broader block", async () => {
    const { worldId, person, send } = await portAlder();
    for (const owner of [person.id, "the_hales"]) {
      const id = `none_${owner}`;
      const none: RoutineDef = { id, owner, inherit: false, blocks: [] };
      const draft = await send(routineWrite(worldId, id, none));
      const stored = draft.routines?.[id];
      expect(stored).toEqual(none);
      expect(stored !== undefined && isNoRoutine(stored)).toBe(true);
      expect(routineShapeProblems(stored)).toEqual([]);
    }
    // A routine of its own blocks only, or an empty one that keeps the broader ones, is a routine.
    expect(isNoRoutine({ inherit: false, blocks: [blankBlock("x", "X")] })).toBe(false);
    expect(isNoRoutine({ blocks: [] })).toBe(false);
  });
});

describe("Build → World → Routines and the story", () => {
  test("the tuning round-trips, each setting alone, and the defaults leave the world none", async () => {
    const { worldId, send } = await portAlder();
    const settings: RoutineSettings = { awareness: "story_first", invitations: "off", sociability: "outgoing", planBend: "must", roles: { live: "enforced", near: "off", far: "informative", background: "informative" }, skips: { live: "stay", near: "routine", far: "model", background: "stay" }, narrator: false, paletteFollowsRoutine: true };
    let draft = await send(routineSettingsWrite(worldId, settings));
    expect(draft.routineSettings).toEqual(settings);
    expect(routineSettingsOf(draft)).toEqual(settings);
    const each: Partial<RoutineSettings>[] = [...ROUTINE_AWARENESS.map((awareness) => ({ awareness })), ...ROUTINE_INVITATIONS.map((invitations) => ({ invitations })), ...ROUTINE_SOCIABILITY.map((sociability) => ({ sociability })), ...ROUTINE_PLAN_BEND.map((planBend) => ({ planBend }))];
    for (const part of each) {
      const next = { ...DEFAULT_ROUTINE_SETTINGS, ...part };
      draft = await send(routineSettingsWrite(worldId, next));
      expect([part, routineSettingsOf(draft)]).toEqual([part, next]);
    }
    draft = await send(routineSettingsWrite(worldId, DEFAULT_ROUTINE_SETTINGS));
    expect(draft.routineSettings).toBeUndefined();
    expect(routineSettingsOf(draft)).toEqual(DEFAULT_ROUTINE_SETTINGS);
  });

  test("each level's role, the narrator and the Timelapse default: pressed on the page, saved to the draft and read back", async () => {
    const { worldId, send } = await portAlder();
    let value: RoutineSettings = { ...DEFAULT_ROUTINE_SETTINGS };
    const controls = () => {
      const tree = RoutineRoleSettings({ value, lint: [], disabled: false, onChange: (next) => void (value = next) });
      return { roles: propsOf(tree, Seg), switches: propsOf(tree, HostSwitch) };
    };
    // One role control per level, in the ladder's order, then the narrator's switch and the Timelapse default's.
    expect(controls().roles.map((seg) => seg.value)).toEqual(FIDELITIES.map((level) => DEFAULT_ROUTINE_SETTINGS.roles[level]));
    expect(controls().switches.map((s) => s.checked)).toEqual([DEFAULT_ROUTINE_SETTINGS.narrator, DEFAULT_ROUTINE_SETTINGS.paletteFollowsRoutine]);
    for (const [i, level] of FIDELITIES.entries()) {
      for (const role of ROUTINE_ROLES) {
        const seg = controls().roles[i];
        if (!seg) throw new Error(`no role control for ${level}`);
        press(seg, role);
        const draft = await send(routineSettingsWrite(worldId, value));
        expect([level, role, routineSettingsOf(draft)]).toEqual([level, role, value]);
        expect(controls().roles[i]?.value).toBe(role);
      }
    }
    // Each press on the page as it stands after the last, as a re-render hands it.
    const narrator = controls().switches[0];
    if (!narrator) throw new Error("no narrator switch");
    press(narrator, false);
    const palette = controls().switches[1];
    if (!palette) throw new Error("no Timelapse default switch");
    press(palette, true);
    const draft = await send(routineSettingsWrite(worldId, value));
    expect([routineSettingsOf(draft).narrator, routineSettingsOf(draft).paletteFollowsRoutine]).toEqual([false, true]);
    expect(controls().switches.map((s) => s.checked)).toEqual([false, true]);
  });

  test("the Timelapse sheet's Follow my routine starts at the world's default and travels with the request", async () => {
    const { rig, worldId, send } = await portAlder();
    const sheet = async (chatId: string) => {
      const timelapse = ((await rig.rt.view(chatId, rig.host.userId)) as StateView).palette?.timelapse;
      if (!timelapse) throw new Error("no Timelapse sheet");
      return timelapse;
    };
    const chatOn = async (): Promise<string> => {
      const chatId = rig.host.createChat("Morning.");
      rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
      return chatId;
    };
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const plain = await chatOn();
    expect((await sheet(plain)).followRoutine).toBe(false);

    await send(routineSettingsWrite(worldId, { ...DEFAULT_ROUTINE_SETTINGS, paletteFollowsRoutine: true }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = await chatOn();
    const timelapse = await sheet(chatId);
    expect(timelapse.followRoutine).toBe(true);

    let follow = timelapse.followRoutine;
    const choice = () => propsOf(FollowRoutineChoice({ value: follow, disabled: false, onChange: (next) => void (follow = next) }), HostSwitch);
    expect(choice().map((s) => s.checked)).toEqual([true]);
    const [toggle] = choice();
    if (!toggle) throw new Error("no Follow my routine");
    press(toggle, false);
    const request = timelapseRequest(timelapse, { type: "duration", minutes: 60 }, {}, chatId, follow);
    expect(request.params).toEqual({ target: { type: "duration", minutes: 60 }, overrides: {}, followRoutine: false });
    rig.body(await rig.send(request as unknown as Record<string, unknown>));
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("Problems → a routine", () => {
  test("a block's problem opens the routine on that block; the routine's own and the settings' open the page", () => {
    const route = issueRoute("w", "routines.dev.blocks.2.window");
    expect(route).toEqual({ view: "item", worldId: "w", collection: "routines", id: "dev", at: "routines.dev.blocks.2.window" });
    expect(blockAt(route?.view === "item" ? route.at : undefined, "routines.dev")).toBe(2);
    expect(blockAt("routines.dev.blocks.0", "routines.dev")).toBe(0);
    expect(blockAt("routines.dev.owner", "routines.dev")).toBeNull();
    expect(blockAt("routines.dev2.blocks.1", "routines.dev")).toBeNull();
    expect(blockAt("routines.dev.blocks.", "routines.dev")).toBeNull();
    expect(issueRoute("w", "routineSettings.awareness")).toEqual({ view: "part", worldId: "w", part: "routineSettings" });
  });
});

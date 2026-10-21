// GM → Routines (DESIGN §8) against a real backend: each per-chat control, built by the tab's own op
// helpers, goes through `lre.edit` and reads back from `lre.routine`, and the edit's Undo takes it
// back; the character's page shows each block's and schedule's source and the binding the read model
// gives; the list's badge follows `lre.routine {op: "changed"}`. The pages are walked as rendered
// trees (no DOM), as the other controls' tests do.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { editRequest } from "../../src/frontend/requests";
import { Badge, IdText, ListRow } from "../../src/frontend/components";
import { pinOp } from "../../src/packs/minds/ui/ops";
import { CharacterRows, RoutineSections } from "../../src/packs/castlife/ui/routines-gm";
import { bindingOf, blockOffOp, blockOp, changedBy, dropBlockOp, dropScheduleOp, followOp, routineRows, scheduleDraft, scheduleOffOp, scheduleOwnOp, scheduleRows, storyChanges } from "../../src/packs/castlife/ui/routines-ops";
import { blankBlock } from "../../src/frontend/build/routine-editor";
import type { EditOp } from "../../src/shared/protocol";
import type { RoutineBlock, RoutineChangeSummary, RoutineGmView } from "../../src/shared/routines";
import { isOff } from "../../src/shared/routines";
import type { GmView } from "../../src/shared/state-view";
import { Rig } from "../support/rig";
import { expand, propsOf, type Props } from "../support/tree";

const WHO = "danny_okafor";

/** A starter chat a turn in, Danny Okafor a planned agent with schedules of his own. */
async function chat(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "I wait on the porch.", "The street wakes up around you.");
  return { rig, chatId };
}

async function day(rig: Rig, chatId: string, entity = WHO): Promise<RoutineGmView> {
  const gm = rig.body(await rig.send({ type: "lre.routine", chatId, op: "day", entity, view: "gm" })).gm as RoutineGmView | undefined;
  if (!gm) throw new Error(`no routine for ${entity}`);
  return gm;
}

async function changed(rig: Rig, chatId: string): Promise<RoutineChangeSummary[]> {
  return rig.body(await rig.send({ type: "lre.routine", chatId, op: "changed" })).changed as RoutineChangeSummary[];
}

async function gmView(rig: Rig, chatId: string): Promise<GmView> {
  return rig.body(await rig.send({ type: "lre.gm", chatId })) as unknown as GmView;
}

async function edit(rig: Rig, chatId: string, op: EditOp | { op: EditOp } | { problems: string[] }): Promise<void> {
  const one = "problems" in op ? null : "op" in op && typeof op.op === "object" ? op.op : (op as EditOp);
  if (!one) throw new Error(`the form refused it: ${"problems" in op ? op.problems.join("; ") : ""}`);
  rig.body(await rig.send(editRequest(chatId, [one]) as unknown as Record<string, unknown>));
}

async function undoLatest(rig: Rig, chatId: string): Promise<void> {
  const undo = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "fix").at(-1);
  if (!undo) throw new Error("no Undo chip");
  rig.body(await rig.send({ type: "lre.chip", chatId, chip: undo.id, choice: "undo" }));
}

/** The words a rendered tree shows, in order. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

/** The character's page as rendered, each of its sections drawn one level down; `summary` is what the chat changed of them. */
function page(view: RoutineGmView, gm: GmView, summary?: RoutineChangeSummary): unknown[] {
  const root = RoutineSections({ view, gm, summary, busy: false, open: () => undefined }) as VNode<Props>;
  const children = root.props.children;
  return (Array.isArray(children) ? children : [children]).map((child) => expand(child));
}

/** The binding the page shows. */
function shownBinding(tree: unknown[]): unknown {
  return propsOf(tree, "div").find((p) => p["data-lre-binding"] !== undefined)?.["data-lre-binding"];
}

/** The ids of the list's rows that carry a badge under their name. */
function badged(gm: GmView, summary: RoutineChangeSummary[]): unknown[] {
  const tree = CharacterRows({ rows: routineRows(gm.minds.characters, gm.entities, summary), onOpen: () => undefined });
  return propsOf(tree, ListRow)
    .filter((row) => propsOf(row.subtitle, Badge).length > 0)
    .map((row) => row.id);
}

describe("GM view → Routines round trip", () => {
  test("how they follow their routine: each setting sends its op, shows in the binding and the badge, and Undo restores it", async () => {
    const { rig, chatId } = await chat();
    const before = await day(rig, chatId);
    expect(before.follow.chat).toBeNull();
    expect(await changed(rig, chatId)).toEqual([]);
    expect(badged(await gmView(rig, chatId), [])).toEqual([]);

    await edit(rig, chatId, followOp(WHO, "off", null));
    let v = await day(rig, chatId);
    expect([v.follow.mode, v.follow.chat]).toEqual(["off", { mode: "off", awareness: null, role: null }]);
    expect(bindingOf(v.tier, v.follow.mode, v.planned)).toBe("none");
    expect(shownBinding(page(v, await gmView(rig, chatId)))).toBe("none");
    let summary = await changed(rig, chatId);
    expect(summary.map((s) => [s.entity, changedBy(s)])).toEqual([[WHO, "gm"]]);
    expect(badged(await gmView(rig, chatId), summary)).toEqual([WHO]);

    await undoLatest(rig, chatId);
    v = await day(rig, chatId);
    expect([v.follow.mode, v.follow.chat]).toEqual(["follows", null]);
    summary = await changed(rig, chatId);
    expect(summary).toEqual([]);
    expect(badged(await gmView(rig, chatId), summary)).toEqual([]);

    // Awareness for them alone; following is the world's way, so it sends no mode of its own.
    expect(followOp(WHO, "follows", "story_first")).toEqual({ op: "routine_follow", entity: WHO, mode: null, awareness: "story_first" });
    await edit(rig, chatId, followOp(WHO, "follows", "story_first"));
    v = await day(rig, chatId);
    expect([v.follow.awareness, v.follow.chat]).toEqual(["story_first", { mode: null, awareness: "story_first", role: null }]);
    await edit(rig, chatId, followOp(WHO, "no_invitations", "story_first"));
    expect((await day(rig, chatId)).follow.mode).toBe("no_invitations");
    await undoLatest(rig, chatId);
    expect((await day(rig, chatId)).follow).toEqual({ mode: "follows", awareness: "story_first", role: before.follow.role, chat: { mode: null, awareness: "story_first", role: null } });
    // Back to the world's clears the setting.
    await edit(rig, chatId, followOp(WHO, "follows", null));
    expect((await day(rig, chatId)).follow).toEqual({ mode: "follows", awareness: before.follow.awareness, role: before.follow.role, chat: null });
    expect(await changed(rig, chatId)).toEqual([]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a block for this chat: changed, switched off, added and removed, each its op, each shown with its owner and source, each undone", async () => {
    const { rig, chatId } = await chat();
    const before = await day(rig, chatId);
    const lunch = before.blocks.find((b) => b.block.id === "lunch");
    if (!lunch || isOff(lunch.block)) throw new Error("no lunch");
    expect(lunch.owner.level).toBe("builtin");

    // Change: the chat's block wins, as yours, over the basic need it replaces.
    const longer: RoutineBlock = { ...lunch.block, label: "Lunch at the pier", minutes: 60 };
    await edit(rig, chatId, blockOp(WHO, longer));
    let v = await day(rig, chatId);
    let b = v.blocks.find((x) => x.block.id === "lunch");
    expect([b?.owner.level, b?.source.type, b?.off, b && !isOff(b.block) ? b.block.label : null]).toEqual(["chat", "gm", false, "Lunch at the pier"]);
    expect(b?.shadowed.map((s) => s.owner.level)).toEqual(["builtin"]);
    expect((await changed(rig, chatId)).flatMap((s) => s.blocks.map((x) => [s.entity, x.block, x.source.type, x.off]))).toEqual([[WHO, "lunch", "gm", false]]);
    await undoLatest(rig, chatId);
    b = (await day(rig, chatId)).blocks.find((x) => x.block.id === "lunch");
    expect([b?.owner.level, b?.block]).toEqual(["builtin", lunch.block]);

    // Switch off: a basic need too.
    await edit(rig, chatId, blockOffOp(WHO, "breakfast"));
    b = (await day(rig, chatId)).blocks.find((x) => x.block.id === "breakfast");
    expect([b?.off, b?.owner.level]).toEqual([true, "chat"]);
    await undoLatest(rig, chatId);
    b = (await day(rig, chatId)).blocks.find((x) => x.block.id === "breakfast");
    expect([b?.off, b?.owner.level]).toEqual([false, "builtin"]);

    // Add a block only this chat has, then remove it; the removal's Undo brings it back.
    const walk: RoutineBlock = { ...blankBlock("evening_walk", "Evening walk"), activity: "leisure", kind: "flexible", window: { from: "18:00", to: "21:00" }, minutes: 45 };
    await edit(rig, chatId, blockOp(WHO, walk));
    v = await day(rig, chatId);
    b = v.blocks.find((x) => x.block.id === "evening_walk");
    expect([b?.owner.level, b?.source.type, b?.shadowed]).toEqual(["chat", "gm", []]);
    await edit(rig, chatId, dropBlockOp(WHO, "evening_walk"));
    expect((await day(rig, chatId)).blocks.some((x) => x.block.id === "evening_walk")).toBe(false);
    await undoLatest(rig, chatId);
    expect((await day(rig, chatId)).blocks.find((x) => x.block.id === "evening_walk")?.owner.level).toBe("chat");

    // A block whose shape doesn't read never leaves the form.
    expect("problems" in blockOp(WHO, { ...walk, minutes: 0 })).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a schedule for this chat: their own version and off for a while, each its op, shown on the schedule it changes, and undone", async () => {
    const { rig, chatId } = await chat();
    const before = await day(rig, chatId);
    const row = scheduleRows(before).find((r) => r.schedule.owner.level === "own");
    if (!row) throw new Error("no schedule of his own");
    const s = row.schedule;
    expect(s.chat).toBeNull();

    // Their own version: the slots the form holds, ranked as theirs over the world's.
    const draft = scheduleDraft(s, WHO);
    const slots = draft.slots.map((slot, i) => (i === 0 ? { ...slot, start: slot.start === "06:00" ? "06:30" : "06:00" } : slot));
    await edit(rig, chatId, scheduleOwnOp(WHO, s.schedule, slots, draft.recurrence, s.recurrence));
    let v = await day(rig, chatId);
    let changedOne = v.schedules.find((x) => x.schedule === s.schedule);
    expect(changedOne?.chat && "slots" in changedOne.chat ? [changedOne.chat.slots, changedOne.chat.source.type] : null).toEqual([slots, "gm"]);
    // The chat's version is folded into the row of the schedule it changes.
    expect(scheduleRows(v).map((r) => r.schedule.schedule)).toEqual(scheduleRows(before).map((r) => r.schedule.schedule));
    expect((await changed(rig, chatId)).flatMap((x) => x.schedules.map((c) => [x.entity, c.schedule, c.off]))).toEqual([[WHO, s.schedule, false]]);
    await undoLatest(rig, chatId);
    expect((await day(rig, chatId)).schedules.find((x) => x.schedule === s.schedule)?.chat).toBeNull();

    // Off for a day, then until cleared; going back to the world's drops it.
    const now = (await gmView(rig, chatId)).minds.now;
    await edit(rig, chatId, scheduleOffOp(WHO, s.schedule, now + 24 * 60));
    expect((await day(rig, chatId)).schedules.find((x) => x.schedule === s.schedule)?.chat).toMatchObject({ off: true, until: now + 24 * 60 });
    await edit(rig, chatId, scheduleOffOp(WHO, s.schedule, null));
    v = await day(rig, chatId);
    changedOne = v.schedules.find((x) => x.schedule === s.schedule);
    expect(changedOne?.chat).toMatchObject({ off: true, until: null });
    await undoLatest(rig, chatId);
    expect((await day(rig, chatId)).schedules.find((x) => x.schedule === s.schedule)?.chat).toMatchObject({ off: true, until: now + 24 * 60 });
    await edit(rig, chatId, dropScheduleOp(WHO, s.schedule));
    expect((await day(rig, chatId)).schedules.find((x) => x.schedule === s.schedule)?.chat).toBeNull();
    expect(await changed(rig, chatId)).toEqual([]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("GM view → Routines: what the page shows", () => {
  test("every block and schedule row shows the source the read model gives it", async () => {
    const { rig, chatId } = await chat();
    await edit(rig, chatId, blockOffOp(WHO, "breakfast"));
    const v = await day(rig, chatId);
    const tree = page(v, await gmView(rig, chatId));
    const rows = propsOf(tree, ListRow);
    expect(v.blocks.length).toBeGreaterThan(0);
    for (const b of v.blocks) {
      const row = rows.find((r) => r.id === b.block.id);
      expect([b.block.id, textOf(row?.subtitle).includes(b.source.label)]).toEqual([b.block.id, true]);
    }
    const listed = scheduleRows(v);
    expect(listed.length).toBeGreaterThan(0);
    for (const { schedule: s } of listed) {
      const row = rows.find((r) => r.id === s.schedule);
      expect([s.schedule, textOf(row?.subtitle).includes(s.source.label)]).toEqual([s.schedule, true]);
    }
    // The story's changes list only what the story made; this one is yours.
    expect(storyChanges(v, (await changed(rig, chatId)).find((s) => s.entity === WHO))).toEqual([]);
  });

  test("the story's changes show with their turns, as the chat recorded them, a block the story added before it is in force included", async () => {
    const { rig, chatId } = await chat();
    const v = await day(rig, chatId);
    const gm = await gmView(rig, chatId);
    const lunch = v.blocks.find((b) => b.block.id === "lunch");
    if (!lunch || isOff(lunch.block)) throw new Error("no lunch");
    const base: RoutineBlock = lunch.block;
    // As the read model gives the story's changes: lunch changed and in force; a block the story added,
    // which the read model has only from the next day.
    const told = { type: "story" as const, at: gm.minds.now - 30, turn: "msg-7" };
    const here = { level: "chat" as const, name: "This chat", rank: 0 };
    const view: RoutineGmView = { ...v, blocks: v.blocks.map((b) => (b.block.id === "lunch" ? { ...b, block: { ...base, label: "Lunch at the pier" }, owner: here, source: { ...told, label: "The story" }, shadowed: [{ routine: null, owner: b.owner, source: b.source, block: b.block }] } : b)) };
    const summary: RoutineChangeSummary = { entity: WHO, name: v.name, follow: null, blocks: [{ block: "lunch", source: told, off: false }, { block: "story_gym", source: { ...told, at: told.at + 5 }, off: false }], schedules: [] };
    expect(storyChanges(view, summary).map((c) => [c.id, c.kind === "block" ? (c.block?.owner.level ?? null) : null])).toEqual([
      ["lunch", "chat"],
      ["story_gym", null],
    ]);
    const list = propsOf(page(view, gm, summary), "div").find((p) => p["data-lre-gm-list"] === "routine-story");
    const rows = propsOf(list?.children, ListRow);
    // Each with its turn; the one in force opens to keep, change or drop, the one not yet in force doesn't.
    expect(rows.map((r) => [r.id, propsOf(r.subtitle, IdText).map((p) => p.id), typeof r.onClick === "function"])).toEqual([
      ["lunch", ["msg-7"], true],
      ["story_gym", ["msg-7"], false],
    ]);
    // A change of yours is never listed as the story's.
    expect(storyChanges(view, { ...summary, blocks: [{ block: "lunch", source: { type: "gm", at: told.at }, off: false }] })).toEqual([]);
  });

  test("the binding shown is the read model's: routine leads for Far and Background, story leads for Near and Live, none with no routine", async () => {
    const { rig, chatId } = await chat();
    const shown = async (): Promise<[unknown, unknown]> => {
      const v = await day(rig, chatId);
      return [v.tier, shownBinding(page(v, await gmView(rig, chatId)))];
    };
    await edit(rig, chatId, pinOp(WHO, "far"));
    expect(await shown()).toEqual(["far", "routine"]);
    await edit(rig, chatId, pinOp(WHO, "background"));
    expect(await shown()).toEqual(["background", "routine"]);
    await edit(rig, chatId, pinOp(WHO, "near"));
    expect(await shown()).toEqual(["near", "story"]);
    await edit(rig, chatId, pinOp(WHO, "live"));
    expect(await shown()).toEqual(["live", "story"]);
    await edit(rig, chatId, followOp(WHO, "off", null));
    expect(await shown()).toEqual(["live", "none"]);
  });
});

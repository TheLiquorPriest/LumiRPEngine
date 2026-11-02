// What one `fix` entry asks for beyond the GM editor's operations (AGENT-LOOP-PLAN §4, §15): an
// agent's workspace changes and clock sets resolve as the events they make, in order, all or none,
// and read back from a stored entry the same way. Every file is every agent's to read: a write names
// no readers, and an earlier build's readers, stored or recorded, change nothing a chat reads now.

import { describe, expect, test } from "bun:test";
import type { FixOp, LedgerEvent } from "../../src/shared/ledger";
import type { EditOp } from "../../src/shared/protocol";
import { EDIT_OPS_MAX } from "../../src/shared/protocol";
import { blobHash } from "../../src/shared/stores";
import { parseEditOps, parseFixOps, resolveEdit, resolveFix } from "../../src/engine/edits";
import type { WorldState } from "../../src/engine/state";
import { clockFix } from "../../src/engine/time";
import { WS_DELETE, WS_READERS, workspaceOf, workspacePins, wsDelete, wsPin, wsWrite } from "../../src/engine/workspace";
import { baseWorld, fold, POV, registryOf, startState } from "../packs/support";

const reg = registryOf();
const world = baseWorld();
const start = startState(world, reg);
const GM = { gm: true, runSeed: "run" };

const INN = blobHash("The inn's back door sticks.");
const DEV = blobHash("Dev keeps the bar.");

/** Two notes, the inn's pinned. */
const files = fold(reg, world, start, [wsWrite("notes/inn.md", INN), wsWrite("notes/dev.md", DEV), wsPin("notes/inn.md", true)]);

function resolved(state: Readonly<WorldState>, ops: readonly FixOp[]): LedgerEvent[] {
  const out = resolveEdit(reg, world, state, ops, GM);
  if ("rejection" in out) throw new Error(out.rejection.reason);
  return out.events;
}

function refused(state: Readonly<WorldState>, ops: readonly FixOp[]): string | null {
  const out = resolveEdit(reg, world, state, ops, GM);
  return "rejection" in out ? out.rejection.code : null;
}

describe("an agent's workspace changes", () => {
  test("write, pin, move and delete resolve as the workspace's events, in order and as one unit", () => {
    const ops: FixOp[] = [
      { op: "ws_write", path: "notes/inn.md", hash: INN },
      { op: "ws_write", path: "notes/dev.md", hash: DEV },
      { op: "ws_pin", path: "notes/inn.md", pinned: true },
      { op: "ws_move", from: "notes/inn.md", to: "old/inn.md" },
      { op: "ws_delete", path: "notes/dev.md" },
    ];
    const events = resolved(start, ops);
    // The move writes the new path, removes the old one and carries the pin over.
    const expected = [wsWrite("notes/inn.md", INN), wsWrite("notes/dev.md", DEV), wsPin("notes/inn.md", true), wsWrite("old/inn.md", INN), wsDelete("notes/inn.md"), wsPin("old/inn.md", true), wsDelete("notes/dev.md")];
    expect(events).toEqual(expected.map((e) => ({ ...e, group: expect.stringMatching(/^edit:/) })));
    expect(new Set(events.map((e) => e.group)).size).toBe(1);
    const after = fold(reg, world, start, events);
    expect(workspaceOf(after)).toEqual({ "old/inn.md": INN });
    expect(workspacePins(after)).toEqual({ "old/inn.md": true });
  });

  test("a move of a file that isn't pinned leaves no pin behind it; an unpin takes the pin off", () => {
    const moved = fold(reg, world, files, resolved(files, [{ op: "ws_move", from: "notes/dev.md", to: "people/dev.md" }]));
    expect(workspaceOf(moved)).toEqual({ "notes/inn.md": INN, "people/dev.md": DEV });
    expect(workspacePins(moved)).toEqual({ "notes/inn.md": true });
    const unpinned = fold(reg, world, moved, resolved(moved, [{ op: "ws_pin", path: "notes/inn.md", pinned: false }]));
    expect(workspacePins(unpinned)).toEqual({});
  });

  test("what is already so, a missing file, a taken path and a malformed path or hash are refused, and nothing applies", () => {
    expect(refused(files, [{ op: "ws_write", path: "notes/inn.md", hash: INN }])).toBe("no_change");
    expect(refused(files, [{ op: "ws_write", path: "../inn.md", hash: INN }])).toBe("bad_op");
    expect(refused(files, [{ op: "ws_write", path: "notes/inn.md", hash: "nope" }])).toBe("bad_op");
    expect(refused(files, [{ op: "ws_delete", path: "notes/gone.md" }])).toBe("missing_file");
    expect(refused(files, [{ op: "ws_move", from: "notes/gone.md", to: "old/gone.md" }])).toBe("no_file");
    expect(refused(files, [{ op: "ws_move", from: "notes/inn.md", to: "notes/inn.md" }])).toBe("no_change");
    expect(refused(files, [{ op: "ws_move", from: "notes/inn.md", to: "notes/dev.md" }])).toBe("file_exists");
    expect(refused(files, [{ op: "ws_move", from: "notes/inn.md", to: "/inn.md" }])).toBe("bad_op");
    expect(refused(files, [{ op: "ws_pin", path: "notes/gone.md", pinned: true }])).toBe("no_file");
    expect(refused(files, [{ op: "ws_pin", path: "notes/inn.md", pinned: true }])).toBe("no_change");
    expect(refused(files, [{ op: "ws_pin", path: "notes/dev.md", pinned: false }])).toBe("no_change");
    // All or none: the write before the refused pin never lands.
    expect(refused(files, [{ op: "ws_write", path: "notes/new.md", hash: DEV }, { op: "ws_pin", path: "notes/gone.md", pinned: true }])).toBe("no_file");
  });

  test("a write is its body alone, with no readers; an earlier build's recorded readers still fold, and change nothing else", () => {
    // A new file: its write, and nothing more.
    const events = resolved(start, [{ op: "ws_write", path: "notes/square.md", hash: DEV }]);
    expect(events).toEqual([wsWrite("notes/square.md", DEV)]);
    // A move carries the body and pin only.
    const shared = fold(reg, world, files, events);
    expect(resolved(shared, [{ op: "ws_move", from: "notes/square.md", to: "old/square.md" }]).map((e) => e.type)).not.toContain(WS_READERS);
    // A chat recorded under an earlier build replays as it was: its readers event still folds into the index nothing reads.
    const recorded = fold(reg, world, shared, [{ type: WS_READERS, data: { path: "notes/square.md", readers: "pov" } }]);
    expect(recorded.packs.engine?.wsReaders).toEqual({ "notes/square.md": "pov" });
    expect([workspaceOf(recorded), workspacePins(recorded)]).toEqual([workspaceOf(shared), workspacePins(shared)]);
    // A delete still drops its entry with the file, as it did.
    const gone = fold(reg, world, recorded, resolved(recorded, [{ op: "ws_delete", path: "notes/square.md" }]));
    expect(gone.packs.engine?.wsReaders).toEqual({});
    // A chat that never shared a file holds no readers key.
    expect(Object.keys(files.packs.engine ?? {})).not.toContain("wsReaders");
  });
});

describe("an agent's clock set", () => {
  test("it sets the clock as the clock's ✎ fix does, and rides in one unit with the rest of the edit", () => {
    const fix = clockFix(reg, world, start, "2026-10-16 09:00", "run");
    if ("code" in fix) throw new Error(fix.reason);
    const events = resolved(start, [{ op: "clock", time: "2026-10-16 09:00" }]);
    expect(events.map((e) => e.type)).toEqual(fix.events.map((e) => e.type));
    const after = fold(reg, world, start, events);
    const fixed = fold(reg, world, start, fix.events);
    expect([after.clock, after.accounts, after.entities]).toEqual([fixed.clock, fixed.accounts, fixed.entities]);
    expect(after.clock).toBe(start.clock + 60);
    const both = resolved(start, [{ op: "ws_write", path: "notes/inn.md", hash: INN }, { op: "clock", time: "2026-10-16 09:00" }]);
    expect(new Set(both.map((e) => e.group)).size).toBe(1);
    const bothAfter = fold(reg, world, start, both);
    expect([bothAfter.clock, workspaceOf(bothAfter)]).toEqual([start.clock + 60, { "notes/inn.md": INN }]);
  });

  test("the time it already reads is no change; a time the calendar lacks, or Calendar & time off, refuses with the ✎ fix's code", () => {
    expect(refused(start, [{ op: "clock", time: "2026-10-16 08:00" }])).toBe("no_change");
    expect(refused(start, [{ op: "clock", time: "2026-02-30 10:00" }])).toBe("bad_time");
    const off = structuredClone(start);
    off.realism.levels.calendar = 0;
    expect(refused(off, [{ op: "clock", time: "2026-10-16 09:00" }])).toBe("calendar_off");
  });
});

describe("reading what a fix entry asks for", () => {
  const NEW_OPS: FixOp[] = [
    { op: "ws_write", path: "notes/inn.md", hash: INN },
    { op: "ws_delete", path: "notes/inn.md" },
    { op: "ws_move", from: "notes/inn.md", to: "old/inn.md" },
    { op: "ws_pin", path: "notes/inn.md", pinned: false },
    { op: "clock", time: "2026-10-16 09:00" },
  ];
  const EDIT_OPS: EditOp[] = [
    { op: "set", entity: POV, field: "skill", value: 3 },
    { op: "add", entity: POV, field: "stress", delta: 5 },
    { op: "link", rel: "knows", from: POV, to: "dev", fields: { since: 1 }, until: 90 },
    { op: "unlink", rel: "knows", from: POV, to: "dev" },
    { op: "move", entity: POV, to: "cafe" },
    { op: "put", entity: "dev", into: null },
    { op: "adjust", account: POV, cents: 100 },
    { op: "stage", track: "heist", to: "on" },
    { op: "entity", entity: "dev", tier: "supporting", agent: false, levels: { money: 2, gear: null } },
    { op: "classify", entity: "dev", class: { trade: ["bar"] }, tags: ["regular"] },
    { op: "life", entity: "dev", to: "dying", tell: [POV] },
    { op: "spawn", kind: "person", name: "Rosie", id: "rosie", tier: "background", place: "cafe", agent: true },
    { op: "despawn", entity: "dev" },
    { op: "restore", entity: "dev" },
    { op: "mind_pin", entity: "dev", level: "near" },
    { op: "mind_refresh", entity: "dev" },
    { op: "mind_intent", entity: "dev", text: "Close early", approach: "proactive" },
    { op: "effect", effect: "price", args: { asset: "idx" } },
    { op: "feed", section: "people", to: null },
  ];

  test("the agent's ops and every op the GM editor sends read back as they were", () => {
    expect(parseFixOps(NEW_OPS)).toEqual(NEW_OPS);
    expect(parseEditOps(EDIT_OPS)).toEqual(EDIT_OPS);
    expect(parseFixOps(EDIT_OPS)).toEqual(parseEditOps(EDIT_OPS));
    expect(parseFixOps([...EDIT_OPS.slice(0, 3), ...NEW_OPS])).toEqual([...EDIT_OPS.slice(0, 3), ...NEW_OPS]);
    // What an op doesn't hold is dropped.
    expect(parseFixOps([{ op: "ws_delete", path: "notes/inn.md", extra: 1 }])).toEqual([{ op: "ws_delete", path: "notes/inn.md" }]);
    // A write stored by an earlier build that named its readers reads back without them.
    expect(parseFixOps([{ op: "ws_write", path: "notes/inn.md", hash: INN, readers: "gm" }])).toEqual([{ op: "ws_write", path: "notes/inn.md", hash: INN }]);
    expect(parseFixOps([{ op: "ws_write", path: "notes/inn.md", hash: INN, readers: 1 }])).toEqual([{ op: "ws_write", path: "notes/inn.md", hash: INN }]);
  });

  test("malformed ops, none and too many are refused; the GM editor's request still refuses the agent's ops", () => {
    for (const bad of [
      { op: "ws_write", path: "notes/inn.md" },
      { op: "ws_write", path: 7, hash: INN },
      // An earlier build's op that set a file's readers alone is no operation now.
      { op: "ws_readers", path: "notes/inn.md", readers: "pov" },
      { op: "ws_delete" },
      { op: "ws_move", from: "notes/inn.md", to: 7 },
      { op: "ws_pin", path: "notes/inn.md", pinned: "true" },
      { op: "ws_pin", path: "notes/inn.md" },
      { op: "clock", time: 540 },
      { op: "set", entity: POV, field: "skill" },
      { op: "nope" },
      null,
      "ws_delete",
    ]) expect(parseFixOps([bad])).toBeNull();
    expect(parseFixOps([])).toBeNull();
    expect(parseFixOps("ops")).toBeNull();
    expect(parseFixOps(Array.from({ length: EDIT_OPS_MAX + 1 }, () => NEW_OPS[1]))).toBeNull();
    expect(parseFixOps(Array.from({ length: EDIT_OPS_MAX }, () => NEW_OPS[1]))).toHaveLength(EDIT_OPS_MAX);
    for (const op of NEW_OPS) expect(parseEditOps([op])).toBeNull();
  });

  test("resolved again, a delete of a file already gone is passed over and the rest of the edit stands", () => {
    const entry = { gm: true as const, edit: { ops: [{ op: "ws_delete", path: "notes/gone.md" }, { op: "set", entity: POV, field: "skill", value: 5 }] as FixOp[] } };
    expect(refused(files, entry.edit.ops)).toBe("missing_file");
    const out = resolveFix(reg, world, files, entry, "run");
    if (!out || "rejection" in out) throw new Error("the fix was refused");
    expect(out.events.some((e) => e.type === WS_DELETE)).toBe(false);
    expect(out.events.some((e) => e.type === "set" && e.entity === POV && e.field === "skill" && e.value === 5)).toBe(true);
    expect(fold(reg, world, files, out.events).entities[POV]?.fields.skill).toBe(5);
    expect(workspaceOf(fold(reg, world, files, out.events))).toEqual({ "notes/inn.md": INN, "notes/dev.md": DEV });
  });

  test("an entry the GM editor wrote resolves again exactly as its operations did", () => {
    const ops: EditOp[] = [{ op: "set", entity: POV, field: "skill", value: 4 }, { op: "add", entity: POV, field: "stress", delta: 10 }];
    expect(resolveFix(reg, world, start, { gm: true, edit: { ops } }, "run")).toEqual(resolveEdit(reg, world, start, ops, { ...GM, again: true }));
  });
});

describe("an agent's ✎ fix inside a GM edit (fix_set)", () => {
  test("keeps the player's rules, worked out again too: a locked field is refused where the GM's own set writes it", () => {
    const locked = baseWorld();
    const person = locked.kinds.person;
    if (!person) throw new Error("no person kind");
    person.fields.skill = { type: "number", default: 0, locked: true };
    const set: FixOp = { op: "set", entity: POV, field: "skill", value: 3 };
    const fix: FixOp = { op: "fix_set", entity: POV, field: "skill", value: 3 };
    expect("events" in resolveEdit(reg, locked, start, [set], GM)).toBe(true);
    const now = resolveEdit(reg, locked, start, [fix], GM);
    expect("rejection" in now ? now.rejection.code : null).toBe("locked");
    // Held through a reply and worked out again from its request, with the GM edit's flag, it is still the player's.
    const again = resolveFix(reg, locked, start, { gm: true, edit: { ops: [fix] } }, "run");
    expect(again !== null && "rejection" in again ? again.rejection.code : null).toBe("locked");
    // A field anyone may correct it sets as a set does, and it reads back from a stored entry as it was written.
    expect(resolved(start, [{ op: "fix_set", entity: POV, field: "stress", value: 40 }])).toEqual(resolved(start, [{ op: "set", entity: POV, field: "stress", value: 40 }]));
    expect(parseFixOps([fix])).toEqual([fix]);
  });
});

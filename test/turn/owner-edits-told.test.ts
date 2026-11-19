// What the next turn is told of the player's own edits (owner-changes.ts, the notices part's player_edit): what was pressed, by its
// name, and what it changed, in the words the turn's card gives a change, and never a change as it is written; an Undo of an edit of
// his with what that edit had recorded, and an Undo of a change an earlier turn made as that. Every chat, person and place is invented.

import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import type { LinesPart } from "../../src/app/guidance";
import { TAP_DEFAULTS } from "../../src/play/settings";
import type { LedgerEvent } from "../../src/shared/ledger";
import { ownerEditsBefore } from "../../src/turn/owner-changes";
import { openSet, type OpenSet, shippedTexts } from "../guidance/set";
import { CHAT, registry } from "../play/bed";
import { rig } from "../play/undo-rig";

let set: OpenSet;
let notices: LinesPart;
beforeAll(async () => {
  set = await openSet(shippedTexts());
  const part = await set.guidance().part("notices");
  if (part?.format !== "lines") throw new Error("notices.md is not a lines part that loads");
  notices = part;
});
afterAll(() => set.close());

test("the next turn is told each edit of the player's by what was pressed and what it changed, an Undo by what it took back, all in words", async () => {
  const r = await rig();
  // A turn moved the clock on; then the player named the party, renamed it and took the renaming back, and took back the turn's clock.
  const [clock] = await r.record([{ type: "clock", minutes: 15, cause: "advance" } as unknown as LedgerEvent]);
  expect((await r.tap({ kind: "action", action: "party_name", params: { name: "Brindlemere" }, source: "panel", tell: true })).applied).toBe(true);
  const renamed = await r.tap({ kind: "action", action: "party_name", params: { name: "Harbour Crew" }, source: "panel", tell: true });
  await r.undo(renamed.undo);
  await r.take(clock?.id ?? -1);
  // His changes are placed before the first turn begun after them: it begins a second later, by the clock the store reads.
  setSystemTime(new Date(Date.now() + 1000));
  const next = await r.writes.run(() => r.s.beginTurn({ chat: CHAT, kind: "normal" }), "the next turn").finally(() => setSystemTime());
  const told = (await ownerEditsBefore(r.s, CHAT, next.id, TAP_DEFAULTS.tell, r.doc, registry())).map((e) => notices.line("player_edit", e.fields));
  expect(told).toEqual([
    "Before this turn, the player pressed Name the party, on Brindlemere. Recorded: Accounts the world gave, opened. Recorded: Brindlemere appears. Recorded: Jordan Ellis named the party Brindlemere.",
    "Before this turn, the player pressed Name the party, on Harbour Crew. Recorded: Brindlemere is now called Harbour Crew. Recorded: Jordan Ellis named the party Harbour Crew.",
    "Before this turn, the player pressed Undo on an edit of their own (Name the party, on Harbour Crew). It had recorded: Brindlemere is now called Harbour Crew. It had recorded: Jordan Ellis named the party Harbour Crew. Recorded: A line of History taken off. Recorded: Harbour Crew is now called Brindlemere.",
    "Before this turn, the player pressed Undo on a change an earlier turn made. It had recorded: The clock moved. Recorded: The clock set back.",
  ]);
  // No line shows a change as it is written, nor leaves a blank where its words go.
  for (const line of told) expect(line).not.toMatch(/[{}]|engine\.|: \.|: $/);
});

test("the clock's Pause and Resume are told by what was pressed and where the clock stands, never as \"a pause of the clock\" both ways", async () => {
  const r = await rig();
  const all = { all: true };
  for (const to of [true, false]) expect((await r.time({ control: "pause", scope: all, to })).applied).toBe(true);
  setSystemTime(new Date(Date.now() + 1000));
  const next = await r.writes.run(() => r.s.beginTurn({ chat: CHAT, kind: "normal" }), "the next turn").finally(() => setSystemTime());
  const told = (await ownerEditsBefore(r.s, CHAT, next.id, TAP_DEFAULTS.tell, r.doc, registry())).map((e) => notices.line("player_edit", e.fields));
  expect(told).toEqual([
    "Before this turn, the player used the clock's controls (Pause clock: the clock is paused for this scene, and the world state says so while it is).",
    "Before this turn, the player used the clock's controls (Resume clock: the clock is running, and the world state says it is paused only while it is).",
  ]);
  for (const line of told) expect(line).not.toMatch(/a pause of the clock|Recorded/i);
});

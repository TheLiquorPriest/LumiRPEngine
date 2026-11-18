// What a chat plays by on its own, through its service on a chat that plays a starter world: a level, a claims policy and the check rules
// are changed from now on as the owner's own edit, each taken back by its Undo, and the claims and the check rules go back to following
// the world, a first change included.

import { expect, test } from "bun:test";
import { OwnService, type OwnShown } from "../../src/play/own";
import { CHAT, GUIDANCE, makeBed, USER } from "./bed";

/** What a chat that plays a world reads as. */
async function played(own: OwnService): Promise<Extract<OwnShown, { world: true }>> {
  const read = await own.values(USER, CHAT);
  if (!read.world) throw new Error("the chat plays no world");
  return read;
}

async function chat() {
  const bed = makeBed();
  await bed.plays("modern_slice_of_life");
  const own = new OwnService({ store: bed.store, writes: bed.writes, live: bed.live, guidance: GUIDANCE });
  return { bed, own };
}

test("a level is set for everyone from now on, and its Undo puts it back", async () => {
  const { bed, own } = await chat();
  const before = await played(own);
  const level = before.realism.levels.money ?? 0;
  const next = level === 4 ? 3 : level + 1;
  const set = await own.change(USER, CHAT, { kind: "level", domain: "money", to: next });
  expect(set.applied).toBe(true);
  expect((await played(own)).realism.levels.money).toBe(next);
  // The same level again records nothing.
  expect(await own.change(USER, CHAT, { kind: "level", domain: "money", to: next })).toMatchObject({ applied: false, undo: null, words: "That changes nothing." });
  expect(await bed.service.undoEdit(USER, CHAT, set.undo ?? "")).toMatchObject({ applied: true });
  expect((await played(own)).realism.levels.money).toBe(level);
});

test("claims and check rules the chat never set follow the world, are set, and go back by their Undo", async () => {
  const { bed, own } = await chat();
  const before = await played(own);
  expect(before.claims.own).toBe(false);
  expect(before.checks.own).toBe(false);

  const claims = await own.change(USER, CHAT, { kind: "claims", mode: "hold" });
  expect(claims.applied).toBe(true);
  expect((await played(own)).claims).toMatchObject({ mode: "hold", own: true });
  // A first change is taken back to following the world.
  expect(await bed.service.undoEdit(USER, CHAT, claims.undo ?? "")).toMatchObject({ applied: true });
  expect((await played(own)).claims).toEqual(before.claims);

  const checks = await own.change(USER, CHAT, { kind: "checks", when: "never", retry: "once" });
  expect(checks.applied).toBe(true);
  expect((await played(own)).checks).toMatchObject({ when: "never", retry: "once", own: true });
  // Given back to the world by a change of its own.
  expect((await own.change(USER, CHAT, { kind: "checks-world" })).applied).toBe(true);
  expect((await played(own)).checks).toEqual(before.checks);
});

test("a level under the world's floor is refused in words, and nothing changes", async () => {
  const { own } = await chat();
  const shown = await played(own);
  const floored = Object.entries(shown.realism.floors).find(([, floor]) => floor > 0);
  if (floored === undefined) return;
  const [domain, floor] = floored;
  const refused = await own.change(USER, CHAT, { kind: "level", domain: domain as "money", to: floor - 1 });
  expect(refused.applied).toBe(false);
  expect(refused.words).toContain(`${floor}`);
});

test("a chat that plays no world reads as one with no values of its own, and a change of it is refused in words", async () => {
  const bed = makeBed();
  const own = new OwnService({ store: bed.store, writes: bed.writes, live: bed.live, guidance: GUIDANCE });
  expect(await own.values(USER, "chat-nowhere")).toEqual({ world: false });
  const refused = await own.change(USER, "chat-nowhere", { kind: "level", domain: "money", to: 2 });
  expect(refused).toMatchObject({ applied: false, undo: null });
  expect(refused.words).not.toBe("");
});

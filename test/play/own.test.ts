// What a chat plays by on its own, through its service on a chat that plays a starter world: a level, a claims policy and the check rules
// are changed from now on as the owner's own edit, each taken back by its Undo, and the claims and the check rules go back to following
// the world, a first change included.

import { expect, test } from "bun:test";
import { OwnService } from "../../src/play/own";
import { CHAT, GUIDANCE, makeBed, USER } from "./bed";

async function chat() {
  const bed = makeBed();
  await bed.plays("modern_slice_of_life");
  const own = new OwnService({ store: bed.store, writes: bed.writes, live: bed.live, guidance: GUIDANCE });
  return { bed, own };
}

test("a level is set for everyone from now on, and its Undo puts it back", async () => {
  const { bed, own } = await chat();
  const before = await own.values(USER, CHAT);
  const level = before.realism.levels.money ?? 0;
  const next = level === 4 ? 3 : level + 1;
  const set = await own.change(USER, CHAT, { kind: "level", domain: "money", to: next });
  expect(set.applied).toBe(true);
  expect((await own.values(USER, CHAT)).realism.levels.money).toBe(next);
  // The same level again records nothing.
  expect(await own.change(USER, CHAT, { kind: "level", domain: "money", to: next })).toMatchObject({ applied: false, undo: null, words: "That changes nothing." });
  expect(await bed.service.undoEdit(USER, CHAT, set.undo ?? "")).toMatchObject({ applied: true });
  expect((await own.values(USER, CHAT)).realism.levels.money).toBe(level);
});

test("claims and check rules the chat never set follow the world, are set, and go back by their Undo", async () => {
  const { bed, own } = await chat();
  const before = await own.values(USER, CHAT);
  expect(before.claims.own).toBe(false);
  expect(before.checks.own).toBe(false);

  const claims = await own.change(USER, CHAT, { kind: "claims", mode: "hold" });
  expect(claims.applied).toBe(true);
  expect((await own.values(USER, CHAT)).claims).toMatchObject({ mode: "hold", own: true });
  // A first change is taken back to following the world.
  expect(await bed.service.undoEdit(USER, CHAT, claims.undo ?? "")).toMatchObject({ applied: true });
  expect((await own.values(USER, CHAT)).claims).toEqual(before.claims);

  const checks = await own.change(USER, CHAT, { kind: "checks", when: "never", retry: "once" });
  expect(checks.applied).toBe(true);
  expect((await own.values(USER, CHAT)).checks).toMatchObject({ when: "never", retry: "once", own: true });
  // Given back to the world by a change of its own.
  expect((await own.change(USER, CHAT, { kind: "checks-world" })).applied).toBe(true);
  expect((await own.values(USER, CHAT)).checks).toEqual(before.checks);
});

test("a level under the world's floor is refused in words, and nothing changes", async () => {
  const { own } = await chat();
  const shown = await own.values(USER, CHAT);
  const floored = Object.entries(shown.realism.floors).find(([, floor]) => floor > 0);
  if (floored === undefined) return;
  const [domain, floor] = floored;
  const refused = await own.change(USER, CHAT, { kind: "level", domain: domain as "money", to: floor - 1 });
  expect(refused.applied).toBe(false);
  expect(refused.words).toContain(`${floor}`);
});

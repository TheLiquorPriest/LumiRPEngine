// RPE's verdict on the lore's secrets at a state: marked as the shipped file words a mark, or left out as the narrator's view says.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type SecrecyDeps, secrecyAt, secretMarkLines } from "../../../src/lore";
import type { Store } from "../../../src/store";
import { startState } from "../../packs/support";
import { books, candidateOf, harbor, registry } from "../../secrecy/fixture";
import { CHAT, USER } from "../fixtures";
import { shippedGuidance } from "../shipped";

describe("the verdict at a state", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "rpe-lore-secrets-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("a marked passage goes back worded by the shipped file, and is left out when the narrator's view leaves it out", async () => {
    const { guidance } = await shippedGuidance(dir, [CHAT]);
    const world = harbor();
    const state = startState(world, registry);
    const store = { env: { registry, worlds: (revision: string) => (revision === state.revision ? world : undefined) } } as unknown as Store;
    const deps = (secrets: "marked" | "omit"): SecrecyDeps => ({ store, settingsFor: async () => ({ narrator: { knowledge: "scene", secrets }, tracked: true, threshold: 0.7 }), wording: (at) => secretMarkLines(guidance(at.chat)), log: () => undefined });
    const entries = books().filter((e) => e.bookId === "b1").map(candidateOf);
    const at = { user: USER, chat: CHAT };

    const marked = await secrecyAt(deps("marked"), at, state, entries);
    expect(marked.mutated?.find((m) => m.id === "e-ferry")?.content).toContain("[secret; known to Marcus]");
    const left = await secrecyAt(deps("omit"), at, state, entries);
    expect(left.mutated?.find((m) => m.id === "e-ferry")?.content).not.toContain("[secret");
  });
});

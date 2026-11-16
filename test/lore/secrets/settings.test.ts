// The settings of the secrets: the narrator's view follows the chat's own, else its world's, else the global one; the tracking switch and the
// threshold are recorded at a turn's start only where they changed, and read as recorded.

import { describe, expect, test } from "bun:test";
import { readConfig } from "../../../src/app/config-read";
import type { WorldState } from "../../../src/engine/state";
import { knowledgeChange, knowledgeRecorded, narratorOf, SECRETS_SETTINGS, secretSettings } from "../../../src/lore";
import { startState } from "../../packs/support";
import { harbor, registry } from "../../secrecy/fixture";

const read = (global: string | null, chat: string | null) =>
  readConfig(
    [
      { level: "global", file: "RPE-global.yml", text: global },
      { level: "chat", file: "RPE.yml", text: chat },
    ],
    null,
    SECRETS_SETTINGS,
  );

describe("the narrator's view and when a holding counts", () => {
  test("the narrator's view is the chat's own, else its world's, else the global one", () => {
    expect(narratorOf(read(null, null), null)).toEqual({ knowledge: "scene", secrets: "marked" });
    const global = "secrets:\n  narrator:\n    knowledge: pov\n    secrets: omit\n";
    expect(narratorOf(read(global, null), null)).toEqual({ knowledge: "pov", secrets: "omit" });
    // The world's own view wins over the global one; a chat that sets one part keeps the world's for the other.
    const world = { narrator: { knowledge: "scene", secrets: "marked" } } as const;
    expect(narratorOf(read(global, null), world)).toEqual({ knowledge: "scene", secrets: "marked" });
    expect(narratorOf(read(global, "secrets:\n  narrator:\n    knowledge: pov\n"), world)).toEqual({ knowledge: "pov", secrets: "marked" });
    // A world's view that is not a whole one is passed over.
    expect(narratorOf(read(global, null), { narrator: { knowledge: "scene" } as never })).toEqual({ knowledge: "pov", secrets: "omit" });
  });

  test("a changed threshold is recorded at a turn's start, and a state before it keeps the threshold recorded there", () => {
    const set = secretSettings(read("secrets:\n  threshold: 0.5\n", "secrets:\n  tracked: false\n"), null);
    expect(set).toMatchObject({ tracked: false, threshold: 0.5 });
    const world = harbor();
    const slice = (knowledge: Record<string, unknown>): WorldState => ({ ...startState(world, registry), packs: { minds: { round: 0, on: false, chars: {}, presence: [], knowledge } } }) as unknown as WorldState;
    const before = slice({ threshold: 0.7 });
    expect(knowledgeChange(before, { tracked: true, threshold: 0.5 })).toEqual([{ lane: "story", op: "minds.knowledge", value: { type: "minds.knowledge", data: { on: true, threshold: 0.5 } }, by: "rpe" }]);
    expect(knowledgeChange(before, { tracked: true, threshold: 0.7 })).toEqual([]);
    expect(knowledgeRecorded(before)).toEqual({ tracked: true, threshold: 0.7 });
    expect(knowledgeRecorded(slice({ off: true, threshold: 0.5 }))).toEqual({ tracked: false, threshold: 0.5 });
  });
});

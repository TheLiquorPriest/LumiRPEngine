// Agent change types (AGENT-LOOP-PLAN §6, §15): each takes a mode as an extraction type does and
// shares its pins, defaults as the plan says, and learns per role × connection × type, apart from
// the extract step's per-connection learning, which stays as it was.

import { describe, expect, test } from "bun:test";
import { defaultSettings, effectiveMode, recordOutcome, SettingsStore, undoModeChange, type ModeChange } from "../../src/backend/settings-store";
import { hasOwn, isRecord } from "../../src/shared/json";
import { AGENT_CHANGE_DEFAULTS, AGENT_CHANGE_LABEL, AGENT_CHANGE_TYPES, CHANGE_TYPES, EXTRACTION_LEARNING, EXTRACTION_TYPES, type ChangeType, type ExtractionLearning } from "../../src/shared/settings";
import { FakeHost } from "../support/fake-host";
import { Rig } from "../support/rig";

const LEARNING_FILE = "extraction-learning.json";
const UNSAFE_IDS = ["__proto__", "constructor", "prototype"];

function fresh(): ExtractionLearning {
  return { v: 1, connections: {} };
}

/** `minProposals` accepted outcomes in a row; the flip they made, if any. */
function acceptMany(learning: ExtractionLearning, connectionId: string, type: ChangeType, role?: string): ModeChange | null {
  const settings = defaultSettings();
  let change: ModeChange | null = null;
  for (let i = 0; i < EXTRACTION_LEARNING.minProposals; i++) change = recordOutcome(settings, learning, connectionId, type, "accepted", 1000 + i, role) ?? change;
  return change;
}

describe("agent change types", () => {
  test("each takes the plan's default mode, has a label, and is no extraction type", () => {
    const settings = defaultSettings();
    expect(AGENT_CHANGE_DEFAULTS).toEqual({ gm_spawn: "confirm", despawn: "confirm", destroy: "confirm", money_adjust: "confirm", stage: "confirm", gm_edit: "auto", workspace: "auto" });
    expect(CHANGE_TYPES).toEqual([...EXTRACTION_TYPES, ...AGENT_CHANGE_TYPES]);
    for (const type of AGENT_CHANGE_TYPES) {
      const cold = { mode: AGENT_CHANGE_DEFAULTS[type], source: "default" as const };
      expect(effectiveMode(settings, fresh(), "conn-a", type)).toEqual(cold);
      expect(effectiveMode(settings, fresh(), "conn-a", type, "assistant")).toEqual(cold);
      expect(effectiveMode(settings, fresh(), null, type, "assistant")).toEqual(cold);
      expect(AGENT_CHANGE_LABEL[type].length).toBeGreaterThan(0);
      expect(EXTRACTION_TYPES.some((t: string) => t === type)).toBe(false);
    }
  });

  test("a pin set over the protocol wins, keeps no maxDelta, and null unpins it", async () => {
    const rig = new Rig();
    const set = rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { despawn: { mode: "auto", maxDelta: 5 } } } }));
    if (!isRecord(set.settings) || !isRecord(set.settings.extraction)) throw new Error("no settings");
    expect(set.settings.extraction.despawn).toEqual({ mode: "auto" });
    const got = rig.body(await rig.send({ type: "lre.settings.get" }));
    const views = isRecord(got.extraction) ? got.extraction : {};
    for (const type of CHANGE_TYPES) expect(hasOwn(views, type)).toBe(true);
    const pinned = views.despawn;
    if (!isRecord(pinned)) throw new Error("no despawn view");
    expect(pinned.mode).toBe("auto");
    expect(pinned.source).toBe("pinned");
    expect(pinned.accepted).toBe(0);
    expect(pinned.rejected).toBe(0);
    const other = views.gm_edit;
    if (!isRecord(other)) throw new Error("no gm_edit view");
    expect(other.mode).toBe("auto");
    expect(other.source).toBe("default");
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { despawn: null } } }));
    const after = rig.body(await rig.send({ type: "lre.settings.get" }));
    const unpinned = isRecord(after.extraction) ? after.extraction.despawn : undefined;
    if (!isRecord(unpinned)) throw new Error("no despawn view");
    expect(unpinned.mode).toBe("confirm");
    expect(unpinned.source).toBe("default");
  });

  test("an agent's outcomes learn per role × connection × type, and its mode-change undo keeps to its role", () => {
    const settings = defaultSettings();
    const learning = fresh();
    const change = acceptMany(learning, "conn-a", "money_adjust", "assistant");
    expect(change).toEqual({ connectionId: "conn-a", type: "money_adjust", from: "confirm", to: "auto", role: "assistant" });
    expect(effectiveMode(settings, learning, "conn-a", "money_adjust", "assistant")).toEqual({ mode: "auto", source: "learned" });
    const cold = { mode: "confirm" as const, source: "default" as const };
    expect(effectiveMode(settings, learning, "conn-a", "money_adjust", "scribe")).toEqual(cold);
    expect(effectiveMode(settings, learning, "conn-b", "money_adjust", "assistant")).toEqual(cold);
    expect(effectiveMode(settings, learning, "conn-a", "money_adjust")).toEqual(cold);
    expect(effectiveMode(settings, learning, null, "money_adjust", "assistant")).toEqual(cold);
    expect(effectiveMode(settings, learning, "conn-a", "destroy", "assistant")).toEqual(cold);
    // The extract step's learning holds none of it.
    expect(learning.connections).toEqual({});
    // A pin still wins over what the role learned.
    const pinnedSettings = { ...settings, extraction: { money_adjust: { mode: "never" as const } } };
    expect(effectiveMode(pinnedSettings, learning, "conn-a", "money_adjust", "assistant")).toEqual({ mode: "never", source: "pinned" });
    if (!change) throw new Error("no flip");
    undoModeChange(learning, change);
    expect(effectiveMode(settings, learning, "conn-a", "money_adjust", "assistant")).toEqual({ mode: "confirm", source: "learned" });
    expect(learning.roles?.assistant?.["conn-a"]?.money_adjust?.holdUntil).toBe(EXTRACTION_LEARNING.minProposals * 2);
  });

  test("an agent type with no role records nothing", () => {
    const learning = fresh();
    expect(recordOutcome(defaultSettings(), learning, "conn-a", "money_adjust", "accepted", 0)).toBeNull();
    expect(learning).toEqual(fresh());
    expect(hasOwn(learning, "roles")).toBe(false);
  });

  test("the extract step's learning (no role) is as it was", () => {
    const settings = defaultSettings();
    const learning = fresh();
    const change = acceptMany(learning, "conn-a", "purchase");
    expect(change).toEqual({ connectionId: "conn-a", type: "purchase", from: "confirm", to: "auto" });
    expect(change !== null && hasOwn(change, "role")).toBe(false);
    expect(learning.connections["conn-a"]?.purchase?.accepted).toBe(EXTRACTION_LEARNING.minProposals);
    expect(hasOwn(learning, "roles")).toBe(false);
    expect(effectiveMode(settings, learning, "conn-a", "purchase")).toEqual({ mode: "auto", source: "learned" });
    expect(effectiveMode(settings, learning, "conn-a", "purchase", "assistant")).toEqual({ mode: "confirm", source: "default" });
    if (!change) throw new Error("no flip");
    undoModeChange(learning, change);
    expect(effectiveMode(settings, learning, "conn-a", "purchase")).toEqual({ mode: "confirm", source: "learned" });
  });

  test("a prototype-key role or connection id records nothing and is never learned", () => {
    const settings = defaultSettings();
    const learning = fresh();
    for (const role of UNSAFE_IDS) {
      expect(acceptMany(learning, "conn-a", "money_adjust", role)).toBeNull();
      expect(effectiveMode(settings, learning, "conn-a", "money_adjust", role).source).toBe("default");
    }
    for (const id of UNSAFE_IDS) {
      expect(acceptMany(learning, id, "money_adjust", "assistant")).toBeNull();
      expect(effectiveMode(settings, learning, id, "money_adjust", "assistant").source).toBe("default");
    }
    expect(hasOwn(learning, "roles")).toBe(false);
    expect(learning.connections).toEqual({});
    for (const k of ["money_adjust", "conn-a", "assistant", "accepted"]) expect(hasOwn(Object.prototype, k)).toBe(false);
  });

  test("the learning file round-trips roles and drops malformed entries", async () => {
    const host = new FakeHost();
    const user = host.userId;
    const good = { accepted: 30, rejected: 0, recent: "a".repeat(30), learned: "auto", changedAt: 5 };
    const g = JSON.stringify(good);
    // Written as text so `__proto__` is an own key, as a stored file would have it.
    const stored =
      `{"v":1,"connections":{"conn-a":{"purchase":{"accepted":1,"rejected":0,"recent":"a"}}},"roles":{` +
      `"assistant":{"conn-a":{"money_adjust":${g},"despawn":{"accepted":-1,"rejected":0,"recent":""},"workspace":{"accepted":1,"rejected":0,"recent":"x"},"gm_edit":{"accepted":1,"rejected":0,"recent":"a","learned":"maybe"},"bogus":${g}},"__proto__":{"money_adjust":${g}},"conn-b":"nope"},` +
      `"__proto__":{"conn-a":{"money_adjust":${g}}},"constructor":{"conn-a":{"money_adjust":${g}}},"scribe":7}}`;
    await host.storage.write(LEARNING_FILE, stored, user);
    const store = new SettingsStore(host);
    const learning = await store.learningOf(user);
    expect(learning).toEqual({ v: 1, connections: { "conn-a": { purchase: { accepted: 1, rejected: 0, recent: "a" } } }, roles: { assistant: { "conn-a": { money_adjust: { accepted: 30, rejected: 0, recent: "a".repeat(30), learned: "auto", changedAt: 5 } } } } });
    expect(Object.keys(learning.roles ?? {})).toEqual(["assistant"]);
    expect(effectiveMode(defaultSettings(), learning, "conn-a", "money_adjust", "assistant")).toEqual({ mode: "auto", source: "learned" });
    recordOutcome(defaultSettings(), learning, "conn-b", "stage", "rejected", 9, "assistant");
    await store.saveLearning(user);
    expect(await new SettingsStore(host).learningOf(user)).toEqual(learning);
    // A file that never held an agent's outcome reads back without `roles`.
    const plain = new FakeHost();
    await plain.storage.write(LEARNING_FILE, JSON.stringify({ v: 1, connections: {} }), plain.userId);
    expect(hasOwn(await new SettingsStore(plain).learningOf(plain.userId), "roles")).toBe(false);
  });
});

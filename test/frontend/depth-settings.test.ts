// Settings → Depth (DEPTH-PLAN §7; owner D-3: every place a model is used is the user's to choose):
// a row per role on Strong, Fast or its own model, each patching only itself under `depth`; the
// presets list what they change, from → to, before Apply, and Apply patches only those; the stored
// block reads back with every bad value at its default; and a role's call resolves to its model or,
// with none named, the helper model's.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { mergePatch } from "../../src/backend/settings-store";
import { Button, HostModelPicker, HostSelect, HostSlider, HostSwitch, IdText, NumberStepper, saveQueue, Seg, Tabs } from "../../src/frontend/components";
import { DepthPage, depthChanged, depthSummary, ModelRows, RoleRow } from "../../src/frontend/settings/depth";
import { LimitRow, SettingRow } from "../../src/frontend/settings/kit";
import { currentDepthPreset, DEPTH_ROLES, defaultDepthSettings, depthCall, depthPresetChanges, depthSettingsOf } from "../../src/shared/depth-settings";
import type { JsonObject } from "../../src/shared/json";
import { composeMergePatches } from "../../src/shared/json-patch";
import { DEFAULT_HELPER } from "../../src/shared/settings";
import { propsOf, type Props } from "../support/tree";

const OPAQUE = new Set<unknown>([HostModelPicker, HostSelect, HostSlider, HostSwitch, IdText, NumberStepper, Tabs, LimitRow]);

function render(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(render);
  if (!node || typeof node !== "object" || !("type" in node)) return node;
  const v = node as VNode<Props>;
  if (typeof v.type === "function" && !OPAQUE.has(v.type)) return { ...v, props: { ...v.props, children: render((v.type as (p: Props) => unknown)(v.props)) } };
  return { ...v, props: { ...v.props, children: render(v.props.children) } };
}

function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

const CONNECTIONS = [
  { id: "conn-ds", name: "DeepSeek", model: "deepseek-v4-flash" },
  { id: "conn-gw", name: "Gateway", model: null },
];

function page(depth = defaultDepthSettings(), picked: Parameters<typeof DepthPage>[0]["picked"] = null) {
  const patches: JsonObject[] = [];
  const picks: unknown[] = [];
  const tree = render(DepthPage({ depth, connections: CONNECTIONS, busy: false, picked, onPick: (id) => void picks.push(id), patch: (p) => void patches.push(p) }));
  return { tree, patches, picks };
}

describe("Settings → Depth", () => {
  test("every role has a row on Strong, Fast or its own model, and the shipped page is Balanced with nothing changed", () => {
    const { tree } = page();
    const roles = propsOf(tree, "div").filter((p) => typeof p["data-lre-depth-role"] === "string").map((p) => p["data-lre-depth-role"]);
    expect(roles).toEqual([...DEPTH_ROLES]);
    expect(roles).toEqual(["author", "character", "gm", "check", "pov", "narrator", "historian", "realtime", "watch"]);
    const runsOn = propsOf(tree, Seg).filter((p) => String(p.label).endsWith(": runs on"));
    expect(runsOn.map((p) => p.value)).toEqual(["strong", "strong", "strong", "fast", "fast", "strong", "strong", "strong", "strong"]);
    expect(propsOf(tree, SettingRow).every((p) => p.changed === false)).toBe(true);
    expect(currentDepthPreset(defaultDepthSettings())).toBe("balanced");
    expect(depthSummary(defaultDepthSettings())).toBe("Balanced preset");
    expect(depthChanged(defaultDepthSettings())).toBe(0);
    const text = textOf(tree);
    expect(text).toContain("Runs on Strong model: The helper model's connection · High reasoning.");
    for (const group of ["models", "roles", "author", "budget", "narrator", "background", "bootstrap"]) expect(propsOf(tree, "div").some((p) => p["data-lre-depth-group"] === group)).toBe(true);
  });

  test("a role's model patches only that role; on its own model it shows its own connection, model, reasoning and answer room", () => {
    const patches: JsonObject[] = [];
    const shipped = defaultDepthSettings();
    const row = render(RoleRow({ role: "pov", depth: shipped, connections: CONNECTIONS, busy: false, patch: (p) => void patches.push(p) }));
    (propsOf(row, Seg).find((p) => p.label === "Point-of-view render: runs on")?.onChange as (v: string) => void)("own");
    expect(patches).toEqual([{ depth: { roles: { pov: { uses: "own" } } } }]);

    const own = depthSettingsOf({ roles: { pov: { uses: "own", own: { connectionId: "conn-ds", model: "deepseek-v4-flash", effort: "off", maxTokens: 4096 } } } });
    expect(currentDepthPreset(own)).toBeNull();
    expect(depthChanged(own)).toBe(5);
    const mine: JsonObject[] = [];
    const rendered = render(RoleRow({ role: "pov", depth: own, connections: CONNECTIONS, busy: false, patch: (p) => void mine.push(p) }));
    expect(textOf(rendered)).toContain("Runs on its own model: DeepSeek, deepseek-v4-flash · Off reasoning.");
    expect(propsOf(rendered, HostModelPicker).map((p) => p.value)).toEqual(["deepseek-v4-flash"]);
    const select = propsOf(rendered, "select")[0];
    (select?.onChange as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value: "conn-gw" } });
    const reset = propsOf(rendered, Button).find((p) => p.label === "Reset Point-of-view render to its default, the Fast model");
    (reset?.onClick as () => void)();
    expect(mine).toEqual([{ depth: { roles: { pov: { own: { connectionId: "conn-gw", model: null } } } } }, { depth: { roles: { pov: { uses: "fast", own: { connectionId: null, model: null, effort: "inherit", maxTokens: 8192, temperature: null, topP: null } } } } }]);
  });

  test("Strong and Fast are each one model: a connection and its model, reasoning and answer room, each with its default", () => {
    const patches: JsonObject[] = [];
    const strong = { connectionId: "conn-gw", model: "big-model", effort: "max" as const, maxTokens: 32768, temperature: 0.4, topP: null };
    const rows = render(ModelRows({ id: "strong", owner: "Strong model", value: strong, standard: defaultDepthSettings().strong, connections: CONNECTIONS, busy: false, set: (f) => void patches.push(f) }));
    const changed = propsOf(rows, SettingRow).map((p) => [p.id, p.changed]);
    expect(changed).toEqual([["strong.connection", true], ["strong.effort", true], ["strong.maxTokens", true], ["strong.temperature", true], ["strong.topP", false]]);
    (propsOf(rows, NumberStepper)[0]?.onChange as (v: number) => void)(16384);
    const [temperature, topP] = propsOf(rows, "input").filter((p) => p.type === "number");
    expect(temperature?.value).toBe(0.4);
    expect(topP?.value).toBe("");
    (temperature?.onChange as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value: "" } });
    (topP?.onChange as (event: { currentTarget: { value: string } }) => void)({ currentTarget: { value: "0.85" } });
    expect(patches).toEqual([{ maxTokens: 16384 }, { temperature: null }, { topP: 0.85 }]);
  });

  test("a DeepSeek connection is offered for Fast, setting only Fast's connection", () => {
    const offer = (connections: { id: string; name: string; model: string | null; provider?: string }[], depth = defaultDepthSettings()) => {
      const patches: JsonObject[] = [];
      const tree = render(DepthPage({ depth, connections, busy: false, picked: null, onPick: () => undefined, patch: (p) => void patches.push(p) }));
      return { button: propsOf(tree, "button").find((p) => textOf(p.children) === "Use my DeepSeek connection for Fast"), patches };
    };
    const ds = [{ id: "conn-gw", name: "Gateway", model: null, provider: "openrouter" }, { id: "conn-ds", name: "Cheap", model: "deepseek-v4-flash", provider: "deepseek" }];
    const { button, patches } = offer(ds);
    (button?.onClick as () => void)();
    expect(patches).toEqual([{ depth: { fast: { connectionId: "conn-ds", model: null } } }]);
    expect(offer(CONNECTIONS).button).toBeUndefined();
    const onIt = depthSettingsOf({ fast: { connectionId: "conn-ds" } });
    expect(offer(ds, onIt).button).toBeUndefined();
  });

  test("a preset lists what it changes, from → to, before Apply, and Apply patches only those", () => {
    const deepest = depthPresetChanges(defaultDepthSettings(), "deepest");
    expect(deepest.changes.map((c) => `${c.label}: ${c.from} → ${c.to}`)).toEqual(["Render check: Fast model → Strong model", "Point-of-view render: Fast model → Strong model"]);
    const lean = depthPresetChanges(defaultDepthSettings(), "lean");
    expect(lean.changes.map((c) => c.key)).toEqual(["gm", "narrator", "historian", "realtime", "watch", "cadence"]);
    expect(lean.patch.cadence).toBe("scenes");

    const { tree, patches, picks } = page(defaultDepthSettings(), "deepest");
    const text = textOf(tree);
    expect(text).toContain("Deepest changes 2 settings");
    expect(text).toContain("Render check");
    expect(text).toContain("Fast model → Strong model");
    const apply = propsOf(tree, Button).find((p) => textOf(p.children).trim() === "Apply");
    (apply?.onClick as () => void)();
    expect(patches).toEqual([{ depth: { roles: { check: { uses: "strong" }, pov: { uses: "strong" } } } }]);
    expect(picks).toEqual([null]);
    expect(textOf(page(defaultDepthSettings(), "balanced").tree)).toContain("Already Balanced");
  });

  test("the budget, the narrator, real time, the background lanes and the bootstrap each patch their own setting", () => {
    const { tree, patches } = page();
    (propsOf(tree, Seg).find((p) => p.label === "Allowances per")?.onChange as (v: string) => void)("month");
    (propsOf(tree, Seg).find((p) => p.label === "The thinking block shows")?.onChange as (v: string) => void)("progress");
    (propsOf(tree, Seg).find((p) => p.label === "Real-time dialogue starts")?.onChange as (v: string) => void)("chip");
    (propsOf(tree, HostSwitch).find((p) => p.label === "Work between turns")?.onChange as (v: boolean) => void)(false);
    (propsOf(tree, HostSwitch).find((p) => p.label === "No cap")?.onChange as (v: boolean) => void)(true);
    (propsOf(tree, NumberStepper).find((p) => p.label === "Redrafts per passage")?.onChange as (v: number) => void)(3);
    (propsOf(tree, NumberStepper).find((p) => p.label === "Beats per catch-up")?.onChange as (v: number) => void)(25);
    const live = propsOf(tree, LimitRow).find((p) => p.id === "budget.live");
    (live?.set as (v: number | "none" | null) => void)(5);
    (live?.set as (v: number | "none" | null) => void)(null);
    expect(patches).toEqual([
      { depth: { budget: { interval: "month" } } },
      { depth: { thinking: "progress" } },
      { depth: { realtime: "chip" } },
      { depth: { background: { on: false } } },
      { depth: { bootstrap: { cap: "none" } } },
      { depth: { redrafts: 3 } },
      { depth: { catchUpBatch: 25 } },
      { depth: { budget: { allowances: { live: 5 } } } },
      { depth: { budget: { allowances: { live: 2 } } } },
    ]);
  });

  test("the per-day ceiling's help says its day is a UTC day", () => {
    const { tree } = page();
    const perDay = propsOf(tree, LimitRow).find((p) => p.id === "budget.perDay")?.def as { limits: string; fires: string } | undefined;
    expect(perDay?.limits).toContain("one UTC day (midnight to midnight UTC");
    expect(perDay?.fires).toContain("until the day turns at midnight UTC");
  });

  test("the author's steps per turn are a row of their own, and the per-turn ceiling's help says what binding it does", () => {
    const { tree, patches } = page();
    const steps = propsOf(tree, NumberStepper).find((p) => p.label === "Steps per turn");
    expect(steps?.value).toBe(12);
    (steps?.onChange as (v: number) => void)(20);
    expect(patches).toEqual([{ depth: { steps: 20 } }]);
    const perTurn = propsOf(tree, LimitRow).find((p) => p.id === "budget.perTurn")?.def as { fires: string } | undefined;
    expect(perTurn?.fires).toContain("Once the ceiling binds, it plays itself the characters who had their own agents, and the scene goes on as far as it judges.");
    expect(perTurn?.fires).not.toContain("slides characters down the effort ladder, picks a cheaper treatment or defers work");
  });
});

describe("the stored Depth settings", () => {
  test("read back with every bad value at its default, a model kept only with its connection, and no cap as none", () => {
    const read = depthSettingsOf({
      strong: { connectionId: "conn-gw", model: "big-model", effort: "ultra", maxTokens: 5 },
      fast: { model: "orphan" },
      roles: { author: { uses: "elsewhere" }, check: { uses: "own", own: { connectionId: "", model: "m" } } },
      cadence: "hourly",
      budget: { interval: "week", allowances: { live: -1, room: "none" }, perTurn: 10 },
      redrafts: 99,
      steps: 0,
      bootstrap: { cap: "none", atOnce: { minds: 4 } },
    });
    const shipped = defaultDepthSettings();
    expect(read.strong).toEqual({ connectionId: "conn-gw", model: "big-model", effort: shipped.strong.effort, maxTokens: shipped.strong.maxTokens, temperature: null, topP: null });
    expect(read.fast).toEqual(shipped.fast);
    expect(read.roles.author.uses).toBe("strong");
    expect(read.roles.check).toEqual({ uses: "own", own: { connectionId: null, model: null, effort: "inherit", maxTokens: 8192, temperature: null, topP: null } });
    expect(read.cadence).toBe("turns");
    expect(read.budget.allowances).toEqual({ live: 2, campfire: 4, room: "none", written: "none" });
    expect(read.budget.perTurn).toBe(shipped.budget.perTurn);
    expect(read.redrafts).toBe(2);
    expect(read.steps).toBe(12);
    expect(depthSettingsOf({ steps: 30 }).steps).toBe(30);
    expect(read.bootstrap.cap).toBe("none");
    expect(read.bootstrap.atOnce).toEqual({ minds: 4 });
    expect(read.bootstrap.mostMinds).toBe(0);
    expect(depthSettingsOf(undefined)).toEqual(shipped);
  });

  test("a role's call runs on its own model, else Strong's or Fast's, and with no connection named on the helper model's", () => {
    const helper = { ...DEFAULT_HELPER, connectionId: "conn-ds", model: "deepseek-v4-flash", params: { temperature: 0.7 } };
    const depth = depthSettingsOf({ strong: { connectionId: "conn-gw", model: "big-model", effort: "high", maxTokens: 32768 }, roles: { narrator: { uses: "own", own: { connectionId: "conn-gw", model: "prose-model", effort: "medium", maxTokens: 12000 } } } });
    expect(depthCall({ depth, helper }, "author")).toEqual({ connectionId: "conn-gw", model: "big-model", effort: "high", maxTokens: 32768, params: { temperature: 0.7 } });
    expect(depthCall({ depth, helper }, "narrator")).toEqual({ connectionId: "conn-gw", model: "prose-model", effort: "medium", maxTokens: 12000, params: { temperature: 0.7 } });
    expect(depthCall({ depth, helper }, "check")).toEqual({ connectionId: "conn-ds", model: "deepseek-v4-flash", effort: "low", maxTokens: 8192, params: { temperature: 0.7 } });
  });
});

describe("Settings saves", () => {
  const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

  /** A store that takes `ms` to save each patch, and the queue Settings saves through. */
  function slowStore(ms: number, start: JsonObject = {}) {
    let stored: JsonObject = start;
    const sent: JsonObject[] = [];
    let busy = false;
    const patch = saveQueue(
      async (p) => {
        sent.push(p);
        await sleep(ms);
        stored = mergePatch(stored, p) as JsonObject;
      },
      (on) => {
        busy = on;
      },
    );
    const idle = async () => {
      while (busy) await sleep(1);
    };
    return { patch, sent, idle, stored: () => stored };
  }

  test("a model's name typed one key at a time, while each save is slow, is stored whole", async () => {
    const depth = depthSettingsOf({ strong: { connectionId: "conn-gw", model: null } });
    const store = slowStore(15, { depth: depth as unknown as JsonObject });
    const tree = render(DepthPage({ depth, connections: CONNECTIONS, busy: false, picked: null, onPick: () => undefined, patch: store.patch }));
    const picker = propsOf(tree, HostModelPicker).find((p) => p.label === "Strong model: model");
    const name = "claude/claude-sonnet-5-5";
    for (let i = 1; i <= name.length; i++) {
      (picker?.onChange as (model: string) => void)(name.slice(0, i));
      await sleep(2);
    }
    await store.idle();
    expect(depthSettingsOf(store.stored().depth).strong.model).toBe(name);
    // The keys typed while a save was under way went as fewer saves, the last of them the whole name.
    expect(store.sent.length).toBeLessThan(name.length);
    expect(store.sent.at(-1)).toEqual({ depth: { strong: { model: name } } });
  });

  test("edits to different settings while a save is under way all land, as if each were saved in turn", async () => {
    const start: JsonObject = { depth: { strong: { connectionId: "conn-gw", model: "a" }, steps: 4, budget: { ask: true } } };
    const edits: JsonObject[] = [{ depth: { steps: 5 } }, { depth: { strong: { model: "ab" } } }, { depth: { budget: null } }, { depth: { budget: { ask: false } } }, { depth: { steps: 6 } }];
    const store = slowStore(10, start);
    for (const edit of edits) store.patch(edit);
    await store.idle();
    expect(store.stored()).toEqual(edits.reduce<JsonObject>((at, edit) => mergePatch(at, edit) as JsonObject, start));
    // A deletion with an object merged into it after can't be one patch, so that one waits its turn.
    expect(store.sent).toEqual([{ depth: { steps: 5 } }, { depth: { strong: { model: "ab" }, budget: null } }, { depth: { budget: { ask: false }, steps: 6 } }]);
  });

  test("a tap repeated while its save is under way is one save", async () => {
    const store = slowStore(10);
    const tap: JsonObject = { depth: { thinking: "progress" } };
    store.patch(tap);
    store.patch(tap);
    store.patch(tap);
    await store.idle();
    expect(store.sent).toEqual([tap]);
  });

  test("two merge patches compose into one only where one patch can say both", () => {
    expect(composeMergePatches({ a: { b: 1, c: 2 } }, { a: { b: 3 }, d: 4 })).toEqual({ a: { b: 3, c: 2 }, d: 4 });
    expect(composeMergePatches({ a: { b: 1 } }, { a: null })).toEqual({ a: null });
    expect(composeMergePatches({ a: [1] }, { a: [2] })).toEqual({ a: [2] });
    expect(composeMergePatches({ a: null }, { a: { b: 1 } })).toBeNull();
    expect(composeMergePatches({ a: "x" }, { a: { b: 1 } })).toBeNull();
    expect(composeMergePatches({ toString: 1 }, { valueOf: { b: 1 } })).toEqual({ toString: 1, valueOf: { b: 1 } });
  });
});

// Prototype pollution and clamps: request, stored and imported keys never
// reach a prototype, markers are checked and clamped wherever they enter, and the worker's
// Object.prototype stays clean.

import { afterEach, describe, expect, test } from "bun:test";
import { PROTOCOL_VERSION, type FrontendToBackend } from "../../src/shared/protocol";
import { renderSection } from "../../src/backend/book";
import { neutralizeMacros } from "../../src/shared/macros";
import { HOST_REPO, hostTwoPass } from "../support/host-macros";
import { decodeJournal, decodeLedger, journalPath, snapshotsPath, toChain } from "../../src/backend/ledger-io";
import { defaultSettings, effectiveMode, mergePatch, recordOutcome, SettingsStore } from "../../src/backend/settings-store";
import { ChipStore } from "../../src/backend/chips";
import { JOBS_PATH } from "../../src/backend/jobs";
import { PlanNotes } from "../../src/backend/plan-notes";
import { CORRUPT_SUFFIX } from "../../src/backend/stored-json";
import { proposalKnown } from "../../src/backend/runtime";
import { applyMarker, TIME_BOUNDS, validMarkerBody } from "../../src/engine/events";
import { runDir } from "../../src/shared/ids";
import type { JsonObject } from "../../src/shared/json";
import { hasOwn } from "../../src/shared/json";
import { LEDGER_NAMESPACE, type MarkerBody } from "../../src/shared/ledger";
import { CallMeter, Steps } from "../../src/backend/steps";
import { FakeHost } from "../support/fake-host";
import { Rig } from "../support/rig";

const PROTO_KEYS = ["money", "polluted", "x"];

function clean(): void {
  for (const k of PROTO_KEYS) expect(hasOwn(Object.prototype, k)).toBe(false);
  const probe: Record<string, unknown> = {};
  expect(probe.polluted).toBeUndefined();
  expect(probe.money).toBeUndefined();
}

afterEach(() => {
  for (const k of PROTO_KEYS) Reflect.deleteProperty(Object.prototype, k);
});

describe("prototype pollution", () => {
  test("settings are checked against their schema: wrong types and ranges fall back, open maps keep safe keys", async () => {
    const rig = new Rig();
    const d = defaultSettings();
    const set = rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { budgets: { post: { ms: "fast", calls: -3 } } }, time: { scale: "x", sceneTicks: { cafe: 9999, bar: 10 }, montage: "year" }, swipeDefault: "boom", realism: { levels: { money: 9 } }, extraction: { purchase: { mode: "yolo" } } } }));
    const s = set.settings as typeof d;
    expect(s.modelUse.budgets.post).toEqual(d.modelUse.budgets.post);
    expect(s.time.scale).toBe(d.time.scale);
    expect(s.time.montage).toBe(d.time.montage);
    expect(s.time.sceneTicks.bar).toBe(10);
    expect(hasOwn(s.time.sceneTicks, "cafe")).toBe(false);
    expect(s.swipeDefault).toBe(d.swipeDefault);
    expect(s.realism.levels.money).toBe(d.realism.levels.money);
    expect(hasOwn(s.extraction, "purchase")).toBe(false);
  });

  test("D4 learning never keys a prototype: an unsafe connection id records nothing", () => {
    const settings = defaultSettings();
    const learning = { v: 1 as const, connections: {} };
    for (const id of ["__proto__", "constructor", "prototype"]) {
      expect(recordOutcome(settings, learning, id, "purchase", "accepted", 0)).toBeNull();
      expect(effectiveMode(settings, learning, id, "purchase").source).not.toBe("learned");
    }
    expect(Object.keys(learning.connections)).toEqual([]);
    for (const k of PROTO_KEYS) expect(hasOwn(Object.prototype, k)).toBe(false);
  });

  test("a resolve marker scoped to the tier __proto__ is refused at dispatch and inert at apply", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const reply = await rig.send({ type: "lre.marker", chatId, kind: "resolve", domain: "money", scope: { tier: "__proto__" }, to: 4 });
    expect(reply.type).toBe("lre.error");
    // Forged past the request path (an old or imported ledger): applyMarker re-checks it.
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const state = core?.renderState(toChain(await rig.host.chats.messages(chatId, rig.host.userId)))?.state;
    if (!state) throw new Error("no state to apply the marker to");
    const before = JSON.stringify(state);
    applyMarker(state, JSON.parse('{"kind":"resolve","domain":"money","scope":{"tier":"__proto__"},"to":4}') as Extract<MarkerBody, { kind: "resolve" }>);
    expect(JSON.stringify(state)).toBe(before);
    clean();
  });

  test("validMarkerBody rejects unknown domains, tiers, entities and kinds, and clamps time controls", () => {
    expect(validMarkerBody({ kind: "resolve", domain: "__proto__", scope: { all: true }, to: 1 })).toBeNull();
    expect(validMarkerBody({ kind: "resolve", domain: "money", scope: { tier: "pov" }, to: 1 })).toBeNull();
    expect(validMarkerBody({ kind: "resolve", domain: "money", scope: { entity: "constructor" }, to: 1 })).toBeNull();
    expect(validMarkerBody({ kind: "resolve", domain: "money", scope: { all: true }, to: 2.5 })).toBeNull();
    expect(validMarkerBody({ kind: "time", control: "tick", scope: { sceneType: "__proto__" }, to: 5 })).toBeNull();
    expect(validMarkerBody({ kind: "poison", to: 1 })).toBeNull();
    const cap = validMarkerBody({ kind: "time", control: "unit_cap", scope: { all: true }, to: { agentDays: 1e9, events: -4 } });
    expect(cap).toEqual({ kind: "time", control: "unit_cap", scope: { all: true }, to: { agentDays: TIME_BOUNDS.agentDays[1], events: TIME_BOUNDS.events[0] } });
    expect(validMarkerBody({ kind: "time", control: "scale", scope: { all: true }, to: 1000 })).toEqual({ kind: "time", control: "scale", scope: { all: true }, to: TIME_BOUNDS.scale[1] });
    expect(validMarkerBody({ kind: "time", control: "npc_calls", scope: { all: true }, to: 999 })).toEqual({ kind: "time", control: "npc_calls", scope: { all: true }, to: TIME_BOUNDS.npcCalls[1] });
  });

  test("a stored ledger keeps only valid markers and swipe-index keys", () => {
    const rec = `{"v":1,"defHash":"r1","seq":1,"swipeHash":{"len":0,"hash":"h"},"path":"","seed":"","pre":0,"events":[],"post":[],"markersApplied":0,"status":"ok","undone":[],"intents":{}}`;
    const bag = JSON.parse(
      `{"${LEDGER_NAMESPACE}":{"v":1,"swipes":{"0":${rec},"__proto__":{"events":[],"post":[],"polluted":true}},"markers":[{"kind":"resolve","domain":"money","scope":{"tier":"__proto__"},"to":4,"seq":1,"at":""},{"kind":"resolve","domain":"money","scope":{"all":true},"to":3,"seq":2,"at":""}]}}`,
    ) as JsonObject;
    const ledger = decodeLedger(bag);
    expect(ledger?.markers).toEqual([{ kind: "resolve", domain: "money", scope: { all: true }, to: 3, seq: 2, at: "" }]);
    expect(Object.keys(ledger?.swipes ?? {})).toEqual(["0"]);
    clean();
  });

  test("editor ids and collections that are prototype keys are refused", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld("Keys");
    expect((await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "__proto__", id: "x", value: {} })).type).toBe("lre.error");
    expect((await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: "__proto__", value: { polluted: true } })).type).toBe("lre.error");
    expect((await rig.send({ type: "lre.editor", op: "remove", worldId, base: null, collection: "constructor", id: "x" })).type).toBe("lre.error");
    clean();
  });

  test("a settings patch with prototype keys changes nothing beyond its own keys", async () => {
    const out = mergePatch({ a: 1 }, JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1},"b":2}') as JsonObject);
    expect(out).toEqual({ a: 1, b: 2 });
    const rig = new Rig();
    rig.body(await rig.send({ type: "lre.settings.set", patch: JSON.parse('{"__proto__":{"polluted":true},"modelUse":{"__proto__":{"polluted":true}}}') as JsonObject }));
    clean();
  });

  test("core events refuse prototype keys", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    expect((await rig.send({ type: "lre.fix", chatId, entity: "sam", field: "__proto__", value: { polluted: true } })).type).toBe("lre.error");
    expect((await rig.send({ type: "lre.fix", chatId, entity: "constructor", field: "x", value: 1 })).type).toBe("lre.error");
    clean();
  });

  test("an Upgrade to a revision the world doesn't have is refused", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    expect((await rig.send({ type: "lre.world", op: "upgrade", chatId, to: "deadbeefdeadbeefdeadbeefdeadbeef" })).type).toBe("lre.error");
    expect((await rig.send({ type: "lre.marker", chatId, kind: "migrate", to: "deadbeefdeadbeefdeadbeefdeadbeef" })).type).toBe("lre.error");
  });
});

describe("macro neutralization", () => {
  const attacks = [
    // The round-2 probe: `<user>` puts the text on the slow path, `postprocess()` turns the \x01/\x02
    // sentinels into braces, and the second pass runs the setvar.
    "Sam <user>\u0001\u0001setvar::pwned::yes\u0002\u0002",
    "<char>\u0001\u0001setvar::pwned::yes\u0002\u0002",
    "<BOT>\u0001\u0001set\u0000var::pwned::yes\u0002\u0002",
    "{{{setvar::pwned::yes}}}",
    "{{setvar::pwned::yes}}",
    "\\{\\{setvar::pwned::yes\\}\\}",
    "}}{{setvar::pwned::yes}}{{",
  ];

  // Everything the host's macro engine acts on (MacroParser/MacroEvaluator): `{` and `}` (macros and
  // `\{` escapes), the C0 sentinels \x00-\x02 that `postprocess()` turns back into braces, and the
  // `<user>`/`<char>`/`<bot>` shorthands that put a text on the slow path.
  test("lexer contract: a neutralized value holds nothing the host's macro engine acts on", () => {
    for (const a of attacks) {
      const n = neutralizeMacros(a);
      expect(n, a).not.toMatch(/[{}]/);
      expect(n, a).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
      expect(n, a).not.toMatch(/<(user|char|bot)>/i);
    }
    expect(renderSection("Sc{{ene}}", "Before {{lines}} after {{x}}", ["Name <user>\u0001\u0001x\u0002\u0002"])).toBe("[Sc｛｛ene｝｝]\nBefore - Name ＜user＞x after ｛｛x｝｝");
  });

  test.skipIf(HOST_REPO === null)(`the host's own evaluator, run twice, executes nothing in a neutralized value${HOST_REPO === null ? " (skipped: set LRE_HOST_REPO to a Lumiverse host checkout)" : ""}`, () => {
    const repo = HOST_REPO ?? "";
    const raw = hostTwoPass(repo, attacks);
    // The probe is real: unneutralized, the sentinel attack runs on the host's second pass.
    expect(raw[0]?.vars.pwned).toBe("yes");
    const safe = hostTwoPass(repo, attacks.map(neutralizeMacros));
    safe.forEach((r, i) => {
      expect(r.vars, attacks[i]).toEqual({});
      expect(r.second, attacks[i]).not.toContain("{{");
      expect(r.second, attacks[i]).not.toContain("setvar::pwned::yes}}");
    });
  });

  test("engine slots carry state values neutralized", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld("Macros");
    const { draft } = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId })) as { draft: { entities: Record<string, JsonObject> } };
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: "sam", value: { ...draft.entities.sam, name: "{{{setvar::x::pwned}}}" } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    await rig.turn(chatId, "I look around.", "Quiet.");
    const contents = (rig.host.lastInterceptor?.mutated ?? []).map((m) => m.content ?? "");
    expect(contents.some((c) => c.includes("setvar"))).toBe(true);
    for (const c of contents) expect(c).not.toMatch(/[{}]/);
  });

  test("section templates may hold only {{lines}}; an import lists the macros in lore and templates", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld("Templates");
    const reply = rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "sections", id: "scene", value: { id: "scene", label: "Scene", rank: 2, template: "Hi {{user}}\n{{lines}}", position: { type: "chat_depth", role: "system", depth: 1, direction: "from_end" } } })) as { lint: { code: string }[] };
    expect(reply.lint.map((i) => i.code)).toContain("section_macro");
    // Escape sentinels and `<user>`-style shorthands are host macro hazards too.
    for (const template of ["Hi <char>\n{{lines}}", "\u0001\u0001setvar::x::1\u0002\u0002 {{lines}}"]) {
      const linted = rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "sections", id: "scene", value: { id: "scene", label: "Scene", rank: 2, template, position: { type: "chat_depth", role: "system", depth: 1, direction: "from_end" } } })) as { lint: { code: string }[] };
      expect(linted.lint.map((i) => i.code)).toContain("section_macro");
    }
    const file = rig.body(await rig.send({ type: "lre.world", op: "export", worldId: await rig.newWorld("Source") })).file as { world: JsonObject };
    const world = { ...file.world, lore: { note: { id: "note", title: "Note", content: "The mayor is {{getvar::mayor}}.", keys: [], links: [] }, sly: { id: "sly", title: "Sly", content: "Ask <user>\u0001\u0001setvar::x::1\u0002\u0002 about it.", keys: [], links: [] } } };
    const imported = rig.body(await rig.send({ type: "lre.world", op: "import", file: { format: "lre-world-export-v1", world } })) as { lint: { code: string; path: string; message: string }[] };
    expect(imported.lint).toContainEqual(expect.objectContaining({ code: "import_macro", path: "lore.note.content" }));
    const sly = imported.lint.filter((i) => i.code === "import_macro" && i.path === "lore.sly.content").map((i) => i.message).join(" ");
    expect(sly).toContain("U+0001");
    expect(sly).toContain("<user>");
  });
});

describe("secrets in chips and the Journal", () => {
  // These go through extraction (a ✎ fix never reaches the chips they check).
  const extracting = (rig: Rig, proposals: JsonObject[]): void => {
    rig.host.quietReply = (req) => (req.messages.map((m) => m.content).join("\n").includes("propose concrete state changes") ? JSON.stringify({ proposals }) : "{}");
  };

  test("an extracted change carrying an unrevealed truth reaches neither a chip nor the Journal", async () => {
    const truth = "the mayor forged the harbor deed";
    const rig = new Rig();
    const worldId = await rig.newWorld("Secrets");
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "tracks", id: "deed", value: { id: "deed", kind: "secret", label: "The deed", start: "hidden", visibility: "secret", stages: { hidden: { label: "Hidden", next: [], truth } } } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    extracting(rig, [{ type: "purchase", item: `a note saying ${truth}`, price: 1 }, { type: "purchase", item: "coffee", price: 1 }]);
    await rig.turn(chatId, "I listen at the bar.", `Someone whispers that ${truth}.`);
    const view = await rig.rt.view(chatId, rig.host.userId);
    const shown = JSON.stringify([view.chips, view.journal]).toLowerCase();
    expect(shown).not.toContain(truth);
    // The harmless proposal still makes its chip (the check isn't vacuous).
    expect(shown).toContain("coffee");
  });

  test("an extracted change to someone the POV has never met stays out of chips and the Journal", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld("Strangers");
    const { draft } = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId })) as { draft: { entities: Record<string, JsonObject> } };
    for (const id of ["home", "bank"]) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "places", id, value: { id, name: id, fields: {} } }));
    const sam = draft.entities.sam;
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: "sam", value: { ...sam, fields: { ...(sam?.fields as JsonObject), place: "home" } } }));
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: "stranger", value: { id: "stranger", kind: "person", name: "Vera Holt", tier: "background", fields: { place: "bank" }, relations: [] } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    extracting(rig, [{ type: "condition", entity: "stranger", field: "cash", delta: 500 }, { type: "regard", from: "stranger", to: "sam", axis: "trust", delta: 1 }, { type: "purchase", item: "coffee", price: 1 }]);
    await rig.turn(chatId, "I look around.", "Across town, someone counts a thick roll of bills.");
    const view = await rig.rt.view(chatId, rig.host.userId);
    const shown = JSON.stringify([view.chips, view.journal]);
    expect(shown).not.toContain("Vera");
    expect(shown).not.toContain("stranger");
    expect(shown).toContain("coffee");
  });

  test("extraction never hears of, changes or chips someone the POV hasn't met and can't see", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld("Unmet");
    const { draft } = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId })) as { draft: { entities: Record<string, JsonObject> } };
    for (const id of ["home", "office"]) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "places", id, value: { id, name: id === "home" ? "Home" : "Office", fields: {} } }));
    const sam = draft.entities.sam;
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: "sam", value: { ...sam, fields: { ...(sam?.fields as JsonObject), place: "home" } } }));
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: "vera", value: { id: "vera", kind: "person", name: "Vera Holt", tier: "background", fields: { cash: 1000, place: "office" }, relations: [] } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const prompts: string[] = [];
    rig.host.quietReply = (req) => {
      const text = req.messages.map((m) => m.content).join("\n");
      if (!text.includes("propose concrete state changes")) return "{}";
      prompts.push(text);
      return JSON.stringify({ proposals: [{ type: "condition", entity: "vera", field: "cash", delta: 500 }] });
    };
    await rig.turn(chatId, "I watch the street.", "An unnamed figure counts a thick roll of bills.");
    expect(prompts.length).toBeGreaterThan(0);
    for (const p of prompts) expect(p).not.toContain("Vera Holt");
    const view = await rig.rt.view(chatId, rig.host.userId);
    expect(JSON.stringify(view.chips)).not.toContain("Vera");
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
    expect(state?.entities.vera?.fields.cash).toBe(1000);
    // A padded or recased id names her too (" vera " must not pass the check).
    const world = state ? core?.worldAt(state.revision) : undefined;
    if (!state || !world) throw new Error("no fold");
    expect(proposalKnown({ type: "condition", entity: " vera " }, rig.rt.registry, world, state)).toBe(false);
    expect(proposalKnown({ type: "condition", entity: "Vera" }, rig.rt.registry, world, state)).toBe(false);
    expect(proposalKnown({ type: "condition", entity: " sam " }, rig.rt.registry, world, state)).toBe(true);
  });
});

describe("cross-user access", () => {
  test("world revisions are cached per user and world; a revision outside the world's index is not found", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld("Mine");
    const { revision } = await rig.rt.worlds.get(worldId, rig.host.userId);
    expect(rig.rt.worlds.cached(rig.host.userId, worldId, revision)).toBeDefined();
    expect(rig.rt.worlds.cached("user-2", worldId, revision)).toBeUndefined();
    // Another world's revision, cached by its own load, is not readable through this world.
    const other = await rig.newWorld("Other");
    const otherRev = (await rig.rt.worlds.get(other, rig.host.userId)).revision;
    await expect(rig.rt.worlds.get(worldId, rig.host.userId, otherRev)).rejects.toThrow("not found");
    await expect(rig.rt.worlds.exportFile(worldId, rig.host.userId, otherRev)).rejects.toThrow("not found");
  });

  test("a journal from another run of the chat is reset; a legacy one is stamped; garbage is unreadable", () => {
    const run = { worldId: "w_1", runSeed: "seed-b" };
    const stored = (extra: JsonObject): string => JSON.stringify({ v: 1, chatId: "c1", seq: 3, chain: [], messages: {}, pauses: [], tombstones: [], held: [], windows: [], pending: {}, started: true, ...extra });
    expect(decodeJournal(stored({ run: { worldId: "w_1", runSeed: "seed-a" } }), "c1", run).reset).toBe("from another run of this chat");
    expect(decodeJournal(stored({ run: { worldId: "w_1", runSeed: "seed-a" } }), "c1", run).journal.seq).toBe(0);
    const legacy = decodeJournal(stored({}), "c1", run);
    expect(legacy.reset).toBeNull();
    expect(legacy.journal.run).toEqual(run);
    expect(legacy.journal.seq).toBe(3);
    expect(decodeJournal("{not json", "c1", run).reset).toBe("unreadable");
    expect(decodeJournal(stored({ chain: "x" }), "c1", run).reset).toBe("malformed");
    expect(decodeJournal(stored({}), "other-chat", run).reset).toBe("malformed");
  });

  test("a malformed stored journal or snapshot file never makes the chat unopenable", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    // The chat's stored files are corrupted; reopened (as after a restart), it opens and plays.
    await rig.host.storage.write(journalPath(chatId), "{\"v\":1,\"chatId\":", rig.host.userId);
    await rig.host.storage.write(snapshotsPath(chatId), "[{\"key\":", rig.host.userId);
    rig.rt.ledger.forget(chatId);
    await rig.turn(chatId, "I look around.", "Quiet.");
    expect(rig.rt.ledger.errors).toEqual([]);
    expect((await rig.rt.ledger.core(chatId, rig.host.userId))?.journal.run).toBeDefined();
    // The damaged journal was kept aside, not overwritten.
    const kept = (await rig.host.storage.list(journalPath(chatId), rig.host.userId)).filter((p) => p.startsWith(`${journalPath(chatId)}${CORRUPT_SUFFIX}`));
    expect(await Promise.all(kept.map((p) => rig.host.storage.read(p, rig.host.userId)))).toEqual(["{\"v\":1,\"chatId\":"]);
  });

  test("a damaged settings, learning, chips or plans file is set aside as .corrupt-<time> with a warning, and a fresh one is used", async () => {
    const host = new FakeHost();
    const user = host.userId;
    const chatId = "chat-1";
    const damaged: [string, string][] = [
      ["settings.json", "{\"v\":1,"],
      ["extraction-learning.json", "[1,2]"],
      [`${runDir(chatId)}chips.json`, "{not json"],
      [`${runDir(chatId)}plans.json`, "\"plans\""],
    ];
    for (const [path, text] of damaged) await host.storage.write(path, text, user);
    expect(await new SettingsStore(host).get(user)).toEqual(defaultSettings());
    expect((await new SettingsStore(host).learningOf(user)).connections).toEqual({});
    expect(await new ChipStore(host).list(chatId, user)).toEqual([]);
    expect(await new PlanNotes(host).get(chatId, user, "any-seed")).toBeNull();
    const logs = host.userLogs.get(user) ?? [];
    for (const [path, text] of damaged) {
      const kept = (await host.storage.list(path, user)).filter((p) => p.startsWith(`${path}${CORRUPT_SUFFIX}`));
      expect(kept.length, path).toBe(1);
      expect(await host.storage.read(kept[0] ?? "", user), path).toBe(text);
      expect(await host.storage.read(path, user), path).toBeNull();
      expect(logs.some((l) => l.startsWith("warn: [LumiRPEngine]") && l.includes(kept[0] ?? "")), path).toBe(true);
    }
  });

  test("another user's requests on a world chat get nothing, even after the owner warmed every cache", async () => {
    const rig = new Rig();
    rig.host.quietReply = () => JSON.stringify({ proposals: [{ type: "purchase", payer: "sam", item: "lamp", price: 99999 }] });
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I buy the lamp.", "She rings it up.");
    const owned = await rig.rt.view(chatId, rig.host.userId);
    expect(owned.chips.length).toBeGreaterThan(0);
    const intruder = "user-2";
    expect(await rig.rt.runOf(chatId, intruder)).toBeNull();
    expect(await rig.rt.ledger.core(chatId, intruder)).toBeNull();
    expect(await rig.rt.chips.list(chatId, intruder)).toEqual([]);
    await rig.dispatch.handle({ lre: PROTOCOL_VERSION, reqId: "x1", type: "lre.chip", chatId, chip: owned.chips[0]?.id ?? "", choice: "accept" } as unknown as FrontendToBackend, intruder);
    await rig.host.settle();
    const reply = rig.host.sent.find((m) => m.type === "lre.error" && m.reqId === "x1");
    expect(reply?.type).toBe("lre.error");
    // The owner's view is unchanged by the attempt.
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.map((c) => c.id)).toEqual(owned.chips.map((c) => c.id));
  });
});

describe("turn and chip robustness", () => {
  test("a generation that ends in error commits stopped: no extraction, a Retry read chip", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    rig.host.quietReply = () => JSON.stringify({ proposals: [{ type: "condition", entity: "sam", field: "cash", delta: 5 }] });
    rig.host.sendUser(chatId, "I look around.");
    await rig.host.settle();
    const before = rig.host.quietCalls.length;
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "Half a repl", { error: "provider timeout" });
    expect(rig.host.quietCalls.slice(before).some((r) => r.messages[0]?.content.includes("propose concrete state changes"))).toBe(false);
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.kind === "retry_read")).toBe(true);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a confirm chip whose Apply fails stays, and records no learning", async () => {
    const rig = new Rig();
    rig.host.quietReply = (req) => (req.messages[0]?.content.includes("propose concrete state changes") ? JSON.stringify({ proposals: [{ type: "purchase", payer: "sam", item: "lamp", price: 90 }] }) : "{}");
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I buy the lamp.", "She rings it up.");
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "confirm");
    expect(chip).toBeDefined();
    // The money goes before Apply: now it is declined.
    rig.body(await rig.send({ type: "lre.fix", chatId, entity: "sam", field: "cash", value: 1 }));
    expect((await rig.send({ type: "lre.chip", chatId, chip: chip?.id, choice: "confirm" })).type).toBe("lre.error");
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.id === chip?.id)).toBe(true);
    expect(JSON.stringify(await rig.rt.settings.learningOf(rig.host.userId))).not.toContain("accepted\":1");
  });
});

describe("re-attaching a world", () => {
  test("a chat that plays a world keeps its run: another world is refused, the same world changes nothing", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "Quiet.");
    const run = await rig.rt.runOf(chatId, rig.host.userId);
    const other = await rig.newWorld("Elsewhere");
    expect((await rig.send({ type: "lre.world", op: "attach", worldId: other, chatId })).type).toBe("lre.error");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId: run?.worldId ?? "", chatId }));
    expect(await rig.rt.runOf(chatId, rig.host.userId)).toEqual(run);
    expect((await rig.rt.ledger.core(chatId, rig.host.userId))?.journal.seq).toBeGreaterThan(0);
  });
});

describe("background jobs", () => {
  test("a lane that fails before reporting fails its job; only the owner can cancel; two jobs per user at most", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld("Jobs");
    const jobId = await rig.jobs.start("playtest", worldId, { turns: ["look around"] }, rig.host.userId);
    await rig.jobs.idle();
    const processId = [...rig.host.processMail.keys()].at(-1) ?? "";
    rig.host.lifecycle(processId, jobId, "failed", "lane crashed");
    const update = rig.host.sent.findLast((m) => m.type === "lre.job.update" && m.jobId === jobId);
    expect(update?.type === "lre.job.update" ? update.status : null).toBe("failed");
    const a = await rig.jobs.start("playtest", worldId, { turns: ["look around"] }, rig.host.userId);
    await rig.jobs.start("playtest", worldId, { turns: ["look around"] }, rig.host.userId);
    await rig.jobs.idle();
    expect(rig.jobs.start("playtest", worldId, { turns: ["look around"] }, rig.host.userId)).rejects.toThrow("at most 2 jobs");
    expect(rig.jobs.cancel(a, "user-2")).rejects.toThrow("no such job");
    await rig.jobs.cancel(a, rig.host.userId);
  });

  test("a job of a kind the runner doesn't have is refused, never run as Refine", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld("Jobs");
    rig.host.quietReply = () => JSON.stringify({ proposals: [] });
    expect(await rig.send({ type: "lre.job", op: "start", kind: "wipe_world", worldId, input: { instructions: "Add a diner." } })).toMatchObject({ type: "lre.error", code: "bad_request" });
    expect(await rig.send({ type: "lre.job", op: "start", kind: "refine", worldId, input: "Add a diner." })).toMatchObject({ type: "lre.error", code: "bad_request" });
    await rig.host.settle();
    expect(rig.host.quietCalls).toEqual([]);
    expect(await rig.jobs.list(worldId, rig.host.userId)).toEqual([]);
  });

  test("a job keeps only the input its kind reads, cut to what it can use; an id too long to be one is refused", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld("Jobs");
    const long = "x".repeat(5000);
    await rig.jobs.start("playtest", worldId, { turns: Array.from({ length: 60 }, () => long), notes: long }, rig.host.userId);
    await rig.jobs.idle();
    const [playtest] = await rig.jobs.list(worldId, rig.host.userId);
    expect(playtest?.input).toEqual({ turns: Array.from({ length: 50 }, () => "x".repeat(2000)) });
    await expect(rig.jobs.start("describe_map", worldId, { scope: "home", prose: "A room.", mapId: "m".repeat(201) }, rig.host.userId)).rejects.toThrow("at most 200 characters");
    await expect(rig.jobs.start("import_lore", worldId, { bookIds: Array.from({ length: 65 }, (_, i) => `book${i}`) }, rig.host.userId)).rejects.toThrow("at most 64");
    // Pasted text past what an index job reads isn't kept, and the job still says the rest wasn't read.
    const indexing = new Rig();
    const indexed = await indexing.newWorld("Jobs");
    indexing.host.quietReply = () => JSON.stringify({ entries: [] });
    indexing.body(await indexing.send({ type: "lre.job", op: "start", kind: "index_text", worldId: indexed, input: { text: "Harbor history, told again. ".repeat(200_000), extra: long } }));
    await indexing.host.settle();
    expect(((await indexing.host.storage.read(JOBS_PATH, indexing.host.userId)) ?? "").length).toBeLessThan(100_000);
    const [job] = await indexing.jobs.list(indexed, indexing.host.userId);
    expect(Object.keys(job?.input ?? {})).toEqual(["text"]);
    expect(job?.message).toContain("Only the first 12 parts of the text");
  });
});

describe("Re-narrate after a restart", () => {
  test("the Outcome comes back from storage when the turn bridge no longer holds the plan", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld("Coins");
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "checks", id: "coin_flip", value: { id: "coin_flip", dice: "1d2", bands: [{ outcome: "fail", max: 1 }, { outcome: "success", min: 2 }] } }));
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "actions", id: "flip_coin", value: { id: "flip_coin", label: "Flip a coin", params: {}, requires: [], check: "coin_flip", outcomes: { success: [], fail: [] }, duration: "1", lexicon: ["flip a coin"] } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    rig.body(await rig.send({ type: "lre.action", chatId, action: "flip_coin", params: {}, source: "palette" }));
    const g = await rig.host.start(chatId, { type: "normal" });
    const first = rig.host.lastInterceptor?.mutated.find((m) => m.content?.startsWith("[Outcome]"))?.content ?? "";
    expect(first).toMatch(/Flip a coin: (success|fail)/);
    await rig.host.finish(g, "The coin spins.");
    // As after a restart: the bridge and its plans are gone.
    rig.rt.forgetChat(chatId);
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "swipe_option");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip?.id, choice: "renarrate" }));
    const g2 = await rig.host.start(chatId, { type: "swipe" });
    expect(rig.host.lastInterceptor?.mutated.find((m) => m.content?.startsWith("[Outcome]"))?.content).toBe(first);
    await rig.host.finish(g2, "The coin spins again, the same way.");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("storage paths", () => {
  test("a '..' chat or world id is refused before it names a storage path", async () => {
    const rig = new Rig();
    await rig.worldChat();
    const before = [...rig.host.files.keys()].sort();
    for (const request of [
      { type: "lre.world", op: "remove", worldId: ".." },
      { type: "lre.world", op: "get", worldId: "../worlds" },
      { type: "lre.view.open", chatId: "../../x", panel: "gear.gear" },
      { type: "lre.editor", op: "discard", worldId: "a/b", base: null },
    ]) {
      const reply = await rig.send(request);
      expect(reply.type === "lre.error" ? reply.code : reply.type).toBe("bad_request");
    }
    expect([...rig.host.files.keys()].sort()).toEqual(before);
    expect(() => runDir("..")).toThrow("invalid chat id");
  });
});

describe("helper fallback answers", () => {
  test("a yes/no reply without p is no answer, not a 0.5 coin flip", async () => {
    const host = new FakeHost();
    host.quietReply = () => JSON.stringify({ c0: {}, c1: { p: 0.9 } });
    const steps = new Steps(host, new CallMeter());
    const answer = await steps.decide("npc.choose", {}, { c0: { type: "noul", instructions: "x" }, c1: { type: "noul", instructions: "y" } }, null, host.userId, new AbortController().signal);
    expect(answer?.answers.c0).toBeUndefined();
    expect(answer?.answers.c1).toEqual({ type: "noul", noul: 0.9 });
  });
});

describe("engine book slots", () => {
  test("a slot entry deleted in the host's UI is recreated, and its section comes back next turn", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const run = await rig.rt.runOf(chatId, rig.host.userId);
    const bookId = (await rig.rt.worlds.index(run?.worldId ?? "", rig.host.userId))?.loreBookId ?? "";
    const scene = (await rig.rt.book.slotEntries(bookId, rig.host.userId)).get("scene") ?? "";
    await rig.host.books.deleteEntry(scene, rig.host.userId);
    await rig.turn(chatId, "I look around.", "Quiet.");
    expect(rig.rt.inspectorRecords(chatId)?.at(-1)?.warnings?.some((w) => w.includes("recreated"))).toBe(true);
    await rig.host.settle();
    rig.host.sendUser(chatId, "And again.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    expect(rig.host.lastInterceptor?.mutated.some((m) => m.content?.startsWith("[Scene]"))).toBe(true);
    await rig.host.finish(g, "Still quiet.");
  });
});

describe("per-user meter and diagnostics", () => {
  test("one user's calls never count in another's meter; turn diagnostics carry their user", async () => {
    const meter = new CallMeter();
    meter.record({ purpose: "extract", via: "helper", ok: true, ms: 5, tokens: 40 }, "user-1");
    meter.close("user-1");
    expect(meter.view("user-2").turn).toEqual({ calls: 0, tokens: 0, ms: 0, lookups: 0 });
    expect(meter.view("user-1").turn).toEqual({ calls: 1, tokens: 40, ms: 5, lookups: 0 });
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "Quiet.");
    expect((rig.host.userLogs.get(rig.host.userId) ?? []).some((l) => l.includes("[LumiRPEngine] turn "))).toBe(true);
  });
});

// The ledger reader (src/migrate/today/ledger-io.ts), which reads the previous build's records on the owner's own server: a stored
// ledger keeps only valid markers and swipe-index keys, a marker that passes the check is kept as written, what it decodes is frozen,
// and a journal of another run is reset, a legacy one stamped and garbage unreadable. Also the marker check itself: unknown domains,
// tiers, entities and kinds are refused and time controls clamped; and the worker's Object.prototype stays clean.

import { afterEach, describe, expect, test } from "bun:test";
import { decodeJournal, decodeLedger, encodeLedger } from "../../src/migrate/today/ledger-io";
import { TIME_BOUNDS, validMarkerBody } from "../../src/engine/events";
import { markersHash } from "../../src/engine/ledger/path";
import type { JsonObject } from "../../src/shared/json";
import { hasOwn } from "../../src/shared/json";
import { LEDGER_NAMESPACE, type MessageLedger } from "../../src/shared/ledger";

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

describe("the stored ledger reader", () => {
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
    // A retired control earlier builds wrote into every chat's starting markers stays readable, clamped as it was then.
    expect(validMarkerBody({ kind: "time", control: "npc_calls", scope: { all: true }, to: 999 })).toEqual({ kind: "time", control: "npc_calls", scope: { all: true }, to: 50 });
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

  test("a stored marker that passes the check is kept as written, so a copy of its chat chains the same hash", () => {
    // An earlier build journaled the starters' half-minute action tick unclamped, and its chain hashed it so.
    const ledger: MessageLedger = { v: 1, swipes: {}, markers: [{ kind: "time", control: "tick", scope: { sceneType: "action" }, to: 0.5, seq: 1, at: null, start: true }] };
    const read = decodeLedger(encodeLedger({}, ledger));
    expect(read).toEqual(ledger);
    expect(markersHash(read?.markers ?? [])).toBe(markersHash(ledger.markers));
  });

  test("a decoded ledger is frozen, and what it was decoded from (a journal's own ledger, as a flush decodes it) stays the reader's own", () => {
    const scope = { sceneType: "action" };
    const own: MessageLedger = { v: 1, swipes: {}, markers: [{ kind: "time", control: "tick", scope, to: 0.5, seq: 1, at: null, start: true }] };
    const read = decodeLedger({ [LEDGER_NAMESPACE]: own as unknown as JsonObject });
    const marker = read?.markers[0];
    expect(marker?.kind === "time" && Object.isFrozen(marker) && Object.isFrozen(marker.scope)).toBe(true);
    expect(Object.isFrozen(scope)).toBe(false);
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
});

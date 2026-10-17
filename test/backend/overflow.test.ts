// L33 overflow (DESIGN §4.3): a message ledger past 32 KB goes into continuation chunks in the same
// metadata namespace, every value under the cap, and round-trips without truncation; shrinking it
// removes the stale chunks; other writers' keys survive; a missing chunk reads as no ledger.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import type { MessageLedger } from "../../src/shared/ledger";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import { decodeLedger, encodeLedger, METADATA_CAP_BYTES } from "../../src/backend/ledger-io";

function ledger(events: number): MessageLedger {
  return {
    v: 1,
    markers: [],
    swipes: {
      "0": {
        v: 1,
        defHash: "rev",
        seq: 1,
        swipeHash: { len: 3, hash: "abc" },
        path: "p",
        seed: "s",
        pre: events,
        events: Array.from({ length: events }, (_, i) => ({ type: "set", entity: "you", field: "note", value: `naïve café ${i} ${"x".repeat(80)}` })),
        post: [],
        markersApplied: 0,
        status: "ok",
        undone: [],
        intents: {},
      },
    },
  };
}

const bytes = (v: unknown): number => new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v)).length;

describe("metadata overflow", () => {
  test("a large ledger chunks under the cap and round-trips exactly", () => {
    const big = ledger(1200);
    expect(bytes(big)).toBeGreaterThan(METADATA_CAP_BYTES * 3);
    const bag = encodeLedger({ other_extension: { keep: true } }, big);
    const chunks = Object.keys(bag).filter((k) => k.startsWith(`${LEDGER_NAMESPACE}:`));
    expect(chunks.length).toBeGreaterThan(3);
    for (const k of Object.keys(bag)) expect(bytes(bag[k])).toBeLessThanOrEqual(METADATA_CAP_BYTES);
    expect(decodeLedger(bag)).toEqual(big);
    expect(bag.other_extension).toEqual({ keep: true });
    // Shrinking writes it inline again and drops the stale chunks.
    const small = encodeLedger(bag, ledger(2));
    expect(Object.keys(small).filter((k) => k.startsWith(`${LEDGER_NAMESPACE}:`))).toEqual([]);
    expect(decodeLedger(small)).toEqual(ledger(2));
  });

  test("a missing or altered chunk reads as no ledger (the journal re-asserts it)", () => {
    const bag = encodeLedger({}, ledger(1200));
    const missing: JsonObject = { ...bag };
    delete missing[`${LEDGER_NAMESPACE}:1`];
    expect(decodeLedger(missing)).toBeNull();
    expect(decodeLedger({ ...bag, [`${LEDGER_NAMESPACE}:0`]: "{" })).toBeNull();
  });
});

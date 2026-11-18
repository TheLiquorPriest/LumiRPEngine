// A claims or check-rules marker with no value puts the chat back to following its world, so the Undo of a first change can take it back.

import { describe, expect, test } from "bun:test";
import { applyMarker, validMarkerBody } from "../../src/engine/events";
import type { WorldState } from "../../src/engine/state";
import { presetAdjudication } from "../../src/shared/adjudication";

describe("a marker with no value", () => {
  test("reads as one, and takes the chat's own claims and check rules away", () => {
    expect(validMarkerBody({ kind: "claims", to: null })).toEqual({ kind: "claims", to: null });
    expect(validMarkerBody({ kind: "adjudicate", to: null })).toEqual({ kind: "adjudicate", to: null });
    expect(validMarkerBody({ kind: "claims", to: "hold" })).toBeNull();
    const state = { claims: { mode: "hold", capped: false }, adjudication: presetAdjudication("balanced") } as unknown as WorldState;
    applyMarker(state, { kind: "claims", to: null });
    applyMarker(state, { kind: "adjudicate", to: null });
    expect(state.claims).toBeUndefined();
    expect(state.adjudication).toBeUndefined();
  });
});

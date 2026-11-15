// Each arm's provider is named, and both must match (PlanGates-4-fix2 item 8): RPE's arm's provider is
// read from RPE's own connections, by the connection the Author's first call used. A verdict is refused
// unless both arms ran on one provider and one model; where either provider cannot be read the timing
// rows are not judged and the reason says which. The two-step form's reported time per token is held
// to the same.

import { describe, expect, test } from "bun:test";
import { providerOf, type RpeConnections } from "../../../scripts/proof/floor/play";
import { armsRefusal, floorHead, measuredRows, type FloorRun } from "../../../scripts/testbed/floor-measure";
import { recordedRun } from "./recorded";
import { partOf, playReplay } from "./replay";

const KNOWN: RpeConnections = {
  list: [
    { id: "id-rpe-floor", name: "rpe-floor", provider: "deepseek" },
    { id: "id-twin-a", name: "twin", provider: "deepseek" },
    { id: "id-twin-b", name: "twin", provider: "openrouter" },
  ],
  why: null,
};

describe("RPE's arm's provider, from RPE's own connections", () => {
  test("by the name the Author's first call gives its connection, else by its id", () => {
    expect(providerOf("rpe-floor", KNOWN)).toEqual({ provider: "deepseek", why: null });
    expect(providerOf("id-rpe-floor", KNOWN)).toEqual({ provider: "deepseek", why: null });
  });

  test("a connection RPE does not hold, two of one name, no named connection, and connections that could not be read each say why, never a provider", () => {
    expect(providerOf("gone", KNOWN)).toEqual({ provider: null, why: "RPE's connections hold none named gone" });
    expect(providerOf("twin", KNOWN)).toEqual({ provider: null, why: "RPE's connections hold 2 named twin" });
    expect(providerOf(null, KNOWN)).toEqual({ provider: null, why: "no call of the Author names the connection it went to" });
    expect(providerOf("rpe-floor", { list: null, why: "RPE's connections could not be read: 500" })).toEqual({ provider: null, why: "RPE's connections could not be read: 500" });
  });
});

describe("both arms on one provider and one model", () => {
  test("plain generation on another provider with the same model id gives no verdict on the rows that compare the arms, naming both providers", () => {
    const run = recordedRun({ form: "tag", plainProvider: "openrouter" });
    const rows = measuredRows(run);
    for (const id of ["first-words", "per-token"] as const) {
      expect(rows[id].verdict).toBe("not judged");
      expect(rows[id].why).toContain("plain generation ran on openrouter and the Author on deepseek: not the same provider");
    }
    expect(armsRefusal(run)).toBe("plain generation ran on openrouter and the Author on deepseek: not the same provider");
  });

  test("the same provider spelled in another case, or with _ for -, is one provider", () => {
    expect(armsRefusal(recordedRun({ form: "tag", plainProvider: "Open_Router", rpeProvider: "open-router" }))).toBeNull();
    expect(measuredRows(recordedRun({ form: "tag", plainProvider: "Deepseek" }))["first-words"].verdict).toBe("pass");
  });

  test("a provider that cannot be read leaves the timing rows not judged, and the reason says which arm", () => {
    const rpe = recordedRun({ form: "tag", rpeProvider: null });
    rpe.arms.rpe.providerWhy = "RPE's connections hold none named rpe-floor";
    expect(measuredRows(rpe)["first-words"].why).toContain("RPE's provider could not be read (RPE's connections hold none named rpe-floor)");
    const plain = recordedRun({ form: "tag", plainProvider: null });
    plain.arms.plain.providerWhy = "Lumiverse's connection names no provider";
    expect(measuredRows(plain)["per-token"].why).toContain("plain generation's provider could not be read (Lumiverse's connection names no provider)");
    const neither = recordedRun({ form: "tag", plainProvider: null, rpeProvider: null });
    expect(armsRefusal(neither)).toBe("plain generation's provider could not be read; RPE's provider could not be read");
  });

  test("the two-step form's reported time per token is held to the same: plain on another model, or another provider, is not reported", () => {
    const model = recordedRun({ form: "two-step", plain: { model: "another-model" } });
    expect(measuredRows(model)["per-token"].verdict).toBe("not judged");
    expect(measuredRows(model)["per-token"].why).toContain("plain generation ran on another-model and the Author on deepseek-v4-flash: not the same model");
    const provider = measuredRows(recordedRun({ form: "two-step", plainProvider: "openrouter" }))["per-token"];
    expect(provider.verdict).toBe("not judged");
    expect(provider.why).toContain("plain generation ran on openrouter and the Author on deepseek: not the same provider");
    // On one model and one provider it is reported, as before.
    expect(measuredRows(recordedRun({ form: "two-step" }))["per-token"].verdict).toBe("reported");
  });

  test("the two-step row with plain on another model is not sent to the runner as met", async () => {
    // Plain's model as Lumiverse's connection holds it: the replay reads it from the run's own arm.
    const run = recordedRun({ form: "two-step" });
    run.arms.plain.model = "another-model";
    const played = await playReplay({ run });
    expect(partOf(played, "per-token")).toEqual([{ outcome: "not judged", why: expect.stringContaining("not the same model") }]);
    expect(partOf(played, "first-words")[0]?.outcome).toBe("not judged");
  });
});

describe("through the play", () => {
  test("RPE's provider is read from RPE's own connections, and a provider that is not plain's gives no verdict, the table naming each arm's", async () => {
    const run: FloorRun = recordedRun({ form: "tag" });
    const played = await playReplay({ run, ground: { rpeConnections: { list: [{ id: "id-rpe-floor", name: "rpe-floor", provider: "openrouter" }], why: null } } });
    expect(played.table).toContain("RPE openrouter / deepseek-v4-flash (connection rpe-floor)");
    expect(played.table).toContain("plain deepseek / deepseek-v4-flash");
    expect(partOf(played, "first-words")[0]?.outcome).toBe("not judged");
    expect(partOf(played, "first-words")[0]?.why).toContain("plain generation ran on deepseek and the Author on openrouter: not the same provider");
    // A clean read is judged, the same run on its own provider.
    const clean = await playReplay({ run: recordedRun({ form: "tag" }) });
    expect(clean.table).toContain("RPE deepseek / deepseek-v4-flash (connection rpe-floor)");
    expect(partOf(clean, "first-words")[0]?.outcome).toBe("met");
  });

  test("connections RPE would not list leave the provider unnamed in the table, and the rows not judged, with why", async () => {
    const played = await playReplay({ run: recordedRun({ form: "tag" }), ground: { rpeConnections: { list: null, why: "RPE's connections could not be read: 500" } } });
    expect(played.table).toContain("RPE provider not known (RPE's connections could not be read: 500) / deepseek-v4-flash");
    expect(partOf(played, "per-token")[0]?.why).toContain("RPE's provider could not be read (RPE's connections could not be read: 500)");
    expect(floorHead(recordedRun({ form: "tag", rpeProvider: null })).join("\n")).toContain("RPE provider not known / deepseek-v4-flash");
  });
});

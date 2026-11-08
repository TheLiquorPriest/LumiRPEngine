// Settings → Depth sampling (owner D-3): Strong, Fast and a role's own model each take a temperature
// and top P; one left empty is the helper model's. The port sends what `depthCall` gives.

import { describe, expect, test } from "bun:test";
import { depthPort } from "../../src/backend/depth-model-host";
import type { QuietResult } from "../../src/backend/host";
import { defaultSettings } from "../../src/backend/settings-store";
import { defaultDepthSettings, depthCall, depthSettingsOf } from "../../src/shared/depth-settings";
import type { SamplingParams, UserSettings } from "../../src/shared/settings";

const HELPER_PARAMS: SamplingParams = { temperature: 0.7, top_p: 0.9, top_k: 40 };

function settingsWith(depth: unknown): UserSettings {
  const s = defaultSettings();
  return { ...s, helper: { ...s.helper, params: { ...HELPER_PARAMS } }, depth: depthSettingsOf(depth) };
}

async function sentParams(s: UserSettings, role: "gm" | "check"): Promise<SamplingParams | undefined> {
  let params: SamplingParams | undefined;
  const host = {
    models: {
      quiet: async (req: { params?: SamplingParams }): Promise<QuietResult> => {
        params = req.params;
        return { content: "{}", finishReason: "stop", tokens: 2, tokensIn: 1, tokensOut: 1, model: "m" };
      },
    },
    log: () => undefined,
  };
  await depthPort(host as never, async () => s, "u1", { day: null })(role, [{ role: "user", content: "hi" }]);
  return params;
}

describe("a depth model's temperature and top P", () => {
  test("a role's own temperature and top P go over the helper model's; its other parameters stay", async () => {
    const s = settingsWith({ roles: { gm: { uses: "own", own: { temperature: 0.2, topP: 0.5 } } } });
    expect(await sentParams(s, "gm")).toEqual({ temperature: 0.2, top_p: 0.5, top_k: 40 });
  });

  test("empty takes the helper model's", async () => {
    const s = settingsWith({ roles: { gm: { uses: "own", own: { temperature: 1.1 } } } });
    expect(await sentParams(s, "gm")).toEqual({ temperature: 1.1, top_p: 0.9, top_k: 40 });
    expect(await sentParams(settingsWith({}), "gm")).toEqual(HELPER_PARAMS);
  });

  test("Strong's and Fast's are read for the roles on them", () => {
    const s = settingsWith({ strong: { temperature: 0.3 }, fast: { topP: 0.4 } });
    expect(depthCall(s, "gm").params).toEqual({ temperature: 0.3, top_p: 0.9, top_k: 40 });
    expect(depthCall(s, "check").params).toEqual({ temperature: 0.7, top_p: 0.4, top_k: 40 });
  });

  test("the normalizer keeps a value in range, clears one set to null, and drops one out of range", () => {
    const base = depthSettingsOf({ fast: { temperature: 0.6, topP: 0.8 } });
    expect(base.fast.temperature).toBe(0.6);
    expect(base.fast.topP).toBe(0.8);
    const kept = depthSettingsOf({ fast: { effort: "high" } }, base);
    expect([kept.fast.temperature, kept.fast.topP]).toEqual([0.6, 0.8]);
    const cleared = depthSettingsOf({ fast: { temperature: null, topP: null } }, base);
    expect([cleared.fast.temperature, cleared.fast.topP]).toEqual([null, null]);
    const wrong = depthSettingsOf({ fast: { temperature: 3, topP: -1 } });
    expect([wrong.fast.temperature, wrong.fast.topP]).toEqual([null, null]);
    const shipped = defaultDepthSettings();
    expect([shipped.strong.temperature, shipped.fast.topP, shipped.roles.gm.own.temperature]).toEqual([null, null, null]);
  });
});

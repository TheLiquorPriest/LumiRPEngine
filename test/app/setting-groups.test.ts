// Where the Settings page shows a setting: every setting of how a failed model call is made again is
// in one group of its own, right after the other model-call settings, and the rest of `calls.` stays
// with them.

import { expect, test } from "bun:test";
import { SETTINGS as RPH_SETTINGS } from "rp-harness/helpers";
import { groupOf } from "../../src/app/setting-list";

const RETRY = ["calls.retries", "calls.retryWaitSeconds", "calls.retryWaitGrowth", "calls.maxRetryWaitSeconds", "calls.retryWaitAsAsked", "calls.retryOn.connection", "calls.retryOn.timeout", "calls.retryOn.overloaded", "calls.retryOn.server", "calls.retryOn.other"];

test("how a failed call is made again is one group of its own, beside the other model-call settings", () => {
  const listed = RPH_SETTINGS.filter((def) => def.key.startsWith("calls."));
  expect(RETRY.every((key) => listed.some((def) => def.key === key))).toBe(true);
  for (const def of listed) {
    const { section, group } = groupOf(def);
    expect({ key: def.key, section, group }).toEqual({ key: def.key, section: "Connections and model calls", group: RETRY.includes(def.key) ? "When a call to the model fails" : "Model calls" });
  }
  const calls = groupOf({ key: "calls.silentAfterSeconds", perConnection: false });
  const retry = groupOf({ key: "calls.retries", perConnection: false });
  const throttles = groupOf({ key: "throttles.atOnce", perConnection: false });
  expect(calls.order < retry.order && retry.order < throttles.order).toBe(true);
});

// Where the Settings page shows a setting: what counts as a dead model call, and how a failed call is
// made again, are one group of their own, right after the other model-call settings, read top to
// bottom in that order; the rest of `calls.` stays with them.

import { expect, test } from "bun:test";
import { SETTINGS as RPH_SETTINGS } from "rp-harness/helpers";
import { groupOf } from "../../src/app/setting-list";

const RETRY = ["calls.silentAfterSeconds", "calls.unansweredAfterSeconds", "calls.retries", "calls.retryWaitSeconds", "calls.retryWaitGrowth", "calls.maxRetryWaitSeconds", "calls.retryWaitAsAsked", "calls.retryOn.connection", "calls.retryOn.timeout", "calls.retryOn.overloaded", "calls.retryOn.server", "calls.retryOn.other"];

test("how a failed call is made again is one group of its own, beside the other model-call settings", () => {
  const listed = RPH_SETTINGS.filter((def) => def.key.startsWith("calls."));
  // In the page's order, the registry's: the dead call first, then how it is made again.
  expect(listed.filter((def) => groupOf(def).group === "When a call to the model fails").map((def) => def.key)).toEqual(RETRY);
  for (const def of listed) {
    const { section, group } = groupOf(def);
    expect({ key: def.key, section, group }).toEqual({ key: def.key, section: "Connections and model calls", group: RETRY.includes(def.key) ? "When a call to the model fails" : "Model calls" });
  }
  const other = listed.find((def) => !RETRY.includes(def.key));
  if (other === undefined) throw new Error("no other model-call setting");
  const calls = groupOf(other);
  const retry = groupOf({ key: "calls.retries", perConnection: false });
  const throttles = groupOf({ key: "throttles.atOnce", perConnection: false });
  expect(calls.order < retry.order && retry.order < throttles.order).toBe(true);
});

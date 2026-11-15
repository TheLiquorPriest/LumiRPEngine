// What a run's record names of where it was, who it acted as, what its scripts refused to touch and how the pin was
// held (PlanScenarios-3 item 7; READINGS R-19, R-196): a live run whose facts lack any of them is refused before it
// starts, with the host closed and the lock given back; a rig run needs only the pin; a manifest that names seven
// characters of the commit, or a link, is recorded as not pinned.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { BundleRefused, readBundle } from "../../../scripts/proof/route/evidence";
import type { LiveGuard, RunFacts } from "../../../scripts/proof/route/host";
import { heldOf, isPinned, pinSettingsFromEnv, readBundles, type PinHow } from "../../../scripts/proof/route/pin";
import { main } from "../../../scripts/proof/run";
import { FAKE_RPH, fakeFacts, fakeHeld, fakeHost } from "./fake";

const FORM = resolve(import.meta.dir, "../../../scripts/proof/route/form.ts");
const made: string[] = [];
let root = "";

/** A gate with one measured part, passed: nothing here is about what is seen. */
const GATE = `import { gate } from ${JSON.stringify(FORM)};
const form = async (play: { judge(part: string, verdict: { pass: boolean; what: string }): Promise<void> }) => { await play.judge("time", { pass: true, what: "12.4 s, within 20 s" }); };
export default gate({ id: "gate-timing", waves: [1], parts: [{ id: "time", words: "the first reply within 20 s", mark: "code", measured: "the first reply's time" }], fixtures: [], bed: [], rig: form, live: form });
`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "proof-provenance-root-"));
  made.push(root);
  writeFileSync(join(root, "settings.json"), JSON.stringify({ repeats: 10 }));
  mkdirSync(join(root, "scenarios"));
  mkdirSync(join(root, "timing"));
  writeFileSync(join(root, "timing", "gate.ts"), GATE);
});

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** The facts of a live run that names everything the record asks of one. */
function liveFacts(): RunFacts {
  return { ...fakeFacts(), instance: { address: "http://lumiverse.test:7860", name: "bed-instance" }, user: "user-marlow", neverTouch: ["chat-bed-", "7744"] };
}

/** A guard that counts what it was asked: the lock taken and given back, the commits admitted. */
function countingGuard(): LiveGuard & { taken: number; released: number } {
  const guard = {
    taken: 0,
    released: 0,
    async lock() {
      guard.taken++;
      return {
        held: false as const,
        async release() {
          guard.released++;
        },
      };
    },
    async admit() {
      return { ok: true as const };
    },
  };
  return guard;
}

async function play(mode: "rig" | "live", facts: RunFacts): Promise<{ code: number; printed: string; dir: string; host: { closed: number }; guard: { taken: number; released: number }; where: string }> {
  const where = mkdtempSync(join(tmpdir(), "proof-provenance-out-"));
  made.push(where);
  const printed: string[] = [];
  const host = fakeHost(mode, { pages: {} }, facts);
  const guard = countingGuard();
  const code = await main([mode, "gate-timing", "--root", root, "--out", where, "--by", "a test"], { out: (text) => printed.push(text), openHost: async () => host, guard });
  const [name] = readdirSync(where).filter((n) => existsSync(join(where, n, "run.json")));
  return { code, printed: printed.join(""), dir: name === undefined ? "" : join(where, name), host, guard, where };
}

test("a live run that names its instance, its user, the never-touch list and how the pin was held keeps all of them in run.json", async () => {
  const run = await play("live", liveFacts());
  expect(run.code).toBe(0);
  const record = JSON.parse(readFileSync(join(run.dir, "run.json"), "utf8")) as { instance: unknown; user: unknown; neverTouch: unknown; rph: { pinned: boolean; held: unknown } };
  expect(record.instance).toEqual({ address: "http://lumiverse.test:7860", name: "bed-instance" });
  expect(record.user).toBe("user-marlow");
  expect(record.neverTouch).toEqual(["chat-bed-", "7744"]);
  expect(record.rph.pinned).toBe(true);
  expect(record.rph.held).toEqual(fakeHeld());
  // Read back, the same facts are there; a run.json that lost one is refused naming it.
  expect(readBundle(run.dir).run.user).toBe("user-marlow");
  const file = join(run.dir, "run.json");
  const without = { ...(record as object), user: undefined };
  writeFileSync(file, JSON.stringify(without));
  expect(() => readBundle(run.dir)).toThrow(BundleRefused);
  expect(() => readBundle(run.dir)).toThrow("the user the run acted as");
});

test("a live run whose facts lack any of them is refused before it starts, the host closed, the lock given back, and no bundle left", async () => {
  const lacking: [string, RunFacts, string][] = [
    ["its instance", { ...liveFacts(), instance: undefined }, "the instance the run was on"],
    ["its user", { ...liveFacts(), user: undefined }, "the user the run acted as"],
    ["its never-touch list", { ...liveFacts(), neverTouch: [] }, "the never-touch list in force"],
    ["how the pin was held", { ...liveFacts(), rph: { commit: FAKE_RPH, pin: FAKE_RPH } as unknown as RunFacts["rph"] }, "how the pin was held"],
    ["the bundles the bed's mirrors were fed from", { ...liveFacts(), rph: { commit: FAKE_RPH, pin: FAKE_RPH, held: { ...fakeHeld(), from: "bed-mirror" } } }, "the commit ids of the bundles the bed's mirrors were fed from"],
  ];
  for (const [what, facts, words] of lacking) {
    const run = await play("live", facts);
    expect(run.code, what).toBe(1);
    expect(run.printed, what).toContain(words);
    expect(run.printed, what).toContain("so the run would prove nothing");
    expect(run.host.closed, what).toBe(1);
    expect(run.guard.taken, what).toBe(1);
    expect(run.guard.released, what).toBe(1);
    expect(readdirSync(run.where), what).toEqual([]);
  }
});

test("a rig run needs only the pin: no instance, user or list, and a refusal where the pin was not recorded", async () => {
  const run = await play("rig", fakeFacts());
  expect(run.code).toBe(0);
  const record = JSON.parse(readFileSync(join(run.dir, "run.json"), "utf8")) as { instance?: unknown; user?: unknown; neverTouch?: unknown; rph: { held: unknown } };
  expect(record.instance).toBeUndefined();
  expect(record.user).toBeUndefined();
  expect(record.neverTouch).toBeUndefined();
  expect(record.rph.held).toEqual(fakeHeld());
  const unpinned = await play("rig", { ...fakeFacts(), rph: { commit: FAKE_RPH, pin: FAKE_RPH } as unknown as RunFacts["rph"] });
  expect(unpinned.code).toBe(1);
  expect(unpinned.printed).toContain("how the pin was held");
  expect(unpinned.host.closed).toBe(1);
});

test("a manifest that names seven characters of the commit, or a link, or none, is recorded as not pinned; the whole commit at the stage's name is pinned", () => {
  const how: PinHow = { from: "rph-repository", stage: "before-publishing", bundlesFile: null };
  const named = (name: string | null) => heldOf(name === null ? {} : { dependencies: { "rp-harness": name } }, how);
  const pinnedBy = (name: string | null, pin: string | null): boolean => isPinned({ commit: FAKE_RPH, pin, held: named(name) });
  expect(pinnedBy(`git+https://rph.invalid/RPHarness.git#${FAKE_RPH}`, FAKE_RPH)).toBe(true);
  expect(pinnedBy(`git+https://rph.invalid/RPHarness.git#${FAKE_RPH.slice(0, 7)}`, FAKE_RPH.slice(0, 7))).toBe(false);
  expect(pinnedBy("link:../RPHarness-pin", null)).toBe(false);
  expect(pinnedBy(null, null)).toBe(false);
  // A name that is not the stage's own is not the pin the plan holds: GitHub's name before publishing.
  expect(pinnedBy(`github:TheLiquorPriest/RPHarness#${FAKE_RPH}`, FAKE_RPH)).toBe(false);
  expect(named(`git+https://rph.invalid/RPHarness.git#${FAKE_RPH}`)).toEqual(fakeHeld());
});

test("where the pin comes from, and the stage, are the lead's to say: the environment names them, with no default", async () => {
  expect(() => pinSettingsFromEnv({})).toThrow("RPE_PROOF_PIN_STAGE");
  expect(() => pinSettingsFromEnv({ RPE_PROOF_PIN_STAGE: "soon" })).toThrow("RPE_PROOF_PIN_STAGE");
  expect(pinSettingsFromEnv({ RPE_PROOF_PIN_STAGE: "after-publishing", RPE_PROOF_PIN_FROM: "github" })).toEqual({ stage: "after-publishing", from: "github", bundlesFile: null });
  expect(() => pinSettingsFromEnv({ RPE_PROOF_PIN_STAGE: "before-publishing", RPE_PROOF_PIN_FROM: "pigeon" })).toThrow("RPE_PROOF_PIN_FROM");
  // The bundles' ids come from what the feed left: two lines, or JSON, forty hex digits each.
  const file = join(dirname(root), `provenance-bundles-${Math.random().toString(36).slice(2, 8)}.txt`);
  made.push(file);
  writeFileSync(file, `rpe ${"a".repeat(40)}\nrph ${"b".repeat(40)}\n`);
  expect(readBundles(file)).toEqual({ rpe: "a".repeat(40), rph: "b".repeat(40) });
  writeFileSync(file, `rpe ${"a".repeat(8)}\nrph ${"b".repeat(40)}\n`);
  expect(() => readBundles(file)).toThrow("forty hex digits each");
});

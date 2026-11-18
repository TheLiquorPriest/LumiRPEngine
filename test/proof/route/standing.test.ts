// A run's standing (PlanScenarios-8 item 4, and the lead's rulings after the two checks of the runner;
// plan §17: a verdict comes only from shipped guidance on a clean build). It is worked out per play: the
// runner asks the host what the play's own chat stands on when its footing is ready and again when its
// form has ended, and a difference the form did not declare makes the play a trial. A run whose served
// tree is not the build's or is empty, with guidance in any layer, with a name its configs switch off,
// layer or add, or whose host does not say, is a trial: what rests on guidance is printed as trial with
// its figure in the report, the results file and the exit, never met or unmet; and a run that is a
// trial exits 3 whatever its forms hold. In the rig an "as shipped" part is its code path, judged as
// code whatever the standing. Read back alone, the bundle gives the same standing, whatever run.json
// claims, RPH's pin among it.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { sha256, shippedOf } from "../../../scripts/proof/lib/record";
import { readBundle } from "../../../scripts/proof/route/evidence";
import type { LiveGuard, RunFacts } from "../../../scripts/proof/route/host";
import { main, type Deps } from "../../../scripts/proof/run";
import { FAKE_BUILD, FAKE_RPH, fakeFacts, fakeGuidance, fakeHeld, fakeHost, type SessionGuidance } from "./fake";

const FORM = resolve(import.meta.dir, "../../../scripts/proof/route/form.ts");
const made: string[] = [];
let root = "";
let out = "";

/** A gate whose form judges one measured part, met or not as `pass` says, with its figure. */
function gateFile(pass: boolean): string {
  const judge = `async (play: { judge(part: string, verdict: { pass: boolean; what: string }): Promise<void> }) => { await play.judge("time", { pass: ${pass}, what: "${pass ? "12.4 s, within 20 s" : "25.1 s, over 20 s"}" }); }`;
  return `import { gate } from ${JSON.stringify(FORM)};
export default gate({ id: "gate-timing", waves: [1], parts: [{ id: "time", words: "the first reply within 20 s", mark: "code", measured: "the first reply's time, from the turn's own record" }], fixtures: [], bed: [], rig: ${judge}, live: ${judge} });
`;
}

/** A gate with one part seen on the World page, marked as given; `form` is what its form does before it looks. */
function seenGate(id: string, mark: "code" | "as shipped", form = "", found = true): string {
  const check = `async (look: { read(): Promise<string> }) => ((await look.read()).includes("40 silver") ? { found: true as const, shows: ["40 silver"], what: "the coin is shown" } : { found: false as const, what: "no coin" })`;
  const looks = `async (play: { see(part: string): Promise<void>; run: { standing?: { is: string } }; declareGuidanceChange(why: string): void; notJudged(part: string, why: string): Promise<void> }) => { ${form} ${found ? 'await play.see("coin");' : ""} }`;
  return `import { gate } from ${JSON.stringify(FORM)};
export default gate({ id: ${JSON.stringify(id)}, waves: [1], parts: [{ id: "coin", words: "the coin on the World page", mark: ${JSON.stringify(mark)}, on: [{ page: "World", check: ${check} }] }], fixtures: [], bed: [], rig: ${looks}, live: ${looks} });
`;
}

/** A clean run with a chat layer that holds settings only; runs whose server ran another shipped tree, or an empty one; one with guidance in a chat's layer; ones whose configs switch a name. */
const CLEAN = fakeFacts({ layers: [{ level: "chat", files: [{ path: "RPE.yml", sha256: sha256("reply:\n  streamAnyway: true\n") }] }] });
const SERVED_OTHER = fakeFacts({ served: shippedOf([{ path: "author/turn.md", sha256: sha256("Write it shorter.") }], FAKE_BUILD.rpe) });
const CHAT_LAYER = fakeFacts({ layers: [{ level: "chat", files: [{ path: "author/turn.md", sha256: sha256("Write it as a sonnet.") }] }] });

function proofRoot(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "proof-standing-root-"));
  made.push(dir);
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ repeats: 10 }));
  mkdirSync(join(dir, "scenarios"));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

const guard: LiveGuard = { lock: async () => ({ held: false, release: async () => {} }), admit: async () => ({ ok: true }) };

/** Runs a gate on a fake host whose run began as `facts` say; each play's own chat stands on the build's shipped guidance unless `guidance` says another (its first answer is the footing's, its second the form's end). */
async function runOn(at: string, facts: RunFacts, options: { id?: string; mode?: "rig" | "live"; guidance?: SessionGuidance } = {}, deps: Deps = {}): Promise<{ code: number; printed: string; dir: string }> {
  const where = join(out, `run-${made.length}-${Math.random().toString(36).slice(2, 8)}`);
  const printed: string[] = [];
  const mode = options.mode ?? "rig";
  const guidance = options.guidance ?? (() => fakeGuidance());
  const code = await main([mode, options.id ?? "gate-timing", "--root", at, "--out", where, "--by", "a test"], { out: (text) => printed.push(text), openHost: async () => fakeHost(mode, { pages: { World: "Coin: 40 silver" } }, facts, guidance), guard, ...deps });
  const [name] = existsSync(where) ? readdirSync(where).filter((n) => existsSync(join(where, n, "run.json"))) : [];
  return { code, printed: printed.join(""), dir: name ? join(where, name) : "" };
}

function json(path: string): { [key: string]: unknown } {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** The outcome and figure the results file holds for the gate's first part. */
function judged(dir: string, gate = "gate-timing"): { outcome: string; why: string } {
  const record = json(join(dir, gate, "result.json")) as { parts: { instances: { outcome: string; why: string }[] }[] };
  const [instance] = record.parts[0]?.instances ?? [];
  return { outcome: instance?.outcome ?? "", why: instance?.why ?? "" };
}

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), "proof-standing-out-"));
  made.push(out);
  root = proofRoot({
    "timing/gate.ts": gateFile(true),
    "seen/gate.ts": seenGate("gate-seen", "code"),
    "shipped/gate.ts": seenGate("gate-shipped", "as shipped", "", false),
    "declared/gate.ts": seenGate("gate-declared", "code", 'play.declareGuidanceChange("it cuts every shipped file to a stub");'),
    "declared-shipped/gate.ts": seenGate("gate-declared-shipped", "as shipped", 'play.declareGuidanceChange("it switches the Author\'s file off");'),
    "unjudged/gate.ts": seenGate("gate-unjudged", "code", 'await play.notJudged("coin", "the coin page cannot be judged on a tree that is not the build\'s"); return;', false),
    "frozen/gate.ts": seenGate("gate-frozen", "code", '(play.run.standing as { is: string }).is = "verdict";'),
  });
});

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

test("a clean run on shipped guidance gives met or unmet, and a part that is met prints its figure", async () => {
  const met = await runOn(root, CLEAN);
  expect(json(join(met.dir, "run.json")).standing).toMatchObject({ is: "verdict", why: [] });
  expect(judged(met.dir)).toEqual({ outcome: "met", why: "12.4 s, within 20 s" });
  expect(met.printed).toContain("This run gives a verdict:");
  expect(met.printed).toContain('- Gate gate-timing: passed\n  - "the first reply within 20 s" (code): Passed\n    - Met in play 1: 12.4 s, within 20 s\n');
  expect(met.code).toBe(0);

  const unmet = await runOn(proofRoot({ "timing/gate.ts": gateFile(false) }), CLEAN);
  expect(judged(unmet.dir)).toEqual({ outcome: "unmet", why: "25.1 s, over 20 s" });
  expect(unmet.printed).toContain('- Gate gate-timing: failed\n  - "the first reply within 20 s" (code): Failed\n');
  expect(unmet.code).toBe(1);
});

test("a run whose served tree is not the build's, empty, with guidance in a chat's layer, with a name switched, or whose host does not say, is a trial: its measured part is printed as trial with its figure everywhere, never met", async () => {
  const names = (patch: Partial<{ off: { name: string; levels: string[] }[]; layered: string[]; added: string[] }>) => fakeFacts({ names: { off: [], layered: [], added: [], ...patch } });
  const cases: [RunFacts, string][] = [
    [SERVED_OTHER, "the shipped tree the server ran is not the build's: 1 path differs (author/turn.md)"],
    [CHAT_LAYER, "the chat layer holds guidance of its own, so its agents did not run under the shipped guidance: author/turn.md"],
    [fakeFacts({ none: true }), "the host gave no account of the guidance the run stood on (the shipped tree it served, the build's own, the layers of the user's own, the names its configs switch), so nothing shows its agents ran under the shipped guidance"],
    // A config's `stack.off` switches shipped guidance off and holds no guidance: the tree's hashes cannot show it.
    [names({ off: [{ name: "TURN", levels: ["global"] }] }), "a config switches shipped guidance: off: TURN (global), so its agents did not run under the shipped guidance as shipped"],
    [names({ layered: ["AGENTS"] }), "a config switches shipped guidance: layered: AGENTS, so its agents did not run under the shipped guidance as shipped"],
    [names({ added: ["notes.md"] }), "a config switches shipped guidance: added: notes.md, so its agents did not run under the shipped guidance as shipped"],
    [fakeFacts({ noNames: true }), "the host did not say which names the configs the run stood on switch off, layer or add, so a file switched off cannot be told from one in force"],
    // An empty tree is no account of guidance: a reader that found nothing proves nothing.
    [fakeFacts({ served: [] }), "the shipped tree the server ran has no file, which is no account of the guidance the run stood on"],
  ];
  for (const [facts, why] of cases) {
    const trial = await runOn(root, facts);
    expect(json(join(trial.dir, "run.json")).standing).toMatchObject({ is: "trial", why: [why] });
    // The results file: the figure, with the word trial, never met or unmet.
    expect(judged(trial.dir)).toEqual({ outcome: "trial", why: "12.4 s, within 20 s" });
    expect(readFileSync(join(trial.dir, "gate-timing", "notes.md"), "utf8")).toContain("Play 1: trial, no verdict: 12.4 s, within 20 s.");
    expect((json(join(trial.dir, "gate-timing", "result.json")) as { standings: { is: string }[] }).standings.map((s) => s.is)).toEqual(["trial"]);
    // The report: the standing and why, and the part as trial with its figure.
    expect(trial.printed).toContain(`This run is a trial, and gives no verdict on what rests on guidance: ${why}`);
    expect(trial.printed).toContain('- Gate gate-timing: trial\n  - Play 1 is a trial, and gives no verdict on what rests on guidance: ');
    expect(trial.printed).toContain('  - "the first reply within 20 s" (code): Trial, no verdict: 12.4 s, within 20 s\n');
    expect(trial.printed).toContain("Played 1 of 7, not played 6; passed 0, failed 0, not seen 0, measured as a rate 0, trial 1.");
    expect(trial.printed).not.toMatch(/\b(met|unmet|passed 1)\b/);
    // The exit counts a trial apart: neither a pass nor a failure.
    expect(trial.code).toBe(3);
    // Read back alone, the bundle gives the same standing and outcome.
    const read = readBundle(trial.dir);
    expect(read.standing).toEqual({ is: "trial", why: [why] });
    expect(read.forms[0]?.result).toBe("trial");
    expect(read.faults).toEqual([]);
  }
});

test("a trial exits 3 for any reason, a run of code parts only included, where a verdict exits 0", async () => {
  const clean = await runOn(root, CLEAN, { id: "gate-seen" });
  expect(clean.printed).toContain("This run gives a verdict:");
  expect(clean.code).toBe(0);
  // RPE's tree changed, and RPH not the commit RPE pins: each a trial, whatever its forms hold.
  const dirty = { ...CLEAN, rpe: { commit: "0f1e2d3c", dirty: true } };
  const offPin = { ...CLEAN, rph: { commit: FAKE_RPH, pin: "1234567890abcdef", held: fakeHeld() } };
  for (const facts of [SERVED_OTHER, CHAT_LAYER, fakeFacts({ none: true }), dirty, offPin]) {
    if (facts === dirty) expect((await runOn(root, facts, { id: "gate-seen" })).printed).toContain("This run is a trial, and gives no verdict on what rests on guidance: RPE's tree held changes beyond its commit 0f1e2d3c");
    if (facts === offPin) expect((await runOn(root, facts, { id: "gate-seen" })).printed).toContain(`RPH as installed (${FAKE_RPH}) is not the commit RPE pins (1234567890abcdef)`);
    const trial = await runOn(root, facts, { id: "gate-seen" });
    // Its one part is a code part: it passes, and the run is a trial all the same.
    expect(trial.printed).toContain("- Gate gate-seen: passed");
    expect(trial.printed).toContain("This run is a trial");
    expect(trial.code).toBe(3);
    expect(readBundle(trial.dir).standing.is).toBe("trial");
  }
  // A failure still outranks the trial: a code part that did not pass exits 1.
  const failed = await runOn(proofRoot({ "seen/gate.ts": seenGate("gate-seen", "code", "", true).replace("40 silver\")", "99 silver\")") }), SERVED_OTHER, { id: "gate-seen" });
  expect(failed.code).toBe(1);
});

test("in the rig an as-shipped part is its code path, judged as code whatever the run's standing: a broken one fails, exit 1; live it is a figure, exit 3", async () => {
  const pages = { World: "no coin here" };
  const where = join(out, `rig-shipped-${made.length}`);
  const attempt = async (mode: "rig" | "live", facts: RunFacts) => {
    const printed: string[] = [];
    const code = await main([mode, "gate-shipped", "--root", proofRoot({ "shipped/gate.ts": seenGate("gate-shipped", "as shipped").replace('"40 silver"', '"41 silver"').replace('"40 silver"', '"41 silver"') }), "--out", `${where}-${mode}`, "--by", "a test"], { out: (text) => printed.push(text), openHost: async () => fakeHost(mode, { pages }, facts), guard });
    return { code, printed: printed.join("") };
  };
  // A verdict standing and a trial standing give the rig the same result: its code path is broken.
  const verdict = await attempt("rig", CLEAN);
  const trial = await attempt("rig", SERVED_OTHER);
  for (const rig of [verdict, trial]) {
    expect(rig.printed).toContain("the code path only (the rig plays the agent as its file asks): failed".replace(/^t/, "T"));
    expect(rig.code).toBe(1);
  }
  expect(trial.printed).toContain("This run is a trial");
  // Live, the same part in a trial is a figure with no verdict, and the run exits 3.
  const live = await attempt("live", SERVED_OTHER);
  expect(live.printed).toContain("Trial, no verdict: seen in 0 of 1 (1 miss)");
  expect(live.code).toBe(3);
});

test("a setting written during a play is no change of guidance: a layer is hashed over its guidance files, not its settings file", async () => {
  // The play's chat has an RPE.yml when the footing is ready, and a different one when the form has ended (a gate writing `connections.<connection>.reply.form`).
  const settings = (text: string) => fakeGuidance({ layers: [{ level: "chat", files: [{ path: "RPE.yml", sha256: sha256(text) }] }] });
  const written: SessionGuidance = (_, when) => settings(when === "before" ? "reply:\n  streamAnyway: false\n" : "reply:\n  streamAnyway: true\n");
  const kept = await runOn(root, CLEAN, { guidance: written });
  expect(kept.printed).toContain("This run gives a verdict:");
  expect(kept.code).toBe(0);
  // A guidance file written in the same play is still a change, said so.
  const guided: SessionGuidance = (_, when) => fakeGuidance({ layers: [{ level: "chat", files: when === "before" ? [] : [{ path: "author/turn.md", sha256: sha256("Write it as a sonnet.") }] }] });
  const moved = await runOn(root, CLEAN, { guidance: guided });
  expect(moved.printed).toContain("gate-timing, play 1: its guidance changed during the play (the chat layer) and its form did not say so");
  expect(moved.code).toBe(3);
});

test("standing is worked out per play: guidance in the play's own chat, which the run's start never saw, makes that play a trial", async () => {
  // The run began on the build's shipped guidance; the chat the play made holds a layer with guidance.
  const chat: SessionGuidance = () => fakeGuidance({ layers: [{ level: "chat", files: [{ path: "author/turn.md", sha256: sha256("Write it as a sonnet.") }] }] });
  const trial = await runOn(root, CLEAN, { guidance: chat });
  expect(json(join(trial.dir, "run.json")).standing).toMatchObject({ is: "trial" });
  expect(trial.printed).toContain("gate-timing, play 1: the chat layer holds guidance of its own, so its agents did not run under the shipped guidance: author/turn.md");
  expect(judged(trial.dir).outcome).toBe("trial");
  expect(trial.code).toBe(3);
  // A fixture that lays a chat-level config switching a file off, in the footing, is seen the same way.
  const off: SessionGuidance = () => fakeGuidance({ names: { off: [{ name: "rules/perceptions-owed", levels: ["chat"] }], layered: [], added: [] } });
  const switched = await runOn(root, CLEAN, { guidance: off });
  expect(switched.printed).toContain("gate-timing, play 1: a config switches shipped guidance: off: rules/perceptions-owed (chat)");
  expect(switched.code).toBe(3);
  // A host whose session gives no account, or fails to give one, makes the play a trial, said so.
  for (const guidance of [(() => null) as SessionGuidance, (() => { throw new Error("the files route did not answer"); }) as SessionGuidance]) {
    const none = await runOn(root, CLEAN, { guidance });
    expect(none.printed).toContain("gate-timing, play 1: the host gave no account of the guidance the play's chat stood on when its footing was ready");
    expect(none.code).toBe(3);
  }
  const unsaid = await runOn(root, CLEAN, { guidance: () => ({ served: "none" }) as never });
  expect(unsaid.code).toBe(3);
});

test("guidance that changes during a play, with no word from its form, makes the play a trial; the form declaring it leaves a play whose parts do not rest on guidance as it was", async () => {
  // What the chat stood on when its footing was ready, and then: the form (or an agent) edited a file.
  const stubbed = fakeGuidance({ layers: [{ level: "chat", files: [{ path: "author/turn.md", sha256: sha256("stub") }] }] });
  const edit: SessionGuidance = (_, when) => (when === "before" ? undefined : stubbed);
  const undeclared = await runOn(root, CLEAN, { id: "gate-seen", guidance: edit });
  expect(undeclared.printed).toContain("gate-seen, play 1: its guidance changed during the play (the chat layer) and its form did not say so");
  expect(undeclared.code).toBe(3);

  // Declared by its form, and no part of it resting on guidance: the play stands as it was, the declaration its own act.
  const declared = await runOn(root, CLEAN, { id: "gate-declared", guidance: edit });
  expect(declared.printed).toContain("This run gives a verdict:");
  expect(declared.printed).toContain("- Gate gate-declared: passed");
  expect(declared.code).toBe(0);
  expect(readBundle(declared.dir).run.standing?.plays?.[0]).toMatchObject({ id: "gate-declared", declared: "it cuts every shipped file to a stub", rests: false });

  // Declared, with a part that rests on guidance (an as-shipped part live): that part is not under the shipped guidance, so it is a figure.
  const shipped = await runOn(root, CLEAN, { id: "gate-declared-shipped", mode: "live", guidance: edit });
  expect(shipped.printed).toContain("gate-declared-shipped, play 1: its form changed the guidance on purpose (it switches the Author's file off)");
  expect(shipped.code).toBe(3);
  // The same declaration where nothing changed is a word and no more.
  const idle = await runOn(root, CLEAN, { id: "gate-declared" });
  expect(idle.code).toBe(0);
});

test("a form cannot change the run it is handed: its standing is a frozen copy", async () => {
  const frozen = await runOn(root, SERVED_OTHER, { id: "gate-frozen" });
  const record = json(join(frozen.dir, "gate-frozen", "result.json")) as { stops: { why: string }[] };
  expect(record.stops).toHaveLength(1);
  expect(record.stops[0]?.why).toMatch(/^its form stopped: .*readonly/i);
  // What run.json says of the standing is the runner's own, and still a trial.
  expect(readBundle(frozen.dir).standing.is).toBe("trial");
  expect(frozen.code).toBe(1);
});

test("a part seen on screen may be told not judged only in a play that is a trial", async () => {
  const unjudged = await runOn(root, SERVED_OTHER, { id: "gate-unjudged" });
  const record = json(join(unjudged.dir, "gate-unjudged", "result.json")) as { stops: unknown[]; parts: { instances: Record<string, unknown>[] }[] };
  expect(record.stops).toEqual([]);
  expect(record.parts[0]?.instances).toEqual([{ play: 1, at: 1, outcome: "not judged", why: "the coin page cannot be judged on a tree that is not the build's", page: "World", glances: [] }]);
  expect(unjudged.printed).toContain('  - "the coin on the World page" (code): Not judged: the coin page cannot be judged on a tree that is not the build\'s');
  expect(readBundle(unjudged.dir).faults).toEqual([]);
  // Never a pass: not judged exits 1, a trial's 3 below it.
  expect(unjudged.code).toBe(1);
  // In a play that gives a verdict the form's word is refused: a part seen on screen is looked at.
  const verdict = await runOn(root, CLEAN, { id: "gate-unjudged" });
  expect(json(join(verdict.dir, "gate-unjudged", "result.json")).stops).toEqual([{ play: 1, why: "its form stopped: the form said coin is not judged, and it is seen on screen: only a play that is a trial may leave a seen part unjudged" }]);
  expect(verdict.code).toBe(1);
});

test("read back alone, a run.json that claims a verdict its own facts deny is a trial, with a fault", async () => {
  const trial = await runOn(root, SERVED_OTHER);
  const file = join(trial.dir, "run.json");
  const run = json(file) as { standing: { is: string; why: string[] } };
  writeFileSync(file, JSON.stringify({ ...run, standing: { ...run.standing, is: "verdict", why: [] } }));
  const read = readBundle(trial.dir);
  expect(read.standing.is).toBe("trial");
  expect(read.faults).toContain("run.json says the run gives a verdict, and what it stood on makes it a trial: the shipped tree the server ran is not the build's: 1 path differs (author/turn.md)");
  // A run.json that does not give its standing at all is a trial too: never a verdict.
  const { standing: _, ...bare } = run;
  writeFileSync(file, JSON.stringify(bare));
  expect(readBundle(trial.dir).standing).toEqual({ is: "trial", why: ["run.json does not give the run's standing, so it gives no verdict"] });
});

test("read back alone, every fact is worked out again: RPH's pin from the commit and the pin, a play's standing from the account of it", async () => {
  const clean = await runOn(root, CLEAN);
  expect(clean.code).toBe(0);
  const file = join(clean.dir, "run.json");
  const run = json(file) as { rph: { commit: string; pin: string | null; pinned: boolean; held: unknown } };
  // A commit and a pin that name two commits, written as pinned: the claim is not taken.
  const [one, other] = ["a".repeat(40), "b".repeat(40)];
  writeFileSync(file, JSON.stringify({ ...run, rph: { ...run.rph, commit: one, pin: other, pinned: true } }));
  const read = readBundle(clean.dir);
  expect(read.faults).toContain(`run.json says RPH is the commit RPE pins, and its commit ${one} and pin ${other} make it not the pinned commit`);
  expect(read.standing.is).toBe("trial");
  expect(read.standing.why.some((why) => why.startsWith(`RPH as installed (${one}) is not the commit RPE pins (${other})`))).toBe(true);
  expect(await main(["report", clean.dir], { out: () => {} })).toBe(1);

  // A results file that calls a play a verdict where run.json's account of it makes it a trial changes nothing.
  const trial = await runOn(root, CHAT_LAYER);
  const result = join(trial.dir, "gate-timing", "result.json");
  const record = json(result) as { standings: { play: number; is: string; why: string[] }[]; parts: { instances: { outcome: string }[] }[] };
  writeFileSync(result, JSON.stringify({ ...record, standings: [{ play: 1, is: "verdict", why: [] }] }));
  const again = readBundle(trial.dir);
  expect(again.forms[0]?.faults.some((f) => f.startsWith("its record gives play 1's standing as verdict, and run.json's account of the play makes it a trial"))).toBe(true);
  expect(again.forms[0]?.result).toBe("failed");
  // A record of another run that has this run's name, but not its nonce, is another's.
  const nonce = json(result) as { nonce: string };
  writeFileSync(result, JSON.stringify({ ...nonce, standings: record.standings, nonce: "another run's nonce" }));
  expect(readBundle(trial.dir).forms[0]?.faults).toContain("its record carries another run's nonce: it comes from another run that has this run's name");
});

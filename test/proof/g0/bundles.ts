// Bundles of the counts of row 0.2, made by the proof runner itself: a gate of the id the tags gate (or the
// two-step gate) has, played through the runner's own `main` on a host made up here, whose form keeps the
// count a test gives in `internal/play-01/count.json` as the real gates do. G0's reading of them
// (`scripts/proof/g0/forms.ts`) is held to a whole bundle the runner wrote, never to a file made by hand.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FormKept } from "../../../scripts/proof/g0/forms";
import { TAGS_GATE, TWO_STEP_GATE } from "../../../scripts/proof/g0/forms";
import type { Play } from "../../../scripts/proof/route/form";
import type { Host, RunFacts } from "../../../scripts/proof/route/host";
import { main } from "../../../scripts/proof/run";
import { FakeBrowser } from "../route/fake";
import { factsOf } from "../floor/replay";
import { recordedRun } from "../floor/recorded";

const REPO = resolve(import.meta.dir, "../../..");

/** What the next played count gate keeps, made from the run it is played in (its name and nonce, as `run.json` gives them). */
let make: ((run: { run: string; nonce: string | null }) => FormKept) | null = null;

/** How many output folders have been made, so each count run without an `into` has its own. */
let folders = 0;

/** The form the made-up gates play: keeps the count and judges its one part. */
export async function playCount(play: Play): Promise<void> {
  if (make === null) throw new Error("no count is set");
  await play.keep("count", { ...make({ run: play.run.run, nonce: play.run.nonce ?? null }) });
  await play.judge("count", { pass: true, what: "kept" });
}

/** How a count's run is made: the gate's id, the facts the host gives (the shipped files, the model), and what the count says of its run. */
export interface CountRun {
  form: "tags" | "two-step";
  /** The count the gate keeps; its `run` and `nonce` are the run's own unless the test says otherwise. */
  kept: FormKept;
  /** Keep the count's own `run` and `nonce` as given (a bundle moved from another run). */
  asGiven?: boolean;
  edit?: (facts: RunFacts) => void;
  /** The proof's output folder under the scratch to play into, where one folder holds several runs (the newest is found by the reader); by default a folder of its own. */
  into?: string;
  /** When the run starts, by the runner's clock (default: now): the run is named for it, and the newest of several is the one that started last. */
  at?: Date;
}

/** Plays a count gate in the runner, into `scratch`; gives the run's folder. */
export async function playCountRun(scratch: string, run: CountRun): Promise<string> {
  const id = run.form === "tags" ? TAGS_GATE : TWO_STEP_GATE;
  const root = join(scratch, `proof-${id}`);
  mkdirSync(join(root, "scenarios"), { recursive: true });
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(join(root, "settings.json"), JSON.stringify({ repeats: 10 }));
  writeFileSync(
    join(root, id, "gate.ts"),
    `import { gate } from ${JSON.stringify(join(REPO, "scripts/proof/route/form.ts"))};
import { playCount } from ${JSON.stringify(join(REPO, "test/proof/g0/bundles.ts"))};
export default gate({ id: ${JSON.stringify(id)}, waves: [1], parts: [{ id: "count", words: "The count of the reply form's thirty turns", mark: "code", measured: "kept in the gate's own folder" }], fixtures: [], bed: [], rig: playCount, live: playCount });
`,
  );
  make = (own) => (run.asGiven === true ? run.kept : { ...run.kept, run: own.run, nonce: own.nonce });
  const facts = factsOf(recordedRun({ form: run.form === "tags" ? "tag" : "two-step" }), run.edit);
  const host: Host = {
    mode: "rig",
    facts: async () => facts,
    begin: async () => ({ acts: undefined, browser: new FakeBrowser({ pages: {} }), guidance: async () => facts.guidance ?? null, close: async () => undefined }),
    close: async () => undefined,
  };
  const out = join(scratch, run.into ?? `out-${id}-${(folders += 1)}`);
  const before = new Set(existsSync(out) ? readdirSync(out) : []);
  const printed: string[] = [];
  try {
    await main(["rig", id, "--root", root, "--out", out, "--by", "a test"], { out: (text) => printed.push(text), openHost: async () => host, now: () => run.at ?? new Date() });
  } finally {
    make = null;
  }
  const [name] = existsSync(out) ? readdirSync(out).filter((n) => !before.has(n) && existsSync(join(out, n, "run.json"))) : [];
  if (name === undefined) throw new Error(`the runner made no bundle: ${printed.join("")}`);
  return join(out, name);
}

// The floor's gate played by the proof runner itself over a recorded run (PlanGates-42 item 2,
// PlanGates-4-fix1 items 2 and 4): the runner's own `main`, a gate whose parts and words are the floor's
// own (`scripts/proof/floor/gate.ts`), and a form that is the floor's own play (`playWith`) over a
// recorded run's turns instead of the bed's routes and sockets. A host made up here gives the acts (each
// `send` counted and answered with the recorded page) and a browser that reads the chat page and the
// Files page as text (the route's tests' own `FakeBrowser`). What the runner writes, its report, its
// results and notes, and the floor's kept table, are read back from the bundle it made.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CHAT_PAGE, FILES_PAGE, playWith, type FloorActs, type FloorReader, type Ground } from "../../../scripts/proof/floor/play";
import type { Play } from "../../../scripts/proof/route/form";
import type { GuidanceFacts, Host, RunFacts } from "../../../scripts/proof/route/host";
import { sha256, shippedOf, type Leads, type TreeFile } from "../../../scripts/proof/lib/record";
import { runRecord, type RunRecord } from "../../../scripts/proof/route/evidence";
import { standingFromFacts } from "../../../scripts/proof/route/runner";
import { main } from "../../../scripts/proof/run";
import type { FloorRun, PageTimes } from "../../../scripts/testbed/floor-measure";
import { FAKE_RPH, fakeHeld, FakeBrowser } from "../route/fake";
import { MODEL } from "./recorded";

const REPO = resolve(import.meta.dir, "../../..");

/** The build's shipped folders a replayed run stands on (invented texts), and the tree RPE serves laid from them by RPE's one rule. */
export const BUILD: { rph: TreeFile[]; rpe: TreeFile[] } = {
  rph: [{ path: ".prompts/reply-contract.md", sha256: sha256("Write the reply between the tags.") }],
  rpe: [{ path: "chat-defaults/TURN.md", sha256: sha256("Weigh intent first.") }],
};
export const SERVED = shippedOf(BUILD.rph, BUILD.rpe);

/** Who leads, as RPE's settings give it for a clean chat: the shipped default, held, no level setting another. */
export const LEADS: Leads = { expected: "author", inForce: "author", from: null, levels: [] };

/** What a test gives a replay: the recorded run, and what the floor's chat stood on before the first pair. */
export interface Replay {
  run: FloorRun;
  ground?: Partial<Ground>;
  /** The run's facts as the host gives them; by default a clean run on the build, the Author in the run's form. */
  facts?: RunFacts;
  /** When the run starts, by the runner's clock (default: now): the run is named for it and says so in its record. */
  at?: Date;
  /** The acts and reader the play is given, in place of the ones made from `run`'s turns (a gate that plays other lines than the floor's, with a reader of its own); `run` then only gives the facts. */
  source?: (sent: Sent[]) => { acts: FloorActs; reader: FloorReader; played: () => FloorRun["turns"] };
}

/** Each line the play sent, in order: the connection and the line. */
export interface Sent {
  connection: string;
  line: string;
}

let current: { acts: FloorActs; reader: FloorReader } | null = null;

/** What the replayed gate plays over: the current replay's acts and reader. */
export function replaying(): { acts: FloorActs; reader: FloorReader } {
  if (current === null) throw new Error("no replay is set");
  return current;
}

/** The form the replayed gate plays: the floor's own play over the current replay. */
export async function replayed(play: Play): Promise<void> {
  const now = replaying();
  await playWith(play, now.acts, now.reader, null, null);
}

/** The gate a replay plays: its id (and the bundle's folder), the module whose default export is the gate, and the module and name of the form that plays it over the replay. */
export interface ReplayGate {
  id: string;
  gate: string;
  form: { module: string; name: string };
}

/** The floor's own gate, played by the floor's own play. */
export const FLOOR_GATE: ReplayGate = { id: "floor", gate: "scripts/proof/floor/gate.ts", form: { module: "test/proof/floor/replay.ts", name: "replayed" } };

/** The facts of a clean run on the build, the Author in the form the run says. */
export function factsOf(run: FloorRun, edit?: (facts: RunFacts) => void): RunFacts {
  const facts: RunFacts = {
    rpe: { commit: "4f1c2a9e7b3d5a61", dirty: false },
    rph: { commit: FAKE_RPH, pin: FAKE_RPH, held: fakeHeld() },
    lumiverse: { version: "0.0.0-invented" },
    browser: { name: "fake", version: "1" },
    agents: [{ agent: "author", connection: "rpe-floor", model: MODEL, replyForm: run.form === "two-step" ? "two-step" : "tags", effort: "low", streams: run.streams }],
    settings: { chat: null, files: [], settings: [] },
    guidance: { served: SERVED, build: BUILD, layers: [], names: { off: [], layered: [], added: [] } },
  };
  edit?.(facts);
  return facts;
}

/** run.json as the runner writes it for these facts: its standing worked out from the guidance they give, as the runner works it out. */
export function recordOf(facts: RunFacts): RunRecord {
  return runRecord(facts, { run: "rig-invented", nonce: "invented-nonce", mode: "rig", by: "a test", started: "2026-11-20T10:15:00.000Z", ended: null, asked: ["floor"], unplayed: [], known: { scenarios: [], gates: ["floor"] }, repeats: 10 }, standingFromFacts(facts.guidance));
}

/** What the chat holds of a turn: its reply's text, invented. */
export const replyText = (t: { pair: number; arm: "plain" | "rpe" }): string => `The invented reply of ${t.arm === "plain" ? "plain generation" : "RPE"} to line ${t.pair}${t.arm === "plain" ? "a" : "b"}, written whole.`;

/** The acts and reader of a recorded run: `send` answers with the next turn's page, `turn` with the rest of it; `played` is the turns sent so far. */
export function replayOf(replay: Replay, sent: Sent[]): { acts: FloorActs; reader: FloorReader; played: () => FloorRun["turns"] } {
  const turns = replay.run.turns;
  let at = 0;
  const acts: FloorActs = {
    lumiverse: { base: "http://lumiverse.invalid", token: "invented" },
    rpe: { base: "http://rpe.invalid", token: "invented" },
    connections: { plain: replay.run.arms.plain.connection, rpe: "rpe-floor" },
    chat: async () => "chat-floor",
    send: async (_chat, connection, line): Promise<PageTimes> => {
      sent.push({ connection, line });
      const page = turns[at]?.page;
      if (page === undefined || page === null) throw new Error(`the recorded run has no page for its turn ${at + 1}`);
      return page;
    },
  };
  const ground: Ground = {
    observed: { plain: replay.run.plain, shipped: SERVED, layers: [], off: [], leads: LEADS },
    plain: replay.run.arms.plain,
    history: { keep: null, step: null, hold: null, framing: null, framingNote: null, framingWhy: null },
    previousRun: replay.run.previousRun,
    rpeConnections: { list: [{ id: "id-rpe-floor", name: "rpe-floor", provider: "deepseek" }], why: null },
    ...replay.ground,
  };
  const reader: FloorReader = {
    fixture: async () => ({ preset: { id: "preset-floor" }, persona: { id: "persona-floor" }, card: { id: "card-floor" }, book: replay.run.book ?? { id: "book-floor", name: "Floor test lore (invented)", entries: [], vectorBlockers: [] } }),
    ground: async () => ground,
    turn: async (_chat, _arm, send) => {
      await send();
      const turn = turns[at++];
      if (turn === undefined) throw new Error("the recorded run has no more turns");
      return { page: turn.page, socket: turn.socket, visible: turn.visible, visibleWhy: turn.visibleWhy, rpe: turn.rpe, error: turn.error };
    },
    messages: async () => turns.slice(0, at).flatMap((t) => (t.socket.messageId === null ? [] : [{ id: t.socket.messageId, content: replyText(t) }])),
    close: () => undefined,
  };
  return { acts, reader, played: () => turns.slice(0, at) };
}

/** What the runner made of a replayed gate: its report, the gate's results and notes, what it kept of its play (`internal/play-01/`, by file name), each line sent, and the run's folder where the replay was asked to leave it. */
export interface Played {
  report: string;
  code: number;
  result: { parts: { id: string; instances: { outcome: string; why: string }[] }[] };
  notes: string;
  table: string;
  internal: Record<string, string>;
  dir: string;
  sent: Sent[];
}

/**
 * Plays a gate (the floor's by default) through the runner's own `main` over a recorded run, in a scratch
 * folder removed afterwards, or in the one the caller names (`scratch`: left in place, for the caller to
 * remove, so the bundle can be read back by a reader of bundles).
 */
export async function playReplay(replay: Replay, as: ReplayGate = FLOOR_GATE, scratch?: string): Promise<Played> {
  const own = scratch === undefined;
  const base = scratch ?? mkdtempSync(join(tmpdir(), "floor-replay-"));
  mkdirSync(base, { recursive: true });
  try {
    const root = join(base, "proof");
    mkdirSync(join(root, "scenarios"), { recursive: true });
    mkdirSync(join(root, as.id), { recursive: true });
    writeFileSync(join(root, "settings.json"), JSON.stringify({ repeats: 10 }));
    writeFileSync(
      join(root, as.id, "gate.ts"),
      `import { gate } from ${JSON.stringify(join(REPO, "scripts/proof/route/form.ts"))};
import original from ${JSON.stringify(join(REPO, as.gate))};
import { ${as.form.name} as played } from ${JSON.stringify(join(REPO, as.form.module))};
export default gate({ ...original, rig: played, live: played });
`,
    );
    const sent: Sent[] = [];
    const replay_ = replay.source === undefined ? replayOf(replay, sent) : replay.source(sent);
    current = replay_;
    // The chat page shows the chat as far as it was played, read when the check reads it.
    const pages = {
      get [CHAT_PAGE]() {
        return ["Lumiverse chat", ...replay_.played().map(replyText), "Type a message"].join("\n");
      },
      [FILES_PAGE]: "Files\nAgent\nAn agent's stack\nauthor: the reply contract, in the opening block",
    };
    const facts = replay.facts ?? factsOf(replay.run);
    // What the play's chat stands on, as a bed's host would read it from RPE's view of that chat: the tree the floor saw there, and the names its configs switch off.
    const seen = replay.ground?.observed;
    const standing: GuidanceFacts | null = seen === undefined ? (facts.guidance ?? null) : { served: seen.shipped, build: BUILD, layers: seen.layers, names: { off: seen.off.map((f) => ({ name: f.path, levels: f.offIn })), layered: [], added: [] } };
    const host: Host = {
      mode: "rig",
      facts: async () => facts,
      begin: async () => ({ acts: current?.acts, browser: new FakeBrowser({ pages }), guidance: async () => standing, close: async () => undefined }),
      close: async () => undefined,
    };
    const out = join(base, "out");
    const printed: string[] = [];
    const code = await main(["rig", as.id, "--root", root, "--out", out, "--by", "a test"], { out: (text) => printed.push(text), openHost: async () => host, now: () => replay.at ?? new Date() });
    const [name] = existsSync(out) ? readdirSync(out).filter((n) => existsSync(join(out, n, "run.json"))) : [];
    if (name === undefined) throw new Error(`the runner made no bundle: ${printed.join("")}`);
    const dir = join(out, name, as.id);
    const at = join(dir, "internal", "play-01");
    const table = join(at, "table.txt");
    return {
      report: printed.join(""),
      code,
      result: JSON.parse(readFileSync(join(dir, "result.json"), "utf8")) as Played["result"],
      notes: readFileSync(join(dir, "notes.md"), "utf8"),
      table: existsSync(table) ? readFileSync(table, "utf8") : "",
      internal: existsSync(at) ? Object.fromEntries(readdirSync(at).map((file) => [file, readFileSync(join(at, file), "utf8")])) : {},
      dir: join(out, name),
      sent,
    };
  } finally {
    current = null;
    if (own) rmSync(base, { recursive: true, force: true });
  }
}

/** The instances the runner recorded for a part, as outcome and why. */
export function partOf(played: Played, id: string): { outcome: string; why: string }[] {
  return (played.result.parts.find((p) => p.id === id)?.instances ?? []).map(({ outcome, why }) => ({ outcome, why }));
}

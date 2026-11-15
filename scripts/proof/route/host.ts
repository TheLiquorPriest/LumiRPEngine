// What a proof script plays on (PlanScenarios-1; plan §17.0, §18.3). A host is the ground a run
// stands on: the rig (the stand-in Lumiverse, a scripted model for each agent, RPE's real pages in a
// browser: PlanScenarios-2's `scripts/proof/rig/host.ts`) or the test bed (the real Lumiverse UI and
// RPE's own UI with the real model: PlanScenarios-3's `scripts/proof/live/host.ts`). The runner finds
// each by that path and asks it for the facts of the run, a fresh footing for every play and a browser
// that reads pages as a person does. Every wait a host makes is on something shown, never a fixed time.

import type { SettingsReply } from "../../../src/shared/api";

export type Mode = "rig" | "live";

/** A control as a person finds it on a page: by the words on it or beside it, or by what it is. */
export interface Control {
  label?: string;
  role?: string;
}

/** What a wait waits for: a text or a control to show. */
export type Shown = { text: string } | { control: Control };

/**
 * What a page showed at one moment, as the browser saved it. Whether a screen shows a part is judged
 * from this record alone (`evidence.ts`), so a host keeps it true to the saved image:
 * - `text` is the text visible in the saved image, and nothing else. It is not the page's whole text,
 *   not what lies below the fold or outside the window, and not text that is hidden, covered or
 *   clipped. A driver that saves only the window reads only the window's visible text. One that saves
 *   the whole page reads the whole page's visible text. An image that shows nothing has empty text.
 * - `page` is the page as the saved image names itself (its heading, its tab, the drawer's title),
 *   read from the page and never echoed from what was asked.
 * - `width` is the width the page was laid out at when the image was saved.
 */
export interface Shot {
  image: Uint8Array;
  /** `txt` for a terminal: the command as typed and every line it printed. */
  format: "png" | "webp" | "txt";
  /** The page as the saved image names itself, never echoed from what was asked. */
  page: string;
  /** Pixels wide for a page; columns for a terminal. */
  width: number;
  /** The text visible in the saved image, the names of the controls in it included, and nothing outside it. */
  text: string;
}

/**
 * The browser a form and its checks read pages with (PlanScenarios-2 item 2): open a page at a width,
 * find a control by its label or role, press, type, wait until a text or a control shows, read a
 * section's text, save a screen. A control or a page that is not there is an error naming it. The
 * terminal is a page too ("terminal"), opened with no width.
 */
export interface Browser {
  open(page: string, width?: number): Promise<void>;
  find(control: Control): Promise<void>;
  press(control: Control): Promise<void>;
  type(control: Control, text: string): Promise<void>;
  /** Resolves once it shows; rejects, naming what never showed, at the host's own limit. */
  waitFor(shown: Shown): Promise<void>;
  /** A section's text, or the whole page's when no section is named: what a check reads, which may hold more than one screen shows. */
  read(section?: string): Promise<string>;
  /** Saves what the page shows now, with the text visible in that image (see `Shot`). */
  screen(): Promise<Shot>;
}

/** One agent as RPE runs it in this run, from RPE's own routes. */
export interface AgentFacts {
  agent: string;
  connection: string;
  model: string;
  /** The form the reply takes on that connection (the tags, or the two-step form). */
  replyForm: string;
  effort: string;
  streams: boolean;
}

/** What a run stood on, for `run.json` (plan §17.0 l.1751: what is seen counts, and where it was seen). */
export interface RunFacts {
  rpe: { commit: string; dirty: boolean };
  /** RPH's commit as installed, and the commit RPE's manifest pins (null when it pins none). */
  rph: { commit: string; pin: string | null };
  lumiverse: { version: string };
  browser: { name: string; version: string };
  agents: AgentFacts[];
  /** The settings in force, as `GET /api/v1/settings` gave them. */
  settings: SettingsReply;
}

/** A form as the host is told of it when a play begins. */
export interface FormBrief {
  /** The scenario's number as text, or the gate's id. */
  id: string;
  kind: "scenario" | "gate";
  fixtures: string[];
  /** Where its fixtures are: the scenarios' `fixtures/` folder, or the gate's own folder. */
  fixturesDir: string;
  bed: string[];
}

export interface PlayStart {
  form: FormBrief;
  /** Which play this is, from 1, of `plays`. On the bed every play is on a fresh chat of the instance's. */
  play: number;
  plays: number;
  /** Keeps supporting evidence (route answers, rows, logs) in the form's `internal/` folder. */
  keep(name: string, data: Kept): Promise<void>;
}

/** What may be kept as supporting evidence. */
export type Kept = string | Uint8Array | { [key: string]: unknown } | unknown[];

/** One play's footing: a fresh chat on the bed, a fresh rig in the rig. */
export interface Session<Acts = unknown> {
  /** What the form may do here: the player's acts on the stand-in, or the steps on the bed's pages. */
  acts: Acts;
  browser: Browser;
  close(): Promise<void>;
}

export interface Host<Acts = unknown> {
  readonly mode: Mode;
  facts(): Promise<RunFacts>;
  begin(start: PlayStart): Promise<Session<Acts>>;
  close(): Promise<void>;
}

export interface HostOptions {
  /** The proof scripts' folder (`scripts/proof`). */
  root: string;
  /** The run's id, which a host may name what it makes after. */
  run: string;
}

/** What `scripts/proof/rig/host.ts` and `scripts/proof/live/host.ts` export. */
export interface HostModule {
  openHost(options: HostOptions): Promise<Host>;
}

/**
 * The cheap gate and the bed's lock (PlanScenarios-5, `scripts/proof/gate/guard.ts`, exported as
 * `guard`). No live run starts without both: the lock is taken before the run's first step and given
 * back after its last, and the commits the bed reports must have a passing gate.
 */
export interface LiveGuard {
  /** The bed's lock for this run, or who holds it now. */
  lock(run: string): Promise<{ held: false; release(): Promise<void> } | { held: true; by: string }>;
  /** Whether a live run may play on these commits; when not, why. */
  admit(facts: RunFacts): Promise<{ ok: true } | { ok: false; why: string }>;
}

/**
 * The formal round's order (PlanScenarios-50, `scripts/proof/round/order.ts`, exported as `order`):
 * stages by the bed's states, each played in turn, the bed restored from its golden copy first where
 * a stage says so.
 */
export interface RoundStage {
  name: string;
  /** Scenario numbers as text and gate ids, in the order they are played. */
  ids: string[];
  restoreGolden: boolean;
}

/** What a live host does beside a play's footing, for the round: the bed put back to its golden copy. */
export interface RoundHost extends Host {
  restoreGolden(): Promise<void>;
}

/** What `scripts/proof/checkpoint/checkpoint.ts` exports (PlanScenarios-5): a wave's record, its exit code. */
export interface CheckpointModule {
  checkpoint(wave: number, argv: string[]): Promise<number>;
}

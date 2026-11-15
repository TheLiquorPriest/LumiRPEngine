// A host made up for the route's tests: pages held as text, a browser that reads them as the real
// drivers do (a page or a control that is not there is an error naming it), and invented facts of a
// run. Nothing here stands for Lumiverse; it stands for a host, so the runner can be shown playing,
// saving screens and refusing without a rig or a bed. Its screens keep the host's contract
// (`host.ts`, `Shot`): a screen's text is what the saved image shows, never what lies below the fold.

import { sha256, shippedOf, type Layer, type TreeFile } from "../../../scripts/proof/lib/record";
import { runRecord, standingOf, type PlayGuidance, type RunRecord, type StandingFrom } from "../../../scripts/proof/route/evidence";
import type { Browser, Control, GuidanceFacts, Host, NamesFacts, PinHeld, PlayStart, RunFacts, Session, Shot, Shown } from "../../../scripts/proof/route/host";
import { pinName } from "../../../scripts/proof/route/pin";
import { standingFromFacts } from "../../../scripts/proof/route/runner";

export interface FakeOptions {
  /** The text each page shows, by its name. */
  pages: Record<string, string>;
  /** A page that shows as another when it is opened (a wrong tab). */
  showsAs?: Record<string, string>;
  /** Every screen fails to save. */
  noScreens?: boolean;
  /** Every screen is saved with no text on it. */
  blank?: boolean;
  /** Every screen is saved this wide, whatever width the page was opened at. */
  width?: number;
  /** Text a page holds below the fold: a check that reads the page finds it, and no screen shows it. */
  fold?: Record<string, string>;
}

export class FakeBrowser implements Browser {
  private page: string | null = null;
  private width: number | undefined;
  /** Whether the window has been scrolled down to what lies below the fold. */
  private down = false;

  constructor(private readonly options: FakeOptions) {}

  /** What the window shows of the open page: its top, or once scrolled down, what lay below the fold. */
  private text(): string {
    if (this.page === null) throw new Error("no page is open");
    const below = this.options.fold?.[this.page];
    return this.down && below !== undefined ? below : (this.options.pages[this.page] ?? "");
  }

  /** The whole of the open page, what is below the fold included. */
  private whole(): string {
    if (this.page === null) throw new Error("no page is open");
    const top = this.options.pages[this.page] ?? "";
    const below = this.options.fold?.[this.page];
    return below === undefined ? top : `${top}\n${below}`;
  }

  async open(page: string, width?: number): Promise<void> {
    if (!(page in this.options.pages)) throw new Error(`no page named ${page}`);
    this.page = page;
    this.width = width;
    this.down = false;
  }

  async find(control: Control): Promise<void> {
    const name = control.label ?? control.role ?? "";
    if (!this.whole().includes(name)) throw new Error(`no control labelled ${name}`);
  }

  async press(control: Control): Promise<void> {
    await this.find(control);
  }

  async type(control: Control, _text: string): Promise<void> {
    await this.find(control);
  }

  async waitFor(shown: Shown): Promise<void> {
    const what = "text" in shown ? shown.text : (shown.control.label ?? shown.control.role ?? "");
    if (!this.whole().includes(what)) throw new Error(`never showed: ${what}`);
  }

  async read(): Promise<string> {
    return this.whole();
  }

  async show(shown: Shown): Promise<void> {
    await this.waitFor(shown);
    const what = "text" in shown ? shown.text : (shown.control.label ?? shown.control.role ?? "");
    const top = this.page === null ? "" : (this.options.pages[this.page] ?? "");
    this.down = !top.includes(what);
  }

  async scroll(within?: Control): Promise<void> {
    const below = this.page === null ? undefined : this.options.fold?.[this.page];
    if (below === undefined || this.down) throw new Error(`${within?.label ?? within?.role ?? `the ${this.page ?? ""} page`} does not scroll`);
    this.down = true;
  }

  async screen(): Promise<Shot> {
    if (this.options.noScreens) throw new Error("the browser saved nothing");
    const page = this.page ?? "";
    return { image: new TextEncoder().encode(`screen of ${page}`), format: page === "terminal" ? "txt" : "png", page: this.options.showsAs?.[page] ?? page, width: this.options.width ?? this.width ?? 120, text: this.options.blank ? "" : this.text() };
  }
}

/** The build's shipped folders a fake run stands on: RPH's, and RPE's over it (invented texts). */
export const FAKE_BUILD: { rph: TreeFile[]; rpe: TreeFile[] } = {
  rph: [{ path: "author/turn.md", sha256: sha256("Write the turn as the scene asks.") }],
  rpe: [{ path: "author/briefing.md", sha256: sha256("Read the briefing first.") }],
};

/** What a test asks of a fake run's guidance: a served tree other than the build's, layers of the user's own, or no account of guidance at all. */
export interface GuidanceAsked {
  served?: TreeFile[];
  layers?: Layer[];
  /** The names the configs switch off, layer or add; none by default. */
  names?: NamesFacts;
  /** The host says nothing of which names its configs switch. */
  noNames?: true;
  none?: true;
}

const NO_NAMES: NamesFacts = { off: [], layered: [], added: [] };

/** What a clean play's chat stands on: the build's shipped guidance, no layer of the user's own, no name switched. */
export function fakeGuidance(asked: GuidanceAsked = {}): GuidanceFacts {
  return { served: asked.served ?? shippedOf(FAKE_BUILD.rph, FAKE_BUILD.rpe), build: FAKE_BUILD, layers: asked.layers ?? [], ...(asked.noNames ? {} : { names: asked.names ?? NO_NAMES }) };
}

/** A whole commit of RPH, invented: forty hex digits. */
export const FAKE_RPH = "9a8b7c6d5e4f3a2190817263544f3e2d1c0b9a87";

/** How a pin was held on the Mac before publishing, for `commit`: the manifest's name for it, RPH's own repository, the stage. */
export function fakeHeld(commit: string = FAKE_RPH): PinHeld {
  return { name: pinName("before-publishing", commit), from: "rph-repository", stage: "before-publishing", bundles: null };
}

/** Invented facts of a run: commits, versions, one agent, one setting, and by default a clean run on the build's shipped guidance with no layer of the user's own. */
export function fakeFacts(guidance: GuidanceAsked = {}): RunFacts {
  return {
    rpe: { commit: "0f1e2d3c", dirty: false },
    rph: { commit: FAKE_RPH, pin: FAKE_RPH, held: fakeHeld() },
    lumiverse: { version: "0.0.0-stand-in" },
    browser: { name: "fake", version: "1" },
    agents: [{ agent: "author", connection: "Scripted", model: "scripted-author", replyForm: "tags", effort: "medium", streams: true }],
    settings: { chat: null, files: [], settings: [{ key: "reply.streamAnyway", name: "Stream anyway", about: "Connections whose reply streams though they are in the two-step form.", effect: "use", effectWords: "at its next use", row: null, value: false, default: false, from: null, file: null, set: [], joined: false, takes: { type: "yesNo" }, takesWords: "yes or no", none: null, orNone: false, levels: [], passed: null }] },
    guidance: guidance.none ? null : fakeGuidance(guidance),
  };
}

/** What a run's standing is worked out from, for facts a test made: `standingFromFacts` of their guidance. */
export function fakeFrom(facts: RunFacts = fakeFacts()): StandingFrom | null {
  return standingFromFacts(facts.guidance);
}

/** What a live run names besides a rig run's facts: the instance it was on, the user it acted as, the never-touch list. A fake run of the bed gets them unless its facts say (even with nothing) what they are. */
export function withLive(facts: RunFacts): RunFacts {
  const said = (["instance", "user", "neverTouch"] as const).some((key) => Object.hasOwn(facts, key));
  return said ? facts : { ...facts, instance: { address: "http://lumiverse.test:7860", name: "bed-instance" }, user: "user-marlow", neverTouch: ["chat-bed-", "7744"] };
}

/** The accounts a runner leaves of plays whose chat stood on the guidance `facts` give, before and after alike, for each of `plays` plays of `id`. */
export function fakePlays(id: string, plays = 1, facts: RunFacts = fakeFacts(), rests = false): PlayGuidance[] {
  const from = fakeFrom(facts);
  return Array.from({ length: plays }, (_, n) => ({ id, play: n + 1, before: from, after: from, declared: null, rests }));
}

/** A run's record as the runner writes it for a run that stood on `facts`, with the accounts of `plays` in its standing. */
export function fakeRun(fields: Omit<RunRecord, "rpe" | "rph" | "lumiverse" | "browser" | "agents" | "settings" | "standing" | "instance" | "user" | "neverTouch">, plays: PlayGuidance[] = [], facts: RunFacts = fakeFacts()): RunRecord {
  const from = fakeFrom(facts);
  const run = runRecord(fields.mode === "live" ? withLive(facts) : facts, fields, from);
  return { ...run, standing: standingOf(run.rpe, run.rph, from, plays) };
}

/** What a fake host's session says its chat stands on, when asked the first time (footing ready) and the second (form ended): the run's own guidance unless the test says otherwise; `undefined` gives the run's, `null` no account. */
export type SessionGuidance = (start: PlayStart, when: "before" | "after") => GuidanceFacts | null | undefined;

/** A host whose every play opens a fresh browser on the same pages; `begun` lists every play it set up. Each session says what its chat stands on, by `guidance` or the run's own facts. */
export function fakeHost(mode: "rig" | "live", options: FakeOptions, facts: RunFacts = fakeFacts(), guidance?: SessionGuidance): Host & { begun: PlayStart[]; closed: number } {
  const host = {
    mode,
    begun: [] as PlayStart[],
    closed: 0,
    async facts() {
      return mode === "live" ? withLive(facts) : facts;
    },
    async begin(start: PlayStart): Promise<Session> {
      host.begun.push(start);
      let asked = 0;
      return {
        acts: { chat: `chat-${start.form.id}-${start.play}` },
        browser: new FakeBrowser(options),
        guidance: async () => {
          const said = guidance?.(start, asked++ === 0 ? "before" : "after");
          return said === undefined ? (facts.guidance ?? null) : said;
        },
        close: async () => {},
      };
    },
    async close() {
      host.closed++;
    },
  };
  return host;
}

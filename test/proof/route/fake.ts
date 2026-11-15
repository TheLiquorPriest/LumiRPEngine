// A host made up for the route's tests: pages held as text, a browser that reads them as the real
// drivers do (a page or a control that is not there is an error naming it), and invented facts of a
// run. Nothing here stands for Lumiverse; it stands for a host, so the runner can be shown playing,
// saving screens and refusing without a rig or a bed. Its screens keep the host's contract
// (`host.ts`, `Shot`): a screen's text is what the saved image shows, never what lies below the fold.

import { sha256, shippedOf, type Layer, type TreeFile } from "../../../scripts/proof/lib/record";
import type { Browser, Control, Host, PlayStart, RunFacts, Session, Shot, Shown } from "../../../scripts/proof/route/host";

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
  none?: true;
}

/** Invented facts of a run: commits, versions, one agent, one setting, and by default a clean run on the build's shipped guidance with no layer of the user's own. */
export function fakeFacts(guidance: GuidanceAsked = {}): RunFacts {
  return {
    rpe: { commit: "0f1e2d3c", dirty: false },
    rph: { commit: "9a8b7c6d", pin: "9a8b7c6d" },
    lumiverse: { version: "0.0.0-stand-in" },
    browser: { name: "fake", version: "1" },
    agents: [{ agent: "author", connection: "Scripted", model: "scripted-author", replyForm: "tags", effort: "medium", streams: true }],
    settings: { chat: null, files: [], settings: [{ key: "reply.streamAnyway", value: false, default: false, from: null, file: null, takes: { type: "yesNo" }, takesWords: "yes or no", none: null, orNone: false, levels: [], passed: null }] },
    guidance: guidance.none ? null : { served: guidance.served ?? shippedOf(FAKE_BUILD.rph, FAKE_BUILD.rpe), build: FAKE_BUILD, layers: guidance.layers ?? [] },
  };
}

/** A host whose every play opens a fresh browser on the same pages; `begun` lists every play it set up. */
export function fakeHost(mode: "rig" | "live", options: FakeOptions, facts: RunFacts = fakeFacts()): Host & { begun: PlayStart[]; closed: number } {
  const host = {
    mode,
    begun: [] as PlayStart[],
    closed: 0,
    async facts() {
      return facts;
    },
    async begin(start: PlayStart): Promise<Session> {
      host.begun.push(start);
      return { acts: { chat: `chat-${start.form.id}-${start.play}` }, browser: new FakeBrowser(options), close: async () => {} };
    },
    async close() {
      host.closed++;
    },
  };
  return host;
}

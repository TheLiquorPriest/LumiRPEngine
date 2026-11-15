// A host made up for the route's tests: pages held as text, a browser that reads them as the real
// drivers do (a page or a control that is not there is an error naming it), and invented facts of a
// run. Nothing here stands for Lumiverse; it stands for a host, so the runner can be shown playing,
// saving screens and refusing without a rig or a bed.

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
}

export class FakeBrowser implements Browser {
  private page: string | null = null;
  private width: number | undefined;

  constructor(private readonly options: FakeOptions) {}

  private text(): string {
    if (this.page === null) throw new Error("no page is open");
    return this.options.pages[this.page] ?? "";
  }

  async open(page: string, width?: number): Promise<void> {
    if (!(page in this.options.pages)) throw new Error(`no page named ${page}`);
    this.page = page;
    this.width = width;
  }

  async find(control: Control): Promise<void> {
    const name = control.label ?? control.role ?? "";
    if (!this.text().includes(name)) throw new Error(`no control labelled ${name}`);
  }

  async press(control: Control): Promise<void> {
    await this.find(control);
  }

  async type(control: Control, _text: string): Promise<void> {
    await this.find(control);
  }

  async waitFor(shown: Shown): Promise<void> {
    const what = "text" in shown ? shown.text : (shown.control.label ?? shown.control.role ?? "");
    if (!this.text().includes(what)) throw new Error(`never showed: ${what}`);
  }

  async read(): Promise<string> {
    return this.text();
  }

  async screen(): Promise<Shot> {
    if (this.options.noScreens) throw new Error("the browser saved nothing");
    const page = this.page ?? "";
    return { image: new TextEncoder().encode(`screen of ${page}`), format: page === "terminal" ? "txt" : "png", page: this.options.showsAs?.[page] ?? page, width: this.options.width ?? this.width ?? 120, text: this.options.blank ? "" : this.text() };
  }
}

/** Invented facts of a run: commits, versions, one agent, one setting. */
export function fakeFacts(): RunFacts {
  return {
    rpe: { commit: "0f1e2d3c", dirty: false },
    rph: { commit: "9a8b7c6d", pin: "9a8b7c6d" },
    lumiverse: { version: "0.0.0-stand-in" },
    browser: { name: "fake", version: "1" },
    agents: [{ agent: "author", connection: "Scripted", model: "scripted-author", replyForm: "tags", effort: "medium", streams: true }],
    settings: { chat: null, files: [], settings: [{ key: "reply.streamAnyway", value: false, default: false, from: null, file: null, takes: { type: "yesNo" }, takesWords: "yes or no", none: null, orNone: false, levels: [], passed: null }] },
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

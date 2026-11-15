// The browser driver the rig and the bed share (PlanScenarios-2 item 2 and item 10; PlanScenarios-3
// items 1, 2 and 11): it opens a page at a width, finds a control by its label or role as a person reads
// the page, presses, types, chooses an option by typing its name, waits until a text or a control shows
// (never a fixed time: every wait is on what shows, at the host's own limit), reads a section's text,
// brings a thing into the window, scrolls, and saves a screen with the text visible in that image. It is
// `route/host.ts`'s `Browser`, kept to its contract:
//
// - one look at a part opens the page, runs the check, and saves a screen, and the screen shows the
//   window as the check left it (`show` and `scroll` bring things into view and leave them there);
// - `read()` and `Shot.text` are the one function of `text.ts`, run in the page, so what a check names
//   is in the screen's text exactly when the screen shows it;
// - a page's name on a screen is read from the page itself (`Pages.nameOf`), never what was asked.
//
// Which pages there are, where each is, and how to be signed in to them, is the host's (`Pages`): the
// rig's host knows RPE's web shell and its extension shell, the bed's host knows Lumiverse's own pages.
// Each driver has a browser context of its own, so one play's storage is never the next play's.

import type { Browser, Control, Shot, Shown } from "../route/host";
import type { Chrome } from "./chrome";
import { type Answer, type Found, PAGE_SCRIPT, type Wanted } from "./page";

/** What a host's `Pages` is given to open a page with: the tab, and the driver's own acts, to sign in as a person does. */
export interface PageTab {
  /** Goes to the address and waits until the page has loaded (or, for a change of fragment alone, until the address has changed). */
  goto(url: string): Promise<void>;
  /** Runs an expression in the page and gives its value. */
  evaluate<T>(expression: string): Promise<T>;
  /** The driver itself: a host signs in by typing and pressing. */
  browser: BrowserDriver;
}

/** The pages a host has, and how the driver is told which one it is on. */
export interface Pages {
  /** Brings the page named up in the tab; an unknown page is an error naming it. */
  open(page: string, tab: PageTab): Promise<void>;
  /** An expression run in the page that gives the page's own name (its tab, its heading), or an empty text while it shows none. */
  nameOf: string;
}

/** A cookie as the browser gives it (`Network.Cookie`): what `cookies` reads and `setCookies` writes back. */
export type Cookie = Record<string, unknown> & { name: string; value: string };

export interface DriverOptions {
  chrome: Chrome;
  pages: Pages;
  /** How long a wait on what shows lasts before it rejects, naming what never showed; the host's own limit. */
  limitMs?: number;
}

/** The window's height for a width: a phone's for the narrow one, a desktop's for the rest. */
function heightFor(width: number): number {
  return width < 600 ? 844 : 900;
}

const KEYS: Record<string, { code: string; code_: number; text?: string }> = {
  Enter: { code: "Enter", code_: 13, text: "\r" },
  Tab: { code: "Tab", code_: 9 },
  Escape: { code: "Escape", code_: 27 },
  Backspace: { code: "Backspace", code_: 8 },
  ArrowDown: { code: "ArrowDown", code_: 40 },
  ArrowUp: { code: "ArrowUp", code_: 38 },
};

export class BrowserDriver implements Browser {
  private width: number | undefined;
  private readonly limitMs: number;
  private readonly tab: PageTab;

  private constructor(
    private readonly options: DriverOptions,
    private readonly session: string,
    private readonly target: string,
    private readonly context: string,
  ) {
    this.limitMs = options.limitMs ?? 15_000;
    this.tab = { goto: (url) => this.goto(url), evaluate: (expression) => this.evaluate(expression), browser: this };
  }

  /** A fresh window in a browser context of its own: nothing it keeps is another window's. */
  static async create(options: DriverOptions): Promise<BrowserDriver> {
    const { cdp } = options.chrome;
    const { browserContextId } = await cdp.send<{ browserContextId: string }>("Target.createBrowserContext", { disposeOnDetach: true });
    const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PAGE_SCRIPT }, sessionId);
    return new BrowserDriver(options, sessionId, targetId, browserContextId);
  }

  private get cdp() {
    return this.options.chrome.cdp;
  }

  /** The cookies this window's browser context holds, as a person's sign-in leaves them. */
  async cookies(): Promise<Cookie[]> {
    return (await this.cdp.send<{ cookies: Cookie[] }>("Storage.getCookies", { browserContextId: this.context })).cookies;
  }

  /** Puts cookies into this window's context, as a sign-in made in another of this run's windows left them: a sign-in is made once for a run, so no window of it asks Lumiverse to sign in again. */
  async setCookies(cookies: readonly Cookie[]): Promise<void> {
    await this.cdp.send("Storage.setCookies", { cookies, browserContextId: this.context });
  }

  async close(): Promise<void> {
    await this.cdp.send("Target.closeTarget", { targetId: this.target }).catch(() => undefined);
    await this.cdp.send("Target.disposeBrowserContext", { browserContextId: this.context }).catch(() => undefined);
  }

  /** Runs an expression in the page; an exception is an error with the page's own words. */
  async evaluate<T>(expression: string): Promise<T> {
    const done = await this.cdp.send<{ result: { value?: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, this.session);
    if (done.exceptionDetails) throw new Error(`the page refused ${expression.slice(0, 80)}: ${done.exceptionDetails.exception?.description?.split("\n")[0] ?? done.exceptionDetails.text}`);
    return done.result.value as T;
  }

  /** One call of the page's library, answered or refused in the form's own words. */
  private async call<T>(method: string, ...args: unknown[]): Promise<T> {
    const answer = await this.evaluate<Answer<T> | T>(`window.__proof.${method}(${args.map((a) => JSON.stringify(a ?? null)).join(", ")})`);
    if (typeof answer === "object" && answer !== null && "ok" in answer) {
      const said = answer as Answer<T>;
      if (!said.ok) throw new Error(said.error);
      return said.value;
    }
    return answer as T;
  }

  /** Goes to an address and waits for what ends that: the page loaded, or for a change of fragment alone, the address changed. */
  async goto(url: string): Promise<void> {
    const here = await this.evaluate<string>("location.href");
    const sameDocument = here.split("#")[0] === url.split("#")[0] && url.includes("#");
    const { promise: arrived, resolve } = Promise.withResolvers<void>();
    const stop = this.cdp.on(sameDocument ? "Page.navigatedWithinDocument" : "Page.loadEventFired", (_params, session) => session === this.session && resolve());
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      resolve();
    }, this.limitMs);
    try {
      if (sameDocument) {
        if (here === url) return;
        await this.evaluate(`void (location.href = ${JSON.stringify(url)})`);
      } else {
        const sent = await this.cdp.send<{ errorText?: string }>("Page.navigate", { url }, this.session);
        if (sent.errorText) throw new Error(`the page ${url} would not open: ${sent.errorText}`);
      }
      await arrived;
    } finally {
      stop();
      clearTimeout(timer);
    }
    if (timedOut) throw new Error(`the page ${url} did not finish loading within ${this.limitMs} ms`);
  }

  private async setWidth(width: number): Promise<void> {
    await this.cdp.send("Emulation.setDeviceMetricsOverride", { width, height: heightFor(width), deviceScaleFactor: 1, mobile: false }, this.session);
    this.width = width;
  }

  async open(page: string, width?: number): Promise<void> {
    if (width !== undefined) await this.setWidth(width);
    else if (this.width === undefined) await this.setWidth(1280);
    await this.options.pages.open(page, this.tab);
    // The page is up when it names itself, and what it names is what the screen will say it is.
    const start = Date.now();
    for (;;) {
      const name = await this.evaluate<string | null>(this.options.pages.nameOf).catch(() => null);
      if (name !== null && name.trim() !== "") break;
      if (Date.now() - start > this.limitMs) throw new Error(`the ${page} page did not show its own name within ${this.limitMs} ms`);
      await Bun.sleep(25);
    }
    await this.call("settle");
  }

  async find(control: Control): Promise<void> {
    await this.call<Found>("find", control);
  }

  private async clickAt(x: number, y: number): Promise<void> {
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, this.session);
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }, this.session);
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }, this.session);
  }

  async press(control: Control): Promise<void> {
    const at = await this.call<Found>("find", control);
    await this.clickAt(at.x, at.y);
  }

  /**
   * Presses an element the page gives no words for (a button that is only an icon), found by `selector` and
   * named `name` in the stop when it is not there: the one place a form names an element by its markup.
   */
  async pressSelector(selector: string, name: string): Promise<void> {
    const at = await this.evaluate<{ x: number; y: number } | null>(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el === null) return null; el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" }); const r = el.getBoundingClientRect(); return { x: Math.min(Math.max(r.left + r.width / 2, 1), window.innerWidth - 1), y: Math.min(Math.max(r.top + r.height / 2, 1), window.innerHeight - 1) }; })()`,
    );
    if (at === null) throw new Error(`no ${name} on the page (looked for ${selector})`);
    await this.clickAt(at.x, at.y);
  }

  async type(control: Control, text: string): Promise<void> {
    await this.call("focus", control);
    await this.cdp.send("Input.insertText", { text }, this.session);
  }

  /** One key, as a person presses it in whatever has the focus. */
  async key(name: string): Promise<void> {
    const key = KEYS[name];
    if (!key) throw new Error(`the driver does not press ${name}: it presses ${Object.keys(KEYS).join(", ")}`);
    const base = { key: name, code: key.code, windowsVirtualKeyCode: key.code_, nativeVirtualKeyCode: key.code_ };
    await this.cdp.send("Input.dispatchKeyEvent", { type: key.text ? "keyDown" : "rawKeyDown", ...base, ...(key.text ? { text: key.text } : {}) }, this.session);
    await this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base }, this.session);
  }

  /**
   * Chooses an option in a chooser: the chooser is found by its label, the name is typed (a menu of the
   * page's own makes the choice by it), the choice is confirmed, and the wait is until the chosen name shows.
   */
  async choose(control: Control, name: string): Promise<void> {
    try {
      await this.call("choose", control, name);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("is not a menu")) throw error;
      await this.type(control, name);
      await this.key("Enter");
    }
    await this.waitFor({ text: name });
  }

  async waitFor(shown: Shown): Promise<void> {
    await this.call("waitFor", shown satisfies Wanted, this.limitMs);
  }

  async read(section?: string): Promise<string> {
    return section === undefined ? await this.call<string>("text", "page") : await this.call<string>("section", section);
  }

  async show(shown: Shown): Promise<void> {
    await this.call("show", shown satisfies Wanted, this.limitMs);
  }

  async scroll(within?: Control): Promise<void> {
    await this.call("scroll", within ?? null);
  }

  async screen(): Promise<Shot> {
    await this.call("settle");
    // The text is read from the window the image is of: taken again if the page moved while the image was taken.
    let image: Uint8Array = new Uint8Array();
    let text = "";
    for (let tries = 0; tries < 4; tries++) {
      text = await this.call<string>("text", "window");
      const shot = await this.cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, this.session);
      image = new Uint8Array(Buffer.from(shot.data, "base64"));
      if ((await this.call<string>("text", "window")) === text) break;
    }
    const { width } = await this.call<{ width: number; height: number }>("size");
    const page = (await this.evaluate<string | null>(this.options.pages.nameOf).catch(() => null)) ?? "";
    return { image, format: "png", page: page.trim(), width, text };
  }
}

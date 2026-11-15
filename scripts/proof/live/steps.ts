// Steps on Lumiverse's chat page, as a person takes them (PlanScenarios-3 items 1 and 9): choose the composer's
// connection by typing its name, switch the chat's persona, make a preset the active one, type a line and press
// Send, and watch the reply come. Each control is found by its words (Lumiverse's own strings: the composer's
// labels are `frontend/src/i18n/locales/en/chat.json`, its pickers' `panels.json`); a control that is not there
// stops the step naming it. What the source gives no words for (the drawer's tab button, the preset list's
// menu, which is a plain menu) is named where it is used. Every wait is on what the page shows.
//
// The page's moments (`browser/moments.ts`) are noted by an observer in the page itself and read back once the
// reply has ended; nothing here listens to a socket.

import type { BrowserDriver } from "../browser/driver";
import { MOMENTS_SCRIPT, type Noted } from "../browser/moments";

/** What the floor's `PageTimes` is (`scripts/testbed/floor-measure.ts`), made from what the page noted. */
export interface PageMoments {
  sent: number;
  firstThinking: number | null;
  firstWord: number | null;
  lastWord: number | null;
  ended: number | null;
  resolution: number;
}

/** Lumiverse's own words for the controls the steps use (`chat.json`, `panels.json`, English). */
export const WORDS = {
  message: "Message",
  send: "Send message",
  stop: "Stop generation",
  switchConnection: "Switch connection",
  connectionNow: "Connection:",
  searchConnections: "Search connections",
  persona: "Switch persona for this chat",
  searchPersonas: "Search personas",
  presetTab: "Preset",
} as const;

/** The drawer's open and close button has no words (an icon only): it is the button just before the drawer's own surface. */
const DRAWER_BUTTON = 'button:has(+ [data-lumiverse-surface="viewport-drawer"])';
const PRESET_TAB = 'button[data-tab-id="loom"]';

export class ChatSteps {
  constructor(private readonly tab: BrowserDriver) {}

  /** The text of what the page shows now (the composer's connection button says which connection it is on). */
  private async connectionButtonTitle(): Promise<string | null> {
    return await this.tab.evaluate<string | null>(`(() => { const b = document.querySelector('button[title^="Connection: "], button[title="${WORDS.switchConnection}"]'); return b === null ? null : b.getAttribute("title"); })()`);
  }

  /** Chooses the composer's connection: its menu opened, the name typed in its search field, the connection pressed, and the wait until the composer names it. */
  async chooseConnection(name: string): Promise<void> {
    if ((await this.connectionButtonTitle()) === `${WORDS.connectionNow} ${name}`) return;
    const title = await this.connectionButtonTitle();
    if (title === null) throw new Error(`no connection button in the composer (looked for one titled "${WORDS.switchConnection}" or "${WORDS.connectionNow} …")`);
    await this.tab.press({ label: title });
    await this.tab.type({ label: WORDS.searchConnections }, name);
    await this.tab.press({ role: "button", label: name });
    await this.tab.waitFor({ control: { label: `${WORDS.connectionNow} ${name}` } });
  }

  /** Switches the chat's persona to `name`: the persona menu opened, the name typed in its search field, the persona pressed. */
  async choosePersona(name: string): Promise<void> {
    await this.tab.press({ label: WORDS.persona });
    await this.tab.type({ label: WORDS.searchPersonas }, name);
    await this.tab.press({ role: "button", label: name });
    // The menu closes on the choice: the composer is back, and the persona's name shows beside the person's own messages when it next speaks.
    await this.tab.waitFor({ control: { label: WORDS.message } });
  }

  /** Makes the preset named `name` the active one: the drawer opened if its Preset tab is not in view, the tab pressed, the preset chosen in the panel's menu, and the drawer put back. */
  async choosePreset(name: string): Promise<void> {
    const inView = `(() => { const t = document.querySelector(${JSON.stringify(PRESET_TAB)}); if (t === null) return false; const r = t.getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight; })()`;
    const opened = !(await this.tab.evaluate<boolean>(inView));
    if (opened) await this.tab.pressSelector(DRAWER_BUTTON, "drawer's open button");
    await this.tab.pressSelector(PRESET_TAB, "drawer's Preset tab");
    const chosen = await this.tab.evaluate<boolean>(
      `(() => { const want = ${JSON.stringify(name)}.trim().toLowerCase(); const select = Array.from(document.querySelectorAll("select")).find((s) => Array.from(s.options).some((o) => (o.textContent ?? "").trim().toLowerCase() === want)); if (select === undefined) return false; select.selectedIndex = Array.from(select.options).findIndex((o) => (o.textContent ?? "").trim().toLowerCase() === want); select.dispatchEvent(new Event("input", { bubbles: true })); select.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`,
    );
    if (!chosen) throw new Error(`the Preset panel has no menu with a preset named ${name}`);
    await this.tab.waitFor({ text: name });
    if (opened) await this.tab.pressSelector(DRAWER_BUTTON, "drawer's close button");
  }

  /**
   * Types `line` in the composer and presses Send, and gives the page's own moments of the reply once it has ended:
   * the observer is put in the page before Send, and read back when the reply no longer streams. A reply that never
   * began, or never ended, is an error naming which, at the host's limit.
   */
  async send(line: string, replyLimitMs: number): Promise<PageMoments> {
    await this.tab.evaluate(MOMENTS_SCRIPT);
    await this.tab.evaluate(`window.__moments.arm()`);
    await this.tab.type({ label: WORDS.message }, line);
    await this.tab.press({ role: "button", label: WORDS.send });
    const end = Date.now() + replyLimitMs;
    let noted: Noted;
    for (;;) {
      noted = await this.tab.evaluate<Noted>(`window.__moments.read()`);
      if (noted.ended !== null) break;
      if (Date.now() > end) throw new Error(`the reply ${noted.sent === null ? "was never sent: Send was not pressed" : noted.reply === null ? "never began" : noted.firstWord === null ? "never showed a word" : "never ended"} within ${replyLimitMs} ms on the chat page`);
      await Bun.sleep(25);
    }
    await this.tab.evaluate(`window.__moments.disarm()`);
    if (noted.sent === null) throw new Error("the page noted no Send: the observer never saw the send button pressed");
    return { sent: noted.sent, firstThinking: noted.firstThinking, firstWord: noted.firstWord, lastWord: noted.lastWord, ended: noted.ended, resolution: noted.resolution };
  }
}

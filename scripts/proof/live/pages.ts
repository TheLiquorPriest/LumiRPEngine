// Lumiverse's own pages and RPE's, as the bed's driver opens them (PlanScenarios-3 items 1, 2 and 11): Lumiverse's
// sign-in and chat page at the instance's address, and RPE's web shell at RPE's own address (the same pages, the
// same sign-in and the same names as the rig's: `browser/web-shell.ts`). Every control is found by what a person
// sees (its label, its role, the words of its menu); the controls Lumiverse's source gives no words for are named
// where they are pressed, with the markup that finds them. A step that cannot find its control stops, naming it.
//
// Lumiverse is signed in to once for a run, as a person signs in at its login page: the sign-in the first window
// made is carried to each window after it, so a play never asks Lumiverse to sign in again (it lets 8 sign-ins in
// 5 minutes, `src/app.ts:258-262`) and every window is still a browser context of its own.

import type { Cookie, PageTab } from "../browser/driver";
import { isWebPage, openWebPage, WEB_NAME_OF } from "../browser/web-shell";
import type { Account } from "./env";

/** The name a screen of Lumiverse's chat page gives (what the floor's `CHAT_PAGE` names). */
export const LUMIVERSE_CHAT = "Lumiverse chat";
/** Lumiverse's own sign-in page. */
export const LUMIVERSE_SIGN_IN = "Lumiverse sign-in";

/**
 * The page's own name, whichever site it is: RPE's web shell by its heading, Lumiverse's chat page by its composer
 * (`InputArea.tsx:4278-4283`), its sign-in page by its two fields (`LoginPage.tsx:248-280`).
 */
export const LIVE_NAME_OF = `(() => {
  const rpe = ${WEB_NAME_OF};
  if (rpe.trim() !== "") return rpe;
  if (document.querySelector('textarea[name="chat-message"]') !== null) return ${JSON.stringify(LUMIVERSE_CHAT)};
  if (document.querySelector("input#username") !== null && document.querySelector("input#password") !== null) return ${JSON.stringify(LUMIVERSE_SIGN_IN)};
  return "";
})()`;

/** What a run's windows share: Lumiverse's sign-in, once made. */
export interface Shared {
  cookies: Cookie[] | null;
}

export interface LivePagesOptions {
  /** The instance's Lumiverse, as a browser opens it. */
  lumiverse: string;
  /** The user a window signs in as, when no window has yet. */
  account: Account;
  /** RPE's address and web key. */
  rpe: { base: string; token: string };
  /** The chat Lumiverse's chat page and RPE's chat pages are on now. */
  chat(): string | null;
  /** The turn the Turn page is on now. */
  turn(): string | null;
  shared: Shared;
  limitMs: number;
}

/** Whether a page is Lumiverse's chat page. */
export const isChatPage = (page: string): boolean => page.trim().toLowerCase() === LUMIVERSE_CHAT.toLowerCase();

async function until(what: string, limitMs: number, check: () => Promise<boolean>): Promise<void> {
  const end = Date.now() + limitMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`Lumiverse did not show ${what} within ${limitMs} ms`);
    await Bun.sleep(25);
  }
}

/** Opens a page of the bed in `tab`: Lumiverse's chat page (signing in first when asked), or one of RPE's. */
export async function openLivePage(page: string, tab: PageTab, options: LivePagesOptions): Promise<void> {
  if (isWebPage(page)) {
    await openWebPage(page, tab, { base: options.rpe.base, token: options.rpe.token, chat: options.chat, turn: options.turn, limitMs: options.limitMs });
    return;
  }
  if (!isChatPage(page)) throw new Error(`the bed has no page named ${page}: it has ${LUMIVERSE_CHAT} and RPE's pages`);
  const chat = options.chat();
  if (chat === null) throw new Error(`${LUMIVERSE_CHAT} is a chat's page, and the run has no chat to open`);
  const url = `${options.lumiverse}/chat/${encodeURIComponent(chat)}`;
  if (options.shared.cookies !== null) await tab.browser.setCookies(options.shared.cookies);
  await tab.goto(url);
  const shows = async (): Promise<string> => ((await tab.evaluate<string | null>(LIVE_NAME_OF).catch(() => null)) ?? "").trim();
  await until("its chat page or its sign-in", options.limitMs, async () => (await shows()) === LUMIVERSE_CHAT || (await shows()) === LUMIVERSE_SIGN_IN);
  if ((await shows()) === LUMIVERSE_SIGN_IN) {
    await tab.browser.type({ label: "Username" }, options.account.username);
    await tab.browser.type({ label: "Password" }, options.account.password);
    await tab.browser.press({ role: "button", label: "Sign In" });
    await until("the page after signing in", options.limitMs, async () => (await shows()) !== LUMIVERSE_SIGN_IN || (await tab.evaluate<boolean>(`location.pathname !== "/login"`)));
    options.shared.cookies = await tab.browser.cookies();
    await tab.goto(url);
    await until("its chat page", options.limitMs, async () => (await shows()) === LUMIVERSE_CHAT);
  }
  // One active window to an account: a second one is told so, and says to reload it.
  const inactive = await tab.evaluate<boolean>(`document.body.innerText.includes("This tab is inactive")`);
  if (inactive) throw new Error("Lumiverse says this window is inactive: another window is using the account (it keeps one active window to an account)");
}

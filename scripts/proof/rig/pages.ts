// RPE's web shell as the driver's `Pages` knows it (PlanScenarios-2 items 1 and 2): a page is named as
// the shell's own bar names it, its route is the address's fragment (`#/chats/<chat>/<page>`), and the
// web UI's token is typed into the sign-in field by the driver as a person does, once for each browser
// context. A page names itself by its heading, read from the page; a page is up when its heading is
// the one its route is owed, so a page that is still the one before is never taken for the next.

import type { PageTab } from "../browser/driver";

/** The heading the sign-in page has, and the field and button it is typed into and pressed on. */
const SIGN_IN = "Sign in to RPE";

/** What the web shell's pages are, by the name a form gives, and the heading each shows. */
const WEB_PAGES: Record<string, { fragment: (chat: string | null, turn: string | null) => string; heading: string; needs?: "chat" | "turn" }> = {
  chats: { fragment: () => "#/chats", heading: "Chats" },
  live: { fragment: (chat) => `#/chats/${encodeURIComponent(chat ?? "")}/live`, heading: "Live", needs: "chat" },
  turns: { fragment: (chat) => `#/chats/${encodeURIComponent(chat ?? "")}/turns`, heading: "Turns", needs: "chat" },
  turn: { fragment: (chat, turn) => `#/chats/${encodeURIComponent(chat ?? "")}/turns/${encodeURIComponent(turn ?? "")}`, heading: "Turn", needs: "turn" },
  world: { fragment: (chat) => `#/chats/${encodeURIComponent(chat ?? "")}/world`, heading: "World", needs: "chat" },
  cast: { fragment: (chat) => `#/chats/${encodeURIComponent(chat ?? "")}/cast`, heading: "Cast", needs: "chat" },
  story: { fragment: (chat) => `#/chats/${encodeURIComponent(chat ?? "")}/story`, heading: "Story", needs: "chat" },
  play: { fragment: (chat) => `#/chats/${encodeURIComponent(chat ?? "")}/play`, heading: "Play", needs: "chat" },
  build: { fragment: () => "#/build", heading: "Build" },
  files: { fragment: () => "#/files", heading: "Files" },
  connections: { fragment: () => "#/connections", heading: "Connections" },
  settings: { fragment: () => "#/settings", heading: "Settings" },
  storage: { fragment: () => "#/storage", heading: "Storage" },
  migration: { fragment: () => "#/migration", heading: "Migration" },
};

/** The page's own name: the heading of the page's body, or an empty text while it shows none. */
export const WEB_NAME_OF = "document.querySelector('.rpe-web-main .lre-page-title')?.textContent ?? ''";

/** Whether `page` is one the web shell has. */
export function isWebPage(page: string): boolean {
  return Object.hasOwn(WEB_PAGES, page.trim().toLowerCase());
}

export interface WebPagesOptions {
  /** RPE's address; the shell is served at `/ui/`. */
  base: string;
  /** The web UI's token (`rpe key web`). */
  token: string;
  /** The chat the chat's pages are on now. */
  chat(): string | null;
  /** The turn the Turn page is on now. */
  turn(): string | null;
  /** How long to wait for the shell to show what it was asked, in ms. */
  limitMs: number;
}

/** Opens a web shell page in `tab`: signing in first when the shell asks for its token, then going to the page's route, and waiting until the shell shows that page's heading. */
export async function openWebPage(page: string, tab: PageTab, options: WebPagesOptions): Promise<void> {
  const wanted = WEB_PAGES[page.trim().toLowerCase()];
  if (wanted === undefined) throw new Error(`the web shell has no page named ${page}: it has ${Object.values(WEB_PAGES).map((p) => p.heading).join(", ")}`);
  const chat = options.chat();
  const turn = options.turn();
  if (wanted.needs === "chat" && chat === null) throw new Error(`the ${page} page is a chat's, and the rig has no chat to show it for`);
  if (wanted.needs === "turn" && (chat === null || turn === null)) throw new Error(`the ${page} page shows one turn, and no turn has been named for it`);
  const shell = `${options.base}/ui/`;
  const here = await tab.evaluate<string>("location.href");
  if (!here.startsWith(shell)) await tab.goto(shell);
  const heading = async (): Promise<string> => ((await tab.evaluate<string | null>(WEB_NAME_OF).catch(() => null)) ?? "").trim();
  const until = async (what: string, check: () => Promise<boolean>): Promise<void> => {
    const end = Date.now() + options.limitMs;
    while (!(await check())) {
      if (Date.now() > end) throw new Error(`the web shell did not show ${what} within ${options.limitMs} ms`);
      await Bun.sleep(25);
    }
  };
  await until("a heading", async () => (await heading()) !== "");
  if ((await heading()) === SIGN_IN) {
    await tab.browser.type({ label: "Token" }, options.token);
    await tab.browser.press({ role: "button", label: "Sign in" });
    await until("the pages after sign-in", async () => (await heading()) !== SIGN_IN && (await heading()) !== "");
  }
  await tab.goto(`${shell}${wanted.fragment(chat, turn)}`);
  await until(`the ${wanted.heading} page`, async () => (await heading()) === wanted.heading);
}

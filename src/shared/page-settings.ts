// The page's own settings (plan §4.3, §14 "every limit can be edited here", Appendix D.1): how long a
// page waits for RPE's addresses and the extension's start-up facts, when it renews its token, how it
// tries a closed socket again, and how it follows a request the relay could not answer in one go. They
// are settings of RPE's own, declared once here and listed in the registry (`src/app/page-settings.ts`);
// the page reads them from RPE: the extension hands the whole group with its start-up facts (the page
// cannot call RPE before it has found a road), and the settings route lists them for the web shell.
// Until the page has them it uses the defaults below, and for the start wait, which governs the wait
// for the very facts that carry the group, the value RPE last gave it, kept by the browser (ui-settings).

/** One of the page's settings: its key as a config file writes it, its default and bounds (milliseconds, or a count where its words say so), and its words. */
export interface PageSettingDef {
  readonly key: string;
  readonly default: number;
  readonly least: number;
  readonly most: number;
  readonly name: string;
  readonly about: string;
}

export const PAGE_SETTING_DEFS = {
  probeMs: { key: "pages.probeMs", default: 3000, least: 100, most: 60_000, name: "Page waits for a direct address", about: "Milliseconds a page in Lumiverse waits for each of RPE's addresses to answer it directly, before it takes the road through the extension." },
  startMs: { key: "pages.startMs", default: 35_000, least: 1000, most: 600_000, name: "Page waits for the extension's start-up facts", about: "Milliseconds a page in Lumiverse waits for the extension's start-up facts. The page keeps the last value RPE gave it in the browser, and holds it from its next start." },
  renewAheadMs: { key: "pages.renewAheadMs", default: 60_000, least: 1000, most: 3_600_000, name: "Page token renewed ahead", about: "Milliseconds before a page token runs out that the page asks for a new one (never later than half the token's life)." },
  reconnectMs: { key: "pages.reconnectMs", default: 1000, least: 100, most: 60_000, name: "Page's first reconnect wait", about: "Milliseconds a page waits before it opens the live socket again after it closed, or asks again for a page token it could not have; each failure doubles the wait." },
  reconnectMaxMs: { key: "pages.reconnectMaxMs", default: 30_000, least: 1000, most: 600_000, name: "Page's longest reconnect wait", about: "Milliseconds at most a page waits between tries at the live socket or at a new page token." },
  jobPollMs: { key: "pages.jobPollMs", default: 1000, least: 100, most: 60_000, name: "Page asks after a long request", about: "Milliseconds between a page's asks for the answer of a request that RPE took in hand and answered by an id, such as a connection test the relay could not wait for, and between the Runtime page's reads of the builds while an update goes through its stages." },
  tickMs: { key: "pages.tickMs", default: 1000, least: 100, most: 60_000, name: "Page's running clocks tick", about: "Milliseconds between the redraws of a running timer on a page." },
  redrawMs: { key: "pages.redrawMs", default: 100, least: 10, most: 10_000, name: "Live and Turn pages redraw at most every", about: "Milliseconds at most between redraws of a watched turn on the Live and Turn pages while it streams; what a read of it gives shows at once." },
  keepRuns: { key: "pages.keepRuns", default: 4, least: 1, most: 100, name: "Runs the Live page keeps", about: "Runs of a chat the Live page holds at once; once more have ended than this, the oldest ended is let go, named with a link to its Turn page." },
  keepFailures: { key: "pages.keepFailures", default: 20, least: 1, most: 500, name: "Handler failures the Live page keeps", about: "Handler failures told to a chat that the Live page holds at once; once more have come than this, the oldest is let go. A failure stays on the page until it is dismissed." },
  turnsAtATime: { key: "pages.turnsAtATime", default: 30, least: 1, most: 500, name: "Turns read at a time", about: "Turns the Turns list and the World page's turn picker read from RPE at a time, and the carried turns the Turns page reads beside them (RPE gives at most 500)." },
  folderEntries: { key: "pages.folderEntries", default: 200, least: 10, most: 1000, name: "Files shown per page of a folder", about: "Entries of a folder the Files page reads from RPE at a time; more are read on request." },
  filePieceBytes: { key: "pages.filePieceBytes", default: 65_536, least: 1024, most: 4_194_304, name: "Bytes of a file read per piece", about: "Bytes of a file the Files page reads from RPE at a time, so a file of any size opens its first piece at once and goes on when asked." },
  chatsAtATime: { key: "pages.chatsAtATime", default: 50, least: 1, most: 500, name: "Chats read at a time on Storage", about: "Chats the Storage page reads from RPE at a time, each with what its folder and its rows of the database take." },
  logLines: { key: "pages.logLines", default: 200, least: 10, most: 2000, name: "Log lines shown per page on Runtime", about: "Lines of RPE's own log the Runtime page reads at a time, the newest first; older lines are read on request (RPE keeps service.logLines of them)." },
  rowsAtOnce: { key: "pages.rowsAtOnce", default: 30, least: 5, most: 500, name: "Rows read at once", about: "Rows the Sessions, Rules and Lore pages' lists read from RPE at a time (sessions and their turns, firings of a rule, proposals and writes to his lore); more are read on request." },
  toastsShown: { key: "pages.toastsShown", default: 3, least: 1, most: 20, name: "Toasts shown at once", about: "Toasts the kept views (Build, Play, the chat's toolbar) show at once; a new one pushes the oldest out." },
  errorToastMs: { key: "pages.errorToastMs", default: 6000, least: 500, most: 120_000, name: "An error toast shows for", about: "Milliseconds an error toast shows in the kept views." },
  toastMs: { key: "pages.toastMs", default: 3500, least: 500, most: 120_000, name: "Any other toast shows for", about: "Milliseconds any other toast shows in the kept views." },
  downloadRevokeMs: { key: "pages.downloadRevokeMs", default: 1000, least: 100, most: 60_000, name: "A download link is kept for", about: "Milliseconds the kept views keep a download's link before the browser lets it go." },
  previewWaitMs: { key: "pages.previewWaitMs", default: 300, least: 50, most: 10_000, name: "Wait after typing before a prompt part is rendered again", about: "Milliseconds the Files page waits after he stops typing in a prompt part before it asks RPH to render the draft again for its preview." },
  briefChars: { key: "pages.briefChars", default: 90, least: 20, most: 2000, name: "Characters of a job's brief shown in the Jobs list", about: "Characters of a job's brief the Jobs list shows on its line before it cuts the rest with an ellipsis; the job open shows its brief whole." },
  titleChars: { key: "pages.titleChars", default: 60, least: 20, most: 500, name: "Characters of a scene's name shown on Sessions", about: "Characters of a scene's name (its name, title or summary in the story record) the Sessions list shows before it cuts the rest with an ellipsis." },
  messagesAtOnce: { key: "pages.messagesAtOnce", default: 100, least: 1, most: 1000, name: "Messages read at once for the Story timeline", about: "Messages whose text the Story timeline asks Lumiverse's door for in one read, for the beats it has listed; the rest are read straight after." },
} as const satisfies Record<string, PageSettingDef>;

/** The page's settings by the name the page reads each under; every value is a whole number: milliseconds, or a count where the setting's words say so. */
export type PageSettings = { readonly [K in keyof typeof PAGE_SETTING_DEFS]: number };

export const PAGE_DEFAULTS: PageSettings = Object.freeze(Object.fromEntries(Object.entries(PAGE_SETTING_DEFS).map(([name, def]) => [name, def.default])) as { [K in keyof typeof PAGE_SETTING_DEFS]: number });

/** The group's keys as the settings route and the start-up facts hold them. */
export const PAGE_KEY_PREFIX = "pages.";

/**
 * The page's settings from what RPE gave: a mapping from each setting's key to its value (the start-up
 * facts' group, or the settings route's entries made into one). A key that is missing, or whose value is
 * not a whole number within its bounds, is the default: the page never waits on a value it cannot read.
 */
export function pageSettingsOf(given: unknown): PageSettings {
  const from = typeof given === "object" && given !== null ? (given as Record<string, unknown>) : {};
  const out: Record<string, number> = {};
  for (const [name, def] of Object.entries(PAGE_SETTING_DEFS)) {
    const value = from[def.key];
    out[name] = typeof value === "number" && Number.isSafeInteger(value) && value >= def.least && value <= def.most ? value : def.default;
  }
  return out as { [K in keyof typeof PAGE_SETTING_DEFS]: number };
}

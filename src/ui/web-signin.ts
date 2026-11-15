// How the web shell signs in (plan §4.4; READINGS R-8, R-57): it takes the token `rpe up` printed, or a
// Lumiverse account's username and password, and trades either for a session. The browser keeps the
// session, which ends at its time, and never the printed token nor a password. A page that is open
// renews its session before it ends, for as long as it is open; one that was closed past the session's
// end asks for a sign-in again. A key an earlier build's web shell kept is traded for a session when the
// page loads, and let go.

import type { ApiRoutes } from "../shared/api";
import { isRecord } from "../shared/json";
import type { TokenStore } from "./client";
import type { RoadDeps } from "./roads";
import type { UiSettings } from "./ui-settings";

/** A route's path as the route table writes it: named by its key, so a route renamed or removed fails the build here. */
function pathOfRoute(key: keyof ApiRoutes & string): string {
  return key.slice(key.indexOf(" ") + 1);
}

const TRADE_PATH = pathOfRoute("POST /api/v1/signin/session");
const ACCOUNT_PATH = pathOfRoute("POST /api/v1/signin/lumiverse");
const SIGNOUT_PATH = pathOfRoute("POST /api/v1/signin/end");

/** Where this browser keeps when its session ends, beside the session itself (`TOKEN_KEY`). */
export const ENDS_KEY = "rpe:web-session-ends";

/** What the sign-in routes answer: the session, when it ends. */
interface Opened {
  session: string;
  ends: number;
}

function readOpened(text: string): Opened | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  return isRecord(body) && typeof body.session === "string" && typeof body.ends === "number" ? { session: body.session, ends: body.ends } : null;
}

/** RPE's own words for a refusal, or what it answered. */
function refusalWords(status: number, text: string): string {
  try {
    const body: unknown = JSON.parse(text);
    if (isRecord(body) && typeof body.error === "string") return body.error;
  } catch {
    // Not JSON: said by its status below.
  }
  return `RPE answered ${status}.`;
}

export interface Sessions {
  /** Takes the printed token, trades it for a session and keeps the session; rejects, in RPE's words, when RPE does not take it. */
  withToken(printed: string): Promise<void>;
  /** Signs in with a Lumiverse account, which RPE checks against Lumiverse and takes for its own user; the password is sent once and kept nowhere. */
  withAccount(username: string, password: string): Promise<void>;
  /** Ends the session in RPE, and lets it go here. */
  signOut(): Promise<void>;
  /** Looks at what the browser kept: a key kept by an earlier build is traded, a session past its end is let go, and the renewal of one still in time is begun. */
  resume(): Promise<void>;
  /** Stops renewing. */
  stop(): void;
}

/**
 * The web shell's sessions, over its token store (which the client reads each credential from) and the
 * storage that also keeps when the session ends. `changed` is told when the session was let go or
 * replaced by something the page must act on (the sign-in form, back).
 */
export function createSessions(base: string, tokens: TokenStore, storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null, deps: RoadDeps, settings: UiSettings, changed: () => void): Sessions {
  let timer: unknown = null;
  let stopped = false;

  const keptEnd = (): number | null => {
    try {
      const text = storage?.getItem(ENDS_KEY) ?? null;
      return text !== null && /^\d+$/.test(text) ? Number(text) : null;
    } catch {
      return null;
    }
  };
  const keepEnd = (ends: number | null): void => {
    try {
      if (ends === null) storage?.removeItem(ENDS_KEY);
      else storage?.setItem(ENDS_KEY, String(ends));
    } catch {
      // Kept for this page only.
    }
  };

  const call = (path: string, bearer: string | null, body: unknown): Promise<{ status: number; text(): Promise<string> }> =>
    deps.fetch(new URL(path, base).toString(), { method: "POST", headers: { accept: "application/json", "content-type": "application/json", ...(bearer === null ? {} : { authorization: `Bearer ${bearer}` }) }, body: JSON.stringify(body) });

  const letGo = (): void => {
    if (timer !== null) deps.timers.clearTimeout(timer);
    timer = null;
    tokens.set(null);
    keepEnd(null);
  };

  /** Keeps the session, and renews it before it ends: at the page setting's time ahead, and never later than half of what is left. */
  function adopt(opened: Opened): void {
    tokens.set(opened.session);
    keepEnd(opened.ends);
    if (timer !== null) deps.timers.clearTimeout(timer);
    const left = Math.max(0, opened.ends - deps.timers.now());
    const wait = Math.max(0, Math.min(left - settings.values.get().renewAheadMs, left / 2));
    timer = deps.timers.setTimeout(() => void renew(), wait);
  }

  async function renew(): Promise<void> {
    timer = null;
    const held = tokens.get();
    if (stopped || held === null) return;
    const answer = await call(TRADE_PATH, held, {}).catch(() => null);
    const opened = answer?.status === 200 ? readOpened(await answer.text()) : null;
    if (opened !== null) return adopt(opened);
    // RPE is not answering (a restart, say): the session is asked for again, as long as it is in time.
    if (answer === null || answer.status >= 500) {
      const end = keptEnd();
      if (end !== null && end > deps.timers.now()) timer = deps.timers.setTimeout(() => void renew(), settings.values.get().reconnectMs);
      else {
        letGo();
        changed();
      }
      return;
    }
    // RPE does not take the session any more: it ended, or a new key replaced the one it came from.
    letGo();
    changed();
  }

  async function open(path: string, bearer: string | null, body: unknown): Promise<void> {
    const answer = await call(path, bearer, body);
    const text = await answer.text();
    const opened = answer.status === 200 ? readOpened(text) : null;
    if (opened === null) throw new Error(refusalWords(answer.status, text));
    adopt(opened);
  }

  return {
    withToken: (printed) => open(TRADE_PATH, printed, {}),
    withAccount: (username, password) => open(ACCOUNT_PATH, null, { username, password }),
    async signOut() {
      const held = tokens.get();
      letGo();
      if (held !== null) await call(SIGNOUT_PATH, held, {}).catch(() => null);
    },
    async resume() {
      const held = tokens.get();
      if (held === null) return;
      const end = keptEnd();
      // A key an earlier build's web shell kept: it is traded for a session now, and the key is let go.
      if (end === null) {
        const answer = await call(TRADE_PATH, held, {}).catch(() => null);
        const opened = answer?.status === 200 ? readOpened(await answer.text()) : null;
        if (opened !== null) adopt(opened);
        else if (answer !== null && answer.status < 500) letGo();
        return;
      }
      if (end <= deps.timers.now()) {
        letGo();
        return;
      }
      adopt({ session: held, ends: end });
    },
    stop() {
      stopped = true;
      if (timer !== null) deps.timers.clearTimeout(timer);
      timer = null;
    },
  };
}

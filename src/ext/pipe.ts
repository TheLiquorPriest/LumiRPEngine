// The extension's pipe between RPE and a Lumiverse page that cannot reach RPE directly (STANDALONE-PLAN
// §4.3): it holds no logic of its own. What it carries:
// - RPE's registration, sent on RPE's relay socket each time it opens: kept once RPE confirms it
//   (`registration.ts`), and answered to the socket it came from: taken, with what the extension is
//   missing, or refused and why;
// - a page's start: RPE's start-up facts (its addresses, its build, a short-lived page token), asked of
//   RPE's start route and handed to that page alone;
// - a page's request: carried to RPE's API through Spindle's proxy (one request, one whole answer, 30 s,
//   25 MB: `worker-host.ts:4647-4741`) and answered to that page alone;
// - a page's follow of a chat: told to RPE's live route; RPE's live frames for that page come back on
//   its relay socket and go to that page alone (`sendToFrontend` with its frontend session,
//   `worker-host.ts:2129-2160`), never to every socket of the user, RPE's own among them;
// - a page gone: Lumiverse says so (`FRONTEND_SESSION_CLOSED`, `ws/handler.ts:198-203`), and RPE stops
//   following for it.
// Only the user RPE registered for is served: anyone else's page is told RPE does not belong to them.

import { isRecord } from "../shared/json";
import { LIVE_PATH, readFromPage, readFromRpe, readStartFacts, START_PATH, type MissingPermission, type PipeRequest, type ToPage, type ToRpe } from "../adapter/lumiverse/pipe-wire";
import type { Registrations } from "./registration";
import type { Road } from "./road";
import type { ExtSpindle } from "./spindle";

/** What a page may send with its request: everything else is the pipe's to set. */
const PAGE_HEADERS = ["authorization", "content-type", "accept", "if-none-match"];
/** What of RPE's answer goes back to the page. */
const ANSWER_HEADERS = ["content-type", "etag", "cache-control"];

export interface PipeDeps {
  spindle: ExtSpindle;
  registrations: Registrations;
  /** What the extension is missing now. */
  missing(): MissingPermission[];
  /** The extension's own build, said to RPE when it takes RPE's registration: an update of the extension brings RPE's new app file. */
  build: string;
  log(message: string): void;
  /** RPE registered for this user. */
  registered(user: string): void;
  /** A registration from this user's socket was refused. */
  refused(user: string): void;
}

export interface Pipe {
  /** Tells RPE and every page that started what the extension is missing now. */
  permissions(): void;
  stop(): void;
}

const words = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function startPipe(deps: PipeDeps): Pipe {
  const { spindle } = deps;
  /** The pages of each user that started or followed: told of permissions, and of a page gone. */
  const pages = new Map<string, Set<string>>();
  const seen = (user: string, page: string): void => {
    const set = pages.get(user) ?? new Set();
    set.add(page);
    pages.set(user, set);
  };
  const toPage = (user: string, page: string, message: ToPage): void => spindle.sendToFrontend(message, user, { frontendSessionId: page });
  const toRpe = async (user: string, message: ToRpe): Promise<void> => {
    const r = await deps.registrations.of(user);
    if (r !== null) spindle.sendToFrontend(message, user, { frontendSessionId: r.relay });
  };

  /** One call to RPE through Spindle's proxy, as JSON. */
  const call = async (road: Road, path: string, body: unknown): Promise<{ status: number; body: unknown }> => {
    const res = await spindle.cors(`${road.base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...road.headers }, body: JSON.stringify(body) });
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(res.body ?? "");
    } catch {
      // Not JSON: the status says what happened.
    }
    return { status: res.status, body: parsed };
  };

  const refusedWords = "RPE does not belong to your Lumiverse user, or it has not connected to Lumiverse yet.";

  async function start(user: string, page: string): Promise<void> {
    seen(user, page);
    const road = await deps.registrations.road(user);
    if (road === null) return toPage(user, page, { rpe: "start", facts: null, error: refusedWords, missing: deps.missing() });
    try {
      const answer = await call(road, START_PATH, {});
      const facts = answer.status === 200 ? readStartFacts(answer.body) : null;
      const error = facts !== null ? undefined : isRecord(answer.body) && typeof answer.body.error === "string" ? answer.body.error : `RPE answered ${answer.status}.`;
      toPage(user, page, { rpe: "start", facts, ...(error !== undefined ? { error } : {}), missing: deps.missing() });
    } catch (error) {
      toPage(user, page, { rpe: "start", facts: null, error: `RPE was not reached through Lumiverse: ${words(error)}`, missing: deps.missing() });
    }
  }

  async function request(user: string, page: string, req: PipeRequest): Promise<void> {
    const answer = (status: number, body: string, headers: Record<string, string> = { "content-type": "application/json" }): void => toPage(user, page, { rpe: "response", id: req.id, status, headers, body });
    const road = await deps.registrations.road(user);
    if (road === null) return answer(403, JSON.stringify({ error: refusedWords }));
    let url: URL;
    try {
      url = new URL(req.path, road.base);
    } catch {
      return answer(400, JSON.stringify({ error: "That is not a path of RPE's API." }));
    }
    // A page reaches RPE's API, and not the routes only the extension may call.
    if (url.origin !== new URL(road.base).origin || !url.pathname.startsWith("/api/v1/") || url.pathname.startsWith("/api/v1/ext/")) return answer(400, JSON.stringify({ error: "That is not a path of RPE's API." }));
    // The page's own credential (its page token) and nothing of the extension's: RPE answers it as the page.
    const headers: Record<string, string> = {};
    for (const name of PAGE_HEADERS) if (req.headers[name] !== undefined) headers[name] = req.headers[name];
    try {
      const res = await spindle.cors(url.toString(), { method: req.method, headers, ...(req.body !== undefined ? { body: req.body } : {}) });
      const back: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers ?? {})) if (ANSWER_HEADERS.includes(k.toLowerCase())) back[k.toLowerCase()] = v;
      answer(res.status, res.body ?? "", back);
    } catch (error) {
      answer(502, JSON.stringify({ error: `RPE was not reached through Lumiverse: ${words(error)}` }));
    }
  }

  async function follow(user: string, page: string, chat: string, on: boolean): Promise<void> {
    seen(user, page);
    const road = await deps.registrations.road(user);
    if (road === null) return toPage(user, page, { rpe: "following", chat, error: refusedWords });
    try {
      const answer = await call(road, LIVE_PATH, { page, chat, follow: on });
      toPage(user, page, { rpe: "following", chat, ...(answer.status === 200 ? {} : { error: isRecord(answer.body) && typeof answer.body.error === "string" ? answer.body.error : `RPE answered ${answer.status}.` }) });
    } catch (error) {
      toPage(user, page, { rpe: "following", chat, error: `RPE was not reached through Lumiverse: ${words(error)}` });
    }
  }

  const offMessage = spindle.onFrontendMessage((payload, user, session) => {
    const fromRpe = readFromRpe(payload);
    if (fromRpe !== null) {
      void (async () => {
        if (fromRpe.rpe === "register") {
          // Answered to the socket it came from, whatever it is: a refusal tells RPE why, and nothing to anyone else.
          if (session === undefined) return;
          const refused = session !== fromRpe.registration.relay ? "it came from another socket than the one it names as RPE's." : await deps.registrations.keep(user, fromRpe.registration);
          if (refused !== null) {
            deps.log(`a registration for user ${user} was refused: ${refused}`);
            spindle.sendToFrontend({ rpe: "refused", why: refused, missing: deps.missing() } satisfies ToRpe, user, { frontendSessionId: session });
            deps.refused(user);
            return;
          }
          await toRpe(user, { rpe: "registered", missing: deps.missing(), build: deps.build });
          deps.registered(user);
          return;
        }
        // A live frame is RPE's when it carries the registration's key, and goes to the one page it names.
        const r = await deps.registrations.of(user);
        if (r === null || r.key !== fromRpe.key) return;
        const { rpe: _rpe, key: _key, page, ...frame } = fromRpe;
        toPage(user, page, { rpe: "live", ...frame });
      })().catch((error: unknown) => deps.log(`a message from RPE was not handled: ${words(error)}`));
      return;
    }
    const fromPage = readFromPage(payload);
    if (fromPage === null || session === undefined) return;
    const work = fromPage.rpe === "start" ? start(user, session) : fromPage.rpe === "request" ? request(user, session, fromPage) : follow(user, session, fromPage.chat, fromPage.rpe === "follow");
    work.catch((error: unknown) => deps.log(`a page's message was not handled: ${words(error)}`));
  });

  const offClosed = spindle.on("FRONTEND_SESSION_CLOSED", (payload, user) => {
    if (user === undefined || !isRecord(payload) || typeof payload.frontendSessionId !== "string") return;
    const page = payload.frontendSessionId;
    if (pages.get(user)?.delete(page) !== true) return;
    void (async () => {
      const road = await deps.registrations.road(user);
      if (road !== null) await call(road, LIVE_PATH, { page, gone: true });
    })().catch((error: unknown) => deps.log(`RPE was not told a page closed: ${words(error)}`));
  });

  return {
    permissions() {
      const missing = deps.missing();
      for (const user of deps.registrations.users()) {
        void toRpe(user, { rpe: "permissions", missing });
        for (const page of pages.get(user) ?? []) toPage(user, page, { rpe: "permissions", missing });
      }
    },
    stop() {
      offMessage();
      offClosed();
    },
  };
}

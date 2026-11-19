// The extension's pipe between RPE and a Lumiverse page that cannot reach RPE directly (STANDALONE-PLAN
// §4.3): it holds no logic of its own. What it carries:
// - RPE's registration, sent on RPE's relay socket each time it opens: kept once RPE confirms it
//   (`registration.ts`), and answered to the socket it came from: taken, with what the extension is
//   missing, or refused and why; once taken, each page of the user is told RPE started again, so it
//   follows again and reads afresh;
// - a page's start: RPE's start-up facts (its addresses, its build, a short-lived page token), asked of
//   RPE's start route and handed to that page alone;
// - a page's request: carried to RPE's API through Spindle's proxy (one request, one whole answer, 30 s,
//   25 MB: `worker-host.ts:4647-4741`) and answered to that page alone; what the proxy refuses (an answer
//   over its size, a path naming a JavaScript file, a JavaScript answer: `worker-host.ts:772`,
//   `utils/safe-fetch.ts:448-450`, `:495-504`) is told to the page as such, and a request that did not
//   reach RPE at all as unreached, with why;
// - a generation the extension stopped because it could not tell whose chat it was: its record, told to
//   RPE on its road, or once RPE registers again where the road was not known;
// - a page's follow of a chat: told to RPE's live route; RPE's live frames for that page come back on
//   its relay socket and go to that page alone (`sendToFrontend` with its frontend session,
//   `worker-host.ts:2129-2160`), never to every socket of the user, RPE's own among them;
// - a page gone: Lumiverse says so (`FRONTEND_SESSION_CLOSED`, `ws/handler.ts:198-203`), and RPE stops
//   following for it;
// - a page's ask that Lumiverse's drawer close (`spindle.ui.closeDrawer`): answered to that page, closed or not.
// Only the user RPE registered for is served: anyone else's page is told RPE does not belong to them.

import { isRecord } from "../shared/json";
import { ARRIVED_PATH, LIVE_PATH, readFromPage, readFromRpe, readStartFacts, START_PATH, STOPPED_PATH, type CheckStopped, type MissingPermission, type PipeRequest, type ToPage, type ToRpe } from "../adapter/lumiverse/pipe-wire";
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
  /** The extension's own build, said to RPE when it takes RPE's registration. */
  build: string;
  /** The hash the build stated for the app file in the extension's folder (R-12), told to RPE once RPE is first registered in this worker's life; null run from source, with no app file. */
  statedHash: string | null;
  log(message: string): void;
  /** RPE registered for this user. */
  registered(user: string): void;
  /** A registration from this user's socket was refused. */
  refused(user: string): void;
}

export interface Pipe {
  /** Tells RPE and every page that started what the extension is missing now. */
  permissions(): void;
  /** A generation stopped because whose chat it was could not be told: logged, and told to RPE. */
  stopped(user: string, record: CheckStopped): void;
  stop(): void;
}

const words = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A path Lumiverse's proxy refuses to carry, as it tells one (`utils/safe-fetch.ts:67-73`): one naming a JavaScript file. */
const JAVASCRIPT_PATH = /\.(?:js|mjs|cjs|es)(?:[;/\\]|$)/i;
/** How Lumiverse's proxy says an answer was too large for it: its own words (`worker-host.ts:4676-4679`, `:784-788`), and its fetch's (`utils/safe-fetch.ts:538`), which come first for an answer that declares its length. */
const TOO_LARGE = /CORS proxy response (too large|exceeded)|Response too large/;

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
    const r = await deps.registrations.of(user).catch(() => null);
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
    let decoded = url.pathname;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      // Not decodable: read as it stands.
    }
    if (JAVASCRIPT_PATH.test(decoded)) return answer(400, JSON.stringify({ error: "Lumiverse's proxy does not carry a path that names a JavaScript file; ask RPE directly." }));
    // The page's own credential (its page token) and nothing of the extension's: RPE answers it as the page.
    const headers: Record<string, string> = {};
    for (const name of PAGE_HEADERS) if (req.headers[name] !== undefined) headers[name] = req.headers[name];
    try {
      const res = await spindle.cors(url.toString(), { method: req.method, headers, ...(req.body !== undefined ? { body: req.body } : {}) });
      const back: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.headers ?? {})) if (ANSWER_HEADERS.includes(k.toLowerCase())) back[k.toLowerCase()] = v;
      answer(res.status, res.body ?? "", back);
    } catch (error) {
      // An answer too large for the proxy: the page asks for it another way (a job's id, R-4).
      if (TOO_LARGE.test(words(error))) return answer(413, JSON.stringify({ error: `RPE's answer is larger than Lumiverse's proxy carries (${words(error)}).` }));
      // Not reached at all (RPE stopped, or restarts on an update): no answer of RPE's, so the page finds RPE again and reads afresh.
      toPage(user, page, { rpe: "unreached", id: req.id, error: `RPE was not reached through Lumiverse: ${words(error)}` });
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

  /** Lumiverse's drawer closed for the page that asked: whether it closed is told to that page by the ask's id; why not, to the log. */
  async function drawer(user: string, page: string, id: string): Promise<void> {
    try {
      await spindle.ui.closeDrawer({ userId: user });
      toPage(user, page, { rpe: "drawer", id, closed: true });
    } catch (error) {
      deps.log(`Lumiverse's drawer was not closed for a page: ${words(error)}`);
      toPage(user, page, { rpe: "drawer", id, closed: false });
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
          // RPE started again (an update among the reasons): what it followed for each page went with it, so each follows again and reads afresh.
          for (const page of pages.get(user) ?? []) toPage(user, page, { rpe: "restarted" });
          const record = untold.get(user);
          if (record !== undefined) tell(user, record);
          if (deps.statedHash !== null && !arrivedTold.has(user)) {
            arrivedTold.add(user);
            arrived(user, deps.statedHash);
          }
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
    const work =
      fromPage.rpe === "start" ? start(user, session) : fromPage.rpe === "request" ? request(user, session, fromPage) : fromPage.rpe === "drawer" ? drawer(user, session, fromPage.id) : follow(user, session, fromPage.chat, fromPage.rpe === "follow");
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

  /** The users RPE was told, in this worker's life, which app file the extension carries. */
  const arrivedTold = new Set<string>();
  /** The update's word on the extension's road (§4.3 l.288): the app file in its folder, by the hash the build stated for it; RPE's update does the rest. */
  const arrived = (user: string, hash: string): void => {
    void (async () => {
      const road = await deps.registrations.road(user);
      if (road === null) return;
      const answer = await call(road, ARRIVED_PATH, { hash });
      const said = isRecord(answer.body) && typeof answer.body.words === "string" ? answer.body.words : `RPE answered ${answer.status}.`;
      deps.log(`RPE was told the app file this extension carries${isRecord(answer.body) && answer.body.taken === true ? ", and took it" : ""}: ${said}`);
    })().catch((error: unknown) => {
      arrivedTold.delete(user);
      deps.log(`RPE was not told the app file this extension carries: ${words(error)}`);
    });
  };

  /** By user: the latest stopped generation's record RPE has not been told (its road was not known, or the call failed); the ones before it are in the extension's log. */
  const untold = new Map<string, CheckStopped>();
  const tell = (user: string, record: CheckStopped): void => {
    void (async () => {
      const road = await deps.registrations.road(user);
      if (road === null) {
        untold.set(user, record);
        return;
      }
      const answer = await call(road, STOPPED_PATH, record);
      if (answer.status !== 200) throw new Error(`RPE answered ${answer.status}`);
      if (untold.get(user) === record) untold.delete(user);
    })().catch((error: unknown) => {
      untold.set(user, record);
      deps.log(`RPE was not told of the generation stopped in chat ${record.chat}: ${words(error)}`);
    });
  };

  return {
    permissions() {
      const missing = deps.missing();
      for (const user of deps.registrations.users()) {
        void toRpe(user, { rpe: "permissions", missing });
        for (const page of pages.get(user) ?? []) toPage(user, page, { rpe: "permissions", missing });
      }
    },
    stopped(user, record) {
      deps.log(`generation ${record.generation ?? "(not announced)"} of chat ${record.chat} on connection ${record.connection} was stopped: the extension could not tell whether it is RPE's. The registration's read: ${record.registration}. The connection's record: ${record.mark}.`);
      tell(user, record);
    },
    stop() {
      offMessage();
      offClosed();
    },
  };
}

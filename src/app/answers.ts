// Long requests on the relay (plan §4.3, R-4): a page reaches RPE through Lumiverse's relay, whose proxy gives up after 30
// seconds, so a route that may take longer says so (`long`), and the server answers a page's call to it at once, status 202,
// with `{ answer: <id> }` and nothing else. The work goes on; its answer, the route's own status and body, is kept here and read
// from one route, `GET /api/v1/answers/:id`: while the work runs it answers the same 202 and id, once it is done it gives the
// answer once, and an id it does not hold (never given, read already, or dropped) is 404. An answer never read is dropped
// `server.answerKeepSeconds` after it was ready. Work that answers at once by naming its own run or job (Settle now, bootstrap)
// goes on doing so; this is for the rest.

import { randomBytes } from "node:crypto";
import { rawRoute } from "./routes";

/** The status a long route's call is answered with at once, and its answers route while the work runs. */
export const ANSWER_STATUS = 202;
/** Where a long route's answer is read, by its id: `GET /api/v1/answers/:id`. */
export const ANSWERS_PATH = "/api/v1/answers";

/** An answer once its work is done: the route's own status, headers and body. */
interface Ready {
  status: number;
  headers: Headers;
  body: ArrayBuffer;
  drop: Timer;
}

/** What the answer route and a long call answer while the work runs: the id alone. */
function pending(id: string): Response {
  return Response.json({ answer: id }, { status: ANSWER_STATUS, headers: { "cache-control": "no-store" } });
}

/** The answers of long requests, kept for reading by id. */
export class Answers {
  readonly #running = new Set<string>();
  readonly #ready = new Map<string, Ready>();

  constructor(
    /** How long a ready answer is kept for reading (`server.answerKeepSeconds`), in milliseconds. */
    private readonly keepMs: number,
  ) {}

  /** How many answers are kept now for their pages to read. */
  get size(): number {
    return this.#ready.size;
  }

  /** Takes `work` in hand and answers at once with its id; its response is kept for reading once it is done. */
  start(work: Promise<Response>): Response {
    const id = randomBytes(16).toString("hex");
    this.#running.add(id);
    void work.then(async (response) => {
      const body = await response.arrayBuffer();
      if (!this.#running.delete(id)) return;
      const drop = setTimeout(() => this.#ready.delete(id), this.keepMs);
      drop.unref();
      this.#ready.set(id, { status: response.status, headers: new Headers(response.headers), body, drop });
    });
    return pending(id);
  }

  /** The answer of `id`: 202 while its work runs, its own response once (then forgotten), null for an id not held. */
  read(id: string): Response | null {
    if (this.#running.has(id)) return pending(id);
    const ready = this.#ready.get(id);
    if (ready === undefined) return null;
    this.#ready.delete(id);
    clearTimeout(ready.drop);
    return new Response(ready.body, { status: ready.status, headers: ready.headers });
  }

  /** Forgets every answer: RPE is stopping. */
  close(): void {
    this.#running.clear();
    for (const ready of this.#ready.values()) clearTimeout(ready.drop);
    this.#ready.clear();
  }
}

/** The route a long request's answer is read from. */
export function answersRoute(answers: Answers) {
  return rawRoute({
    method: "GET",
    path: `${ANSWERS_PATH}/:id`,
    access: "page",
    group: "service",
    does: "The answer of a request to a long route, by the id it was answered with: the same 202 and id while its work runs, then the route's own answer, once.",
    answers: "202 with `{ answer: <id> }` while the work runs; then the route's own status and body, once; 404 for an id RPE does not hold",
    raw: (_request, { params }) => answers.read(params.id) ?? Response.json({ error: "RPE holds no answer by that id: it was read already, was dropped once its time to be read had passed, or was never given." }, { status: 404 }),
  });
}

// Build's route in the preview (`POST /api/v1/build`), answered one of two ways:
// - `rpe`, the default: RPE's own Build route (src/build) over a database in memory, which starts
//   with one invented world made from a starter template; what the page writes is kept while the
//   preview runs. A chat Attach gives a world there is played from it by the Play page's preview
//   (`attachedView`, used by mock-play.ts).
// - `stand-in`: today's stand-in backend (../mock-backend.ts), the fixtures the preview of today's
//   frontend plays against: its answer, and the draft pushes it made while the request was out.
// `/preview/build?backend=rpe|stand-in` picks one.

import { Database } from "bun:sqlite";
import { resolve } from "node:path";
import { CONFIG_DEFAULTS } from "../../../src/app/config";
import { lineLog, WriteQueue } from "../../../src/app";
import type { Migration } from "../../../src/app/migrations";
import { type BuildAnswer, BUILD_MIGRATIONS, buildRoutes, BuildService } from "../../../src/build";
import { createRegistry } from "../../../src/engine/registry-impl";
import { MIGRATE_TABLES } from "../../../src/migrate/tables";
import { ALL_PACKS } from "../../../src/packs/index";
import { chatView } from "../../../src/play/view";
import type { DraftChanged, ErrorMessage, FrontendToBackend, ResultMessage } from "../../../src/shared/protocol";
import type { StateView } from "../../../src/shared/state-view";
import { migrateStore, openStore, type Store, storedWorlds } from "../../../src/store";
import { MockBackend } from "../mock-backend";

type Backend = "rpe" | "stand-in";

/** Whose Build the preview's pages are, to RPE's route. */
const USER = "user-preview";
let backend: Backend = "rpe";

function migrate(db: Database, migrations: readonly Migration[]): void {
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if ("sql" in m) db.run(m.sql);
    else m.up(db);
  }
}

/** RPE's own route over a database in memory, made when first asked, with one invented world in it; and RPE's store behind it. */
interface Rpe {
  answer: (message: FrontendToBackend) => Promise<BuildAnswer>;
  store: Store;
}
let rpeRoute: Promise<Rpe> | null = null;

function rpe(): Promise<Rpe> {
  rpeRoute ??= (async () => {
    const db = new Database(":memory:");
    migrateStore(db);
    migrate(db, MIGRATE_TABLES);
    migrate(db, BUILD_MIGRATIONS);
    const store = openStore({ db, registry: createRegistry(ALL_PACKS), worlds: storedWorlds(db) });
    const writes = new WriteQueue(db, CONFIG_DEFAULTS.database.sliceMs);
    const service = new BuildService({ db, writes, store, log: lineLog((line) => console.log(line)), guidance: resolve(import.meta.dir, "../../../guidance") });
    const [post] = buildRoutes(service);
    const answer = async (message: FrontendToBackend): Promise<BuildAnswer> => post.handle({ params: {}, query: new URLSearchParams(), body: message, user: USER, request: new Request("http://preview/api/v1/build", { method: "POST" }), signal: new AbortController().signal });
    await answer({ lre: 1, type: "lre.world", reqId: "preview-seed", op: "create", name: "Fernwick", template: "fantasy_town" });
    return { answer, store };
  })();
  return rpeRoute;
}

/** Today's stand-in backend, and who waits on it: each request out, by its id, with the draft pushes made while it was out. */
const waiting = new Map<string, { pushes: DraftChanged[]; done(result: ResultMessage | ErrorMessage, pushes: DraftChanged[]): void }>();
let standIn: MockBackend | null = null;

function standInAnswer(message: FrontendToBackend): Promise<BuildAnswer> {
  standIn ??= new MockBackend(
    (payload) => {
      if (payload === null || typeof payload !== "object" || !("type" in payload)) return;
      const sent = payload as ResultMessage | ErrorMessage | DraftChanged;
      if (sent.type === "lre.draft.changed") for (const out of waiting.values()) out.pushes.push(sent);
      else if ((sent.type === "lre.result" || sent.type === "lre.error") && sent.reqId !== null) {
        const out = waiting.get(sent.reqId);
        waiting.delete(sent.reqId);
        out?.done(sent, out.pushes);
      }
    },
    // The stand-in's Attach closes today's drawer, which the new pages do not have; Build offers no Attach without a chat's view.
    { scenario: "play", closeDrawer: () => undefined },
  );
  const { promise, resolve: done } = Promise.withResolvers<BuildAnswer>();
  waiting.set(message.reqId, { pushes: [], done: (result, pushes) => done({ result, pushes }) });
  standIn.receive(message);
  return promise;
}

const answer = (status: number, body: unknown): Response => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** `POST /api/v1/build`: one of today's messages, answered by the backend the preview has picked. */
export async function buildAnswer(request: Request): Promise<Response> {
  if (request.method !== "POST") return answer(405, { error: "Build takes POST." });
  const message = (await request.json().catch(() => null)) as FrontendToBackend | null;
  if (message === null || message.lre !== 1 || typeof message.type !== "string" || typeof message.reqId !== "string") return answer(400, { error: "The body is one of today's messages: { lre: 1, type, reqId, … }." });
  return answer(200, backend === "rpe" ? await (await rpe()).answer(message) : await standInAnswer(message));
}

/** The chat's state as RPE's state route reads it, once Build's Attach gave it a world in RPE's store; null before that, and under the stand-in, whose Attach is its own. */
export async function attachedView(chat: string): Promise<StateView | null> {
  if (backend !== "rpe") return null;
  const { store } = await rpe();
  if (store.user(USER).chat(chat)?.world == null) return null;
  return chatView({ store, user: USER, chat, turn: null, turning: false });
}

/** `/preview/build?backend=rpe|stand-in`: which backend answers Build from now on. */
export function buildControl(url: URL): Response {
  const next = url.searchParams.get("backend");
  if (next !== "rpe" && next !== "stand-in") return answer(400, { error: "backend is rpe or stand-in." });
  backend = next;
  return answer(200, { backend });
}

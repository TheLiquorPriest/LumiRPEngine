// The question before lore activates (STANDALONE-PLAN §4.2, §9.6): the extension's World Info
// interceptor. Lumiverse runs it in every prompt assembly while one is registered, with or without
// candidate entries (`prompt-assembly.service.ts:2282-2316`; `world-info-interceptor.ts:212-221` skips
// the chain only when no interceptor is registered). It sends RPE the chat, the path as the context
// gives it (each message's id, place, swipe, whether it is the player's and its shown text's hash) and
// what RPE needs of each candidate entry; applies RPE's verdict on the secrets; and hands RPE's cut,
// whose verdict it applied and the question's time to the prompt interceptor of the same generation.
// With no answer within RPE's wait (sent with its registration) it applies the fail-closed verdict
// (`fail-closed.ts`) and cuts nothing, and RPE cuts on receipt; when RPE answers that it could not work
// the secrets out, it applies the same verdict and hands on RPE's cut. It remembers nothing from one
// generation to the next. For a user it holds no registration of RPE's for, it asks nothing and applies
// that verdict alone, which needs nothing but the entries and touches only those that carry RPE's marks
// or fields. Lumiverse gives it ten seconds and then forwards the entries unchanged
// (`worker-host.ts:4936-4943`), and does the same when it throws (`worker-runtime.ts:4979-4989`,
// `world-info-interceptor.ts:384-392`), so it never throws and RPE's wait is held inside that.

import type { WorldInfoCandidate } from "../shared/host";
import { textOf } from "../secrecy/lore-secrets";
import { textHash, type PathStep, type Question, type QuestionEntry } from "../adapter/lumiverse/wire";
import { isRecord, type JsonObject } from "../shared/json";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import { hasSecretMarks, unreadableMarks } from "../shared/secret-marks";
import { failClosed } from "./fail-closed";
import type { Generations, Handoff } from "./generations";
import { ask, type Road } from "./road";
import type { ExtSpindle, WorldInfoReturn } from "./spindle";

export interface QuestionDeps {
  /** This user's RPE, with its values; null where none is registered for them, and then the fail-closed verdict alone applies. */
  road(user: string): Promise<Road | null>;
  proxy: ExtSpindle["cors"];
  generations: Generations;
  log(message: string): void;
}

interface WorldInfoContext {
  user: string;
  chat: string;
  purpose: "prompt" | "query";
  path: PathStep[];
  candidates: WorldInfoCandidate[];
}

/** The interceptor's context (`world-info-interceptor.ts:71-80`, filled at `prompt-assembly.service.ts:2284-2313`), read; null when it names no user or chat. */
function contextOf(raw: unknown): WorldInfoContext | null {
  if (!isRecord(raw) || typeof raw.userId !== "string" || raw.userId === "" || typeof raw.chatId !== "string") return null;
  const path: PathStep[] = [];
  for (const m of Array.isArray(raw.messages) ? raw.messages : []) {
    if (!isRecord(m) || typeof m.id !== "string" || typeof m.index_in_chat !== "number") continue;
    // Whether it is the player's, and the hash of its shown text, as the tag's list hashes a text (§9.6 l.1121).
    path.push({ id: m.id, index: m.index_in_chat, swipe: typeof m.swipe_id === "number" ? m.swipe_id : null, user: m.is_user === true, hash: textHash(typeof m.content === "string" ? m.content : "") });
  }
  // As today's build reads them (`backend/spindle-host.ts:596`).
  const candidates: WorldInfoCandidate[] = [];
  for (const e of Array.isArray(raw.entries) ? raw.entries : []) {
    if (!isRecord(e) || typeof e.id !== "string") continue;
    candidates.push({ id: e.id, bookId: typeof e.world_book_id === "string" ? e.world_book_id : "", disabled: e.disabled === true, extensions: isRecord(e.extensions) ? (e.extensions as JsonObject) : {}, comment: typeof e.comment === "string" ? e.comment : "", content: typeof e.content === "string" ? e.content : "" });
  }
  return { user: raw.userId, chat: raw.chatId, purpose: raw.purpose === "query" ? "query" : "prompt", path, candidates };
}

/** A candidate as RPE is told of it (§9.6): its id and text key always; its text, title and RPE's fields only where it carries marks or RPE's fields. */
function entryOf(e: WorldInfoCandidate): QuestionEntry {
  const own = e.extensions[LEDGER_NAMESPACE];
  const telling = hasSecretMarks(e.content) || unreadableMarks(e.content).length > 0 || isRecord(own);
  return {
    id: e.id,
    book: e.bookId,
    disabled: e.disabled,
    key: textOf(e.content),
    ...(telling ? { content: e.content, comment: e.comment, ...(isRecord(own) ? { extensions: { [LEDGER_NAMESPACE]: own } } : {}) } : {}),
  };
}

/** The World Info interceptor's handler. */
export function worldInfoInterceptor(deps: QuestionDeps): (ctx: unknown) => Promise<WorldInfoReturn> {
  return async (raw) => {
    const ctx = contextOf(raw);
    if (ctx === null) return {};
    const generation = ctx.purpose === "prompt" ? deps.generations.pending(ctx.user, ctx.chat) : null;
    /** What the prompt interceptor of this generation is handed, where a prompt is being built for one. */
    const handOn = (handoff: Handoff): void => {
      if (generation !== null) deps.generations.hold(ctx.user, ctx.chat, generation.id, handoff);
    };
    const fallBack = (why: string, question: Handoff["question"]): WorldInfoReturn => {
      deps.log(`chat ${ctx.chat}: ${why}, so its secrets stay out of this prompt`);
      handOn({ cut: null, secrecy: { by: "extension", why }, question });
      return failClosed(ctx.candidates);
    };
    try {
      const road = await deps.road(ctx.user);
      // Before RPE first registers, or where it is not this user's: nothing to ask, nothing waits, and the marks still hold.
      if (road === null) {
        handOn({ cut: null, secrecy: { by: "extension", why: "RPE has not registered with the extension for this user" }, question: null });
        return failClosed(ctx.candidates);
      }
      const question: Question = { v: 1, user: ctx.user, chat: ctx.chat, purpose: ctx.purpose, generation, path: ctx.path, entries: ctx.candidates.map(entryOf) };
      const reply = await ask(deps.proxy, road, question);
      if ("none" in reply) return fallBack(reply.none, { ms: reply.ms, answered: false });
      const time = { ms: reply.ms, answered: true };
      // RPE could not work the secrets out: they stay out as with no answer, and its cut stands. RPE's log says so, once for the chat.
      if (reply.answer.secrecy === null) {
        handOn({ cut: reply.answer.cut, secrecy: { by: "extension", why: "RPE could not work out the secrets" }, question: time });
        return failClosed(ctx.candidates);
      }
      handOn({ cut: reply.answer.cut, secrecy: { by: "rpe" }, question: time });
      return reply.answer.secrecy;
    } catch (error) {
      return fallBack(`the extension failed (${error instanceof Error ? error.message : String(error)})`, null);
    }
  };
}

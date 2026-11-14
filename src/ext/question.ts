// The question before lore activates (STANDALONE-PLAN §4.2, §9.6): the extension's World Info
// interceptor. Lumiverse runs it in every prompt assembly while one is registered, with or without
// candidate entries (`prompt-assembly.service.ts:2282-2316`; `world-info-interceptor.ts:212-221` skips
// the chain only when no interceptor is registered). It sends RPE the chat, the path as the context
// gives it (message ids and swipes) and what RPE needs of each candidate entry; applies RPE's verdict
// on the secrets; and holds RPE's answer on the history cut for the prompt interceptor of the same
// generation. With no answer in time it applies the fail-closed verdict (`fail-closed.ts`) and holds
// no cut. Lumiverse gives it ten seconds and then forwards the entries unchanged
// (`worker-host.ts:4936-4943`), and does the same when it throws (`worker-runtime.ts:4979-4989`,
// `world-info-interceptor.ts:384-392`), so it never throws and its deadline is well inside that.

import type { WorldInfoCandidate } from "../backend/host";
import { textOf } from "../backend/lore-secrets";
import type { PathStep, Question, QuestionEntry } from "../adapter/lumiverse/wire";
import { isRecord, type JsonObject } from "../shared/json";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import { hasSecretMarks, unreadableMarks } from "../shared/secret-marks";
import { failClosed, type KeptOut } from "./fail-closed";
import type { Generations } from "./generations";
import { ask, type Road } from "./road";
import type { ExtSpindle, WorldInfoReturn } from "./spindle";

export interface QuestionDeps {
  /** This user's RPE; null where none belongs to them, and then the extension leaves their prompts alone. */
  road(user: string): Promise<Road | null>;
  proxy: ExtSpindle["cors"];
  generations: Generations;
  keptOut: KeptOut;
  /** How long RPE's answer is waited for. */
  deadlineMs: number;
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
    path.push({ id: m.id, index: m.index_in_chat, swipe: typeof m.swipe_id === "number" ? m.swipe_id : null });
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
    const fallBack = (why: string): WorldInfoReturn => {
      deps.log(`chat ${ctx.chat}: ${why}, so its secrets stay out of this prompt`);
      if (ctx.purpose === "prompt") deps.generations.hold(ctx.user, ctx.chat, deps.generations.pending(ctx.user, ctx.chat)?.id ?? null, null);
      return failClosed(ctx.candidates, deps.keptOut.of(ctx.user, ctx.chat));
    };
    try {
      const road = await deps.road(ctx.user);
      if (road === null) return {};
      const generation = ctx.purpose === "prompt" ? deps.generations.pending(ctx.user, ctx.chat) : null;
      const question: Question = { v: 1, user: ctx.user, chat: ctx.chat, purpose: ctx.purpose, generation, path: ctx.path, entries: ctx.candidates.map(entryOf) };
      const reply = await ask(deps.proxy, road, question, deps.deadlineMs);
      if ("none" in reply) return fallBack(reply.none);
      deps.keptOut.heard(ctx.user, ctx.chat, reply.answer.secrecy);
      if (ctx.purpose === "prompt") deps.generations.hold(ctx.user, ctx.chat, generation?.id ?? null, reply.answer.cut);
      return reply.answer.secrecy;
    } catch (error) {
      return fallBack(`the extension failed (${error instanceof Error ? error.message : String(error)})`);
    }
  };
}

// RPE's answer to the extension's one question per generation (STANDALONE-PLAN §4.2, §9.6; READINGS R-5):
// what each secret reads as in this prompt, and which history message is the first to keep. Both are
// worked out from RPE's own state held in the process, with no call to Lumiverse or to a model, at the
// point of the path the question carries: the turn lane gives where a turn not yet begun will start on
// that path (`start`), with the hidden marks RPE holds laid on its messages, and the lore's secrecy and
// the history window are asked there. Each half not worked out within the question's wait is answered
// not known, and what it works out after is kept for that generation's check on receipt.

import type { WorldInfoCandidate } from "../../shared/host";
import { readQuestion, type Answer, type GenerationFacts, type KeepPoint, type PathStep, type Question, type QuestionEntry, type SecrecyVerdict } from "./wire";

/**
 * Where a turn not yet begun will start on the path it comes with (the store's `TurnPoint`): after the path's newest message, for a
 * new reply, a continue and an impersonation (null on an empty path); or in place of the reply a swipe or a regenerate replaces.
 */
export type StartPoint = { follows: string | null; replaces?: never } | { replaces: string; follows?: never };

/** The path the question carries at its point, as RPE's own state reads it (the store's `TurnStart`): each message with the hidden mark RPE holds for it, and where the answer stands. */
export interface PathStart {
  messages: readonly { id: string; index: number; user: boolean; hidden: boolean }[];
  /** The message whose turn the coming turn follows, and that turn; null at the world's start. */
  at: { message: string; turn: string } | null;
  /** Whether RPE knows the chat: one it does not know is answered at the world's start. */
  known: boolean;
}

/** What the turn lane is asked: where the coming turn starts on the path the question carries, from RPE's own state alone. A point that disagrees with the path's end is refused (throws). */
export type TurnStarts = (ask: { user: string; chat: string; path: readonly PathStep[]; point: StartPoint }, signal: AbortSignal) => Promise<PathStart>;

/** What the secrecy rules are asked: the chat, the path as the extension saw it, where the coming turn starts on it, and the candidate entries. */
export interface SecrecyAsk {
  user: string;
  chat: string;
  purpose: "prompt" | "query";
  generation: GenerationFacts | null;
  path: readonly PathStep[];
  /** The path at the question's point as RPE's state reads it; rejects where that point could not be worked out. */
  start: Promise<PathStart>;
  /** Where the coming turn starts on the path, as the window's start is asked. */
  point: StartPoint;
  entries: readonly QuestionEntry[];
}

/** What each secret reads as in this prompt, worked out at this point of the path, by today's rules (§9.6). */
export type SecrecyRules = (ask: SecrecyAsk, signal: AbortSignal) => Promise<SecrecyVerdict>;

/** What the lore lane is asked on receipt (R-59): the chat, the path, where the coming turn starts on it, and the entries RPE read itself from the attached books, whole. */
export interface ReceiptSecrecyAsk {
  user: string;
  chat: string;
  path: readonly PathStep[];
  point: StartPoint;
  entries: readonly WorldInfoCandidate[];
}

/** The lore lane's own verdict on receipt (PlanLore-6's): the same rules at the same point of the path, over the entries RPE read itself. */
export type ReceiptSecrecy = (ask: ReceiptSecrecyAsk, signal: AbortSignal) => Promise<SecrecyVerdict>;

/** A message of the chat as the window counts it: its id and place; whether it is the player's, since Lumiverse joins two of the player's messages next to each other into one (READINGS R-202); and whether the user hid it, where that is known. */
export interface WindowStep {
  id: string;
  index: number;
  user?: boolean;
  hidden?: boolean;
}

/** What the history window is asked: the chat, and its messages along the path, oldest first. */
export interface WindowAsk {
  user: string;
  chat: string;
  generation: GenerationFacts | null;
  /**
   * The messages the window counts, oldest first, read only when the window is on, so a window that is off is never kept waiting on
   * them nor refused for them. At the question: the path the extension sends, up to the question's point, each message with the hidden
   * mark RPE's own state holds for it (`TurnStarts`). On receipt of a request the extension had no answer for: the chat's rows read
   * then through RPE's own read, less the hidden ones and the reply being written, as far as the prompt's history reaches
   * (`receipt.ts`). A path that cannot be read throws, and the window's answer with it.
   */
  path(): Promise<readonly WindowStep[]>;
  /**
   * The message and the turn the coming turn follows, as RPE's own state reads them (the store's `TurnStart.at`); null at the world's start. The story's record is read along this
   * turn's own line, never at the chat's head, so a swipe or a branch is cut by its own story. Rejects where the point could not be worked out. Asked only by a window that needs it.
   */
  follows(): Promise<PathStart["at"]>;
}

/** The first history message to keep (the window, its step and its hold, §4.2); null keeps all. */
export type HistoryWindow = (ask: WindowAsk, signal: AbortSignal) => Promise<KeepPoint | null>;

/**
 * The question's answers RPE worked out, by generation, kept until that generation's request arrives (its check on receipt): one
 * generation a chat at a time, as Lumiverse runs them, the chat's next replacing it.
 */
export class KeptAnswers {
  readonly #byChat = new Map<string, { generation: string; answer: Answer }>();

  keep(chat: string, generation: string, answer: Answer): void {
    this.#byChat.set(chat, { generation, answer });
  }

  /** The answer worked out for the generation, taken: none once taken, or after the chat's next question. */
  take(chat: string, generation: string): Answer | null {
    const kept = this.#byChat.get(chat);
    if (kept === undefined || kept.generation !== generation) return null;
    this.#byChat.delete(chat);
    return kept.answer;
  }

  /** Whether RPE worked out an answer for this generation of the chat, not yet taken. */
  answered(chat: string, generation: string): boolean {
    return this.#byChat.get(chat)?.generation === generation;
  }
}

export interface AnswerDeps {
  secrecy: SecrecyRules;
  window: HistoryWindow;
  start: TurnStarts;
  /** The question's wait: each half not worked out within it is answered not known. Absent, none. */
  waitMs?: () => number;
  /** Timers for the wait. */
  clock?: { setTimeout(run: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
  /** Where an answer worked out is kept for its generation's check on receipt. */
  kept?: KeptAnswers;
  log?(message: string): void;
}

/** The point of the path a generation starts at: in place of the reply a swipe or a regenerate replaces, else after the path's newest message. */
export function pointOf(generation: GenerationFacts | null, path: readonly PathStep[]): StartPoint {
  const replaced = generation?.type === "swipe" || generation?.type === "regenerate" ? generation.target.message : null;
  return replaced !== null ? { replaces: replaced } : { follows: path.at(-1)?.id ?? null };
}

/** Not worked out within the wait. */
const LATE = Symbol("late");

/**
 * The answer to one question. Where the coming turn starts on the question's path is asked of the turn lane once; the window is asked
 * there only when a prompt is being built, the secrecy rules at the same time, and neither's failure takes the other's answer with
 * it. When the window fails, or the start it is counted from, the answer says the cut is not known, so the extension cuts nothing and
 * RPE cuts on receipt. When the secrecy rules fail, the answer says the secrets are not known (`secrecy: null`): the extension keeps
 * every marked secret out by its own fail-closed verdict, as with no answer at all, and still cuts where the window says. A half not
 * worked out within the wait is answered not known; when it is worked out, the whole answer is kept for the generation's receipt.
 * `secretsFailed` hears why the secrets failed.
 */
export async function answer(deps: AnswerDeps, q: Question, signal: AbortSignal, secretsFailed: (error: unknown) => void): Promise<Answer> {
  const at = { user: q.user, chat: q.chat, generation: q.generation };
  const point = pointOf(q.generation, q.path);
  const start = deps.start({ user: q.user, chat: q.chat, path: q.path, point }, signal);
  // Read by whichever half needs it; a refusal is each half's own failure.
  start.catch(() => undefined);
  const cut = q.purpose === "prompt"
    ? deps.window({ ...at, path: async () => (await start).messages, follows: async () => (await start).at }, signal).then(
        (keep) => ({ keep }),
        (error: unknown) => {
          deps.log?.(`the history window for chat ${q.chat} was not worked out, so RPE cuts it when the request arrives: ${words(error)}`);
          return null;
        },
      )
    : Promise.resolve(null);
  const secrecy = deps.secrecy({ ...at, path: q.path, start, point, purpose: q.purpose, entries: q.entries }, signal).catch((error: unknown) => {
    secretsFailed(error);
    return null;
  });
  const from = start.then(
    (s) => ({ known: s.known, turn: s.at?.turn ?? null }),
    () => null,
  );
  const whole = Promise.all([secrecy, cut, from]).then(([verdict, window, began]): Answer => ({ v: 1, secrecy: verdict, cut: window, start: began }));
  const ms = deps.waitMs?.();
  if (ms === undefined || deps.clock === undefined) {
    const done = await whole;
    if (q.generation !== null) deps.kept?.keep(q.chat, q.generation.id, done);
    return done;
  }
  const clock = deps.clock;
  const { promise: late, resolve } = Promise.withResolvers<typeof LATE>();
  const timer = clock.setTimeout(() => resolve(LATE), ms);
  const within = <T>(half: Promise<T>): Promise<T | typeof LATE> => Promise.race([half, late]);
  const [verdict, window, began] = await Promise.all([within(secrecy), within(cut), within(from)]);
  clock.clearTimeout(timer);
  if (verdict === LATE || window === LATE || began === LATE) {
    deps.log?.(`RPE did not work out all of its answer for chat ${q.chat} within the question's ${ms} ms; what it works out after is kept for the reply's request.`);
    if (q.generation !== null) {
      const generation = q.generation.id;
      void whole.then((done) => deps.kept?.keep(q.chat, generation, done));
    }
  } else if (q.generation !== null) deps.kept?.keep(q.chat, q.generation.id, { v: 1, secrecy: verdict, cut: window, start: began });
  return { v: 1, secrecy: verdict === LATE ? null : verdict, cut: window === LATE ? null : window, start: began === LATE ? null : began };
}

function words(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/**
 * The question's route (`QUESTION_PATH`): a POST of the question as JSON, answered as JSON. Who may ask
 * is the server's to say (`allowed`): the extension's registration. Secrets that cannot be worked out
 * are said in the log once for each chat while RPE runs, not at every generation.
 */
export function questionRoute(deps: AnswerDeps & { allowed(request: Request): boolean | Promise<boolean> }): (request: Request, parsed: () => Promise<unknown>) => Promise<Response> {
  const told = new Set<string>();
  return async (request, parsed) => {
    if (request.method !== "POST") return json(405, { error: "The question is asked with POST." });
    if (!(await deps.allowed(request))) return json(401, { error: "This extension is not registered with this RPE." });
    let body: unknown;
    try {
      body = await parsed();
    } catch {
      return json(400, { error: "The question is not JSON." });
    }
    const q = readQuestion(body);
    if (q === null) return json(400, { error: "The question is not one this RPE reads: update the extension and RPE to the same build." });
    const secretsFailed = (error: unknown): void => {
      if (told.has(q.chat)) return;
      told.add(q.chat);
      deps.log?.(`chat ${q.chat}: RPE could not work out its lore's secrets (${words(error)}). The extension keeps every marked secret out of its prompts, and the history window is cut as ever. This is said once for each chat until RPE restarts.`);
    };
    try {
      return json(200, await answer(deps, q, request.signal, secretsFailed));
    } catch (error) {
      deps.log?.(`RPE could not answer the extension's question for chat ${q.chat}, so the extension answers by itself: ${words(error)}`);
      return json(500, { error: words(error) });
    }
  };
}

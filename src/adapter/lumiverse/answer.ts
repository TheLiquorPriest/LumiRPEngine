// RPE's answer to the extension's one question per generation (STANDALONE-PLAN §4.2, §9.6): what each
// secret reads as in this prompt, and which history message is the first to keep. Both are worked out
// by functions other parts of RPE give (the lore's secrecy, the history window); this only asks them,
// at the point of the path the extension saw, and puts the answer in the extension's words.

import { readQuestion, type Answer, type GenerationFacts, type KeepPoint, type PathStep, type Question, type QuestionEntry, type SecrecyVerdict } from "./wire";

/** What the secrecy rules are asked: the chat, the path as the extension saw it, and the candidate entries. */
export interface SecrecyAsk {
  user: string;
  chat: string;
  purpose: "prompt" | "query";
  generation: GenerationFacts | null;
  path: readonly PathStep[];
  entries: readonly QuestionEntry[];
}

/** What each secret reads as in this prompt, worked out at this point of the path, by today's rules (§9.6). */
export type SecrecyRules = (ask: SecrecyAsk, signal: AbortSignal) => Promise<SecrecyVerdict>;

/** What the history window is asked: the chat, and its messages along the path, oldest first. */
export interface WindowAsk {
  user: string;
  chat: string;
  generation: GenerationFacts | null;
  /** At the question: every message of the chat the prompt is built from. On receipt of a request the extension could not cut: the prompt's history messages, swipes unknown. */
  path: readonly PathStep[];
}

/** The first history message to keep (the window, its step and its hold, §4.2); null keeps all. */
export type HistoryWindow = (ask: WindowAsk, signal: AbortSignal) => Promise<KeepPoint | null>;

export interface AnswerDeps {
  secrecy: SecrecyRules;
  window: HistoryWindow;
  log?(message: string): void;
}

/**
 * The answer to one question. The window is asked only when a prompt is being built. When it fails,
 * the answer says the cut is not known, so the extension cuts nothing and RPE cuts on receipt; when
 * the secrecy rules fail there is no answer at all, and the extension keeps every secret out.
 */
export async function answer(deps: AnswerDeps, q: Question, signal: AbortSignal): Promise<Answer> {
  const ask = { user: q.user, chat: q.chat, generation: q.generation, path: q.path };
  const cut = q.purpose === "prompt"
    ? deps.window(ask, signal).then(
        (keep) => ({ keep }),
        (error: unknown) => {
          deps.log?.(`the history window for chat ${q.chat} was not worked out, so RPE cuts it when the request arrives: ${words(error)}`);
          return null;
        },
      )
    : Promise.resolve(null);
  const [secrecy, window] = await Promise.all([deps.secrecy({ ...ask, purpose: q.purpose, entries: q.entries }, signal), cut]);
  return { v: 1, secrecy, cut: window };
}

function words(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/**
 * The question's route (`QUESTION_PATH`): a POST of the question as JSON, answered as JSON. Who may ask
 * is the server's to say (`allowed`): the extension's registration.
 */
export function questionRoute(deps: AnswerDeps & { allowed(request: Request): boolean | Promise<boolean> }): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") return json(405, { error: "The question is asked with POST." });
    if (!(await deps.allowed(request))) return json(401, { error: "This extension is not registered with this RPE." });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: "The question is not JSON." });
    }
    const q = readQuestion(body);
    if (q === null) return json(400, { error: "The question is not one this RPE reads: update the extension and RPE to the same build." });
    try {
      return json(200, await answer(deps, q, request.signal));
    } catch (error) {
      deps.log?.(`the secrets in chat ${q.chat} were not worked out, so the extension keeps them all out: ${words(error)}`);
      return json(500, { error: words(error) });
    }
  };
}

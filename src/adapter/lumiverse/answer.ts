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
   * them nor refused for them. At the question: the path the extension sends. On receipt of a request the extension had no answer
   * for: the chat's rows read then through RPE's own read, less the hidden ones and the reply being written, as far as the prompt's
   * history reaches (`receipt.ts`). A path that cannot be read throws, and the window's answer with it.
   */
  path(): Promise<readonly WindowStep[]>;
}

/** The first history message to keep (the window, its step and its hold, §4.2); null keeps all. */
export type HistoryWindow = (ask: WindowAsk, signal: AbortSignal) => Promise<KeepPoint | null>;

export interface AnswerDeps {
  secrecy: SecrecyRules;
  window: HistoryWindow;
  log?(message: string): void;
}

/**
 * The answer to one question. The window is asked only when a prompt is being built, the secrecy rules
 * at the same time, and neither's failure takes the other's answer with it. When the window fails, the
 * answer says the cut is not known, so the extension cuts nothing and RPE cuts on receipt. When the
 * secrecy rules fail, the answer says the secrets are not known (`secrecy: null`): the extension keeps
 * every marked secret out by its own fail-closed verdict, as with no answer at all, and still cuts
 * where the window says. `secretsFailed` hears why they failed.
 */
export async function answer(deps: AnswerDeps, q: Question, signal: AbortSignal, secretsFailed: (error: unknown) => void): Promise<Answer> {
  const at = { user: q.user, chat: q.chat, generation: q.generation };
  const cut = q.purpose === "prompt"
    ? deps.window({ ...at, path: async () => q.path }, signal).then(
        (keep) => ({ keep }),
        (error: unknown) => {
          deps.log?.(`the history window for chat ${q.chat} was not worked out, so RPE cuts it when the request arrives: ${words(error)}`);
          return null;
        },
      )
    : Promise.resolve(null);
  const secrecy = deps.secrecy({ ...at, path: q.path, purpose: q.purpose, entries: q.entries }, signal).catch((error: unknown) => {
    secretsFailed(error);
    return null;
  });
  const [verdict, window] = await Promise.all([secrecy, cut]);
  return { v: 1, secrecy: verdict, cut: window };
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
export function questionRoute(deps: AnswerDeps & { allowed(request: Request): boolean | Promise<boolean> }): (request: Request) => Promise<Response> {
  const told = new Set<string>();
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

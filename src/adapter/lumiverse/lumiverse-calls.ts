// What only Lumiverse can answer as it answers: a macro resolved the way Lumiverse resolves it for a chat, and a text's tokens counted by
// the model's own tokenizer (STANDALONE-PLAN §4.2 "Macro resolution, token counts", §10.5). Both are Lumiverse's HTTP routes asked as the
// signed-in user (`routes/macros.routes.ts`, `routes/tokenizers.routes.ts`); nothing is kept.

import { isRecord } from "../../shared/json";
import { LumiverseError, type LumiverseSession } from "./session";

/** Lumiverse takes at most 100 templates in one resolve (`routes/macros.routes.ts:107-110`). */
const MACRO_BATCH = 100;
/** Lumiverse counts at most 64 texts in one request (`services/tokenizer.service.ts:17`). */
const COUNT_BATCH = 64;

/** The chat and the parts of it a macro is resolved for, as `POST /api/v1/macros/resolve` takes them. */
export interface MacroContext {
  chat?: string;
  character?: string;
  persona?: string;
  connection?: string;
  /** What the player typed, for `{{input}}`. */
  input?: string;
}

/** One macro template resolved, with what Lumiverse said about it. */
export interface MacroResolved {
  text: string;
  /** Lumiverse's own diagnostics for the template, as it sent them. */
  diagnostics: unknown[];
}

export interface MacroCalls {
  /** One template, resolved for the context. */
  resolve(template: string, context: MacroContext): Promise<MacroResolved>;
  /** Many templates by key, resolved in one shared context (a hundred a request, Lumiverse's own cap). */
  resolveBatch(templates: Readonly<Record<string, string>>, context: MacroContext): Promise<Record<string, string>>;
}

export interface TokenCalls {
  /** The tokens of a text by a model's own tokenizer; null where Lumiverse has none for the model. */
  count(model: string, text: string): Promise<number | null>;
  /** The tokens of each text, in order (sixty-four a request, Lumiverse's own cap). */
  countBatch(model: string, texts: readonly string[]): Promise<(number | null)[]>;
}

export interface LumiverseCalls {
  macros: MacroCalls;
  tokens: TokenCalls;
}

/** The context as the routes name it. */
function bodyOf(context: MacroContext): Record<string, string> {
  return {
    ...(context.chat === undefined ? {} : { chat_id: context.chat }),
    ...(context.character === undefined ? {} : { character_id: context.character }),
    ...(context.persona === undefined ? {} : { persona_id: context.persona }),
    ...(context.connection === undefined ? {} : { connection_id: context.connection }),
    ...(context.input === undefined ? {} : { user_input: context.input }),
  };
}

function answered(body: unknown, asked: string): Record<string, unknown> {
  if (!isRecord(body)) throw new LumiverseError("protocol", `Lumiverse answered ${asked} with something RPE does not read.`);
  return body;
}

export function lumiverseCalls(session: LumiverseSession): LumiverseCalls {
  return {
    macros: {
      async resolve(template, context) {
        const body = answered(await session.json("POST", "/api/v1/macros/resolve", { template, ...bodyOf(context) }), "a macro resolve");
        if (typeof body.text !== "string") throw new LumiverseError("protocol", "Lumiverse answered a macro resolve with no text.");
        return { text: body.text, diagnostics: Array.isArray(body.diagnostics) ? body.diagnostics : [] };
      },
      async resolveBatch(templates, context) {
        const keys = Object.keys(templates);
        const out: Record<string, string> = {};
        for (let at = 0; at < keys.length; at += MACRO_BATCH) {
          const part = Object.fromEntries(keys.slice(at, at + MACRO_BATCH).map((k) => [k, templates[k] ?? ""]));
          const body = answered(await session.json("POST", "/api/v1/macros/resolve-batch", { templates: part, ...bodyOf(context) }), "a macro batch");
          const resolved = answered(body.resolved, "a macro batch's resolved texts");
          for (const key of Object.keys(part)) out[key] = typeof resolved[key] === "string" ? resolved[key] : "";
        }
        return out;
      },
    },
    tokens: {
      async count(model, text) {
        // Lumiverse refuses an empty text (`routes/tokenizers.routes.ts:88`): nothing is nothing.
        if (text === "") return 0;
        const body = answered(await session.json("POST", "/api/v1/tokenizers/count", { model_id: model, text }), "a token count");
        return typeof body.token_count === "number" ? body.token_count : null;
      },
      async countBatch(model, texts) {
        const out: (number | null)[] = [];
        for (let at = 0; at < texts.length; at += COUNT_BATCH) {
          const part = texts.slice(at, at + COUNT_BATCH);
          const body = answered(await session.json("POST", "/api/v1/tokenizers/count-batch", { model_id: model, texts: part }), "a token count batch");
          const results = Array.isArray(body.results) ? body.results : [];
          if (results.length !== part.length) throw new LumiverseError("protocol", "Lumiverse counted a batch of texts and gave back another number of counts.");
          for (const r of results) out.push(isRecord(r) && typeof r.token_count === "number" ? r.token_count : null);
        }
        return out;
      },
    },
  };
}

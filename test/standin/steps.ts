// Lumiverse's own steps around the extension's interceptors, copied from its source (staging at
// a70f4ed2, the checkout the plan rests on). Each says the file and lines it copies. Paths are
// Lumiverse's `src/`.

import type { Clock } from "rp-harness/contract";

export type Role = "system" | "user" | "assistant";

export type LlmPart = { type: "text"; text: string } | { type: "image"; data: string; mime_type: string };

/** A prompt message as Lumiverse's pipeline holds it (`llm/types.ts:83-106`), with its hidden source marks (`services/prompt-assembly.service.ts:209-216`). */
export interface LlmMessage {
  role: Role;
  content: string | LlmPart[];
  partial?: boolean;
  [mark: string]: unknown;
}

/** `getTextContent` (`llm/types.ts:109-115`): the text parts run together. */
export function textOf(m: LlmMessage): string {
  if (typeof m.content === "string") return m.content;
  return m.content
    .filter((p): p is Extract<LlmPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** `applyPostProcessing` (`services/generate.service.ts:5406-5430`), in place: "merge", "semi" and "strict" are one branch. */
export function applyPostProcessing(messages: LlmMessage[], mode: string): void {
  if (mode === "merge" || mode === "semi" || mode === "strict") {
    let i = 1;
    while (i < messages.length) {
      if (messages[i]!.role === messages[i - 1]!.role) {
        messages[i - 1] = { ...messages[i - 1]!, content: textOf(messages[i - 1]!) + "\n\n" + textOf(messages[i]!) };
        messages.splice(i, 1);
      } else i++;
    }
  } else if (mode === "single") {
    if (messages.length > 1) {
      const combined = messages.map((m) => textOf(m)).join("\n\n");
      messages.length = 0;
      messages.push({ role: "system", content: combined });
    }
  }
}

/** The filter after the interceptors (`services/generate.service.ts:1414-1423`). */
export function dropBlank(messages: LlmMessage[]): LlmMessage[] {
  return messages.filter((m) => (typeof m.content === "string" ? m.content.trim().length > 0 || (m.role === "assistant" && m.partial === true) : m.content.length > 0));
}

/** `collapseToSingleUserMessage` (`services/prompt-assembly.service.ts:7244-7279`), in place. */
export function collapse(result: LlmMessage[]): void {
  if (result.length <= 1) return;
  const textChunks: string[] = [];
  const mediaParts: LlmPart[] = [];
  for (const msg of result) {
    if (typeof msg.content === "string") {
      if (msg.content) textChunks.push(msg.content);
    } else {
      for (const part of msg.content) {
        if (part.type === "text") {
          if (part.text) textChunks.push(part.text);
        } else mediaParts.push(part);
      }
    }
  }
  const collapsed = textChunks.join("\n\n");
  result.length = 0;
  if (mediaParts.length > 0) result.push({ role: "user", content: [{ type: "text", text: collapsed }, ...mediaParts] });
  else result.push({ role: "user", content: collapsed });
}

/** The custom connection's allowlist (`llm/providers/custom.ts:9-21`) and the keys never sent (`llm/providers/openai-compatible.ts:463`). */
const ALLOWED = ["temperature", "max_tokens", "top_p", "top_k", "frequency_penalty", "presence_penalty", "stop", "min_p", "repetition_penalty"];
const INTERNAL: Record<string, true> = { max_context_length: true, _include_usage: true, use_responses_api: true, _nanogpt: true };

/** `flattenForChat` and `formatContent` for text and pictures (`llm/providers/openai-compatible.ts:337-435`). */
function flatten(m: LlmMessage): Record<string, unknown> {
  if (typeof m.content === "string") return { role: m.role, content: m.content };
  return {
    role: m.role,
    content: m.content.map((part) => (part.type === "text" ? { type: "text", text: part.text } : { type: "image_url", image_url: { url: `data:${part.mime_type};base64,${part.data}` } })),
  };
}

/** `OpenAICompatibleProvider.buildBody` (`llm/providers/openai-compatible.ts:466-517`) for a custom connection. */
export function buildBody(model: string, messages: readonly LlmMessage[], params: Record<string, unknown>, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = { model, messages: messages.map(flatten), stream };
  for (const key of ALLOWED) if (params[key] !== undefined) body[key] = params[key];
  for (const key of Object.keys(params)) {
    if (body[key] !== undefined || ALLOWED.includes(key) || Object.hasOwn(INTERNAL, key)) continue;
    body[key] = params[key];
  }
  if (stream && params._include_usage) body.stream_options = { include_usage: true };
  return body;
}

/** `headers` (`llm/providers/openai-compatible.ts:132-144`). */
export function providerHeaders(apiKey: string): Record<string, string> {
  const key = apiKey.trim().replace(/^Bearer\s+/i, "");
  return { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) };
}

export interface StreamedReply {
  content: string;
  reasoning: string;
  finishReason: string;
  usage: Record<string, unknown> | null;
}

/**
 * What Lumiverse reads of a streamed reply: `readProviderSse` (`llm/provider-sse.ts:25-72`) and the
 * chunk handling of `generateStream` (`llm/providers/openai-compatible.ts:233-303`), including a
 * chunk that carries `error` (`provider-sse.ts:11-21`) and a stream that ends with no finish reason.
 */
export async function readStream(res: Response): Promise<StreamedReply> {
  if (!res.ok) throw new Error(`Provider error ${res.status}: ${await res.text()}`);
  const text = await res.text();
  let content = "";
  let reasoning = "";
  let reasoningKey: "reasoning" | "reasoning_content" | null = null;
  let finishReason: string | undefined;
  let usage: Record<string, unknown> | null = null;
  let dataLines: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
      const payload = dataLines.join("\n");
      if (payload.trim() === "[DONE]") break;
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      dataLines = [];
      if (data.error !== undefined) {
        const e = data.error as { message?: unknown };
        throw new Error(typeof e?.message === "string" ? e.message : JSON.stringify(data.error));
      }
      const choice = (data.choices as Record<string, unknown>[] | undefined)?.[0];
      const delta = choice?.delta as Record<string, unknown> | undefined;
      if (typeof choice?.finish_reason === "string" && finishReason === undefined) finishReason = choice.finish_reason;
      if (!reasoningKey) {
        if (delta?.reasoning !== undefined) reasoningKey = "reasoning";
        else if (delta?.reasoning_content !== undefined) reasoningKey = "reasoning_content";
      }
      // `splitMirroredReasoning` (`openai-compatible.ts:80-106`): a delta whose content mirrors its reasoning is reasoning only.
      const c = typeof delta?.content === "string" ? delta.content : "";
      const r = reasoningKey && typeof delta?.[reasoningKey] === "string" && (delta[reasoningKey] as string).length > 0 ? (delta[reasoningKey] as string) : "";
      if (r && c && (c === r || c.trim() === r.trim())) reasoning += r;
      else {
        content += c;
        reasoning += r;
      }
      if (data.usage && typeof data.usage === "object") usage = data.usage as Record<string, unknown>;
    } else if (line === "" && dataLines.length) throw new Error("The provider sent an invalid JSON stream event.");
  }
  if (!finishReason) throw new Error("The provider connection closed before a terminal response was received.");
  return { content, reasoning, finishReason, usage };
}

/**
 * What Lumiverse reads of a reply asked for whole (`OpenAICompatibleProvider.generate`,
 * `llm/providers/openai-compatible.ts:146-205`): the first choice's text and its reasoning, the finish
 * reason (`stop` when none is given), and the usage.
 */
export async function readWhole(res: Response): Promise<StreamedReply> {
  if (!res.ok) throw new Error(`Provider error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices?: { message?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown }; finish_reason?: unknown }[]; usage?: unknown };
  const choice = data.choices?.[0];
  const reasoning = choice?.message?.reasoning ?? choice?.message?.reasoning_content;
  return {
    content: typeof choice?.message?.content === "string" ? choice.message.content : "",
    reasoning: typeof reasoning === "string" ? reasoning : "",
    finishReason: typeof choice?.finish_reason === "string" && choice.finish_reason !== "" ? choice.finish_reason : "stop",
    usage: typeof data.usage === "object" && data.usage !== null ? (data.usage as Record<string, unknown>) : null,
  };
}

/**
 * Lumiverse strips a secret mark when it puts an entry into a prompt: its lexer reads each `/` after
 * `{{` as a closing flag (`macros/MacroLexer.ts:53-76`), so `{{// Secret: …}}` is the closing tag of a
 * macro named `Secret`, and its parser drops a closing tag that closes nothing
 * (`macros/MacroParser.ts:349-353`). The stand-in drops every closing tag, up to its first `}}`: its
 * fixtures hold no other macros.
 */
export function stripClosingTags(text: string): string {
  return text.replace(/\{\{[ \t]*\/[\s\S]*?\}\}/g, "");
}

/** What Lumiverse saw of a watched generation. */
export interface Watched {
  started: number;
  /** Each chunk with text, when it came (the clock's time). */
  texts: { at: number; kind: "content" | "reasoning"; text: string }[];
  content: string;
  /** Lumiverse's watchdog ended it. */
  aborted: boolean;
}

/**
 * Lumiverse watching a streamed generation as it comes, on a clock the test runs: it takes a chunk only
 * when it has text (`llm/providers/openai-compatible.ts:278`), touches the generation on reply or
 * thinking text (`services/generate.service.ts:3867-3873`), and every minute ends one untouched for
 * more than ten (`services/generation/active-generation-registry.ts:140-153`). Comment lines are
 * skipped (`llm/provider-sse.ts:52`).
 */
export async function watchGeneration(res: Response, clock: Pick<Clock, "now" | "setTimeout" | "clearTimeout">): Promise<Watched> {
  const out: Watched = { started: clock.now(), texts: [], content: "", aborted: false };
  let lastTokenAt = clock.now();
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let sweep: unknown = null;
  const check = (): void => {
    if (clock.now() - lastTokenAt > 10 * 60 * 1000) {
      out.aborted = true;
      void reader.cancel();
      return;
    }
    sweep = clock.setTimeout(check, 60_000);
  };
  // Lumiverse's sweep keeps its own minute, started with the server, not with the generation: half a
  // minute off here, so a sweep never lands on the very moment a line arrives.
  sweep = clock.setTimeout(check, 30_000);
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        const delta = (JSON.parse(payload) as { choices?: { delta?: { content?: string; reasoning_content?: string } }[] }).choices?.[0]?.delta;
        for (const kind of ["content", "reasoning"] as const) {
          const text = kind === "content" ? delta?.content : delta?.reasoning_content;
          if (typeof text !== "string" || text === "") continue;
          lastTokenAt = clock.now();
          out.texts.push({ at: clock.now(), kind, text });
          if (kind === "content") out.content += text;
        }
      }
    }
  } catch {
    // Cancelled by the watchdog.
  } finally {
    clock.clearTimeout(sweep);
  }
  return out;
}

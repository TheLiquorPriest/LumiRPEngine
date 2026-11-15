// The prompt interceptor (STANDALONE-PLAN §4.2, §4.3). Lumiverse runs it after the prompt is assembled
// and before it is joined or sent (`generate.service.ts:1233-1247`), for every generation of every
// chat. For a chat reply on RPE's connection it leaves out the history before the first message RPE
// said to keep, and adds the tag and nothing else: the generation's facts as `GENERATION_STARTED` gave
// them, the cut, whose secrecy verdict was applied and the question's time, and every message as
// handed on (role, length, hash, the history and lore flags). It lists no lore: what activated is
// Lumiverse's own `WORLD_INFO_ACTIVATED`, which RPE hears on its event socket, never a list another
// extension's context handler may have put in the context (`generate.service.ts:1073-1083`). A preset
// with streaming off is answered whole, as it asked. It ignores dry runs, which are never sent (the
// context says `dryRun`, `generate.service.ts:1070`; a registration's `isDryRun` filter never fires,
// `interceptor-pipeline.ts:66`). Any other prompt goes back untouched.
//
// It is registered as required, so a failure of its own stops the generation (`interceptor-
// pipeline.ts:212`); it is called for every chat, so it holds its own faults: a prompt not on RPE's
// connection goes back untouched whatever went wrong, and one on RPE's connection is stopped with a
// line saying why rather than sent on untagged. What it cannot hold is its worker being stopped
// mid-generation: Lumiverse then fails the pending call for any chat (`worker-host.ts:1572-1575`).

import { isRecord } from "../shared/json";
import { historyCut, replyKindOf, TAG_FIELD, textHash, type Role, type Tag, type TagMessage } from "../adapter/lumiverse/wire";
import type { Generations } from "./generations";
import type { InterceptorReturn, PromptMessageDTO } from "./spindle";

export interface PromptDeps {
  generations: Generations;
  /** Whether this user's connection is RPE's. */
  isRpe(connection: string, user: string): boolean | Promise<boolean>;
  granted(permission: string): boolean;
  log(message: string): void;
}

/** A failure whose words the user is shown as they are. */
class Stop extends Error {}

interface PromptContext {
  user: string;
  chat: string;
  type: string | null;
  dryRun: boolean;
  connection: string | null;
  preset: string | null;
  persona: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** The context as Lumiverse fills it (`generate.service.ts:1063-1072`, `:1217-1231`); null when it names no user or chat. */
function contextOf(raw: unknown): PromptContext | null {
  if (!isRecord(raw)) return null;
  const user = str(raw.userId);
  const chat = str(raw.chatId);
  if (user === null || chat === null) return null;
  return {
    user,
    chat,
    type: str(raw.generationType),
    dryRun: raw.dryRun === true || raw.isDryRun === true,
    connection: str(raw.connectionId),
    preset: str(raw.presetId),
    persona: str(raw.personaId),
  };
}

/** A message as the tag lists it: its text is its content's text parts run together, as Lumiverse reads it (`llm/types.ts:109-115`). */
export function listedMessage(m: PromptMessageDTO): TagMessage {
  const role: Role = m.role === "system" || m.role === "assistant" ? m.role : "user";
  let text = "";
  let parts: number[] | undefined;
  let media = 0;
  if (typeof m.content === "string") text = m.content;
  else if (Array.isArray(m.content)) {
    const texts: string[] = [];
    for (const part of m.content) {
      if (isRecord(part) && part.type === "text" && typeof part.text === "string") texts.push(part.text);
      else media++;
    }
    text = texts.join("");
    parts = texts.map((t) => t.length);
  }
  return {
    role,
    length: text.length,
    hash: textHash(text),
    ...(text.trim().length === 0 ? { blank: true as const } : {}),
    ...(m.__isChatHistory === true ? { history: true as const } : {}),
    ...(m.__isChatHistory === true && typeof m.sourceMessageId === "string" && typeof m.sourceIndexInChat === "number" ? { source: { id: m.sourceMessageId, index: m.sourceIndexInChat } } : {}),
    ...(m.__isWorldInfoEntry === true ? { lore: true as const } : {}),
    ...(m.__isChatHistory === true && m.__cortexHistorySummary === true ? { summary: true as const } : {}),
    ...(m.partial === true ? { partial: true as const } : {}),
    ...(parts !== undefined ? { parts } : {}),
    ...(media > 0 ? { media } : {}),
  };
}

/** The prompt interceptor's handler. */
export function promptInterceptor(deps: PromptDeps): (messages: PromptMessageDTO[], context: unknown) => Promise<InterceptorReturn> {
  return async (messages, context) => {
    let ours = false;
    try {
      const ctx = contextOf(context);
      if (ctx === null || ctx.dryRun || ctx.connection === null) return messages;
      const kind = replyKindOf(ctx.type);
      if (kind === null || ctx.type === null) return messages;
      ours = await deps.isRpe(ctx.connection, ctx.user);
      if (!ours) return messages;
      // Without it Lumiverse takes the tag off and only says so in its own log (`worker-host.ts:1922-1931`).
      if (!deps.granted("generation_parameters")) throw new Stop("RPE stopped this reply rather than send it without RPE: its extension may not add to a reply's request. Grant RPE's extension the “generation_parameters” permission in Lumiverse.");
      const generation = deps.generations.take(ctx.user, ctx.chat, ctx.type);
      if (generation === null) throw new Stop("RPE could not tell which generation this prompt belongs to, so it stopped the reply. Send it again.");
      const handoff = deps.generations.handoffFor(ctx.user, ctx.chat, generation.id);
      const cut = handoff?.cut ?? null;
      const left = new Set(cut === null ? [] : historyCut(messages.map((m) => ({ history: m.__isChatHistory === true, index: typeof m.sourceIndexInChat === "number" ? m.sourceIndexInChat : null })), cut.keep));
      // The messages kept go back as the very objects Lumiverse gave, every flag of theirs on them.
      const kept = left.size === 0 ? messages : messages.filter((_, i) => !left.has(i));
      const tag: Tag = {
        v: 1,
        user: ctx.user,
        chat: ctx.chat,
        generation: generation.id,
        kind,
        target: generation.target,
        speaker: generation.speaker,
        connection: ctx.connection,
        preset: ctx.preset,
        persona: ctx.persona,
        cut: cut === null ? { answered: false } : { answered: true, keep: cut.keep, removed: left.size },
        secrecy: handoff?.secrecy ?? { by: "extension", why: "no question was asked for this prompt" },
        question: handoff?.question ?? null,
        messages: kept.map(listedMessage),
      };
      return { messages: kept, parameters: { [TAG_FIELD]: tag } };
    } catch (error) {
      if (!ours) {
        deps.log(`a prompt not on RPE's connection went on untouched after the extension failed: ${error instanceof Error ? error.message : String(error)}`);
        return messages;
      }
      if (error instanceof Stop) throw error;
      throw new Error(`RPE stopped this reply before it was sent, because its extension failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

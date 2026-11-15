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
// line saying why rather than sent on untagged. Where it cannot tell whose chat it is, neither RPE's
// registration nor the connection's own record being readable (N-3), that generation alone is stopped
// and what failed is recorded. What it cannot hold is its worker being stopped mid-generation: Lumiverse
// then fails the pending call for any chat (`worker-host.ts:1572-1575`).
//
// A continue's target is a first word, checked (R-192): Lumiverse moves the message it continues to the
// prompt's end, no longer history and with no source (`prompt-assembly.service.ts:742-768`), so the tag
// names the message the lore stage noted only where the moved message's text begins with that message's
// shown text; else the target is not known, with the swipe Lumiverse announced. The tie is always the
// message Lumiverse names when the generation ends.

import { isRecord } from "../shared/json";
import type { CheckStopped } from "../adapter/lumiverse/pipe-wire";
import { historyCut, replyKindOf, TAG_FIELD, textHash, type Role, type Tag, type TagMessage } from "../adapter/lumiverse/wire";
import type { Generations, Handoff } from "./generations";
import type { Whose } from "./registration";
import type { InterceptorReturn, PromptMessageDTO } from "./spindle";

export interface PromptDeps {
  generations: Generations;
  /** Whose chat a reply on this user's connection is. */
  whose(connection: string, user: string): Promise<Whose>;
  granted(permission: string): boolean;
  log(message: string): void;
  /** A generation stopped because whose chat it was could not be told: its record. */
  stopped(user: string, record: CheckStopped): void;
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

/** A message's text as Lumiverse reads it: a string, or its text parts run together (`llm/types.ts:109-115`); and the length of each text part, and how many other parts. */
function textOfContent(content: unknown): { text: string; parts?: number[]; media: number } {
  if (typeof content === "string") return { text: content, media: 0 };
  if (!Array.isArray(content)) return { text: "", media: 0 };
  const texts: string[] = [];
  let media = 0;
  for (const part of content) {
    if (isRecord(part) && part.type === "text" && typeof part.text === "string") texts.push(part.text);
    else media++;
  }
  return { text: texts.join(""), parts: texts.map((t) => t.length), media };
}

/**
 * The message a continue continues, checked: the last one not history and Lumiverse's assistant's (the
 * one it moved to the end, its postfix after it), whose text begins with the shown text the lore stage
 * noted; null where nothing was noted or moved, or the two do not agree.
 */
function continuedTarget(messages: readonly PromptMessageDTO[], noted: Handoff["continued"]): string | null {
  if (noted === null || noted.text === "") return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "assistant" || m.__isChatHistory === true) continue;
    return textOfContent(m.content).text.startsWith(noted.text) ? noted.id : null;
  }
  return null;
}

/** A message as the tag lists it: its text is its content's text parts run together, as Lumiverse reads it (`llm/types.ts:109-115`). */
export function listedMessage(m: PromptMessageDTO): TagMessage {
  const role: Role = m.role === "system" || m.role === "assistant" ? m.role : "user";
  const { text, parts, media } = textOfContent(m.content);
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
      const whose = await deps.whose(ctx.connection, ctx.user);
      if ("unknown" in whose) {
        deps.stopped(ctx.user, { at: Date.now(), chat: ctx.chat, generation: deps.generations.pending(ctx.user, ctx.chat)?.id ?? null, connection: ctx.connection, registration: whose.unknown.registration, mark: whose.unknown.mark });
        throw new Stop("RPE stopped this reply: its extension could not tell whether this chat is one RPE plays, because neither RPE's registration nor this connection's record in Lumiverse could be read. Send it again; RPE's log says what failed.");
      }
      ours = whose.rpe;
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
        target: kind === "continue" ? { message: continuedTarget(messages, handoff?.continued ?? null), swipe: generation.target.swipe } : generation.target,
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
      if (error instanceof Stop) throw error;
      if (!ours) {
        deps.log(`a prompt not on RPE's connection went on untouched after the extension failed: ${error instanceof Error ? error.message : String(error)}`);
        return messages;
      }
      throw new Error(`RPE stopped this reply before it was sent, because its extension failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
}

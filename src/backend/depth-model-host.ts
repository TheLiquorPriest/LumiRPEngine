// The depth roles' model port bound to the user's settings (DEPTH-PLAN §5.1, §7; owner D-3: every
// place a model is used is the user's to set). Each call reads Settings → Depth as it stands, so a
// change of a role's connection, model or effort applies from the next call; it goes through the
// host's quiet generation on the user's own connection, streamed, with usage asked for; a call
// that fails transiently (a dropped connection, 429, 5xx) is made again after a short wait. One
// whose answer room its provider refuses as over the model's is made again once at the limit the
// refusal states, and a limit that is the model's own is kept for its connection and model while the
// process runs, so later calls ask within it; one refused for its room, credits or a length with no
// limit stated (a 400 or 402) is made again once at its role's own room. Each answered call adds its
// tokens to what depth spent today (`depth/budget.ts`, the per-day ceiling), but the bootstrap's,
// which has its own cap.
//
// Each call keeps its port's line on its connection (§5.3, §6.2; `connectionPlace`, the gate agent
// turns' calls share): a turn's scene is the foreground and goes first; everything else is
// background, at most Settings → Depth → Background calls at once of it under way on a connection;
// the bootstrap is idle, held to its own at-once settings. Where the connection's own Calls at once
// (Settings → Agents → Throttles, Speed → Calls) is full, a background or idle call gives its place
// up to a foreground one and is made again once it has a place, its prompt counted as spent.

import type { UserId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import { isRecord } from "../shared/json";
import type { UserSettings } from "../shared/settings";
import { depthCall } from "../shared/depth-settings";
import type { HostPort, QuietRequest, QuietResult } from "./host";
import type { ModelPort, PortCall, PortUsage } from "./depth/port";
import { maxTokensLimit, requestRefused, TRANSIENT_RETRIES, transientFailure } from "./steps";
import { tokensOf } from "./book";
import { daySpendOf, type DaySpend } from "./depth/budget";
import { connectionPlace, minuteRoom, minuteWindowOf, ownBreakpoints, SYSTEM_CLOCK, type AccountsClock, type GateLane } from "./agents/provider";
import type { HostConnectionProfile, QuietMessage } from "./host";

/**
 * A depth call's messages as the host takes them: on a connection whose provider takes explicit
 * cache breakpoints with one left to spend after its own, the leading system message (the role's
 * stable instructions, the author's or a character's) carries one, so the next call of that role
 * reads it from the cache (§6.6). Everywhere else, plain texts.
 */
export function cachedMessages(messages: readonly { role: QuietMessage["role"]; content: string }[], cache: HostConnectionProfile["cache"] | undefined): QuietMessage[] {
  const out: QuietMessage[] = messages.map((m) => ({ role: m.role, content: m.content }));
  const first = out[0];
  if (!cache || cache.limit - ownBreakpoints(cache, 0) < 1 || !first || first.role !== "system" || first.content === "" || out.length < 2) return out;
  out[0] = { ...first, parts: [{ type: "text", text: first.content, cache: true }] };
  return out;
}

/** The first wait before a transient failure is asked again; it doubles each time. */
const RETRY_WAIT_MS = 2000;

/** What a call cost as the provider reported it (OpenRouter's `cost`, at the top or in `provider_raw`), when it did. */
function reportedCost(usage: JsonObject | undefined): number | undefined {
  if (!usage) return undefined;
  const raw = isRecord(usage.provider_raw) ? usage.provider_raw : null;
  for (const v of [usage.cost, raw?.cost, isRecord(raw?.usage) ? raw.usage.cost : undefined]) if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

/** The tokens of the answer the model spent reasoning, where the provider reports them apart (`completion_tokens_details` or `output_tokens_details`, at the top or in `provider_raw`). */
function reasoningTokens(usage: JsonObject | undefined): number | undefined {
  if (!usage) return undefined;
  const raw = isRecord(usage.provider_raw) ? usage.provider_raw : null;
  for (const d of [usage.completion_tokens_details, usage.output_tokens_details, raw?.completion_tokens_details, raw?.output_tokens_details]) {
    if (!isRecord(d)) continue;
    const n = d.reasoning_tokens ?? d.thinking_tokens;
    if (typeof n === "number" && Number.isInteger(n) && n >= 0) return n;
  }
  return undefined;
}

/** A provider's request id from the usage the host passed (its `id`, in `provider_raw` or at the top), when it said one: the provenance every loopback call reports (§9.0). */
export function requestIdOf(usage: JsonObject | undefined): string | null {
  const raw = usage && isRecord(usage.provider_raw) ? usage.provider_raw : usage;
  return raw && typeof raw.id === "string" && raw.id !== "" ? raw.id : null;
}

function usageOf(r: QuietResult, promptChars: number): PortUsage {
  const cost = reportedCost(r.usage);
  const reasoningOut = reasoningTokens(r.usage);
  return {
    tokensIn: r.tokensIn ?? Math.ceil(promptChars / 3.2),
    tokensOut: r.tokensOut ?? Math.max(0, r.tokens - (r.tokensIn ?? 0)) ?? tokensOf(r.content),
    ...(reasoningOut !== undefined ? { reasoningOut } : {}),
    ...(cost !== undefined ? { cost } : {}),
  };
}

/**
 * A call its provider refused (finish or stop reason `refusal`, Anthropic's for its classifiers): the
 * answer is no misread JSON but a refusal, so its error says so, in the provider's own words where
 * it gave them (`stop_details`' explanation and category), and it isn't asked again.
 */
export class ProviderRefusal extends Error {
  /** What the refused call spent, and where it ran: the turn's report counts it (`scene/reporting.ts`). */
  usage?: PortUsage;
  call?: PortCall;
  constructor(
    readonly role: string,
    readonly category: string | null,
    readonly explanation: string | null,
  ) {
    super(`the ${role}'s call was refused by its provider (stop reason refusal${category ? `, category ${category}` : ""})${explanation ? `: ${explanation}` : ", with no reason given"}`);
    this.name = "ProviderRefusal";
  }
}

/** The refusal a call's answer is, when its finish reason says it is one (`ProviderRefusal`); else null. */
function refusalOf(role: string, r: Pick<QuietResult, "finishReason" | "stopDetails">): ProviderRefusal | null {
  if (r.finishReason.toLowerCase() !== "refusal") return null;
  const [category, explanation] = [r.stopDetails?.category, r.stopDetails?.explanation].map((v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null));
  return new ProviderRefusal(role, category ?? null, explanation ?? null);
}

async function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
  await promise;
}

/**
 * The answer rooms providers said each connection's model takes (`maxTokensLimit`'s `fixed`), keyed
 * by the connection the call keeps its line on and the model asked for ("" for the connection's own),
 * a line apart: kept in memory for the process, so a call asks within it from the first attempt.
 */
export type LearnedRooms = Map<string, number>;

const LEARNED_ROOMS: LearnedRooms = new Map();

/** How a port's calls are counted and queued. */
export interface DepthPortOptions {
  /** Where today's spend is kept: the host's day store by default; null for the bootstrap, which counts against its own cap. */
  day?: DaySpend | null;
  /** The line its calls keep on their connection: "foreground" for a turn's scene, "idle" for the bootstrap, "background" (the default) for everything else. */
  lane?: GateLane;
  /** Where the rooms providers stated are kept: the process's by default. */
  rooms?: LearnedRooms;
  /** The per-minute throttle's clock: the system's by default (tests pass their own). */
  clock?: AccountsClock;
}

/**
 * The settings-bound port for one user: each depth role on the connection, model and effort Settings →
 * Depth gives it; each answer says which connection and model gave it (the turn's provenance,
 * `scene/reporting.ts`) and adds its tokens to `o.day`. Providers pass an answer room through as
 * asked, so one over what the model takes is refused: the call is made again once at the limit the
 * refusal states (`maxTokensLimit`), logged, and that limit, where it is the model's own, is kept
 * for the connection and model (`o.rooms`), so later calls ask within it. A call that asked more
 * than its role's own room (Settings → Depth) and is refused otherwise, a 4xx but 429 stating no
 * limit (`requestRefused`: OpenRouter's 402, a 413, a 422), is made again once at that room,
 * logged. An answer whose room was held below what was asked says so (`capped`). Each attempt holds
 * a place in its connection's line (`o.lane`) while it runs; one that gives its place up to a
 * turn's call counts its prompt as spent, is logged, and waits in line again. An answer whose
 * finish reason is `refusal` fails as the provider's refusal, in its own words (`ProviderRefusal`),
 * its tokens counted, and isn't asked again. The call's stable instructions carry a cache breakpoint
 * where its connection takes one (`cachedMessages`).
 */
export function depthPort(host: Pick<HostPort, "models" | "log" | "storage"> & Partial<Pick<HostPort, "connections">>, settings: (userId: UserId) => Promise<Readonly<UserSettings>>, userId: UserId, o: DepthPortOptions = {}): ModelPort {
  const day = o.day === undefined ? daySpendOf(host) : o.day;
  const lane = o.lane ?? "background";
  const rooms = o.rooms ?? LEARNED_ROOMS;
  const clock = o.clock ?? SYSTEM_CLOCK;
  return async (role, messages, opts = {}) => {
    const s = await settings(userId);
    const call = depthCall(s, role);
    const signal = opts.signal ?? new AbortController().signal;
    const promptChars = messages.reduce((n, m) => n + m.content.length, 0);
    // The default connection keeps its line under its own id, as agent turns' calls on it do.
    const connection = call.connectionId ?? (await host.connections?.active(userId).catch(() => null))?.id ?? "";
    const cache = (await host.connections?.profile?.(call.connectionId ?? null, userId).catch(() => null))?.cache;
    const room = `${connection}\n${call.model ?? ""}`;
    const asked = opts.maxTokens ?? call.maxTokens;
    const learned = rooms.get(room);
    let maxTokens = learned !== undefined && learned < asked ? learned : asked;
    let capped: { asked: number; limit: number } | null = maxTokens < asked ? { asked, limit: maxTokens } : null;
    // Each of the two room retries is made once: at a limit the refusal stated, and at the role's own room.
    let restated = false;
    let fellBack = false;
    // The prompts of attempts that gave their place up, as estimated: they were sent, so they count.
    let gaveWay = 0;
    for (let attempt = 0; ; ) {
      // Aborted when a foreground call needs this attempt's place: the call gives it up and waits in line again.
      const giving = new AbortController();
      let release = (): void => undefined;
      let pause = 0;
      let sending = false;
      try {
        release = await connectionPlace(host, userId, connection, s.agents.throttles, signal, s.agents.callsAtOnce, lane === "foreground" ? {} : { lane, ...(lane === "background" ? { background: s.depth.background.atOnce } : {}), giveWay: () => giving.abort(new Error("it gave its place on its connection to a turn's call")) });
        // The connection's per-minute throttle (Settings → Agents → Throttles), shared with agent turns' calls, the foreground first as room frees.
        const throttle = s.agents.throttles.find((t) => t.id === connection);
        const entry = await minuteRoom(minuteWindowOf(host, userId), connection, Math.ceil(promptChars / 3.2) + maxTokens, throttle, AbortSignal.any([signal, giving.signal]), clock, lane);
        sending = true;
        const request: QuietRequest = {
          messages: cachedMessages(messages, cache),
          maxTokens,
          json: opts.json ?? false,
          connectionId: call.connectionId,
          model: call.model,
          effort: opts.effort ?? call.effort,
          params: opts.params ? { ...call.params, ...opts.params } : call.params,
          usage: true,
          stream: true,
        };
        const sent = AbortSignal.any([signal, giving.signal]);
        // A stage that shows the reasoning as it comes takes each piece the host streams (core passes them token by token).
        const onReasoning = opts.onReasoning;
        const r = onReasoning ? await host.models.stream(request, userId, sent, (piece) => piece.kind === "reasoning" && onReasoning(piece.text)) : await host.models.quiet(request, userId, sent);
        const answered = usageOf(r, promptChars);
        entry.tokens = answered.tokensIn + answered.tokensOut;
        day?.add(userId, answered.tokensIn + answered.tokensOut);
        const refused = refusalOf(role, r);
        if (refused) {
          // What it spent goes with it, so the turn's report counts the refused call too (review-last).
          refused.usage = answered;
          const refusedId = requestIdOf(r.usage);
          refused.call = { connection: call.connectionId ?? "", model: r.model ?? call.model ?? "", ...(refusedId ? { requestId: refusedId } : {}) };
          throw refused;
        }
        const usage = gaveWay > 0 ? { ...answered, tokensIn: answered.tokensIn + gaveWay } : answered;
        const requestId = requestIdOf(r.usage);
        return { text: r.content, ...(r.reasoning ? { reasoning: r.reasoning } : {}), usage, ...(r.finishReason ? { finish: r.finishReason } : {}), call: { connection: call.connectionId ?? "", model: r.model ?? call.model ?? "", ...(requestId ? { requestId } : {}) }, ...(capped ? { capped } : {}), room: maxTokens };
      } catch (error) {
        if (error instanceof ProviderRefusal) throw error;
        if (giving.signal.aborted && !signal.aborted) {
          // One that gave its place up before it was sent spent nothing.
          const sent = sending ? Math.ceil(promptChars / 3.2) : 0;
          gaveWay += sent;
          day?.add(userId, sent);
          host.log("info", `[LumiRPEngine] depth ${role} call gave its place on its connection to a turn's call; it waits in line again, its prompt (about ${sent} tokens) counted as spent`, userId);
          continue;
        }
        const stated = restated || signal.aborted ? null : maxTokensLimit(error);
        if (stated !== null && stated.limit < maxTokens) {
          host.log("warn", `[LumiRPEngine] depth ${role} call's answer room of ${maxTokens} tokens is over what ${call.model ?? "its model"} takes, as its provider said; asking again at ${stated.limit}: ${error instanceof Error ? error.message : String(error)}`, userId);
          if (stated.fixed) rooms.set(room, stated.limit);
          restated = true;
          maxTokens = stated.limit;
          capped = { asked, limit: maxTokens };
          continue;
        }
        if (!fellBack && !signal.aborted && call.maxTokens < maxTokens && requestRefused(error)) {
          host.log("warn", `[LumiRPEngine] depth ${role} call's answer room of ${maxTokens} tokens was refused with no limit stated; asking again at the role's own room of ${call.maxTokens}: ${error instanceof Error ? error.message : String(error)}`, userId);
          fellBack = true;
          maxTokens = call.maxTokens;
          capped = { asked, limit: maxTokens };
          continue;
        }
        if (signal.aborted || attempt >= TRANSIENT_RETRIES || !transientFailure(error)) throw error;
        host.log("warn", `[LumiRPEngine] depth ${role} call failed, asking again: ${error instanceof Error ? error.message : String(error)}`, userId);
        pause = RETRY_WAIT_MS * 2 ** attempt;
        attempt += 1;
      } finally {
        release();
      }
      await wait(pause, signal);
    }
  };
}

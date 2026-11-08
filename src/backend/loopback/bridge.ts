// The loopback's bridge (DEPTH-PLAN §3): LumiRPEngine's side of the standalone relay
// (`lumirpengine loopback`, src/cli/loopback*.ts; the contract is src/shared/loopback.ts).
//
// - The turn tagger, LumiRPEngine's one prompt interceptor (D0a check 2), runs last: for a world
//   chat's generation the guard let straight on because its connection is the loopback, it mints a
//   single-use token keyed to the chat and the generation (`lre_turn`), and keeps the prompt as it
//   saw it, every message with its source (F6), until the generation ends.
// - The World Info interceptor's verdict for that generation's prompt gives each engine entry the
//   turn fills its mark (`marked`), so the prompt shows where core placed each section (`compose.ts`).
// - The relay's requests arrive as protocol requests from its own session; each but `register`
//   carries its secret, and that session is where its pushes go from then on. A tagged request
//   (`begin`) runs the turn: today's engine run inside the provider call (`LedgerService.loopbackRun`),
//   then, for a chat on depth, the depth turn (A2) with the narrator's short context as its frame
//   (`short-context.ts`, B2), and a reply there no scene plays (a Continue, a turn under a pause, a
//   Re-narrate of a pre-depth reply) from that short context too; for any other chat, the narrator on
//   the user's own Settings → Depth → Narrator connection, its prompt the final body with the run's
//   sections in their places (`compose.ts`), streamed back as chunks. An untagged one
//   (`passthrough`) runs as given on that same connection, tools and non-stream included.
// - Chunks are numbered per call and kept until the relay acks them; `resend` pushes them again,
//   `hello` resumes every call the relay still holds, and the relay's ping names its calls under way,
//   answered with those LumiRPEngine no longer holds (a worker restart, D0a check 4), which it ends.
// - Abort (core's Stop, F19) cancels the turn's engine run and narrator call; a turn's end commits
//   only once its work is over (`settled`).
// - Trust (§3.11, D-8): a relay in `user` mode carries only its own account's turns, and the key and
//   the token must be the same user's; the shared relay is the operator's explicit choice, and its
//   untagged requests are held to their limits here. A connection is the loopback by the address of
//   its own user's relays only, so no account's registration changes how another's connections read.
//   A world chat's reply on the loopback is tagged or stopped, never sent untagged (§3.14).
// - Every model call the turn made (role, connection, model, request id, tokens, time) is its
//   provenance: in the finish chunk's usage and on the turn's inspector record (§9.0).

import type { ChatId, MessageId, UserId } from "../../shared/ids";
import type { JsonObject } from "../../shared/json";
import { isRecord } from "../../shared/json";
import type { ChainEntry, ContentId, GenerationKind, LedgerEvent, PendingTurn } from "../../shared/ledger";
import type { LoopbackAbortRequest, LoopbackAckRequest, LoopbackBeginRequest, LoopbackChunk, LoopbackHelloRequest, LoopbackModelCall, LoopbackModelsRequest, LoopbackPage, LoopbackPassthroughRequest, LoopbackPingRequest, LoopbackRegisterRequest, LoopbackRelayView, LoopbackResendRequest, LoopbackResultBodies, RelayReport } from "../../shared/loopback";
import type { CallMisread } from "../../shared/misread";
import { HEARTBEAT_MS, LOOPBACK_API, LOOPBACK_MAX_BODY_BYTES, LOOPBACK_MODEL, loopbackUnready, RELAY_NAME, relayUnitName, SHARED_PASSTHROUGH_PER_MINUTE, shellWord, SYSTEM_CONFIG_DIR, SYSTEM_RELAY_DIR, TURN_PARAM, terminal } from "../../shared/loopback";
import type { ErrorCode, LoopbackPageRequest } from "../../shared/protocol";
import { PROTOCOL_VERSION } from "../../shared/protocol";
import { KIT_FILE } from "../../shared/agents";
import { depthCall } from "../../shared/depth-settings";
import type { UserSettings } from "../../shared/settings";
import type { HostConnectionProfile, HostGenerationType, HostMessage, PromptInterceptorInput, PromptMessage, PromptVerdict, QuietMessage, QuietRequest, QuietResult, WorldInfoInput, WorldInfoVerdict } from "../host";
import type { LoopRun } from "../ledger-io";
import type { Runtime } from "../runtime";
import type { PlacedSection, PromptShape } from "./compose";
import { markOf, maxTokensOf, quietMessages, quietTools, samplingOf, toolCallChunks, toolChoiceOf, turnEntries, withSections } from "./compose";
import { BEATS_TELL, shortContext, type Absorption, type ShortContext, type ShortContextRead } from "./short-context";
import type { TurnSink } from "./sink";
import { LoopbackStore, randomHex, relayReportOf, RELAYS_PER_USER, sha256, TEXT_MAX, type RelayRecord } from "./store";
import { requestIdOf } from "../depth-model-host";
import { contentId, sameContent } from "../../engine/ledger/path";

/** A refusal the relay reads as `lre.error` with its code (`forbidden` becomes a bad key to core's Test). */
export class LoopbackRefused extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LoopbackRefused";
  }
}

/** A2's depth turn (scene/turn.ts) for a loopback generation: what it gets once the engine run is done. */
export interface DepthTurnCtx {
  chatId: ChatId;
  userId: UserId;
  generationId: string;
  /** The turn's token: unique per generation. */
  token: string;
  kind: GenerationKind;
  /** The engine run's turn, adopted by the generation: its planned events in order, kind, seed, message and swipe. */
  turn: PendingTurn | null;
  /** What the player asked this swipe's telling to change (the swipe chip's What should change?), when he asked anything: the author reads it among his signals (DEPTH-PLAN §3.9). */
  direction?: string;
  /** The record of the depth reply the player just deleted, when this new reply redoes it (the input area's Regenerate, §3.9): the runner tells its beats again where his swipe setting says Re-narrate, else the scene plays again. */
  redo?: DepthRedo;
  /** The narrator's frame (`short-context.ts`): its short context, with a part closing the window. */
  frame: (part: string) => QuietMessage[];
  body: JsonObject;
  sink: TurnSink;
  /** Stop: the scene stops between beats. */
  signal: AbortSignal;
}

/** A depth reply's record as its scene handed it over: its pre and its read part (its prose). */
export interface DepthRedo {
  pre: readonly LedgerEvent[];
  read: readonly LedgerEvent[];
}

/** A depth reply's swipe as its scene played it: its record, and the message its turn answered by its id and text (`answeredOf`), which a redo of it must answer as it was. */
interface SceneSwipe {
  redo: DepthRedo;
  answered: { id: MessageId; content: ContentId };
}

/** What a depth turn hands the commit; null when the chat isn't on depth, so the bridge narrates as B1 does. `error`: a stage failed once a passage had streamed, and the scene is cut where the last one streamed, as a Stop cuts it. */
export interface DepthCommit {
  pre: LedgerEvent[];
  read: LedgerEvent[];
  blobs: Record<string, string>;
  error?: string;
}

export type DepthRunner = (ctx: DepthTurnCtx) => Promise<DepthCommit | null>;

/** Lumiverse runs interceptors lowest priority first: the tagger runs after every other (D0a check 2). */
export const TAGGER_PRIORITY = 1_000_000;
/** The generation types the tagger tags (§3.5): every one the engine plays. */
const TAGGED: readonly HostGenerationType[] = ["normal", "continue", "regenerate", "swipe", "impersonate"];
/** A token lives as long as a turn may: past this its generation is surely over. */
const TOKEN_MS = 2 * 60 * 60_000;
/** How long text waits to be sent with what follows it (core's own stream interval, §3.6). */
const COALESCE_MS = 40;
/** How often calls long over are forgotten. */
const SWEEP_MS = 60_000;
/** A call whose terminal chunk was never acked is forgotten after this. */
const FORGET_MS = 10 * 60_000;
/** How long a connection's loopback check holds before it is read again. */
const CONNECTION_MS = 30_000;
/** How long a generation's end waits for its turn's work to settle. */
const SETTLE_MS = 30_000;
const CALL_ID = /^[0-9a-f]{32}$/;

const STREAM_OFF = "This world chat's preset has streaming off, and a LumiRPEngine turn streams its thinking and its reply as it goes: turn Streaming on in the preset (its completion settings), or give this chat a preset that streams. LumiRPEngine never changes your preset.";
const UNTAGGED = "LumiRPEngine can't tell this untagged request from your world chat's reply under way, because this Lumiverse doesn't stop a reply its tagger missed: it refuses it rather than let a world chat's reply out unrecorded. Wait for the reply, then try again.";
const UNSTARTED = "LumiRPEngine couldn't tie this world chat's reply on the loopback to a turn (it didn't hear the reply start), so it stopped it rather than let it out untracked. Generate again.";
/** The window `SHARED_PASSTHROUGH_PER_MINUTE` counts in. */
const MINUTE_MS = 60_000;

/** The relays as they live now: where their pushes go (the session that last spoke for them) and what they last said. */
interface LiveRelay {
  user: UserId;
  session: string | null;
  seenAt: number;
  report: RelayReport | null;
}

/** A turn's work across its tool rounds: the engine run (once), and what the turn's calls made. */
interface TurnState {
  run: Promise<LoopRun>;
  /** The id the turn's inspector record goes by once its run delivered: the generation's, since the generation's adoption renamed the engine run's record (`Runtime.adopted`), a kept turn's retry's too; null before. */
  record: string | null;
  /** How many messages the turn's first call carried: a tool round's body is that prompt with the tools' exchange after it (F29). */
  opened: number;
  startedAt: number;
  firstContentAt: number | null;
  calls: LoopbackModelCall[];
  /** Each call whose answer its stage's parse didn't keep whole, with the fields and the answer as written: on the inspector's record of the call, never in the finish chunk's usage. */
  misread: Map<LoopbackModelCall, CallMisread>;
  /** The reply the turn writes (its message and swipe), once its run named it: what the inspector joins a reply to its provenance by. */
  reply: { messageId: string; swipeId: number } | null;
}

/** A turn token (§3.5): minted for one generation, admitting its tool rounds until it ends. */
interface Token {
  token: string;
  userId: UserId;
  chatId: ChatId;
  generationId: string;
  type: HostGenerationType;
  at: number;
  shape: PromptShape;
  /** The prompt as the tagger saw it, each message with its source: the depth narrator's short context is made from it. Let go once the generation ends. */
  prompt: readonly PromptMessage[] | null;
  turn: TurnState | null;
  ended: boolean;
}

/** One provider call the relay carries (§3.6): its chunks kept until acked. */
interface Call {
  id: string;
  relay: string;
  userId: UserId;
  /** The turn's generation for a tagged call; null for passthrough. */
  generationId: string | null;
  chatId: ChatId | null;
  turn: TurnState | null;
  held: Map<number, LoopbackChunk>;
  last: number;
  done: boolean;
  doneAt: number | null;
  /** Counted off its generation's work (`ended`): once, however its work ends. */
  over: boolean;
  startedAt: number;
  abort: AbortController;
  buffer: { kind: "reasoning" | "content"; text: string } | null;
  timer: ReturnType<typeof setTimeout> | null;
  models: LoopbackModelCall[];
}

/** What a chat's loopback turn hears of its engine run while it runs: stage lines, agents' thinking, model calls. */
interface Watcher {
  progress(label: string): void;
  reasoning: ((text: string) => void) | null;
  call(call: LoopbackModelCall): void;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** A relay's address: a host name, or an IP address (an IPv6 one bracketed or not, with its zone). */
const LISTEN = /^[A-Za-z0-9._:%[\]-]+$/;

/** Whether a connection is the loopback (§3.4): a Custom connection naming `lre-narrator`, or one whose base URL is the address of one of `relays`, the asking user's own. */
function looksLoopback(profile: HostConnectionProfile, relays: readonly RelayRecord[]): boolean {
  if (profile.provider !== "custom") return false;
  if (profile.model === LOOPBACK_MODEL) return true;
  let url: URL;
  try {
    url = new URL(profile.url);
  } catch {
    return false;
  }
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  const host = url.hostname.toLowerCase();
  return relays.some((r) => r.port === port && (r.listen.toLowerCase() === host || (LOOPBACK_HOSTS.has(r.listen.toLowerCase()) && LOOPBACK_HOSTS.has(host))));
}

/** The page's own address as the one line names it: an http(s) origin, else none. */
function originOf(origin: string | undefined): string | null {
  if (typeof origin !== "string") return null;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What the thinking block says a turn of this kind does (§3.9): the user's swipe setting decides a swipe (D-4); a redo of a deleted depth reply is the runner's to say. */
function kindWords(kind: GenerationKind | undefined): string | null {
  if (kind === "renarrate") return "Re-narrating, as your swipe setting says: the same beats, told afresh";
  if (kind === "swipe" || kind === "regenerate") return "Re-running, as your swipe setting says: the scene plays again from the same moment";
  if (kind === "continue") return "Continuing the reply from where it ends";
  return null;
}

/** The message a turn's reply answers: the last of the chain its turn was planned on but the reply's own message (a new reply's, staged blank as its generation started, may end it). */
function answeredOf(turn: PendingTurn, reply: string | undefined): ChainEntry | undefined {
  return turn.chain.findLast((e) => e.id !== reply);
}

/** What the thinking block says of a reply on a chat on depth that no scene plays (DEPTH-PLAN §1.3): why, and that nothing reads it into the story. */
function unreadWords(kind: GenerationKind, planned: boolean): string {
  if (kind === "continue") return "A scene doesn't carry on a reply yet: the narrator writes on from where it ends, and nothing reads what it adds into the story";
  const why = kind === "renarrate" ? "it re-tells a reply written before the chat went on depth" : planned ? "no scene could be set for it" : "the turn was made while the chat was paused";
  return `No scene plays this reply (${why}): the narrator writes it as before, and nothing reads it into the story`;
}

/** What the depth narrator reads (B2), as the thinking block says it: a scene's beats, or, for a reply no scene plays, the preset and the window alone. */
function contextWords(read: ShortContextRead, absorption: Absorption, scene: boolean): string {
  const preset = absorption === "narrator" ? "LumiRPEngine's own template instead of your preset" : "your preset as it is";
  const recent = read.messages === 0 ? "none of the chat's messages" : `the chat's last ${read.messages === 1 ? "message" : `${read.messages} messages`} (about ${read.tokens} tokens)`;
  const left = read.left > 0 ? ` The ${read.left} earlier ${read.left === 1 ? "message stays" : "messages stay"} out of its prompt.` : "";
  return scene ? `The narrator reads ${preset}, ${recent}, and this scene's beats.${left}` : `The narrator reads ${preset} and ${recent}.${left}`;
}

export class LoopbackBridge {
  readonly store: LoopbackStore;
  /** A2's depth turn, once it lands: it runs instead of today's narrator for a chat on depth. */
  depth: DepthRunner | null = null;
  private readonly live = new Map<string, LiveRelay>();
  private readonly calls = new Map<string, Call>();
  private readonly tokens = new Map<string, Token>();
  private readonly byGeneration = new Map<string, Token>();
  /** Calls the relay gave up before LumiRPEngine heard their start (tolerated, §3.10). */
  private readonly early = new Set<string>();
  /** Each user's connections as `isLoopback` last read them, for `CONNECTION_MS`. */
  private readonly checked = new Map<string, { at: number; loop: boolean }>();
  private readonly watchers = new Map<ChatId, Watcher & { label: string | null }>();
  /** Each chat's last depth reply: its message, the swipe it shows, and each of its swipes a scene played. Deleting exactly that reply makes the chat's next new reply the redo of the swipe it showed (§3.9). */
  private readonly lastScene = new Map<ChatId, { messageId: MessageId; shown: number; swipes: Map<number, SceneSwipe> }>();
  /** A chat whose last depth reply the player deleted: the swipe it showed, which the next new reply redoes where it answers the same message, its text as it was; that message deleted or its text changed, or a message of his own sent, it is gone. */
  private readonly redos = new Map<ChatId, SceneSwipe>();
  /** Each generation's turn work under way: its end waits on it (`settled`). */
  private readonly working = new Map<string, { calls: number; done: PromiseWithResolvers<void> }>();
  /** The shared relay's untagged requests in the last minute, by the key's user (D-8). */
  private readonly passthroughs = new Map<UserId, number[]>();
  private sweep: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly rt: Runtime) {
    this.store = new LoopbackStore(rt.host);
  }

  start(): void {
    const host = this.rt.host;
    // Required where the host can stop a reply its tagger failed on (F8): a world chat's reply never goes out untagged.
    host.registerPromptInterceptor((input) => this.tag(input), { priority: TAGGER_PRIORITY, generationTypes: TAGGED, required: host.capabilities.interceptors });
    const over = (generationId: string): void => {
      const token = this.byGeneration.get(generationId);
      if (!token) return;
      token.ended = true;
      token.prompt = null;
    };
    host.on("GENERATION_ENDED", (e) => over(e.generationId));
    host.on("GENERATION_STOPPED", (e) => {
      over(e.generationId);
      for (const call of this.calls.values()) if (call.generationId === e.generationId && !call.done) call.abort.abort(new Error("you stopped the reply"));
    });
    host.on("MESSAGE_DELETED", (e) => {
      // The message a redo answers is gone: no reply answers it now.
      if (this.redos.get(e.chatId)?.answered.id === e.messageId) this.redos.delete(e.chatId);
      // Deleting exactly the chat's last depth reply makes its next new reply the redo of the swipe it showed (the input area's Regenerate, §3.9); the blank reply of a send stopped before any text is LumiRPEngine's own deletion, never a redo's.
      const last = this.lastScene.get(e.chatId);
      if (!last || last.messageId !== e.messageId || this.rt.ledger.deletedByEngine(e.messageId)) return;
      this.lastScene.delete(e.chatId);
      const shown = last.swipes.get(last.shown);
      if (!shown) return;
      this.redos.set(e.chatId, shown);
      if (this.redos.size > 256) this.redos.delete(this.redos.keys().next().value ?? "");
    });
    // The swipe the last depth reply shows as he navigates, adds and deletes its swipes (the host shifts the later ones down): the one deleting the reply redoes.
    host.on("MESSAGE_SWIPED", (e) => {
      const last = this.lastScene.get(e.chatId);
      if (last?.messageId === e.message.id) {
        if (e.action === "deleted") {
          const swipes = new Map<number, SceneSwipe>();
          for (const [s, kept] of last.swipes) if (s !== e.swipeId) swipes.set(s > e.swipeId ? s - 1 : s, kept);
          last.swipes = swipes;
        }
        last.shown = e.message.swipeId;
      }
      this.retexted(e.chatId, e.message);
    });
    host.on("MESSAGE_EDITED", (e) => this.retexted(e.chatId, e.message));
    // A message of his own is a new turn, never a redo.
    host.on("MESSAGE_SENT", (e) => {
      if (e.message.isUser) this.redos.delete(e.chatId);
    });
    this.rt.diag.observer = {
      activity: (chatId, label) => {
        const w = this.watchers.get(chatId);
        if (!w || label === w.label) return;
        w.label = label;
        w.progress(label);
      },
      call: (chatId, call) => this.watchers.get(chatId)?.call(call),
    };
    this.rt.live.observer = (chatId, entry) => {
      const reasoning = this.watchers.get(chatId)?.reasoning;
      if (reasoning && entry.kind === "answer" && typeof entry.reasoning === "string" && entry.reasoning.trim() !== "") reasoning(`\n${entry.reasoning.trim()}\n`);
    };
    this.sweep = setInterval(() => {
      const now = Date.now();
      for (const [id, call] of this.calls) if (call.done && call.doneAt !== null && now - call.doneAt > FORGET_MS) this.calls.delete(id);
    }, SWEEP_MS);
    // A timer that keeps nothing alive: Bun's has `unref`.
    const timer: { unref?: () => void } = this.sweep;
    timer.unref?.();
  }

  stop(): void {
    clearInterval(this.sweep ?? undefined);
    this.sweep = null;
  }

  // ---------------------------------------------------------------- the loopback connection

  /**
   * Whether a generation on this connection goes through the loopback (the guard's question, §3.4).
   * Only the user's own relays say so by their address: another account's registration never
   * changes how this user's connections read (§3.7, §3.11). A registry that can't be read now
   * matches no address, and the answer isn't kept, so the next question reads it again.
   */
  async isLoopback(connectionId: string | null, userId: UserId): Promise<boolean> {
    const key = `${userId}\u0000${connectionId ?? ""}`;
    const known = this.checked.get(key);
    if (known && Date.now() - known.at < CONNECTION_MS) return known.loop;
    const profile = await this.rt.host.connections.profile(connectionId, userId).catch(() => null);
    let own: RelayRecord[] = [];
    if (profile !== null) {
      try {
        own = Object.values((await this.store.read()).relays).filter((r) => r.user === userId);
      } catch (error) {
        this.rt.host.log("warn", `[LumiRPEngine] ${messageOf(error)}`, userId);
        return looksLoopback(profile, []);
      }
    }
    const loop = profile !== null && looksLoopback(profile, own);
    this.checked.set(key, { at: Date.now(), loop });
    if (this.checked.size > 512) this.checked.delete(this.checked.keys().next().value ?? "");
    return loop;
  }

  /** Why LumiRPEngine refuses to send a call of its own on this connection (the loop guard, §3.4); null when it may. */
  private async loopRefusal(connectionId: string | null, userId: UserId): Promise<string | null> {
    if (!(await this.isLoopback(connectionId, userId))) return null;
    return connectionId === null
      ? "Your default connection is the loopback, so LumiRPEngine has no real model to send the narrator's call to: pick one in Settings → Depth → Narrator (or set the helper model's connection in Settings → Model use)."
      : "Settings → Depth → Narrator names the loopback connection, so the narrator's call would come straight back to LumiRPEngine: pick a real model there.";
  }

  // ---------------------------------------------------------------- the turn tagger (§3.5)

  /**
   * The prompt interceptor: a world chat's loopback generation gets its token; every other prompt
   * goes on untouched. A world chat's reply on the loopback that the guard didn't let on as its
   * generation (its start unheard, or another's since) has no turn to tie it to, and would run as
   * passthrough, with no engine run and no record: it stops instead (fails closed, §3.14).
   */
  async tag(input: PromptInterceptorInput): Promise<PromptVerdict> {
    if (input.dryRun || input.generationType === "other") return {};
    const loop = this.rt.ledger.loopOf(input.chatId, input.userId);
    if (!loop) {
      if ((await this.isLoopback(input.connectionId, input.userId)) && (await this.rt.worldOf(input.chatId, input.userId)) !== null) {
        this.rt.host.log("warn", "[LumiRPEngine] a world chat's reply on the loopback had no turn to tie it to, so it was stopped", input.userId);
        throw new Error(UNSTARTED);
      }
      return {};
    }
    const history = input.messages.flatMap((m, i) => (m.history ? [i] : []));
    const first = history[0];
    const last = history.at(-1);
    const token = randomHex(128);
    const entry: Token = { token, userId: input.userId, chatId: input.chatId, generationId: loop.generationId, type: loop.type, at: Date.now(), shape: { count: input.messages.length, history, first: first !== undefined ? (input.messages[first]?.content ?? null) : null, last: last !== undefined ? (input.messages[last]?.content ?? null) : null }, prompt: input.messages, turn: null, ended: false };
    // An assembly of the same generation again: the newer token stands.
    const before = this.byGeneration.get(loop.generationId);
    if (before) this.tokens.delete(before.token);
    this.tokens.set(token, entry);
    this.byGeneration.set(loop.generationId, entry);
    for (const [t, e] of this.tokens) {
      if (this.tokens.size <= 256 && Date.now() - e.at < TOKEN_MS) break;
      this.tokens.delete(t);
      if (this.byGeneration.get(e.generationId) === e) this.byGeneration.delete(e.generationId);
    }
    return { parameters: { [TURN_PARAM]: token } };
  }

  /**
   * The World Info interceptor's verdict for a world chat's loopback prompt (§3.12, B2): until the
   * tagger has tagged its generation, every engine entry the turn fills (`turnEntries`, by the preset
   * the chat generates with) is switched on, taken as constant and given its mark as its text, for that
   * prompt alone, so core places each mark where it places the entry. Every other prompt's verdict
   * stands as it is, and so does this one's when the preset can't be read.
   */
  async marked(input: WorldInfoInput, verdict: WorldInfoVerdict): Promise<WorldInfoVerdict> {
    const loop = this.rt.ledger.loopOf(input.chatId, input.userId);
    if (!loop || this.byGeneration.has(loop.generationId)) return verdict;
    try {
      const ids = turnEntries(input.entries, (await this.rt.presets.current(input.chatId, input.userId)).outlets);
      if (ids.length === 0) return verdict;
      return { ...verdict, enabled: [...verdict.enabled, ...ids], forced: [...(verdict.forced ?? []), ...ids], mutated: [...(verdict.mutated ?? []), ...ids.map((id) => ({ id, content: markOf(id) }))] };
    } catch (error) {
      this.rt.host.log("warn", `[LumiRPEngine] this loopback prompt's sections go where today's book puts them: ${messageOf(error)}`, input.userId);
      return verdict;
    }
  }

  // ---------------------------------------------------------------- the relay's requests (§3.6)

  /** `loopback up` registers its relay: a secret minted (kept as a hash), replacing the user's relay of the same name; at most `RELAYS_PER_USER` of each account's at once. */
  async register(r: LoopbackRegisterRequest, userId: UserId): Promise<LoopbackResultBodies["lre.loopback.register"]> {
    if (typeof r.name !== "string" || !RELAY_NAME.test(r.name)) throw new LoopbackRefused("bad_request", "A relay's name is lowercase letters, digits, _ and -, up to 40.");
    if (r.mode !== "user" && r.mode !== "shared") throw new LoopbackRefused("bad_request", "A relay's mode is user or shared.");
    if (!Number.isSafeInteger(r.port) || r.port < 1 || r.port > 65535 || typeof r.listen !== "string" || r.listen === "") throw new LoopbackRefused("bad_request", "Name the address and port the relay listens on.");
    const build = typeof r.build === "string" ? r.build : "";
    const host = typeof r.host === "string" ? r.host : "";
    if (r.listen.length > TEXT_MAX || !LISTEN.test(r.listen)) throw new LoopbackRefused("bad_request", `A relay listens on a host name or an IP address, up to ${TEXT_MAX} characters.`);
    if (build.length > TEXT_MAX || host.length > TEXT_MAX) throw new LoopbackRefused("bad_request", `A relay's build and machine name are up to ${TEXT_MAX} characters each.`);
    if (r.mode === "shared") {
      if ((await this.rt.host.users.role(userId)) !== "operator") throw new LoopbackRefused("forbidden", "Only the operator's account runs the shared relay: leave out --shared for a relay that carries your own turns.");
      if (!(await this.store.read()).shared.enabled) throw new LoopbackRefused("forbidden", "The shared relay is off. As the operator, allow it in LumiRPEngine → Settings → Loopback first: it sees, and can drive, every user's turns (D-8). Or leave out --shared.");
    }
    const id = crypto.randomUUID();
    const secret = randomHex(256);
    const hash = await sha256(secret);
    const replaced = await this.store.change((reg) => {
      const mine = Object.values(reg.relays).filter((x) => x.user === userId);
      const gone = mine.filter((x) => x.name === r.name).map((x) => x.id);
      if (mine.length - gone.length >= RELAYS_PER_USER) return null;
      for (const old of gone) delete reg.relays[old];
      reg.relays[id] = { id, user: userId, name: r.name, mode: r.mode, secret: hash, build, host, listen: r.listen, port: r.port, registeredAt: Date.now(), report: null };
      return gone;
    });
    if (replaced === null) throw new LoopbackRefused("conflict", `You have ${RELAYS_PER_USER} relays registered already, the most one account has: forget one you no longer run in LumiRPEngine → Settings → Loopback, or run \`loopback up\` again under one of their names.`);
    for (const old of replaced) this.live.delete(old);
    this.checked.clear();
    return { relay: id, secret, mode: r.mode, model: LOOPBACK_MODEL, user: userId };
  }

  /** The relay behind a request's secret, and its live state, the frame's session its push target from now on. */
  private async authenticate(secret: unknown, userId: UserId, session: string | undefined): Promise<{ rec: RelayRecord; live: LiveRelay }> {
    const rec = typeof secret === "string" && secret !== "" ? await this.store.relayOf(secret) : null;
    if (!rec) throw new LoopbackRefused("forbidden", "This relay isn't registered with LumiRPEngine (any more): run `loopback up` again, as Settings → Loopback shows it.");
    if (rec.user !== userId) throw new LoopbackRefused("forbidden", "This relay was registered by another account: sign it in as that account, or run `loopback up` as this one.");
    if (rec.mode === "shared" && !(await this.store.read()).shared.enabled) throw new LoopbackRefused("forbidden", "The operator turned the shared relay off (LumiRPEngine → Settings → Loopback).");
    const live = this.live.get(rec.id) ?? { user: rec.user, session: null, seenAt: 0, report: rec.report };
    if (session !== undefined) live.session = session;
    live.seenAt = Date.now();
    this.live.set(rec.id, live);
    return { rec, live };
  }

  async hello(r: LoopbackHelloRequest, userId: UserId, session: string | undefined): Promise<LoopbackResultBodies["lre.loopback.hello"]> {
    const { rec, live } = await this.authenticate(r.secret, userId, session);
    if (r.api !== LOOPBACK_API) throw new LoopbackRefused("bad_request", `This relay speaks the loopback's contract ${String(r.api)}, and LumiRPEngine ${LOOPBACK_API}: update the relay with the line on Settings → Loopback.`);
    // A report this build can't read (a buggy or older relay's, or one past its bounds) is left out: the last good one stands.
    const report = relayReportOf(r.report);
    if (report !== null) {
      live.report = report;
      await this.store.change((reg) => {
        const x = reg.relays[rec.id];
        if (!x) return;
        x.report = report;
        x.build = report.build;
      });
    }
    // Each call the relay still holds resumes from the chunk after its last; one LumiRPEngine no longer holds (it restarted) is lost.
    const lost: string[] = [];
    for (const open of Array.isArray(r.open) ? r.open : []) {
      const call = isRecord(open) && typeof open.call === "string" ? this.calls.get(open.call) : undefined;
      if (!call || call.relay !== rec.id) {
        if (isRecord(open) && typeof open.call === "string") lost.push(open.call);
        continue;
      }
      this.push(call, (typeof open.seq === "number" ? open.seq : 0) + 1);
    }
    return { relay: rec.id, api: LOOPBACK_API, build: this.rt.agents.build.id, mode: rec.mode, model: LOOPBACK_MODEL, heartbeatMs: HEARTBEAT_MS, lost };
  }

  /** The heartbeat: every 15 s while the relay answers calls, naming them; LumiRPEngine answers those it no longer holds, which the relay ends at once (D0a check 4). */
  async ping(r: LoopbackPingRequest, userId: UserId, session: string | undefined): Promise<LoopbackResultBodies["lre.loopback.ping"]> {
    const { rec, live } = await this.authenticate(r.secret, userId, session);
    live.report = relayReportOf(r.report) ?? live.report;
    const lost = (Array.isArray(r.calls) ? r.calls : []).filter((id): id is string => typeof id === "string" && this.calls.get(id)?.relay !== rec.id);
    return { ok: true, lost };
  }

  /** The user a key belongs to, as this relay may carry them: refused for an unknown key, or another account's on a relay of its own. */
  private async keyUser(key: unknown, rec: RelayRecord): Promise<UserId> {
    const user = typeof key === "string" && key !== "" ? await this.store.keyUser(key) : null;
    if (!user) throw new LoopbackRefused("forbidden", "The connection's API key isn't a LumiRPEngine loopback key: copy yours from LumiRPEngine → Settings → Loopback (Rotate makes a new one).");
    if (rec.mode === "user" && user !== rec.user) throw new LoopbackRefused("forbidden", "This relay carries its own account's turns only, and the key is another user's: each user runs their own relay (Settings → Loopback), unless the operator runs the shared one.");
    return user;
  }

  async models(r: LoopbackModelsRequest, userId: UserId, session: string | undefined): Promise<LoopbackResultBodies["lre.loopback.models"]> {
    const { rec } = await this.authenticate(r.secret, userId, session);
    await this.keyUser(r.key, rec);
    return { models: [{ id: LOOPBACK_MODEL }] };
  }

  /** A tagged request: answered with its turn at once, the turn then streaming as the call's chunks. Idempotent per call. */
  async begin(r: LoopbackBeginRequest, userId: UserId, session: string | undefined): Promise<LoopbackResultBodies["lre.loopback.begin"]> {
    const { rec } = await this.authenticate(r.secret, userId, session);
    const known = typeof r.call === "string" ? this.calls.get(r.call) : undefined;
    if (known) return { turn: known.generationId ?? known.id };
    if (typeof r.call !== "string" || !CALL_ID.test(r.call)) throw new LoopbackRefused("bad_request", "A call is named by 128 random bits, in hex.");
    const user = await this.keyUser(r.key, rec);
    const token = typeof r.token === "string" ? this.tokens.get(r.token) : undefined;
    const unmatched = "LumiRPEngine couldn't match this reply to its turn";
    if (!token) throw new LoopbackRefused("conflict", `${unmatched}: its tag is unknown (LumiRPEngine may have restarted since the reply began). Generate again.`);
    if (token.userId !== user) throw new LoopbackRefused("forbidden", `${unmatched}: the connection's key is another user's.`);
    if (rec.mode === "user" && rec.user !== token.userId) throw new LoopbackRefused("forbidden", `${unmatched}: this relay carries only its own account's turns.`);
    if (token.ended || this.rt.ledger.loopOf(token.chatId, token.userId)?.generationId !== token.generationId) throw new LoopbackRefused("conflict", `${unmatched}: its generation is over or another one started. Generate again.`);
    if (Date.now() - token.at > TOKEN_MS) throw new LoopbackRefused("conflict", `${unmatched}: its tag expired. Generate again.`);
    if (!isRecord(r.body) || r.body.stream !== true) throw new LoopbackRefused("validation", STREAM_OFF);
    const call = this.open(r.call, rec.id, token.userId, token.generationId, token.chatId);
    if (this.early.delete(r.call)) this.close(call);
    else void this.turn(call, token, r.body as JsonObject);
    return { turn: token.generationId };
  }

  /** An untagged request (§3.9): run as given on the key's user's narrator connection, answered in kind. Idempotent per call. */
  async passthrough(r: LoopbackPassthroughRequest, userId: UserId, session: string | undefined): Promise<LoopbackResultBodies["lre.loopback.passthrough"]> {
    const { rec } = await this.authenticate(r.secret, userId, session);
    if (typeof r.call === "string" && this.calls.has(r.call)) return { accepted: true };
    if (typeof r.call !== "string" || !CALL_ID.test(r.call)) throw new LoopbackRefused("bad_request", "A call is named by 128 random bits, in hex.");
    const user = await this.keyUser(r.key, rec);
    if (!isRecord(r.body)) throw new LoopbackRefused("bad_request", "The request has no body.");
    if (!this.rt.host.capabilities.interceptors && this.rt.ledger.loopBusy(user)) throw new LoopbackRefused("conflict", UNTAGGED);
    if (rec.mode === "shared") this.sharedPassthrough(user, r.body as JsonObject);
    const call = this.open(r.call, rec.id, user, null, null);
    if (this.early.delete(r.call)) this.close(call);
    else void this.passthroughRun(call, r.body as JsonObject);
    return { accepted: true };
  }

  /**
   * The shared relay's untagged requests, held to D-8's limits by LumiRPEngine itself, whatever the
   * relay does (§3.11): whoever holds its secret and session reaches here without the relay's own
   * check. At most `SHARED_PASSTHROUGH_PER_MINUTE` a minute for each key's user and
   * `LOOPBACK_MAX_BODY_BYTES` each; every one carried or refused is logged by user.
   */
  private sharedPassthrough(user: UserId, body: JsonObject): void {
    const who = user.slice(0, 8);
    const bytes = new TextEncoder().encode(JSON.stringify(body)).length;
    if (bytes > LOOPBACK_MAX_BODY_BYTES) {
      this.rt.host.log("info", `[LumiRPEngine] the shared loopback relay's untagged request of user ${who} was refused: ${bytes} bytes`, user);
      throw new LoopbackRefused("validation", `This request is ${(bytes / 1048576).toFixed(1)} MiB, and the shared loopback carries at most ${(LOOPBACK_MAX_BODY_BYTES / 1048576).toFixed(1)} MiB. Lower the connection's context size.`);
    }
    const now = Date.now();
    const recent = (this.passthroughs.get(user) ?? []).filter((at) => now - at < MINUTE_MS);
    if (recent.length >= SHARED_PASSTHROUGH_PER_MINUTE) {
      this.passthroughs.set(user, recent);
      this.rt.host.log("info", `[LumiRPEngine] the shared loopback relay's untagged request of user ${who} was refused: over ${SHARED_PASSTHROUGH_PER_MINUTE} a minute`, user);
      throw new LoopbackRefused("unavailable", `The shared loopback carries at most ${SHARED_PASSTHROUGH_PER_MINUTE} untagged requests a minute for each user. Wait a minute.`);
    }
    recent.push(now);
    this.passthroughs.set(user, recent);
    this.rt.host.log("info", `[LumiRPEngine] the shared loopback relay carried an untagged request of user ${who} (${bytes} bytes)`, user);
  }

  async abort(r: LoopbackAbortRequest, userId: UserId, session: string | undefined): Promise<LoopbackResultBodies["lre.loopback.abort"]> {
    const { rec } = await this.authenticate(r.secret, userId, session);
    const call = typeof r.call === "string" ? this.calls.get(r.call) : undefined;
    if (!call) {
      // Given up before its start was heard: its start, when it comes, ends at once.
      if (typeof r.call === "string") this.early.add(r.call);
      if (this.early.size > 256) this.early.delete(this.early.values().next().value ?? "");
      return { aborted: false };
    }
    if (call.relay !== rec.id) throw new LoopbackRefused("forbidden", "That call is another relay's.");
    if (call.done) return { aborted: false };
    call.abort.abort(new Error(`the loopback gave the call up (${String(r.reason)})`));
    // Stop lands between the engine run's steps (§3.10); a narrator call under way ends with its signal.
    if (call.chatId !== null && call.generationId !== null) this.rt.ledger.cancelLoop(call.chatId, call.userId, call.generationId);
    // Nothing more goes to the relay, and the call's own work closes it once it has stopped: its generation's
    // end waits for that, so a depth turn's scene, cut where its last passage streamed, is handed over first.
    this.quiet(call);
    return { aborted: true };
  }

  async resend(r: LoopbackResendRequest, userId: UserId, session: string | undefined): Promise<LoopbackResultBodies["lre.loopback.resend"]> {
    const { rec } = await this.authenticate(r.secret, userId, session);
    const call = typeof r.call === "string" ? this.calls.get(r.call) : undefined;
    if (!call || call.relay !== rec.id) return { last: null };
    this.push(call, typeof r.from === "number" ? r.from : 1);
    return { last: call.held.size > 0 ? call.last : null };
  }

  async ack(r: LoopbackAckRequest, userId: UserId, session: string | undefined): Promise<LoopbackResultBodies["lre.loopback.ack"]> {
    const { rec } = await this.authenticate(r.secret, userId, session);
    const call = typeof r.call === "string" ? this.calls.get(r.call) : undefined;
    if (!call || call.relay !== rec.id) return { done: true };
    for (const seq of [...call.held.keys()]) if (seq <= r.seq) call.held.delete(seq);
    const done = call.done && r.seq >= call.last;
    if (done) this.calls.delete(call.id);
    return { done };
  }

  // ---------------------------------------------------------------- calls and chunks

  private open(id: string, relay: string, userId: UserId, generationId: string | null, chatId: ChatId | null): Call {
    const call: Call = { id, relay, userId, generationId, chatId, turn: null, held: new Map(), last: 0, done: false, doneAt: null, over: false, startedAt: Date.now(), abort: new AbortController(), buffer: null, timer: null, models: [] };
    this.calls.set(id, call);
    if (generationId !== null) {
      const w = this.working.get(generationId) ?? { calls: 0, done: Promise.withResolvers<void>() };
      w.calls++;
      this.working.set(generationId, w);
    }
    return call;
  }

  /** Pushes the call's held chunks from `from` to the relay's session; none while the relay has no session (its hello resumes them). */
  private push(call: Call, from: number): void {
    for (let seq = Math.max(1, from); seq <= call.last; seq++) {
      const chunk = call.held.get(seq);
      if (chunk) this.deliver(call, seq, chunk);
    }
  }

  private deliver(call: Call, seq: number, chunk: LoopbackChunk): void {
    const relay = this.live.get(call.relay);
    if (!relay?.session) return;
    this.rt.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.loopback.chunk", call: call.id, seq, chunk }, relay.user, relay.session);
  }

  private send(call: Call, chunk: LoopbackChunk): void {
    if (call.done) return;
    const seq = ++call.last;
    call.held.set(seq, chunk);
    if (terminal(chunk)) {
      call.done = true;
      call.doneAt = Date.now();
    }
    this.deliver(call, seq, chunk);
  }

  /** Text joins the text of its kind sent within the next few ms; reasoning and content never share a chunk (F13). */
  private text(call: Call, kind: "reasoning" | "content", text: string): void {
    if (call.done || text === "") return;
    if (call.buffer && call.buffer.kind !== kind) this.flush(call);
    if (call.buffer) call.buffer.text += text;
    else call.buffer = { kind, text };
    call.timer ??= setTimeout(() => {
      call.timer = null;
      this.flush(call);
    }, COALESCE_MS);
  }

  private flush(call: Call): void {
    if (call.timer) clearTimeout(call.timer);
    call.timer = null;
    const pending = call.buffer;
    call.buffer = null;
    if (pending && pending.text !== "") this.send(call, { kind: pending.kind, text: pending.text });
  }

  /** The call as a TurnSink (sink.ts): what the turn writes, in order, as chunks. */
  private sinkOf(call: Call): TurnSink {
    return {
      progress: (text) => {
        if (call.done || text.trim() === "") return;
        this.flush(call);
        this.send(call, { kind: "progress", text: text.trim() });
      },
      reasoning: (text) => this.text(call, "reasoning", text),
      content: (text) => {
        if (call.turn && call.turn.firstContentAt === null && text !== "") call.turn.firstContentAt = Date.now();
        this.text(call, "content", text);
      },
      call: (c) => {
        call.models.push(c);
        call.turn?.calls.push(c);
      },
      misread: (c, m) => {
        call.turn?.misread.set(c, m);
      },
    };
  }

  /** The call's terminal finish: its usage is every model call it made. */
  private finish(call: Call, finish: string): void {
    this.flush(call);
    const promptTokens = call.models.reduce((n, c) => n + (c.promptTokens ?? 0), 0);
    const completionTokens = call.models.reduce((n, c) => n + (c.completionTokens ?? 0), 0);
    this.send(call, { kind: "finish", finish, usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens, calls: [...call.models] } });
    this.ended(call);
  }

  /** The call's terminal error: the words the chat shows. */
  private fail(call: Call, message: string, code: string): void {
    this.flush(call);
    this.send(call, { kind: "error", message, code });
    this.ended(call);
  }

  /** The relay gave the call up: nothing more is sent for it, though its work may still be stopping. */
  private quiet(call: Call): void {
    clearTimeout(call.timer ?? undefined);
    call.timer = null;
    call.buffer = null;
    call.done = true;
    call.doneAt = Date.now();
  }

  /** The relay gave the call up and its work has stopped. */
  private close(call: Call): void {
    this.quiet(call);
    this.ended(call);
  }

  /** A call's work is over: its turn's provenance is kept, and a generation whose calls are all over has settled. */
  private ended(call: Call): void {
    if (call.over) return;
    call.over = true;
    if (call.generationId === null) return;
    if (call.chatId !== null && call.turn) this.provenance(call.chatId, call.userId, call.turn);
    const w = this.working.get(call.generationId);
    if (!w) return;
    w.calls--;
    if (w.calls > 0) return;
    this.working.delete(call.generationId);
    w.done.resolve();
  }

  /** Resolves once the generation's turn work is over (its end then commits what that left), at most `SETTLE_MS` on; null when none is under way. */
  settled(generationId: string): Promise<void> | null {
    const w = this.working.get(generationId);
    if (!w) return null;
    return Promise.race([w.done.promise, new Promise<void>((resolve) => setTimeout(resolve, SETTLE_MS))]);
  }

  /** The turn's provenance on its engine run's inspector record (§9.0): every model call, the turn's time, and its time to the first text. */
  private provenance(chatId: ChatId, userId: UserId, turn: TurnState): void {
    const record = turn.record !== null ? this.rt.inspector.records(chatId)?.find((r) => r.id === turn.record) : undefined;
    if (!record) return;
    const calls = turn.calls.map((c) => {
      const misread = turn.misread.get(c);
      return misread ? { ...c, misread } : { ...c };
    });
    record.provenance = { calls, turnMs: Date.now() - turn.startedAt, firstContentMs: turn.firstContentAt === null ? null : turn.firstContentAt - turn.startedAt, ...(turn.reply ? { reply: turn.reply } : {}) };
    this.rt.inspector.save(chatId);
    this.rt.push.changed(chatId, userId);
  }

  // ---------------------------------------------------------------- the turn

  /** A chat's engine run, heard while it runs: its stage lines, its agents' thinking (D-5's whole setting) and its model calls. */
  private watch(chatId: ChatId, watcher: Watcher): () => void {
    const entry = { ...watcher, label: null };
    this.watchers.set(chatId, entry);
    return () => {
      if (this.watchers.get(chatId) === entry) this.watchers.delete(chatId);
    };
  }

  /** A depth reply's swipe a scene played (`reply`): its message is the chat's last depth reply now, and the swipe is kept with the message its turn answered, for a redo of it; a swipe of the same reply joins the others. */
  private played(chatId: ChatId, reply: NonNullable<TurnState["reply"]>, turn: PendingTurn, redo: DepthRedo): void {
    const last = this.lastScene.get(chatId);
    const scene = last?.messageId === reply.messageId ? last : { messageId: reply.messageId, shown: reply.swipeId, swipes: new Map<number, SceneSwipe>() };
    const answered = answeredOf(turn, reply.messageId);
    if (answered) scene.swipes.set(reply.swipeId, { redo, answered: { id: answered.id, content: answered.content } });
    else scene.swipes.delete(reply.swipeId);
    this.lastScene.set(chatId, scene);
    if (this.lastScene.size > 256) this.lastScene.delete(this.lastScene.keys().next().value ?? "");
  }

  /** The chat's redo (`redos`), where the new reply of `turn` answers the message the deleted reply answered, its text as it was then. */
  private redoFor(chatId: ChatId, turn: PendingTurn | null, reply: string | undefined): DepthRedo | undefined {
    const kept = this.redos.get(chatId);
    const answered = kept && turn ? answeredOf(turn, reply) : undefined;
    return kept && answered?.id === kept.answered.id && sameContent(answered.content, kept.answered.content) ? kept.redo : undefined;
  }

  /** A message's text changed (an edit, or a swipe of it): a redo that answers it no longer does. A write of its metadata alone, which the host tells as an edit too, leaves it. */
  private retexted(chatId: ChatId, message: HostMessage): void {
    const redo = this.redos.get(chatId);
    if (redo?.answered.id === message.id && !sameContent(contentId(message.swipes[message.swipeId] ?? ""), redo.answered.content)) this.redos.delete(chatId);
  }

  /** The turn's engine run, once per generation: today's run, inside the provider call. */
  private async engineRun(token: Token, sink: TurnSink, whole: boolean): Promise<LoopRun> {
    if (token.type === "impersonate") {
      sink.progress("Writing your character's next message");
      return { kind: "plain" };
    }
    sink.progress("LumiRPEngine is working out the turn");
    const off = this.watch(token.chatId, { progress: (label) => sink.progress(label), reasoning: whole ? (text) => sink.reasoning(text) : null, call: (c) => sink.call(c) });
    try {
      const run = await this.rt.ledger.loopbackRun(token.chatId, token.userId, token.generationId);
      const words = run.kind === "delivered" ? kindWords(run.as) : null;
      if (words) sink.progress(words);
      return run;
    } finally {
      off();
    }
  }

  private async turn(call: Call, token: Token, body: JsonObject): Promise<void> {
    const sink = this.sinkOf(call);
    try {
      const settings = await this.rt.settings.get(token.userId);
      const whole = settings.depth.thinking === "whole";
      const round = token.turn !== null;
      const messages = quietMessages(body.messages);
      token.turn ??= { run: this.engineRun(token, sink, whole), record: null, opened: messages.length, startedAt: Date.now(), firstContentAt: null, calls: [], misread: new Map(), reply: null };
      const state = token.turn;
      call.turn = state;
      // A tool round's call (F29, D0a check 9): the turn's run is done; the narrator goes on from the tools' results.
      if (round) sink.progress("The tools answered: the narrator goes on");
      const run = await state.run;
      if (call.abort.signal.aborted) return this.close(call);
      if (run.kind === "failed") return this.fail(call, `LumiRPEngine's engine run stopped at ${run.step}: ${run.reason}`, "engine");
      if (run.kind === "cancelled") return this.fail(call, "The turn was stopped before its reply.", "stopped");
      if (run.kind === "waiting") return this.fail(call, `${run.reason}. Answer it, then generate again.`, "waiting");
      if (run.kind === "delivered") {
        state.record = token.generationId;
        // The reply the generation writes, as its start named it (a new reply's blank message, the message a swipe or Continue goes on): what GM → Depth → Turn joins the turn's provenance to. The plan names none for a new reply.
        const loop = this.rt.ledger.loopOf(token.chatId, token.userId);
        if (loop?.generationId === token.generationId && loop.target !== null) state.reply = { messageId: loop.target, swipeId: loop.swipe ?? 0 };
      }
      const placed: PlacedSection[] = run.kind === "delivered" ? await this.rt.loopbackSections(token.userId, run.delivered) : [];
      if (this.depth && run.kind === "delivered") {
        // The sections whose telling the beats take over stay out of the depth narrator's prompt (`BEATS_TELL`).
        const told = new Set(run.delivered.parts.flatMap((p) => (BEATS_TELL.has(p.id) ? [p.entry] : [])));
        const frame = this.shortFrame(token, messages, placed.filter((s) => !told.has(s.entry)), settings, sink, true);
        const direction = run.delivered.swipe?.direction;
        // The input area's Regenerate deleted the chat's last depth reply and asks a new one: this reply is its redo, once, where it answers the message that reply answered, its text as it was.
        const redo = token.type === "normal" ? this.redoFor(token.chatId, run.turn, state.reply?.messageId) : undefined;
        this.redos.delete(token.chatId);
        const scene = await this.depth({ chatId: token.chatId, userId: token.userId, generationId: token.generationId, token: token.token, kind: run.as, turn: run.turn, ...(direction !== undefined ? { direction } : {}), ...(redo ? { redo } : {}), frame, body, sink, signal: call.abort.signal });
        // A Stop's scene, and one a stage failed in once a passage streamed, come back cut where the last passage streamed: each is handed over first, so the commit keeps what the player saw.
        if (scene) {
          this.rt.ledger.sceneCommit(token.generationId, scene);
          if (state.reply && run.turn) this.played(token.chatId, state.reply, run.turn, { pre: scene.pre, read: scene.read });
        }
        if (call.abort.signal.aborted) return this.close(call);
        if (scene?.error !== undefined) return this.fail(call, `LumiRPEngine's scene stopped part-way: ${scene.error}. What streamed stands, with its beats.`, "internal");
        if (scene) return this.finish(call, "stop");
        if (await this.rt.depth.on(token.chatId, token.userId)) {
          if (!round) sink.progress(unreadWords(run.as, run.turn !== null));
          // No scene plays it, so today's narrator writes it, from B2's short context all the same: the preset as Lumiverse assembled it, every section of the run in its place (no beats tell any of them), and the recent window where the history was; a tool round's exchange follows it.
          const unscened = this.shortFrame(token, messages.slice(0, state.opened), placed, settings, sink, false, !round);
          return await this.narrate(call, token.userId, sink, [...unscened(), ...messages.slice(state.opened)], body, whole);
        }
      }
      await this.narrate(call, token.userId, sink, withSections(messages, token.shape, placed), body, whole);
    } catch (error) {
      if (call.abort.signal.aborted) return this.close(call);
      if (error instanceof LoopbackRefused) return this.fail(call, error.message, error.code);
      this.rt.host.log("warn", `[LumiRPEngine] a loopback turn failed: ${messageOf(error)}`, token.userId, token.generationId);
      this.fail(call, `LumiRPEngine's turn failed: ${messageOf(error)}`, "internal");
    }
  }

  /**
   * The depth narrator's frame (B2): its short context made from the prompt the tagger kept, the first
   * time the narrator reads it, which the thinking block names when it shows everything (D-5) and
   * `say` holds. For a scene the frame closes the window with the narrator's part; a reply no scene
   * plays (`scene` false) is today's narrator's, written from the preset as it is whatever Your preset
   * says (LRE's own template renders beats, and the reply a Continue carries on is a block after the
   * history, which LRE's only would leave out), its frame closed by nothing.
   */
  private shortFrame(token: Token, body: readonly QuietMessage[], sections: readonly PlacedSection[], settings: UserSettings, sink: TurnSink, scene: boolean, say = true): (part?: string) => QuietMessage[] {
    const prompt = token.prompt ?? [];
    const absorption: Absorption = scene ? settings.depth.absorption : "keep";
    let made: ShortContext | null = null;
    return (part) => {
      if (!made) {
        made = shortContext({ prompt, body, sections, window: settings.depth.window, absorption });
        if (say && settings.depth.thinking === "whole") sink.reasoning(`\n${contextWords(made.read, absorption, scene)}\n`);
      }
      return made.frame(part);
    };
  }

  /** One model call's provenance (§9.0). */
  private modelCall(role: string, connectionId: string | null, model: string | null, result: QuietResult, ms: number): LoopbackModelCall {
    return { role, connection: connectionId ?? "default", model: result.model ?? model ?? "default", requestId: requestIdOf(result.usage), ...(result.tokensIn !== undefined ? { promptTokens: result.tokensIn } : {}), ...(result.tokensOut !== undefined ? { completionTokens: result.tokensOut } : {}), ms };
  }

  /** The call as the body asks it, on the user's narrator connection (Settings → Depth → Narrator), the body's sampling over the connection's. */
  private async request(userId: UserId, messages: QuietMessage[], body: JsonObject): Promise<{ request: QuietRequest; connectionId: string | null; model: string | null }> {
    const route = depthCall(await this.rt.settings.get(userId), "narrator");
    const refusal = await this.loopRefusal(route.connectionId, userId);
    if (refusal) throw new LoopbackRefused("validation", refusal);
    const tools = quietTools(body.tools);
    const toolChoice = toolChoiceOf(body);
    const request: QuietRequest = { messages, maxTokens: maxTokensOf(body) ?? route.maxTokens, json: false, connectionId: route.connectionId, model: route.model, effort: route.effort, params: { ...route.params, ...samplingOf(body) }, usage: true, ...(tools.length > 0 ? { tools } : {}), ...(toolChoice !== undefined ? { toolChoice } : {}) };
    return { request, connectionId: route.connectionId, model: route.model };
  }

  /** The narrator's call, streamed: its text as the reply, its own reasoning into the thinking block (unless that shows progress only, D-5), tools answered in kind. */
  private async narrate(call: Call, userId: UserId, sink: TurnSink, messages: QuietMessage[], body: JsonObject, whole: boolean): Promise<void> {
    const { request, connectionId, model } = await this.request(userId, messages, body);
    sink.progress("The narrator is writing the reply");
    const started = Date.now();
    const result = await this.rt.host.models.stream(request, userId, call.abort.signal, (piece) => {
      if (piece.kind === "content") sink.content(piece.text);
      else if (whole) sink.reasoning(piece.text);
    });
    sink.call(this.modelCall("narrator", connectionId, model, result, Date.now() - started));
    if (call.abort.signal.aborted) return this.close(call);
    if (result.toolCalls && result.toolCalls.length > 0) {
      this.flush(call);
      this.send(call, { kind: "tool_calls", calls: toolCallChunks(result.toolCalls) });
      return this.finish(call, "tool_calls");
    }
    this.finish(call, result.finishReason || "stop");
  }

  private async passthroughRun(call: Call, body: JsonObject): Promise<void> {
    const sink = this.sinkOf(call);
    try {
      const { request, connectionId, model } = await this.request(call.userId, quietMessages(body.messages), body);
      const started = Date.now();
      const result = await this.rt.host.models.stream(request, call.userId, call.abort.signal, (piece) => (piece.kind === "content" ? sink.content(piece.text) : sink.reasoning(piece.text)));
      sink.call(this.modelCall("passthrough", connectionId, model, result, Date.now() - started));
      if (call.abort.signal.aborted) return this.close(call);
      if (result.toolCalls && result.toolCalls.length > 0) {
        this.flush(call);
        this.send(call, { kind: "tool_calls", calls: toolCallChunks(result.toolCalls) });
        return this.finish(call, "tool_calls");
      }
      this.finish(call, result.finishReason || "stop");
    } catch (error) {
      if (call.abort.signal.aborted) return this.close(call);
      this.fail(call, error instanceof LoopbackRefused ? error.message : `LumiRPEngine couldn't run this request: ${messageOf(error)}`, error instanceof LoopbackRefused ? error.code : "upstream");
    }
  }

  // ---------------------------------------------------------------- Settings → Loopback

  async page(r: LoopbackPageRequest, userId: UserId): Promise<LoopbackPage> {
    let minted: string | undefined;
    switch (r.op) {
      case "get":
        break;
      case "mint": {
        const key = `lre_lk_${randomHex(256)}`;
        const hash = await sha256(key);
        await this.store.change((reg) => {
          reg.keys[userId] = { hash, print: hash.slice(0, 8), at: Date.now() };
        });
        minted = key;
        break;
      }
      case "shared": {
        if ((await this.rt.host.users.role(userId)) !== "operator") throw new LoopbackRefused("forbidden", "Only the operator decides the shared relay.");
        const enabled = r.enabled === true;
        await this.store.change((reg) => {
          reg.shared = { enabled, by: userId, at: Date.now() };
        });
        break;
      }
      case "fix": {
        const rec = (await this.store.read()).relays[r.relay];
        if (!rec || rec.user !== userId) throw new LoopbackRefused("not_found", "No such relay of yours.");
        const live = this.live.get(rec.id);
        if (!live?.session) throw new LoopbackRefused("unavailable", "The relay isn't connected to Lumiverse now: start it, or sign it in again with its line.");
        this.rt.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.loopback.fix", what: "scheduler" }, live.user, live.session);
        break;
      }
      case "forget": {
        const removed = await this.store.change((reg) => {
          const rec = reg.relays[r.relay];
          if (!rec || rec.user !== userId) return false;
          delete reg.relays[r.relay];
          return true;
        });
        if (!removed) throw new LoopbackRefused("not_found", "No such relay of yours.");
        this.live.delete(r.relay);
        this.checked.clear();
        break;
      }
      default:
        throw new LoopbackRefused("bad_request", "op must be get, mint, shared, fix or forget");
    }
    return this.view(userId, originOf(r.origin), minted);
  }

  /** Why this user can't play a chat on depth now, read from Settings → Loopback's own page (`loopbackUnready`); null when they can. */
  async unready(userId: UserId): Promise<string | null> {
    return loopbackUnready(await this.view(userId, null, undefined));
  }

  /** The user's connections that are the loopback (`isLoopback`), as Settings → Loopback lists them: of the first 50 the host lists. */
  async connections(userId: UserId): Promise<{ id: string; name: string }[]> {
    const loopback: { id: string; name: string }[] = [];
    for (const c of (await this.rt.host.connections.list(userId).catch(() => [])).slice(0, 50)) if (await this.isLoopback(c.id, userId)) loopback.push(c);
    return loopback;
  }

  private async view(userId: UserId, url: string | null, minted: string | undefined): Promise<LoopbackPage> {
    const host = this.rt.host;
    const reg = await this.store.read();
    const operator = (await host.users.role(userId).catch(() => "user")) === "operator";
    const build = this.rt.agents.build.id;
    const bun = host.bunPath;
    const script = this.rt.agents.build.kit?.core ?? null;
    const words = (parts: readonly string[]): string => parts.map(shellWord).join(" ");
    // Every line runs as the account Lumiverse runs as, named (`sudo -u`) whoever pastes it: from another login it would run, and install as that login's own service, files this account can change (the depth release's late security review, S4). Root is never named: a Lumiverse run as root needs no sudo, and `up` refuses root unless only root can change what it runs. Bun runs from / (`--cwd /`): it reads a bunfig.toml (its preload) and .env from the directory it runs in before anything of the relay's (S2).
    const account = host.account !== null && host.account !== "root" ? host.account : null;
    const lre = (rest: readonly string[]): string | null => (bun !== null && script !== null ? words([...(account !== null ? ["sudo", "-u", account] : []), bun, "--cwd", "/", script, "loopback", ...rest]) : null);
    const line = (rest: readonly string[]): string | null => (url !== null ? lre(["up", "--url", url, ...rest]) : null);
    // A system service runs root-owned copies (SYSTEM_RELAY_DIR) as the account. Its lines run as root only system programs (install, systemctl): Update has the account read this install's files into a directory of the operator's own (mktemp's, under /tmp's sticky bit), which root installs from, so root never follows a link the account made into a file only root may read, and Sign-in runs the copies as the account, writing its config in place (S1). Neither names a path the relay reports (S3).
    const dir = script === null ? null : script.slice(0, script.lastIndexOf("/"));
    const systemLines = (name: string): { update: string | null; login: string | null } => {
      if (account === null || script === null || dir === null) return { update: null, login: null };
      const copy = `${SYSTEM_RELAY_DIR}/${script.slice(dir.length + 1)}`;
      const restart = words(["sudo", "systemctl", "restart", relayUnitName(name)]);
      // Each copy is written only once every read was whole (`cat` succeeded) and not empty, and the unit restarts only once every copy is written (the final security review, F2: `cat … | tee …` has tee's status, and tee empties its file as it opens it, so a failed read emptied the copies and the restart ran anyway).
      const files = [[script, copy], [`${dir}/${KIT_FILE}`, `${SYSTEM_RELAY_DIR}/${KIT_FILE}`]] as const;
      const read = (to: string): string => `"$t"/${shellWord(to.slice(to.lastIndexOf("/") + 1))}`;
      const update = ["t=$(mktemp -d /tmp/lumirpengine.XXXXXX)", ...files.map(([from, to]) => `${words(["sudo", "-u", account, "cat", from])} >${read(to)}`), ...files.map(([, to]) => `test -s ${read(to)}`), ...files.map(([, to]) => `sudo install -m 0644 ${read(to)} ${shellWord(to)}`), 'rm -r "$t"', restart];
      return { update: update.join(" && "), login: `${words(["sudo", "-u", account, `${SYSTEM_RELAY_DIR}/bun`, "--cwd", "/", copy, "loopback", "login", "--config", `${SYSTEM_CONFIG_DIR}/loopback-${name}.json`])} && ${restart}` };
    };
    const now = Date.now();
    const relays = Object.values(reg.relays)
      .filter((x) => x.user === userId || x.mode === "shared")
      .map((x): LoopbackRelayView => {
        const live = this.live.get(x.id);
        const report = live?.report ?? x.report;
        const seenAt = live?.seenAt ?? null;
        const unit = report?.runtime.unit ?? null;
        const system = unit?.scope === "system";
        const silent = seenAt === null ? now - x.registeredAt > 2 * HEARTBEAT_MS : now - seenAt > 2 * HEARTBEAT_MS;
        return {
          relay: x.id,
          name: x.name,
          mode: x.mode,
          build: x.build,
          host: x.host,
          listen: x.listen,
          port: x.port,
          registeredAt: x.registeredAt,
          seenAt,
          report,
          signIn: report?.session.valid === false || silent,
          update: x.build !== build,
          lines:
            x.user !== userId
              ? { update: null, login: null }
              : system
                ? systemLines(x.name)
                : { update: line(["--name", x.name, ...(unit ? ["--systemd"] : [])]), login: lre(["login", "--name", x.name]) },
        };
      });
    const connections = await this.connections(userId);
    const key = reg.keys[userId];
    return {
      build,
      key: key ? { set: true, print: key.print, at: key.at } : { set: false, print: null, at: null },
      ...(minted !== undefined ? { minted } : {}),
      relays,
      line: { command: line(["--systemd"]), foreground: line([]), bun, script, url, account },
      // New replies stay on the relay: staging's message sessions can't complete a reply LumiRPEngine composes (D0a check 8, D-12).
      transport: "relay",
      sessions: host.capabilities.messageSessions,
      enforced: host.capabilities.interceptors,
      shared: { operator, enabled: reg.shared.enabled },
      connections,
    };
  }
}

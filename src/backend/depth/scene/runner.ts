// The depth turn behind the loopback (DEPTH-PLAN §2.3, §3, §9.2 A2): what the loopback's bridge runs
// once a world chat's engine run is done, in place of today's narrator, for a chat on depth (GM →
// This chat → Depth). It reads the fold the turn answers, binds the turn's model calls to Settings →
// Depth with each call reported to the turn (its provenance) and none sent back into the loopback,
// hands the turn the budget dial's ceilings against today's spend (§6.5), and runs `runDepthTurn`
// with the real plugs. The bridge commits what it returns; what runs right after the reply
// (`AfterReply`, with what the scene spent) waits here until that commit takes it.
//
// It answers null, and the bridge narrates as before, for a chat not on depth, an Impersonate, a
// Continue (a scene doesn't carry on a reply yet), a turn with no plan (one made under a pause), and
// a Re-narrate of a reply written before the chat was on depth, which has no beats to render again.
// On a chat on depth that reply's text is never read into canon (`PendingTurn.depth`), and the
// thinking block and the reply's chip say so.

import { adoptEvent, type AdoptData } from "../../../shared/author";
import type { ArchiveQuery } from "../../../shared/archive";
import { depthCall, DEPTH_ROLE_WORDS, narratorOverrides } from "../../../shared/depth-settings";
import type { ChatId, MessageId, UserId } from "../../../shared/ids";
import type { GenerationKind, LedgerEvent, PendingTurn } from "../../../shared/ledger";
import type { SamplingParams } from "../../../shared/settings";
import { STORY_SCENE } from "../../../shared/scene";
import { STORY_BEAT } from "../../../shared/story";
import { STORY_TALK } from "../../../shared/talk";
import type { ChainMessage } from "../../../engine/ledger/chain";
import { basisAt } from "../../../engine/ledger/layer";
import { quoteView } from "../../archive-index";
import { depthOptedIn } from "../../bootstrap/service";
import { depthPort } from "../../depth-model-host";
import { foldAtBasisOf, type ArchiveView } from "../../ledger-io";
import { LoopbackRefused, type DepthCommit, type DepthTurnCtx } from "../../loopback/bridge";
import { narratorSampling } from "../../loopback/compose";
import type { Runtime } from "../../runtime";
import type { ArchiveSource } from "../archive-tools";
import { budgetFor, daySpendOf, onScreenAllowance, recordedTokens } from "../budget";
import { SPEND_TYPES, spendsOn } from "../spend";
import type { ModelPort } from "../port";
import { DRAFT_TYPES } from "../offscreen/drafts";
import type { AfterReply, DepthTurnInput, SceneAt, TurnSink } from "./contract";
import { scenePlugs } from "./plugs";
import { chatLinesOf, reporting, type ChatLine } from "./reporting";
import { runDepthTurn, type ScenePlugs } from "./turn";

/** What the depth turn reads of the runtime. */
export type DepthTurnsRt = Pick<Runtime, "host" | "registry" | "blobs" | "settings" | "ledger" | "archive" | "bridgeOf" | "loopback" | "depthNeeded">;

/** The replies whose after-reply work is kept until their commit takes it; past this the oldest goes (a commit that never came). */
const AFTERS_KEPT = 64;

/** What a depth turn reads on the chat's queue: the fold it answers, the player's message, a Re-narrate's source record, his signals beyond his words. */
interface TurnRead {
  at: SceneAt;
  input: DepthTurnInput["input"];
  source?: NonNullable<DepthTurnInput["source"]>;
  signals: string[];
}

/**
 * The player's signals from his swipes, for the author's setup and poll (DEPTH-PLAN §3.9, §4.5): a
 * swipe's count of the tellings before it (`swiped`, the reply it swipes), the telling of the last
 * reply he kept (`last`, the reply before his message), and what he asked this telling to change.
 * Bookkeeping: what the player did, in words, never a judgment of what he meant.
 */
function swipeSignals(kind: GenerationKind, swiped: ChainMessage | undefined, last: ChainMessage | undefined, direction: string | undefined): string[] {
  const swipe = kind === "swipe" || kind === "regenerate" || kind === "renarrate";
  const before = swipe && swiped ? swiped.swipes.length - 1 : 0;
  return [
    ...(before > 0 ? [`He swiped this reply ${before === 1 ? "once" : `${before} times`} before this telling.`] : []),
    ...(!swipe && last && last.swipes.length > 1 ? [`Of the last reply's ${last.swipes.length} tellings he kept number ${last.swipeId + 1}.`] : []),
    ...(direction ? [`He asked this telling to change: “${direction}”`] : []),
  ];
}

export class DepthTurns {
  private readonly afters = new Map<string, AfterReply>();

  constructor(
    private readonly rt: DepthTurnsRt,
    private readonly plugs: ScenePlugs = scenePlugs,
  ) {}

  /** Whether the chat is on depth (GM → This chat → Depth): the one question the turn and the classic steps it retires both ask. */
  on(chatId: ChatId, userId: UserId): Promise<boolean> {
    return depthOptedIn(this.rt, chatId, userId);
  }

  /** The bridge's depth turn (`LoopbackBridge.depth`): the record to commit, or null where the bridge narrates as before. */
  readonly run = async (ctx: DepthTurnCtx): Promise<DepthCommit | null> => {
    const { chatId, userId, turn } = ctx;
    if (turn === null || ctx.kind === "impersonate" || ctx.kind === "continue") return null;
    const bridge = this.rt.bridgeOf(chatId);
    if (!bridge || !(await this.on(chatId, userId))) return null;
    const first = await this.read(chatId, userId, ctx.generationId, turn, ctx.kind, ctx.direction);
    if (first === null) return null;
    // The work between turns at the messages the turn reads through that the next turn reads (DEPTH-PLAN §6): it waits for it, lands what it held for the turn's window, reads again, and cites it.
    const upTo = turn.chain.findIndex((m) => m.id === first.at.basis.message);
    const on = new Set<MessageId>(turn.chain.slice(0, upTo + 1).map((m) => m.id));
    const needed = await this.rt.depthNeeded(chatId, on, ctx.signal);
    if (needed.waited.length + needed.without.length > 0) ctx.sink.progress(`Waited for the work between turns this turn reads${needed.without.length > 0 ? `; going on without ${needed.without.map((j) => j.what).join(", ")}, which lands after` : ""}`);
    const adopted = needed.waited.length > 0 ? await this.rt.ledger.adoptHeld(chatId, userId, on) : [];
    const read = needed.waited.length > 0 ? await this.read(chatId, userId, ctx.generationId, turn, ctx.kind, ctx.direction) : first;
    if (read === null) return null;
    const adoption: AdoptData | null = needed.waited.length + needed.without.length > 0 ? { waited: needed.waited, without: needed.without, entries: adopted } : null;
    const settings = await this.rt.settings.get(userId);
    // The input area's Regenerate deleted the chat's last depth reply (D-4 a): its redo follows the swipe setting where that reply's record holds beats to tell again, else the scene plays again.
    const again = ctx.redo && settings.swipeDefault === "renarrate" && ctx.redo.pre.some((e) => e.type === STORY_BEAT) ? ctx.redo : null;
    if (ctx.redo) ctx.sink.progress(again ? "Redoing the reply you deleted, as your swipe setting says: the same beats, told afresh" : "Redoing the reply you deleted: the scene plays again from your message");
    // A depth scene's calls are the author's, the characters' and the narrator's own: the request's tools (a preset's, an extension's) aren't offered to any of them, and the thinking block says so (L46).
    const tools = Array.isArray(ctx.body.tools) ? ctx.body.tools.length : 0;
    if (tools > 0) ctx.sink.progress(`This request offered ${tools === 1 ? "a tool" : `${tools} tools`}; a depth scene doesn't use them: its author, characters and narrator call only their own.`);
    // The on-screen allowance (W17): this story interval's turns with someone playing as their own agent, from the chain's live spends through the message the turn answers (read with its fold).
    const onScreen = onScreenAllowance(settings.depth.budget, spendsOn(read.at.events).map((s) => s.data), read.at.state.clock);
    const budget = await budgetFor(daySpendOf(this.rt.host), userId, settings.depth.budget, onScreen);
    const plan = bridge.planFor(turn.seed);
    const result = await runDepthTurn(
      {
        chatId,
        userId,
        // The generation, not the loopback's token: every beat's `by.turn` names it, and the token is the relay's credential.
        turn: ctx.generationId,
        kind: again ? "renarrate" : ctx.kind,
        at: read.at,
        plan: { events: turn.events, elapsedMinutes: plan?.elapsedMinutes ?? 0, resolutions: plan?.resolutions ?? [], chips: plan?.chips ?? [] },
        runSeed: bridge.runSeed,
        seed: turn.seed,
        input: read.input,
        ...(again ? { source: { pre: again.pre, read: again.read } } : read.source ? { source: read.source } : {}),
        ...(read.signals.length > 0 ? { signals: read.signals } : {}),
        ...(ctx.direction !== undefined ? { direction: ctx.direction } : {}),
        // The frame carries the recent window (B2's short context): the narrator keeps the voice from it.
        recent: "",
        frame: ctx.frame,
        settings,
        model: this.port(userId, ctx.sink, narratorSampling(ctx.body, narratorOverrides(settings.depth)), chatLinesOf(ctx.prompt ?? [])),
        sink: ctx.sink,
        signal: ctx.signal,
        rt: { registry: this.rt.registry, blobs: this.rt.blobs, host: this.rt.host },
        archive: this.archive(chatId, userId, read.at.basis.message),
        budget,
      },
      this.plugs,
    );
    // The step after the reply counts on from what the turn's record spent (its scene and each walk-on), against the per-turn ceiling, and names the turn in its own spend.
    const spent = recordedTokens(result.pre);
    this.afters.set(ctx.generationId, { ...result.after, turn: ctx.generationId, ...(spent > 0 ? { spent } : {}) });
    if (this.afters.size > AFTERS_KEPT) this.afters.delete(this.afters.keys().next().value ?? "");
    return { pre: adoption ? [...result.pre, adoptEvent(adoption)] : result.pre, read: result.read, blobs: result.blobs, ...(result.error !== undefined ? { error: result.error } : {}) };
  };

  /** What runs right after the depth reply of `generationId` (`afterDepthReply`), taken once by its commit; null when it played no depth turn. */
  after(generationId: string): AfterReply | null {
    const after = this.afters.get(generationId) ?? null;
    this.afters.delete(generationId);
    return after;
  }

  /** The fold through the message the turn answers (before the engine run), with the live talk and scene; the player's message there; a Re-narrate's source record; the player's signals beyond his words. */
  private async read(chatId: ChatId, userId: UserId, generationId: string, turn: PendingTurn, kind: GenerationKind, direction: string | undefined): Promise<TurnRead | null> {
    let out: TurnRead | null = null;
    await this.rt.ledger.with(chatId, userId, (core, observed) => {
      // The chain the run planned on may end with the reply's own message, which core staged blank as a new reply's generation started: the turn answers the message before it.
      const reply = core.journal.pending[generationId]?.messageId ?? null;
      const answered = turn.chain.findLast((e) => e.id !== reply);
      if (!answered) return;
      const chain = core.chain(observed);
      const index = chain.findIndex((m) => m.id === answered.id);
      const basis = basisAt(chain, core.journal.tombstones, index);
      const message = chain[index];
      const at = basis ? foldAtBasisOf(core, observed, basis, [STORY_TALK, STORY_SCENE, ...DRAFT_TYPES, ...SPEND_TYPES]) : null;
      if (!basis || !message || !at) return;
      let source: TurnRead["source"];
      if (turn.renarrateOf) {
        const rec = chain.find((m) => m.id === turn.renarrateOf?.messageId)?.ledger?.swipes[String(turn.renarrateOf.swipeId)];
        const pre: LedgerEvent[] = rec ? rec.events.slice(0, rec.pre) : [];
        if (!rec || !pre.some((e) => e.type === STORY_BEAT)) return;
        source = { pre, read: rec.events.slice(rec.pre) };
      }
      out = {
        at: { basis, state: at.state, world: at.world, story: at.story, events: at.events },
        input: message.isUser ? { messageId: message.id, text: message.swipes[message.swipeId] ?? "" } : null,
        ...(source ? { source } : {}),
        signals: swipeSignals(kind, chain.find((m) => m.id === reply), chain.slice(0, index).findLast((m) => !m.isUser), direction),
      };
    });
    return out;
  }

  /**
   * The chat's archive for the author's setup, through `upTo` (the message the turn answers), so a
   * swipe never reads the reply it replaces: read off the chat's queue at the first read, not before
   * (a setup that reads nothing costs nothing).
   */
  private archive(chatId: ChatId, userId: UserId, upTo: MessageId): ArchiveSource {
    let view: Promise<{ view: ArchiveView; last: number } | null> | null = null;
    const read = () =>
      (view ??= this.rt.ledger.archiveView(chatId, userId).then((v) => {
        const last = v?.messages.find((m) => m.id === upTo)?.index;
        return v && last !== undefined ? { view: v, last } : null;
      }));
    return {
      search: async (q: ArchiveQuery) => {
        const got = await read();
        return got ? this.rt.archive.searchView(chatId, userId, got.view, { ...q, upTo }) : { hits: [], total: 0 };
      },
      quote: async (r) => {
        const got = await read();
        const at = got?.view.messages.find((m) => m.id === r.messageId);
        return got && at && at.index <= got.last ? quoteView(got.view, r) : null;
      },
    };
  }

  /** The turn's model calls: each role on its Settings → Depth row, in the foreground's line on its connection (the turn goes first, §6.2), the narrator's with the preset's sampling and answer room from the loopback's body (§3.13), the Narrator row's own over them (`narratorSampling`, as the narrator off a scene has them), reported to the turn as answered, and refused where that row is the loopback itself (the call would come straight back). A call's own room still goes first. */
  private port(userId: UserId, sink: TurnSink, narrator: { params: SamplingParams; maxTokens: number | null }, chat: readonly ChatLine[]): ModelPort {
    const base = depthPort(this.rt.host, (u) => this.rt.settings.get(u), userId, { lane: "foreground" });
    const guarded: ModelPort = async (role, messages, opts) => {
      const route = depthCall(await this.rt.settings.get(userId), role);
      if (await this.rt.loopback.isLoopback(route.connectionId, userId)) {
        const label = DEPTH_ROLE_WORDS[role].label;
        throw new LoopbackRefused(
          "validation",
          route.connectionId === null
            ? `Your default connection is the loopback, so LumiRPEngine has no real model to send the ${label} call to: pick one in Settings → Depth → ${label} (or set the helper model's connection in Settings → Model use).`
            : `Settings → Depth → ${label} names the loopback connection, so its call would come straight back to LumiRPEngine: pick a real model there.`,
        );
      }
      if (role !== "narrator") return base(role, messages, opts);
      return base(role, messages, { ...opts, ...(Object.keys(narrator.params).length > 0 ? { params: { ...narrator.params, ...opts?.params } } : {}), ...(opts?.maxTokens === undefined && narrator.maxTokens !== null ? { maxTokens: narrator.maxTokens } : {}) });
    };
    return reporting(guarded, sink, Date.now, chat);
  }
}

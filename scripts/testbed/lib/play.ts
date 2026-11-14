// Playing a chat as the engine's page and Lumiverse's page do it together (DESIGN §5.1). The player's
// message goes in through Lumiverse's REST API and Send starts the reply. On the classic and agents
// engines the engine's guard stops that generation, runs the turn, and asks the page showing the chat
// to start the prepared reply (`lre.generate`); this page claims it (`lre.restart`) and starts it with
// Lumiverse's own Regenerate, Continue or Send, as the page's `restart.ts` does. On the harness the
// generation goes through to the runtime. A turn is over when its reply has ended and the engine's
// activity line is empty again.

import type { RunLog } from "./record";
import { say } from "./record";
import type { Lumiverse, Message } from "./lumiverse";
import type { EngineSocket, Frame, HostEvent } from "./socket";

/** How long one turn may take before the run gives up on it: a harness scene runs for minutes. */
const TURN_MS = 30 * 60_000;
const POLL_MS = 4_000;

export interface StateGet {
  view: Frame;
  activity: { state: "running" | "failed"; label: string; turn: string | null; since: number } | null;
}

export class Player {
  private shown: string | null = null;
  /** The prepared turns this page started or was told to send, so an ask that comes again starts nothing twice. */
  private readonly started = new Set<string>();

  constructor(
    readonly socket: EngineSocket,
    readonly host: Lumiverse,
    readonly log: RunLog,
    /** The connection Lumiverse's page sends as the active one; a chat pinned to another keeps its own. */
    readonly connectionId: string,
  ) {
    if (!socket.page) throw new Error("a player needs a page session");
    socket.onPush((push) => void this.prepared(push));
  }

  /** Opens a chat as the page does: the engine pushes its state here and asks this page to start its replies. */
  async show(chatId: string): Promise<void> {
    if (this.shown === chatId) return;
    await this.socket.lre("lre.hello", { chatId, viewing: true });
    this.shown = chatId;
  }

  private async prepared(push: Frame): Promise<void> {
    const chatId = this.shown;
    if (push.type !== "lre.generate" || chatId === null || push.chatId !== chatId || typeof push.turn !== "string" || this.started.has(push.turn)) return;
    const turn = push.turn;
    this.started.add(turn);
    try {
      if (push.as === "send") {
        // Only the player's own Send starts a new reply after a reply: the page presses it with nothing typed.
        say(`  the engine is ready (${turn}): Send`);
        await this.host.generate(chatId, "normal", this.connectionId);
        return;
      }
      const answer = await this.socket.lre<{ start: boolean }>("lre.restart", { chatId, turn });
      if (!answer.start) {
        this.started.delete(turn);
        return;
      }
      const as = push.as === "continue" ? "continue" : "regenerate";
      say(`  the engine is ready (${turn}): ${as}`);
      await this.host.generate(chatId, as, this.connectionId);
    } catch (error) {
      this.started.delete(turn);
      say(`  starting the prepared reply failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  state(chatId: string): Promise<StateGet> {
    return this.socket.lre<StateGet>("lre.state.get", { chatId });
  }

  /**
   * Starts a generation and waits for its reply to end and the engine to go quiet. Throws, with the
   * engine's words, when the turn fails instead.
   */
  async reply(chatId: string, start: () => Promise<unknown>, what: string): Promise<HostEvent> {
    await this.show(chatId);
    const from = this.socket.events.length;
    const began = Date.now();
    say(`${what}…`);
    await start();
    let ended: HostEvent | null = null;
    while (ended === null) {
      if (Date.now() - began > TURN_MS) throw new Error(`${what}: no reply within ${TURN_MS / 60_000} min`);
      await Bun.sleep(POLL_MS);
      const heard = this.socket.events.slice(from).filter((e) => e.payload.chatId === chatId);
      const done = heard.find((e) => e.event === "GENERATION_ENDED" && typeof e.payload.content === "string" && e.payload.content !== "" && !e.payload.error);
      if (done !== undefined) {
        ended = done;
        break;
      }
      const { activity } = await this.state(chatId);
      const lastStart = heard.filter((e) => e.event === "GENERATION_STARTED").at(-1)?.at ?? 0;
      // A failure line of this turn's, with no generation started since it, is the turn's end.
      if (activity?.state === "failed" && activity.since >= began - 1000 && lastStart < Date.now() - 10_000) throw new Error(`${what}: the engine says "${activity.label}"`);
      const errored = heard.find((e) => e.event === "GENERATION_ENDED" && e.payload.error);
      if (errored !== undefined && activity === null && Date.now() - errored.at > 20_000) throw new Error(`${what}: the reply failed: ${String(errored.payload.error)}`);
    }
    await this.quiet(chatId);
    say(`${what}: done in ${Math.round((Date.now() - began) / 1000)} s (message ${String(ended.payload.messageId)})`);
    return ended;
  }

  /** Waits until no generation runs in the chat and its engine activity line is empty (a turn's reading of its reply ends there). */
  async quiet(chatId: string): Promise<void> {
    let calm = 0;
    const began = Date.now();
    while (calm < 2) {
      if (Date.now() - began > TURN_MS) throw new Error("the chat never went quiet");
      await Bun.sleep(POLL_MS);
      const [{ activity }, status] = await Promise.all([this.state(chatId), this.host.generationStatus(chatId)]);
      calm = activity === null && status.active !== true ? calm + 1 : 0;
    }
  }

  /**
   * The player's message, then Send: a whole turn. A run that stopped after posting the message finds
   * it as the chat's last and presses its failed turn's Retry (or Send, with nothing typed) instead.
   */
  async turn(chatId: string, name: string, text: string): Promise<{ user: Message; reply: HostEvent }> {
    await this.show(chatId);
    const last = (await this.host.messages(chatId)).at(-1);
    let user: Message;
    let reply: HostEvent;
    if (last?.is_user === true && last.content === text) {
      user = last;
      reply = await this.retry(chatId);
    } else {
      user = await this.host.send(chatId, name, text);
      this.log.log({ step: "play", action: "created", kind: "message", id: user.id, detail: { chatId, user: true } });
      reply = await this.reply(chatId, () => this.host.generate(chatId, "normal", this.connectionId), `turn in ${chatId.slice(0, 8)}`);
    }
    this.log.log({ step: "play", action: "played", kind: "reply", id: String(reply.payload.messageId), detail: { chatId, generation: String(reply.payload.generationId) } });
    return { user, reply };
  }

  /** A failed turn's flag answered with its Retry, then the reply started as the flag says (Regenerate, Continue or Send). */
  async retry(chatId: string): Promise<HostEvent> {
    const chips = ((await this.state(chatId)).view.chips ?? []) as { id: string; kind: string; actions?: { id: string; starts?: string }[] }[];
    const flag = chips.find((c) => c.actions?.some((a) => a.starts !== undefined) && (c.kind === "engine_failed" || c.kind.endsWith("_failed")));
    const action = flag?.actions?.find((a) => a.starts !== undefined);
    if (flag === undefined || action === undefined) return this.reply(chatId, () => this.host.generate(chatId, "normal", this.connectionId), `send again in ${chatId.slice(0, 8)}`);
    const as = action.starts === "continue" ? "continue" : action.starts === "send" ? "normal" : "regenerate";
    return this.reply(
      chatId,
      async () => {
        await this.socket.lre("lre.chip", { chatId, chip: flag.id, choice: action.id });
        await this.host.generate(chatId, as, this.connectionId);
      },
      `retry (${flag.kind}) in ${chatId.slice(0, 8)}`,
    );
  }

  /** A new swipe of the last reply: Lumiverse's Regenerate. */
  async swipe(chatId: string): Promise<HostEvent> {
    const reply = await this.reply(chatId, () => this.host.generate(chatId, "regenerate", this.connectionId), `swipe in ${chatId.slice(0, 8)}`);
    this.log.log({ step: "play", action: "played", kind: "swipe", id: String(reply.payload.messageId), detail: { chatId, generation: String(reply.payload.generationId) } });
    return reply;
  }
}

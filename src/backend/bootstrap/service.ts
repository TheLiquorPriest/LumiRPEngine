// GM → This chat → Depth's opt-in and the Bootstrap view (DEPTH-PLAN §7, §8): the chat's depth flag,
// its bootstrap run (one per chat, in the background lane, under its own cap), and the view every page
// of the user's reads, pushed as the run moves. Opting in offers the bootstrap with its estimate, and
// is refused while the user can't play depth (Settings → Loopback shows no relay Running, no key or
// no loopback connection: `loopbackUnready`), and pins the chat to the user's loopback connection,
// restoring the pin it replaced on opting out; the run starts only on the user's own press. Nothing is
// hidden: the view carries every stage's progress and spend, the log, the spot-check cards, and,
// once the run reaches the latest message, the advice to turn off the memory systems the bootstrap
// replaced for this chat (D-18), and nothing more.

import type { ChatId, UserId } from "../../shared/ids";
import type { JsonObject } from "../../shared/json";
import { PROTOCOL_VERSION } from "../../shared/protocol";
import type { BootstrapRequest } from "../../shared/protocol";
import type { BootstrapAdvice, BootstrapCap, BootstrapEstimate, BootstrapView, ImportView } from "../../shared/bootstrap";
import type { Runtime } from "../runtime";
import { BootstrapFiles } from "./files";
import { BootstrapRun } from "./run";
import { bootstrapEnv } from "./wiring";
import { chatNumbers } from "../depth/chat-numbers";

export class BootstrapError extends Error {
  /** `unavailable`: depth can't be played by this user now (`loopbackUnready`), so the opt-in is refused; the page offers Settings → Loopback. */
  constructor(
    readonly code: "bad_request" | "conflict" | "not_world_chat" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "BootstrapError";
  }
}

const OPT = "depth.json";

/** A chat's connection pin, as Lumiverse generates on it (its metadata's `connection_profile_id` and `connection_model`): null where unset. A type, so it is the metadata patch that restores it. */
type ChatPin = {
  connection_profile_id: string | null;
  connection_model: string | null;
};

/** `depth.json`: whether the chat is on depth, and while it is, the loopback connection opting in pinned it to and the pin that replaced (restored on opting out). */
interface Opt {
  on: boolean;
  pin?: { loopback: string; prior: ChatPin };
}

const isNullableString = (v: unknown): v is string | null => v === null || typeof v === "string";

function isChatPin(raw: unknown): raw is ChatPin {
  return typeof raw === "object" && raw !== null && "connection_profile_id" in raw && isNullableString(raw.connection_profile_id) && "connection_model" in raw && isNullableString(raw.connection_model);
}

function isOpt(raw: unknown): raw is Opt {
  if (typeof raw !== "object" || raw === null || !("on" in raw) || typeof raw.on !== "boolean") return false;
  if (!("pin" in raw) || raw.pin === undefined) return true;
  const pin = raw.pin;
  return typeof pin === "object" && pin !== null && "loopback" in pin && typeof pin.loopback === "string" && "prior" in pin && isChatPin(pin.prior);
}

/** The chat's pin, read from its metadata: a value Lumiverse wouldn't generate on (absent, not a string) reads as unset. */
function pinOf(meta: JsonObject): ChatPin {
  const read = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
  return { connection_profile_id: read(meta.connection_profile_id), connection_model: read(meta.connection_model) };
}

/** Whether the chat is on depth (GM → This chat → Depth): what every depth reader asks first. */
export async function depthOptedIn(rt: Pick<Runtime, "host">, chatId: ChatId, userId: UserId): Promise<boolean> {
  return (await new BootstrapFiles(rt.host, chatId, userId).read(OPT, isOpt))?.on === true;
}

/** D-18: once the chat's memory is the ledger, the notebook and the minds, the advice to turn off what they replace for it; nothing more. */
export function adviceOf(imported: readonly ImportView[]): BootstrapAdvice[] {
  // Found where entries were read, or where the chat is marked as using it (LumiBooks' markers) though nothing could be read.
  const found = (source: ImportView["source"]): boolean => imported.some((v) => v.source === source && (v.entries > 0 || v.marked === true));
  const lead = "This chat's memory is now its beats, its characters' minds and the author's notebook, reconciled with what";
  return [
    { system: "lumibooks", found: found("lumibooks"), text: `${lead} Lumibooks kept. Turn Lumibooks off for this chat (its memory books in World Info), so the narrator isn't given a second, older version of the story. Its books stay as they are.` },
    { system: "summary", found: found("summary"), text: `${lead} the chat's summary held. Turn off Summary for this chat (the Summary panel); the summary itself stays.` },
    { system: "cortex", found: found("cortex"), text: `${lead} Memory Cortex kept. Turn off Memory Cortex for this chat (the Memory Cortex panel); its memories stay.` },
  ];
}

export class Bootstraps {
  /** Each chat's run, by `user \0 chat`. */
  private readonly runs = new Map<string, BootstrapRun>();
  /** The status each run was last pushed with: the toast comes once, when a run first reaches the latest message. */
  private readonly told = new Map<string, string>();

  constructor(private readonly rt: Runtime) {}

  private runOf(chatId: ChatId, userId: UserId): BootstrapRun {
    const key = `${userId}\u0000${chatId}`;
    let run = this.runs.get(key);
    if (!run) {
      run = new BootstrapRun(bootstrapEnv(this.rt, chatId, userId, () => void this.push(chatId, userId)));
      this.runs.set(key, run);
    }
    return run;
  }

  private async worldChat(chatId: ChatId, userId: UserId): Promise<void> {
    if (!(await this.rt.ledger.core(chatId, userId)) || !(await this.rt.runOf(chatId, userId))) throw new BootstrapError("not_world_chat", "This chat isn't attached to a world: depth runs on world chats.");
  }

  async view(chatId: ChatId, userId: UserId): Promise<BootstrapView> {
    const run = this.runOf(chatId, userId);
    const view = await run.view(await depthOptedIn(this.rt, chatId, userId));
    // A spot-check beat names the message it came from by the number the chat shows it with (`chatNumbers`), not its place on the path the run spooled.
    const numbers = view.spot.some((card) => card.items.some((item) => item.kind === "beat")) ? await chatNumbers(this.rt.host, chatId, userId) : null;
    const spot = numbers ? view.spot.map((card) => ({ ...card, items: card.items.map((item) => (item.kind === "beat" ? { ...item, index: numbers.get(item.message) ?? item.index } : item)) })) : view.spot;
    return { ...view, spot, advice: view.status === "done" ? adviceOf(view.imported) : [] };
  }

  /** Answers one `lre.bootstrap` request with the chat's view, and the estimate where it asked for one. */
  async handle(r: BootstrapRequest, userId: UserId): Promise<{ view: BootstrapView; estimate?: BootstrapEstimate }> {
    const { chatId } = r;
    const run = this.runOf(chatId, userId);
    switch (r.op) {
      case "status":
        break;
      case "estimate": {
        await this.worldChat(chatId, userId);
        if (!run.busy) await run.survey();
        const view = await this.view(chatId, userId);
        return view.remaining ? { view, estimate: view.remaining } : { view };
      }
      case "opt": {
        await this.worldChat(chatId, userId);
        // Only a user who can play it opts in, so nobody spends a bootstrap on a chat whose turns can't reach depth: a relay Running, the key, a loopback connection.
        const unready = r.on === true ? await this.rt.loopback.unready(userId) : null;
        if (unready !== null) throw new BootstrapError("unavailable", `Depth can't start on this chat yet. ${unready}`);
        await this.pin(chatId, userId, r.on === true);
        if (r.on !== true) await run.pause();
        else if (!run.busy) await run.survey();
        const view = await this.view(chatId, userId);
        await this.push(chatId, userId);
        return r.on === true && view.remaining ? { view, estimate: view.remaining } : { view };
      }
      case "start":
      case "resume": {
        await this.worldChat(chatId, userId);
        if (!(await depthOptedIn(this.rt, chatId, userId))) throw new BootstrapError("conflict", "Put this chat on depth first (GM → This chat → Depth): the bootstrap onboards a chat that opted in.");
        await run.start(await this.capOf(r.cap, userId));
        break;
      }
      case "pause":
        await run.pause();
        break;
      case "mark":
        if (typeof r.card !== "string" || typeof r.item !== "string" || typeof r.right !== "boolean") throw new BootstrapError("bad_request", "name the card, the item and the mark");
        await run.mark(r.card, r.item, r.right, typeof r.note === "string" ? r.note : "").catch((error: unknown) => {
          throw new BootstrapError("bad_request", error instanceof Error ? error.message : String(error));
        });
        break;
      case "redo":
        if (typeof r.chapter !== "number" || !Number.isInteger(r.chapter) || r.chapter < 0) throw new BootstrapError("bad_request", "name the chapter to redo from");
        await run.redo(r.chapter).catch((error: unknown) => {
          throw new BootstrapError(run.busy ? "conflict" : "bad_request", error instanceof Error ? error.message : String(error));
        });
        break;
      default:
        throw new BootstrapError("bad_request", "no such bootstrap request");
    }
    const view = await this.view(chatId, userId);
    await this.push(chatId, userId);
    return { view };
  }

  /**
   * Writes the chat's opt-in, and its pin (Lumiverse generates on a chat's pinned connection first):
   * opting in pins it to the user's loopback connection, the one it is pinned to already if it is
   * one, else the first, with no model of its own (the connection's); opting out puts back the pin
   * that replaced, unless the user has pinned the chat elsewhere since. The pin replaced is recorded
   * before the chat is pinned, and kept across a second opt-in, so opting out always finds it. One
   * opt at a time per chat: `depth.json` is read and written under the chat's metadata queue, beside
   * the pin, so the second of two opt-ins at once finds the first's record and never records the
   * loopback the first pinned as the pin it replaced.
   */
  private async pin(chatId: ChatId, userId: UserId, on: boolean): Promise<void> {
    const files = new BootstrapFiles(this.rt.host, chatId, userId);
    const chats = this.rt.host.chats;
    const loopback = on ? await this.rt.loopback.connections(userId) : [];
    await this.rt.chatMeta.run(chatId, userId, async () => {
      const was = await files.read(OPT, isOpt);
      if (!on) {
        const pinned = was?.pin;
        if (pinned && pinOf(await chats.chatMetadata(chatId, userId)).connection_profile_id === pinned.loopback) await chats.mergeChatMetadata(chatId, pinned.prior, userId);
        await files.write(OPT, { on: false } satisfies Opt);
        return;
      }
      const now = pinOf(await chats.chatMetadata(chatId, userId));
      const id = (loopback.find((c) => c.id === now.connection_profile_id) ?? loopback[0])?.id;
      if (id === undefined) throw new BootstrapError("unavailable", "Depth can't start on this chat yet. None of your connections is the loopback: make one as Settings → Loopback shows.");
      await files.write(OPT, { on: true, pin: { loopback: id, prior: was?.pin?.prior ?? now } } satisfies Opt);
      if (now.connection_profile_id !== id || now.connection_model !== null) await chats.mergeChatMetadata(chatId, { connection_profile_id: id, connection_model: null }, userId);
    });
  }

  /** The cap a start or resume runs under: the request's, else the user's default (Settings → Depth → Bootstrap). */
  private async capOf(cap: BootstrapCap | "none" | undefined, userId: UserId): Promise<BootstrapCap | null | undefined> {
    if (cap === "none") return null;
    if (cap !== undefined) {
      if ((cap.unit !== "money" && cap.unit !== "tokens") || typeof cap.value !== "number" || !Number.isFinite(cap.value) || cap.value <= 0) throw new BootstrapError("bad_request", "a cap is money or tokens, above zero");
      return { unit: cap.unit, value: cap.value };
    }
    const fallback = (await this.rt.settings.get(userId)).depth.bootstrap.cap;
    return fallback === "none" ? null : { ...fallback };
  }

  /** Sends the chat's view to every page of the user's; the first time a run is done, says so with a toast and the D-18 advice. */
  async push(chatId: ChatId, userId: UserId): Promise<void> {
    try {
      const view = await this.view(chatId, userId);
      this.rt.host.frontend.send({ lre: PROTOCOL_VERSION, type: "lre.bootstrap.update", chatId, view }, userId);
      const key = `${userId}\u0000${chatId}`;
      const before = this.told.get(key);
      this.told.set(key, view.status);
      if (view.status === "done" && before !== undefined && before !== "done") {
        const off = view.advice.filter((a) => a.found).map((a) => (a.system === "lumibooks" ? "Lumibooks" : a.system === "summary" ? "Summary" : "Memory Cortex"));
        this.rt.host.toast(`The bootstrap reached the latest message: this chat's memory is now its beats, minds and notebook.${off.length > 0 ? ` Consider turning off ${off.join(", ")} for it (GM → Bootstrap says why).` : ""}`, userId);
      }
    } catch (error) {
      this.rt.host.log("warn", `[LumiRPEngine] the bootstrap's view wasn't sent (${error instanceof Error ? error.message : String(error)})`, userId);
    }
  }

  /** Waits for every run under way to stop (shutdown, tests). */
  async idle(): Promise<void> {
    await Promise.all([...this.runs.values()].map((r) => r.settled()));
  }
}

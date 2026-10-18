// Hidden JSON blocks in world chats (DESIGN §6.7). A preset may ask every reply to carry a
// `<json>…</json>` block (a tracker, a ledger). World Info's scans read a chat's replies as saved, before
// any prompt script runs, so a world chat's replies are saved with each block inside
// `<span wi-exclude>…</span>`, which the scans skip, after every other response script. Nothing else should
// see that span: two of the user's own scripts, global and first on `display` and in the prompt, take it
// off again, so a preset's display script that draws the block as a tracker, a prompt script that strips
// old blocks from the history, markdown and the narrator all read the reply as the AI wrote it. Last on
// `display`, while hiding is on, each block still raw is hidden. The block stays byte for byte as written
// throughout, so `{{jsonBlock}}` and any other reader still find it.
//
// The wrapping and the hiding are a world chat's own scripts, which a chat that isn't a world chat never
// gets. The unwraps match nothing but the engine's own span, wherever it was saved, so they stay when hiding
// is turned off and when a world or a chat goes.
//
// While hiding is on, the engine's own reads of a reply leave out every block the display hides, a
// Continue's matched against the whole message so a block it split goes too (`readableReply`). Replies an
// earlier build saved with `<div hidden wi-exclude>` around a block stay hidden in the display whatever the
// setting, so the block inside that wrapper is always left out.

import type { ChatId, UserId, WorldId } from "../shared/ids";
import { isRecord } from "../shared/json";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import type { HostPort, HostRegexScript, HostRegexScriptInput } from "./host";

/** What a world chat's replies are saved with around each block: an exclusion from World Info's scans, nothing hidden. */
const EXCLUDE_OPEN = "<span wi-exclude>";
const EXCLUDE_CLOSE = "</span>";

/** An earlier build's wrapper, still in the replies it saved: hidden in the display whatever the setting. */
const OLD_OPEN = "<div hidden wi-exclude>";

/**
 * Where the engine's scripts sort. The frontend runs display scripts by sort order whatever their scope;
 * the backend runs response and prompt scripts the global ones first, then the chat's, each by sort order.
 * So the global unwraps, sorted first, run before every other display and prompt script, and a chat's
 * wrapping and hiding, sorted last, after the others on their targets.
 */
const FIRST = -100_000;
const LAST = 100_000;

/**
 * A block as the host reads one (src/macros/json-blocks.ts): `<json>` in any case and without
 * attributes, to the first `</json>` outside a JSON string, with no other `<json>` outside one.
 * Following the strings keeps a `</json>` inside a string value from ending the match, so a wrapper
 * never lands inside a block.
 */
const JSON_BLOCK = String.raw`<[Jj][Ss][Oo][Nn]>(?:"(?:[^"\\]|\\[\s\S])*"|[^"<]|<(?!\/?[Jj][Ss][Oo][Nn]>))*<\/[Jj][Ss][Oo][Nn]>`;

/** An earlier build's hidden wrapper with its block, whitespace inside it or not (a narrator may copy the wrapper from its history). */
const OLD_WRAPPED = `${OLD_OPEN}\\s*${JSON_BLOCK}\\s*</div>`;

/** Every block the display hides while hiding is on, with the wrapper around it when it has one. */
const SHOWN_HIDDEN = new RegExp(`${OLD_WRAPPED}|${EXCLUDE_OPEN}${JSON_BLOCK}${EXCLUDE_CLOSE}|${JSON_BLOCK}`, "g");

/** The blocks the display hides whatever the setting: those inside an earlier build's wrapper. */
const OLD_HIDDEN = new RegExp(OLD_WRAPPED, "g");

/**
 * A reply as the engine reads it, from `from` on (a Continue reads what it added): each block the display
 * hides left out with its wrapper (a space keeps the words around it apart), matched against the whole
 * text, so a block that starts before `from` goes too. With hiding off, only the blocks inside an earlier
 * build's wrapper are left out.
 */
export function readableReply(text: string, hiding: boolean, from = 0): string {
  let out = "";
  let at = from;
  for (const m of text.matchAll(hiding ? SHOWN_HIDDEN : OLD_HIDDEN)) {
    const end = m.index + m[0].length;
    if (end <= at) continue;
    out += `${text.slice(at, Math.max(at, m.index))} `;
    at = end;
  }
  return out + text.slice(at);
}

/** The engine's scripts: a world chat's wrapping and hiding, and the user's unwrap on each target that reads a reply. */
type Role = "exclude" | "hide" | "unwrap.display" | "unwrap.prompt";

/** A world chat's scripts: the exclusion on `response`, the hiding on `display`. */
function worldChatScripts(chatId: ChatId, worldId: WorldId): Record<"exclude" | "hide", HostRegexScriptInput> {
  return {
    exclude: {
      name: "LumiRPEngine · JSON blocks out of World Info",
      scriptId: `lre_jsonx_${chatId}`,
      chatId,
      findRegex: `(?<!${EXCLUDE_OPEN}|${OLD_OPEN})${JSON_BLOCK}`,
      replaceString: `${EXCLUDE_OPEN}$&${EXCLUDE_CLOSE}`,
      flags: "g",
      placement: ["ai_output"],
      targets: ["response"],
      runOnEdit: true,
      sortOrder: LAST,
      description: "Saves each <json> block of this LumiRPEngine world chat's replies inside <span wi-exclude>, which World Info doesn't scan, after your other response scripts. LumiRPEngine's \"JSON blocks as written\" scripts take the span off again before anything else reads the reply. LumiRPEngine manages it.",
      folder: "LumiRPEngine",
      metadata: { [LEDGER_NAMESPACE]: { json: "exclude", worldId } },
    },
    // The script an earlier build wrote (on both targets, wrapping in a hidden div) had this id and role, so it is rewritten in place as this one.
    hide: {
      name: "LumiRPEngine · Hide JSON blocks",
      scriptId: `lre_json_${chatId}`,
      chatId,
      findRegex: JSON_BLOCK,
      replaceString: "<span hidden>$&</span>",
      flags: "g",
      placement: ["ai_output"],
      targets: ["display"],
      runOnEdit: false,
      sortOrder: LAST,
      description: "Hides the <json> blocks still showing in this LumiRPEngine world chat's replies, after your other display scripts, so a tracker one of them draws from a block stays. LumiRPEngine manages it: turn it off in its Settings → Preset.",
      folder: "LumiRPEngine",
      metadata: { [LEDGER_NAMESPACE]: { json: "hide", worldId } },
    },
  };
}

/** The user's unwrap on `target`: global, first, and matching nothing but the engine's own span around a block. */
function unwrapScript(target: "display" | "prompt"): HostRegexScriptInput {
  return {
    name: `LumiRPEngine · JSON blocks as written (${target})`,
    scriptId: `lre_json_unwrap_${target}`,
    chatId: null,
    findRegex: `${EXCLUDE_OPEN}(${JSON_BLOCK})${EXCLUDE_CLOSE}`,
    replaceString: "$1",
    flags: "g",
    placement: ["ai_output"],
    targets: [target],
    runOnEdit: false,
    sortOrder: FIRST,
    description: `Takes off the <span wi-exclude> LumiRPEngine saves around the <json> blocks of its world chats' replies (it keeps them out of World Info) before your other ${target} scripts run, so they and ${target === "display" ? "the chat" : "the AI"} read each reply as the AI wrote it. It changes nothing else. LumiRPEngine manages it.`,
    folder: "LumiRPEngine",
    metadata: { [LEDGER_NAMESPACE]: { json: `unwrap.${target}` } },
  };
}

/** Which of the engine's scripts this is; null for one it doesn't own (a copy the user made is theirs: the host doesn't let the engine change it). */
function roleOf(s: HostRegexScript): Role | null {
  const ns = s.metadata[LEDGER_NAMESPACE];
  const role = isRecord(ns) ? ns.json : undefined;
  return s.mine && (role === "exclude" || role === "hide" || role === "unwrap.display" || role === "unwrap.prompt") ? role : null;
}

/** Whether a kept script still is the one the engine would write now (a newer build may write another). */
function upToDate(s: HostRegexScript, want: HostRegexScriptInput): boolean {
  const ns = s.metadata[LEDGER_NAMESPACE];
  const wanted = want.metadata[LEDGER_NAMESPACE];
  const placement = s.placement.length === want.placement.length && want.placement.every((p) => s.placement.includes(p));
  const targets = s.targets.length === want.targets.length && want.targets.every((t) => s.targets.includes(t));
  return s.findRegex === want.findRegex && s.replaceString === want.replaceString && s.flags === want.flags && s.runOnEdit === want.runOnEdit && s.sortOrder === want.sortOrder && placement && targets && isRecord(ns) && isRecord(wanted) && ns.worldId === wanted.worldId;
}

/**
 * The scripts' lifecycle. A world chat gets its scripts when a world is attached to it, and the first
 * time the engine meets it after starting (a chat attached before, or one whose scripts were deleted in
 * the regex panel); the user's unwraps are checked with the first. Turning hiding off removes every
 * chat's hiding, and on again brings each back as its chat is met. A chat stops being a world chat when
 * its world is deleted, and its scripts go with it, or with the chat; its replies keep the span, so the
 * unwraps stay.
 */
export class JsonHiding {
  /** `user \0 chat` checked since the backend started. */
  private readonly checked = new Set<string>();
  /** Users whose unwraps were checked since the backend started, or since hiding last changed. */
  private readonly unwrapped = new Set<UserId>();
  /** Work per `user \0 chat` (and `user \0` for the unwraps), in order, so a script is never written twice at once. */
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly host: HostPort,
    /** Whether the user hides JSON blocks: only the hiding depends on it. */
    private readonly hides: (userId: UserId) => Promise<boolean>,
    /** Whether the world still exists: a deleted world's chats keep its id in their metadata, and never get their scripts back. */
    private readonly worldExists: (worldId: WorldId, userId: UserId) => Promise<boolean>,
  ) {}

  private queued(key: string, step: () => Promise<void>): Promise<void> {
    const next = (this.queues.get(key) ?? Promise.resolve()).then(step);
    const kept = next.catch(() => undefined);
    this.queues.set(key, kept);
    void kept.finally(() => {
      if (this.queues.get(key) === kept) this.queues.delete(key);
    });
    return next;
  }

  /** One scope's scripts brought in line: an up-to-date copy of each role `want` has, and none of the other `roles`. */
  private async sync(kept: readonly HostRegexScript[], roles: readonly Role[], want: Partial<Record<Role, HostRegexScriptInput>>, userId: UserId): Promise<void> {
    for (const role of roles) {
      const copies = kept.filter((s) => roleOf(s) === role);
      const wanted = want[role];
      const [first] = copies;
      if (wanted && !first) await this.host.regex.write(null, wanted, userId);
      else if (wanted && first && !upToDate(first, wanted)) await this.host.regex.write(first.id, wanted, userId);
      for (const s of wanted ? copies.slice(1) : copies) await this.host.regex.remove(s.id, userId);
    }
  }

  /** The chat's scripts, created or brought up to date while its world exists, with the user's unwraps. */
  ensure(chatId: ChatId, worldId: WorldId, userId: UserId): Promise<void> {
    return this.queued(`${userId}\u0000${chatId}`, async () => {
      if (!(await this.worldExists(worldId, userId))) return;
      // The unwraps before the wrapping: no reply is saved with the span while nothing takes it off again.
      if (!this.unwrapped.has(userId)) {
        await this.queued(`${userId}\u0000`, async () => this.sync(await this.host.regex.globalScripts(userId), ["unwrap.display", "unwrap.prompt"], { "unwrap.display": unwrapScript("display"), "unwrap.prompt": unwrapScript("prompt") }, userId));
        this.unwrapped.add(userId);
      }
      const want = worldChatScripts(chatId, worldId);
      const kept = (await this.host.regex.chatScripts(chatId, userId)).filter((s) => s.chatId === chatId);
      await this.sync(kept, ["exclude", "hide"], (await this.hides(userId)) ? want : { exclude: want.exclude }, userId);
    });
  }

  /** A world chat the engine meets: its scripts are checked once per backend run, in the background. */
  seen(chatId: ChatId, worldId: WorldId, userId: UserId): void {
    const key = `${userId}\u0000${chatId}`;
    if (this.checked.has(key)) return;
    this.checked.add(key);
    if (this.checked.size > 4096) this.checked.delete(this.checked.values().next().value ?? "");
    this.ensure(chatId, worldId, userId).catch((error: unknown) => {
      // Checked again the next time the chat is met (the permission may be granted by then).
      this.checked.delete(key);
      this.host.log("warn", `[LumiRPEngine] chat ${chatId}: the JSON regex scripts weren't written (${error instanceof Error ? error.message : String(error)})`, userId);
    });
  }

  /** Removes the engine's chat-scoped scripts that `which` picks, among every chat's. */
  private async removeWhere(userId: UserId, which: (s: HostRegexScript) => boolean): Promise<void> {
    for (const s of await this.host.regex.chatScripts(null, userId)) {
      if (roleOf(s) !== null && which(s)) await this.queued(`${userId}\u0000${s.chatId}`, () => this.host.regex.remove(s.id, userId));
    }
  }

  /** Hiding turned off: every world chat's hiding goes. The wrapping and the unwraps stay, so replies show their blocks as the AI wrote them and World Info still skips them. */
  async removeHiding(userId: UserId): Promise<void> {
    this.forget(userId);
    await this.removeWhere(userId, (s) => roleOf(s) === "hide");
  }

  /** Hiding changed: each world chat's scripts, and the unwraps, are checked again as the engine meets them. */
  forget(userId: UserId): void {
    for (const key of [...this.checked]) if (key.startsWith(`${userId}\u0000`)) this.checked.delete(key);
    this.unwrapped.delete(userId);
  }

  /** A deleted chat: the host keeps its chat-scoped scripts, so the engine's go. */
  async removeChat(chatId: ChatId, userId: UserId): Promise<void> {
    this.checked.delete(`${userId}\u0000${chatId}`);
    await this.removeWhere(userId, (s) => s.chatId === chatId);
  }

  /** A deleted world's chats aren't world chats any more. */
  async removeWorld(worldId: WorldId, userId: UserId): Promise<void> {
    await this.removeWhere(userId, (s) => {
      const ns = s.metadata[LEDGER_NAMESPACE];
      return isRecord(ns) && ns.worldId === worldId;
    });
  }
}

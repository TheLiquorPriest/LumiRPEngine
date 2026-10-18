// Hidden JSON blocks in world chats (DESIGN §6.7). A preset may ask every reply to carry a
// `<json>…</json>` block (a tracker, a ledger). Each world chat keeps two chat-scoped regex scripts of the
// engine's own. On `response`, and again on an edit, each block is wrapped in `<span wi-exclude>…</span>`:
// World Info scanning skips it, nothing is hidden, the block stays byte for byte as written
// (`{{jsonBlock}}` and any other reader still find it), and an inline span leaves the markdown around the
// block alone; a lookbehind keeps it from wrapping a block twice. On `display`, after the chat's other
// display scripts (a high sort order), each block still raw is wrapped in `<span hidden>…</span>`, so a
// preset whose own display script draws the block as a tracker keeps its tracker. Chats that aren't world
// chats get none.
//
// While hiding is on, the engine's own reads of a reply leave out every block the display hides, a
// Continue's matched against the whole message so a block it split goes too (`readableReply`). Replies an
// earlier build saved with `<div hidden wi-exclude>` around a block stay hidden in the display whatever the
// setting, so the block inside that wrapper is always left out.

import type { ChatId, UserId, WorldId } from "../shared/ids";
import { isRecord } from "../shared/json";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import type { HostPort, HostRegexScript, HostRegexScriptInput } from "./host";

/** What the `response` script wraps a block in: an exclusion from World Info scanning, nothing hidden. */
const EXCLUDE_OPEN = "<span wi-exclude>";
const EXCLUDE_CLOSE = "</span>";

/** An earlier build's wrapper, still in the replies it saved: hidden in the display whatever the setting. */
const OLD_OPEN = "<div hidden wi-exclude>";

/** The display script's sort order: lower ones run first, so the chat's other display scripts come before it. */
export const JSON_HIDE_SORT_ORDER = 100_000;

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

/** The scripts a world chat keeps: the exclusion on `response`, the hiding on `display`. */
export function jsonScripts(chatId: ChatId, worldId: WorldId): Record<"exclude" | "hide", HostRegexScriptInput> {
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
      sortOrder: 0,
      description: "Keeps the <json> blocks in this LumiRPEngine world chat's replies out of World Info scanning; each block stays as written. LumiRPEngine manages it: turn it off in its Settings → Preset.",
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
      sortOrder: JSON_HIDE_SORT_ORDER,
      description: "Hides the <json> blocks still showing in this LumiRPEngine world chat's replies, after the chat's other display scripts. LumiRPEngine manages it: turn it off in its Settings → Preset.",
      folder: "LumiRPEngine",
      metadata: { [LEDGER_NAMESPACE]: { json: "hide", worldId } },
    },
  };
}

/** Which of the engine's scripts this is; null for one it doesn't own (a copy the user made is theirs: the host doesn't let the engine change it). */
function roleOf(s: HostRegexScript): "exclude" | "hide" | null {
  const ns = s.metadata[LEDGER_NAMESPACE];
  return s.mine && isRecord(ns) && (ns.json === "exclude" || ns.json === "hide") ? ns.json : null;
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
 * the regex panel); turning hiding off removes every one, and on again brings each back as its chat is
 * met. A chat stops being a world chat when its world is deleted, and its scripts go with it.
 */
export class JsonHiding {
  /** `user \0 chat` checked since the backend started. */
  private readonly checked = new Set<string>();
  /** Work per `user \0 chat`, in order, so a script is never written twice at once. */
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly host: HostPort,
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

  /** The chat's scripts, created or brought up to date, while the user hides JSON blocks. */
  ensure(chatId: ChatId, worldId: WorldId, userId: UserId): Promise<void> {
    return this.queued(`${userId}\u0000${chatId}`, async () => {
      if (!(await this.hides(userId)) || !(await this.worldExists(worldId, userId))) return;
      const want = jsonScripts(chatId, worldId);
      const kept = (await this.host.regex.chatScripts(chatId, userId)).filter((s) => s.chatId === chatId);
      for (const role of ["exclude", "hide"] as const) {
        const [first, ...extra] = kept.filter((s) => roleOf(s) === role);
        if (!first) await this.host.regex.write(null, want[role], userId);
        else if (!upToDate(first, want[role])) await this.host.regex.write(first.id, want[role], userId);
        for (const s of extra) await this.host.regex.remove(s.id, userId);
      }
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

  /** Removes the engine's scripts that `which` picks, among every chat's. */
  private async removeWhere(userId: UserId, which: (s: HostRegexScript) => boolean): Promise<void> {
    for (const s of await this.host.regex.chatScripts(null, userId)) {
      if (roleOf(s) !== null && which(s)) await this.queued(`${userId}\u0000${s.chatId}`, () => this.host.regex.remove(s.id, userId));
    }
  }

  /** Hiding turned off: every world chat's scripts go. */
  async removeAll(userId: UserId): Promise<void> {
    for (const key of [...this.checked]) if (key.startsWith(`${userId}\u0000`)) this.checked.delete(key);
    await this.removeWhere(userId, () => true);
  }

  /** Hiding turned on again: each world chat gets its scripts back as the engine meets it. */
  forget(userId: UserId): void {
    for (const key of [...this.checked]) if (key.startsWith(`${userId}\u0000`)) this.checked.delete(key);
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

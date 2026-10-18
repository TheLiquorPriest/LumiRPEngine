// Hidden JSON blocks in world chats (DESIGN §6.7). A preset may ask every reply to end with a
// `<json>…</json>` block (a tracker, a ledger). Each world chat keeps one chat-scoped regex script of
// the engine's own that wraps every such block in `<div hidden wi-exclude>…</div>`: the display hides
// it and World Info scanning skips it, while the block itself stays byte for byte as written, so
// `{{jsonBlock}}` and any other reader still finds it. The script bakes new replies (`response`),
// renders older ones the same way (`display`) and runs again on an edit; a lookbehind keeps it from
// wrapping a block twice. Chats that aren't world chats get no script. The engine's own reads of a
// reply leave out exactly what the script wraps (`withoutHiddenJson`).

import type { ChatId, UserId, WorldId } from "../shared/ids";
import { isRecord } from "../shared/json";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import type { HostPort, HostRegexScript, HostRegexScriptInput } from "./host";

export const JSON_WRAP_OPEN = "<div hidden wi-exclude>";
export const JSON_WRAP_CLOSE = "</div>";

/**
 * A block as the host reads one (src/macros/json-blocks.ts): `<json>` in any case and without
 * attributes, to the first `</json>` outside a JSON string, with no other `<json>` outside one.
 * Following the strings keeps a `</json>` inside a string value from ending the match, so the wrapper
 * never lands inside a block.
 */
const JSON_BLOCK = String.raw`<[Jj][Ss][Oo][Nn]>(?:"(?:[^"\\]|\\[\s\S])*"|[^"<]|<(?!\/?[Jj][Ss][Oo][Nn]>))*<\/[Jj][Ss][Oo][Nn]>`;

/** Exactly what the script writes: the wrapper with one block in it. */
const HIDDEN_JSON = new RegExp(`${JSON_WRAP_OPEN}${JSON_BLOCK}${JSON_WRAP_CLOSE}`, "g");

/** A reply as the engine reads it: each block the script hid, with its wrapper, left out (a space keeps the words around it apart). */
export function withoutHiddenJson(text: string): string {
  return text.includes(JSON_WRAP_OPEN) ? text.replace(HIDDEN_JSON, " ") : text;
}

/** The script a world chat keeps. */
export function jsonHidingScript(chatId: ChatId, worldId: WorldId): HostRegexScriptInput {
  return {
    name: "LumiRPEngine · Hide JSON blocks",
    scriptId: `lre_json_${chatId}`,
    chatId,
    findRegex: `(?<!${JSON_WRAP_OPEN})${JSON_BLOCK}`,
    replaceString: `${JSON_WRAP_OPEN}$&${JSON_WRAP_CLOSE}`,
    flags: "g",
    placement: ["ai_output"],
    targets: ["response", "display"],
    runOnEdit: true,
    description: "Hides the <json> blocks in this LumiRPEngine world chat's replies and keeps them out of World Info scanning; each block stays as written. LumiRPEngine manages it: turn it off in its Settings → Preset.",
    folder: "LumiRPEngine",
    metadata: { [LEDGER_NAMESPACE]: { json: "hide", worldId } },
  };
}

/** One of the engine's own JSON scripts (a script the user copied is theirs: the host doesn't let the engine change it). */
function engineScript(s: HostRegexScript): boolean {
  const ns = s.metadata[LEDGER_NAMESPACE];
  return s.mine && isRecord(ns) && ns.json === "hide";
}

/** Whether a kept script still is the one the engine would write now (a newer build may write another). */
function upToDate(s: HostRegexScript, want: HostRegexScriptInput): boolean {
  const ns = s.metadata[LEDGER_NAMESPACE];
  const wanted = want.metadata[LEDGER_NAMESPACE];
  const placement = s.placement.length === want.placement.length && want.placement.every((p) => s.placement.includes(p));
  const targets = s.targets.length === want.targets.length && want.targets.every((t) => s.targets.includes(t));
  return s.findRegex === want.findRegex && s.replaceString === want.replaceString && s.flags === want.flags && s.runOnEdit === want.runOnEdit && placement && targets && isRecord(ns) && isRecord(wanted) && ns.worldId === wanted.worldId;
}

/**
 * The scripts' lifecycle. A world chat gets its script when a world is attached to it, and the first
 * time the engine meets it after starting (a chat attached before, or one whose script was deleted in
 * the regex panel); turning hiding off removes every one, and on again brings each back as its chat is
 * met. A chat stops being a world chat when its world is deleted, and its script goes with it.
 */
export class JsonHiding {
  /** `user \0 chat` checked since the backend started. */
  private readonly checked = new Set<string>();
  /** Work per `user \0 chat`, in order, so a script is never written twice at once. */
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly host: HostPort,
    private readonly hides: (userId: UserId) => Promise<boolean>,
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

  /** The chat's script, created or brought up to date, while the user hides JSON blocks. */
  ensure(chatId: ChatId, worldId: WorldId, userId: UserId): Promise<void> {
    return this.queued(`${userId}\u0000${chatId}`, async () => {
      if (!(await this.hides(userId))) return;
      const want = jsonHidingScript(chatId, worldId);
      const [kept, ...extra] = (await this.host.regex.chatScripts(chatId, userId)).filter((s) => s.chatId === chatId && engineScript(s));
      if (!kept) await this.host.regex.write(null, want, userId);
      else if (!upToDate(kept, want)) await this.host.regex.write(kept.id, want, userId);
      for (const s of extra) await this.host.regex.remove(s.id, userId);
    });
  }

  /** A world chat the engine meets: its script is checked once per backend run, in the background. */
  seen(chatId: ChatId, worldId: WorldId, userId: UserId): void {
    const key = `${userId}\u0000${chatId}`;
    if (this.checked.has(key)) return;
    this.checked.add(key);
    if (this.checked.size > 4096) this.checked.delete(this.checked.values().next().value ?? "");
    this.ensure(chatId, worldId, userId).catch((error: unknown) => {
      // Checked again the next time the chat is met (the permission may be granted by then).
      this.checked.delete(key);
      this.host.log("warn", `[LumiRPEngine] chat ${chatId}: the JSON-hiding regex script wasn't written (${error instanceof Error ? error.message : String(error)})`, userId);
    });
  }

  /** Removes the engine's scripts that `which` picks, among every chat's. */
  private async removeWhere(userId: UserId, which: (s: HostRegexScript) => boolean): Promise<void> {
    for (const s of await this.host.regex.chatScripts(null, userId)) {
      if (engineScript(s) && which(s)) await this.queued(`${userId}\u0000${s.chatId}`, () => this.host.regex.remove(s.id, userId));
    }
  }

  /** Hiding turned off: every world chat's script goes. */
  async removeAll(userId: UserId): Promise<void> {
    for (const key of [...this.checked]) if (key.startsWith(`${userId}\u0000`)) this.checked.delete(key);
    await this.removeWhere(userId, () => true);
  }

  /** Hiding turned on again: each world chat gets its script back as the engine meets it. */
  forget(userId: UserId): void {
    for (const key of [...this.checked]) if (key.startsWith(`${userId}\u0000`)) this.checked.delete(key);
  }

  /** A deleted world's chats aren't world chats any more. */
  async removeWorld(worldId: WorldId, userId: UserId): Promise<void> {
    await this.removeWhere(userId, (s) => {
      const ns = s.metadata[LEDGER_NAMESPACE];
      return isRecord(ns) && ns.worldId === worldId;
    });
  }
}

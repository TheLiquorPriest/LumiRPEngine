// A host message as today's backend decodes it from Lumiverse's rows and event payloads, carried for
// the migration (PlanSwap-5). The old backend's port over the `spindle` global
// (src/backend/spindle-host.ts) decodes through this.

import type { JsonObject, JsonValue } from "../../shared/json";
import { isRecord } from "../../shared/json";
import type { ChatId } from "../../shared/ids";
import type { HostMessage } from "../../shared/host";

/** A deep copy of host data as JSON (dropping functions, undefined and non-finite numbers). */
export function toJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(toJson);
  if (isRecord(value)) return toJsonObject(value);
  return null;
}

export function toJsonObject(value: unknown): JsonObject {
  const out: JsonObject = {};
  if (!isRecord(value)) return out;
  for (const [k, v] of Object.entries(value)) if (v !== undefined && typeof v !== "function") out[k] = toJson(v);
  return out;
}

export function str(o: unknown, key: string): string | undefined {
  if (!isRecord(o)) return undefined;
  const v = o[key];
  return typeof v === "string" ? v : undefined;
}

export function num(o: unknown, key: string): number | undefined {
  if (!isRecord(o)) return undefined;
  const v = o[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** A host message (`getMessages` row or event DTO). `spindle_metadata` arrives as `metadata` or inside `extra`. */
export function decodeMessage(raw: unknown, chatId: ChatId): HostMessage | null {
  if (!isRecord(raw)) return null;
  const id = str(raw, "id");
  if (!id) return null;
  const swipes = Array.isArray(raw.swipes) ? raw.swipes.map((s) => (typeof s === "string" ? s : "")) : [];
  const stored = str(raw, "content") ?? "";
  const swipeId = num(raw, "swipe_id") ?? 0;
  if (swipes.length === 0) swipes.push(stored);
  // The host keeps the shown swipe's text as `content` too: a message kept holds that text once.
  const shown = swipes[swipeId];
  const content = shown === stored ? shown : stored;
  const extra = isRecord(raw.extra) ? raw.extra : {};
  const metadata = isRecord(raw.metadata) ? raw.metadata : isRecord(extra.spindle_metadata) ? extra.spindle_metadata : {};
  const role = str(raw, "role");
  return {
    id,
    chatId: str(raw, "chat_id") ?? chatId,
    index: num(raw, "index_in_chat") ?? 0,
    isUser: raw.is_user === true || role === "user",
    name: str(raw, "name") ?? "",
    content,
    swipeId,
    swipes,
    metadata: toJsonObject(metadata),
  };
}

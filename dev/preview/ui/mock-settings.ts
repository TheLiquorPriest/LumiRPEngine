// The Settings page's routes in the preview: the invented settings of test/ui/settings-recorded.ts, kept
// in memory while the preview runs. A write sets the value at its level, `~` sets none there, and taking
// a key away leaves its default (the stand-in keeps no farther level's value under it). A value a
// setting does not take is refused, as RPE refuses it. Every chat is served the same settings.

import type { JsonValue } from "../../../src/shared/json";
import type { SettingsReply, SettingsWrite, SettingView } from "../../../src/ui/api";
import { SETTINGS } from "../../../test/ui/settings-recorded";

const answer = (status: number, body: unknown): Response => Response.json(body, { status, headers: { "cache-control": "no-store" } });

let reply: SettingsReply = structuredClone(SETTINGS);

/** Whether `setting` takes `value`. */
function takes(setting: SettingView, value: JsonValue): boolean {
  const t = setting.takes;
  if (t.type === "whole") return typeof value === "number" && Number.isInteger(value) && value >= t.least;
  if (t.type === "number") return typeof value === "number" && value >= t.least;
  if (t.type === "oneOf") return typeof value === "string" && t.values.includes(value);
  if (t.type === "yesNo") return typeof value === "boolean";
  if (t.type === "texts") return Array.isArray(value) && value.every((v) => typeof v === "string");
  return typeof value === "string" && value.trim() !== "";
}

/** The stand-in's answer to `/api/v1/settings`. */
export async function settingsAnswer(request: Request, url: URL): Promise<Response> {
  if (request.method === "GET") return answer(200, { ...reply, chat: url.searchParams.get("chat") || null });
  if (request.method !== "PUT") return answer(405, { error: `RPE has no ${request.method} ${url.pathname}.` });
  const body = (await request.json().catch(() => null)) as SettingsWrite | null;
  if (body === null || typeof body.key !== "string") return answer(400, { error: 'Send {"level": "global" or "chat", "chat": "<its id>", "key": "<the setting>", "value": …}: null takes the key away at that level, and "none": true sets ~.' });
  const setting = reply.settings.find((s) => s.key === body.key);
  if (setting === undefined) return answer(400, { error: `RPE reads no setting "${body.key}".` });
  if (body.level === "shipped") return answer(400, { error: "The shipped file is never written: set the value at the global level, or a chat's." });
  if (!setting.levels.includes(body.level)) return answer(400, { error: `${body.key} is read from the ${setting.levels.join(" and ")} level alone.` });
  if (body.none && !setting.orNone) return answer(400, { error: `${body.key} takes no ~: it takes ${setting.takesWords}.` });
  if (!body.none && body.value !== null && !takes(setting, body.value)) return answer(400, { error: `${body.key} takes ${setting.takesWords}.` });
  const file = reply.files.find((f) => f.level === body.level)?.file ?? null;
  const next: SettingView = body.none ? { ...setting, value: null, from: body.level, file } : body.value === null ? { ...setting, value: setting.default, from: null, file: null } : { ...setting, value: body.value, from: body.level, file };
  reply = { ...reply, settings: reply.settings.map((s) => (s.key === body.key ? { ...next, passed: null } : s)) };
  return answer(200, { ...reply, chat: body.chat });
}

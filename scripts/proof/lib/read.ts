// Readers over HTTP, for every proof script (PlanGates-4 "gives to others"): RPE's turn routes, its turn
// folder, its view of a chat's tree and its settings; Lumiverse's stored prompt, a chat's rows and what
// it holds of plain generation's reasoning. Each answers what the route gave, typed, and nothing else;
// the floor's facts are made from them by the pure readers beside this file.
//
// Routes, and where each shape was taken from:
// - RPE `GET /api/v1/chats/:chat/turns/:turn`, `GET /api/v1/files?chat=`, `GET /api/v1/files/*?chat=`, `GET /api/v1/settings?chat=`:
//   RPE `src/ui/api.ts` (`TurnDetail`, `TreeListing`, `TreeFileText`, `SettingsReply`).
// - RPE `GET /api/v1/chats/:chat/turns/:turn/requests/*`: one model call's kept request, which RPH keeps as pointers into the turn's
//   files, rebuilt exactly as it was sent (RPE `src/turn/shapes.ts` `requestReply`: `{ name, same, messages, tools }`).
// - RPE `GET /api/v1/chats/:chat/turns/:turn/lore` (PlanLore-13): `{ entries: LoreEntry[] }`, the shape the lead ruled on 15 Nov.
// - Lumiverse `GET /api/v1/generate/breakdown/:messageId`: `src/routes/generate.routes.ts:175-181`, its `messages` written at
//   `src/services/generate.service.ts:4448-4459`; `GET /api/v1/connections/:id`: `src/routes/connections.routes.ts:71-76`;
//   `GET /api/v1/settings/:key`: `src/routes/settings.routes.ts:20-25`; `GET /api/v1/presets/:id`: `src/routes/presets.routes.ts:139`;
//   `POST /api/v1/tokenizers/count` (`src/routes/tokenizers.routes.ts:86-93`): `tokenizerSvc.countForModel`, the count Lumiverse's
//   own speed figure takes of a response's visible text (`src/services/generate.service.ts:4340-4356`).

import type { ConnectionsShown, SettingsReply, SettingsWrite } from "../../../src/shared/api";
import type { TreeFileEntry, TreeFileText } from "../../../src/ui/api";
import { isRecord } from "../../../src/shared/json";
import { HttpError, type Lumiverse } from "../../testbed/lib/lumiverse";
import { plainReasoning, sha256, type Layer, type OffFile, type OwnLevel, type PlainReasoning, type TreeFile } from "./record";
import type { ChatRow, StoredMessage } from "./sent";

/** One entry of a turn's activated lore, as PlanLore-13's route gives it (the lead's ruling, 15 Nov): the lore map's id, Lumiverse's entry and book, its title, and how it activated where the tag says. */
export interface LoreEntry {
  id: string;
  entry: string;
  book: string;
  title: string;
  how: "constant" | "keyword" | "vector" | "sticky" | null;
}

const segments = (path: string): string => path.split("/").map(encodeURIComponent).join("/");

/** RPE's routes, with a page token or the web key. */
export class RpeReader {
  constructor(
    readonly base: string,
    readonly token: string,
  ) {}

  private async get(path: string): Promise<unknown> {
    const reply = await fetch(`${this.base}${path}`, { headers: { Accept: "application/json", Authorization: `Bearer ${this.token}` } });
    const text = await reply.text();
    if (!reply.ok) throw new Error(`RPE GET ${path}: ${reply.status} ${text.slice(0, 300)}`);
    return JSON.parse(text);
  }

  private turnPath(chat: string, turn: string): string {
    return `/api/v1/chats/${encodeURIComponent(chat)}/turns/${encodeURIComponent(turn)}`;
  }

  /** The turn route's answer as it came: the floor reads the fields it knows and says which are not served. */
  turn(chat: string, turn: string): Promise<unknown> {
    return this.get(this.turnPath(chat, turn));
  }

  /** One model call's request, by its file below the turn's folder, as RPE rebuilds it from the pointers RPH kept; the answer as it came (`same` says whether the rebuild is what was sent). */
  request(chat: string, turn: string, file: string): Promise<unknown> {
    return this.get(`${this.turnPath(chat, turn)}/requests/${segments(file)}`);
  }

  /** The lore route's entries; "not served" by an RPE without the route (PlanLore-13), which answers 404. */
  async lore(chat: string, turn: string): Promise<LoreEntry[] | "not served"> {
    const path = `${this.turnPath(chat, turn)}/lore`;
    const reply = await fetch(`${this.base}${path}`, { headers: { Accept: "application/json", Authorization: `Bearer ${this.token}` } });
    if (reply.status === 404) return "not served";
    const text = await reply.text();
    if (!reply.ok) throw new Error(`RPE GET ${path}: ${reply.status} ${text.slice(0, 300)}`);
    const answer: unknown = JSON.parse(text);
    if (!isRecord(answer) || !Array.isArray(answer.entries)) throw new Error("RPE's lore route gave no list of entries");
    return answer.entries as LoreEntry[];
  }

  async view(chat: string): Promise<TreeFileEntry[]> {
    return ((await this.get(`/api/v1/files?chat=${encodeURIComponent(chat)}`)) as { files: TreeFileEntry[] }).files;
  }

  async viewFile(chat: string, path: string): Promise<string> {
    return ((await this.get(`/api/v1/files/${segments(path)}?chat=${encodeURIComponent(chat)}`)) as TreeFileText).text;
  }

  settings(chat: string): Promise<SettingsReply> {
    return this.get(`/api/v1/settings?chat=${encodeURIComponent(chat)}`) as Promise<SettingsReply>;
  }

  /** Writes one setting into one level's config file, as the Settings page does (`PUT /api/v1/settings`); answers every setting as it then stands. Settings are never guidance: a gate that writes one is not changing what the agents are told. */
  async put(write: SettingsWrite): Promise<SettingsReply> {
    const reply = await fetch(`${this.base}/api/v1/settings`, { method: "PUT", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${this.token}` }, body: JSON.stringify(write) });
    const text = await reply.text();
    if (!reply.ok) throw new Error(`RPE PUT /api/v1/settings: ${reply.status} ${text.slice(0, 300)}`);
    return JSON.parse(text) as SettingsReply;
  }

  /** RPE's own connections, as its route shows them (no key): the provider each is of, by name and id. */
  connections(): Promise<ConnectionsShown> {
    return this.get("/api/v1/connections") as Promise<ConnectionsShown>;
  }

  /** The shipped level as RPE serves it to a chat, by path below the level; each layer of the user's own: their files the user can write; and each shipped file an `off:` list switches off, with the levels whose list does. */
  async trees(chat: string): Promise<{ shipped: TreeFile[]; layers: Layer[]; off: OffFile[] }> {
    const files = await this.view(chat);
    const shipped: TreeFile[] = [];
    const off: OffFile[] = [];
    const layers = new Map<OwnLevel, TreeFile[]>();
    for (const f of files) {
      if (f.level !== "shipped" && f.kind !== "yours") continue;
      const path = f.level === "shipped" ? f.path.replace(/^@shipped\//, "") : f.path;
      const hashed = { path, sha256: sha256(await this.viewFile(chat, f.path)) };
      if (f.level === "shipped") {
        shipped.push(hashed);
        if (f.off || f.offIn.length > 0) off.push({ path, offIn: [...f.offIn] });
      } else layers.set(f.level, [...(layers.get(f.level) ?? []), hashed]);
    }
    return { shipped, layers: [...layers].map(([level, list]) => ({ level, files: list })), off };
  }
}

/** Lumiverse's routes, as the run's user. */
export class LumiverseReader {
  constructor(readonly host: Lumiverse) {}

  private async getOrNull<T>(path: string): Promise<T | null> {
    try {
      return await this.host.call<T>("GET", path);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return null;
      throw error;
    }
  }

  /** The prompt Lumiverse stored with a reply; null when it stored none (a stopped or failed generation stores none, plan l.217). */
  async stored(messageId: string): Promise<StoredMessage[] | null> {
    const breakdown = await this.getOrNull<unknown>(`/api/v1/generate/breakdown/${encodeURIComponent(messageId)}`);
    if (breakdown === null) return null;
    if (!isRecord(breakdown) || !Array.isArray(breakdown.messages)) throw new Error(`Lumiverse's breakdown of ${messageId} holds no messages`);
    return breakdown.messages.map((m) => (isRecord(m) ? { role: String(m.role), content: typeof m.content === "string" ? m.content : null } : { role: "", content: null }));
  }

  /** A chat's saved rows in order. */
  async rows(chatId: string): Promise<ChatRow[]> {
    return (await this.host.messages(chatId)).map((m) => ({ id: m.id, role: m.is_user ? "user" : m.extra?.spindle_role === "system" ? "system" : "assistant", content: m.content, hidden: m.extra?.hidden === true }));
  }

  /** A connection's provider and model, as Lumiverse holds them. */
  async connection(connectionId: string): Promise<{ provider: string | null; model: string | null }> {
    const connection = await this.host.call<{ provider?: unknown; model?: unknown }>("GET", `/api/v1/connections/${encodeURIComponent(connectionId)}`);
    return { provider: typeof connection.provider === "string" ? connection.provider : null, model: typeof connection.model === "string" ? connection.model : null };
  }

  /** Lumiverse's own count of a text's tokens for a model: the tokenizer its speed figure counts a response's visible text with. */
  async visibleTokens(model: string, text: string): Promise<number> {
    const answer = await this.host.call<{ token_count?: unknown }>("POST", "/api/v1/tokenizers/count", { model_id: model, text });
    if (typeof answer.token_count !== "number") throw new Error(`Lumiverse's token count for ${model} gave no number`);
    return answer.token_count;
  }

  /** Plain generation's reasoning and model, as Lumiverse holds them for the connection and the preset. */
  async plain(connectionId: string, presetId: string): Promise<PlainReasoning & { model: string }> {
    const connection = await this.host.call<{ model?: string; metadata?: { reasoningBindings?: { settings?: unknown } } | null }>("GET", `/api/v1/connections/${encodeURIComponent(connectionId)}`);
    const global = await this.getOrNull<{ value?: unknown }>("/api/v1/settings/reasoningSettings");
    const preset = await this.host.call<{ parameters?: { customBody?: unknown } | null }>("GET", `/api/v1/presets/${encodeURIComponent(presetId)}`);
    const reasoning = plainReasoning({ connection: connectionId, preset: presetId, binding: connection.metadata?.reasoningBindings?.settings, global: global?.value, presetCustomBody: preset.parameters?.customBody });
    return { ...reasoning, model: connection.model ?? "" };
  }
}

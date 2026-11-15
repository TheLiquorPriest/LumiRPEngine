// Readers over HTTP, for every proof script (PlanGates-4 "gives to others"): RPE's turn routes, its turn
// folder, its view of a chat's tree and its settings; Lumiverse's stored prompt, a chat's rows and what
// it holds of plain generation's reasoning. Each answers what the route gave, typed, and nothing else;
// the floor's facts are made from them by the pure readers beside this file.
//
// Routes, and where each shape was taken from:
// - RPE `GET /api/v1/chats/:chat/turns/:turn`, `.../files/*`, `GET /api/v1/files?chat=`, `GET /api/v1/files/*?chat=`,
//   `GET /api/v1/settings?chat=`: RPE `src/ui/api.ts` (`TurnDetail`, `TurnFile`, `TreeListing`, `TreeFileText`, `SettingsReply`).
// - RPE `GET /api/v1/chats/:chat/turns/:turn/lore` (PlanLore-13): `{ entries: LoreEntry[] }`, the shape the lead ruled on 15 Nov.
// - Lumiverse `GET /api/v1/generate/breakdown/:messageId`: `src/routes/generate.routes.ts:175-181`, its `messages` written at
//   `src/services/generate.service.ts:4448-4459`; `GET /api/v1/connections/:id`: `src/routes/connections.routes.ts:71-76`;
//   `GET /api/v1/settings/:key`: `src/routes/settings.routes.ts:20-25`; `GET /api/v1/presets/:id`: `src/routes/presets.routes.ts:139`.

import type { SettingsReply } from "../../../src/shared/api";
import type { TreeFileEntry, TreeFileText, TurnFile } from "../../../src/ui/api";
import { isRecord } from "../../../src/shared/json";
import { HttpError, type Lumiverse } from "../../testbed/lib/lumiverse";
import { plainReasoning, sha256, type Layer, type OwnLevel, type PlainReasoning, type TreeFile } from "./record";

/** One entry of a turn's activated lore, as PlanLore-13's route gives it (the lead's ruling, 15 Nov): the lore map's id, Lumiverse's entry and book, its title, and how it activated where the tag says. */
export interface LoreEntry {
  id: string;
  entry: string;
  book: string;
  title: string;
  how: "constant" | "keyword" | "vector" | "sticky" | null;
}

/** A message of the prompt Lumiverse stored with a reply. */
export interface StoredMessage {
  role: string;
  content: string;
}

/** One of a chat's saved rows, as the window counts them: hidden is `extra.hidden` (Lumiverse `src/services/chats.service.ts:3104-3109`), a system row is `extra.spindle_role` (`src/utils/message-role.ts:4-5`). */
export interface ChatRow {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  hidden: boolean;
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

  async turnFile(chat: string, turn: string, file: string): Promise<string> {
    const answer = (await this.get(`${this.turnPath(chat, turn)}/files/${segments(file)}`)) as TurnFile;
    return answer.text;
  }

  async lore(chat: string, turn: string): Promise<LoreEntry[]> {
    const answer = await this.get(`${this.turnPath(chat, turn)}/lore`);
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

  /** The shipped level as RPE serves it to a chat, by path below the level, and each layer of the user's own: their files the user can write. */
  async trees(chat: string): Promise<{ shipped: TreeFile[]; layers: Layer[] }> {
    const files = await this.view(chat);
    const shipped: TreeFile[] = [];
    const layers = new Map<OwnLevel, TreeFile[]>();
    for (const f of files) {
      if (f.level !== "shipped" && f.kind !== "yours") continue;
      const hashed = { path: f.level === "shipped" ? f.path.replace(/^@shipped\//, "") : f.path, sha256: sha256(await this.viewFile(chat, f.path)) };
      if (f.level === "shipped") shipped.push(hashed);
      else layers.set(f.level, [...(layers.get(f.level) ?? []), hashed]);
    }
    return { shipped, layers: [...layers].map(([level, list]) => ({ level, files: list })) };
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
    return breakdown.messages.map((m) => (isRecord(m) ? { role: String(m.role), content: typeof m.content === "string" ? m.content : "" } : { role: "", content: "" }));
  }

  /** A chat's saved rows in order. */
  async rows(chatId: string): Promise<ChatRow[]> {
    return (await this.host.messages(chatId)).map((m) => ({ id: m.id, role: m.is_user ? "user" : m.extra?.spindle_role === "system" ? "system" : "assistant", content: m.content, hidden: m.extra?.hidden === true }));
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

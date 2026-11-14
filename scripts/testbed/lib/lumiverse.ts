// Lumiverse's own REST API, as the signed-in user. The token is the one the engine's CLI saved at
// `lumirpengine login` (the scripts sign in once, through the CLI, and never again: Lumiverse locks
// an address out after repeated sign-ins). A bearer request with no Origin and no Cookie passes
// Lumiverse's origin checks, as the CLI's own requests do.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { configHome, type TestbedEnv } from "./env";

export interface Message {
  id: string;
  chat_id: string;
  index_in_chat: number;
  is_user: boolean;
  name: string;
  content: string;
  swipe_id: number;
  swipes: string[];
  extra?: { [key: string]: unknown };
}

export interface Chat {
  id: string;
  name: string;
  character_id: string | null;
  metadata?: { [key: string]: unknown };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    what: string,
  ) {
    super(`${what}: ${status} ${body.slice(0, 300)}`);
  }
}

/** The CLI's saved session token for this host. */
export function savedToken(env: TestbedEnv): string {
  const path = join(configHome(env), "lumirpengine", "credentials.json");
  if (!existsSync(path)) throw new Error(`no sign-in at ${path}: run the engine's CLI login first (see README)`);
  const saved = JSON.parse(readFileSync(path, "utf8")) as { hosts?: { [base: string]: { token?: string } } };
  const token = saved.hosts?.[env.hostUrl]?.token;
  if (typeof token !== "string" || token === "") throw new Error(`the CLI has no sign-in for ${env.hostUrl}`);
  return token;
}

export class Lumiverse {
  constructor(
    readonly base: string,
    readonly token: string,
  ) {}

  async call<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
    const headers: { [key: string]: string } = { Accept: "application/json", Authorization: `Bearer ${this.token}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const reply = await fetch(`${this.base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), redirect: "manual" });
    const text = await reply.text();
    if (!reply.ok) throw new HttpError(reply.status, text, `${method} ${path}`);
    return (text === "" ? null : JSON.parse(text)) as T;
  }

  /** The signed-in user's id (the folder name of their storage). */
  async userId(): Promise<string> {
    const session = await this.call<{ user?: { id?: string } } | null>("GET", "/api/auth/get-session");
    const id = session?.user?.id;
    if (typeof id !== "string") throw new Error("the session names no user");
    return id;
  }

  /** Every chat of the user's, newest first, paged. Only ids and names are used. */
  async chats(): Promise<Chat[]> {
    const out: Chat[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await this.call<{ data: Chat[]; total: number }>("GET", `/api/v1/chats?limit=100&offset=${offset}`);
      out.push(...page.data);
      if (page.data.length < 100 || out.length >= page.total) return out;
    }
  }

  chat(chatId: string): Promise<Chat> {
    return this.call<Chat>("GET", `/api/v1/chats/${chatId}`);
  }

  async messages(chatId: string): Promise<Message[]> {
    const out: Message[] = [];
    for (let offset = 0; ; offset += 200) {
      const page = await this.call<{ data: Message[]; total: number }>("GET", `/api/v1/chats/${chatId}/messages?limit=200&offset=${offset}&full=true`);
      out.push(...page.data);
      if (page.data.length < 200 || out.length >= page.total) return out.sort((a, b) => a.index_in_chat - b.index_in_chat);
    }
  }

  createChat(characterId: string, name: string): Promise<Chat> {
    return this.call<Chat>("POST", "/api/v1/chats", { character_id: characterId, name });
  }

  deleteChat(chatId: string): Promise<unknown> {
    return this.call("DELETE", `/api/v1/chats/${chatId}`);
  }

  branch(chatId: string, messageId: string, name: string): Promise<Chat> {
    return this.call<Chat>("POST", `/api/v1/chats/${chatId}/branch`, { message_id: messageId, name });
  }

  send(chatId: string, name: string, content: string): Promise<Message> {
    return this.call<Message>("POST", `/api/v1/chats/${chatId}/messages`, { name, content, is_user: true });
  }

  edit(chatId: string, messageId: string, content: string): Promise<Message> {
    return this.call<Message>("PUT", `/api/v1/chats/${chatId}/messages/${messageId}`, { content });
  }

  deleteMessage(chatId: string, messageId: string): Promise<unknown> {
    return this.call("DELETE", `/api/v1/chats/${chatId}/messages/${messageId}`);
  }

  /** Shows the swipe to the left or right of the one shown (Lumiverse's swipe arrows, short of generating). */
  cycleSwipe(chatId: string, messageId: string, direction: "left" | "right"): Promise<Message> {
    return this.call<Message>("POST", `/api/v1/chats/${chatId}/messages/${messageId}/swipe`, { direction });
  }

  /**
   * Starts a generation as Lumiverse's own page does: Send (`normal`), Regenerate or Continue. A chat
   * pinned to a connection generates on it; `connectionId` is the page's active connection.
   */
  generate(chatId: string, as: "normal" | "regenerate" | "continue", connectionId?: string): Promise<{ generationId?: string }> {
    const path = as === "normal" ? "/api/v1/generate" : as === "regenerate" ? "/api/v1/generate/regenerate" : "/api/v1/generate/continue";
    return this.call("POST", path, { chat_id: chatId, ...(connectionId ? { connection_id: connectionId } : {}), ...(as === "regenerate" ? { generation_type: "regenerate" } : {}) });
  }

  generationStatus(chatId: string): Promise<{ [key: string]: unknown }> {
    return this.call("GET", `/api/v1/generate/status/${chatId}`);
  }

  async characters(): Promise<{ id: string; name: string }[]> {
    const page = await this.call<{ data: { id: string; name: string }[] }>("GET", "/api/v1/characters?limit=500");
    return page.data;
  }

  createCharacter(card: { [key: string]: unknown }): Promise<{ id: string; name: string }> {
    return this.call("POST", "/api/v1/characters", card);
  }

  async worldBooks(): Promise<{ id: string; name: string }[]> {
    const page = await this.call<{ data: { id: string; name: string }[] }>("GET", "/api/v1/world-books?limit=500");
    return page.data;
  }

  createWorldBook(book: { [key: string]: unknown }): Promise<{ id: string; name: string }> {
    return this.call("POST", "/api/v1/world-books", book);
  }

  async bookEntries(bookId: string): Promise<{ id: string; [key: string]: unknown }[]> {
    const page = await this.call<{ data: { id: string; [key: string]: unknown }[] } | { id: string }[]>("GET", `/api/v1/world-books/${bookId}/entries?limit=500`);
    return Array.isArray(page) ? page : page.data;
  }

  createEntry(bookId: string, entry: { [key: string]: unknown }): Promise<{ id: string; [key: string]: unknown }> {
    return this.call("POST", `/api/v1/world-books/${bookId}/entries`, entry);
  }

  async connections(): Promise<{ id: string; name: string; provider?: string; model?: string }[]> {
    const page = await this.call<{ data: { id: string; name: string; provider?: string; model?: string }[] } | { id: string; name: string }[]>("GET", "/api/v1/connections?limit=200");
    return Array.isArray(page) ? page : page.data;
  }

  async mcpServers(): Promise<{ id: string; name: string; transport_type?: string; command?: string; is_enabled?: boolean }[]> {
    const page = await this.call<{ data: { id: string; name: string }[] } | { id: string; name: string }[]>("GET", "/api/v1/mcp-servers");
    return Array.isArray(page) ? page : page.data;
  }

  /** The engine's extension row: its database id addresses socket frames. */
  async extension(identifier: string): Promise<{ id: string; status: string; enabled: boolean }> {
    const list = await this.call<{ extensions: { id: string; identifier: string; status: string; enabled: boolean }[] }>("GET", "/api/v1/spindle");
    const found = list.extensions.find((e) => e.identifier === identifier);
    if (!found) throw new Error(`extension ${identifier} is not installed`);
    return found;
  }

  async ticket(): Promise<string> {
    const body = await this.call<{ ticket: string }>("POST", "/api/v1/ws-ticket", {});
    return body.ticket;
  }
}

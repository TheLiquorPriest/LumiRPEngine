// The rig's network door onto the stand-in Lumiverse (PlanScenarios-2 items 6 and 7). The stand-in is in-process: its
// address is a name no network knows and its sockets are objects. The floor's readers and a browser need an address
// they can reach, so this door listens on a free loopback port and hands each request to the stand-in as it comes:
// HTTP to its `fetch`, a socket upgrade to its `open`. It adds nothing a Lumiverse does not do: the browser's
// session is a cookie that becomes the bearer the stand-in reads (Better Auth sets one at sign-in, `auth/index.ts`),
// and the two pages a person sees (the sign-in and the chat page, `chat-page.ts`) are served here, as Lumiverse's own
// server serves its pages. Whatever the stand-in answers to an API route is what the door answers; a route it does
// not have is the stand-in's to be missing, never the door's to make up.

import type { Socket, SocketEvents } from "../../../src/adapter/lumiverse/socket";

/** What the door needs of the Lumiverse behind it: the stand-in's server has all of it. */
export interface Behind {
  /** The address the stand-in believes it has; every request is handed to it under this. */
  readonly base: string;
  fetch(url: string, init: RequestInit): Promise<Response>;
  open(url: string, events: SocketEvents): Socket;
}

/** A page the door serves itself: its path, and the HTML. */
export type DoorPages = (path: string) => string | null;

export interface Door {
  /** The door's address on loopback, as a browser or the floor's readers open it. */
  readonly base: string;
  stop(): Promise<void>;
}

/** The session cookie the door keeps for a browser: the token the stand-in gave at sign-in. */
export const SESSION_COOKIE = "lumiverse_session";

const SIGN_IN = "/api/auth/sign-in/username";

interface Held {
  path: string;
  inner: Socket | null;
}

const cookieOf = (header: string | null, name: string): string | null => {
  for (const part of (header ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
};

/** A close code a WebSocket may send; Lumiverse's own codes pass, a reserved one (1005, 1006) goes as an error. */
const sendable = (code: number): number => (code === 1000 || (code >= 3000 && code < 5000) || (code >= 1001 && code <= 1014 && code !== 1004 && code !== 1005 && code !== 1006) ? code : 1011);

export function openDoor(behind: Behind, pages: DoorPages): Door {
  const server = Bun.serve<Held>({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request, serving) {
      const url = new URL(request.url);
      if (url.pathname === "/api/ws" && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
        return serving.upgrade(request, { data: { path: `${url.pathname}${url.search}`, inner: null } }) ? undefined : new Response("not a socket", { status: 400 });
      }
      const page = request.method === "GET" ? pages(url.pathname) : null;
      if (page !== null) return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
      if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
      const headers = new Headers(request.headers);
      headers.delete("host");
      const session = cookieOf(request.headers.get("cookie"), SESSION_COOKIE);
      if (!headers.has("authorization") && session !== null) headers.set("authorization", `Bearer ${session}`);
      const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
      const answered = await behind.fetch(`${behind.base}${url.pathname}${url.search}`, { method: request.method, headers, ...(body === undefined ? {} : { body }) });
      const out = new Headers(answered.headers);
      out.delete("content-length");
      out.delete("content-encoding");
      if (url.pathname === SIGN_IN && answered.ok) {
        const given: unknown = await answered.clone().json().catch(() => null);
        const token = typeof given === "object" && given !== null && "token" in given && typeof given.token === "string" ? given.token : null;
        if (token !== null) out.append("set-cookie", `${SESSION_COOKIE}=${token}; Path=/`);
      }
      return new Response(answered.body, { status: answered.status, headers: out });
    },
    websocket: {
      open(ws) {
        ws.data.inner = behind.open(`${behind.base.replace(/^http/, "ws")}${ws.data.path}`, {
          message: (text) => {
            try {
              ws.send(text);
            } catch {
              // The browser's side is gone: the stand-in's frame has nowhere to go.
            }
          },
          close: (code, reason) => {
            try {
              ws.close(sendable(code), reason);
            } catch {
              // Already closed.
            }
          },
        });
      },
      message(ws, message) {
        ws.data.inner?.send(typeof message === "string" ? message : message.toString());
      },
      close(ws, code, reason) {
        ws.data.inner?.close(code, reason);
      },
    },
  });
  return {
    base: `http://127.0.0.1:${server.port}`,
    async stop() {
      await server.stop(true);
    },
  };
}

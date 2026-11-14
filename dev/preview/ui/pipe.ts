// The light extension's backend for one page, standing in for `src/ext/pipe.ts` in the preview: it hands
// the page its start-up facts, carries the page's requests to RPE (here, the preview's stand-in RPE on the
// same server) and answers each whole, and follows chats on a socket of its own, sending the page what
// comes as one list every `flushMs`, as RPE's relay does. With `road: "relay"` the facts name an address
// nothing answers at, so the page finds it cannot reach RPE directly and takes the relay.

interface Options {
  road: "direct" | "relay";
  /** Permissions the extension says it lacks, to show the notice. */
  missing: { permission: string; why: string }[];
  flushMs: number;
}

const TOKEN = "rpp_preview";
/** A loopback port nothing in the preview listens on (and not one the browser blocks outright), so a page's call to it is refused. */
const NOWHERE = "http://127.0.0.1:47999";

export function previewPipe(deliver: (payload: unknown) => void, options: Options): { receive(payload: unknown): void; stop(): void } {
  const followed = new Set<string>();
  const confirming = new Set<string>();
  let socket: WebSocket | null = null;
  let open = false;
  let queue: unknown[] = [];
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    timer = null;
    if (queue.length === 0) return;
    deliver({ rpe: "live", seq: ++seq, data: JSON.stringify(queue) });
    queue = [];
  };

  function connect(): WebSocket {
    if (socket !== null) return socket;
    const url = new URL("/api/v1/live", location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(url, ["rpe.live", `rpe.token.${TOKEN}`]);
    ws.onopen = () => {
      open = true;
      for (const chat of followed) ws.send(JSON.stringify({ op: "follow", chat }));
    };
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { type: string; chat?: string };
      if (message.type === "following" && message.chat !== undefined && confirming.delete(message.chat)) deliver({ rpe: "following", chat: message.chat });
      if (message.type === "events") {
        queue.push(message);
        timer ??= setTimeout(flush, options.flushMs);
      }
    };
    ws.onclose = () => {
      socket = null;
      open = false;
    };
    socket = ws;
    return ws;
  }

  return {
    receive(payload) {
      const message = payload as { rpe?: string; id?: string; method?: string; path?: string; headers?: Record<string, string>; body?: string; chat?: string };
      switch (message.rpe) {
        case "start":
          deliver({ rpe: "start", facts: { token: TOKEN, expiresAt: Date.now() + 30 * 60_000, expiresInMs: 30 * 60_000, addresses: options.road === "direct" ? [location.origin] : [NOWHERE], build: "preview" }, missing: options.missing });
          return;
        case "request":
          fetch(message.path ?? "/", { method: message.method, headers: message.headers, ...(message.body === undefined ? {} : { body: message.body }) }).then(
            async (res) => deliver({ rpe: "response", id: message.id, status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" }, body: await res.text() }),
            (error: unknown) => deliver({ rpe: "response", id: message.id, status: 502, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: `RPE was not reached through Lumiverse: ${String(error)}` }) }),
          );
          return;
        case "follow": {
          const chat = message.chat ?? "";
          // A page renews its follows; the socket follows each chat once.
          if (followed.has(chat)) {
            deliver({ rpe: "following", chat });
            return;
          }
          followed.add(chat);
          confirming.add(chat);
          const ws = connect();
          if (open) ws.send(JSON.stringify({ op: "follow", chat }));
          return;
        }
        case "unfollow": {
          const chat = message.chat ?? "";
          followed.delete(chat);
          if (open) socket?.send(JSON.stringify({ op: "unfollow", chat }));
          deliver({ rpe: "following", chat });
          return;
        }
      }
    },
    stop() {
      clearTimeout(timer ?? undefined);
      socket?.close();
    },
  };
}

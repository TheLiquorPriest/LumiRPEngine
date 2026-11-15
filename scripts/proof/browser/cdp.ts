// A connection to a browser by the Chrome DevTools Protocol, over the WebSocket the browser opens on
// loopback (PlanScenarios-2 item 2). It adds no package: Bun's own WebSocket and a Chrome or Chromium the
// machine already has. Every request waits for its own answer, and an answer that is an error rejects with
// the method named, so a form that asks for what the browser cannot give stops saying what it asked.

type Pending = { method: string; resolve: (result: unknown) => void; reject: (error: Error) => void };
type Handler = (params: Record<string, unknown>, session: string | undefined) => void;

export class Cdp {
  private next = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly handlers = new Map<string, Set<Handler>>();
  private closed: string | null = null;

  private constructor(private readonly socket: WebSocket) {
    socket.onmessage = (event) => this.received(String(event.data));
    socket.onclose = () => this.ended("the browser closed its connection");
    socket.onerror = () => this.ended("the connection to the browser failed");
  }

  /** Opens the connection `url` names (`ws://127.0.0.1:<port>/devtools/browser/<id>`). */
  static async connect(url: string): Promise<Cdp> {
    const socket = new WebSocket(url);
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error(`the browser did not take a connection at ${url}`));
    await promise;
    return new Cdp(socket);
  }

  private received(text: string): void {
    const message = JSON.parse(text) as { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: Record<string, unknown>; sessionId?: string };
    if (message.id !== undefined) {
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      this.pending.delete(message.id);
      if (message.error) waiting.reject(new Error(`${waiting.method}: ${message.error.message ?? "the browser refused"}`));
      else waiting.resolve(message.result);
      return;
    }
    if (message.method) for (const handler of this.handlers.get(message.method) ?? []) handler(message.params ?? {}, message.sessionId);
  }

  private ended(why: string): void {
    if (this.closed !== null) return;
    this.closed = why;
    for (const waiting of this.pending.values()) waiting.reject(new Error(`${waiting.method}: ${why}`));
    this.pending.clear();
  }

  /** One request, in a page's session when `session` is given; resolves with the browser's result. */
  send<T = Record<string, unknown>>(method: string, params: object = {}, session?: string): Promise<T> {
    if (this.closed !== null) return Promise.reject(new Error(`${method}: ${this.closed}`));
    const id = this.next++;
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    this.pending.set(id, { method, resolve: resolve as (result: unknown) => void, reject });
    this.socket.send(JSON.stringify({ id, method, params, ...(session === undefined ? {} : { sessionId: session }) }));
    return promise;
  }

  /** Listens for an event; returns what stops the listening. */
  on(method: string, handler: Handler): () => void {
    const held = this.handlers.get(method) ?? new Set<Handler>();
    held.add(handler);
    this.handlers.set(method, held);
    return () => void held.delete(handler);
  }

  close(): void {
    this.ended("the connection was closed");
    this.socket.close();
  }
}

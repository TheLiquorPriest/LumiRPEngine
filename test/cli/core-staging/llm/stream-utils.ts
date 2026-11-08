// The parts of Lumiverse's src/llm/stream-utils.ts (origin/staging 8e0f3945) that provider-sse.ts imports,
// verbatim. Left out: fetchWithPreflightAbort, readJsonWithAbort and createCooperativeYielder, whose request
// observers and redaction the reader doesn't use.

// Workaround for Bun v1.3.x on Windows: passing the user AbortSignal directly
// to a streaming fetch and letting Bun cancel the resulting ReadableStream
// mid-read can trigger an internal assertion failure on the main thread,
// crashing the process. Streaming providers therefore use a short-lived fetch
// signal only until response headers arrive, then handle mid-stream aborts in
// user-space through readWithAbort() and reader.cancel().
//
// However, reader.cancel() alone does NOT close the underlying HTTP connection
// in Bun — the upstream server never sees a disconnect and keeps generating
// into the void (a local llama.cpp/LM Studio keeps burning GPU and blocks its
// single slot; metered APIs keep billing). Each response's internal controller
// is therefore retained so closeConnection() can force the socket shut AFTER
// the body stream has been cancelled. Aborting post-cancel avoids the mid-read
// cancellation path that crashes Bun on Windows.
const responseConnections = new WeakMap<Response, AbortController>();

/** Force-close the HTTP connection behind a fetchWithPreflightAbort response.
 *  Call only after reader.cancel() has settled (or when no read is pending) —
 *  aborting with a read in flight is the crash path the preflight pattern
 *  exists to avoid. No-op for responses not created by fetchWithPreflightAbort. */
export function closeConnection(res: Response): void {
  responseConnections.get(res)?.abort(new DOMException("Aborted", "AbortError"));
}

/** Standard mid-stream teardown: gracefully cancel the body reader, then close
 *  the connection so the upstream server actually stops generating. */
export async function cancelStreamAndCloseConnection(
  reader: ReadableStreamDefaultReader<unknown>,
  res: Response,
): Promise<void> {
  await reader.cancel().catch(() => {});
  closeConnection(res);
}

export async function readWithAbort<T>(
  reader: ReadableStreamDefaultReader<T>,
  signal: AbortSignal | undefined
): Promise<Awaited<ReturnType<ReadableStreamDefaultReader<T>["read"]>>> {
  if (!signal) return reader.read();
  if (signal.aborted) return { done: true, value: undefined };
  return new Promise<Awaited<ReturnType<ReadableStreamDefaultReader<T>["read"]>>>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      resolve({ done: true, value: undefined });
    };
    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (result) => {
        cleanup();
        resolve(result);
      },
      (err) => {
        cleanup();
        if (signal.aborted) {
          resolve({ done: true, value: undefined });
        } else {
          reject(err);
        }
      }
    );
  });
}

// Streaming providers can emit a large number of tiny reasoning/text deltas in a
// tight loop. Periodically yielding a macrotask keeps Bun's HTTP/WS queue moving
// so stop requests and health checks do not starve behind an active stream.
export async function yieldToEventLoop(signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

// The port RPE serves on, as `rpe up` picks it (plan §4.6; today's command: the first free port from its
// first to its last).

/** Whether `port` is free to listen on at `address` now, by listening on it for a moment. */
export function portFree(address: string, port: number): boolean {
  try {
    const probe = Bun.serve({ hostname: address, port, fetch: () => new Response(null, { status: 503 }) });
    void probe.stop(true);
    return true;
  } catch {
    return false;
  }
}

/** The first port from `first` to `last` that is free on loopback, with `free` standing for the check; null where none is. */
export function firstFreePort(first: number, last: number, free: (port: number) => boolean = (port) => portFree("127.0.0.1", port)): number | null {
  for (let port = first; port <= last; port++) if (free(port)) return port;
  return null;
}

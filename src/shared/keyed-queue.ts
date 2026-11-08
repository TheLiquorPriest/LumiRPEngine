// Work run by key one after another, keys side by side: one world's (or chat's) writes stay in order
// while calls on others run alongside. The command line's session, the MCP server's session and the
// tools LumiRPEngine serves outside clients each keep one.

export class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).then(work, work);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}

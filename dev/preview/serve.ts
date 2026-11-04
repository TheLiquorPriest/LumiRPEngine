// Serves the preview harness: index.html and a fresh browser bundle of main.ts per request.
// Run with the embedded Bun: `bun dev/preview/serve.ts [port]`. Nothing is written to dist/.
// The mock backend runs the engine's own code in the page, and the browser has no node:async_hooks:
// a bundle for the browser gets an empty module for it, so a turn's frame (backend/turn-frame.ts)
// would have no AsyncLocalStorage and the page wouldn't boot. The preview's stand-in keeps a store
// for the length of a call, which is all one tab's single mock backend needs.

import type { BunPlugin } from "bun";

const port = Number(process.argv[2] ?? 7891);
const dir = import.meta.dir;

/** node:async_hooks in the page: an AsyncLocalStorage whose store holds while `run`'s call runs. */
const ASYNC_HOOKS = `export class AsyncLocalStorage {
  #store = undefined;
  getStore() { return this.#store; }
  run(store, fn, ...args) { const before = this.#store; this.#store = store; try { return fn(...args); } finally { this.#store = before; } }
  exit(fn, ...args) { const before = this.#store; this.#store = undefined; try { return fn(...args); } finally { this.#store = before; } }
}`;

const asyncHooks: BunPlugin = {
  name: "lre-preview-async-hooks",
  setup(build) {
    build.onResolve({ filter: /^node:async_hooks$/ }, () => ({ path: "async_hooks", namespace: "lre-preview" }));
    build.onLoad({ filter: /.*/, namespace: "lre-preview" }, () => ({ contents: ASYNC_HOOKS, loader: "js" }));
  },
};

Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/main.js") {
      const build = await Bun.build({ entrypoints: [`${dir}/main.ts`], target: "browser", sourcemap: "inline", plugins: [asyncHooks] });
      if (!build.success) return new Response(build.logs.map(String).join("\n"), { status: 500 });
      const output = build.outputs[0];
      if (!output) return new Response("no output", { status: 500 });
      return new Response(await output.text(), { headers: { "content-type": "text/javascript" } });
    }
    if (pathname === "/" || pathname === "/index.html") return new Response(Bun.file(`${dir}/index.html`), { headers: { "content-type": "text/html" } });
    return new Response("not found", { status: 404 });
  },
});

console.log(`LumiRPEngine preview on http://127.0.0.1:${port}/`);

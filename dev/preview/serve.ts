// Serves the preview harness: index.html and a fresh browser bundle of main.ts per request.
// Run with the embedded Bun: `bun dev/preview/serve.ts [port]`. Nothing is written to dist/.
// The mock backend runs the engine's own code in the page, and the browser has no node:async_hooks:
// a bundle for the browser gets an empty module for it, so a turn's frame (backend/turn-frame.ts)
// would have no AsyncLocalStorage and the page wouldn't boot. The preview's stand-in keeps a store
// for the length of a call, which is all one tab's single mock backend needs.
//
// The new pages (src/ui/) are served beside it, against a stand-in RPE (ui/mock-rpe.ts) that answers
// `/api/v1/` and plays an invented recorded turn on the live socket:
// - `/ui/`: the web shell, built from src/ui/index.html as RPE serves it. Open `/ui/#token=preview`
//   once to sign in (any token is taken), then e.g. `/ui/#/chats/chat-calder/live`.
// - `/ui-drawer`: the extension shell in the fake Lumiverse page (ui/drawer-main.ts has its parameters).

import type { BuildArtifact, BunPlugin } from "bun";
import { type PreviewSocket, rpeAnswer, rpeSockets } from "./ui/mock-rpe";

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

/** The web shell's files from its last build, by name: its page, then the script the page names. */
const webShell = new Map<string, BuildArtifact>();

async function buildWebShell(): Promise<Response | null> {
  const build = await Bun.build({ entrypoints: [`${dir}/../../src/ui/index.html`], target: "browser", sourcemap: "inline" });
  if (!build.success) return new Response(build.logs.map(String).join("\n"), { status: 500 });
  webShell.clear();
  for (const output of build.outputs) webShell.set(output.path.replace(/^\.\//, ""), output);
  return null;
}

Bun.serve<PreviewSocket>({
  port,
  hostname: "127.0.0.1",
  websocket: rpeSockets,
  async fetch(request, server) {
    const { pathname } = new URL(request.url);
    if (pathname === "/main.js") {
      const build = await Bun.build({ entrypoints: [`${dir}/main.ts`], target: "browser", sourcemap: "inline", plugins: [asyncHooks] });
      if (!build.success) return new Response(build.logs.map(String).join("\n"), { status: 500 });
      const output = build.outputs[0];
      if (!output) return new Response("no output", { status: 500 });
      return new Response(await output.text(), { headers: { "content-type": "text/javascript" } });
    }
    if (pathname === "/" || pathname === "/index.html") return new Response(Bun.file(`${dir}/index.html`), { headers: { "content-type": "text/html" } });
    if (pathname.startsWith("/api/v1/")) return rpeAnswer(request, server);
    if (pathname === "/ui") return Response.redirect("/ui/", 308);
    if (pathname.startsWith("/ui/")) {
      const name = pathname.slice("/ui/".length) || "index.html";
      if (name === "index.html") {
        const failed = await buildWebShell();
        if (failed !== null) return failed;
      }
      const file = webShell.get(name);
      return file === undefined ? new Response("not found", { status: 404 }) : new Response(file, { headers: { "content-type": file.type } });
    }
    if (pathname === "/ui-drawer") {
      const page = (await Bun.file(`${dir}/index.html`).text()).replace('src="/main.js"', 'src="/ui-drawer.js"');
      return new Response(page, { headers: { "content-type": "text/html" } });
    }
    if (pathname === "/ui-drawer.js") {
      const build = await Bun.build({ entrypoints: [`${dir}/ui/drawer-main.ts`], target: "browser", sourcemap: "inline" });
      if (!build.success) return new Response(build.logs.map(String).join("\n"), { status: 500 });
      const output = build.outputs[0];
      if (!output) return new Response("no output", { status: 500 });
      return new Response(await output.text(), { headers: { "content-type": "text/javascript" } });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`LumiRPEngine preview on http://127.0.0.1:${port}/`);

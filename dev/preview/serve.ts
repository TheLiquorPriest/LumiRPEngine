// Serves the preview harness: index.html and a fresh browser bundle of main.ts per request.
// Run with the embedded Bun: `bun dev/preview/serve.ts [port]`. Nothing is written to dist/.

const port = Number(process.argv[2] ?? 7891);
const dir = import.meta.dir;

Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/main.js") {
      const build = await Bun.build({ entrypoints: [`${dir}/main.ts`], target: "browser", sourcemap: "inline" });
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

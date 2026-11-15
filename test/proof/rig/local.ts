// A little site the driver's tests open in a real browser: pages made up for what the driver does
// (what lies below the fold at 390, a list that scrolls, words hidden by style, clipped or covered, a
// chooser that takes a typed name). Nothing here stands for RPE or for Lumiverse; it stands for a page.

import type { Pages } from "../../../scripts/proof/browser/driver";

const SHELL = (title: string, body: string): string => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { margin: 0; font: 16px/1.4 sans-serif; }
  nav button { margin: 4px; }
  .list { height: 120px; overflow: auto; border: 1px solid #888; }
  .clip { width: 100px; height: 20px; overflow: hidden; white-space: nowrap; }
  .over { position: relative; height: 24px; }
  .over > div { position: absolute; inset: 0; background: #fff; }
  .gap { height: 1400px; }
</style></head><body>
<nav><button aria-current="page">${title}</button></nav>
<h1>${title}</h1>
${body}
</body></html>`;

/** The pages, by their paths. */
export const SITE: Record<string, string> = {
  "/live": SHELL(
    "Live",
    `<p>Turn 4 is running. Mirela has no perception yet.</p>
<span style="display:none">hiddenword</span><span style="visibility:hidden">invisibleword</span><span style="opacity:0">faintword</span>
<div class="clip">visiblefirst clippedword is long and runs past the box so most of it is cut</div>
<div class="over"><span>coveredwords</span><div>overlaywords</div></div>
<label for="line">Message</label> <input id="line" placeholder="Say something" value="">
<button aria-label="Send"></button> <button>Stop</button>
<label for="conn">Connection</label>
<select id="conn"><option>Plain</option><option>RPE</option></select>
<div class="gap"></div>
<h2>Further down</h2>
<p>belowfold words: the bell rings at dusk</p>
<section aria-label="Notes"><h3>Notes</h3><p>The lamp is lit.</p></section>
<div class="list" aria-label="Perceptions">${Array.from({ length: 30 }, (_, i) => `<div>perception ${i + 1}</div>`).join("")}</div>`,
  ),
  "/short": SHELL(
    "Short",
    `<p>Nothing here runs past the window.</p>
<span style="display:none">hiddenword</span>
<section aria-label="Notes"><h3>Notes</h3><p>The lamp is lit.</p></section>
<button>Save</button> <button>Cancel</button>
<div style="display:flex"><span>first</span><span>second</span></div>
<p>one <b>bold</b> two</p>`,
  ),
  "/chooser": SHELL(
    "Chooser",
    `<label for="pick">Composer connection</label>
<input id="pick" autocomplete="off" placeholder="Choose a connection">
<p id="chosen">Chosen: none</p>
<script>
  const input = document.getElementById("pick");
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("chosen").textContent = "Chosen: " + input.value; });
</script>`,
  ),
};

/** Pages for the driver over a site served at `base`: each page's name is its own heading. */
export function sitePages(base: string): Pages {
  return {
    async open(page, tab) {
      const path = `/${page.toLowerCase()}`;
      if (!(path in SITE)) throw new Error(`no page named ${page}`);
      await tab.goto(`${base}${path}`);
    },
    nameOf: "document.querySelector('h1')?.textContent ?? ''",
  };
}

/** Serves the site on a free loopback port. */
export function serveSite(): { base: string; stop(): void } {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      const body = SITE[new URL(request.url).pathname];
      return body === undefined ? new Response("no such page", { status: 404 }) : new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
    },
  });
  return { base: `http://127.0.0.1:${server.port}`, stop: () => void server.stop(true) };
}

// The web app (plan §4.4, §14): its built files, served as they are at `/ui/`, to anyone who reaches
// RPE; what a page then does is held to its own token by the API. The build puts the files beside the
// bundle and stamps the folder's place (`scripts/build.ts`, `RPE_UI_DIR`); run from source there is no
// built folder, so `/ui/` says so instead of serving one.

import { realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { rawRoute } from "./routes";

/** The built web app's folder, beside the bundle; null when run from source, where none is built. */
export const RPE_UI: string | null = process.env.RPE_UI_DIR === undefined ? null : fileURLToPath(new URL(process.env.RPE_UI_DIR, import.meta.url));

export const UI_PREFIX = "/ui/";
/** What `/ui/` itself serves. */
const INDEX = "index.html";
/**
 * The web app signs itself in from this browser's storage when it loads, so a page of another site
 * that could frame it could have its buttons clicked for it. No other site may frame it. Lumiverse
 * never does: its drawer runs the extension's own bundle, not these files. Beside that, the page runs
 * no script but RPE's own: its scripts are files served from this address, the built page holds none
 * inline, and no plugin or base address another site could name stands in their place (plan §16).
 */
const POLICY = { "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'; script-src 'self'; object-src 'none'; base-uri 'none'" } as const;

function notFound(words: string): Response {
  return new Response(words, { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

/**
 * The path's parts below `/ui/`, decoded; null when one could step out of its folder or name something
 * no file is named. Bun routes a request by its path as sent, and hands the route that path with its dot
 * segments resolved, which may then lie outside `/ui/`: such a path is none of the web app's.
 */
function partsOf(pathname: string): string[] | null {
  if (!pathname.startsWith(UI_PREFIX)) return null;
  const rest = pathname.slice(UI_PREFIX.length);
  if (rest === "") return [INDEX];
  const parts: string[] = [];
  for (const raw of rest.split("/")) {
    let part: string;
    try {
      part = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (part === "" || part === "." || part === ".." || /[/\\\0]/.test(part)) return null;
    parts.push(part);
  }
  return parts;
}

/** The real path of `path` when it is a file inside `folder` (itself a real path), following links; null otherwise. */
async function fileInside(folder: string, path: string): Promise<string | null> {
  const real = await realpath(path).catch(() => null);
  if (real === null || !real.startsWith(folder + sep)) return null;
  const file = Bun.file(real);
  const stat = await file.stat().catch(() => null);
  return stat?.isFile() === true ? real : null;
}

/** `GET /ui/*`: the files of the web app built in `folder`, and nothing outside it. */
export function uiRoute(folder: string | null) {
  let root: Promise<string | null> | null = null;
  return rawRoute({
    method: "GET",
    path: "/ui/*",
    access: "public",
    group: "ui",
    does: "The web app's files, to anyone who reaches RPE; what a page then does is held to its own token by the API.",
    answers: "a file of the built web app (its page, scripts and styles), or 404 with words saying why there is none",
    raw: async (request) => {
      if (folder === null) return notFound("This RPE was run from its source, where the web app is not built, so there is no web app to show.");
      root ??= realpath(folder).catch(() => null);
      const base = await root;
      // Where the folder lies on the server is not a page's to know: anyone may ask `/ui/`.
      if (base === null) return notFound("The web app's folder is missing beside RPE's app file, so there is no web app to show.");
      const { pathname } = new URL(request.url);
      const parts = partsOf(pathname);
      const real = parts === null ? null : await fileInside(base, join(base, ...parts));
      if (real === null) return notFound(`The web app has no file at ${pathname}.`);
      const file = Bun.file(real);
      return new Response(file, { headers: { "content-type": file.type, ...POLICY } });
    },
  });
}

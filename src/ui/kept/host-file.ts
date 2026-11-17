// A file of its own that Lumiverse serves to the extension's page, loaded as a module. Lumiverse loads an
// extension's frontend as one blob (`fetch /api/v1/spindle/<id>/frontend`, then `import(blobUrl)`), so a
// chunk of it cannot import another by a path, and it serves exactly two files of an extension's repository:
// `entry_frontend` and the optional `entry_frontend_widget`. RPE's second file is the widget entry
// (`dist/widget.js`, `spindle.json`): it holds the kept chunk (`chunk.ts`), and the page fetches it the way
// Lumiverse fetches the first (same session, same route family) and imports it as a module when a kept view
// is first shown. Its `setupWidget` (`widget.ts`) is what Lumiverse itself calls in a pop-out.

/** What of Spindle's frontend context this reads: the id Lumiverse knows the extension by. */
export interface HostIdentity {
  readonly host: { readonly extensionInstallationId: string };
}

/** The two files Lumiverse serves, by the route's last part. */
export type HostFile = "frontend" | "frontend/widget";

/** What loads a module from a blob's address: the page's own `import()`, or a test's. */
export type ModuleImporter = (url: string) => Promise<unknown>;

const pageImport: ModuleImporter = (url) => import(/* @vite-ignore */ url);

/** Fetches `file` of the extension and imports it as a module; the blob's address is let go once it has loaded. */
export async function importHostFile(ctx: HostIdentity, file: HostFile, build: string, importer: ModuleImporter = pageImport, fetcher: typeof fetch = fetch): Promise<unknown> {
  const response = await fetcher(`/api/v1/spindle/${encodeURIComponent(ctx.host.extensionInstallationId)}/${file}?v=${encodeURIComponent(build)}`);
  if (!response.ok) throw new Error(`Lumiverse did not serve the extension's ${file === "frontend" ? "first" : "second"} file (it answered ${response.status}).`);
  const url = URL.createObjectURL(await response.blob());
  try {
    return await importer(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Loads `load` once for whoever asks; a load that failed is tried again at the next ask. */
export function once<T>(load: () => Promise<T>): () => Promise<T> {
  let held: Promise<T> | null = null;
  return () => {
    held ??= load().catch((error: unknown) => {
      held = null;
      throw error;
    });
    return held;
  };
}

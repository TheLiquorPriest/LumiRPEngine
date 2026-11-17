// The entry Lumiverse calls for a pop-out of one of the extension's float widgets. A declared widget entry must
// export `setupWidget` and Lumiverse does not fall back from it, and RPE's widget entry is the kept chunk
// (`host-file.ts`), which holds none of what a pop-out needs registered (the chat's surfaces). So this does what
// Lumiverse itself does for an extension that declares no widget entry: it loads the extension's main file
// and runs that file's `setup`, with the context the pop-out gave, and gives back its cleanup.

import { type HostIdentity, importHostFile } from "./host-file";

type Setup = (ctx: unknown) => void | (() => void) | Promise<void | (() => void)>;

export async function setupWidget(ctx: HostIdentity, _target: unknown): Promise<() => void> {
  const main = (await importHostFile(ctx, "frontend", process.env.LRE_BUILD_ID ?? "dev")) as { setup?: Setup };
  if (typeof main.setup !== "function") throw new Error("The extension's main file has no setup to run in the pop-out.");
  const stop = await main.setup(ctx);
  return typeof stop === "function" ? stop : () => undefined;
}

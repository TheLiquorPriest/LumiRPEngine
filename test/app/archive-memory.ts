// Run by archive.test.ts in a process of its own, so that the most memory the process has held
// (`maxRSS`) shows only this archive. It archives every file of a folder, read a piece at a time
// (`pieces`) or, as the control that proves the measure can see a whole file, read whole into memory
// first (`whole`), and prints how far the process's peak rose, in bytes.

import { join } from "node:path";
import { TarWriter, walk } from "../../src/app/archive";

const [mode, folder, out] = process.argv.slice(2);
if ((mode !== "pieces" && mode !== "whole") || folder === undefined || out === undefined) throw new Error("archive-memory.ts pieces|whole <folder> <archive>");
const found = await walk(folder);
const before = process.resourceUsage().maxRSS;
const tar = TarWriter.open(out);
for (const file of found) {
  if (mode === "pieces") await tar.addFile(file.path, join(folder, file.path));
  else await tar.add(file.path, await Bun.file(join(folder, file.path)).bytes(), file.mtimeMs / 1000, file.mode);
}
await tar.close();
// maxRSS is counted in KiB.
console.log(JSON.stringify({ grew: (process.resourceUsage().maxRSS - before) * 1024 }));

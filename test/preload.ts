// Run before every test file (`bunfig.toml`): the engine says its words in a test as it does on a server's main thread and on each of its worker
// threads, from the shipped `.prompts/history-*.md` through the one loader (`src/iface/history-lines.ts`). A test that needs its own lines
// installs them with `useLines` or `withLines`.

import { installHistoryLines } from "../src/iface/history-lines";
import { shippedTexts } from "../src/iface/texts";

await installHistoryLines(shippedTexts());

// The fence (PlanSwap-4 item 2, and the fix of its landing review): nothing that stays loads a file
// whose fate is "removed", in any way TypeScript or Bun loads a module, but the imports listed as not
// yet moved and the names each takes; today's protocol and settings registry are fenced by name;
// LumiAH is reached through none of what stays; the scripts and the preview are fenced too; and the
// list only shrinks, by its lines and their names. Each planted file below is read as if it stood in
// today's tree, and only what the fence says beyond what it says of today's tree is its verdict.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFates, ROOT } from "./fates";
import { added, allowancesAdded, committed, fence, lumiah, ownExports, readList, readUnread, reexported, stale, unreadAdded } from "./fence";
import { readTree } from "./imports";

describe("the fence around today's engines", () => {
  const fates = readFates();
  const { entries, problems } = readList();
  const known = readUnread();
  const tree = readTree(ROOT);
  /** Today's tree with the planted files read as if they were there: only the planted files are read again. */
  const planted = (files: Record<string, string>) => {
    const paths = new Set(Object.keys(files));
    const extra = readTree(ROOT, new Map(Object.entries(files)), []);
    return { edges: [...tree.edges.filter((edge) => !paths.has(edge.from)), ...extra.edges], unread: [...tree.unread.filter((load) => !paths.has(load.from)), ...extra.unread] };
  };
  const today = new Set(fence(tree, fates, entries, known.entries));
  /** What the fence says of today's tree with the planted files, beyond what it says of today's tree. */
  const beyond = (files: Record<string, string>) => fence(planted(files), fates, entries, known.entries).filter((line) => !today.has(line));
  const scratch = mkdtempSync(join(tmpdir(), "rpe-fence-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  test("the list and the loads that cannot be read say what each line needs: the names taken, the package that ends it", () => {
    expect(problems).toEqual([]);
    expect(known.problems).toEqual([]);
    expect(readList("src/play/view.ts\tsrc/backend/view.ts\n").problems).toEqual(["not-yet-moved.tsv:1: the importer, what it imports, the names it takes, the package that ends it, and a note if any"]);
    expect(readList("src/play/view.ts\tsrc/backend/view.ts\tbuildView\tsomeone\n").problems).toEqual(['not-yet-moved.tsv:1: "someone" is no package; name the one that ends the line, or "no package yet"']);
  });

  test("nothing that stays loads a fenced file but as the list or an allowance lets it", () => {
    expect(fence(tree, fates, entries, known.entries)).toEqual([]);
  });

  test("LumiAH is reached by nothing that stays but through the lines listed, and the names each takes", () => {
    expect(lumiah(tree, fates, entries)).toEqual([]);
  });

  test("every line still stands as written, so the list shrinks with the code, line by line and name by name", () => {
    expect(stale(tree, fates, entries)).toEqual([]);
    const view = entries.find((entry) => entry.from === "src/play/view.ts" && entry.to === "src/backend/view.ts");
    expect(view).toBeDefined();
    const wider = { ...(view as NonNullable<typeof view>), names: new Set([...(view?.names ?? []), "noSuchName"]), line: 0 };
    expect(stale(tree, fates, [wider])).toEqual(["not-yet-moved.tsv:0: src/play/view.ts → src/backend/view.ts no longer takes noSuchName; take it out"]);
    const gone = { from: "src/play/view.ts", to: "src/backend/runtime.ts", names: new Set(["readRun"]), by: "PlanSwap-6", note: "", line: 0 };
    expect(stale(tree, fates, [gone])).toEqual(["not-yet-moved.tsv:0: src/play/view.ts → src/backend/runtime.ts no longer stands; take the line out"]);
  });

  test("no line, and no name of a line, is one the committed list does not hold, whatever the count", () => {
    const before = committed("test/removal/not-yet-moved.tsv");
    expect(before).not.toBeNull();
    expect(added(entries, readList(before ?? "", true).entries)).toEqual([]);
    const held = readList("src/play/view.ts\tsrc/backend/view.ts\tbuildView\tPlanSwap-6\n").entries;
    // One line out and another in: the count is the same, and the new line fails.
    const swapped = readList("src/play/service.ts\tsrc/backend/runtime.ts\treadRun\tPlanSwap-6\n").entries;
    expect(added(swapped, held)).toEqual(["not-yet-moved.tsv:1: src/play/service.ts → src/backend/runtime.ts is not a line of the committed list, and the list gains no line"]);
    const wider = readList("src/play/view.ts\tsrc/backend/view.ts\tbuildView, readRun\tPlanSwap-6\n").entries;
    expect(added(wider, held)).toEqual(["not-yet-moved.tsv:1: src/play/view.ts → src/backend/view.ts takes readRun, which the committed line does not, and a line gains no name"]);
  });

  test("the allowances of fates.tsv and the loads that cannot be read only shrink too", () => {
    const fatesBefore = committed("test/removal/fates.tsv");
    const unreadBefore = committed("test/removal/unread.tsv");
    expect(fatesBefore).not.toBeNull();
    expect(unreadBefore).not.toBeNull();
    expect(allowancesAdded(fates, readFates(fatesBefore ?? ""))).toEqual([]);
    expect(unreadAdded(known.entries, readUnread(unreadBefore ?? "").entries)).toEqual([]);
    const allowance = readFates("src/shared/settings.ts\tmoved\tPlanSwap-13\tsrc/migrate/today/\tin part\nsrc/shared/settings.ts\tpiece\tPlanSwap-13\tsrc/shared/\tpanels\tnarratorViewOf, defaultSettings\tsrc/play/");
    const narrower = readFates("src/shared/settings.ts\tmoved\tPlanSwap-13\tsrc/migrate/today/\tin part\nsrc/shared/settings.ts\tpiece\tPlanSwap-13\tsrc/shared/\tpanels\tnarratorViewOf\tsrc/play/");
    expect(allowancesAdded(allowance, narrower)).toEqual(["fates.tsv:2: src/shared/settings.ts allows defaultSettings for src/play/, which the committed fates do not"]);
  });

  test("every way a module is loaded is read: a .js name, require(), import =, import() in a type, a second import on one line", () => {
    for (const source of ['import { readRun } from "../backend/runtime.js";', 'const r = require("../backend/runtime");', 'import r = require("../backend/runtime");', 'type R = import("../backend/runtime").ChatRun;', 'const a = 1; import { readRun } from "../backend/runtime";']) {
      expect(beyond({ "src/play/planted.ts": source })).toEqual([expect.stringMatching(/^src\/play\/planted\.ts:1 imports .* from src\/backend\/runtime\.ts/)]);
    }
    // Text that only looks like an import is none.
    expect(beyond({ "src/play/planted.ts": '// import { readRun } from "../backend/runtime";\nconst s = \'import { readRun } from "../backend/runtime";\';' })).toEqual([]);
  });

  test("a load of a template or a sum cannot be read, and fails rather than passes", () => {
    for (const source of ["const m = await import(`../backend/${name}`);", 'const m = await import("../backend/" + name);', "const m = require(path);"]) {
      expect(beyond({ "src/play/planted.ts": source })).toEqual([expect.stringContaining("src/play/planted.ts:1 loads")]);
    }
  });

  test("a listed import allows the names it takes today, not the file", () => {
    const service = entries.find((entry) => entry.from === "src/play/service.ts" && entry.to === "src/backend/view.ts");
    expect(service).toBeDefined();
    expect(service?.names.has("readRun")).toBe(false);
    expect(beyond({ "src/play/service.ts": 'import { readRun } from "../backend/view";' })).toEqual([expect.stringContaining("src/play/service.ts:1 imports readRun from src/backend/view.ts")]);
  });

  test("a listed line takes only names its removed file declares itself, so a re-export cannot pass through it", () => {
    expect(reexported(fates, entries)).toEqual([]);
    expect([...ownExports('export { readRun } from "./runtime";\nexport * from "lumi-ah/core";\nimport { loopsBack } from "lumi-ah/link";\nexport { loopsBack };\nexport function own() {}\nexport const a = 1, b = 2;\nexport interface Shape {}\nexport default own;')].sort()).toEqual(["Shape", "a", "b", "default", "own"]);
    const root = join(scratch, "reexport");
    mkdirSync(join(root, "src/backend"), { recursive: true });
    writeFileSync(join(root, "src/backend/view.ts"), 'export function buildView() {}\nexport { runtimeBase } from "lumi-ah/link";\n');
    const list = readList("src/play/view.ts\tsrc/backend/view.ts\tbuildView, runtimeBase\tPlanSwap-6\n").entries;
    expect(reexported(fates, list, root)).toEqual(["not-yet-moved.tsv:1: src/play/view.ts takes runtimeBase from src/backend/view.ts, which does not declare it itself"]);
  });

  test("today's protocol and settings registry are fenced by name: what their pieces move goes to what needs it, and nothing else", () => {
    // The kept UI may take the kept UI's request types; the pure engine an edit's operations.
    expect(beyond({ "src/frontend/planted.tsx": 'import type { EditOp, LintIssue } from "../shared/protocol";', "src/engine/planted.ts": 'import type { EditOp } from "../shared/protocol";' })).toEqual([]);
    // The old wire, and anything their pieces do not move, are fenced as a removed file's names are.
    expect(beyond({ "src/frontend/planted.tsx": 'import { PROTOCOL_VERSION } from "../shared/protocol";' })).toEqual([expect.stringContaining("src/frontend/planted.tsx:1 imports PROTOCOL_VERSION from src/shared/protocol.ts")]);
    expect(beyond({ "src/play/planted.ts": 'import type { ResultBodies } from "../shared/protocol";' })).toEqual([expect.stringContaining("src/play/planted.ts:1 imports ResultBodies from src/shared/protocol.ts")]);
    // The registry's own names, and what only the migration may take of it, are fenced for the rest.
    expect(beyond({ "src/turn/planted.ts": 'import { SETTINGS_DEFAULTS_REV } from "../shared/settings";' })).toEqual([expect.stringContaining("src/turn/planted.ts:1 imports SETTINGS_DEFAULTS_REV from src/shared/settings.ts")]);
    expect(beyond({ "src/turn/planted.ts": 'import { narratorViewOf } from "../shared/settings";' })).toEqual([]);
  });

  test("the scripts and the preview are fenced too, by their real imports", () => {
    expect(beyond({ "scripts/planted.ts": 'import { readRun } from "../src/backend/runtime";', "dev/preview/planted.ts": 'export { view } from "../../src/backend/view";' })).toEqual([expect.stringContaining("dev/preview/planted.ts:1 imports view from src/backend/view.ts"), expect.stringContaining("scripts/planted.ts:1 imports readRun from src/backend/runtime.ts")]);
    expect(beyond({ "scripts/planted.ts": '// See src/backend/runtime.ts: import { readRun } from "../src/backend/runtime";\nexport {};' })).toEqual([]);
  });

  test("a kept file and a kept test are fenced too, not only the new zones", () => {
    const found = beyond({ "src/engine/planted.ts": 'export { agentMetaOf } from "../backend/chat-agent-meta";', "test/engine/planted.test.ts": 'import { readRun } from "../../src/backend/runtime";' });
    expect(found).toEqual([expect.stringContaining("src/engine/planted.ts:1 imports agentMetaOf from src/backend/chat-agent-meta.ts"), expect.stringContaining("test/engine/planted.test.ts:1 imports readRun from src/backend/runtime.ts")]);
  });

  test("LumiAH reached through a kept file fails, with the chain that reaches it", () => {
    const found = lumiah(planted({ "src/shared/planted-link.ts": 'import { runtimeBase } from "lumi-ah/link";', "src/play/planted.ts": 'import { base } from "../shared/planted-link";' }), fates, entries);
    expect(found).toEqual(["src/shared/planted-link.ts:1 imports runtimeBase from lumi-ah/link, and LumiAH is no dependency of what stays; the application reaches it: src/play/planted.ts → src/shared/planted-link.ts → lumi-ah/link"]);
  });

  test("a file that goes may go on importing what goes with it", () => {
    expect(beyond({ "src/backend/main.ts": 'import { readRun } from "./runtime";\nimport { Dispatch } from "./dispatch";' })).toEqual([]);
  });
});

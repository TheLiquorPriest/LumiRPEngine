// GM → Depth → Bootstrap in the preview (`?depth`): the LumiBooks tree, the run and the opt-in page
// (GM → This chat → Depth) in the drawer at its real width, from fixtures with long titles, a
// three-level book, a paused run offering a redo and an open deepening, so the narrow layout can be
// checked at 390 px. Controls update the page; nothing is sent.

import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { render } from "preact";
import { useState } from "preact/hooks";
import { type App, AppContext } from "../../src/frontend/app";
import { BootstrapBody } from "../../src/frontend/depth/bootstrap";
import { DepthChatBody } from "../../src/frontend/depth/chat-depth";
import { type LbDeepening, LumiBooksBody } from "../../src/frontend/depth/lumibooks";
import { createHost } from "../../src/frontend/host";
import { CSS } from "../../src/frontend/styles";
import { type BootstrapCap, type BootstrapEstimate, type BootstrapView, type LbActionEstimate, type LbTree, NO_COUNTS } from "../../src/shared/bootstrap";

const ESTIMATE: BootstrapEstimate = {
  chatId: "c1",
  messages: 1820,
  words: 3_640_000,
  tokens: 4_900_000,
  chunks: 164,
  minds: 9,
  stages: [
    { stage: "historian", calls: 164, tokensIn: 5_400_000, tokensOut: 900_000, cost: 38.5, ms: 14_200_000, connection: "OpenRouter Gateway (work account)", model: "deepseek/deepseek-v4-flash-preview", measured: false },
    { stage: "minds", calls: 1460, tokensIn: 11_000_000, tokensOut: 1_900_000, cost: 12.25, ms: 19_000_000, connection: null, model: null, measured: true },
  ],
  total: { calls: 1624, tokensIn: 16_400_000, tokensOut: 2_800_000, cost: 50.75, ms: 33_200_000 },
  notes: ["Minds assume the world's 9 characters until the author picks."],
  rss: 412 * 1_048_576,
};

const VIEW: BootstrapView = {
  chatId: "c1",
  optedIn: true,
  status: "paused",
  reason: "Three wrong marks in a row in chapter 12: the run paused for you to look.",
  startedAt: 1,
  updatedAt: 2,
  elapsedMs: 9_600_000,
  chunks: { done: 120, total: 164 },
  progress: [
    { stage: "historian", done: 120, total: 164, spent: { calls: 120, tokensIn: 3_600_000, tokensOut: 600_000, cost: 28, ms: 9_000_000 }, rss: 300 * 1_048_576 },
    { stage: "minds", done: 1100, total: 1460, spent: { ...NO_COUNTS, calls: 1100 }, rss: null },
  ],
  chapters: [
    { n: 10, chunks: [100, 108], ended: true, spot: "reviewed" },
    { n: 11, chunks: [109, 119], ended: true, spot: "waiting" },
    { n: 12, chunks: [120, 124], ended: false, spot: "none" },
  ],
  spent: { calls: 1220, tokensIn: 3_600_000, tokensOut: 600_000, cost: 28, ms: 9_600_000 },
  cap: { unit: "tokens", value: 20_000_000 },
  remaining: ESTIMATE,
  imported: [
    { source: "world_info", entries: 31, unreadable: null },
    { source: "cortex", entries: 0, unreadable: "Memory Cortex isn't readable by extensions on this host." },
  ],
  spot: [
    {
      id: "card1",
      chapter: 11,
      createdAt: 1,
      items: [
        { id: "i1", kind: "beat", mark: null, flagged: true, beat: "beat_1140", what: "Rosie pockets the letter before Dev can read the return address", quotes: "\"Not now.\"", message: "m1140", index: 1140, prose: "She slid the envelope into her apron and turned back to the grill." },
        { id: "i2", kind: "memory", mark: { right: true, note: "", at: 2 }, flagged: false, who: "npc_rosie", name: "Rosie Alvarez-Whitcombe", path: "memories/chapter-11/0040-the-letter.md", text: "I hid it before he saw.", lived: [{ beat: "beat_1140", text: "She pockets the letter." }] },
      ],
    },
  ],
  redoFrom: 11,
  advice: [{ system: "summary", found: true, text: "This chat has a summary. Depth holds its memory now: you may turn the summary off for it." }],
  log: ["chunk 120: historian done", "chapter 12: three wrong marks in a row; paused"],
};

const TREE: LbTree = {
  chatId: "c1",
  book: "The Long Winter at the Crossroads Diner",
  cast: [
    { id: "npc_rosie", name: "Rosie Alvarez-Whitcombe" },
    { id: "npc_dev", name: "Dev Patel" },
    { id: "npc_june", name: "June" },
  ],
  nodes: [
    {
      id: "v1",
      level: "volume",
      title: "Snowed in at the end of the world",
      range: [0, 1199],
      coverage: "covered",
      changed: 0,
      caughtUp: [],
      fullMind: [],
      children: [
        {
          id: "a1",
          level: "arc",
          title: "The diner and the letter nobody was meant to read",
          range: [0, 499],
          coverage: "changed",
          changed: 3,
          caughtUp: [],
          fullMind: [],
          children: [
            { id: "c1", level: "chapter", title: "First night", range: [0, 119], coverage: "deep", changed: 0, caughtUp: ["npc_rosie", "npc_june"], fullMind: ["npc_dev"], children: [] },
            { id: "c2", level: "chapter", title: "What the snowplough driver saw from the ridge road", range: [120, 499], coverage: "covered", changed: 0, caughtUp: [], fullMind: [], children: [] },
          ],
        },
      ],
    },
  ],
  uncovered: [
    [1200, 1319],
    [1400, 1411],
  ],
};

function DepthPage() {
  const [cap, setCap] = useState<BootstrapCap | "none">({ unit: "tokens", value: 20_000_000 });
  const [pending, setPending] = useState<{ what: LbDeepening; estimate: LbActionEstimate | null } | null>({ what: { kind: "catchup", node: "c2", who: ["npc_rosie"] }, estimate: null });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const none = () => undefined;
  return (
    <div class="lre-stack" data-lre-depth-preview="">
      <LumiBooksBody
        tree={TREE}
        c={{
          busy: false,
          pending,
          onPick: (what) => setPending(what ? { what, estimate: null } : null),
          onEstimate: () => setPending((p) => (p ? { ...p, estimate: { calls: 140, tokens: 1_800_000, cost: 3.1, ms: 720_000, notes: ["Dev Patel already caught up on part of it."] } } : p)),
          onConfirm: () => setPending(null),
        }}
      />
      <BootstrapBody
        view={VIEW}
        c={{ busy: false, cap, onCap: setCap, onEstimate: none, onStart: none, onPause: none, onResume: none, notes, onNote: (item, note) => setNotes((n) => ({ ...n, [item]: note })), onMark: none, onRedo: none, onJump: none }}
      />
      <p class="lre-depth-subhead">GM → This chat → Depth, with depth off</p>
      <DepthChatBody
        view={{ ...VIEW, optedIn: false, status: "estimated", reason: null }}
        estimate={ESTIMATE}
        unready="No loopback relay is Running: start one in Settings → Loopback, then turn depth on."
        book={TREE.book}
        c={{ busy: false, cap, onCap: setCap, onEstimate: none, onOptIn: none, onOptOut: none, onOpenBootstrap: none, onOpenLoopback: none, onHistory: none }}
      />
    </div>
  );
}

/**
 * Mounts the page in the drawer, styled as the extension styles it, in place of the app; returns its
 * teardown, as `setup` does. The page's switches mount the host's own (`HostSwitch`), so it gets the
 * host bridge through the app's context; nothing else of the app is read.
 */
export function mountDepth(ctx: SpindleFrontendContext): () => void {
  const host = createHost(ctx);
  const app = { host } as unknown as App;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const title = document.getElementById("drawer-title-text");
  if (title) title.textContent = "Depth → Bootstrap";
  const root = document.createElement("div");
  // The host's tab root (`#drawer-panel > [data-tab]`): it scrolls, padded 12 px, as the real panel does.
  root.dataset.tab = "depth";
  document.getElementById("drawer-panel")?.appendChild(root);
  render(
    <AppContext.Provider value={app}>
      <div class="lre lre-drawer" data-lre-mode="gm">
        <div class="lre-mode-body">
          <DepthPage />
        </div>
      </div>
    </AppContext.Provider>,
    root,
  );
  return () => {
    render(null, root);
    root.remove();
    style.remove();
    host.dispose();
  };
}

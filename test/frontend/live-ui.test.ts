// GM → Live on the page (DESIGN §4.6), walked as a rendered tree with no DOM: a page follows the
// pushes in order and asks again when it can't; the feed shows each group in the order it started
// (the main agent's stage, then the role run it started, with its agent), with each message, the
// reasoning, each tool call as a card holding its arguments and its result, its caret's state
// (running, done, failed, none), the writes and what came of them, tokens and times, the turn's
// phases and how it ended; the role filter shows one role's groups; Cancel shows while the turn can
// be stopped; and GM → Workspace's session panel shows the session whole, as message bubbles,
// saying what the main agent doesn't read now.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { Button, Seg } from "../../src/frontend/components";
import { LiveFeed, liveControls, type LiveBody, toolCardState } from "../../src/frontend/gm/live";
import { SessionPanel } from "../../src/frontend/gm/workspace";
import { followLive, liveItems, type LiveEntry, type LiveView } from "../../src/shared/live";
import type { SessionView } from "../../src/shared/protocol";
import { press, propsOf, type Props } from "../support/tree";

const CHAT = "chat-port-alder";

function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

const usage = { in: 1200, cachedIn: 800, out: 56, reasoningOut: 12 };

/** A turn under way: the main agent's stage 3 ran the scene, whose agent wrote a note. */
const ENTRIES: LiveEntry[] = [
  { seq: 1, at: 1000, kind: "agent", agent: "agent_m1", role: "main", phase: "pre", stage: "Stage 3: the scene, the minds and the decisions", model: null, connection: null, effort: "inherit", system: "MAIN-SYSTEM", prefix: [], history: 4 },
  { seq: 2, at: 1001, kind: "message", agent: "agent_m1", text: "Stage 3 of 8. Open requests:\n- scene: the scene" },
  { seq: 3, at: 1800, kind: "answer", agent: "agent_m1", text: "The scene first.", reasoning: "MAIN-REASONING about the harbor", calls: [{ id: "c1", name: "run_role", args: { role: "scene", task: "Look at the harbor." } }], usage, model: "opus-4", finish: "tool_calls", ms: 799 },
  { seq: 4, at: 1801, kind: "run", run: "scene:gen1:1", role: "scene", via: "agent" },
  { seq: 5, at: 1802, kind: "write", key: "op_note_1", run: "scene:gen1:1", role: "scene", phase: "pre", outcome: "staged", changeType: "workspace", lines: ["Write notes/harbor.md"] },
  { seq: 6, at: 1803, kind: "agent", agent: "agent_s1", role: "scene", run: "scene:gen1:1", phase: "pre", task: "scene", model: "sonnet-4", connection: "conn-anthropic", effort: "low", system: "SCENE-SYSTEM", prefix: ["SCENE-INSTRUCTIONS"], history: 0 },
  { seq: 7, at: 1804, kind: "message", agent: "agent_s1", text: "SCENE-TASK: what does the scene need?" },
  { seq: 8, at: 2400, kind: "answer", agent: "agent_s1", text: "", calls: [{ id: "w1", name: "workspace_write", args: { path: "notes/harbor.md", text: "The ferry is late." } }], usage, model: "sonnet-4", finish: "tool_calls", ms: 596 },
  { seq: 9, at: 2405, kind: "result", agent: "agent_s1", call: "w1", name: "workspace_write", text: "SCENE-RESULT: proposed Write notes/harbor.md", error: false, ms: 5 },
];

const RUNNING: LiveView = { turn: "gen1", kind: "turn", pipeline: "main", text: "I look out over the harbor.", startedAt: 1000, ended: null, entries: ENTRIES };

const MORE: LiveEntry[] = [
  { seq: 10, at: 2900, kind: "answer", agent: "agent_s1", text: '{"lore":[],"notes":[]}', calls: [], usage, model: "sonnet-4", finish: "stop", ms: 495 },
  { seq: 11, at: 2901, kind: "idle", agent: "agent_s1", usage: { in: 2400, out: 112 } },
  { seq: 12, at: 2902, kind: "ran", run: "scene:gen1:1", ok: true, via: "agent", usage: { in: 2400, out: 112 }, ms: 1101 },
  { seq: 13, at: 2903, kind: "result", agent: "agent_m1", call: "c1", name: "run_role", text: "scene:gen1:1: the scene role answered", error: false, ms: 1102 },
  { seq: 14, at: 3000, kind: "phase", phase: "plan" },
  { seq: 15, at: 3001, kind: "write", key: "op_note_1", run: "scene:gen1:1", role: "scene", phase: "pre", outcome: "landed" },
];

function feed(view: LiveView | null, over: Partial<Parameters<typeof LiveFeed>[0]> = {}) {
  return LiveFeed({ view, failed: false, role: null, cancellable: true, busy: false, now: 3500, open: (_key, open) => open, onToggle: () => undefined, onRole: () => undefined, onCancel: () => undefined, onRetry: () => undefined, ...over });
}

describe("following the pushes", () => {
  test("joins the run's entries in order, a new run's view replacing the one held; asks again when it can't follow", () => {
    const first: LiveView = { ...RUNNING, entries: ENTRIES.slice(0, 3) };
    expect(followLive(null, { view: first })).toEqual(first);
    const joined = followLive(first, { turn: "gen1", entries: ENTRIES.slice(3), ended: null });
    expect(joined).toEqual(RUNNING);
    // An entry heard twice (the view asked for mid-turn, then the push) joins once.
    expect(followLive(RUNNING, { turn: "gen1", entries: ENTRIES.slice(7), ended: null })).toEqual(RUNNING);
    const ended = followLive(RUNNING, { turn: "gen1", entries: MORE, ended: { state: "done", at: 3100 } });
    expect(ended !== "resync" && ended.ended).toEqual({ state: "done", at: 3100 });
    // Another run's entries, entries missing between, or nothing held: the page asks again.
    expect(followLive(RUNNING, { turn: "gen2", entries: MORE, ended: null })).toBe("resync");
    expect(followLive(RUNNING, { turn: "gen1", entries: MORE.slice(2), ended: null })).toBe("resync");
    expect(followLive(null, { turn: "gen1", entries: MORE, ended: null })).toBe("resync");
  });

  test("lre.live get answers the view and leave stops the pushes", async () => {
    const sent: LiveBody[] = [];
    const controls = liveControls(CHAT, async (body) => {
      sent.push(body);
      return { live: body.op === "get" ? RUNNING : null };
    });
    expect(await controls.get()).toEqual(RUNNING);
    await controls.leave();
    expect(sent).toEqual([
      { type: "lre.live", op: "get", chatId: CHAT },
      { type: "lre.live", op: "leave", chatId: CHAT },
    ]);
    expect(await liveControls(CHAT, async () => null).get()).toBeUndefined();
  });
});

describe("the feed", () => {
  test("groups each agent's work in the order it started, with its messages, reasoning, tool calls with their arguments, results and writes", () => {
    const items = liveItems(RUNNING);
    expect(items.map((i) => (i.type === "group" ? `${i.role}:${i.status}` : i.entry.kind))).toEqual(["main:working", "scene:working"]);
    const tree = feed(RUNNING);
    const text = textOf(tree);
    for (const part of [
      "I look out over the harbor.",
      "Running",
      "Main agent",
      "Stage 3: the scene, the minds and the decisions",
      "MAIN-REASONING about the harbor",
      "The scene first.",
      "run_role",
      '{"role":"scene","task":"Look at the harbor."}',
      "Scene and lore",
      "sonnet-4",
      "SCENE-TASK: what does the scene need?",
      "workspace_write",
      '{"path":"notes/harbor.md","text":"The ferry is late."}',
      "SCENE-RESULT: proposed Write notes/harbor.md",
      "Write notes/harbor.md",
      "staged",
      "1,200 in (800 cached) · 56 out (12 reasoning)",
    ])
      expect(text).toContain(part);
    // The main agent's group comes before the scene's.
    expect(text.indexOf("Main agent")).toBeLessThan(text.indexOf("Scene and lore"));
    // Its system prompt is there to open.
    expect(text).toContain("SCENE-SYSTEM");
  });

  test("shows each group's end and the turn's: the run answered, the write landed, the phase between, the turn done; no Cancel once it ended", () => {
    const done: LiveView = { ...RUNNING, entries: [...ENTRIES, ...MORE], ended: { state: "done", at: 3100 } };
    expect(liveItems(done).map((i) => (i.type === "group" ? `${i.role}:${i.status}` : i.entry.kind))).toEqual(["main:stopped", "scene:done", "phase"]);
    const tree = feed(done);
    const text = textOf(tree);
    expect(text).toContain("Done");
    expect(text).toContain("landed");
    expect(text).toContain("The plan is made");
    expect(text).toContain("scene:gen1:1: the scene role answered");
    expect(propsOf(tree, Button).filter((p) => textOf(p.children) === "Cancel the turn")).toEqual([]);
  });

  test("a failed turn says what stopped it, and a refused write why", () => {
    const failed: LiveView = {
      ...RUNNING,
      entries: [...ENTRIES, { seq: 10, at: 2500, kind: "write", key: "op_note_1", run: "scene:gen1:1", role: "scene", phase: "pre", outcome: "refused", code: "stale", reason: "The file changed since it was staged." }, { seq: 11, at: 2600, kind: "failed", step: "Main agent", reason: "it ended the stage without committing it" }],
      ended: { state: "failed", at: 2700, reason: "it ended the stage without committing it" },
    };
    const text = textOf(feed(failed));
    expect(text).toContain("Failed");
    expect(text).toContain("it ended the stage without committing it");
    expect(text).toContain("refused");
    expect(text).toContain("The file changed since it was staged.");
  });

  test("the role filter shows that role's groups only; Cancel stops the turn while it can be stopped", () => {
    const roles: (string | null)[] = [];
    let cancelled = 0;
    const tree = feed(RUNNING, { onRole: (role) => void roles.push(role), onCancel: () => void (cancelled += 1) });
    const seg = propsOf(tree, Seg).find((p) => p.label === "Show the work of");
    if (!seg) throw new Error("no role filter");
    expect((seg.options as { value: string; label: string }[]).map((o) => o.label)).toEqual(["Every agent", "Main agent", "Scene and lore"]);
    press(seg, "scene");
    press(seg, "all");
    expect(roles).toEqual(["scene", null]);
    const scene = textOf(feed(RUNNING, { role: "scene" }));
    expect(scene).toContain("SCENE-TASK");
    expect(scene).not.toContain("MAIN-REASONING");
    const cancel = propsOf(tree, Button).find((p) => textOf(p.children) === "Cancel the turn");
    if (typeof cancel?.onClick !== "function") throw new Error("no Cancel");
    cancel.onClick();
    expect(cancelled).toBe(1);
    // A turn the engine can't stop now offers none.
    expect(propsOf(feed(RUNNING, { cancellable: false }), Button).filter((p) => textOf(p.children) === "Cancel the turn")).toEqual([]);
  });

  test("with no run since the engine started, says where the turns' transcripts are", () => {
    expect(textOf(feed(null))).toContain("transcripts/");
  });
});

describe("the tool-call cards", () => {
  /** Each card in the tree: its tool, how it stands, and its head's words. */
  const cards = (tree: unknown) => propsOf(tree, "details").flatMap((p) => (p["data-lre-live-call"] !== undefined ? [[p["data-lre-live-call"], p["data-state"], textOf((p.children as unknown[])[0])]] : []));

  test("one card per tool call, its name and its arguments in one line, its state in words and in its class; the result inside it", () => {
    const tree = feed(RUNNING);
    expect(cards(tree)).toEqual([
      ["run_role", "running", '▸run_role{"role":"scene","task":"Look at the harbor."}running…'],
      ["workspace_write", "done", '▸workspace_write{"path":"notes/harbor.md","text":"The ferry is late."}done · 0.0 s'],
    ]);
    const write = propsOf(tree, "details").find((p) => p["data-lre-live-call"] === "workspace_write");
    expect(write?.class).toBe("lre-live-tool is-done");
    const body = textOf((write?.children as unknown[])[1]);
    expect(body).toContain("Arguments");
    expect(body).toContain('"path": "notes/harbor.md"');
    expect(body).toContain("Its result");
    expect(body).toContain("SCENE-RESULT: proposed Write notes/harbor.md");
    // The result shows in its card only, not again as a block of its own.
    expect(textOf(tree).split("SCENE-RESULT").length - 1).toBe(1);
    const running = propsOf(tree, "details").find((p) => p["data-lre-live-call"] === "run_role");
    expect(textOf((running?.children as unknown[])[1])).toContain("Waiting for it…");
  });

  test("a call answered later turns done; a failed one says so; one its agent stopped before has no result", () => {
    const done: LiveView = { ...RUNNING, entries: [...ENTRIES, ...MORE], ended: { state: "done", at: 3100 } };
    expect(cards(feed(done)).map(([name, state]) => [name, state])).toEqual([
      ["run_role", "done"],
      ["workspace_write", "done"],
    ]);
    const failed: LiveView = { ...RUNNING, entries: ENTRIES.map((e) => (e.kind === "result" ? { ...e, error: true, text: "SCENE-FAILURE: the path is a transcript's" } : e)) };
    const tree = feed(failed);
    const write = propsOf(tree, "details").find((p) => p["data-lre-live-call"] === "workspace_write");
    expect([write?.["data-state"], write?.class]).toEqual(["error", "lre-live-tool is-error"]);
    expect(textOf(write?.children)).toContain("failed · 0.0 s");
    expect(textOf(write?.children)).toContain("Its failure");
    expect(textOf(write?.children)).toContain("SCENE-FAILURE");
    const stopped: LiveView = { ...RUNNING, entries: [...ENTRIES, { seq: 10, at: 2500, kind: "stop", agent: "agent_m1", status: "stopped", code: "limit", reason: "it reached its rounds" }] };
    const role = propsOf(feed(stopped), "details").find((p) => p["data-lre-live-call"] === "run_role");
    expect(role?.["data-state"]).toBe("none");
    expect(textOf(role?.children)).toContain("None came: its agent stopped first.");
    const result = { seq: 1, at: 1, kind: "result" as const, agent: "a", call: "c", name: "t", text: "", ms: 1 };
    expect([toolCardState(undefined, false), toolCardState(undefined, true), toolCardState({ ...result, error: false }, false), toolCardState({ ...result, error: true }, true)]).toEqual(["running", "none", "done", "error"]);
  });
});

describe("GM → Workspace: the whole session", () => {
  test("shows every turn's messages, saying which the main agent doesn't read now, and the summary whatever its knowledge", () => {
    const session: SessionView = {
      summary: "SUMMARY-GM: the smuggler's boat.",
      summaryKnowledge: "gm",
      turns: 1,
      tokens: 900,
      segments: [
        {
          turn: 4,
          messages: [
            { role: "user", text: "TASK: I look out over the harbor.", main: true, knowledge: "pov", read: true },
            { role: "assistant", text: "NOTE-GM: the stranger runs the smuggling.", main: true, knowledge: "gm", read: false, files: ["notes/smuggler.md"] },
          ],
        },
      ],
      reads: { knowledge: "pov", turns: 1, tokens: 300, summary: false },
      missing: 0,
      rollback: "available",
    };
    const tree = SessionPanel({ session, busy: false, onRollback: () => undefined });
    const text = textOf(tree);
    for (const part of ["SUMMARY-GM: the smuggler's boat.", "TASK: I look out over the harbor.", "NOTE-GM: the stranger runs the smuggling.", "Reply 4", "notes/smuggler.md", "Not sent to the main agent now"]) expect(text).toContain(part);
    // Each message a bubble: what's sent to the main agent on one side, its answer on the other, each saying whose knowledge made it.
    const bubbles = propsOf(tree, "li").filter((p) => p["data-lre-session-read"] !== undefined);
    expect(bubbles.map((b) => [b.class, b["data-lre-session-read"]])).toEqual([
      ["lre-ws-msg to", "read"],
      ["lre-ws-msg from", "unread"],
    ]);
    expect(bubbles.map((b) => propsOf(b.children, "span").flatMap((s) => (s["data-chip"] !== undefined ? [textOf(s.children)] : [])))).toEqual([["Your character's knowledge"], ["GM's knowledge", "Not sent to the main agent now"]]);
    expect(bubbles.map((b) => textOf(propsOf(b.children, "div").find((d) => d.class === "lre-ws-msg-bubble")?.children))).toEqual(["TASK: I look out over the harbor.", "NOTE-GM: the stranger runs the smuggling."]);
  });
});

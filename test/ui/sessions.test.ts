// The Sessions page's list: scenes newest first with their story names, other sessions under the turn that started them; and a
// run's calls against its limit.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { SessionShown } from "../../src/shared/api";
import { groupSessions, sessionName, SessionsView } from "../../src/ui/pages/sessions";
import { CallsLine } from "../../src/ui/pages/usage";
import { elements, expand, textOf } from "./vnodes";

const scene = (id: string, opened: number, over: Partial<SessionShown> = {}): SessionShown => ({ id, user: "u", chat: "c", kind: "scene", state: "open", opened, turns: 3, ...over });
const SESSIONS: SessionShown[] = [
  scene("s1", 100, { state: "closed", by: "user", closedBy: "t3", scene: "sc-1" }),
  scene("s2", 200, { scene: "sc-2" }),
  scene("s3", 300),
  { id: "a1", user: "u", chat: "c", kind: "agent", agent: "historian", parent: { turn: "t4", agent: "author", call: "k1" }, state: "closed", opened: 250, turns: 1 },
];

describe("the sessions list", () => {
  test("scenes newest first, the others under the turn that started them", () => {
    const groups = groupSessions(SESSIONS);
    expect(groups.scenes.map((s) => s.id)).toEqual(["s3", "s2", "s1"]);
    expect(groups.others.map((g) => [g.turn, g.sessions.map((s) => s.id)])).toEqual([["t4", ["a1"]]]);
    const names = new Map([["sc-1", "The ferry"]]);
    expect(sessionName(SESSIONS[0] as SessionShown, names, 1)).toBe("The ferry");
    expect(sessionName(SESSIONS[2] as SessionShown, names, 3)).toBe("Scene 3");
    const tree = expand(h(SessionsView, { sessions: SESSIONS, scenes: names, openId: null, loading: false, problem: null, onOpen: () => undefined }));
    expect(textOf(tree)).toContain("closed by you");
    expect(textOf(expand(h(SessionsView, { sessions: [{ id: "j1", user: "u", chat: "c", kind: "job", state: "closed", opened: 400, turns: 1, closedBy: "job-1", closedHow: "job", closedAt: 1_800_000_000_000 }], scenes: names, openId: null, loading: false, problem: null, onOpen: () => undefined })))).toContain("closed by the end of its job on");
    expect(elements(tree).filter((e) => e.props["data-session-line"] !== undefined).map((e) => e.props["data-session-line"])).toEqual(["s3", "s2", "s1", "a1"]);
  });

  test("a run says its calls against the limit", () => {
    expect(textOf(expand(h(CallsLine, { calls: 7, limit: 40 })))).toBe("7 of 40 calls");
    expect(textOf(expand(h(CallsLine, { calls: 40, limit: 40 })))).toBe("40 of 40 calls (the limit)");
    expect(textOf(expand(h(CallsLine, { calls: 1, limit: null })))).toBe("1 call");
  });
});

// Settings' navigation (N3 lane A7): pages, and pages within a page (the Agents page's sections, a
// role on Roles and on Context), each under its own header with Back; Back and Escape up one level;
// focus back on the row that opened the page left, or on the part a link opens at; the body each
// place renders. And what the Agents pages say: no old engine name, raw id or stored path in their
// words, the notice of a value kept within range by the setting's name, and Steps and the helper
// model naming the roles of an agent chat that run where they do.

import { describe, expect, test } from "bun:test";
import { defaultSettings } from "../../src/backend/settings-store";
import { settingsBack, settingsFocus, type SettingsRoute } from "../../src/frontend/app";
import { AgentsHub, AgentsSubPage } from "../../src/frontend/settings/agents";
import { AssistantPage } from "../../src/frontend/settings/assistant";
import { ContextPage } from "../../src/frontend/settings/context";
import { AGENTS_SUB, AGENTS_SUBS, adjustedText, settingName } from "../../src/frontend/settings/labels";
import { MainAgentPage } from "../../src/frontend/settings/main-agent";
import { RolePage } from "../../src/frontend/settings/role-page";
import { RolesPage } from "../../src/frontend/settings/roles";
import { PromptsPage } from "../../src/frontend/settings/agent-prompts";
import { SettingsBody, settingsHeader, settingsKeyDown } from "../../src/frontend/settings/settings";
import { agentUsersText, type Connection } from "../../src/frontend/settings/steps";
import { defaultAgentSettings, type AgentSettings } from "../../src/shared/agent-settings";
import { defaultRoleSettings, ROLE_IDS } from "../../src/shared/agent-roles";
import type { SettingsResult } from "../../src/shared/protocol";
import type { RouteSettings } from "../../src/shared/role-routes";
import { rendered, texts } from "../support/settings-tree";

const CONNECTIONS: Connection[] = [{ id: "deepseek", name: "Deepseek", model: "deepseek-v4-flash" }];
const SETTINGS = defaultSettings();
const DATA = { settings: SETTINGS, extraction: {} } as unknown as SettingsResult;
const ROUTES: RouteSettings = { modelUse: SETTINGS.modelUse, helper: SETTINGS.helper };
const noop = (): void => undefined;
const ctx = { connections: CONNECTIONS, caveats: [], view: null, busy: false, patch: noop, go: noop };

/** The element a place renders, by its component and what it was given. */
function body(route: SettingsRoute): { type: unknown; props: Record<string, unknown> } {
  return SettingsBody({ route, data: DATA, ctx }) as unknown as { type: unknown; props: Record<string, unknown> };
}

describe("Settings' places", () => {
  test("a page within a page renders it; one the page doesn't have renders the page", () => {
    for (const sub of AGENTS_SUBS) {
      const el = body({ page: "agents", sub });
      expect([el.type, el.props.sub]).toEqual([AgentsSubPage, sub]);
    }
    for (const id of ROLE_IDS) {
      expect([body({ page: "roles", sub: id }).type, body({ page: "roles", sub: id }).props.id]).toEqual([RolePage, id]);
      expect([body({ page: "context", sub: id, at: "reads" }).type, body({ page: "context", sub: id }).props.id]).toEqual([RolePage, id]);
    }
    expect(body({ page: "agents" }).type).toBe(AgentsHub);
    expect(body({ page: "agents", sub: "nowhere" }).type).toBe(AgentsHub);
    expect(body({ page: "roles" }).type).toBe(RolesPage);
    expect(body({ page: "context" }).type).toBe(ContextPage);
    expect(body({ page: "main" }).type).toBe(MainAgentPage);
    expect(body({ page: "assistant" }).type).toBe(AssistantPage);
    // A role page's Prompts opens that role's page on Prompts.
    const prompts = body({ page: "prompts", open: { page: "role.intent" } });
    expect([prompts.type, prompts.props.open]).toEqual([PromptsPage, { page: "role.intent" }]);
  });

  test("each place's header: its title, and Back named for where it goes; the Agents sections keep today's names", () => {
    expect(AGENTS_SUBS.map((s) => AGENTS_SUB[s].title)).toEqual(["Pipeline", "Review card", "System instructions", "Budgets", "Compaction", "Recording", "Throttles", "Caching", "Acceptance runs"]);
    expect(settingsHeader({ page: "home" })).toBeNull();
    expect(settingsHeader({ page: "agents" })).toMatchObject({ title: "Agents", backLabel: "Settings" });
    expect(settingsHeader({ page: "agents", sub: "budgets" })).toMatchObject({ title: "Budgets", backLabel: "Agents" });
    expect(settingsHeader({ page: "roles", sub: "intent" })).toMatchObject({ title: "Intent", backLabel: "Roles" });
    expect(settingsHeader({ page: "context", sub: "read", at: "reads" })).toMatchObject({ title: "Read", backLabel: "Context" });
    expect(settingsHeader({ page: "roles", sub: "nobody" })).toMatchObject({ title: "Roles", backLabel: "Settings" });
  });

  test("Back and Escape go up one level; Escape a control handled first stays the control's", () => {
    expect(settingsBack({ page: "agents", sub: "budgets" })).toEqual({ page: "agents" });
    expect(settingsBack({ page: "context", sub: "read", at: "reads" })).toEqual({ page: "context" });
    expect(settingsBack({ page: "agents" })).toEqual({ page: "home" });
    expect(settingsBack({ page: "prompts", open: { page: "main" } })).toEqual({ page: "home" });
    let backs = 0;
    let prevented = false;
    const key = (k: string, defaultPrevented = false) => settingsKeyDown({ key: k, defaultPrevented, preventDefault: () => void (prevented = true) }, () => void (backs += 1));
    key("Escape");
    expect([backs, prevented]).toEqual([1, true]);
    prevented = false;
    key("Escape", true);
    key("Enter");
    expect([backs, prevented]).toEqual([1, false]);
  });

  test("focus: going in, the new page's Back or the part a link opens at; going back, the row that opened the page left", () => {
    expect(settingsFocus({ page: "home" }, { page: "agents" })).toEqual({ selector: ".lre-page-header button", reveal: "start" });
    expect(settingsFocus({ page: "agents" }, { page: "agents", sub: "budgets" })).toEqual({ selector: ".lre-page-header button", reveal: "start" });
    expect(settingsFocus({ page: "context" }, { page: "context", sub: "read", at: "reads" })).toEqual({ selector: '[data-lre-agent-section="reads"]', reveal: "start" });
    expect(settingsFocus({ page: "agents", sub: "budgets" }, { page: "agents" })).toEqual({ selector: '[data-lre-settings-sub="budgets"] button', reveal: "nearest" });
    expect(settingsFocus({ page: "roles", sub: "director" }, { page: "roles" })).toEqual({ selector: '[data-lre-settings-sub="director"] button', reveal: "nearest" });
    expect(settingsFocus({ page: "agents" }, { page: "home" })).toEqual({ selector: '[data-lre-settings="agents"] button', reveal: "nearest" });
    // A link from one page to another's page within it goes in.
    expect(settingsFocus({ page: "roles", sub: "intent" }, { page: "agents", sub: "budgets" })).toEqual({ selector: ".lre-page-header button", reveal: "start" });
    expect(settingsFocus(null, { page: "agents" }).selector).toBe(".lre-page-header button");
  });
});

/** Every Agents page, rendered with `agents`. */
function agentPages(agents: AgentSettings): unknown[] {
  const page = { connections: CONNECTIONS, busy: false, patch: noop, go: noop };
  return [
    AgentsHub({ agents, routes: ROUTES, ...page }),
    ...AGENTS_SUBS.map((sub) => AgentsSubPage({ sub, agents, ...page })),
    RolesPage({ agents, timeouts: SETTINGS.timeouts, routes: ROUTES, connections: CONNECTIONS, go: noop }),
    ContextPage({ agents, go: noop }),
    ...ROLE_IDS.map((id) => RolePage({ id, agents, routes: ROUTES, prompts: SETTINGS.prompts, ...page })),
    MainAgentPage({ agents, timeouts: SETTINGS.timeouts, prompts: SETTINGS.prompts, ...page }),
    AssistantPage({ agents, prompts: SETTINGS.prompts, ...page }),
  ].map(rendered);
}

describe("what the Agents pages say", () => {
  const changed = (() => {
    const a = structuredClone(defaultAgentSettings());
    a.pipeline = { mode: "main", memory: "before_next", curator: false };
    for (const id of ROLE_IDS) a.roles[id] = { ...defaultRoleSettings()[id], connectionId: "deepseek", effort: "high", tier: "gm", promptOnly: true, onFail: "skip", budget: { toolTurns: 3, wallMs: "none" } };
    a.main = { ...a.main, connectionId: "deepseek", budget: { revisions: 1 } };
    a.finalReview = { on: false, onFail: "stop", budget: { toolTurns: 2 } };
    a.assistant = { ...a.assistant, apply: "at_once", budget: { callMs: 30_000 } };
    a.throttles = [{ id: "deepseek", requestsPerMinute: 30, tokensPerMinute: "none" }];
    a.caching = { on: false, nonce: "", roles: { intent: { on: true, nonce: "" } } };
    a.vsClassic = 1.5;
    return a;
  })();

  test("no word of any of them names the steps engine's old name, a raw id or a stored path, at the defaults or changed", () => {
    for (const agents of [defaultAgentSettings(), changed]) {
      const words = agentPages(agents).flatMap(texts);
      expect(words.length).toBeGreaterThan(300);
      expect(words.filter((w) => /classic/i.test(w))).toEqual([]);
      // A setting's key (callTokensOut, vsClassic), a step's id (npc.choose) or a stored path (/agents/…).
      expect(words.filter((w) => /\b[a-z]+[A-Z][A-Za-z]*\b/.test(w) || /\b(npc\.choose|puzzle\.answer|prompt_only|before_next|after_reply)\b/.test(w) || /\/(agents|roles|budget|context)\//.test(w))).toEqual([]);
    }
  });

  test("a value kept within range is named as its page names the setting", () => {
    expect(settingName("/agents/roles/intent/budget/toolTurns")).toBe("Intent: Tool rounds per agent");
    expect(settingName("/agents/budget/callTokensOut")).toBe("Answer per call");
    expect(settingName("/agents/main/digestTokens")).toBe("Main agent: Turn digest");
    expect(settingName("/agents/kept/gates")).toBe("Turns waiting at a gate");
    expect(settingName("/timeouts/finalReviewMs")).toBe("Final review");
    expect(settingName("/minds/liveLimit")).toBe("Minds → live limit");
    expect(adjustedText([{ pointer: "/agents/budget/toolTurns", now: 0, sent: -1 }])).toBe("Saved, kept within what each setting takes: Tool rounds per agent is 0, not -1.");
  });

  test("Steps and the helper model name the agent chats' roles that run where they do", () => {
    const roles = defaultRoleSettings();
    expect(agentUsersText(ROUTES, roles, "interpret")).toBe("On agent chats, Intent (reading your message) runs where this step does.");
    expect(agentUsersText(ROUTES, roles, "extract")).toBe("On agent chats, Read (reading the reply), Curator (things and places), World steps (the world's own steps) run where this step does.");
    expect(agentUsersText(ROUTES, { ...roles, read: { ...roles.read, connectionId: "deepseek" } }, "extract")).toBe("On agent chats, Curator (things and places), World steps (the world's own steps) run where this step does. Read sets its own (Settings → Agents → Roles).");
    const helper = agentUsersText(ROUTES, roles, null) ?? "";
    expect(helper.startsWith("On agent chats, Intent (reading your message, judging your approach, a puzzle's answer), Scene and lore (the scene's lore and notes)")).toBe(true);
    expect(helper.endsWith("run on the helper model, while neither their step nor their role sets a connection.")).toBe(true);
    // A step with no task of a role: nothing to say.
    expect(agentUsersText(ROUTES, roles, "outline")).toBeNull();
  });
});

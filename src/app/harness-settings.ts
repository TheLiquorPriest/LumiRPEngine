// RPH's settings, declared the way `rp-harness` is to export them (`SettingDef`): every key its reader
// (`src/harness/settings.ts` in RPHarness) takes from a config file, with its default and what it takes,
// copied from that reader as it stood on disk on 14 November 2026. RPH does not declare them yet; once
// it exports its own list, that export replaces this module, and nothing that uses it changes.

import type { SettingDef } from "./setting-list";

const FORMS = ["tags", "two-step"] as const;
const EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const NO_LIMIT = "no limit";

/** Every setting RPH reads, as a config file writes it. */
export const HARNESS_SETTINGS: readonly SettingDef[] = [
  { key: "limits.turn.calls", default: 40, takes: { type: "whole", least: 1 }, orNone: true, none: NO_LIMIT, perConnection: false },
  { key: "limits.turn.tokensIn", default: null, takes: { type: "whole", least: 1 }, none: NO_LIMIT, perConnection: false },
  { key: "limits.turn.tokensOut", default: null, takes: { type: "whole", least: 1 }, none: NO_LIMIT, perConnection: false },
  { key: "limits.turn.time", default: null, takes: { type: "whole", least: 1 }, none: NO_LIMIT, perConnection: false },
  { key: "limits.turn.depth", default: 2, takes: { type: "whole", least: 0 }, perConnection: false },
  { key: "limits.turn.agents", default: 24, takes: { type: "whole", least: 0 }, orNone: true, none: NO_LIMIT, perConnection: false },
  { key: "reply.form", default: "tags", takes: { type: "oneOf", values: FORMS }, perConnection: false },
  { key: "reply.forms.<connection>", default: null, takes: { type: "oneOf", values: FORMS }, none: "as reply.form says", perConnection: true },
  { key: "reply.streamAnyway", default: [], takes: { type: "texts" }, perConnection: false },
  { key: "reply.heldSentences", default: 1, takes: { type: "whole", least: 0 }, perConnection: false },
  { key: "reply.tailSentences", default: 3, takes: { type: "whole", least: 1 }, perConnection: false },
  { key: "reply.leadSampling", default: "own", takes: { type: "oneOf", values: ["own", "preset"] }, perConnection: false },
  { key: "reply.intentWait", default: 2, takes: { type: "whole", least: 0 }, perConnection: false },
  { key: "progress.show", default: "all", takes: { type: "oneOf", values: ["all", "least"] }, perConnection: false },
  { key: "progress.silence", default: 60, takes: { type: "whole", least: 1 }, perConnection: false },
  { key: "results.clip", default: 12_000, takes: { type: "whole", least: 1 }, perConnection: false },
  { key: "tools.search", default: 8, takes: { type: "whole", least: 1 }, perConnection: false },
  { key: "tools.gapCheck", default: 20, takes: { type: "whole", least: 1 }, perConnection: false },
  { key: "tools.perCall", default: 100, takes: { type: "whole", least: 1 }, perConnection: false },
  { key: "tools.schemaShown", default: 600, takes: { type: "whole", least: 0 }, perConnection: false },
  { key: "rules.window", default: 500, takes: { type: "whole", least: 1 }, perConnection: false },
  { key: "rules.judge", default: null, takes: { type: "text" }, none: "the asking agent's own connection", perConnection: false },
  { key: "effort.connections.<connection>", default: null, takes: { type: "oneOf", values: EFFORTS }, none: "as each agent's definition says", perConnection: true },
  { key: "trace.requests", default: "first", takes: { type: "oneOf", values: ["first", "all", "none"] }, perConnection: false },
  { key: "compaction.reserve", default: 16_384, takes: { type: "whole", least: 0 }, perConnection: false },
  { key: "compaction.keepTurns", default: 3, takes: { type: "whole", least: 0 }, perConnection: false },
  { key: "compaction.records", default: 6_000, takes: { type: "whole", least: 1 }, perConnection: false },
  { key: "compaction.saveCalls", default: 1, takes: { type: "whole", least: 1 }, perConnection: false },
  { key: "prompt.kept", default: 50, takes: { type: "whole", least: 1 }, perConnection: false },
  { key: "jobs.atOnce", default: 2, takes: { type: "whole", least: 1 }, perConnection: false },
  { key: "jobs.perDay", default: null, takes: { type: "whole", least: 1 }, orNone: true, none: NO_LIMIT, perConnection: false },
  { key: "jobs.connections.<connection>.atOnce", default: null, takes: { type: "whole", least: 1 }, none: "no limit of its own", perConnection: true },
  { key: "jobs.connections.<connection>.perDay", default: null, takes: { type: "whole", least: 1 }, orNone: true, none: "no limit of its own", perConnection: true },
  { key: "jobs.run.calls", default: 60, takes: { type: "whole", least: 1 }, orNone: true, none: NO_LIMIT, perConnection: false },
  { key: "jobs.run.tokensIn", default: 600_000, takes: { type: "whole", least: 1 }, orNone: true, none: NO_LIMIT, perConnection: false },
  { key: "jobs.run.tokensOut", default: 60_000, takes: { type: "whole", least: 1 }, orNone: true, none: NO_LIMIT, perConnection: false },
  { key: "jobs.run.time", default: 900, takes: { type: "whole", least: 1 }, orNone: true, none: NO_LIMIT, perConnection: false },
];

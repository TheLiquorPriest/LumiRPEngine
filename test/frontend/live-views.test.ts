// Every panel decoder reads the view its pack really builds (not the generic JSON fallback): each
// starter world is materialized through the shipped registry and every registered view is decoded.

import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import { decodeCalendarView } from "../../src/packs/calendar/ui/panel";
import { decodeCastView } from "../../src/packs/castlife/ui/panel";
import { decodeFinanceView } from "../../src/packs/economy/ui/decode";
import { decodeGearView } from "../../src/packs/gear/ui/panel";
import { decodeYouView } from "../../src/packs/sheets/ui/panel";
import { decodeQuestsView } from "../../src/packs/story/ui/panel";
import { decodeGarageView } from "../../src/packs/vehicles/ui/panel";
import { STARTER_WORLDS } from "../../src/packs/starters/index";
import { Play, registry } from "../packs/templates/play";

const DECODERS: Record<string, (value: unknown) => unknown> = {
  "calendar.calendar": decodeCalendarView,
  "castlife.cast": decodeCastView,
  "economy.money": decodeFinanceView,
  "gear.gear": decodeGearView,
  "sheets.you": decodeYouView,
  "story.quests": decodeQuestsView,
  "vehicles.garage": decodeGarageView,
};

describe.each(Object.keys(STARTER_WORLDS))("%s views", (starter) => {
  const play = new Play(starter);
  const ctx = registry.context(play.world, play.state);
  const views = registry.views.filter((def) => def.panel in DECODERS);

  test("every decoded panel has a view builder", () => {
    expect(views.map((def) => def.panel).sort()).toEqual(Object.keys(DECODERS).sort());
  });

  test.each(views.map((def) => [def.panel, def] as const))("%s decodes", (panel, def) => {
    const view: unknown = JSON.parse(JSON.stringify(def.build(ctx, { mapDisplay: null })));
    if (view === null) return;
    expect(DECODERS[panel]?.(view)).not.toBeNull();
  });
});

test("every starter's quest log decodes track for track: status, label, stage and cue carried over", () => {
  const def = registry.views.find((v) => v.panel === "story.quests");
  let seen = 0;
  for (const starter of Object.keys(STARTER_WORLDS)) {
    const play = new Play(starter);
    const raw: unknown = JSON.parse(JSON.stringify(def?.build(registry.context(play.world, play.state), { mapDisplay: null })));
    const decoded = decodeQuestsView(raw);
    const expected = isRecord(raw) ? (["active", "done", "failed"] as const).flatMap((status) => (Array.isArray(raw[status]) ? raw[status].filter(isRecord).map((t) => ({ id: t.id, status, label: t.label, stage: t.stage, cue: t.cue ?? undefined })) : [])) : [];
    const actual: unknown = decoded?.tracks.map((t) => ({ id: t.id, status: t.status, label: t.label, stage: t.stage, cue: t.cue }));
    expect(actual).toEqual(expected);
    seen += expected.length;
  }
  expect(seen).toBeGreaterThan(0);
});

// The Custom profile (DESIGN §11): the least a ruleset needs, to grow in Build. One stat, one
// check, an HP pool whose max is a formula, a plain attack so fights run, and a progression with
// level 1 only: an author adds thresholds (or a table) to level up their own way.

import { presetAdjudication } from "../adjudication";
import type { ProfileDef } from "./types";
import { DIFFICULTY, DIFFICULTY_PARAM, INITIATIVE_BANDS, levelFields } from "./parts";

export const CUSTOM: ProfileDef = {
  id: "custom",
  label: "Custom",
  summary: "A minimal start to build on: one stat, one check, an HP pool and a progression with no levels yet.",
  fields: {
    skill: { type: "number", label: "Skill", default: 0, min: 0, max: 10 },
    hp: { type: "number", label: "HP", pool: { max: "10 + self.skill * 2" } },
    ...levelFields(null),
  },
  checks: {
    challenge: { id: "challenge", dice: "d20", modifier: "self.skill", dc: DIFFICULTY },
  },
  actions: {
    try_something: { id: "try_something", label: "Try something", params: { difficulty: DIFFICULTY_PARAM }, requires: [], check: "challenge", outcomes: { failure: [], success: [] }, duration: "10", lexicon: ["try something", "give it a go"], observable: "gives it a go" },
    attack: {
      id: "attack",
      label: "Attack",
      params: { target: { type: "ref", label: "Target" } },
      requires: ["is_foe(self, target)", "not is_down(target)"],
      check: { id: "attack", dice: "d20", modifier: "self.skill", dc: "10 + target.skill" },
      outcomes: { success: [{ type: "add", args: { entity: "target", field: "hp", delta: "=-roll('1d6')" } }], failure: [] },
      duration: "0",
      lexicon: ["attack", "strike at"],
      observable: "attacks",
      combat: { cost: { action: 1 }, role: "attack" },
    },
  },
  tables: {},
  ruleset: {
    progression: { level: { label: "Level", xpField: "xp", levelField: "level", thresholds: [0] } },
    sheet: { sections: [{ id: "character", label: "Character", rows: [{ field: "skill" }, { pool: "hp" }, { progression: "level" }] }] },
    minLevels: { sheets: 3 },
    adjudication: presetAdjudication("balanced"),
    combat: { initiative: { id: "initiative", dice: "d20", modifier: "self.skill", bands: INITIATIVE_BANDS }, economy: { action: { label: "Action" } }, hp: "hp" },
  },
};

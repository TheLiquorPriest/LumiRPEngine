// The page's own words for what is wrong with a routine as a form holds it (`blockShapeProblems`, `routineShapeProblems`), which the page says
// itself because a page has no lines to read: the server says the same problems from the shipped files (`fault_*` lines of history-routines).
// Only the owner reads these, on the Build and the cast's pages.

import type { LineFields, Voice } from "./lines";

const FAULTS: Readonly<Record<string, string>> = {
  fault_its_source_isn_t_one: "its source isn't one",
  fault_a_lore_source_names_its_entry: "a lore source names its entry",
  fault_a_sheet_source_names_its_entity: "a sheet source names its entity and field",
  fault_world_data_rests_on_what_s: "world data rests on what's authored, a lore entry or a sheet field",
  fault_a_story_source_has_its_time: "a story source has its time",
  fault_a_gm_source_has_its_time: "a GM source has its time",
  fault_its_place_is_home_work_here: "its place is home, work, here, with, {place} or {nearest}",
  fault_its_days_aren_t_a_set: "its days aren't a set of constraints",
  fault_weekdays_are_0_sunday_to_6: "weekdays are 0 (Sunday) to 6",
  fault_days_off_are_only_or_never: "days off are only or never",
  fault_holidays_are_calendar_ids: "holidays are calendar ids",
  fault_except_lists_calendar_ids: "except lists calendar ids",
  fault_a_birthday_is_own_or_friend: "a birthday is own or friend",
  fault_seasons_are_spring_summer_autumn_and: "seasons are spring, summer, autumn and winter",
  fault_weather_is_fair_or_foul: "weather is fair or foul",
  fault_a_block_is_an_object: "a block is an object",
  fault_a_block_has_an_id: "a block has an id",
  fault_a_block_has_a_label: "a block has a label",
  fault_a_block_has_an_activity: "a block has an activity",
  fault_its_kind_is_fixed_flexible_or: "its kind is fixed, flexible or optional",
  fault_its_length_minutes_is_1_to: "its length (minutes) is 1 to 1,440 minutes",
  fault_a_fixed_block_starts_at_an: "a fixed block starts at an HH:MM time (at)",
  fault_only_a_fixed_block_has_a: "only a fixed block has a start time (at)",
  fault_its_window_is_hh_mm_to: "its window is HH:MM to HH:MM",
  fault_times_a_week_perweek_is_1: "times a week (perWeek) is 1 to 7, for a flexible or optional block",
  fault_a_chance_is_above_0_and: "a chance is above 0 and at most 1, for an optional block",
  fault_its_priority_is_1_to_5: "its priority is 1 to 5",
  fault_its_needs_are_names: "its needs are names",
  fault_private_is_true_or_false: "private is true or false",
  fault_its_company_is_who_a_selector: "its company is {who: a selector, invite?}",
  fault_a_routine_is_an_object: "a routine is an object",
  fault_a_routine_has_an_id: "a routine has an id",
  fault_its_label_is_text: "its label is text",
  fault_its_owner_is_an_entity_a: "its owner is an entity, a group, a kind or a selector",
  fault_inherit_is_true_or_false: "inherit is true or false",
  fault_a_routine_has_a_list_of: "a routine has a list of blocks",
  fault_routine_settings_are_an_object: "routine settings are an object",
  fault_key_is_true_or_false: "{{key}} is true or false",
  fault_key_give_fidelities_each_one_of: "{{key}} give {{fidelities}} each one of {{levels}}",
  fault_key_have_no_level_level_fidelities: "{{key}} have no level {{level}} ({{fidelities}})",
  fault_block_n_problem: "block {{n}}: {{problem}}",
  fault_block_n_another_block_of_this_routine: "block {{n}}: another block of this routine is {{id}}",
  fault_there_s_no_setting_key_settings: "there's no setting {{key}} ({{settings}})",
  fault_key_level_is_levels: "{{key}}.{{level}} is {{levels}}",
  fault_key_is_allowed: "{{key}} is {{allowed}}",
};

/** The page's voice: a fault in the page's words, its fields put in where the words name them. */
export const pageVoice: Voice = (name: string, fields: LineFields = {}): string => (FAULTS[name] ?? name).replace(/\{\{(\w+)\}\}/g, (_all, field: string) => String(fields[field] ?? ""));

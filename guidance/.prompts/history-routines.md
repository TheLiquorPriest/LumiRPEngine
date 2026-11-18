---
description: The sentences of the changes made to someone's routine, schedule or following in this chat, as the game master reads them, and of how someone follows their routine. One line per name, a name, a colon, then its text. A name in double braces puts in what the engine knows of it (an amount in the world's own coin, a name, a number), and a block opened with a hash and closed with a slash shows only when that value is there. Change the words freely. Delete a line and that is not said at all.
format: lines
keys:
  fault_*: what is wrong with a routine, a block of one, routine settings or needs settings as written (the problems a write, a proposal or a lint lists) - each is filled with what it names
  castlife_in_chat: a change to someone's routine or schedule in this chat, as the GM reads it - what (the sentence below), story (set where the story made it)
  castlife_follow: how someone follows their routine in this chat - name, parts (the follow_* lines, read as a list); castlife_follow_world when none is set
  follow_mode_*, follow_awareness_*, follow_role_*, follow_skips_*: one part of how someone follows their routine, as a phrase after the name (follows, no_invitations, off; story_first, balanced, routine_first; informative, enforced, off; stay, routine, model)
  castlife_block_back, castlife_block_off, castlife_block_changed: one block of someone's routine in this chat, back to the world's, off, or changed - name, block
  castlife_schedule_label: a schedule as a phrase - schedule, sets (what it sets, the schedule_sets_* lines); castlife_schedule_world, castlife_schedule_off, castlife_schedule_own say what happened to it - name, label
---
castlife_decided: decided {{choice}}
castlife_skip: skip planned for {{plans}}{{#note}} ({{note}}){{/note}}
castlife_in_chat: {{what}} in this chat ({{#story}}from the story{{/story}}{{^story}}set by the GM{{/story}})
castlife_follow_world: {{name}} follows their routine as the world sets it again
castlife_follow: {{name}} {{parts}}
follow_mode_follows: follows their routine
follow_mode_no_invitations: follows their routine but makes and accepts no invitations
follow_mode_off: has no routine
follow_awareness_story_first: puts the story before their routine
follow_awareness_balanced: weighs the story and their routine alike
follow_awareness_routine_first: puts their routine before the story
follow_role_informative: takes their routine as context only
follow_role_enforced: lives their routine as written
follow_role_off: ignores their routine
follow_skips_stay: stays put in a time skip
follow_skips_routine: follows their routine in a time skip
follow_skips_model: lives a time skip as the model plans it
castlife_block_back: {{name}}'s “{{block}}” is back to the world's
castlife_block_off: {{name}}'s “{{block}}” is off
castlife_block_changed: {{name}}'s “{{block}}” changed
schedule_sets_place: where they are
schedule_sets_activity: what they're doing
schedule_sets_field: their {{field}}
castlife_schedule_label: “{{schedule}}” schedule{{#sets}} (it sets {{sets}}){{/sets}}
castlife_schedule_world: {{name}} keeps the world's {{label}} again
castlife_schedule_off: {{name}} is off their {{label}}
castlife_schedule_own: {{name}} has their own {{label}}
fault_needs_settings_are_an_object_one: needs settings are an object, one entry per need
fault_there_s_no_need_need_needids: there's no need {{need}} ({{needIds}})
fault_need_is_an_object_on_rate: {{need}} is an object: on, rate, tell, alert
fault_need_part_is_true_or_false: {{need}}.{{part}} is true or false
fault_need_part_is_a_number_from: {{need}}.{{part}} is a number from 0 to {{rateMax}}, its growth an hour
fault_need_part_is_a_number_from_2: {{need}}.{{part}} is a number from 0 to 100
fault_its_source_isn_t_one: its source isn't one
fault_a_lore_source_names_its_entry: a lore source names its entry
fault_a_sheet_source_names_its_entity: a sheet source names its entity and field
fault_world_data_rests_on_what_s: world data rests on what's authored, a lore entry or a sheet field
fault_a_story_source_has_its_time: a story source has its time
fault_a_gm_source_has_its_time: a GM source has its time
fault_its_place_is_home_work_here: its place is home, work, here, with, {place} or {nearest}
fault_its_days_aren_t_a_set: its days aren't a set of constraints
fault_weekdays_are_0_sunday_to_6: weekdays are 0 (Sunday) to 6
fault_days_off_are_only_or_never: days off are only or never
fault_holidays_are_calendar_ids: holidays are calendar ids
fault_except_lists_calendar_ids: except lists calendar ids
fault_a_birthday_is_own_or_friend: a birthday is own or friend
fault_seasons_are_spring_summer_autumn_and: seasons are spring, summer, autumn and winter
fault_weather_is_fair_or_foul: weather is fair or foul
fault_a_block_is_an_object: a block is an object
fault_a_block_has_an_id: a block has an id
fault_a_block_has_a_label: a block has a label
fault_a_block_has_an_activity: a block has an activity
fault_its_kind_is_fixed_flexible_or: its kind is fixed, flexible or optional
fault_its_length_minutes_is_1_to: its length (minutes) is 1 to 1,440 minutes
fault_a_fixed_block_starts_at_an: a fixed block starts at an HH:MM time (at)
fault_only_a_fixed_block_has_a: only a fixed block has a start time (at)
fault_its_window_is_hh_mm_to: its window is HH:MM to HH:MM
fault_times_a_week_perweek_is_1: times a week (perWeek) is 1 to 7, for a flexible or optional block
fault_a_chance_is_above_0_and: a chance is above 0 and at most 1, for an optional block
fault_its_priority_is_1_to_5: its priority is 1 to 5
fault_its_needs_are_names: its needs are names
fault_private_is_true_or_false: private is true or false
fault_its_company_is_who_a_selector: its company is {who: a selector, invite?}
fault_a_routine_is_an_object: a routine is an object
fault_a_routine_has_an_id: a routine has an id
fault_its_label_is_text: its label is text
fault_its_owner_is_an_entity_a: its owner is an entity, a group, a kind or a selector
fault_inherit_is_true_or_false: inherit is true or false
fault_a_routine_has_a_list_of: a routine has a list of blocks
fault_routine_settings_are_an_object: routine settings are an object
fault_key_is_true_or_false: {{key}} is true or false
fault_key_give_fidelities_each_one_of: {{key}} give {{fidelities}} each one of {{levels}}
fault_key_have_no_level_level_fidelities: {{key}} have no level {{level}} ({{fidelities}})
fault_need_has_no_setting_part: {{need}} has no setting {{part}} ({{parts}})
fault_block_n_problem: block {{n}}: {{problem}}
fault_block_n_another_block_of_this_routine: block {{n}}: another block of this routine is {{id}}
fault_there_s_no_setting_key_settings: there's no setting {{key}} ({{settings}})
fault_key_level_is_levels: {{key}}.{{level}} is {{levels}}
fault_key_is_allowed: {{key}} is {{allowed}}
reason_an_order: an order
reason_their_own_plan: their own plan
reason_routine_only: routine only
reason_no_time_for_it: no time for it

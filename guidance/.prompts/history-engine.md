---
description: What the engine says of what it did or could not do, apart from a refused change - the turn's beats, a formula or dice that does not read, a selector or a field value that does not fit, a ruleset or a world draft that is wrong, what a thing's provenance reads, a thing tidied, and what someone may not do for an organization. Each is filled with what it names. One line per name, a name, a colon, then its text. A name in double braces puts in what the engine knows of it (an amount in the world's own coin, a name, a number), and a block opened with a hash and closed with a slash shows only when that value is there. Change the words freely. Delete a line and that is not said at all.
format: lines
keys:
  eng_*: what the engine says of what it did or could not do, apart from a refused change (the turn's beats, a formula or dice that does not read, a selector or a field value that does not fit, a ruleset or a world draft that is wrong, what a thing's provenance reads, a thing tidied, what someone may not do for an organization) - each is filled with what it names
  eng2_*: more of what the engine says apart from a refused change (what happens in a beat, an item that replaces another, a private possessive, a name followed by you, a number below or above its bounds, a spawn's path, a basic need, a world's info or lore entry, a routine's block, a sum rounded or the default one) - each is filled with what it names
  reason_*: why a thing does not fit where it was put (too big to carry or to go in something, a vehicle that goes only on another vehicle, a thing made in play or missing from the world's draft, a place skipped) - each is filled with what it names
---
eng_taking_minutes: , taking {{minutes}}
eng_what_changed_changes:  What changed: {{changes}}.
eng_what_doesnt_happen_reason_not_possible_here: {{what}} doesn't happen: {{#if_requirement}}{{reason}}{{/if_requirement}}{{^if_requirement}}not possible here and now{{/if_requirement}}.
eng_what_the_result_is_decided_outcome_took: {{what}}: the result is decided — {{outcome}}{{took}}.{{changed}}
eng_time_passes_until_its_interrupted_text: Time passes until it's interrupted: {{text}}.
eng_time_passes_until_mindname_someone_steps_in: Time passes until {{#mindName}}{{mindName}}{{/mindName}}{{^mindName}}someone{{/mindName}} steps in; how they do is in the Minds section.
eng_time_passes: Time passes.
eng_the_players_message_fills_this_time_fill:  The player's message fills this time: “{{fill}}”, what the player character does in it.
eng_span_filled_what_else_happened_in_it: {{span}}{{filled}} What {{#if_filled}}else {{/if_filled}}happened in it is in the Montage.
eng_name_is_doing: {{name}} is {{doing}}.
eng_you_are_due_to_be_doing_from: You are due to be {{doing}} from {{minuteOfDay}} (in {{clock}}).
eng_org_was_dissolved_on_dissolved: {{org}} was dissolved on {{dissolved}}
eng_org_is_winding_up: {{org}} is winding up
eng_must_be_a_number: must be a number
eng_must_be_a_whole_amount: must be a whole amount
eng_must_be_a_date: must be a date
eng_must_be_yes_or_no: must be yes or no
eng_must_be_text: must be text
eng_must_be_one_of_values: must be one of {{values}}
eng_must_be_dice_like_2d6_1: must be dice, like 2d6+1
eng_must_name_a_def: must name a {{def}}
eng_must_name_a_place_or_something_in: must name a place or something in the world
eng_must_be_a_list: must be a list
eng_must_be_between_min_and_max: must be between {{min}} and {{max}}
eng_must_be_at_least_min: must be at least {{min}}
eng_must_be_at_most_value: must be at most {{value}}
eng_isnt_a_field_name: isn't a field name
eng_correction: Correction
eng_isnt_a_selector: isn't a selector
eng_has_a_key_that_isnt_a_list: has a "{{key}}" that isn't a list
eng_names_id_which_isnt_in_the_world: names "{{id}}", which isn't in the world
eng_names_an_unknown_kind_kind: names an unknown kind "{{kind}}"
eng_names_tier_tier_which_isnt_one_of: names tier "{{tier}}", which isn't one of the world's tiers
eng_names_the_group_group_which_isnt_in: names the group "{{group}}", which isn't in the world
eng_names_name_as_a_group_but_it: names {{name}} as a group, but it isn't an organization
eng_names_the_party_tier_tier_which_isnt: names the party tier "{{tier}}", which isn't one of {{pARTY_TIERS}}
eng_names_the_position_position_which_no_organization: names the position "{{position}}", which no organization{{#if_groups}} it names{{/if_groups}} defines
eng_has_a_class_that_isnt_a_facet: has a class that isn't a facet → values map
eng_names_an_unknown_classification_facet: names an unknown classification "{{facet}}"
eng_names_v_which_isnt_a_value_of: names "{{v}}", which isn't a value of {{def}}
eng_who_s_classification_isnt_a_facet_values: {{who}}'s classification isn't a facet → values map.
eng_who_is_classed_under_facet_which_isnt: {{who}} is classed under "{{facet}}", which isn't one of the world's classifications.
eng_who_s_def_isnt_a_list_of: {{who}}'s {{def}} isn't a list of values.
eng_who_is_classed_as_v_which_isnt: {{who}} is classed as "{{v}}", which isn't a value of {{def}}.
eng_who_holds_valuescount_def_values_def_takes: {{who}} holds {{valuesCount}} {{def}} values; {{def}} takes one.
eng_formula_exceeds_the_limit_limit_of_max: Formula exceeds the {{limit}} limit of {{max}}
eng_unclosed_quote_starting_at_character_i: Unclosed quote starting at character {{i}}
eng_unexpected_c_at_character_i: Unexpected "{{c}}" at character {{i}}
eng_unexpected_toks: Unexpected "{{toks}}"
eng_msg_at_end_of_expression: {{msg}} at end of expression
eng_msg_at_character_at: {{msg}} at character {{at}}
eng_expected_v: Expected "{{v}}"
eng_expression_ended_too_early: Expression ended too early
eng_number_too_large_at_character_t: Number too large at character {{t}}
eng_expected_a_name_after: Expected a name after "."
eng_the_environment_returned_an_unsupported_value_for: The environment returned an unsupported value for {{what}}
eng_dice_notation_must_be_a_string: Dice notation must be a string
eng_dice_notation_is_longer_than_maxnotationlength_character: Dice notation is longer than {{maxNotationLength}} characters
eng_dice_notation_is_empty: Dice notation is empty
eng_src_more_than_maxterms_terms: "{{src}}": more than {{maxTerms}} terms
eng_src_flat_bonus_is_larger_than_maxflat: "{{src}}": flat bonus is larger than {{maxFlat}}
eng_src_dice_count_must_be_1_maxcount: "{{src}}": dice count must be 1–{{maxCount}}
eng_src_dice_need_minsides_maxsides_sides: "{{src}}": dice need {{minSides}}–{{maxSides}} sides
eng_src_cant_keep_n_of_count_dice: "{{src}}": can't keep {{n}} of {{count}} dice
eng_src_isnt_valid_dice_notation_try_d20: "{{src}}" isn't valid dice notation (try d20, 2d6, d100, 4d6kh3)
eng_src_has_no_dice_in_it: "{{src}}" has no dice in it
eng_this_expression_is_too_large_to_compute: This expression is too large to compute exact odds for
eng_vcount_items: {{vCount}} item{{^if_length}}s{{/if_length}}
eng_xp_xplabel_top_level: {{xp}} {{xpLabel}} · top level
eng_the_ruleset_must_be_an_object: The ruleset must be an object.
eng_a_sheet_is_a_list_of_sections: A sheet is a list of sections.
eng_a_sheet_has_at_most_sections_sections: A sheet has at most {{sections}} sections.
eng_a_section_needs_an_id_a_title: A section needs an id, a title and a list of rows.
eng_a_section_has_at_most_rows_rows: A section has at most {{rows}} rows.
eng_a_row_shows_one_thing_a_field: A row shows one thing: a field, a formula, a pool or a progression.
eng_a_formula_is_at_most_formula_characters: A formula is at most {{formula}} characters.
eng_progressions_are_an_object_by_id: Progressions are an object by id.
eng_a_progression_needs_an_xp_field_and: A progression needs an XP field and a level field.
eng_thresholds_are_a_list_of_xp_amounts: Thresholds are a list of XP amounts, or a data table and column.
eng_a_progression_has_at_most_thresholds_thresholds: A progression has at most {{thresholds}} thresholds.
eng_a_places_id_is_its_key_id: a place's id is its key, {{id}}
eng_a_place_needs_a_name: a place needs a name
eng_a_places_parent_is_the_id_of: a place's parent is the id of a place
eng_a_places_fields_are_an_object: a place's fields are an object
eng_a_places_visibility_is_one_of_visibilities: a place's visibility is one of {{vISIBILITIES}}
eng_a_places_key_is_text: a place's {{key}} is text
eng_a_places_key_is_x_y: a place's {{key}} is {x, y}
eng_a_places_knownby_is_a_selector: a place's knownBy is a selector
eng_a_places_adjudicate_is_true_or_false: a place's adjudicate is true or false
eng_a_places_sources_are_a_list_of: a place's sources are a list of entries
eng_only_a_map_marks_what_it_draws: only a map marks what it draws
eng_a_place_made_in_play_is_changed: a place made in play is changed by place_label and place_remove
eng_a_paths_id_is_its_key_id: a path's id is its key, {{id}}
eng_a_path_joins_two_places_from_and: a path joins two places, from and to
eng_a_path_joins_two_different_places: a path joins two different places
eng_a_path_goes_both_ways_or_one: a path goes both ways or one way (bidirectional is true or false)
eng_a_path_has_at_least_one_way: a path has at least one way of travelling it
eng_mode_is_no_way_of_travelling_travel: {{mode}} is no way of travelling: {{tRAVEL_MODES}}
eng_the_mode_way_takes_some_minutes_above: the {{mode}} way takes some minutes, above 0
eng_the_mode_ways_distance_is_kilometres_above: the {{mode}} way's distance is kilometres, above 0
eng_the_mode_ways_terrain_is_text: the {{mode}} way's terrain is text
eng_that_isnt_a_map: that isn't a map
eng_a_maps_id_is_its_key_id: a map's id is its key, {{id}}
eng_the_map_shows_knowledge_or_fog: the map shows "knowledge" or "fog"
eng_the_grid_systems_settings_are_an_object: the grid system's settings are an object: movement and sightRadius
eng_grid_movement_is_true_or_false: grid movement is true or false
eng_the_sight_radius_is_a_whole_number: the sight radius is a whole number of cells from 0 to {{sIGHT_MAX}}
eng_the_travel_simulation_is_true_or_false: the travel simulation is true or false
eng_travel_times_are_an_object: travel times are an object
eng_it_would_take_away_place_where_the: it would take away {{place}}, where the world starts
eng_name_id_is_at_at_which_it: {{name}} ({{id}}) is at {{at}}, which it would take away
eng_name_id_would_be_inside_parent_which: {{name}} ({{id}}) would be inside {{parent}}, which isn't a place
eng_the_path_id_would_lead_to_from: the path {{id}} would lead to {{from}}, which isn't a place
eng_id_cant_be_inside_itself: {{id}} can't be inside itself
eng_the_map_id_draws_scope_which_isnt: the map {{id}} draws {{scope}}, which isn't a place
eng_ana_label: {{#if_test}}an{{/if_test}}{{^if_test}}a{{/if_test}} {{label}}
eng_def_runs_from_from_name_is_kindphrase: “{{def}}” runs from {{from}}; {{name}} is {{kindPhrase}}
eng_def_runs_to_def2_b_is_b2: “{{def}}” runs to {{def2}}; {{b}} is {{b2}}
eng_name_is_already_def_other_def2_allows: {{name}} is already {{def}} {{other}}; “{{def2}}” allows one at a time
eng_def_runs_to_def2_place_isnt_one: “{{def}}” runs to {{def2}}; {{place}} isn't one
eng_that_place: that place
eng_bought_it: Bought it
eng_given_it_by_from: Given it by {{from}}
eng_given_it: Given it
eng_holding_it_for_owners: Holding it for {{owners}}
eng_holding_it_for_its_owner: Holding it for its owner
eng_borrowing_it_from_from: Borrowing it from {{from}}
eng_borrowing_it: Borrowing it
eng_found_it: Found it
eng_took_it_with_no_right_to_it: Took it, with no right to it
eng_fetched_it: Fetched it
eng_put_away_on_them: Put away on them
eng_had_it_since_it_was_made: Had it since it was made
eng_theirs: Theirs
eng_theirs_presumed_nobody_says_otherwise: Theirs, presumed: nobody says otherwise
eng_may_use_it: May use it
eng_has_it_it_is_owners_s: Has it; it is {{owners}}'s
eng_has_it: Has it
eng_for_a_day: For a day
eng_for_three_days: For three days
eng_for_a_week: For a week
eng_it_isnt_a_thing_in_this_chat: it isn't a thing in this chat
eng_it_is_out_of_the_world: it is out of the world
eng_the_world_has_it_already: the world has it already
eng_the_worlds_draft_has_it_already: the world's draft has it already
eng_name_its_owner_owner_isnt_in_the: {{name}}: its owner {{owner}} isn't in the world, so it is kept as nobody's.
eng_name_where_it_is_kept_home_isnt: {{name}}: where it is kept, {{home}}, isn't in the world, so it rests where it is.
eng_name_type_r_is_left_out_they: {{name}}: {{type}} {{r}} is left out: they aren't in the world.
eng_name_holder_isnt_in_the_world_so: {{name}}: {{holder}} isn't in the world, so it lies {{#if_at}}at {{at}}{{/if_at}}{{^if_at}}nowhere{{/if_at}}.
eng_it_isnt_a_place_made_in_this: it isn't a place made in this chat
eng_a_vehicle_goes_only_on_another_vehicle: a vehicle goes only on another vehicle
eng_too_big_to_carry_big_a_person: too big to carry ({{big}}; a person carries up to {{ceiling}})
eng_it_was_bought_put_it_at_name:  It was bought: put it at {{name}}, where {{buyer}} lives?
eng_put_it_at_name_where_holder_is:  Put it at {{name}}, where {{holder}} is?
eng_too_big_to_carry_delivered_to_the: Too big to carry: delivered to the buyer's home
eng_too_big_to_carry_set_down_where: Too big to carry: set down where they are
eng_name_is_at_name2_now: {{name}} is at {{name2}} now.
eng_onin_holder: {{#if_holder}}on{{/if_holder}}{{^if_holder}}in{{/if_holder}} {{holder}}
eng_one_place_at_a_time: One place at a time
eng_name_is_held_now: {{name}} is {{held}} now.
eng_name_lies_at_lying_now_in_nothing: {{name}} lies at {{lying}} now, in nothing.
eng_lies_at_lying: lies at {{lying}}
eng_is_onin_holder: is {{#if_holder}}on{{/if_holder}}{{^if_holder}}in{{/if_holder}} {{holder}}
eng_is_nowhere: is nowhere
eng_wearer_doesnt_wear_name_now: {{wearer}} doesn't wear {{name}} now.
eng_a_handover_keeps_the_owner: A handover keeps the owner
eng_name_is_from_again_held_by_h: {{name}} is {{from}} again, held by {{h}}.
eng_name_is_from_again: {{name}} is {{from}} again.
eng_both_shared: both {{shared}}
eng_both_at_name: both at {{name}}
eng_made_beside_a_hidden_one_it_may: made beside a hidden one it may be
eng_drop_is_merged_into_keep: {{drop}} is merged into {{keep}}.
eng_took_this_line_out_of: took this line out of
eng_rewrote_this_line_in: rewrote this line in
eng_as_text:  as "{{text}}"
eng_the_last_turns_final_review_how_the: The last turn's final review {{how}} the narrator's {{part}} section{{then}}: "{{line}}". A line the review can't use often means the things it names are wrong.
eng_staff_only: Staff only
eng_members_only: Members only
eng_private: Private
eng_present_of_its_total_pieces: {{present}} of its {{total}} pieces
eng_your_households: your household's
eng_yours_and_others: yours and {{others}}
eng_with_holder: with {{holder}}
eng_names_and_names2_more: {{names}} and {{names2}} more
eng_who_owner_presumed: {{who}} · owner{{presumed}}
eng_who_via_owner: {{who}} · {{via}} owner
eng_fact_isnt_public_and_the_pov_doesnt: {{fact}} isn't public, and the POV doesn't know them
eng_name_is_secret: {{name}} is secret
eng_secret_lore_whose_gate_doesnt_hold: secret lore whose gate doesn't hold
eng_a_track_the_pov_may_not_know: a track the POV may not know of
eng_something_is_going_on: Something is going on
eng_until_it_does_inferred_checks_play_as: Until it does, inferred checks play as unset, by each chat's realism preset.
eng_inferred_checks_are_off_in_this_chat: inferred checks are off in this chat
eng_skill_isnt_a_skill_this_chat_infers: "{{skill}}" isn't a skill this chat infers checks for
eng_the_message_doesnt_say_the_player_character: the message doesn't say the player character tries it
eng_it_isnt_risky_chance_to_succeed_at: it isn't risky ({{chance}}% to succeed at {{band}})
eng_name_is_too_big_to_carry_size: {{name}} is too big to carry ({{size}}), so it is at {{place}} rather than on {{name2}}.
eng_by_let_who_use_item_though_it: {{by}} let {{who}} use {{item}}, though it isn't theirs to lend.
eng_by_let_to_use_what_is_from: {{by}} let {{to}} use what is {{from}}'s, without the say to.
eng_theres_no_life_state_string: there's no life state {{string}}
eng_timelapse_not_run_reason: Timelapse not run: {{reason}}
eng_unknown_revision_revision: unknown revision {{revision}}
eng_def_back_to_start_its_start_since: {{def}}: back to {{#start}}{{start}}{{/start}}{{^start}}its start{{/start}}, since this revision of the world no longer has the stage it was at
eng_split_listcount_postings: {{split}} ({{listCount}} postings)
eng_rule_cascade_stopped_at_its_cap_of: Rule cascade stopped at its cap of {{cap}}.
eng_nothing_better_to_do: nothing better to do
eng_close_closing: close {{closing}}
eng_near_id: near {{id}}
eng_scope_unreadable_missing_id: scope unreadable: {{missing}} {{id}}
reason_was_made_in_play_too_keep: was made in play too: keep it as well
reason_the_world_s_draft_doesn_t: the world's draft doesn't have
reason_name_is_on_name2_too_big: {{name}} is on {{holder}}: too big to carry ({{size}}; a person carries up to {{ceiling}}).
reason_name_is_in_name2_too_big: {{name}} is in {{holder}}: too big for it ({{holder}} takes things up to {{ceiling}}).
reason_name_is_in_around_which: {{name}}: it is in {{around}}, which {{which}}
reason_vehicle_goes_only_on_another: {{name}} is {{#on}}on{{/on}}{{^on}}in{{/on}} {{holder}}: a vehicle goes only on another vehicle.
eng_piece_is_gone: is gone
eng_piece_is_lost: is lost
eng_name_cant_hold_anything: {{name}} can't hold anything
eng_put_away: Put away
eng_holder_holds_thing: {{holder}} holds {{thing}}
eng_its_name: its {{name}}
eng_by_gives_things_to: {{by}} gives things to {{to}}
eng_by_moves: {{by}} moves {{thing}}
eng_track_waits_on: "{{what}}" waits on
eng_the_gate_of_reads: The gate of "{{what}}" reads
eng_track_never_changes: what reads {{it}} in this track never changes, and only the GM's Stage moves the track past {{it}}
eng_gate_never_opens: the gate never opens or closes
eng_an_answer_that_names_none: an answer that names none
eng2_what_happens_took_changed: {{what}} happens{{took}}.{{changed}}
eng2_has_an_item_that_replace: has an item that {{replace}}
eng2_private_possessive: Private: {{possessive}}
eng2_name_you: {{name}} (you)
eng2_is_below_min: is below {{min}}
eng2_is_above_max: is above {{max}}
eng2_is_not_text: is not text
eng2_a_spawn_in_path: A spawn in {{path}}
eng2_basic_need: basic need
eng2_world_info_entry: World Info: {{entry}}
eng2_lore_entry: Lore: {{entry}}
eng2_another_block_of_this_routine_is: another block of this routine is {{blockId}}
eng2_routine_id_block_id2: Routine {{id}}, block {{block}}
eng2_money_rounded: {{money}}, rounded
eng2_the_default_money: the default, {{money}}

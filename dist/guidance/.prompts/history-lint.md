---
description: What a check of a world, a ruleset, a routine, a lore entry, a map, an organization or another part says is wrong, as one line of its problem list, the line a problem lists in Build and the map and routine jobs read. Each is filled with what it names. One line per name, a name, a colon, then its text. A name in double braces puts in what the engine knows of it (an amount in the world's own coin, a name, a number), and a block opened with a hash and closed with a slash shows only when that value is there. Change the words freely. Delete a line and that is not said at all.
format: lines
keys:
  lint_*: what a check of a world, a ruleset, a routine, a lore entry, a map, an organization or another part says is wrong, as one line of its problem list (the line a problem lists in Build and the map and routine jobs read) - each is filled with what it names
---
lint_how_checks_are_decided_must_be_an: How checks are decided must be an object with a preset.
lint_preset_isnt_a_preset_use_narrative_balanced: "{{preset}}" isn't a preset: use narrative, balanced, crunchy or custom.
lint_key_cant_be_given_it_plays_as: {{key}} can't be {{given}}; it plays as {{plays}}.
lint_this_names_the_label_preset_but_sets: This names the {{label}} preset but sets {{listed}} its own way, so it plays as Custom with them. Name it custom to say so, or drop them to play {{label}}.
lint_a_sure_thing_must_start_above_too: A sure thing must start above too hard to try, or no check would ever roll.
lint_no_checks_chance_is_below_0_so: No check's chance is below 0, so no check ever rolls.
lint_checks_roll_only_for_marked_actions_places: Checks roll only for marked actions, places and tracks, and nothing is marked: no check will ever roll.
lint_o_counts_as_a_success_but_no: "{{o}}" counts as a success, but no band of this check reads it.
lint_an_unrolled_check_passes_as_auto_which: An unrolled check passes as "{{auto}}", which no band of this check reads.
lint_this_check_names_no_success_no_success: This check names no success (no success band and no pass list), so the policy can't tell its chance or grant it without a roll: it rolls whenever its action runs (under narrative authority the story decides, and the dice when it can't), and a failed try isn't remembered.
lint_who_isare_double_booked_id_and_id2: {{who}} {{#if_names}}is{{/if_names}}{{^if_names}}are{{/if_names}} double-booked: {{id}} and {{id2}} both set {{target}} at the same time, with the same precedence.
lint_the_id_must_match_its_key: the id must match its key
lint_link_is_not_an_entity_or_place: "{{link}}" is not an entity or place
lint_holder_is_not_an_entity_the_secret: "{{holder}}" is not an entity: the secret is no one's
lint_visibility_isnt_a_lore_visibility_no_helper: "{{visibility}}" isn't a lore visibility: no helper reads the entry
lint_title_is_known_by_whoever_knows_what: "{{title}}" is known by whoever knows what it links, and it links nothing: no helper reads it
lint_secret_is_secret_not_true_or_false: "secret" is {{secret}}, not true or false: "{{title}}" reads as secret until it is one or the other
lint_title_is_public_but_carries_a_secrets: "{{title}}" is public but carries a secret's truth; mark it secret, with a gate, so only the helpers you pick read it
lint_title_isnt_secret_so_it_is_nobodys: "{{title}}" isn't secret, so it is nobody's own: every mind reads it
lint_secret_lore_title_needs_a_gate_it: secret lore "{{title}}" needs a gate: it is revealed only once the gate holds
lint_secret_lore_title_lists_prose_which_never: secret lore "{{title}}" lists {{prose}}, which never read a secret before its gate holds: what those steps write reaches the narrator or the player
lint_a_blank_term_matches_nothing: a blank term matches nothing
lint_lookups_match_this_term_as_matched: lookups match this term as "{{matched}}"
lint_term_leads_to_no_entry: "{{term}}" leads to no entry
lint_id_is_not_a_lore_entry: "{{id}}" is not a lore entry
lint_the_topic_needs_a_label: the topic needs a label
lint_lore_books_are_a_list_of_world: Lore books are a list of World Info book ids; none are read.
lint_not_a_world_info_book_id_it: Not a World Info book id: it is ignored.
lint_this_book_is_listed_twice_it_is: This book is listed twice: it is read once.
lint_lore_pins_are_an_object_of_characters: Lore pins are an object of characters, places and steps; none are read.
lint_key_isnt_part_of_the_lore_pins: "{{key}}" isn't part of the lore pins; nothing reads it.
lint_the_pins_to_part_are_an_object: The pins to {{part}} are an object of lists by id; none are read.
lint_id_is_not_a_step_so_no: "{{id}}" is not a step, so no call reads what is pinned to it.
lint_id_is_not_an_entitya_place_in: "{{id}}" is not {{#if_characters}}an entity{{/if_characters}}{{^if_characters}}a place{{/if_characters}} in the world, so no call reads what is pinned to it.
lint_the_pins_are_a_list_none_are: The pins are a list; none are read.
lint_pin_i_is_none_of_lore_id: Pin {{i}} is none of {"lore": id}, {"book": id, "entry": id} and {"book": id}, so it is ignored.
lint_lore_a_book_entrya_book_is_pinned: {{#if_lore}}"{{lore}}"{{/if_lore}}{{^if_lore}}{{#if_entry}}A book entry{{/if_entry}}{{^if_entry}}A book{{/if_entry}}{{/if_lore}} is pinned here twice; it is read once.
lint_lore_is_not_a_lore_entry_so: "{{lore}}" is not a lore entry, so nothing is pinned.
lint_title_was_written_by_an_indexing_job: "{{title}}" was written by an indexing job and isn't reviewed yet; no call reads it until it is.
lint_title_is_a_secret_that_isnt_name: "{{title}}" is a secret that isn't {{name}}'s own, so their mind never reads it; name them among its holders, or pin something else.
lint_not_a_json_object: not a JSON object
lint_action_reads_like_a_lock_but_this: "{{action}}" reads like a lock, but this requirement isn't marked hard: a typed attempt that misses it plays as plain roleplay, and the reply can tell it working. Mark it a hard lock if the attempt should fail instead.
lint_format_must_be_world_format: format must be {{worldFormat}}
lint_the_pov_entity_pov_does_not_exist: the POV entity "{{pov}}" does not exist
lint_the_start_place_place_does_not_exist: the start place "{{place}}" does not exist
lint_decimals_must_be_a_whole_number_from: decimals must be a whole number from 0 to 6
lint_the_currency_needs_a_display_format: the currency needs a display format
lint_unknown_kind_kind: unknown kind "{{kind}}"
lint_unknown_parent_place_parent: unknown parent place "{{parent}}"
lint_unknown_place_from: unknown place "{{from}}"
lint_label_has_outcomes_other_than_default_but: "{{label}}" has outcomes other than default but no check, so only "default" ever applies
lint_the_wording_of_label_must_be_text: the wording of "{{label}}" must be text
lint_label_is_the_worlds_own_section_so: "{{label}}" is the world's own section, so its own template is used and this wording isn't
lint_s_enabled_is_on_or_off_maxtokens: "{{s}}": enabled is on or off, maxTokens and maxLines are whole numbers from 1, include is a list of sources, scope is player, scene or gm
lint_s_includes_source_which_no_pack_renders: "{{s}}" includes "{{source}}", which no pack renders
lint_s_has_nothing_to_fill_it_no: "{{s}}" has nothing to fill it: no pack renders a section with the id "{{id}}"{{#if_include}} or one it includes{{/if_include}}, so it never goes in
lint_a_purpose_template_cant_produce_output_it: a {{purpose}} template can't produce {{output}}; it would never run
lint_unknown_signal_s: unknown signal "{{s}}"
lint_this_purpose_template_is_blank_it_takes: this {{purpose}} template is blank: it takes the place of the built-in instructions with none
lint_inferred_checks_must_be_an_object_with: Inferred checks must be an object with a mode. {{unset}}
lint_it_names_no_mode_mode_isnt_a: {{#if_mode}}It names no mode{{/if_mode}}{{^if_mode}}"{{mode}}" isn't a mode{{/if_mode}}: use off, suggest or auto. {{unset}}
lint_rolls_a_turn_are_a_whole_number: Rolls a turn are a whole number from {{lo}} to {{hi}}: {{most}} plays as {{most2}}.
lint_the_easiest_band_lowest_is_above_the: The easiest band, {{lowest}}, is above the hardest, {{highest}}: they play swapped, from {{highest}} to {{lowest}}.
lint_s_isnt_a_skills_id_so_its: {{s}} isn't a skill's id, so it's left out.
lint_id_isnt_a_skill_the_worlds_sheet: "{{id}}" isn't a skill the world's sheet has, so no attempt rolls it.
lint_a_guidance_line_holds_at_most_guidance: A guidance line holds at most {{guidance}} characters; this one's {{textCount}} are cut there.
lint_name_s_label_problem_from_name_something: {{name}}'s {{label}} {{problem}}. {{from}} {{#if_ref}}Name something in the world there{{/if_ref}}{{^if_ref}}Give it a value that fits{{/if_ref}}, or define {{label}} on your {{#if_o}}{{mine}}{{/if_o}}{{^if_o}}own{{/if_o}} kind to keep your own.
lint_name_s_type_relation_names_r_which: {{name}}'s {{type}} relation names "{{r}}", which isn't in the world.
lint_schedule_id_s_owner_selector_problem: Schedule {{id}}'s owner selector {{problem}}.
lint_schedule_id_belongs_to_owner_which_is: Schedule {{id}} belongs to "{{owner}}", which is neither an entity, a group nor a kind.
lint_schedule_id_sends_its_owner_to_v: Schedule {{id}} sends its owner to "{{v}}", which isn't a place.
lint_label_s_name_isnt_a_text_parameter: {{label}}'s {{name}} isn't a text parameter, so it never names a row of {{table}}.
lint_label_s_name_names_rows_of_the: {{label}}'s {{name}} names rows of the data table "{{table}}", which this world doesn't have.
lint_label_s_name_says_a_claimed_thing: {{label}}'s {{name}} says a claimed thing appears "{{place}}"; it should be "held" (in the actor's hands) or "here" (where the actor is).
lint_label_s_name_isnt_a_ref_parameter: {{label}}'s {{name}} isn't a ref parameter, so no claimed thing ever fills it.
lint_label_s_name_isnt_a_ref_parameter_2: {{label}}'s {{name}} isn't a ref parameter, so it never pays the outside account "{{outside}}".
lint_label_s_name_isnt_a_ref_parameter_3: {{label}}'s {{name}} isn't a ref parameter, so its selector never applies.
lint_label_s_name_selector_problem: {{label}}'s {{name}} selector {{problem}}.
lint_kind_id_extends_an_unknown_kind_extends: Kind {{id}} extends an unknown kind "{{extends}}".
lint_kind_label_id_lies_over_the_pack: Kind {{label}} ({{id}}) lies over the {{#pack}}{{pack}}{{/pack}}{{^pack}}engine{{/pack}} pack's {{pack2}} but builds on {{#extends}}{{extends}}{{/extends}}{{^extends}}nothing{{/extends}} instead of {{#extends2}}{{extends2}}{{/extends2}}{{^extends2}}nothing{{/extends2}}, so it and every kind built on it lose {{lostCount}} of that kind's fields ({{lost}}{{lost2}}): forms show those values as untyped text and the levels that gate them no longer apply. {{#if_extends}}Set its Extends back to {{extends2}}{{/if_extends}}{{^if_extends}}Clear its Extends{{/if_extends}}, or give the kind its own id.
lint_f_label_nests_under_parent_which_isnt: {{f}}: "{{label}}" nests under "{{parent}}", which isn't one of its values.
lint_f_label_nests_under_itself: {{f}}: "{{label}}" nests under itself.
lint_kind_id_extends_itself: Kind {{id}} extends itself.
lint_name_is_inside_itself: {{name}} is inside itself.
lint_tier_id_needs_a_band_principal_leads: Tier {{id}} needs a band: principal (Leads), supporting or background.
lint_tier_id_has_no_label_so_players: Tier {{id}} has no label, so players see its id.
lint_name_s_tier_tier_isnt_one_of: {{name}}'s tier "{{tier}}" isn't one of the world's tiers.
lint_new_people_would_join_tier_spawntier_which: New people would join tier "{{spawnTier}}", which isn't one of the world's tiers.
lint_the_number_of_people_replies_may_introduce: The number of people replies may introduce must be a whole number from 0 to {{maxSpawnCap}}.
lint_the_number_of_places_what_may_make: The number of places {{what}} may make in play must be a whole number from 0 to {{maxPlaceCap}}.
lint_the_narrators_knowledge_needs_both_parts_knowledge: The narrator's knowledge needs both parts: knowledge "scene" or "pov", and secrets "marked" or "omit". As it is, the world's chats follow each player's Settings.
lint_the_narrators_knowledge_has_no_part_key: The narrator's knowledge has no part "{{key}}", only knowledge and secrets; it is ignored.
lint_a_spawn_in_path_names_tier_tier: A spawn in {{path}} names tier "{{tier}}", which isn't one of the world's tiers; it gets the spawn tier instead.
lint_message_the_spawn_is_refused: {{message}} The spawn is refused.
lint_id_is_a_built_in_life_state: "{{id}}" is a built-in life state; give yours another id.
lint_life_state_id_has_no_label_so: Life state {{id}} has no label, so players see its id.
lint_life_state_id_doesnt_say_how_the: Life state {{id}} doesn't say how the narrator reads it, so it reads "is {{raw}}".
lint_name_starts_in_life_state_life_which: {{name}} starts in life state "{{life}}", which isn't one of the world's.
lint_name_s_starting_life_state_is_known: {{name}}'s starting life state is known to an unknown "{{knower}}".
lint_name_starts_alive_so_who_knows_how: {{name}} starts alive, so who knows how they start changes nothing.
lint_combats_down_rule_names_life_state_downlife: Combat's down rule names life state "{{downLife}}", which isn't one of the world's.
lint_a_life_change_in_path_names_life: A life change in {{path}} names life state "{{to}}", which isn't one of the world's; it is refused.
lint_track_id_belongs_to_an_unknown_owner: Track {{id}} belongs to an unknown "{{owner}}".
lint_track_id_starts_at_an_unknown_stage: Track {{id}} starts at an unknown stage "{{start}}".
lint_stage_sid_of_t_leads_to_an: Stage {{sid}} of {{t}} leads to an unknown stage "{{n}}".
lint_stage_sid_of_t_cant_be_reached: Stage "{{sid}}" of {{t}} can't be reached from its start.
lint_a_condition_in_t_doesnt_parse_message: A condition in {{t}} doesn't parse: {{message}}
lint_a_condition_in_t_names_v_in: A condition in {{t}} names "{{v}}" in {{name}}(), which isn't {{#if_place}}a place{{/if_place}}{{^if_place}}{{#if_entity}}an entity{{/if_entity}}{{^if_entity}}an entity or a place{{/if_entity}}{{/if_place}} of this world, so it never holds.
lint_what_has_visibility_visibility_which_isnt_public: {{what}} has visibility "{{visibility}}", which isn't {{#if_findable}}public, known_by, discoverable or secret{{/if_findable}}{{^if_findable}}public, known_by or secret (discoverable is for places and things){{/if_findable}}; it stays hidden from the player.
lint_what_has_a_known_by_which_only: {{what}} has a Known by, which only counts with {{#if_findable}}known_by or discoverable{{/if_findable}}{{^if_findable}}known_by{{/if_findable}} visibility.
lint_what_s_known_by_names_no_constraint: {{what}}'s Known by names no constraint, or one this engine doesn't read, so it grants nobody.
lint_what_s_known_by_names_id_which: {{what}}'s Known by names "{{id}}", which isn't in the world.
lint_a_posting_in_path_doesnt_balance_it: A posting in {{path}} doesn't balance (it sums to {{sum}}).
lint_a_condition_of_where_id_reads_field: A condition of {{where}} {{id}} reads {{field}}, which {{domain}} level {{level}} doesn't track, so it never changes.
lint_player_claims_should_be_modes_or_modes2: Player claims should be {{modes}} or {{modes2}}; new chats take the player's own setting instead.
lint_player_claims_cap_should_be_true_or: Player claims' cap should be true or false; anything else reads as off.
lint_name_is_for_an_effects_arguments: {{name}}() works only in an effect's arguments (a "=" formula there). Here it would make shown odds and what the engine reads change on their own, so it reads as nothing.
lint_name_reads_the_data_table_id_which: {{name}}() reads the data table "{{id}}", which this world doesn't have.
lint_the_data_table_id_has_no_column: The data table "{{id}}" has no column "{{column}}".
lint_the_data_table_id_has_no_row: The data table "{{id}}" has no row "{{key}}"; the read gives nothing.
lint_dice_cant_be_rolled_with_exact_odds: "{{dice}}" can't be rolled with exact odds: {{message}}
lint_this_formula_doesnt_parse_message: This formula doesn't parse: {{message}}
lint_natural_bands_read_one_kept_die_but: Natural bands read one kept die, but "{{dice}}" doesn't start with one (use d20, 2d20kh1 or 2d20kl1).
lint_advantage_adds_a_natural_die_but_dice: Advantage adds a natural die, but "{{dice}}" doesn't start with one (use d20, d100, 2d20kh1…).
lint_margin_bands_measure_from_a_dc_and: Margin bands measure from a DC, and this check has neither a dc nor an opponent.
lint_with_no_bands_and_no_dc_every: With no bands and no DC every roll reads none.
lint_an_opponent_rolls_a_check_rolls_this: An opponent rolls a check, rolls this check's dice with a modifier, or has a passive score: give one of check, modifier and passive.
lint_the_opponents_check_check_doesnt_exist: The opponent's check "{{check}}" doesn't exist.
lint_the_opponents_passive_score_is_the_dc: The opponent's passive score is the DC, so dc is never read.
lint_the_opponent_is_who_which_isnt_one: The opponent is "{{who}}", which isn't one of this action's people ({{#if_opponents}}{{opponents}}{{/if_opponents}}{{^if_opponents}}it names none{{/if_opponents}}).
lint_label_rolls_the_check_check_which_doesnt: "{{label}}" rolls the check "{{check}}", which doesn't exist.
lint_label_rolls_an_opposed_check_against_who: "{{label}}" rolls an opposed check against "{{#who}}{{who}}{{/who}}{{^who}}target{{/who}}", which isn't one of its people.
lint_this_check_effect_rolls_c_which_doesnt: This check effect rolls "{{c}}", which doesn't exist.
lint_this_check_effect_has_no_outcomes_so: This check effect has no outcomes, so its roll changes nothing.
lint_this_award_names_the_progression_progression_which: This award names the progression "{{progression}}", which the ruleset doesn't define.
lint_label_s_name_pool_needs_a_max: {{label}}'s {{name}} pool needs a max: a field or a formula.
lint_label_s_name_is_a_pool_so: {{label}}'s {{name}} is a pool, so it must be a number field.
lint_label_s_name_cant_be_its_own: {{label}}'s {{name}} can't be its own max.
lint_label_s_name_takes_its_max_from: {{label}}'s {{name}} takes its max from {{max}}, which isn't a number field.
lint_label_is_a_combat_action_so_it: "{{label}}" is a combat action, so it needs a cost: budget → how many, {} when it's free.
lint_label_is_a_combat_action_but_this: "{{label}}" is a combat action, but this world's ruleset has no combat, so it's never offered.
lint_a_cost_is_a_whole_number_of: A cost is a whole number of a budget, 0 or more.
lint_label_spends_budget_which_the_action_economy: "{{label}}" spends "{{budget}}", which the action economy doesn't have.
lint_a_combat_actions_role_is_attack_or: A combat action's role is attack or defend.
lint_whether_it_starts_a_fight_is_yes: Whether it starts a fight is yes or no.
lint_the_initiative_check_init_doesnt_exist: The initiative check "{{init}}" doesn't exist.
lint_a_fight_needs_an_initiative_check_a: A fight needs an initiative check: a check's id, or a check of its own.
lint_a_fight_needs_an_action_economy_at: A fight needs an action economy: at least one budget, such as action.
lint_a_budget_has_a_label_a_count: A budget has a label, a count and when it refills.
lint_a_budget_needs_a_label_the_palette: A budget needs a label: the palette and the Encounter card show it.
lint_a_budget_refills_each_turn_or_each: A budget refills each turn or each round.
lint_a_budgets_count_is_a_number_of: A budget's count is a number of 0 or more, or a formula.
lint_a_fight_needs_the_hp_field_a: A fight needs the HP field: a pool on the kind of those who fight.
lint_the_point_of_views_kind_has_no: The point of view's kind has no field {{hp}}.
lint_hp_isnt_a_pool_so_damage_has: {{hp}} isn't a pool, so damage has no floor and HP shows no max.
lint_a_stalemate_is_a_whole_number_of: A stalemate is a whole number of rounds, 0 or more: that many rounds in a row with no attack and no one hurt end a fight, and 0 never does.
lint_the_povs_turn_ends_once_its_spent: The POV's turn ends once it's spent, or only on End turn (manual).
lint_a_fights_checks_are_settled_by_the: A fight's checks are settled by the dice, or by the adjudication policy (policy).
lint_fights_follow_the_policy_and_its_retry: Fights follow the policy, and its retry rule refuses the same attack after a miss until a new scene: a missed attack can't be tried again in the same fight.
lint_others_hp_shows_as_wounds_or_as: Others' HP shows as wounds or as exact numbers.
lint_wounds_are_bands_with_labels_over_the: Wounds are bands with labels over the HP left, in percent.
lint_this_worlds_fights_read_stat_modifiers_which: This world's fights read stat modifiers, which are 0 below Sheets 3: a Sheets 3 floor makes them count under any realism.
lint_combat_must_be_an_object: Combat must be an object.
lint_the_ruleset_must_be_an_object: The ruleset must be an object.
lint_level_floors_must_be_an_object_of: Level floors must be an object of domain levels.
lint_domain_isnt_a_realism_domain: "{{domain}}" isn't a realism domain.
lint_a_level_floor_is_a_whole_number: A level floor is a whole number from 0 to 4.
lint_the_realism_defaults_put_domain_at_known: The realism defaults put {{domain}} at {{known}}; this ruleset plays it at {{level}}.
lint_progressions_must_be_an_object_keyed_by: Progressions must be an object keyed by id.
lint_a_progression_needs_an_xp_field_and: A progression needs an XP field and a level field.
lint_a_progression_needs_a_label_the_sheet: A progression needs a label: the sheet and the Journal show it.
lint_xp_and_the_level_need_two_different: XP and the level need two different fields.
lint_the_kind_kind_doesnt_exist: The kind "{{kind}}" doesn't exist.
lint_no_kind_has_both_xpfield_and_levelfield: No kind has both {{xpField}} and {{levelField}}, so this progression applies to no one.
lint_the_kind_k_has_no_field_field: The kind {{k}} has no field {{field}}.
lint_field_must_be_a_number_field: {{field}} must be a number field.
lint_field_is_derived_so_the_engine_cant: {{field}} is derived, so the engine can't set it.
lint_thresholds_are_a_list_of_xp_amounts: Thresholds are a list of XP amounts, one per level from level 1.
lint_the_data_table_table_doesnt_exist: The data table "{{table}}" doesn't exist.
lint_thresholds_are_a_list_of_xp_amounts_2: Thresholds are a list of XP amounts, or a data table and column.
lint_thresholds_must_rise_level_by_level: Thresholds must rise level by level.
lint_the_top_level_is_a_whole_number: The top level is a whole number of at least 1.
lint_onlevel_is_a_list_of_effects: onLevel is a list of effects.
lint_name_is_at_name2_level_but_xp: {{name}} is at {{name2}} {{level}}, but {{xp}} {{xpLabel}} reaches {{name2}} {{reached}}. The level follows {{xpLabel}}, so it becomes {{name2}} {{reached}} when their {{xpLabel}} next changes: {{#if_needs}}give them {{needs}} {{xpLabel}} for {{name2}} {{level}}, or {{/if_needs}}set the level to {{reached}}.
lint_a_sheet_is_a_list_of_sections: A sheet is a list of sections.
lint_a_section_needs_an_id_and_a: A section needs an id and a list of rows.
lint_two_sections_share_the_id_id: Two sections share the id "{{id}}".
lint_a_section_needs_a_label_to_show: A section needs a label to show as its title.
lint_a_row_shows_one_thing_a_field: A row shows one thing: a field, a formula, a pool or a progression.
lint_pool_isnt_a_pool_on_the_point: {{pool}} isn't a pool on the point of view's kind.
lint_the_progression_progression_doesnt_exist: The progression "{{progression}}" doesn't exist.
lint_a_formula_row_needs_a_label: A formula row needs a label.
lint_relation_def_s_inverse_inverse_isnt_a: Relation {{def}}'s inverse "{{inverse}}" isn't a relation type.
lint_name_s_def_link_needs_from_on: {{name}}'s “{{def}}” link needs {{from}} on {{name}}'s side; {{name}} is {{kindPhrase}}.
lint_name_s_def_link_to_r_needs: {{name}}'s “{{def}}” link to {{r}} needs {{def2}} at the other end; {{r}} is {{#if_target}}{{target}}{{/if_target}}{{^if_target}}a place{{/if_target}}.
lint_name_is_def_name2_but_name2_has: {{name}} is {{def}} {{name2}}, but {{name2}} has no “{{backLabel}}” link back to {{name}}; a chat adds it when it starts.
lint_stream_name_problem: Stream {{name}} {{problem}}.
lint_stream_name_is_a_royalty_which_pays: Stream {{name}} is a royalty, which pays once a month (each month's first payment pays the production of {{lag_months}} months before); set it to every month.
lint_name_names_no_party_that_runs_it: {{name}} names no party that runs it{{#if_org}} (there's no {{org}}){{/if_org}}.
lint_name_has_no_steps_it_can_run: {{name}} has no steps it can run.
lint_stepscount_of_name_s_steps_dont_read: {{stepsCount}} of {{name}}'s steps don't read (each needs an id, a name, whole days or business days, not both) or repeat an id; they're left out.
lint_name_name2_comes_after_a_which_isnt: {{name}}: {{name2}} comes after "{{a}}", which isn't one of its steps; it doesn't wait for it.
lint_name_s_steps_wait_on_each_other: {{name}}'s steps wait on each other in a ring, so none of them can start.
lint_name_capitalizes_steps_but_makes_nothing_so: {{name}} capitalizes steps but makes nothing, so their costs are expensed.
lint_name_name2_starts_the_flow_flow_which: {{name}}: {{name2}} starts the flow {{flow}}, which the world doesn't have.
lint_name_name2_sets_a_field_of_entity: {{name}}: {{name2}} sets a field of {{entity}}, which the world doesn't have.
lint_name_names_the_template_template_which_the: {{name}} names the template {{template}}, which the world's project templates don't have; its own steps run.
lint_holding_name_names_asset_asset_which_the: Holding {{name}} names asset "{{asset}}", which the economy's assets don't list.
lint_holding_name_sits_in_account_which_isnt: Holding {{name}} sits in {{account}}, which isn't an account.
lint_holding_name_sits_in_no_account_and: Holding {{name}} sits in no account and has no owners.
lint_holding_name_s_lots_are_a_list: Holding {{name}}'s lots are a list of {qty, cost, at}.
lint_holding_name_routes_its_payouts_to_route: Holding {{name}} routes its payouts to {{route}}, which isn't an account; they go to its account instead.
lint_name_is_an_s_corporation_but_name2: {{name}} is an S corporation, but {{name2}} can't hold its shares: an S corporation's shareholders are people, eligible trusts (a grantor trust, or one whose beneficiaries are all people) and charities (501(c)(3) organizations). Make it a C corporation, or move {{name2}}'s share to someone who may hold it.
lint_name_is_an_s_corporation_with_holderscount: {{name}} is an S corporation with {{holdersCount}} shareholders: it may have at most {{max}}.
lint_asset_id_needs_a_class_asset_classes: Asset {{id}} needs a class ({{assetClasses}}).
lint_option_id_names_no_underlying_asset_the: Option {{id}} names no underlying asset the world lists.
lint_option_id_needs_a_strike_above_zero: Option {{id}} needs a strike above zero.
lint_option_id_needs_an_expiry_date_yyyy: Option {{id}} needs an expiry date (YYYY-MM-DD).
lint_option_id_is_a_call_or_a: Option {{id}} is a call or a put.
lint_bond_id_has_a_face_value_but: Bond {{id}} has a face value but no maturity date (YYYY-MM-DD).
lint_asset_id_follows_model_which_the_finance: Asset {{id}} follows {{model}}, which the finance table doesn't list; it takes its class's model.
lint_asset_id_needs_a_price_above_zero: Asset {{id}} needs a price above zero.
lint_invoice_name_isnt_from_a_business: Invoice {{name}} isn't from a business.
lint_invoice_name_bills_nobody: Invoice {{name}} bills nobody.
lint_invoice_name_needs_an_amount: Invoice {{name}} needs an amount.
lint_name_trades_at_a_place_that_doesnt: {{name}} trades at a place that doesn't exist: {{p}}.
lint_name_s_operating_account_doesnt_exist: {{name}}'s operating account doesn't exist.
lint_name_s_margin_must_be_a_percentage: {{name}}'s margin must be a percentage from 0 to 100.
lint_name_holds_no_bank_account_so_why: {{name}} holds no bank account, so {{why}}. Open one for it?
lint_account_name_s_note_note_isnt_a: Account {{name}}'s note "{{note}}" isn't a loan made to it.
lint_loan_made_name_names_no_loan_that: Loan made {{name}} names no loan that owes it.
lint_name_s_listing_needs_its_asset_and: {{name}}'s listing needs its asset and its float, a whole number of units.
lint_name_is_listed_so_its_owners_hold: {{name}} is listed, so its owners hold their shares in units.
lint_name_is_listed_but_isnt_a_c: {{name}} is listed but isn't a C corporation; only a C corporation lists in play.
lint_name_trades_as_asset_which_is_one: {{name}} trades as {{asset}}, which is one of the world's own assets.
lint_property_name_s_useful_life_must_be: Property {{name}}'s useful life must be a month or more.
lint_property_name_has_a_cost_and_a: Property {{name}} has a cost and a life but no in-service date, so it never depreciates.
lint_property_name_s_salvage_value_is_no: Property {{name}}'s salvage value is no less than its cost, so it never depreciates.
lint_property_name_is_at_place_which_isnt: Property {{name}} is at "{{place}}", which isn't a place.
lint_property_name_has_no_value_so_it: Property {{name}} has no value, so it adds nothing to anyone's worth and costs nothing to keep.
lint_property_name_names_owner_party_who_isnt: Property {{name}} names owner "{{party}}", who isn't in the world.
lint_property_name_s_mortgage_mortgage_isnt_an: Property {{name}}'s mortgage "{{mortgage}}" isn't an account.
lint_property_name_s_mortgage_name2_isnt_secured: Property {{name}}'s mortgage {{name2}} isn't secured by it (its secured_by names {{#secured_by}}{{secured_by}}{{/secured_by}}{{^secured_by}}nothing{{/secured_by}}).
lint_property_name_is_let_to_outside_tenants: Property {{name}} is let to outside tenants but has no market rent, so it lets nothing.
lint_property_name_s_rent_goes_to_rentto: Property {{name}}'s rent goes to "{{rentTo}}", which isn't an account; it goes to the owners' accounts instead.
lint_lease_name_on_name2_has_an_end: Lease {{name}} on {{name2}} has an end that isn't a date (YYYY-MM-DD).
lint_account_name_has_no_owners: Account {{name}} has no owners.
lint_account_name_s_owner_party_isnt_someone: Account {{name}}'s owner "{{party}}" isn't someone in the world.
lint_account_name_s_owner_i_has_no: Account {{name}}'s owner {{i}} has no role the engine knows; it reads as owner.
lint_account_name_names_a_product_product_thats: Account {{name}} names a product "{{product}}" that's neither the world's nor a class.
lint_account_name_has_no_product: Account {{name}} has no product.
lint_account_name_s_field_names_v_which: Account {{name}}'s {{field}} names "{{v}}", which isn't in the world.
lint_account_name_is_a_cls_opened_in: Account {{name}} is a {{cls}} opened in credit by {{owed}}: what's owed on it is a negative opening, so as written it owes nothing and closes as paid off at its first bill.
lint_loan_name_sets_no_due_day_payment: Loan {{name}} sets no due day, payment or months left: it bills on its product's statement day, paying it off over its product's term, or all at its first bill where the product sets no term.
lint_product_id_has_no_class_the_engine: Product {{id}} has no class the engine knows.
lint_theres_no_money_feature_key_the_toggle: There's no money feature "{{key}}"; the toggle does nothing.
lint_card_name_isnt_on_an_account: Card {{name}} isn't on an account.
lint_card_name_s_holder_doesnt_hold_name2: Card {{name}}'s holder doesn't hold {{name2}}.
lint_card_name_s_gear_card_item_isnt: Card {{name}}'s gear card "{{item}}" isn't in the world.
lint_flow_name_has_no_side: Flow {{name}} has no "{{side}}".
lint_flow_name_s_side_v_names_no: Flow {{name}}'s {{side}} "{{v}}" names no entity; it's read as an outside party by that name.
lint_flow_name_has_no_amount: Flow {{name}} has no amount.
lint_flow_name_has_no_schedule_give_it: Flow {{name}} has no schedule: give it "every" or "once".
lint_flow_name_belongs_to_link_which_isnt: Flow {{name}} belongs to "{{link}}", which isn't in the world.
lint_flow_name_s_fallback_fallback_isnt_in: Flow {{name}}'s fallback "{{fallback}}" isn't in the world; a fallback is an account of the payer's.
lint_job_name_s_employer_employer_names_no: Job {{name}}'s employer "{{employer}}" names no one and no place; it's read as an outside employer by that name.
lint_job_name_pays_a_rate_of_nothing: Job {{name}} pays a rate of nothing, so it runs a payroll of empty paydays. Make it an unpaid title?
lint_the_narrated_price_cap_should_be_a: The narrated-price cap should be a whole number of {{currency}} above zero; narrated prices are capped at {{fallback}}.
lint_the_claim_cap_should_be_a_whole: The claim cap should be a whole number of {{currency}} above zero; a capped Make it real asks first above {{fallback}}.
lint_the_minds_config_is_an_object_secrecy: The minds config is an object (secrecy, weights, thresholds, always, never, memory, holdings); the defaults play instead.
lint_key_isnt_part_of_the_minds_config: "{{key}}" isn't part of the minds config; nothing reads it.
lint_secrecy_is_full_the_narrator_gets_each: Secrecy is "full" (the narrator gets each mind to depict) or "brief" (a leak-checked depiction only); "full", the default, plays instead.
lint_a_whole_numbera_number_from_lo_to: {{#if_whole}}A whole number{{/if_whole}}{{^if_whole}}A number{{/if_whole}} from {{lo}} to {{hi}}; the default plays instead.
lint_the_weights_are_an_object_of_points: The weights are an object of points by input; the defaults play instead.
lint_the_band_weights_are_an_object_principal: The band weights are an object: principal, supporting and background.
lint_the_role_weights_are_an_object_of: The role weights are an object of points by classification value.
lint_no_classification_of_this_world_has_a: No classification of this world has a value "{{value}}", so this weight never counts.
lint_key_isnt_a_focus_input_nothing_reads: "{{key}}" isn't a focus input; nothing reads it.
lint_the_thresholds_are_an_object_live_near: The thresholds are an object: live, near and far.
lint_live_is_below_near_live_plays_at: Live is below Near: Live plays at Near's threshold.
lint_near_is_below_far_near_plays_at: Near is below Far: Near plays at Far's threshold.
lint_key_is_a_selector_or_null: "{{key}}" is a selector or null.
lint_an_empty_selector_here_pins_no_one: An empty selector here pins no one; leave "{{key}}" out instead.
lint_the_key_selector_problem: The "{{key}}" selector {{problem}}.
lint_the_memory_defaults_are_an_object_the: The memory defaults are an object; the built-in defaults play instead.
lint_part_isnt_a_memory_layer_nothing_reads: "{{part}}" isn't a memory layer; nothing reads it.
lint_the_part_settings_are_an_object: The {{part}} settings are an object.
lint_key_isnt_a_part_setting_nothing_reads: "{{key}}" isn't a {{part}} setting; nothing reads it.
lint_on_true_or_off_false_the_default: On (true) or off (false); the default plays instead.
lint_what_people_hold_from_the_start_is: What people hold from the start is an object of facts by person; no one holds anything from the start instead.
lint_the_world_has_no_one_who_so: The world has no one "{{who}}", so these holdings are never read.
lint_who_isnt_a_person_so_these_holdings: {{who}} isn't a person, so these holdings are never read.
lint_each_persons_holdings_are_an_object_of: Each person's holdings are an object of facts by id; they hold nothing from the start instead.
lint_a_fact_held_from_the_start_is: A fact held from the start is lore:<entry>, track:<track>:<stage> or field:<entity>:<field>; this one is left out.
lint_missing_the_holding_seeds_a_fact_nothing: {{missing}} The holding seeds a fact nothing refers to.
lint_a_holding_is_an_object_belief_confidence: A holding is an object (belief, confidence, keptFrom); this one is left out.
lint_key_isnt_part_of_a_holding_nothing: "{{key}}" isn't part of a holding; nothing reads it.
lint_a_belief_is_true_false_or_uncertain: A belief is "true", "false" or "uncertain"; "true" plays instead.
lint_a_confidence_is_a_number_from_0: A confidence is a number from 0 to 1; 1 plays instead.
lint_whom_it_is_kept_from_is_everyone: Whom it is kept from is "everyone" or a list of people; it is kept from no one instead.
lint_no_one_keeps_a_fact_from_themselves: No one keeps a fact from themselves; that name is passed over.
lint_id_isnt_a_person_in_the_world: "{{id}}" isn't a person in the world; that name is passed over.
lint_minds_run_on_their_own_cadence_settings: Minds run on their own cadence (Settings → Minds), so a {{purpose}} template's signals are ignored.
lint_this_purpose_template_is_blank_so_it: This {{purpose}} template is blank, so it is skipped{{#if_used}} and "{{id}}" is used{{/if_used}}.
lint_the_world_has_another_purpose_template_id: The world has another {{purpose}} template ("{{id}}"); only that one, the first by id with any text, is used.
lint_bad_calendar: bad calendar
lint_schedule_id_has_a_bad_time_t: Schedule {{id}} has a bad time "{{t}}" (use HH:MM).
lint_schedule_id_names_weekday_wd_weekdays_are: Schedule {{id}} names weekday {{wd}}; weekdays are 0 (Sunday) to 6.
lint_the_timelapse_unit_cap_agentdays_agent_days: The timelapse unit cap ({{agentDays}} agent-days) is smaller than one schedule step for the {{agents}} people who live their own day plus the POV ({{min}}).
lint_name_s_s_v_is_outside_min: {{name}}'s {{s}} {{v}} is outside {{min}}–{{max}}.
lint_name_s_cues_should_be_a_list: {{name}}'s cues should be a list.
lint_name_isnt_a_person_so_its_cues: {{name}} isn't a person, so its cues never show: the Stance section tells people.
lint_a_cue_of_name_s_has_no: A cue of {{name}}'s has no text: say what the narrator sees them do.
lint_name_s_cue_text_needs_exactly_one: {{name}}'s cue "{{text}}" needs exactly one secret it stands for: a lore entry, a track or a story flag.
lint_name_s_cue_text_is_for_lore: {{name}}'s cue "{{text}}" is for lore "{{id}}", which this world doesn't have.
lint_name_s_cue_text_is_for_title: {{name}}'s cue "{{text}}" is for "{{title}}", which isn't secret lore, so it never shows.
lint_name_s_cue_text_is_for_track: {{name}}'s cue "{{text}}" is for track "{{id}}", which this world doesn't have.
lint_name_s_cue_text_is_for_track_2: {{name}}'s cue "{{text}}" is for "{{track}}", a public track with no truth to reveal, so it never shows.
lint_name_s_cue_text_gives_away_a: {{name}}'s cue "{{text}}" gives away a secret ("{{secret}}"): a cue says how they act, never what they hide.
lint_name_s_cue_text_names_name2_which: {{name}}'s cue "{{text}}" names "{{name2}}", which the player may not know; it is left out while they don't.
lint_the_cue_of_t_at_s_gives: The cue of "{{t}}" at "{{s}}" gives away a secret ("{{name}}"): a cue says how someone acts, never who or what is hidden.
lint_the_cue_of_t_at_s_names: The cue of "{{t}}" at "{{s}}" names "{{name}}", which the player may not know; {{name2}}'s Stance leaves it out while they don't.
lint_routine_id_message: Routine {{id}}: {{message}}.
lint_routine_id_block_i_message: Routine {{id}}, block {{i}}: {{message}}.
lint_routine_settings_have_no_key_it_does: Routine settings have no {{key}}; it does nothing.
lint_routine_settings_key_is_true_or_false: Routine settings: {{key}} is true or false; the default stands.
lint_routine_settings_key_give_live_near_far: Routine settings: {{key}} give live, near, far and background each one of {{levels}}; the defaults stand.
lint_routine_settings_key_have_no_level_it: Routine settings: {{key}} have no {{level}}; it does nothing.
lint_routine_settings_key_level_is_levels_the: Routine settings: {{key}}.{{level}} is {{levels}}; the default stands.
lint_routine_settings_key_is_allowed_the_default: Routine settings: {{key}} is {{allowed}}; the default stands.
lint_the_world_has_routines_but_not_the: The world has routines but not the Cast life pack, which lives them.
lint_routines_first_and_id_both_set_id2: Routines {{first}} and {{id}} both set {{id2}} for {{who}} at the same precedence; {{first}} wins.
lint_name_rests_on_lore_entry_entry_which: {{name}} rests on lore entry {{entry}}, which the world doesn't have.
lint_name_rests_on_entity_s_sheet_who: {{name}} rests on {{entity}}'s sheet, who isn't in the world.
lint_schedule_id_s_owner_matches_nobody_as: Schedule {{id}}'s owner matches nobody as a chat starts, so it moves no one.
lint_schedule_id_slot_i_its_times_are: Schedule {{id}}, slot {{i}}: its times are HH:MM.
lint_needs_settings_message_the_engine_reads_it: Needs settings: {{message}}; the engine reads it as its default.
lint_name_s_alert_alert_is_below_the: {{name}}'s alert ({{alert}}) is below the point the narrator is told of it ({{tell}}): a skip may stop for it before the story ever mentions it.
lint_name_s_birthday_doesnt_read_as_a: {{name}}'s birthday doesn't read as a date of the world's calendar: write it MM-DD, or YYYY-MM-DD with the year they were born.
lint_name_is_double_booked_label_and_b: {{name}} is double-booked: {{label}} and {{b}} overlap.
lint_name_is_double_booked_label_falls_in: {{name}} is double-booked: {{label}} falls in {{id}}.
lint_name_lies_at_place_and_is_in: {{name}} lies at {{place}} and is in {{holder}} at once; play reads it at {{place}}.{{#if_fix}} Keep it there?{{/if_fix}}
lint_why_put_it_at_placename: {{why}}{{#if_to}} Put it at {{placeName}}?{{/if_to}}
lint_name_has_no_size_and_nothing_gives: {{name}} has no size, and nothing gives one (its type, volume or category), so play treats it as portable. Give it a size on its page.
lint_name_names_an_unknown_kit_kit: {{name}} names an unknown kit {{kit}}.
lint_kind_kinds_kind_holds_things_in_this: Kind {{kinds}} ({{kind}}) holds things in this world ({{why}}) but isn't a container, a vehicle or a person, so a transfer, a gift or a GM's Put inside into it is refused. Set its Extends to container, or to a kind built on one.
lint_kind_kinds_kind_is_moved_in_this: Kind {{kinds}} ({{kind}}) is moved in this world ({{why}}) but isn't built on Item (nor is it a person, a vehicle or a cash account), so nothing can take it, give it or put it in anything: Take never offers it, and a transfer, a gift or a GM's Put inside of it is refused. Set its Extends to item, or to a kind built on one.
lint_everyday_carry_names_type_which_no_catalog: Everyday carry names {{type}}, which no catalog of this world has (gear items, containers or the price catalog), so no one is made one.
lint_org_s_position_id_names_a_power: {{org}}'s position {{id}} names a power "{{power}}" there is none of.
lint_org_s_title_reports_to_reports_to: {{org}}'s {{title}} reports to "{{reports_to}}", a position {{org}} doesn't define.
lint_org_s_title_reports_up_the_line: {{org}}'s {{title}} reports, up the line, to itself.
lint_org_s_title_has_seats_seats_and: {{org}}'s {{title}} has {{seats}} seat{{^if_seats}}s{{/if_seats}} and {{holders}} holders.
lint_name_holds_position_in_r_which_defines: {{name}} holds "{{position}}" in {{r}}, which defines no such position.
lint_name_is_in_the_position_position_which: {{name}} is in the position "{{position}}", which {{#if_employer}}{{employer}}{{/if_employer}}{{^if_employer}}its employer{{/if_employer}} doesn't define.
lint_id_acts_for_r_with_a_power: {{id}} acts for {{r}} with a power "{{p}}" there is none of.
lint_by_lets_id_lacking_for_r_which: {{by}} lets {{id}} {{lacking}} for {{r}}, which {{by}} may not do.
lint_id_s_owners_count_units_but_off: {{id}}'s owners count units, but {{off}}'s share isn't their units over all {{total}}.
lint_name_passes_its_profit_through_to_its: {{name}} passes its profit through to its owners, and {{who}} {{#if_one}}pays{{/if_one}}{{^if_one}}pay{{/if_one}} no income tax on {{#if_one}}its share{{/if_one}}{{^if_one}}their shares{{/if_one}}, so no one does: only people, trusts and C corporations pay it.
lint_name_s_tax_exempt_status_status_isnt: {{name}}'s tax-exempt status "{{status}}" isn't one of the world's ({{#if_known}}{{known}}{{/if_known}}{{^if_known}}its tables hold none: take the Data update{{/if_known}}).
lint_name_is_a_type_which_cant_be: {{name}} is a {{type}}, which can't be exempt from income tax: only a company, a group or a trust can.
lint_name_is_exempt_as_string_but_owners: {{name}} is exempt as {{string}}, but {{owners}} {{#if_owners}}holds a share{{/if_owners}}{{^if_owners}}hold shares{{/if_owners}} of its worth: an exempt organization pays no one its profit, and no one is taxed on it.
lint_name_is_a_company_group_with_owners: {{name}} is a company group with owners or staff: make it a business, so its money, payroll and ownership run.
lint_head_heads_name_by_the_title_head: {{head}} heads {{name}} by the title "head"; a Head position would say what that lets them do.
lint_id_trades_at_name_which_takes_in: {{id}} trades at {{name}}, which takes in other buildings ({{others}}{{others2}}): a purchase counts as its sale only in its own building or site. Name the buildings it trades in.
lint_name_s_entry_is_entry_not_one: {{name}}'s entry is {{entry}}, not one of {{audiences}}: it is read as unset.
lint_name_s_keys_arent_a_list_of: {{name}}'s keys aren't a list of item ids or item types, so no one carries one.
lint_name_has_no_known_vehicle_class_fuel: {{name}} has no known vehicle class; fuel and range can't be computed.
lint_climate_key_month_m_is_covered_coveredcount: Climate {{key}}: month {{m}} is covered {{coveredCount}} times.
lint_climate_key_s_unknown_state_id: Climate {{key}}, {{s}}: unknown state {{id}}.
lint_name_s_regard_toward_rel_names_an: {{name}}'s regard toward {{rel}} names an unknown axis {{k}}.
lint_text_gives_away_a_secret_secret: "{{text}}" gives away a secret ("{{secret}}").
lint_this_answers_track_is_a_formula_track: This answer's track is a formula ({{track}}), but track takes a puzzle's own id as written, such as "p_safe": the puzzle the formula gives is answered even when the player can't see it. To let the player say which puzzle, pass their words as puzzle instead.
lint_reads_the_story_flags_list_but_nothing: {{reads}} the story flag{{#if_many}}s{{/if_many}} {{list}}, but nothing in this world sets {{it}}: no rule, action or stage effect does, and the GM view has no flag control. {{#if_many}}They keep their{{/if_many}}{{^if_many}}It keeps its{{/if_many}} starting value for good, so {{so}}. Set {{it}} with a story.flag effect where the story makes {{it}} true.
lint_what_wasnt_read_error: {{what}} wasn't read: {{error}}
lint_should_be_one_map_object: should be one map object
lint_the_patch_must_leave_a_world_document: the patch must leave a world document
lint_a_patch_cant_change_part: a patch can't change /{{part}}
lint_name_id_is_drawn_by_the_map: {{name}} {{id}} is drawn by the map {{from}}; edit it there
lint_only_a_map_marks_what_it_draws: only a map marks what it draws (map)
lint_name_ids_are_1_to_200_characters: {{name}} ids are 1 to 200 characters long; this one is {{length}}
lint_review_this_macro_before_playing_macro: Review this macro before playing: {{macro}}
lint_the_id_should_be_key_the_maps: the id should be "{{key}}", the map's key in the world
lint_theres_no_place_scope_for_the_map: there's no place "{{scope}}" for the map to draw
lint_scope_is_one_of_this_maps_own: "{{scope}}" is one of this map's own places; a map draws the inside of another place
lint_id_is_listed_twice: "{{id}}" is listed twice
lint_the_map_made_already_has_a_place: the map "{{made}}" already has a place "{{id}}"
lint_the_world_already_has_a_place_id: the world already has a place "{{id}}" ({{name}}); give this one another id
lint_theres_no_map_opens: there's no map "{{opens}}"
lint_the_map_opens_draws_scope_not_id: the map "{{opens}}" draws "{{scope}}", not "{{id}}"
lint_row_y_is_rowcount_wide_every_row: row {{y}} is {{rowCount}} wide; every row needs the widest's width, {{width}}
lint_the_layout_is_width_height_not_size: the layout is {{width}} × {{height}}, not {{size}} × {{size2}}
lint_ch_isnt_in_the_legend_add_it: "{{ch}}" isn't in the legend: add it, or use # (wall), . (floor), + (door) or a space
lint_place_isnt_one_of_this_maps_places: "{{place}}" isn't one of this map's places
lint_theres_no_item_in_the_world_to: there's no "{{item}}" in the world to lie here
lint_name_starts_inside_something_so_it_wont: {{name}} starts inside something, so it won't lie on the map
lint_name_is_drawn_on_drawn_cells_a: {{name}} is drawn on {{drawn}} cells; a thing lies on one
lint_name_already_lies_on_the_map_id: {{name}} already lies on the map "{{id}}"
lint_the_door_of_place_at_x_y: The door of {{place}} at [{{x}}, {{y}}] touches none of its room: put it on the room's edge
lint_at_at2_is_outside_the_width_height: [{{at}}, {{at2}}] is outside the {{width}} × {{height}} layout
lint_the_world_already_has_a_grid_key: the world already has a grid "{{key}}"; give the map another id
lint_the_map_other_already_draws_name_s: the map "{{other}}" already draws {{name}}'s grid
lint_name_already_has_the_grid_grid_take: {{name}} already has the grid "{{grid}}"; take it off the place for this map to draw its grid
lint_with_the_grid_system_on_people_walk: With the grid system on, people walk {{name}}'s floor plan, and no door or open floor joins {{listed}} to the rest: add a door (+), or give the map links.
lint_at_at2_is_outside_the_w_h: [{{at}}, {{at2}}] is outside the {{w}} × {{h}} map
lint_a_link_joins_two_different_places: a link joins two different places
lint_theres_no_place_end: there's no place "{{end}}"
lint_the_world_already_has_a_route_id: the world already has a route "{{id}}"
lint_with_links_name_s_places_join_only: With links, {{name}}'s places join only where they're linked, and nothing links {{listed}} to the rest: link {{#if_cut}}it{{/if_cut}}{{^if_cut}}them{{/if_cut}} too, or take the links out.
lint_key_must_be_an_object: {{key}} must be an object
lint_each_of_key_must_be_an_object: each of {{key}} must be an object
lint_the_world_needs_an_id: the world needs an id
lint_the_world_needs_a_name: the world needs a name
lint_engineversion_must_be_text: engineVersion must be text
lint_the_world_needs_a_pov_entity_id: the world needs a POV entity id
lint_suppressed_must_be_a_list: suppressed must be a list
lint_seedmode_must_be_fresh_or_same_roll: seedMode must be fresh or same_roll
lint_lenientpricing_must_be_true_or_false: lenientPricing must be true or false
lint_spawntier_must_be_a_tier_id: spawnTier must be a tier id
lint_spawncap_must_be_a_number: spawnCap must be a number
lint_key_must_be_a_number: {{key}} must be a number
lint_routine_id_is_saved_under_another_id: Routine {{id}} is saved under another id ({{id2}}).
lint_routine_id_s_owner_owner_is_no: Routine {{id}}'s owner {{owner}} is no entity, group or kind of the world.
lint_routine_id_s_owner_p: Routine {{id}}'s owner {{p}}.
lint_routine_id_s_owner_matches_nobody_as: Routine {{id}}'s owner matches nobody as a chat starts, so it applies to no one.
lint_routine_id_block_id2_rests_on_lore: Routine {{id}}, block {{id2}}: rests on lore entry {{entry}}, which the world doesn't have.
lint_routine_id_block_id2_rests_on_entity: Routine {{id}}, block {{id2}}: rests on {{entity}}'s sheet, who isn't in the world.
lint_name_theres_no_place_place_it_happens: {{name}}: there's no place {{place}}; it happens at home.
lint_name_no_place_has_the_scene_type: {{name}}: no place has the scene type {{nearest}}; it happens at home.
lint_name_happens_with_its_company_but_names: {{name}}: happens with its company, but names none; it happens at home.
lint_name_its_company_p: {{name}}: its company {{p}}.
lint_name_its_company_matches_nobody_as_a: {{name}}: its company matches nobody as a chat starts.
lint_name_theres_no_need_n_hunger_fatigue: {{name}}: there's no need {{n}} (hunger, fatigue, social, fun).
lint_name_the_calendar_has_no_holiday_h: {{name}}: the calendar has no holiday {{h}}.
lint_name_lists_no_weekdays_so_its_never: {{name}}: lists no weekdays, so it's never on.
lint_name_its_window_and_length_run_past: {{name}}: its window and length run past the next day.
lint_name_its_window_opens_and_closes_at: {{name}}: its window opens and closes at {{from}}, which reads as a whole day; give it a span.
lint_name_perweek_times_a_week_but_its: {{name}}: {{perWeek}} times a week, but it's on only {{weekdaysCount}} weekdays.
lint_is_not_a_number: is not a number
lint_is_not_whole_minor_units: is not whole minor units
lint_is_not_true_or_false: is not true or false
lint_is_not_one_of_values: is not one of {{values}}
lint_names_nothing_in_the_world: names nothing in the world
lint_is_not_a_list: is not a list
lint_your_mine_kind_doesnt_define_label_it: Your {{mine}} kind doesn't define {{label}}: it has it from the packs' {{pack}}, which it lies over, so the value is read as theirs.
lint_none_of_your_kinds_defines_label_it: None of your kinds defines {{label}}: it is a pack's field, read as theirs.
lint_who_gives_a_class_that_isnt_a: {{who}} gives a class that isn't a facet → values map.
lint_the_world_has_no_lore_entry_lore: The world has no lore entry "{{lore}}".
lint_the_world_has_no_track_track: The world has no track "{{track}}".
lint_the_track_track_has_no_stage_stage: The track "{{track}}" has no stage "{{stage}}".
lint_the_world_has_no_entity_entity: The world has no entity "{{entity}}".
lint_name_has_no_field_field: {{name}} has no field "{{field}}".
lint_no_helper_is_called_names: no helper is called {{names}}
lint_term_is_an_alias_of_others_but_the: "{{term}}" is an alias of {{others}}, but the term doesn't lead there
lint_name_is_def_targets_allows_one: {{name}} is {{def}} {{targets}}; “{{label}}” allows one.
lint_from_are_each_def_to_allows_one: {{from}} are each {{def}} {{to}}; “{{label}}” allows one.
lint_the_id_id_gives_away_a_secret: The id "{{id}}" gives away a secret ({{secrets}}): a player's views carry it wherever the player acts on what it names. Give it an id that names no one, such as "{{neutral}}".
lint_label_may_use_only_lines_any_other: "{{label}}" may use only {{lines}}; any other macro, control character or <user>/<char>/<bot> would act beside engine values
lint_open_name_close_isnt_an_engine_placeholder: {{open}}{{name}}{{close}} isn't an engine placeholder for a {{purpose}} step; it renders empty
lint_open_name_close_isnt_a_placeholder_who_skill: {{open}}{{name}}{{close}} isn't a placeholder ({who}, {skill}, {attempt} or {against}), so the narrator is told it as written.

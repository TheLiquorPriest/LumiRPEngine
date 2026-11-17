---
description: The narrator's own sections, as the narrator reads them - what a person is doing and how they regard the player's character, a project, a plan and the orders given, a vote waiting, a quest's stage, what is owed and what is on a person, a thing carried or lent, the date and time, the weather, the conditions someone is under, how an organization names a person and what they may do there, the usual routines of the people around, and a section's settings in this chat as one sentence. One line per name, a name, a colon, then its text. A name in double braces puts in what the engine knows of it (an amount in the world's own coin, a name, a number), and a block opened with a hash and closed with a slash shows only when that value is there. Change the words freely. Delete a line and that is not said at all.
format: lines
keys:
  feed_*: the narrator's own sections (what a person is doing and how they regard the player's character, a project, a plan and the orders given, a vote waiting, a quest's stage, what is owed and what is on a person, a thing carried or lent, the date and time, the weather, the conditions someone is under, how an organization names a person and what they may do there, the usual routines of the people here), each a phrase or a sentence filled with what it names; feed_org_type_*, feed_role_*, feed_worn_*, feed_mood_* are the single words those fill in
  feedset_*: a section's settings in this chat as one sentence (the feedset line, with its parts feedset_scope_*, feedset_cut, feedset_uncapped, feedset_sources); feed_marked_scene and feed_marked_gm mark a fact beyond the player character's knowledge
---
feed_name_knowsdoesnt_know_you_and_feels_words: {{name}} {{#if_known}}knows{{/if_known}}{{^if_known}}doesn't know{{/if_known}} you{{#if_words}} and feels {{words}} toward you{{/if_words}}.
feed_right_now_they_are_doing: Right now they are {{doing}}.
feed_agenda: Agenda
feed_decided: Decided
feed_name_s_private_agenda_track_stagelabel: {{name}}'s private agenda, {{track}}: {{stageLabel}}.
feed_id_s_cues: {{id}}'s cues
feed_name_is_here_act: {{name}} is here{{#if_act}}, {{act}}{{/if_act}}.
feed_on_days_off: on days off
feed_on_working_days: on working days
feed_on_holidays: on holidays
feed_on_their_birthday: on their birthday
feed_on_a_friends_birthday: on a friend's birthday
feed_in_weather_weather: in {{weather}} weather
feed_in_the_start:  in the {{start}}
feed_perweek_days_a_week: {{perWeek}} day{{^if_perWeek}}s{{/if_perWeek}} a week
feed_name_usually_told: {{name}} usually: {{told}}.
feed_usual_routines_background_you_may_use_or: Usual routines (background you may use or ignore, never a fact to state; what the story establishes always comes first):
feed_id_name_usually_told: {{id}} ({{name}}) usually: {{told}}.
feed_your: Your
feed_whose_name_status_done_of_stepscount_steps: {{whose}} {{name}}: {{status}}; {{done}} of {{stepsCount}} steps done{{#if_next}}; next: {{name2}}{{/if_next}}{{#if_last}}; due to be done {{last}}{{/if_last}}.
feed_the_engine_runs_each_project_day_by: The engine runs each project day by day: tell its progress only as the time that passes covers, never say a step is done before its day, and never start, finish or drop one yourself. A setback or an extra cost the story makes is noted with project_note.
feed_your_party: your party
feed_orgname_the_plan_and_the_orders_given: {{orgName}}: the plan and the orders given, as the story stands.
feed_set_by_the_gm_by_name_cal: set{{#if_by}} by the GM{{/if_by}}{{^if_by}} by {{name}}{{/if_by}} {{cal}}{{#if_lateOf}} (its time has passed){{/if_lateOf}}
feed_latest_note_last_source: ; latest: {{note}} ({{last}}, {{source}})
feed_o_lead_leads_text_at_where_by: - {{o}}{{#if_lead}} ({{lead}} leads){{/if_lead}}: {{text}}{{#if_where}}, at {{where}}{{/if_where}}{{#if_when}}, by {{when}}{{/if_when}}. {{status}}, {{o2}}{{o3}}.{{#if_lived}} By the day as laid it should be done; not told yet.{{/if_lived}}
feed_goal_g_text_todayby_window_status_g2: Goal, {{g}}: {{text}}{{#if_window}} ({{#if_today}}today{{/if_today}}{{^if_today}}by {{window}}{{/if_today}}){{/if_window}}. {{status}}{{g2}}.
feed_play_each_one_carrying_out_their_order: Play each one carrying out their order in character unless the scene gives them a reason not to. Show progress only as the player's message and the time that passes cover; never mark anything done, hand out a task, or change who does what yourself.
feed_to_a_vote_at_org_text_it: - To a vote at {{org}}: {{text}}; it closes {{closes}}; {{pov}}.
feed_show_a_vote_or_an_answer_only: - Show a vote or an answer only as the player's message and the time that passes cover; never decide one for anyone.
feed_t_still_to_do_o: {{t}}, still to do: {{o}}.
feed_t_a_hint_your_character_has_h: {{t}}, a hint your character has: {{h}}
feed_t_known_to_be_true_truth: {{t}}, known to be true: {{truth}}
feed_t_stage_the_truth_truth: {{t}}: {{stage}}{{#if_truth}} (the truth: {{truth}}){{/if_truth}}.
feed_how_well_off_you_are_pov: How well off you are: {{pov}}.
feed_balances_now_parts: Balances now: {{parts}}.
feed_name_s_money_id: {{name}}'s money: {{id}}.
feed_before_sales_tax: , before sales tax
feed_on_you_whose: On you: {{whose}}
feed_taken_from_id: Taken from {{id}}
feed_holding_for_id: Holding for {{id}}
feed_yours_to_use: yours to use
feed_overdue_it_should_go_back: overdue: it should go back
feed_borrowed_from_thing_where: Borrowed from {{thing}}: {{where}}
feed_holding_it_for_you: holding it for you
feed_for_to_to_use: for {{to}} to use
feed_overdue_it_should_have_come_back_by: overdue: it should have come back by now
feed_to_to_until_until: to {{to}}{{#if_until}} until {{until}}{{/if_until}}
feed_with_to_lent_out_terms: {{#if_hold}}With {{to}}{{/if_hold}}{{^if_hold}}Lent out{{/if_hold}}: {{terms}}
feed_saved_outfitssaved_loadouts_names: {{#if_outfit}}Saved outfits{{/if_outfit}}{{^if_outfit}}Saved loadouts{{/if_outfit}}: {{names}}.
feed_on_you_without_your_knowing_unknown: On you without your knowing: {{unknown}}.
feed_name_has_theirs: {{name}} has {{theirs}}.
feed_your_household: , your household
feed_where_you_work: , where you work
feed_which_you_own: , which you own
feed_which_you_belong_to: , which you belong to
feed_up_to_payment_a_payment: up to {{payment}} a payment
feed_up_to_month_a_month: up to {{month}} a month
feed_only_from_accounts: only from {{accounts}}
feed_you_are_title_holding_title2: you are {{title}}{{#if_title}}, holding {{title2}}{{/if_title}}
feed_you_report_to_name: you report to {{name}}
feed_name_reportsreport_to_you: {{name}} {{#if_below}}reports{{/if_below}}{{^if_below}}report{{/if_below}} to you
feed_you_may_do_anything_for_it: you may do anything for it
feed_you_may_power_limits: you may {{power}}{{#if_limits}}, {{limits}}{{/if_limits}}
feed_org_type_parts_you_belong_to_it: {{org}} ({{type}}): {{#if_parts}}{{parts}}{{/if_parts}}{{^if_parts}}you belong to it{{/if_parts}}.
feed_you_act_for_org_by_d_s: You act for {{org}}{{#if_d}} by {{d}}'s delegation{{/if_d}}: you may {{words}}{{#if_extra}}, {{extra}}{{/if_extra}}{{#if_until}}, until {{until}}{{/if_until}}.
feed_you_travel_with_pov_the_player_character: You travel with {{pov}} (the player character) in their party, as {{#if_core}}a core member{{/if_core}}{{^if_core}}{{#if_companion}}a companion{{/if_companion}}{{^if_companion}}{{#if_hired}}a hired hand{{/if_hired}}{{^if_hired}}an ally{{/if_hired}}{{/if_companion}}{{/if_core}}.
feed_party_someone_o: {{#if_party}}{{party}}{{/if_party}}{{^if_party}}someone{{/if_party}} ({{o}})
feed_yours_direct_with_rest: yours ({{direct}}){{#if_rest}}, with {{rest}}{{/if_rest}}
feed_you_role: you: {{role}}
feed_you_through_party_someone: you: through {{#if_party}}{{party}}{{/if_party}}{{^if_party}}someone{{/if_party}}
feed_held_by_rest: held by {{rest}}
feed_time_part: Time: {{part}}.
feed_time_offset_part: Time: {{offset}} ({{part}}).
feed_the_clock_is_paused_for_this_scene: The clock is paused for this scene.
feed_season_label: Season: {{label}}.
feed_you_are_conditions: You are {{conditions}}.
feed_name_owes_currency: {{name}} owes {{currency}}
feed_until_until: until {{until}}
feed_wears_wornseen: wears {{wornSeen}}
feed_carries_heldseen: carries {{heldSeen}}
feed_title_atof_orgname: {{title}} {{#if_staffOnly}}at{{/if_staffOnly}}{{^if_staffOnly}}of{{/if_staffOnly}} {{orgName}}
feedset_world: The {{label}} section follows the world's settings again in this chat
feedset_off: The {{label}} section is left out of the prompt in this chat
feedset_lines: {{n}} {{#one}}line{{/one}}{{^one}}lines{{/one}}
feedset_tokens: {{n}} tokens
feedset_scope_player: tells what your character knows
feedset_scope_scene: also tells what the people with your character know
feedset_scope_gm: tells everything, with what your character doesn't know marked
feedset_scope_narrator: follows the narrator's knowledge
feedset_cut: cut to at most {{caps}}
feedset_uncapped: with no cap
feedset_sources: from {{#one}}the 1 source{{/one}}{{^one}}the {{n}} sources{{/one}} picked for it
feedset: In this chat, the {{label}} section {{parts}}
feed_marked_scene: {{text}} [unknown to you; known to {{#who}}{{who}}{{/who}}{{^who}}others here{{/who}}]
feed_marked_gm: {{text}} [unknown to you; GM only]
feed_offered_in_the_story: Offered in the story
feed_asked_of_you_by_giver_for_orgname: Asked of you by {{giver}} for {{orgName}} ({{o}}): {{text}}
feed_it_serves_the_goal_text: It serves the goal: {{text}}.
feed_carry_it_out_as_part_of_your: Carry it out as part of your place there; if you won't, say so in the scene.
feed_add_to_the_plan_name_offer: Add to the plan? {{name}}: {{offer}}
feed_id_orgname_order_for_o_text_status: - [{{id}}] {{orgName}}, order for {{o}}: {{text}} ({{status}})
feed_a_vote_at_org_put_by_name: - A vote at {{org}}{{#if_m}}, put by {{name}}{{/if_m}}: {{text}}. It closes {{closes}}. You hold {{who}} of the votes; {{#if_mine}}you vote {{vote}}{{#if_rule}} (your standing vote){{/if_rule}}{{/if_mine}}{{^if_mine}}you haven't voted{{/if_mine}}. So far {{who2}}. How you vote counts only when the story tells it.
feed_name_asks_your_approval_for_org_text: - {{name}} asks your approval for {{org}}: {{text}} ({{why}}). You may approve or deny it; it counts only when the story tells it.
feed_id_org_org2_request_for_approval_by: - [{{id}}] {{org}} ({{org2}}), request for approval by {{r}}: {{text}} ({{why}}); may approve: {{#if_approvers}}{{approvers}}{{/if_approvers}}{{^if_approvers}}no one now{{/if_approvers}}
feed_you_have_cash_in_cash_and_inbank: You have {{cash}} in cash and {{inBank}} in the bank.
feed_whats_due_this_week_is_more_than: What's due this week is more than you have in cash and the bank.
feed_contract_of_label_expire_expiry: {{contract}} of {{label}} expire {{expiry}}.
feed_has_about_invested_invested: Has about {{invested}} invested.
feed_owns_part_id_worth_id2_owed_left: Owns {{part}}{{id}} (worth {{id2}}{{#if_owed}}; {{owed}} left on the mortgage{{/if_owed}}).
feed_collects_about_rent_a_month_in_rent: Collects about {{rent}} a month in rent.
feed_owns_share_of_id_the_shares_worth: Owns {{#if_share}}{{share}}% of {{/if_share}}{{id}} ({{#if_floored}}the shares worth nothing: its net worth is below zero{{/if_floored}}{{^if_floored}}the shares worth about {{share2}}{{/if_floored}}).
feed_b_which_they_own_has_madelost_profit: {{b}}, which they own, has {{#if_profit}}made{{/if_profit}}{{^if_profit}}lost{{/if_profit}} {{profit}} so far this month on {{revenue}} taken in{{#if_payroll}}, {{payroll}} of it gone on wages{{/if_payroll}}.
feed_its_account_holds_acct: Its account holds {{acct}}.
feed_they_owe_business_left_for_memo_and: They owe {{business}} {{left}} for {{memo}}{{#if_late}}, and it is late{{/if_late}}{{^if_late}}, due {{due}}{{/if_late}}.
feed_who_is_words_toward_you: {{who}} is {{words}} toward you.
feed_name_s_mind_monologue: {{name}}'s mind: {{monologue}}.
feed_interrupts_the_skip_interrupt: Interrupts the skip: {{interrupt}}.
feed_interrupts_the_skip_interrupt_2:  Interrupts the skip: {{interrupt}}.
feed_fact: {{who}} {{verb}}: {{text}}
feed_id_org_org2_motion_put_by_m: - [{{id}}] {{org}} ({{org2}}), motion{{#if_m}} put by {{m}}{{/if_m}}: {{text}} (open until {{closes}}; voters: {{voters}}{{#if_yet}}; not yet voted: {{yet}}{{/if_yet}})
feed_id_orgname_goal_text_status: - [{{id}}] {{orgName}}, goal: {{text}} ({{status}})
feed_lead_leads: ; {{lead}} leads
feed_name_worked_on_text: {{name}} worked on: {{text}}
feed_o_the_player_character: {{o}} (the player character)
feed_set_words: Set{{#who}} by {{who}}{{/who}} {{when}}, {{source}}
feed_someone: Someone
feed_status_and_late: — {{status}}{{#if_o}}, and late{{/if_o}}.
feed_the_gm: the GM
feed_the_party: the party
feed_the_player_character: the player character
feed_with_others_lead: with {{others}}{{lead}}
feed_you: You
feed_you_lead: ; you lead
feed_you_lower: you
feed_your_party_org_org2: {{#if_org}}your party{{/if_org}}{{^if_org}}{{org}}{{/if_org}} ({{org2}})
feed_title_for_employername_an_outside_employer_rate: {{title}} for {{#employerName}}{{employerName}}{{/employerName}}{{^employerName}}an outside employer{{/employerName}}, {{rate}} {{basis}}, paid {{#if_every}}nothing{{/if_every}}{{^if_every}}{{every}}{{/if_every}}.
feed_intends_intent: Intends: {{intent}}.
feed_left_is_due_due: ; {{left}} is due {{due}}
feed_left_is_past_due: ; {{left}} is past due
feed_money_band: Money: {{band}}.
feed_mood_mood: Mood: {{mood}}.
feed_reactions_reactions: Reactions: {{reactions}}.
feed_shows_depiction: Shows: {{depiction}}.
feed_today_is_holidays: Today is {{holidays}}.

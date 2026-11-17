---
description: The sentences the chat's history and the world's notices are made of, among them a bill, a payday, a statement, a credit decision, a loan paid off, a payment that did not go through, an arrival, a departure, a pressing need, a late invoice, a bond that matured, a fight's start, rounds, acts and end, a holiday set or taken off, and the lines the narrator's vehicles section is made of. Each is the line the player's journal, the reply's list of what happened and the world's notices show for something that happened, and what the engine's own notes tell the player and the game master. One line per name, a name, a colon, then its text. A name in double braces puts in what the engine knows of it (an amount in the world's own coin, a name, a number), and a block opened with a hash and closed with a slash shows only when that value is there. Change the words freely. Delete a line and that is not said at all.
format: lines
keys:
  credit_approved: an application for credit that was approved - product, apr (absent where no rate), limit (absent where none)
  credit_declined: an application for credit that was declined - product, reason (one of the credit_why lines)
  credit_why_charged_off: why, when a recent charge-off is on the report
  credit_why_score: why, when the score is too low
  credit_why_amount: why, when more was asked than a lender lends - most
  card_statement: a card's statement - name, owed, interest (absent when none), minimum, due
  card_due_today: the minimum falls due today - name, left
  card_penalty_lifted: six payments on time, so the penalty rate ends - name
  card_payment_late: the minimum was not paid by its day (the first miss) - name, short, fee, penalty
  card_payment_30: thirty days late - name, short, days, fee, penalty
  card_payment_60: sixty days late - the same
  card_payment_90: ninety days late - the same
  card_payment_120: sent to collections - the same
  card_payment_collections: still in collections - the same
  card_payment_charged_off: charged off - the same
  flow_paid: a standing payment went out - label, amount, offscreen or world (where it was set up)
  flow_received: a standing payment came in - the same
  flow_partial: only part of a standing payment was paid - label, part, amount
  flow_retry: a standing payment did not go through and is tried again - label, amount
  flow_fallback: a standing payment was paid from another account - label, amount, from
  flow_deferred: a standing payment could not be paid and carries to next time - label, amount
  flow_declined: a standing payment was declined - label, amount, reason
  flow_why_failed: why, when no reason came with it
  loan_paid_off: a loan between two parties is paid off - borrower, lender
  payday: a paycheck - net, gross (absent where nothing was withheld)
  invoice_late: an invoice the player owes is late - memo, business (absent where it is hidden from the player), days, amount
  invoice_late_owner: an invoice a business is owed is late - memo, customer (absent where it is hidden), days, amount
  bond_matured: a bond matured - asset, paid, coupon (absent where none)
  option_exercised: an option was exercised at expiry - asset, value
  option_expired: an option expired worthless - asset
  project_wait_start: a project's step cannot start until its money can be paid - project, step, amount, reason
  project_wait_finish: a project's step cannot finish until its money can be paid - the same
  person_leaves: someone the player sees leaves - name
  person_arrives: someone arrives where the player is - name
  thing_got_back: an owner got a lent thing back - name, thing
  need_alert: a need is pressing on the player's character - word (hungry, tired, lonely, bored)
  invitation: someone invites the player to meet - name, place (absent where the player may not know it), time
  thing_overdue: a lent thing is overdue - thing, borrower
  set_not_to_hand: what a set called for was not to hand - set, missing
  weather_closes: a sky closes travel - state, place, closes
  vehicle_service_due: a vehicle is due for service - name
  seat_succeeds: someone succeeds another in a seat - who, was, title
  seat_taken: someone takes a seat - who, title
  seat_incident: the player's group has a new holder of a seat - who (absent where the player may not know them), title, org
  level_reached: someone reached a level - name, you, progression, level, from (absent for one level)
  level_dropped: someone dropped to a level - name, you, progression, level, from
  holiday_set: a holiday was set or changed in the chat - holiday
  holiday_removed: a holiday was taken off - holiday
  fight_start: a fight began - party, foes
  fight_join: fighters joined a fight - who
  fight_turn: whose turn it is - actor
  fight_spend: a fighter spent from a budget - who, costs
  fight_act: a fighter acted - actor, what, target, outcome
  fight_down: a fighter is down - who
  fight_up: a fighter is back up - who
  fight_left: the player's character left the fight
  fight_stalemate: the fight petered out
  fight_broke_off: the fight broke off as time moved on
  fight_over: the fight is over - won or lost, from the player's side
  fight_decided: a fighter decided - choice
  vehicle_line: one vehicle in the narrator's section - name, parts
  vehicle_someone: no one the player may know
  vehicle_at: where it stands - place
  vehicle_at_unknown: where it stands, when nowhere is known
  vehicle_somewhere: where it stands, when the place is out of the player's sight
  vehicle_yours: it is the player's
  vehicle_of: it is someone's - owner
  vehicle_staff: it is someone's and the player uses it at work - owner
  vehicle_permit: it is someone's and the player may use it - owner
  vehicle_lent: it is lent to the player - owner, until
  vehicle_assigned: it is assigned to the player - owner
  vehicle_owner_unknown: whose it is, when the player knows no owner
  vehicle_owner_none: whose it is, when it has no owner
  vehicle_away: it is not at the player's site
  vehicle_broken: its state at the lowest level of detail, broken down
  vehicle_runs: its state at the lowest level of detail, running
  vehicle_fuel: its fuel - pct, range (absent where none)
  vehicle_service_overdue: its service is overdue - due, unit
  vehicle_service_next: its next service - due, unit
  vehicle_driven_by: who drives it - who, or you
  vehicle_you: the player, among those aboard
  vehicle_specs: its first specs - specs, more
  vehicle_holding: a thing and what it holds - name, inner
  vehicle_aboard: who is aboard - who
  vehicle_cargo: what is in it - what
  post_between: a posting between two accounts of the player (or of anyone, on a GM's line) - label, amount, from, to; post_out_of, post_into, post_net_out, post_net_in the other forms of it, and post_label the label of one with no memo
  thing_carried_by: a thing and who carries it, thing_in and thing_at where it is - name, holder or place
  set_place: a change of a field as a sentence, one line for each field and form (set_place, set_bed_*, set_home_*, set_owner*, set_unset, set_marked, set_unmarked, set_list*, set_value, set_value_at_most) - who or whose, noun, the value; many is true where the subject is the player (a plural verb)
  rel_knows: a relation made or ended as a sentence, one line for each relation (rel_knows, rel_carried_by, rel_in, rel_uses, rel_uses_ended, rel_owns, rel_worn_by, rel_equipped, rel_member_of, rel_regard, rel_regard_none, rel_other) - from, to, now (true where it was made), many
  entity_gone: a thing removed, back, or made (entity_gone, entity_back, entity_appears) - name; add_down and add_up a number that went down or up - whose, noun, amount; stage_now a quest stage - track, stage; change_unseen the line for a change the player may not see
  ev_set: the engine's own record lines, one per kind of record, as the GM's and the author's views and the player's journal show them (ev_set, ev_add, ev_link, ev_unlink, ev_stage, ev_clock_*, ev_timelapse, ev_roll, ev_check, ev_entity*, ev_class_*, ev_life*, ev_told, ev_ws_*, and the rest named ev_) - what each names is in the line itself
  list_and: how a list is read, the last item after the others - head (the others, with commas), last
  castlife_in_chat: a change to someone's routine or schedule in this chat, as the GM reads it - what (the sentence below), story (set where the story made it)
  castlife_follow: how someone follows their routine in this chat - name, parts (the follow_* lines, read as a list); castlife_follow_world when none is set
  follow_mode_*, follow_awareness_*, follow_role_*, follow_skips_*: one part of how someone follows their routine, as a phrase after the name (follows, no_invitations, off; story_first, balanced, routine_first; informative, enforced, off; stay, routine, model)
  castlife_block_back, castlife_block_off, castlife_block_changed: one block of someone's routine in this chat, back to the world's, off, or changed - name, block
  castlife_schedule_label: a schedule as a phrase - schedule, sets (what it sets, the schedule_sets_* lines); castlife_schedule_world, castlife_schedule_off, castlife_schedule_own say what happened to it - name, label
  why_*: why a change was not made, as the reason the answer to a refused change gives (world_apply's not_applied, a refused edit, a rejected event) - each is one reason, filled with what it names (a name, a number, a list)
  lint_*: what a check of a world, a ruleset, a routine, a lore entry, a map, an organization or another part says is wrong, as one line of its problem list (the line a problem lists in Build and the map and routine jobs read) - each is filled with what it names
  feed_*: the narrator's own sections (what a person is doing and how they regard the player's character, a project, a plan and the orders given, a vote waiting, a quest's stage, what is owed and what is on a person, a thing carried or lent, the date and time, the weather, the conditions someone is under, how an organization names a person and what they may do there, the usual routines of the people here), each a phrase or a sentence filled with what it names; feed_org_type_*, feed_role_*, feed_worn_*, feed_mood_* are the single words those fill in
  org_log_*: what an organization's own History says it did (admitting, removing, appointing, delegating, renaming, a vote or a request and its end, founding, restructuring, winding up, merging, entry and keys, hiring, pay, a party's changes) and the phrases those fill in, and what an act for an organization records beside its effects (a payment, a sale, a loan, a project's step, a property's let or sale); each is filled with what it names
  eng_*: what the engine says of what it did or could not do, apart from a refused change (the turn's beats, a formula or dice that does not read, a selector or a field value that does not fit, a ruleset or a world draft that is wrong, what a thing's provenance reads, a thing tidied, what someone may not do for an organization) - each is filled with what it names
  feedset_*: a section's settings in this chat as one sentence (the feedset line, with its parts feedset_scope_*, feedset_cut, feedset_uncapped, feedset_sources); feed_marked_scene and feed_marked_gm mark a fact beyond the player character's knowledge
---
credit_approved: Approved: a {{product}}{{#apr}} at {{apr}}% APR{{/apr}}{{#limit}} with a {{limit}} limit{{/limit}}.
credit_declined: The application for a {{product}} was declined: {{reason}}.
credit_why_charged_off: a recent charge-off on their report
credit_why_score: their credit score is too low
credit_why_amount: it is more than a lender would lend them (at most {{most}})
card_statement: {{name}} statement: {{owed}}{{#interest}} incl. {{interest}} interest{{/interest}}; minimum {{minimum}} due {{due}}.
card_due_today: {{name}} payment of {{left}} is due today.
card_penalty_lifted: {{name}}: six payments on time; the penalty rate is lifted.
card_payment_late: {{name}} payment of {{short}} missed{{#fee}}; a {{fee}} late fee was charged{{/fee}}{{#penalty}}; the penalty rate of {{penalty}}% applies{{/penalty}}.
card_payment_30: {{name}} payment of {{short}} {{days}} days late{{#fee}}; a {{fee}} late fee was charged{{/fee}}{{#penalty}}; the penalty rate of {{penalty}}% applies{{/penalty}}.
card_payment_60: {{name}} payment of {{short}} {{days}} days late{{#fee}}; a {{fee}} late fee was charged{{/fee}}{{#penalty}}; the penalty rate of {{penalty}}% applies{{/penalty}}.
card_payment_90: {{name}} payment of {{short}} {{days}} days late{{#fee}}; a {{fee}} late fee was charged{{/fee}}{{#penalty}}; the penalty rate of {{penalty}}% applies{{/penalty}}.
card_payment_120: {{name}} payment of {{short}} sent to collections{{#fee}}; a {{fee}} late fee was charged{{/fee}}{{#penalty}}; the penalty rate of {{penalty}}% applies{{/penalty}}.
card_payment_collections: {{name}} payment of {{short}} still in collections{{#fee}}; a {{fee}} late fee was charged{{/fee}}{{#penalty}}; the penalty rate of {{penalty}}% applies{{/penalty}}.
card_payment_charged_off: {{name}} payment of {{short}} charged off{{#fee}}; a {{fee}} late fee was charged{{/fee}}{{#penalty}}; the penalty rate of {{penalty}}% applies{{/penalty}}.
flow_paid: {{label}}: {{amount}} paid{{#offscreen}} (set up off screen){{/offscreen}}{{#world}} (set up in the world){{/world}}.
flow_received: {{label}}: {{amount}} received{{#offscreen}} (set up off screen){{/offscreen}}{{#world}} (set up in the world){{/world}}.
flow_partial: {{label}}: only {{part}} of {{amount}} paid.
flow_retry: {{label}} ({{amount}}) did not go through; it will be tried again.
flow_fallback: {{label}}: {{amount}} paid from {{from}}.
flow_deferred: {{label}} ({{amount}}) could not be paid; it carries over to the next payment.
flow_declined: {{label}} ({{amount}}) was declined: {{reason}}.
flow_why_failed: the payment did not go through
loan_paid_off: The loan of {{borrower}} from {{lender}} is paid off.
payday: Payday: {{net}} net{{#gross}} ({{gross}} gross){{/gross}}.
invoice_late: {{memo}} from {{#business}}{{business}}{{/business}}{{^business}}a business{{/business}} is {{days}} {{#one}}day{{/one}}{{^one}}days{{/one}} late: {{amount}} due.
invoice_late_owner: {{memo}}, billed to {{#customer}}{{customer}}{{/customer}}{{^customer}}a customer{{/customer}}, is {{days}} {{#one}}day{{/one}}{{^one}}days{{/one}} late: {{amount}} owed.
bond_matured: {{asset}} matured: {{paid}} paid out{{#coupon}}, its last coupon of {{coupon}} with it{{/coupon}}.
option_exercised: {{asset}} was exercised at expiry and settled for {{value}}.
option_expired: {{asset}} expired worthless.
project_wait_start: {{project}}: {{step}} cannot start until {{amount}} can be paid ({{reason}}); it tries again as money comes in.
project_wait_finish: {{project}}: {{step}} cannot finish until {{amount}} can be paid ({{reason}}); it tries again as money comes in.
person_leaves: {{name}} leaves.
person_arrives: {{name}} arrives.
thing_got_back: {{name}} got {{thing}} back.
need_alert: You are getting {{word}}.
invitation: {{name}} invites you to {{#place}}{{place}}{{/place}}{{^place}}meet up{{/place}} at {{time}}.
thing_overdue: {{thing}} is overdue from {{borrower}}.
set_not_to_hand: Not to hand for {{set}}: {{missing}}.
weather_closes: {{state}} over {{place}}: {{closes}} travel is closed.
vehicle_service_due: {{name}} is due for service.
seat_succeeds: {{who}} succeeds {{was}} as {{title}}
seat_taken: {{who}} takes the seat of {{title}}
seat_incident: {{#who}}{{who}}{{/who}}{{^who}}Someone{{/who}} now holds {{title}} for {{org}}.
level_reached: {{#you}}You{{/you}}{{^you}}{{name}}{{/you}} reached {{progression}} {{level}}{{#from}} (from {{from}}){{/from}}.
level_dropped: {{#you}}You{{/you}}{{^you}}{{name}}{{/you}} dropped to {{progression}} {{level}} (from {{from}}).
holiday_set: {{holiday}} is a holiday
holiday_removed: {{holiday}} is no longer a holiday
fight_start: A fight: {{party}} against {{foes}}
fight_join: {{who}} joined the fight
fight_turn: {{actor}}'s turn
fight_spend: {{who}} spends {{costs}}
fight_act: {{actor}}: {{what}}{{#target}} → {{target}}{{/target}}{{#outcome}} ({{outcome}}){{/outcome}}
fight_down: {{who}}: down
fight_up: {{who}}: back up
fight_left: You left the fight
fight_stalemate: The fight petered out
fight_broke_off: The fight broke off as time moved on
fight_over: The fight is over{{#won}}: your side won{{/won}}{{#lost}}: your side lost{{/lost}}
fight_decided: decided {{choice}}
vehicle_line: {{name}}: {{parts}}.
vehicle_someone: someone
vehicle_at: at {{place}}
vehicle_at_unknown: at an unknown place
vehicle_somewhere: somewhere
vehicle_yours: yours
vehicle_of: {{owner}}'s
vehicle_staff: {{owner}}'s, yours to use at work
vehicle_permit: {{owner}}'s, yours to use
vehicle_lent: {{#owner}}{{owner}}'s, {{/owner}}lent to you until {{until}}
vehicle_assigned: {{#owner}}{{owner}}'s, {{/owner}}assigned to you
vehicle_owner_unknown: no one's you know of
vehicle_owner_none: no one's
vehicle_away: away from here
vehicle_broken: broken down
vehicle_runs: runs fine
vehicle_fuel: fuel {{pct}}%{{#range}}, about {{range}} left{{/range}}
vehicle_service_overdue: service overdue (it was due at {{due}} {{unit}})
vehicle_service_next: next service due at {{due}} {{unit}}
vehicle_driven_by: driven by {{#you}}you{{/you}}{{^you}}{{who}}{{/you}}
vehicle_you: you
vehicle_specs: specs {{specs}}{{#more}}, and {{more}} more{{/more}}
vehicle_holding: {{name}} (holding {{inner}})
vehicle_aboard: Aboard: {{who}}.
vehicle_cargo: Cargo: {{what}}.
post_label: Money moved
post_between: {{label}}: {{amount}} from {{from}} to {{to}}
post_out_of: {{label}}: {{amount}} out of {{account}}
post_into: {{label}}: {{amount}} into {{account}}
post_net_out: {{label}}: −{{amount}}
post_net_in: {{label}}: +{{amount}}
thing_carried_by: {{name}} (carried by {{holder}})
thing_in: {{name}} (in {{holder}})
thing_at: {{name}} (at {{place}})
set_place: {{who}} {{#many}}are{{/many}}{{^many}}is{{/many}} now at {{place}}
set_bed_home: {{who}} now {{#many}}sleep{{/many}}{{^many}}sleeps{{/many}} at home
set_bed_at: {{who}} now {{#many}}sleep{{/many}}{{^many}}sleeps{{/many}} at {{bed}}
set_bed_in: {{who}} now {{#many}}sleep{{/many}}{{^many}}sleeps{{/many}} in {{bed}}
set_bed_on: {{who}} now {{#many}}sleep{{/many}}{{^many}}sleeps{{/many}} on {{bed}}
set_home_none: {{who}} no longer {{#many}}have{{/many}}{{^many}}has{{/many}} a home
set_home_at: {{who}} now {{#many}}live{{/many}}{{^many}}lives{{/many}} at {{home}}
set_home_in: {{who}} now {{#many}}live{{/many}}{{^many}}lives{{/many}} in {{home}}
set_owner_none: {{who}} no longer {{#many}}belong{{/many}}{{^many}}belongs{{/many}} to anyone
set_owner: {{who}} now {{#many}}belong{{/many}}{{^many}}belongs{{/many}} to {{owner}}
set_unset: {{whose}} {{noun}} is no longer set
set_marked: {{who}} {{#many}}are{{/many}}{{^many}}is{{/many}} now marked “{{noun}}”
set_unmarked: {{who}} {{#many}}are{{/many}}{{^many}}is{{/many}} no longer marked “{{noun}}”
set_list_changed: {{whose}} {{noun}} changed
set_list_none: {{whose}} {{noun}} are now none
set_list: {{whose}} {{noun}} are now {{items}}
set_value: {{whose}} {{noun}} is now {{value}}
set_value_at_most: {{whose}} {{noun}} is now at most {{value}}
rel_knows: {{from}} {{#now}}now{{/now}}{{^now}}no longer{{/now}} {{#many}}know{{/many}}{{^many}}knows{{/many}} {{to}}
rel_carried_by: {{from}} {{#many}}are{{/many}}{{^many}}is{{/many}} {{#now}}now{{/now}}{{^now}}no longer{{/now}} carried by {{to}}
rel_in: {{from}} {{#many}}are{{/many}}{{^many}}is{{/many}} {{#now}}now{{/now}}{{^now}}no longer{{/now}} in {{to}}
rel_uses: {{from}} now {{#many}}borrow{{/many}}{{^many}}borrows{{/many}} {{to}}
rel_uses_ended: {{from}} gave back {{to}}
rel_owns: {{from}} {{#now}}now{{/now}}{{^now}}no longer{{/now}} {{#many}}own{{/many}}{{^many}}owns{{/many}} {{to}}
rel_worn_by: {{from}} {{#many}}are{{/many}}{{^many}}is{{/many}} {{#now}}now{{/now}}{{^now}}no longer{{/now}} worn by {{to}}
rel_equipped: {{from}} {{#many}}are{{/many}}{{^many}}is{{/many}} {{#now}}now{{/now}}{{^now}}no longer{{/now}} equipped by {{to}}
rel_member_of: {{from}} {{#many}}are{{/many}}{{^many}}is{{/many}} {{#now}}now{{/now}}{{^now}}no longer{{/now}} a member of {{to}}
rel_regard: {{whose}} regard for {{to}} changed
rel_regard_none: {{from}} no longer {{#many}}hold{{/many}}{{^many}}holds{{/many}} any regard for {{to}}
rel_other: {{from}} {{#now}}now{{/now}}{{^now}}no longer{{/now}} {{#many}}have{{/many}}{{^many}}has{{/many}} a “{{link}}” link to {{to}}
entity_gone: {{name}} is gone
entity_back: {{name}} is back
entity_appears: {{name}} appears
add_down: {{whose}} {{noun}} went down by {{amount}}
add_up: {{whose}} {{noun}} went up by {{amount}}
stage_now: {{track}} is now at “{{stage}}”
change_unseen: A change no longer applies
ev_set: {{name}}: {{field}} {{#value}}is {{#atMost}}at most{{/atMost}}{{^atMost}}now{{/atMost}} {{value}}{{/value}}{{^value}}changed{{/value}}
ev_add: {{name}}: {{field}} {{delta}}
ev_link: {{from}} {{rel}} {{to}}
ev_unlink: {{from}} no longer {{rel}} {{to}}
ev_stage: {{#track}}{{track}}{{/track}}{{^track}}A thread{{/track}}: {{#stage}}{{stage}}{{/stage}}{{^stage}}moved on{{/stage}}
ev_clock_min: +{{min}} min
ev_clock_s: +{{s}} s
ev_clock_min_s: +{{min}} min {{s}} s
ev_timelapse: timelapse {{minutes}} min
ev_materialized: {{entity}} {{domain}} detail
ev_unmaterialized: {{entity}} {{domain}} detail taken back
ev_rule: rule {{rule}}
ev_caught: {{agent}} caught up
ev_catchup_queue: catch-up queue
ev_choice: {{key}}: {{choice}}
ev_attempt: attempt on {{track}}
ev_hint_opened: hint opened on {{track}}
ev_hint_closed: hint closed on {{track}}
ev_track_revealed: {{track}} revealed
ev_clock_pause: clock pause
ev_clock_set_back: clock set back {{minutes}} min
ev_renamed: {{was}} is now called {{name}}
ev_meanwhile: what you saw meanwhile
ev_roll: {{actor}}: {{action}}, {{outcome}}{{^rolled}} (no roll: {{why}}){{/rolled}}
ev_check: {{actor}}: {{check}}, {{outcome}}{{#total}} (rolled {{total}}{{#dc}} against {{dc}}{{/dc}}){{/total}}
ev_entity_tier: is now in the {{tier}} tier
ev_entity_agent_on: now lives their own life off-screen
ev_entity_agent_off: no longer lives their own life off-screen
ev_entity_level_cleared: has {{area}} detail from their tier again
ev_entity_level: now has {{area}} detail at level {{level}}{{#label}} ({{label}}){{/label}}
ev_entity: {{name}} {{clauses}}
ev_none: none
ev_class_facet: {{whose}} {{noun}} is now {{values}}
ev_class_tags: {{whose}} tags are now {{tags}}
ev_class_none: {{name}} now has no classes and no tags
ev_life: {{name}} is now {{state}}
ev_life_you: You are now {{state}}
ev_life_reads: {{name}} {{reads}}
ev_told: {{who}} now {{#one}}knows{{/one}}{{^one}}know{{/one}} that {{name}} {{reads}}
ev_ws_written: workspace file {{path}} written
ev_ws_deleted: workspace file {{path}} deleted
ev_ws_pinned: workspace file {{path}} pinned
ev_ws_unpinned: workspace file {{path}} unpinned
ev_ws_readers_pov: workspace file {{path}} read with the player character's knowledge
ev_ws_readers_everyone: workspace file {{path}} read with everyone's knowledge
ev_ws_readers_gm: workspace file {{path}} read with the GM's knowledge
ev_output_told: {{kind}} lines told to the narrator
ev_scene_told: the scene's lore and notes told to the narrator
mind_round_on: A round of character minds ran
mind_round_off: Character minds are switched off
mind_line: {{name}}'s mind, at {{fidelity}} fidelity, {{#intent}}means to: {{intent}}{{/intent}}{{^intent}}has no intent{{/intent}}
mind_memory: {{name}} remembers the turn in {{notes}} {{#oneNote}}note{{/oneNote}}{{^oneNote}}notes{{/oneNote}} and {{commitments}} new {{#oneCommitment}}commitment{{/oneCommitment}}{{^oneCommitment}}commitments{{/oneCommitment}}
mind_present_none: No one was present for the minds
mind_present: {{who}} {{#one}}was{{/one}}{{^one}}were{{/one}} present for the minds
mind_plan_status: {{name}}'s {{#plan}}plan “{{plan}}”{{/plan}}{{^plan}}deleted plan{{/plan}} is now {{status}}
mind_part_deleted: {{name}}'s {{key}} was deleted
mind_part_edited: {{name}}'s {{key}} was edited
mind_commitment_status: {{name}}'s commitment is now {{status}}
mind_consolidated: {{name}}'s older notes folded into their summary
mind_unpinned: {{name}}'s mind goes by their score again
mind_pinned: {{name}}'s mind is now pinned at {{fidelity}} fidelity
mind_refresh: {{name}} gets a fresh mind next turn
mind_intent_cleared: {{name}} no longer has your intent
mind_intent: {{name}} now means to “{{text}}”{{#approach}}, {{approach}}ly{{/approach}}
mind_intent_manner: {{name}} now goes about things{{#approach}} {{approach}}ly{{/approach}}
mind_skip: The time skip stopped at {{beats}} beats for the minds
mind_fact: A fact for the minds: “{{claim}}”
mind_fact_bare: A fact for the minds
mind_learned: {{who}} learned {{claim}}
mind_holds: {{who}} {{#one}}holds{{/one}}{{^one}}hold{{/one}} {{claim}} ({{parts}})
mind_kept_everyone: kept from everyone
mind_kept_from: kept from {{who}}
mind_told_by: told by {{who}}
mind_sure: {{pct}}% sure
mind_forgot: {{who}} no longer {{#one}}holds{{/one}}{{^one}}hold{{/one}} {{claim}}
mind_keeps_none: {{name}} no longer keeps {{claim}} from anyone
mind_keeps: {{name}} keeps {{claim}} from {{from}}
mind_everyone: everyone
mind_truth: {{claim}} is now {{#open}}an open question{{/open}}{{^open}}{{truth}}{{/open}}
mind_tracking_on: Knowledge tracking is on
mind_tracking_off: Knowledge tracking is off
mind_threshold: , a holding revealing its fact from {{pct}}% sure
money_worth_free: {{entity}}'s worth is no longer fixed
money_worth_band: {{entity}} is {{band}}
money_prices_mult: Prices ×{{mult}}
money_prices_normal: Prices back to normal
money_statement_closed: The statement closed at {{closing}}, with at least {{minimum}} due
money_card_payment: A card payment of {{amount}} was made
money_stage: {{account}}'s payments are now {{stage}}
money_flow_outcome: {{flow}}: {{outcome}}
money_flow_renamed: Standing payment renamed {{name}}
money_hold_released: Hold released
money_hold: Hold of {{amount}}
money_card_posted: Card payments posted
money_credit_report: {{whose}} credit report now shows {{kind}}
money_credit_score: {{whose}} credit score is now {{score}}
money_card_spending: Card spending
money_accounts_closed: Accounts closed again
money_accounts_opened: Accounts opened
money_status: {{account}} is now {{status}}
money_interest_period: Interest period
money_declined: {{memo}} was declined
money_year_closed: {{party}} closed {{year}}
money_foundation_marked: {{org}}'s assets marked for {{month}}
money_dividend_received: {{party}} received a dividend from {{source}}
money_consent_dividend: {{org}}: consent dividend for {{year}}
money_phc_tax: {{party}}: personal holding company tax for {{year}}
money_aet_tax: {{party}}: accumulated earnings tax for {{year}}
money_foundation_tax: {{org}}: foundation taxes for {{year}}
project_started: Started {{project}}
project_step_waits_start: {{project}}: {{step}} waits for {{amount}} to start
project_step_waits_finish: {{project}}: {{step}} waits for {{amount}} to finish
project_step_started: {{project}}: {{step}} started
project_step_done: {{project}}: {{step}} done
project_paused: Paused {{project}}
project_resumed: Resumed {{project}}
project_dropped: Dropped {{project}}
project_note: {{project}}: {{note}}{{#text}} ({{text}}){{/text}}
business_sale_walkin: {{business}}: sale to walk-in customers
business_sale: {{business}}: sale of {{memo}} to {{payer}}
business_remit_tax: {{business}}: sales tax paid
business_remit_suppliers: {{business}}: suppliers paid
business_invoice_paid: {{business}}: invoice paid by {{customer}}
business_draw: {{business}}: owner's draw
business_profit: {{business}}: profit distributed
asset_quote: {{symbol}} at {{price}}
asset_price: {{asset}} at {{price}}
asset_yield: {{asset}} yields {{yield}}%
asset_listed: Contract listed: {{asset}}
stake_sold: {{party}} sold {{pct}}% of their share of {{entity}}
stake_bought: {{party}} bought into {{entity}}
trust_distributed: {{trust}} distributed to its beneficiaries
payslip: Payslip: {{worker}}, {{job}}
worked_hours: Worked {{hours}} h
commission: Commission on sales: {{job}}
unemployment_accrued: Unemployment tax accrued: {{employer}}
suta_paid: SUTA paid: {{employer}}
futa_paid: FUTA paid: {{employer}}
stream_earned: {{stream}}: {{amount}} earned
stream_adjusted_factor: {{stream}}: ×{{factor}} a payment until {{until}}{{#reason}} ({{reason}}){{/reason}}
stream_adjusted_amount: {{stream}}: {{amount}} on each payment until {{until}}{{#reason}} ({{reason}}){{/reason}}
estimated_tax: Estimated tax: {{party}}
profit_goes_to: {{owner}}'s profit from {{business}} goes to {{#to}}{{to}}{{/to}}{{^to}}their account{{/to}}
option_qty_exercised: {{option}}: {{qty}} exercised
income_profit: {{source}}: {{amount}} profit share
income_kind: {{source}}: {{amount}} {{kind}}
holding_units: {{holding}}: {{qty}} units ({{kind}}) for {{amount}}
donation: Donation: {{donor}} to {{org}}
depletion_of: Depletion of {{asset}} for {{month}}
depreciation_of: Depreciation of {{asset}} for {{month}}
cash_rule_world: Cash follows the world's rule again
cash_rule_machine: In this chat, cash needs a machine or a branch
cash_rule_free: In this chat, cash needs no machine
plan_goal: Plan: {{text}}
plan_order: Order: {{text}}
plan_status: Plan: {{id}} {{status}}
plan_due_day: Plan: {{id}} should be done by the day as laid
org_entry_audience: {{place}}: {{what}}
org_entry_world: {{place}}: entry as the world has it
org_entry_keys: {{place}}: keys changed
org_trespass: {{#name}}{{name}}{{/name}}{{^name}}Someone{{/name}} entered {{#place}}{{place}}{{/place}}{{^place}}a place{{/place}} without leave
org_request_bare: A request for approval
org_request_asked: {{by}} asked {{approver}} to approve, for {{org}}: {{text}} ({{why}}).
org_request_approved: {{who}} approved{{#text}} the request: {{text}}{{/text}}{{^text}} a request{{/text}}.
org_request_denied: {{who}} denied{{#text}} the request: {{text}}{{/text}}{{^text}} a request{{/text}}.
org_request_withdrew: {{who}} withdrew{{#text}} the request: {{text}}{{/text}}{{^text}} a request{{/text}}.
org_the_gm: The GM
org_motion_bare: A motion
org_motion_put: {{by}} put to a vote at {{org}}: {{text}}. It closes {{closes}}.
org_vote: {{who}} {{#you}}vote{{/you}}{{^you}}votes{{/you}} {{vote}}{{#text}}: {{text}}{{/text}}.
org_abstain: {{who}} {{#you}}abstain{{/you}}{{^you}}abstains{{/you}}{{#text}}: {{text}}{{/text}}.
org_motion_end: At {{org}}, the motion {{ended}}{{#why}} ({{why}}){{/why}}{{#text}}: {{text}}{{/text}}.
org_motion_closed: closed
org_config_world: Orgs: {{key}} follows the world's setting
org_config_off: Orgs: {{key}} off in this chat
org_config_on: Orgs: {{key}} on in this chat
org_spent: {{who}} spent {{amount}} for {{org}}
need_eased: {{#you}}Your{{/you}}{{^you}}{{name}}'s{{/you}} {{need}} eased
need_rose: {{#you}}Your{{/you}}{{^you}}{{name}}'s{{/you}} {{need}} rose
castlife_decided: decided {{choice}}
castlife_skip: skip planned for {{plans}}{{#note}} ({{note}}){{/note}}
story_flag: flag {{name}}
regard_rose: rose by {{by}}
regard_fell: fell by {{by}}
regard_axis: {{whose}} {{axis}} toward {{to}} {{moved}}
regard_changed: {{whose}} regard for {{to}} changed: {{parts}}
regard_settles: {{whose}} regard for {{to}} settles
draft_taken_out: taken out
draft_made: made
draft_changed: changed
draft_map_settings: In this chat's world: the map settings {{how}}
draft_path: the path from {{from}} to {{to}}
draft_map: the map {{map}}
draft_place: the place {{place}}
draft_change: In this chat's world: {{what}} {{how}}
asset_closed: {{asset}} closed {{on}} at {{price}}
asset_month_end: {{asset}}'s month-end closes
list_and: {{head}} and {{last}}
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
why_an_outputs_lines_are_the_outcome_the: an output's lines are the outcome, the montage, the outline or the brief
why_an_outputs_lines_are_texts: an output's lines are texts
why_a_scenes_lore_is_entry_ids_its: a scene's lore is entry ids, its notes are texts, and its knowledge is pov, everyone or gm
why_name_cant_go_in_holder_things_are: {{name}} can't go in {{holder}}: things are packed at most {{depth}} deep
why_name_is_built_into_what_holds_it: {{name}} is built into what holds it
why_name_is_built_in_moving_it_needs: {{name}} is built in: moving it needs a confirmed change
why_no_support_on: no support {{on}}
why_no_place_place: no place {{place}}
why_no_holder_in: no holder {{in}}
why_name_cant_hold_anything: {{name}} can't hold anything
why_name_is_a_vehicle_it_goes_only: {{name}} is a vehicle: it goes only on another vehicle
why_name_is_too_big_for_name2_to: {{name}} is too big for {{name2}} to carry, and {{name2}} is nowhere
why_name_is_too_big_for_name2_which: {{name}} is too big for {{name2}}, which takes things up to {{holds}}
why_no_thing_thing: no thing {{thing}}
why_name_is_there_already: {{name}} is there already
why_name_cant_go_inside_in: {{name}} can't go inside {{in}}
why_name_cant_go_on_on: {{name}} can't go on {{on}}
why_id_isnt_a_thing: {{id}} isn't a thing
why_no_one_id: no one {{id}}
why_this_world_plays_no_vehicles: this world plays no vehicles
why_name_is_nowhere: {{name}} is nowhere
why_id_is_already_there: {{id}} is already there
why_a_name_is_not_empty: a name is not empty
why_a_quantity_is_a_whole_number_of: a quantity is a whole number of at least 1
why_no_type_type_in_the_catalogs: no type {{type}} in the catalogs
why_to_cant_be_handed_anything: {{to}} can't be handed anything
why_a_loans_end_is_after_now: a loan's end is after now
why_name_goes_back_to_its_owner_not: {{name}} goes back to its owner, not {{name2}}
why_name_is_a_vehicle_it_is_taken: {{name}} is a vehicle: it is taken by driving it off, not by hand
why_name_may_use_name2_already: {{name}} may use {{name2}} already
why_a_grants_end_is_after_now: a grant's end is after now
why_from_needs_no_leave_of_their_own: {{from}} needs no leave of their own
why_a_permissions_end_is_after_now: a permission's end is after now
why_who_cant_wear_anything: {{who}} can't wear anything
why_name_isnt_wearing_name2: {{name}} isn't wearing {{name2}}
why_name_isnt_worn: {{name}} isn't worn
why_there_is_no_g_slot: there is no {{g}} slot
why_name_already_wears_name2: {{name}} already wears {{name2}}
why_name_is_too_big_to_wear: {{name}} is too big to wear
why_a_thing_merges_with_another: a thing merges with another
why_drop_is_the_worlds_own_merging_it: {{drop}} is the world's own: merging it is the GM's
why_name_holds_name2_so_it_cant_merge: {{name}} holds {{name2}}, so it can't merge into it
why_name_is_already_lost: {{name}} is already lost
why_by_cant_take_anything: {{by}} can't take anything
why_name_isnt_a_vehicle_only_a_vehicle: {{name}} isn't a vehicle; only a vehicle has specs
why_nothing_to_change: nothing to change
why_saved_outfits_are_the_gear_packs: saved outfits are the gear pack's
why_it_is_so_already: it is so already
why_it_rests_there_already: it rests there already
why_using_up_is_a_whole_number_of: using up is a whole number of at least 1
why_its_condition_stays_as_it_is: its condition stays as it is
why_named_isnt_where_that_could_happen: {{named}} isn't where that could happen
why_the_reply_has_made_as_many_things: the reply has made as many things as one reply may (Settings → Changes from the reply)
why_name_wasnt_made: {{name}} wasn't made
why_thing_is_too_big_to_carry: {{thing}} is too big to carry
why_type_isnt_a_change_to_a_thing: {{type}} isn't a change to a thing
why_it_names_no_thing: it names no thing
why_actor_has_it_already: {{actor}} has it already
why_actor_doesnt_have_it: {{actor}} doesn't have it
why_id_is_used_where_it_is: {{id}} is used where it is
why_slots_are_tracked_from_gear_level_3: slots are tracked from Gear level 3
why_actor_isnt_wearing_it: {{actor}} isn't wearing it
why_no_thief_by: no thief {{by}}
why_an_items_condition_moves_by_a_whole: an item's condition moves by a whole, non-zero number
why_the_world_has_no_such_thing_here: the world has no such thing here
why_the_world_has_no_such_thing_to: the world has no such thing to own
why_the_world_has_no_such_place: the world has no such place
why_it_names_nowhere_to_put_it: it names nowhere to put it
why_no_giver_from: no giver {{from}}
why_money_changes_hands_as_a_transfer: money changes hands as a transfer
why_the_world_has_no_such_thing_to_2: the world has no such thing to hand over
why_no_entity_who: no entity {{who}}
why_name_cant_be_on_support: {{name}} can't be on {{support}}
why_a_workspace_files_path_is_names_joined: a workspace file's path is names joined by /
why_a_workspace_files_body_is_a_blobs: a workspace file's body is a blob's hash
why_no_workspace_file_path: no workspace file {{path}}
why_a_pin_is_on_or_off: a pin is on or off
why_a_files_readers_are_the_player_characters: a file's readers are the player character's, everyone's or the GM's knowledge
why_no_world_fact_g_nothing: no world fact {{#g}}{{g}}{{/g}}{{^g}}nothing{{/g}}
why_knows_needs_a_fact: knows needs a fact
why_everyone_knows_themselves: everyone knows themselves
why_only_public_facts_are_read_from_a: only public facts are read from a reply
why_already_knows_fact: already knows {{fact}}
why_name_is_public: {{name}} is public
why_secret_lore_is_learned_through_its_gate: secret lore is learned through its gate, never from a reply
why_tracks_advance_through_their_stages_never_from: tracks advance through their stages, never from a reply
why_a_reply_only_teaches_the_player_character: a reply only teaches the player character
why_no_kind_kind: no kind {{kind}}
why_a_reply_introduces_characters_only: a reply introduces characters only
why_a_new_character_needs_a_plain_name: a new character needs a plain name
why_a_reply_cant_place_someone_somewhere_secret: a reply can't place someone somewhere secret
why_name_already_exists: {{name}} already exists
why_this_world_lets_no_reply_introduce_characters: this world lets no reply introduce characters
why_replies_have_introduced_cap_characters_already: replies have introduced {{cap}} characters already
why_that_newcomer_didnt_appear: that newcomer didn't appear
why_name_is_already_named_whom_the_pov: {{name}} is already {{named}}, whom the POV may not know
why_the_id_id_is_taken: the id {{id}} is taken
why_tell_names_people_by_id_or_a: tell names people by id or a selector
why_theres_no_missing_to_tell: there's no {{missing}} to tell
why_theres_no_subject: there's no {{subject}}
why_a_life_state_is_named_by_its: a life state is named by its id
why_theres_no_life_state_to: there's no life state {{to}}
why_a_life_change_needs_a_state_to: a life change needs a state to set or someone to tell
why_theres_no_one_by_that_name: there's no one by that name
why_only_people_live_and_die: only people live and die
why_name_already_reads: {{name}} already {{reads}}
why_no_check_rolls_skill: no check rolls {{skill}}
why_skill_the_attempt_isnt_a_skill_here: {{#skill}}{{skill}}{{/skill}}{{^skill}}the attempt{{/skill}} isn't a skill here
why_no_materializer_for_domain: no materializer for {{domain}}
why_domain_is_pinned_to_generator_v_pin: {{domain}} is pinned to generator v{{pin}}; this build has v{{carried}}
why_unmaterialized_needs_entity_and_domain: {{uNMATERIALIZED}} needs entity and domain
why_no_such_place: no such place
why_no_such_holder: no such holder
why_name_isnt_yours_to_put_things_on: {{name}} isn't yours to put things on
why_name_isnt_yours_to_use: {{name}} isn't yours to use
why_no_such_person: no such person
why_name_isnt_here_to_take_it: {{name}} isn't here to take it
why_this_chat_holds_you_to_the_world: This chat holds you to the world: nothing is added that the story hasn't brought in.
why_item_isnt_yours_to_change: {{item}} isn't yours to change
why_nothing_sets_its_size: nothing sets its size
why_you_arent_in_a_household: You aren't in a household
why_an_end_is_after_now: an end is after now
why_who_has_no_leave_to_use_it: {{who}} has no leave to use it
why_item_has_nowhere_its_kept: {{item}} has nowhere it's kept
why_a_loan_needs_its_end: a loan needs its end
why_not_a_field_name: not a field name
why_use_remove_or_restore: use Remove or Restore
why_label_is_worked_out_from_other_values: {{label}} is worked out from other values
why_label_is_locked: {{label}} is locked
why_add_a_number_other_than_0: add a number other than 0
why_ok_isnt_a_number: {{ok}} isn't a number
why_ok_moves_in_whole_amounts: {{ok}} moves in whole amounts
why_no_relation_type_g: no relation type {{g}}
why_name_cant_be_inside_itself: {{name}} can't be inside itself
why_an_end_time_is_a_time: an end time is a time
why_name_isnt_inside_anything: {{name}} isn't inside anything
why_name_is_already_in_name2: {{name}} is already in {{name2}}
why_no_account_account: no account {{account}}
why_an_adjustment_is_a_whole_amount_other: an adjustment is a whole amount other than nothing
why_no_tier_tier: no tier {{tier}}
why_no_domain_domain: no domain {{domain}}
why_a_level_is_a_whole_number_0: a level is a whole number 0–4
why_a_classification_is_facet_values: a classification is facet → values
why_name_is_classed_under_facet_which_isnt: {{name}} is classed under "{{facet}}", which isn't one of the world's classifications.
why_name_is_classed_as_unknown_which_isnt: {{name}} is classed as "{{unknown}}", which isn't a value of {{def}}.
why_a_name_is_1_80_characters: a name is 1–80 characters
why_id_is_taken_or_isnt_an_id: {{id}} is taken or isn't an id
why_name_is_already_removed: {{name}} is already removed
why_name_isnt_removed: {{name}} isn't removed
why_g_isnt_something_the_gm_view_can: {{g}} isn't something the GM view can run
why_a_workspace_files_path_is_names_joined_2: a workspace file's path is names joined by /, and its body a stored text
why_the_file_already_holds_that_text: the file already holds that text
why_the_file_is_already_there: the file is already there
why_there_is_a_workspace_file_to_already: there is a workspace file {{to}} already
why_the_file_is_pinned_already: the file is pinned already
why_the_file_isnt_pinned: the file isn't pinned
why_this_world_has_no_character_minds: this world has no character minds
why_this_world_has_no_cast_life: this world has no Cast life
why_removing_a_thing_from_the_world_is: removing a thing from the world is the GM's
why_this_world_cant_make_places_in_play: this world can't make places in play
why_an_organizations_change_is_the_gms: an organization's change is the GM's
why_this_world_has_no_organizations: this world has no organizations
why_the_clock_already_reads_that_time: the clock already reads that time
why_a_section_override_names_its_section: a section override names its section
why_a_section_override_is_enabled_maxtokens_maxlines: a section override is enabled, maxTokens, maxLines, include or scope
why_type_needs_k: {{type}} needs {{k}}
why_signal_needs_a_known_class: signal needs a known class
why_caught_needs_an_agent_and_a_slot: caught needs an agent and a slot
why_cursor_needs_rr: cursor needs rr
why_no_track_track: no track {{track}}
why_type_needs_n_a_whole_number_from: {{type}} needs n, a whole number from 1
why_no_stage_stage_of_track_track: no stage {{stage}} of track {{track}}
why_pause_needs_scene: pause needs scene
why_a_clock_set_back_needs_a_time: a clock set back needs a time above zero, in minutes or a part of one counted in seconds
why_agent_is_yes_or_no: agent is yes or no
why_a_level_is_a_whole_number_0_2: a level is a whole number 0–4, or null to follow the tier
why_the_classification_before_is_facet_values: the classification before is facet → values
why_tags_are_a_list_of_words: tags are a list of words
why_observed_needs_places_and_people: observed needs places and people
why_a_life_changes_witnesses_are_entity_ids: a life change's witnesses are entity ids
why_name_is_already_to: {{name}} is already {{to}}
why_told_needs_the_people_told: told needs the people told
why_a_new_place_needs_a_name: a new place needs a name
why_this_world_makes_no_places_in_play: this world makes no places in play
why_this_chat_has_made_cap_places_already: this chat has made {{cap}} places already, all its world allows
why_name_is_the_worlds_own_place_build: {{name}} is the world's own place: Build changes it
why_a_place_needs_a_name: a place needs a name
why_name_is_so_already: {{name}} is so already
why_name_is_the_worlds_own_place_build_2: {{name}} is the world's own place: Build removes it
why_the_places_in_name_go_first: the places in {{name}} go first
why_someone_or_something_is_still_at_name: someone or something is still at {{name}}
why_it_names_no_place: it names no place
why_it_names_no_place_it_is_in: it names no place it is in
why_there_is_no_one_to_roll_against: there is no one to roll against
why_no_check_check: no check {{check}}
why_a_cap_is_a_finite_number: a cap is a finite number
why_delta_must_be_finite: delta must be finite
why_a_posting_needs_two_lines: a posting needs two lines
why_amounts_are_integer_cents: amounts are integer cents
why_posting_sums_to_sum: posting sums to {{sum}}
why_link_from_to: link {{from}} → {{to}}
why_no_rel_from_from_to_to: no {{rel}} from {{from}} to {{to}}
why_not_an_entity_id: not an entity id
why_entity_id_exists: entity {{id}} exists
why_no_stage_to_in_track: no stage {{to}} in {{track}}
why_track_is_at_at_now_no_longer: {{track}} is at {{at}} now, no longer at {{from}}, where this move began
why_minutes_must_be_0: minutes must be ≥ 0
why_timelapse_ends_before_it_starts: timelapse ends before it starts
why_domain_detail_for_entity_is_already_recorded: {{domain}} detail for {{entity}} is already recorded
why_unknown_event_type_type: unknown event type {{type}}
why_track_has_no_stage_to: {{track}} has no stage {{to}}
why_track_cant_move_to_to: {{track}} can't move to {{to}}
why_that_isnt_a_change_of_the_world: that isn't a change of the world as this chat plays it
why_the_collection_id_is_drawn_by_the: the {{collection}} {{id}} is drawn by the map {{held}}: change it in that map
why_id_was_made_in_play_place_label: {{id}} was made in play: place_label and place_remove change it
why_there_is_no_collection_id_to_take: there is no {{collection}} {{id}} to take out
why_no_action_action: no action {{action}}
why_name_is_not_ana_def: {{name}} is not {{#def2}}an{{/def2}}{{^def2}}a{{/def2}} {{def}}
why_name_cant_be_the_g_of_action: {{name}} can't be the {{g}} of {{action}}
why_raw_isnt_one_of_the_name_s: {{raw}} isn't one of the {{name}}s here
why_name_must_be_a_number: {{name}} must be a number
why_name_must_be_a_scalar: {{name}} must be a scalar
why_requires_expr: requires {{expr}}
why_this_world_has_no_combat: this world has no combat
why_no_timelapse_target: no timelapse target
why_levelfield_follows_xpfield_change_xpfield_instead: {{levelField}} follows {{xpField}}: change {{xpField}} instead
why_field_is_derived: {{field}} is derived
why_name_s_g_is_not_a_number: {{name}}'s {{g}} is not a number
why_set_needs_a_field: set needs a field
why_field_must_be_one_of_values: {{field}} must be one of {{values}}
why_add_needs_a_numeric_delta: add needs a numeric delta
why_name_s_g_isnt_a_pool: {{name}}'s {{g}} isn't a pool
why_recover_needs_a_numeric_amount: recover needs a numeric amount
why_name_s_g_has_no_max_to: {{name}}'s {{g}} has no max to recover to
why_no_progression_id: no progression {{id}}
why_name_has_no_prog: {{name}} has no {{prog}}
why_award_needs_a_numeric_amount: award needs a numeric amount
why_link_needs_rel: link needs rel
why_post_needs_lines: post needs lines
why_unknown_interrupt_class_cls: unknown interrupt class {{cls}}
why_a_check_applies_its_outcomes_run_it: a check applies its outcomes; run it through applyEffects
why_unknown_effect_type: unknown effect {{type}}
why_effects_nested_past_nesting_cap_levels: effects nested past {{nESTING_CAP}} levels
why_no_check_check_given: no check {{#string}}{{check}}{{/string}}{{^string}}given{{/string}}
why_calendar_time_is_off: Calendar & time is off
why_no_day_part_daypart: no day part {{dayPart}}
why_no_upcoming_shift: no upcoming shift
why_no_upcoming_commitment: no upcoming commitment
why_no_active_trip: no active trip
why_already_at_that_stage: already at that stage
why_that_time_has_passed: that time has passed
why_the_clock_is_paused_resume_it_first: The clock is paused; resume it first.
why_that_isnt_a_date_and_time_of: that isn't a date and time of day in this world's calendar (YYYY-MM-DD HH:MM)
why_too_much_happens_before_then_to_run: too much happens before then to run in one go; a Timelapse to that time gets there in steps
why_the_clock_moves_on_at_most_timelapseminutes: the clock moves on at most {{timelapseMinutes}} days at a time
why_the_cash_rule_is_true_false_or: the cash rule is true, false or null (the world's)
why_the_cash_rule_is_on_off_or: the cash rule is on, off or the world's (null)
why_name_isnt_a_company: {{name}} isn't a company
why_name_was_dissolved_on_dissolved: {{name}} was dissolved on {{dissolved}}
why_name_is_listed_on_the_market_delist: {{name}} is listed on the market: delist it first
why_name_is_wound_up_or_merged_from: {{name}} is wound up or merged from Money 3
why_business_you_may_not_power: {{business}}: you may not {{power}}
why_bizname_has_no_owners_to_pay_out: {{bizName}} has no owners to pay out to
why_id_couldnt_be_sold: {{id}} couldn't be sold
why_bizname_s_stake_in_id_couldnt_be: {{bizName}}'s stake in {{id}} couldn't be sold
why_bizname_owes_owing_and_holds_cash_it: {{bizName}} owes {{owing}} and holds {{cash}}: it is {{cash2}} short. Sell something first, or put money in.
why_party_has_no_account_their_share_of: {{party}} has no account their share of {{bizName}} could go to
why_business_is_winding_up_already: {{business}} is winding up already
why_name_cant_merge_with_itself: {{name}} can't merge with itself
why_id_is_winding_up: {{id}} is winding up
why_intoname_is_worth_nothing_a_unit_say: {{intoName}} is worth nothing a unit: say how many of its units each of {{name}}'s is worth, or a price
why_name_s_holders_would_get_nothing_say: {{name}}'s holders would get nothing: say a ratio or a price
why_intoname_has_no_account_to_pay_from: {{intoName}} has no account to pay from
why_party_has_no_account_the_money_could: {{party}} has no account the money could go to
why_name_cant_pay_what_it_owes_in: {{name}} can't pay what it owes {{#sales_tax}}in sales tax{{/sales_tax}}{{^sales_tax}}its suppliers{{/sales_tax}} ({{cents}})
why_name_cant_pay_its_unemployment_tax_cents: {{name}} can't pay its unemployment tax ({{cents}})
why_name_cant_pay_its_income_tax_cents: {{name}} can't pay its income tax ({{cents}})
why_a_price_is_a_whole_amount: a price is a whole amount
why_business_has_no_units_to_value_one: {{business}} has no units to value one by: say the price a unit
why_say_a_whole_number_of_units: say a whole number of units
why_no_one_to_to_issue_shares_to: no one {{to}} to issue shares to
why_name_has_no_class_named_its_classes: {{name}} has no class {{named}}: its classes are {{c}}
why_name_has_no_account_to_take_the: {{name}} has no account to take the money
why_holder_holds_no_units_of_name: {{holder}} holds no units of {{name}}
why_holder_holds_held_units_of_name_not: {{holder}} holds {{held}} units of {{name}}, not {{units}}
why_a_class_needs_a_name: a class needs a name
why_name_has_no_class_id: {{name}} has no class {{id}}
why_g_isnt_a_kind_of_credit: {{g}} isn't a kind of credit
why_a_streams_record_needs_its_stream_and: a stream's record needs its stream and month
why_stream_that_isnt_a_revenue_stream: {{#stream}}{{stream}}{{/stream}}{{^stream}}That{{/stream}} isn't a revenue stream
why_an_adjustment_is_either_a_factor_or: an adjustment is either a factor or an amount, one of them
why_a_factor_is_a_number_nothing_or: a factor is a number, nothing or more
why_an_amount_is_a_whole_number_other: an amount is a whole number other than nothing, in or out
why_an_adjustment_lasts_a_whole_number_of: an adjustment lasts a whole number of days, one or more
why_an_adjustment_says_why_the_gms_reason: an adjustment says why: the GM's reason, or what the story said
why_that_isnt_a_revenue_stream: that isn't a revenue stream
why_an_adjustment_ends_after_it_starts: an adjustment ends after it starts
why_a_revenue_change_quotes_what_the_story: a revenue change quotes what the story said
why_theres_no_project_project: there's no project {{project}}
why_name_has_no_step_step: {{name}} has no step {{step}}
why_a_project_step_needs_its_instant: a project step needs its instant
why_name_is_done: {{name}} is done
why_name_has_started: {{name}} has started
why_name_waits_for_the_steps_before_it: {{name}} waits for the steps before it
why_name_hasnt_started: {{name}} hasn't started
why_name_cant_wait_to_side: {{name}} can't wait to {{side}}
why_a_project_step_is_started_waits_or: a project step is started, waits or is done, not {{phase}}
why_theres_no_such_step: there's no such step
why_a_note_sets_a_step_back_by: a note sets a step back by whole days or adds to its cost
why_from_doesnt_have_cents: {{from}} doesn't have {{cents}}
why_theres_no_project_project_named: there's no project {{#project}}{{project}}{{/project}}{{^project}}named{{/project}}
why_theres_no_org_party_to_run_it: there's no {{#org}}{{org}}{{/org}}{{^org}}party{{/org}} to run it
why_a_new_project_needs_a_template: a new project needs a template
why_theres_no_project_template_template: there's no project template {{template}}
why_a_project_needs_at_least_one_step: a project needs at least one step
why_its_steps_wait_on_each_other_in: its steps wait on each other in a ring
why_account_isnt_org_s_to_spend: {{account}} isn't {{org}}'s to spend
why_projects_run_from_money_3: projects run from Money 3
why_org_runs_open_max_projects_at_most: {{org}} runs {{oPEN_MAX}} projects at most at once
why_name_cant_be_set_up: {{name}} can't be set up
why_name_cant_start: {{name}} can't start
why_name_cant_be_paused: {{name}} can't be paused
why_name_cant_resume: {{name}} can't resume
why_name_cant_be_dropped: {{name}} can't be dropped
why_every_step_of_name_is_done: every step of {{name}} is done
why_name_is_done_a_note_sets_back: {{name}} is done: a note sets back or adds to a step still to finish
why_a_note_sets_a_step_back_by_2: a note sets a step back by whole days, {{maxDays}} at most
why_a_note_adds_to_a_steps_cost: a note adds to a step's cost up to {{cap}}, the world's narrated-price cap
why_a_note_sets_a_step_back_or: a note sets a step back or adds to its cost
why_a_note_says_why_in_the_storys: a note says why, in the story's words
why_name_cant_take_the_note: {{name}} can't take the note
why_it_comes_to_cents_now_more_than: It comes to {{cents}} now, more than the {{cents2}} approved
why_no_holding_holding: no holding {{holding}}
why_lots_change_by_a_number_of_units: lots change by a number of units
why_lots_change_for_a_whole_amount_nothing: lots change for a whole amount, nothing or more
why_name_holds_held_units_not_qty: {{name}} holds {{held}} units, not {{qty}}
why_account_keeps_what_its_holdings_pay_move: {{account}} keeps what its holdings pay; move it out from the account itself
why_no_party: no {{party}}
why_investments_arent_followed_at_this_money_level: investments aren't followed at this money level
why_options_arent_followed_at_this_money_level: options aren't followed at this money level
why_no_options_are_written_on_assetid_s: no options are written on {{assetId}}'s stock: its units sell only from its float
why_theres_no_right_on_assetid_at_that: there's no {{right}} on {{assetId}} at that strike and expiry
why_no_asset_assetid_named: no asset {{#assetId}}{{assetId}}{{/assetId}}{{^assetId}}named{{/assetId}}
why_asset_changes_hands_as_a_property_or: {{asset}} changes hands as a property or a stake, not a trade
why_party_takes_its_own_units_back_by: {{party}} takes its own units back by buying back shares or going off the market
why_account_doesnt_hold_investments: {{account}} doesn't hold investments
why_account_isnt_party_s_to_trade_in: {{account}} isn't {{party}}'s to trade in
why_holding_isnt_party_s_to_trade: {{holding}} isn't {{party}}'s to trade
why_asset_has_expired: {{asset}} has expired
why_asset_has_matured: {{asset}} has matured
why_asset_has_no_price_to_trade_at: {{asset}} has no price to trade at
why_amount_buys_no_whole_unitcontract_at_price: {{amount}} buys no whole {{#listed}}unit{{/listed}}{{^listed}}contract{{/listed}} at {{price}}
why_say_how_much_to_buy: say how much to buy
why_only_left_units_of_asset_are_for: Only {{left}} units of {{asset}} are for sale on the market
why_no_units_of_asset_are_for_sale: No units of {{asset}} are for sale on the market
why_party_holds_business_s_units_on_its: {{party}} holds {{business}}'s units on its cap table, not on the market: sell them as a stake
why_party_holds_no_asset: {{party}} holds no {{asset}}
why_say_how_much_to_sell: say how much to sell
why_holding_holds_held_not_qty: {{holding}} holds {{held}}, not {{qty}}
why_holding_isnt_party_s_to_manage: {{holding}} isn't {{party}}'s to manage
why_account_keeps_what_its_holdings_pay: {{account}} keeps what its holdings pay
why_no_organization_org: no organization {{org}}
why_org_pays_out_to_its_owners_by: {{org}} pays out to its owners by their shares
why_dues_are_an_amount_every_join: dues are an amount every {{join}}
why_a_share_out_needs_an_amount: a share out needs an amount
why_org_has_nobody_to_share_with: {{org}} has nobody to share with
why_org_holds_no_money_to_share_out: {{org}} holds no money to share out
why_no_provider_for_flow: nothing works out {{flow}}
why_flow_splits_a_payment_that_has_no: {{flow}} splits a payment that has no account to pay from
why_account_is_g: {{account}} is {{g}}
why_account_cant_be_drawn_on: {{account}} can't be drawn on
why_account_cant_cover_currency: {{account}} can't cover {{currency}}
why_flow_pays_itself: {{flow}} pays itself
why_flow_doesnt_balance: {{flow}} doesn't balance
why_flow_has_no_shares: {{flow}} has no shares
why_party_s_share_reason: {{party}}'s share: {{reason}}
why_party_s_share_cant_be_covered: {{party}}'s share can't be covered
why_a_companys_structure_is_one_of_join: a company's structure is one of {{join}}
why_a_sole_proprietorship_has_exactly_one_owner: A sole proprietorship has exactly one owner; {{business}} has {{size}}
why_business_cant_become_an_s_corporation_scorp: {{business}} can't become an S corporation: {{scorp}}
why_business_is_an_s_corporation_problem: {{business}} is an S corporation: {{problem}}
why_estimated_tax_needs_its_payer_and_the: estimated tax needs its payer and the periods it pays
why_only_a_c_corporation_that_pays_income: Only a C corporation that pays income tax files a consolidated return; {{org}} is {{#org3}}exempt{{/org3}}{{^org3}}{{org2}}{{/org3}}
why_org_already_filesdoesnt_file_a_consolidated_return: {{org}} {{#elect}}already files{{/elect}}{{^elect}}doesn't file{{/elect}} a consolidated return
why_a_payslip_needs_its_job_its_worker: a payslip needs its job, its worker and the time it pays through
why_a_timesheet_entry_needs_its_job_and: a timesheet entry needs its job and minutes
why_a_commission_credit_needs_its_job_and: a commission credit needs its job and amount
why_no_employer_employer: no employer {{employer}}
why_no_person_worker: no person {{worker}}
why_employer_has_no_position_position: {{employer}} has no position {{position}}
why_worker_already_employed_by_employer: {{worker}} already works for {{employer}}
why_no_job_job: no job {{job}}
why_that_job_has_already_ended: that job has already ended
why_a_raise_needs_a_new_rate_above: a raise needs a new rate above nothing, or a percentage
why_hours_a_week_are_more_than_none: hours a week are more than none and at most 168
why_who_is_already_on_leave: {{who}} is already on leave
why_who_isnt_on_leave: {{who}} isn't on leave
why_who_already_holds_title: {{who}} already holds {{title}}
why_who_holds_no_position: {{who}} holds no position
why_who_already_goes_by_words: {{who}} already goes by {{words}}
why_who_s_job_has_no_title_of: {{who}}'s job has no title of its own
why_a_pay_schedule_is_join: a pay schedule is {{join}}
why_given_isnt_a_date: {{given}} isn't a date
why_a_year_close_names_its_party_its: a year close names its party, its year and its record
why_a_foundations_mark_names_it_the_month: a foundation's mark names it, the month and its assets
why_a_dividend_received_names_its_receiver_its: a dividend received names its receiver, its payer, its amount and what is deducted of it
why_a_consent_dividend_names_its_corporation_its: a consent dividend names its corporation, its year, its amount and each holder's part
why_a_penalty_tax_names_its_payer_its: a penalty tax names its payer, its year and its amount
why_a_foundations_tax_names_it_its_year: a foundation's tax names it, its year and its amount
why_only_a_c_corporation_that_pays_income_2: Only a C corporation that pays income tax declares a consent dividend; {{org}} isn't one
why_a_consent_dividend_is_more_than_nothing: a consent dividend is more than nothing
why_a_consent_dividend_counts_for_this_year: A consent dividend counts for this year ({{year}}) or, until its return is filed on 15 April, the last
why_org_s_return_for_year_is_filed: {{org}}'s return for {{year}} is filed already
why_org_has_no_holders_to_consent: {{org}} has no holders to consent
why_card_was_declined_for_cents: {{card}} was declined for {{cents}}
why_name_has_nothing_that_covers_cents_or: {{name}} has nothing that covers {{cents}} or can run a debt, so nothing was paid
why_name_s_card_was_declined: {{name}}'s card was declined
why_name_doesnt_have_cents_available: {{name}} doesn't have {{cents}} available
why_no_payer_payer: no payer {{payer}}
why_cash_back_comes_only_with_a_debit: cash back comes only with a debit card
why_cash_back_needs_an_account: cash back needs an account
why_payer_cant_afford_currency: {{payer}} can't afford {{currency}}
why_payer_has_nowhere_to_carry_cash: {{payer}} has nowhere to carry cash
why_the_amount_must_be_positive: the amount must be positive
why_payer_cant_pay_account_from_itself: {{payer}} can't pay {{account}} from itself
why_theres_no_account_account: there's no account {{account}}
why_party_cant_spend_from_account: {{party}} can't spend from {{account}}
why_account_cant_be_drawn_on_here: {{account}} can't be drawn on here
why_account_is_closed: {{account}} is closed
why_account_isnt_party_s: {{account}} isn't {{party}}'s
why_account_is_a_loan_made_only_its: {{account}} is a loan made: only its borrower's payments reach it
why_account_takes_nothing_in_after_it_opens: {{account}} takes nothing in after it opens
why_both_accounts_must_exist: both accounts must exist
why_from_cant_pay_itself: {{from}} can't pay itself
why_both_accounts_must_belong_to_the_same: both accounts must belong to the same holder
why_to_owes_nothing: {{to}} owes nothing
why_to_owes_only_currency: {{to}} owes only {{currency}}
why_id_isnt_someone_or_an_account_someone: {{id}} isn't someone, or an account someone can {{#from}}pay from{{/from}}{{^from}}pay into{{/from}}
why_from_cant_pay_themselves: {{from}} can't pay themselves
why_cash_cant_be_less_than_nothing: cash can't be less than nothing
why_holder_carries_no_cash: {{holder}} carries no cash
why_cash_said_to_be_had_is_a: cash said to be had is a whole amount above zero
why_theres_no_purchase_to_reprice: there's no purchase to reprice
why_theres_no_payment_to_pay_another_way: there's no payment to pay another way
why_no_other_way_to_pay_covers_it: No other way to pay covers it.
why_price_needs_a_symbol_and_a_positive: price needs a symbol and a positive price
why_a_quote_names_its_asset: a quote names its asset
why_a_quote_carries_a_price_or_a: a quote carries a price or a yield
why_a_price_is_above_zero: a price is above zero
why_a_yield_is_a_percentage: a yield is a percentage
why_closes_name_their_asset: closes name their asset
why_closes_are_one_to_closes_kept_months: closes are one to {{cLOSES_KEPT}} months
why_a_close_is_a_month_yyyy_mm: a close is a month (YYYY-MM) and a price above zero
why_a_minted_asset_is_an_option_contract: a minted asset is an option contract
why_id_is_an_authored_asset: {{id}} is an authored asset
why_no_asset_underlying: no asset {{underlying}}
why_label_is_priced_from_underlying_set_its: {{label}} is priced from {{underlying}}; set its price instead
why_label_is_valued_from_what_it_stands: {{label}} is valued from what it stands for
why_a_sale_needs_its_business_and_price: a sale needs its business and price
why_a_remittance_needs_its_business_and_what: a remittance needs its business and what it settles
why_an_invoice_payment_needs_its_invoice_and: an invoice payment needs its invoice and amount
why_no_business_business: no business {{business}}
why_an_invoice_needs_someone_to_bill: an invoice needs someone to bill
why_pov_runs_customer_for_others_so_cant: {{pov}} runs {{customer}} for others, so can't bill it for {{business}}
why_an_invoice_needs_an_amount: an invoice needs an amount
why_business_can_bill_customers_outside_the_world: {{business}} can bill customers outside the world at most {{cap}} a month, and has billed {{billed}}
why_no_invoice_invoice: no invoice {{invoice}}
why_memo_is_voidpaid: {{memo}} is {{#void}}void{{/void}}{{^void}}paid{{/void}}
why_by_isnt_billed_for_memo: {{by}} isn't billed for {{memo}}
why_party_pays_for_itself_not_for_pov: {{party}} pays for itself, not for {{pov}}
why_a_payout_needs_its_business_and_amount: a payout needs its business and amount
why_business_is_a_corporation_it_pays_its: {{business}} is a corporation: it pays its owners by salary or dividends
why_owner_doesnt_own_business: {{owner}} doesn't own {{business}}
why_a_draw_needs_an_amount: a draw needs an amount
why_business_has_no_account_to_draw_on: {{business}} has no account to draw on
why_no_business_or_trust_business: no business or trust {{business}}
why_business_pays_out_a_stated_amount_say: {{business}} pays out a stated amount: say how much goes to its beneficiaries
why_business_has_no_profit_to_distribute: {{business}} has no profit to distribute
why_business_has_no_beneficiaries_with_a_share: {{business}} has no beneficiaries with a share, or no account to pay from
why_business_has_no_owners_with_a_share: {{business}} has no owners with a share, or no account to pay from
why_a_route_names_a_business_and_its: a route names a business and its owner
why_business_isnt_a_business: {{business}} isn't a business
why_owner_owns_no_part_of_business: {{owner}} owns no part of {{business}}
why_name_doesnt_count_its_shares_in_units: {{name}} doesn't count its shares in units: sell a share of it in percent
why_say_how_many_units_to_sell: say how many units to sell
why_say_what_share_to_sell: say what share to sell
why_party_owns_held_of_name_not_share: {{party}} owns {{held}}% of {{name}}, not {{share}}%
why_no_buyer_buyer: no buyer {{buyer}}
why_selling_part_of_name_needs_a_buyer: selling part of {{name}} needs a buyer in the world
why_no_buyer_outside_the_world_pays_more: no buyer outside the world pays more than {{currency}} for {{name}}
why_theres_no_one_to_lend_it: there's no one to lend it
why_theres_no_one_to_borrow_it: there's no one to borrow it
why_lender_cant_lend_to_itself: {{lender}} can't lend to itself
why_a_loan_needs_an_amount: a loan needs an amount
why_party_s_money_isnt_followed_closely_enough: {{party}}'s money isn't followed closely enough for loans between parties (Money 3)
why_lender_cant_lend_from_named: {{lender}} can't lend from {{named}}
why_lender_has_no_account_with_cents_to: {{lender}} has no account with {{cents}} to lend
why_source_has_less_than_cents: {{source}} has less than {{cents}}
why_borrower_has_no_bank_account_to_take: {{borrower}} has no bank account to take the loan into
why_borrower_has_to_agree_to_borrow_it: {{borrower}} has to agree to borrow it: ask them
why_a_ticker_is_a_letter_and_up: a ticker is a letter and up to five more letters, digits or dots
why_symbol_is_already_another_assets_ticker: {{symbol}} is already another asset's ticker
why_say_a_ticker_for_it: say a ticker for it
why_only_a_c_corporation_lists_on_a: Only a C corporation lists on a market: change {{name}}'s structure first
why_name_has_no_owners_to_list_it: {{name}} has no owners to list it for
why_a_price_a_unit_is_above_nothing: a price a unit is above nothing
why_name_s_books_give_its_units_no: {{name}}'s books give its units no value yet, so the public pays nothing for them
why_the_public_pays_no_more_than_multiple: the public pays no more than {{^multiple2}}{{multiple}} times {{/multiple2}}its {{#listing}}market price{{/listing}}{{^listing}}books a unit{{/listing}} for new units of {{name}}, {{cap}} a unit
why_name_isnt_on_a_market: {{name}} isn't on a market
why_the_public_sells_at_no_less_than: the public sells at no less than its market price, {{market}} a unit
why_holding_has_no_account_to_be_paid: {{holding}} has no account to be paid into
why_party_holds_no_units_of_name_on: {{party}} holds no units of {{name}} on its cap table
why_name_keeps_an_owner_on_its_cap: {{name}} keeps an owner on its cap table: sell to someone in the world, or take it off the market
why_a_depreciation_needs_its_asset_its_month: a depreciation needs its asset, its month, its amount and its parts
why_who_cant_draw_cash_from_account: {{who}} can't draw cash from {{account}}
why_no_such_account: no such account
why_none_of_who_s_cards_on_account: none of {{who}}'s cards on {{account}} works
why_account_has_no_card_for_a_cash: {{account}} has no card for a cash machine
why_the_machine_gives_at_most_limit_at: the machine gives at most {{limit}} at a time
why_card_has_atm_left_of_its_daily: {{card}} has {{atm}} left of its daily cash limit
why_theres_no_cash_machine_or_institution_bank: there's no cash machine or {{#institution}}{{institution}}{{/institution}}{{^institution}}bank{{/institution}} branch here
why_who_cant_pay_cash_into_account: {{who}} can't pay cash into {{account}}
why_who_doesnt_have_cents_in_cash: {{who}} doesn't have {{cents}} in cash
why_theres_no_institution_bank_branch_or_deposit: there's no {{#institution}}{{institution}}{{/institution}}{{^institution}}bank{{/institution}} branch or deposit machine here
why_card_isnt_a_payment_card: {{card}} isn't a payment card
why_a_card_cant_be_v: a card can't be {{v}}
why_name_is_now_replace_it: {{name}} is {{now}}; replace it
why_name_was_already_replaced: {{name}} was already replaced
why_who_cant_pay_from_from: {{who}} can't pay from {{from}}
why_account_is_paid_from_who_s_own: {{account}} is paid from {{who}}'s own money, not from {{from}}
why_account_isnt_a_card_or_a_loan: {{account}} isn't a card or a loan
why_account_isnt_who_s_to_change: {{account}} isn't {{who}}'s to change
why_autopay_cant_be_mode: autopay can't be {{mode}}
why_fixed_autopay_needs_an_amount: fixed autopay needs an amount
why_a_flow_cant_be_a_flow_kind: a flow can't be a {{flow_kind}}
why_theres_no_shortfall_policy_shortfall: there's no shortfall policy {{shortfall}}
why_a_one_off_flow_needs_its_date: a one-off flow needs its date and time
why_a_flow_cant_fall_every_every: a flow can't fall every {{every}}
why_who_cant_fall_back_on_fallback: {{who}} can't fall back on {{fallback}}
why_a_fallback_is_an_account_of_who: a fallback is an account of {{who}}'s, not "{{fallback}}"
why_paying_pays_for_holder_not_for_who: {{paying}} pays for {{holder}}, not for {{who}}
why_a_flow_needs_who_pays_who_is: a flow needs who pays, who is paid and an amount
why_a_flow_needs_a_schedule: a flow needs a schedule
why_a_standing_payments_g_cant_be_cleared: a standing payment's {{g}} can't be cleared
why_flow_isnt_a_standing_payment: {{flow}} isn't a standing payment
why_a_standing_payments_g_cant_be_both: a standing payment's {{g}} can't be both changed and cleared
why_theres_no_product_g: there's no product {{g}}
why_an_account_needs_an_owner: an account needs an owner
why_payment_preferences_are_a_list_of_ways: payment preferences are a list of ways to pay
why_account_isnt_an_account: {{account}} isn't an account
why_account_still_has_account2_on_it: {{account}} still has {{account2}} on it
why_account_opens_with_opening_still_to_post: {{account}} opens with {{opening}} still to post
why_an_account_cant_be_status: an account can't be {{status}}
why_an_unemployment_tax_accrual_needs_its_employer: an unemployment tax accrual needs its employer, its year and its quarter
why_an_unemployment_tax_payment_needs_its_employer: an unemployment tax payment needs its employer, its kind (futa or suta) and the periods it pays
why_a_donation_needs_its_donor_its_receiver: a donation needs its donor, its receiver, its amount and its year
why_a_gift_names_who_gives_it: a gift names who gives it
why_to_isnt_someone_or_something_to_give: {{to}} isn't someone or something to give to
why_a_gift_is_more_than_nothing: a gift is more than nothing
why_status_isnt_a_status_in_this_worlds: "{{status}}" isn't a status in this world's exempt table ({{#rows}}{{rows}}{{/rows}}{{^rows}}none{{/rows}})
why_org_isnt_exemptis_exempt_as_status_already: {{org}} {{#status2}}isn't exempt{{/status2}}{{^status2}}is exempt as {{status}} already{{/status2}}
why_no_property_property: no property {{property}}
why_property_isnt_followed_at_this_money_level: property isn't followed at this money level
why_name_is_already_party_s: {{name}} is already {{party}}'s
why_name_isnt_for_sale: {{name}} isn't for sale
why_a_price_is_above_nothing: a price is above nothing
why_the_sellers_want_floor_for_name: the sellers want {{floor}} for {{name}}
why_name_is_worth_floor: {{name}} is worth {{floor}}
why_a_down_payment_is_between_nothing_and: a down payment is between nothing and the price
why_a_lender_wants_at_least_leastdown_down: a lender wants at least {{leastDown}} down on {{name}}
why_lenders_offer_mortgages_over_years_or_years2: lenders offer mortgages over {{#years4}}{{years}} or {{years2}}{{/years4}}{{^years4}}{{years3}}{{/years4}} years
why_the_price_doesnt_cover_what_name_s: the price doesn't cover what {{name}}'s sellers owe on it
why_name_is_a_property_already: {{name}} is a property already
why_no_owner_owner: no owner {{owner}}
why_name_isnt_party_s_to_sell: {{name}} isn't {{party}}'s to sell
why_selling_a_share_of_name_needs_a: selling a share of {{name}} needs a buyer in the world
why_name_isnt_party_s_to_let: {{name}} isn't {{party}}'s to let
why_no_tenant_tenant: no tenant {{tenant}}
why_rent_is_above_nothing: rent is above nothing
why_every_unit_of_name_is_let: every unit of {{name}} is let
why_party_has_no_account_the_rent_could: {{party}} has no account the rent could go to
why_no_lease_lease: no lease {{lease}}
why_name_isnt_party_s_to_end: {{name}} isn't {{party}}'s to end
why_a_lease_ends_on_a_date_yyyy: a lease ends on a date (YYYY-MM-DD)
why_payer_cant_pay_from_id_they_can: {{payer}} can't pay from {{id}}; they can pay from {{payer2}}
why_no_account_or_card_id_payer_can: no account or card {{id}}; {{payer}} can pay from {{payer2}}
why_no_one_can_pay_from_from: no one can pay from {{from}}
why_a_payer_must_be_an_account_holder: a payer must be an account holder
why_no_property_or_place_property: no property or place {{property}}
why_a_purchase_needs_an_item_or_a: a purchase needs an item or a category
why_a_transfer_needs_a_payer_and_a: a transfer needs a payer and a payee
why_a_transfer_needs_a_positive_amount: a transfer needs a positive amount
why_no_price_for_category: no price for {{category}}
why_car_loans_run_min_to_max_months: car loans run {{min}} to {{max}} months
why_a_price_modifier_cant_make_things_free: a price modifier can't make things free
why_card_isnt_who_s_to_pay: {{card}} isn't {{who}}'s to pay
why_who_has_no_account_to_pay_card: {{who}} has no account to pay {{card}} from
why_party_cant_hold_money: {{party}} can't hold money
why_g_is_a_day_of_the_month: {{g}} is a day of the month, 1 to 31
why_a_disposal_names_what_was_sold_and: a disposal names what was sold and who sold it
why_a_disposal_is_of_a_part_of: a disposal is of a part of a share
why_a_disposals_proceeds_are_a_whole_amount: a disposal's proceeds are a whole amount
why_an_acquisition_names_what_was_bought_and: an acquisition names what was bought and who bought it
why_an_acquisition_costs_a_whole_amount: an acquisition costs a whole amount
why_a_trusts_distribution_names_the_trust_and: a trust's distribution names the trust and each beneficiary's part
why_anchor_needs_entity_typical_and_base: anchor needs entity, typical and base
why_a_money_note_needs_a_party_and: a money note needs a party and its text
why_a_price_modifier_needs_an_id_and: a price modifier needs an id and a positive multiplier
why_statements_are_for_credit_accounts: statements are for credit accounts
why_statement_payments_are_for_credit_accounts: statement payments are for credit accounts
why_a_delinquency_stage_needs_a_credit_account: a delinquency stage needs a credit account and a stage
why_a_flow_run_needs_its_flow_and: a flow run needs its flow and state
why_a_rename_needs_a_standing_payment_and: a rename needs a standing payment and a name of up to 80 characters
why_a_hold_needs_an_account_and_an: a hold needs an account and an id
why_a_hold_needs_an_amount_and_an: a hold needs an amount and an end
why_settling_needs_an_account_and_a_time: settling needs an account and a time
why_a_credit_entry_needs_a_person_and: a credit entry needs a person and a kind
why_a_score_needs_a_person_and_a: a score needs a person and a number
why_card_spending_needs_a_card_and_a: card spending needs a card and a day
why_only_accounts_open: only accounts open
why_name_is_already_open: {{name}} is already open
why_name_is_not_open: {{name}} is not open
why_nothing_to_open: nothing to open
why_a_status_needs_an_account_and_a: a status needs an account and a status
why_an_accrual_needs_an_account_and_a: an accrual needs an account and a time
why_an_exercise_names_its_contracts_and_the: an exercise names its contracts and the holding of their underlying
why_an_exercise_is_a_number_of_contracts: an exercise is a number of contracts, their units and the strike's cash
why_option_holds_fewer_than_qty_contracts: {{option}} holds fewer than {{qty}} contracts
why_into_holds_fewer_than_units_units_to: {{into}} holds fewer than {{units}} units to deliver
why_an_exercise_is_of_a_call_or: an exercise is of a call or a put
why_name_isnt_an_option: {{name}} isn't an option
why_name_isnt_party_s_to_exercise: {{name}} isn't {{party}}'s to exercise
why_party_holds_no_whole_contract_of_label: {{party}} holds no whole contract of {{label}}
why_name_holds_held_contracts_not_qty: {{name}} holds {{held}} contracts, not {{qty}}
why_label_is_worth_nothing_to_exercise: {{label}} is worth nothing to exercise
why_party_has_no_account_to_pay_the: {{party}} has no account to pay the strike from
why_exercising_qty_label_delivers_units_under_which: exercising {{qty}} {{label}} delivers {{units}} {{under}}, which {{party}} doesn't hold{{#account}} in {{account}}{{/account}}
why_nobody_holding_label_has_an_account_the: nobody holding {{label}} has an account the cash could go to
why_rent_goes_to_an_account: rent goes to an account
why_say_which_holding_property_or_business: say which holding, property or business
why_income_is_a_dividend_interest_or_a: income is a dividend, interest or a profit share
why_income_is_a_whole_amount_above_nothing: income is a whole amount above nothing
why_who_its_with_is_a_list_of: who it's with is a list of people
why_name_isnt_a_person: {{name}} isn't a person
why_a_note_needs_its_text: a note needs its text
why_a_notes_salience_is_1_to_5: a note's salience is 1 to 5
why_a_commitment_needs_its_text: a commitment needs its text
why_a_commitment_is_one_of_join: a commitment is one of {{join}}
why_a_commitments_status_is_one_of_join: a commitment's status is one of {{join}}
why_a_commitments_due_time_is_game_minutes: a commitment's due time is game minutes
why_a_plan_needs_what_it_is: a plan needs what it is
why_a_plan_needs_when_from_and_to: a plan needs when, from and to in game minutes, to not before from
why_a_plan_is_one_of_join: a plan is one of {{join}}
why_theres_no_place_where_like_that: there's no place {{#where}}{{where}}{{/where}}{{^where}}like that{{/where}}
why_a_plans_priority_is_min_to_max: a plan's priority is {{min}} to {{max}}
why_a_plans_status_is_open_done_or: a plan's status is open, done or dropped
why_a_pay_or_lend_plan_needs_an: a pay or lend plan needs an amount in minor units and someone to hand it to
why_the_minds_hold_no_such_fact: the minds hold no such fact
why_name_doesnt_hold_that: {{name}} doesn't hold that
why_a_holding_is_how_its_held_and: a holding is how it's held and by whom (one told names its teller), its evidence, since when, the belief, a confidence from 0 to 1 and whom it's kept from
why_a_holding_rests_on_facts_the_minds: a holding rests on facts the minds hold, never on itself
why_name_doesnt_have_a_mind: {{name}} doesn't have a mind
why_say_what_they_mean_to_do_or: say what they mean to do, or how they go about it
why_name_has_no_such_note: {{name}} has no such note
why_say_which_note_to_delete: say which note to delete
why_name_has_no_such_commitment: {{name}} has no such commitment
why_say_which_commitment_to_delete: say which commitment to delete
why_name_has_no_such_plan: {{name}} has no such plan
why_say_which_plan_to_delete: say which plan to delete
why_a_minds_event_names_someone_who_isnt: a minds event names someone who isn't in the world
why_a_minds_round_needs_its_clock_whether: a minds round needs its clock, whether minds are on, and each passed mind's level and place
why_a_mind_needs_its_clock_place_level: a mind needs its clock, place, level, moment and reason
why_a_mind_needs_its_monologue_depiction_intent: a mind needs its monologue, depiction, intent and reactions, and any plans it carries well formed
why_a_minds_mood_interrupt_or_withheld_flag: a mind's mood, interrupt or withheld flag is malformed
why_a_memory_needs_its_clock_notes_and: a memory needs its clock, notes and commitments
why_a_memorys_resolved_commitments_are_malformed: a memory's resolved commitments are malformed
why_a_memorys_plans_told_or_summary_are: a memory's plans, told or summary are malformed
why_a_presence_record_needs_its_clock_message: a presence record needs its clock, message, place, who and what they saw
why_a_plans_status_needs_the_plan_a: a plan's status needs the plan, a status, its clock and a reason or null
why_that_plan_isnt_theirs_any_more: that plan isn't theirs any more
why_a_key_edit_needs_the_key_s: a {{key}} edit needs the {{key}}'s id
why_that_key_isnt_theirs_any_more: that {{key}} isn't theirs any more
why_a_key_edits_value_is_malformed: a {{key}} edit's value is malformed
why_a_commitments_status_needs_the_commitment_a: a commitment's status needs the commitment, a status, its clock and a reason or null
why_that_commitment_isnt_theirs_any_more: that commitment isn't theirs any more
why_a_consolidation_needs_its_clock_the_notes: a consolidation needs its clock, the notes folded and the summary
why_a_pin_is_a_fidelity_level_or: a pin is a fidelity level or null
why_an_intent_is_its_text_its_approach: an intent is its text, its approach or both, or null to clear it
why_a_skips_beats_need_their_span_and: a skip's beats need their span and each beat's clock, reason and source
why_a_knowledge_event_names_who_each_once: a knowledge event names who, each once
why_a_knowledge_event_names_someone_who_isnt: a knowledge event names someone who isn't in the world
why_a_fact_needs_an_id_in_its: a fact needs an id in its kind's form, a claim, what it's about and its truth, and any source and text hash well formed
why_a_learning_names_a_fact_the_minds: a learning names a fact the minds don't hold
why_a_learning_needs_how_and_by_whom: a learning needs how and by whom (one told names its teller), its evidence, its message and clock, the belief, a confidence from 0 to 1 and whom it's kept from, if anyone
why_a_learnings_teller_is_in_the_world: a learning's teller is in the world, and isn't one who learns it
why_those_a_learning_is_kept_from_are: those a learning is kept from are in the world, and aren't those who learn it
why_a_learning_rests_on_facts_the_minds: a learning rests on facts the minds hold, never on itself
why_a_learnings_witness_line_is_what_was: a learning's witness line is what was seen or told, and where, for one witnessed or told
why_forgetting_names_the_fact_and_who_forgets: forgetting names the fact and who forgets it, each once
why_someone_it_names_doesnt_hold_that_fact: someone it names doesn't hold that fact
why_keeping_names_who_keeps_the_fact_the: keeping names who keeps the fact, the fact, and whom it's kept from: some people or everyone
why_they_dont_hold_that_fact: they don't hold that fact
why_those_a_fact_is_kept_from_are: those a fact is kept from are in the world, and never the one who keeps it
why_that_fact_isnt_one_the_minds_hold: that fact isn't one the minds hold
why_a_facts_truth_is_true_false_or: a fact's truth is true, false or open
why_knowledge_tracking_is_on_or_off_and: knowledge tracking is on or off, and a threshold runs from 0 to 1
why_a_knowledge_change_carries_its_facts_whole: a knowledge change carries its facts whole
why_a_knowledge_change_is_the_player_characters: a knowledge change is the player character's own learning
why_minds_know_needs_the_facts_and_the: minds.know needs the facts and the learning
why_a_holiday_has_an_id: a holiday has an id
why_a_holidays_rule_is_a_date_the: a holiday's rule is a date the calendar reads
why_a_holidays_label_is_a_text: a holiday's label is a text
why_a_new_holiday_needs_a_label_and: a new holiday needs a label and a rule
why_time_advance_needs_minutes_0: time_advance needs minutes > 0
why_a_condition_needs_a_name: a condition needs a name
why_a_condition_needs_a_person: a condition needs a person
why_a_fight_is_already_under_way: a fight is already under way
why_no_fight_is_under_way: no fight is under way
why_you_arent_in_this_fight: you aren't in this fight
why_actor_isnt_in_this_fight: {{actor}} isn't in this fight
why_you_are_out_of_the_fight: you are out of the fight
why_actor_is_out_of_the_fight: {{actor}} is out of the fight
why_it_isnt_your_turn: it isn't your turn
why_it_isnt_actor_s_turn: it isn't {{actor}}'s turn
why_that_fight_is_not_under_way: that fight is not under way
why_the_foes_are_ids_or_a_selector: the foes are ids or a selector
why_away_isnt_here_to_fight: {{away}} isn't here to fight
why_theres_nowhere_to_fight: there's nowhere to fight
why_you_cant_fight_here: you can't fight here
why_theres_no_one_to_fight_here: there's no one to fight here
why_both_is_named_on_both_sides: {{both}} is named on both sides
why_the_world_has_no_initiative_check: the world has no initiative check
why_no_one_is_named_to_join: no one is named to join
why_already_is_in_that_fight_already: {{already}} is in that fight already
why_that_fight_is_already_under_way: that fight is already under way
why_a_fight_needs_an_id_and_an: a fight needs an id and an order
why_someone_is_in_the_fight_twice: someone is in the fight twice
why_a_join_names_who_joins_and_on: a join names who joins and on which side
why_id_is_in_the_fight_twice: {{id}} is in the fight twice
why_a_turn_needs_a_round_and_a: a turn needs a round and a place in the order
why_that_isnt_who_goes_there: that isn't who goes there
why_turns_only_move_on: turns only move on
why_a_refill_names_a_participant_and_its: a refill names a participant and its budgets
why_a_spend_needs_a_participant_and_what: a spend needs a participant and what it spends
why_who_has_nothing_like_that_left: {{who}} has nothing like that left
why_a_fall_names_a_participant: a fall names a participant
why_who_isnt_down: {{who}} isn't down
why_who_is_still_down: {{who}} is still down
why_the_fight_isnt_over: the fight isn't over
why_you_are_still_in_the_fight: you are still in the fight
why_this_worlds_fights_never_peter_out: this world's fights never peter out
why_someone_has_attacked_or_been_hurt_since: someone has attacked or been hurt since
why_a_decision_needs_a_key_and_a: a decision needs a key and a choice
why_no_one_is_left_to_take_a: no one is left to take a turn
why_need_needs_an_entity_a_known_need: need needs an entity, a known need and a delta
why_decision_needs_key_and_choice: decision needs key and choice
why_invitation_needs_an_agent: invitation needs an agent
why_a_routine_setting_names_someone_in_the: a routine setting names someone in the world
why_a_routine_setting_is_a_mode_an: a routine setting is a mode, an awareness, a role, a skip life or some of them, or null to clear it
why_a_skip_plan_has_its_span_its: a skip plan has its span, its plans and an optional note
why_a_skip_plan_names_people_in_the: a skip plan names people in the world, each block inside its span at a place the world has
why_a_routine_change_names_someone_in_the: a routine change names someone in the world
why_a_routine_change_names_its_block_and: a routine change names its block and where it came from
why_the_blocks_id_is_the_one_it: the block's id is the one it changes
why_a_schedule_change_names_someone_in_the: a schedule change names someone in the world
why_a_schedule_change_names_one_of_the: a schedule change names one of the world's schedules and where it came from
why_a_schedule_change_is_off_until_a: a schedule change is off (until a time or for good) or their own slots
why_name_has_no_routine_only_people_do: {{name}} has no routine: only people do
why_theres_no_schedule_schedule: there's no schedule {{schedule}}
why_name_doesnt_follow_schedule: {{name}} doesn't follow {{schedule}}
why_a_schedule_change_is_off_until_a_2: a schedule change is off (until a time or for good) or their own slots (HH:MM to HH:MM)
why_name_keeps_no_routine_now: {{name}} keeps no routine now
why_a_new_routine_needs_what_it_is: a new routine needs what it is
why_the_reply_doesnt_say_which_days: the reply doesn't say which days
why_its_time_doesnt_read: its time doesn't read
why_its_length_is_a_day_at_most: its length is a day at most
why_theres_no_such_place: there's no such place
why_it_falls_on_no_day_of_the: it falls on no day of the week
why_its_already_their_routine: it's already their routine
why_it_clashes_with_their_schedule_and_the: it clashes with their schedule, and the reply doesn't say it takes its place
why_the_reply_doesnt_say_what_they_gave: the reply doesn't say what they gave up
why_nothing_of_their_routine_is_what_the: nothing of their routine is what the reply says they gave up
why_a_routine_change_starts_stops_or_moves: a routine change starts, stops or moves house
why_its_already_their_home: it's already their home
why_only_people_have_a_routine: only people have a routine
why_a_name_is_at_least_one_character: a name is at least one character
why_name_is_saved_as_it_is: {{name}} is saved as it is
why_who_keeps_no_such_outfit: {{who}} keeps no such outfit
why_none_of_name_is_to_hand_missing: None of {{name}} is to hand: {{missing}}
why_no_item_item: no item {{item}}
why_cant_put_something_inside_itself: can't put something inside itself
why_cash_changes_hands_as_a_transfer: cash changes hands as a transfer
why_no_searcher_who: no searcher {{who}}
why_no_target_to_search: no {{target}} to search
why_target_isnt_here: {{target}} isn't here
why_no_claimer_c: no claimer {{c}}
why_no_kit_kit: no kit {{kit}}
why_no_name_left_in_name2: no {{name}} left in {{name2}}
why_a_loan_needs_a_future_end: a loan needs a future end
why_occupied_is_already_in_the_g_slot: {{occupied}} is already in the {{g}} slot
why_said_names_no_time_say_how_many: "{{said}}" names no time; say how many days or until when
why_a_saved_set_is_an_outfit_or: a saved set is an outfit or a loadout
why_name_is_used_up: {{name}} is used up
why_more_than_one_thing_fits: more than one thing fits
why_it_would_no_longer_happen_as_told: it would no longer happen as told
why_a_cash_give_is_a_transfer: a cash give is a transfer
why_the_change_isnt_one: the change isn't one
why_quantity_needs_a_whole_non_zero_delta: quantity needs a whole, non-zero delta
why_this_world_cant_carry_out_type: this world can't carry out {{type}}
why_why_and_it_cant_be_put_to: {{why}}, and it can't be put to a vote from here
why_name_has_no_one_to_vote: {{name}} has no one to vote
why_name_has_open_motions_open_already: {{name}} has {{open}} motions open already
why_org_has_no_motion_id: {{org}} has no motion {{id}}
why_that_motion_status_already: That motion {{status}} already
why_a_vote_is_for_against_or_abstain: A vote is for, against or abstain
why_say_whose_vote_it_is: Say whose vote it is
why_by_may_not_vote_for_who: {{by}} may not vote for {{who}}
why_who_voted_vote_already: {{who}} voted {{vote}} already
why_only_the_gm_closes_a_motion_before: Only the GM closes a motion before its time
why_a_motion_is_withdrawn_or_closed: A motion is withdrawn or closed
why_only_m_may_withdraw_it: Only {{m}} may withdraw it
why_a_motion_is_put_by_someone_name: A motion is put by someone: name who puts it
why_the_motions_change_isnt_an_organization_op: The motion's change isn't an organization op
why_a_motion_carries_one_decision: A motion carries one decision
why_this_world_cant_type: this world can't {{type}}
why_by_may_decide_that_alone_no_vote: {{by}} may decide that alone: no vote is needed
why_say_a_number_from_lo_to_hi: say a number from {{lo}} to {{hi}}
why_votes_are_counted_by_shares_by_members: votes are counted by shares, by members or by trustees
why_only_a_trust_counts_its_trustees_votes: only a trust counts its trustees' votes; {{org}} isn't one
why_say_whose_standing_vote_it_is: Say whose standing vote it is
why_by_may_not_set_who_s_standing: {{by}} may not set {{who}}'s standing vote
why_a_standing_vote_is_for_against_abstain: A standing vote is for, against, abstain, with someone, or none
why_say_whose_vote_it_follows: Say whose vote it follows
why_no_such_motion_open: no such motion open
why_a_motion_needs_its_organization_words_and: a motion needs its organization, words and act
why_motion_id_is_on_record_already: motion {{id}} is on record already
why_no_such_motion: no such motion
why_a_vote_is_for_against_or_abstain_2: a vote is for, against or abstain, by someone
why_a_motion_ends_carried_failed_or_withdrawn: a motion ends carried, failed or withdrawn
why_only_the_partys_leader_changes_who_is: Only the party's leader changes who is in it
why_you_lead_the_party: You lead the party
why_name_isnt_in_your_party: {{name}} isn't in your party
why_a_tier_is_one_of_join_or: a tier is one of {{join}}, or {{pARTY_OUT}}
why_name_is_already_tier_of_the_party: {{name}} is already {{tier}} of the party
why_only_the_partys_leader_names_it: Only the party's leader names it
why_a_partys_name_is_1_name_max: a party's name is 1–{{nAME_MAX}} characters
why_the_party_is_already_called_name: the party is already called {{name}}
why_only_the_partys_leader_starts_its_purse: Only the party's leader starts its purse
why_a_purse_starts_with_a_deposit_above: a purse starts with a deposit above nothing
why_you_have_no_account_to_start_a: You have no account to start a purse from
why_from_isnt_an_account_of_yours_a: {{from}} isn't an account of yours a purse can start from
why_id_already_has_a_purse: {{id}} already has a purse
why_a_purse_needs_the_economy: a purse needs the economy
why_the_purse_didnt_open: the purse didn't open
why_only_the_partys_leader_hires_for_it: Only the party's leader hires for it
why_start_a_purse_first_the_party_pays: Start a purse first: the party pays its hands from it
why_hiring_needs_the_economy: hiring needs the economy
why_you_have_founder_has_no_account_to: {{#f}}You have{{/f}}{{^f}}{{founder}} has{{/f}} no account to put {{what}} in from
why_from_isnt_an_account_whose_what_can: {{from}} isn't an account {{whose}} {{what}} can come from
why_name_needs_the_economy: {{name}} needs the economy
why_name_s_account_didnt_open: {{name}}'s account didn't open
why_a_company_starts_with_capital_above_nothing: a company starts with capital above nothing
why_a_company_counts_its_shares_in_a: a company counts its shares in a whole number of units
why_what_goes_into_a_trust_is_nothing: what goes into a trust is nothing or more
why_no_one_id_to_be_its_role: no one {{id}} to be its {{role}}
why_a_trust_ends_on_a_day_yyyy: a trust ends on a day, YYYY-MM-DD
why_a_trust_ends_after_today: a trust ends after today
why_what_goes_into_a_nonprofit_is_nothing: what goes into a nonprofit is nothing or more
why_this_world_has_no_kinds_of_group: This world has no kinds of group to start
why_a_group_is_one_of_kinds: a group is one of {{kinds}}
why_only_a_person_founds_an_organization_for: Only a person founds an organization, for themselves or for one they govern
why_founder_isnt_an_organization: {{founder}} isn't an organization
why_founder_founds_companies_settles_trusts_and_starts: {{founder}} founds companies, settles trusts and starts nonprofits; a group is founded by its people
why_an_organizations_name_is_1_name_max: an organization's name is 1–{{nAME_MAX}} characters
why_an_organization_founded_is_a_company_a: an organization founded is a company, a trust, a nonprofit or a group
why_org_becomes_a_nonprofitstops_being_a_nonprofit: {{org}} {{#structure}}becomes a nonprofit{{/structure}}{{^structure}}stops being a nonprofit{{/structure}} only by changing what it is in Build
why_org_is_on_a_market_take_it: {{org}} is on a market: take it off the market before it stops being a C corporation
why_a_companys_structure_needs_the_economy: a company's structure needs the economy
why_until_is_a_date_yyyy_mm_dd: until is a date (YYYY-MM-DD)
why_no_one_name_to_act_for_org: no one {{name}} to act for {{org}}
why_a_transfer_gives_its_units_or_its: a transfer gives its units or its percentage
why_a_trade_in_a_company_on_no: a trade in a company on no market names the other party (with)
why_no_orgs_setting_key: no orgs setting "{{key}}"
why_a_bad_value_for_the_orgs_setting: a bad value for the orgs setting "{{key}}"
why_who_isnt_below_title_at_org: {{who}} isn't below {{title}} at {{org}}
why_title_at_org_has_no_seat_free: {{title}} at {{org}} has no seat free
why_unknown_isnt_a_power: {{unknown}} isn't a power
why_no_one_who_to_admit: no one {{who}} to admit
why_who_is_already_a_member_of_org: {{who}} is already a member of {{org}}
why_who_isnt_a_member_of_org: {{who}} isn't a member of {{org}}
why_who_owns_part_of_org_selling_that: {{who}} owns part of {{org}}: selling that share is how to leave it
why_no_one_who_to_appoint: no one {{who}} to appoint
why_no_one_who_to_title: no one {{who}} to title
why_a_position_needs_a_title: a position needs a title
why_org_has_no_other_position_reports_to: {{org}} has no other position {{reports_to}} to report to
why_title_cant_report_to_a_position_that: {{title}} can't report to a position that reports to it
why_a_delegation_gives_at_least_one_power: a delegation gives at least one power
why_by_may_not_power_for_org_so: {{by}} may not {{power}} for {{org}}, so can't give that
why_by_may_power_only_for_those_below: {{by}} may {{power}} only for those below {{title}}, so can't give that for all of {{org}}
why_a_delegation_ends_after_today: a delegation ends after today
why_to_doesnt_act_for_org: {{to}} doesn't act for {{org}}
why_by_may_not_beyond_for_org_so: {{by}} may not {{beyond}} for {{org}}, so can't take that back
why_a_new_name_please: a new name, please
why_a_companys_ownership_needs_the_economy: a company's ownership needs the economy
why_winding_up_is_join: winding up is {{join}}
why_name_isnt_winding_up: {{name}} isn't winding up
why_winding_up_a_company_needs_the_economy: winding up a company needs the economy
why_merging_companies_needs_the_economy: merging companies needs the economy
why_keys_are_item_ids_or_item_types: keys are item ids or item types
why_who_may_enter_is_one_of_join: who may enter is one of {{join}}, or {{aS_THE_WORLD}}
why_an_entry_change_needs_who_may_enter: an entry change needs who may enter or its keys
why_an_entry_is_an_audience: an entry is an audience
why_an_entry_change_changes_who_may_enter: an entry change changes who may enter or the keys
why_the_reply_doesnt_state_it_as_done: the reply doesn't state it as done
why_no_motion_id_named: no motion {{#id}}{{id}}{{/id}}{{^id}}named{{/id}}
why_who_no_one_named_has_no_vote: {{#who}}{{who}}{{/who}}{{^who}}No one named{{/who}} has no vote on it
why_no_request_id_named: no request {{#id}}{{id}}{{/id}}{{^id}}named{{/id}}
why_no_one_who_named_the_player_character: no one {{#who}}{{who}}{{/who}}{{^who}}named{{/who}} the player character knows
why_an_answer_is_join: an answer is {{join}}
why_a_history_line_needs_an_organization_and: a History line needs an organization and its words
why_spending_needs_an_organization_who_spent_a: spending needs an organization, who spent, a month and an amount
why_why_and_it_cant_be_put_up: {{why}}, and it can't be put up for approval from here
why_why_and_no_one_above_you_may: {{why}}, and no one above you may approve it
why_org_has_open_requests_waiting_already: {{org}} has {{open}} requests waiting already
why_org_has_no_request_request: {{org}} has no request {{request}}
why_a_request_is_approved_denied_or_withdrawn: A request is approved, denied or withdrawn
why_who_may_not_answer_it_who2: {{who}} may not {{answer}} it: {{who2}}
why_a_request_needs_its_organization_power_words: a request needs its organization, power, words and act
why_request_id_is_on_record_already: request {{id}} is on record already
why_no_such_request: no such request
why_a_request_is_approved_denied_or_withdrawn_2: a request is approved, denied or withdrawn
why_a_goal_needs_an_organization_an_id: a goal needs an organization, an id, its words, a status and where it came from
why_an_order_needs_an_organization_an_id: an order needs an organization, an id, whom it is for, its words, a status and where it came from
why_a_status_change_needs_a_status_and: a status change needs a status and where it came from
why_nothing_on_the_plan_is_id: nothing on the plan is {{id}}
why_no_order_on_the_plan_is_id: no order on the plan is {{id}}
why_only_an_organization_not_a_trust_has: only an organization (not a trust) has a plan
why_by_may_not_give_orders_for_org: {{by}} may not give orders for {{org}}
why_text_isnt_a_date_and_time_yyyy: "{{text}}" isn't a date and time (YYYY-MM-DD HH:MM)
why_a_goals_window_is_today_or_a: a goal's window is "today" or a date (YYYY-MM-DD), not "{{text}}"
why_what_it_is_in_words: what it is, in words
why_whom_the_order_is_for: whom the order is for
why_unknown_is_no_one_in_the_world: {{unknown}} is no one in the world
why_who_leads_must_be_one_of_those: who leads must be one of those it is for
why_no_goal_on_the_plan_is_goal: no goal on the plan is {{goal}}
why_a_status_is_one_of_keys: a status is one of {{keys}}
why_no_organization_is_called_words: no organization is called {{words}}
why_you_may_not_give_orders_for_org: you may not give orders for {{org}}
why_nothing_to_add_to_the_plan: nothing to add to the plan
why_said_isnt_in_your_message: "{{said}}" isn't in your message
why_you_dont_know_anyone_called_missing: you don't know anyone called {{missing}}
why_who_offers_it: who offers it
why_no_one_you_know_is_named: no one you know is {{named}}
why_who_cant_take_it_on: {{who}} can't take it on
why_it_quotes_the_storys_words: it quotes the story's words
why_its_on_the_plan_already: it's on the plan already
why_a_plans_status_from_the_story_is: a plan's status from the story is under way, done, blocked or refused
why_id_is_closed_already: {{id}} is closed already
why_no_organization_org_named_the_player_character: no organization {{#org}}{{org}}{{/org}}{{^org}}named{{/org}} the player character knows
why_no_one_by_the_player_character_knows: no one {{by}} the player character knows
why_an_appointment_names_one_of_the_organizations: an appointment names one of the organization's positions
why_who_isnt_in_org: {{who}} isn't in {{org}}
why_a_title_is_the_words_they_go: a title is the words they go by
why_a_membership_change_is_one_of_join: a membership change is one of {{join}}
why_who_has_no_job_id: {{who}} has no job {{id}}
why_who_has_no_job: {{who}} has no job
why_which_of_who_s_jobs_the_reply: which of {{who}}'s jobs the reply means isn't said
why_who_has_no_job_at_said: {{who}} has no job at {{said}}
why_no_employer_org_named_the_player_character: no employer {{#org}}{{org}}{{/org}}{{^org}}named{{/org}} the player character knows
why_nobody_hires_themselves: nobody hires themselves
why_a_raise_gives_the_new_rate_or: a raise gives the new rate or a percentage
why_an_employment_change_is_one_of_join: an employment change is one of {{join}}
why_no_vehicle_class_class: no vehicle class {{class}}
why_no_vehicle_v: no vehicle {{v}}
why_name_has_broken_down: {{name}} has broken down
why_name_is_at_to_already_walk_there: {{name}} is at {{to}} already: walk there
why_no_route_for_name_to_to: no route for {{name}} to {{to}}
why_name_doesnt_have_the_fuel: {{name}} doesn't have the fuel
why_name_is_full: {{name}} is full
why_weather_set_needs_a_state: weather.set needs a state
why_no_weather_region_for_target: no weather region for {{target}}
why_place_has_no_weather_of_its_own: {{place}} has no weather of its own to clear
why_regard_needs_two_entities: regard needs two entities
why_regard_needs_deltas_or_an_anchor: regard needs deltas or an anchor
why_regard_values_must_be_numbers: regard values must be numbers
why_no_regard_axis_axis: no regard axis {{axis}}
why_regard_needs_two_known_people: regard needs two known people
why_regard_needs_a_non_zero_delta: regard needs a non-zero delta
why_this_answer_needs_a_judgement: this answer needs a judgement
why_there_is_nothing_to_answer_here: there is nothing to answer here
why_a_flag_needs_a_name: a flag needs a name
why_story_answers_track_names_nothing_id_is: story.answer's track {{#id2}}names nothing{{/id2}}{{^id2}}"{{id}}" is no puzzle{{/id2}}
why_more_than_one_puzzle_is_open_and: more than one puzzle is open, and the answer doesn't say which
why_more_than_one_open_puzzle_fits_asked: more than one open puzzle fits {{#asked}}{{asked}}{{/asked}}{{^asked}}that name{{/asked}}
why_fits_open_puzzles_fit_askedforgm_id: {{fits}} open puzzles fit {{askedForGm}}: {{id}}
why_there_is_no_open_puzzle_to_answer: there is no open puzzle to answer
why_no_open_puzzle_asked_by_that_name: no open puzzle {{#asked}}{{asked}}{{/asked}}{{^asked}}by that name{{/asked}}
why_no_open_puzzle_in_the_quest_log: no open puzzle in the quest log fits {{askedForGm}}
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
lint_format_must_be_world_format: format must be {{wORLD_FORMAT}}
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
lint_the_number_of_people_replies_may_introduce: The number of people replies may introduce must be a whole number from 0 to {{mAX_SPAWN_CAP}}.
lint_the_number_of_places_what_may_make: The number of places {{what}} may make in play must be a whole number from 0 to {{mAX_PLACE_CAP}}.
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
lint_asset_id_needs_a_class_asset_classes: Asset {{id}} needs a class ({{aSSET_CLASSES}}).
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
lint_name_s_entry_is_entry_not_one: {{name}}'s entry is {{entry}}, not one of {{aUDIENCES}}: it is read as unset.
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
feed_org_type_company: a company
feed_org_type_household: a household
feed_org_type_group: a group
feed_org_type_trust: a trust
feed_org_type_party: a party
feed_role_owner: owner
feed_role_joint: joint owner
feed_role_custodian: custodian
feed_role_beneficiary: beneficiary
feed_role_trustee: trustee
feed_role_authorized_user: authorized user
feed_worn_worn: worn
feed_worn_pocket: in your pocket
feed_worn_hand: in your hand
feed_mood_winter: a cold winter
feed_mood_spring: a mild spring
feed_mood_summer: a warm summer
feed_mood_autumn: a crisp autumn
org_log_currency_a_payment: {{currency}} a payment
org_log_currency_a_month: {{currency}} a month
org_log_admitted_who_as_as: Admitted {{who}}{{#if_as}} as {{as}}{{/if_as}}
org_log_removed_who: Removed {{who}}
org_log_who_left: {{who}} left
org_log_appointed_who_title: Appointed {{who}} {{title}}
org_log_who_no_longer_holds_left: {{who}} no longer holds {{left}}
org_log_who_goes_by_words: {{who}} goes by {{words}}
org_log_who_no_longer_has_a_title_of: {{who}} no longer has a title of their own
org_log_removed_the_position_title: Removed the position {{title}}
org_log_changedadded_the_position_title: {{#if_before}}Changed{{/if_before}}{{^if_before}}Added{{/if_before}} the position {{title}}
org_log_until_until: , until {{until}}
org_log_let_to_powers_limits_when: Let {{to}} {{powers}}{{limits}}{{when}}
org_log_to_no_longer_acts_for_it: {{to}} no longer acts for it
org_log_renamed_from_was_to_name: Renamed from {{was}} to {{name}}
org_log_its_their_own_request: it's their own request
org_log_its_more_than_they_may_do_themselves: it's more than they may do themselves for {{org}}
org_log_they_arent_above_r_at_org: they aren't above {{r}} at {{org}}
org_log_the_gm: the GM
org_log_ask_asked_first_to_approve_text_why: {{ask}} asked {{first}} to approve: {{text}} ({{why}})
org_log_r_withdrew_the_request_text: {{r}} withdrew the request: {{text}}
org_log_who_the_gm_denied_r_s_request: {{#if_who}}{{who}}{{/if_who}}{{^if_who}}The GM{{/if_who}} denied {{r}}'s request: {{text}}{{#if_why}}: {{why}}{{/if_why}}
org_log_what_needs_payroll_and_books_in_play: {{what}} needs payroll and books in play (Money {{cOMPANY_LEVEL}})
org_log_starting_a_company: Starting a company
org_log_settling_a_trust: Settling a trust
org_log_starting_a_nonprofit: Starting a nonprofit
org_log_of_yours: of yours
org_log_of_founder_s: of {{founder}}'s
org_log_capital_into_name: Capital into {{name}}
org_log_founder_founded_name_with_money: {{founder}} founded {{name}} with {{money}}.
org_log_started_name_its_subsidiary_with_money: Started {{name}}, its subsidiary, with {{money}}.
org_log_money_for_it: money for it
org_log_into_name: Into {{name}}
org_log_with_currency:  with {{currency}}
org_log_founder_settled_name_into_revocably: {{founder}} settled {{name}}{{into}}{{#if_revocable}}, revocably{{/if_revocable}}.
org_log_settled_name_a_trust_into: Settled {{name}}, a trust{{into}}.
org_log_a_gift: a gift
org_log_gift_to_name: Gift to {{name}}
org_log_founder_founded_name_a_nonprofit_into_as: {{founder}} founded {{name}}, a nonprofit{{into}}, as its Director.
org_log_started_name_a_nonprofit_into_as_its: Started {{name}}, a nonprofit{{into}}, as its Director.
org_log_by_founded_name_a_label_and_leads: {{by}} founded {{name}}, a {{label}}, and leads it.
org_log_changing_the_structure_of: Changing the structure of
org_log_make_org_structure: Make {{org}} {{structure}}
org_log_became_structure_taxed_as_one_from_from: Became {{structure}}{{#if_from}}, taxed as one from {{from}}{{/if_from}}
org_log_carried_by_vote_why_text: Carried by vote ({{why}}): {{text}}
org_log_withdrew_the_motion_text: Withdrew the motion: {{text}}
org_log_the_motion_failed_why_text: The motion failed ({{why}}): {{text}}
org_log_couldnt_be_carried_out_reason: couldn't be carried out: {{reason}}
org_log_o_for_party: {{o}} for {{party}}
org_log_the_gm_2: The GM
org_log_who_put_to_a_vote_text_it: {{who}} put to a vote: {{text}} (it closes {{closes}})
org_log_votes_counted_by_basis: votes counted by {{basis}}
org_log_votes_counted_as_its_type_counts_them: votes counted as its type counts them
org_log_a_quorum_of_n: a quorum of {{n}}
org_log_the_default_quorum: the default quorum
org_log_passing_with_more_than_n: passing with more than {{n}}
org_log_the_default_pass_mark: the default pass mark
org_log_motions_open_n_days: motions open {{n}} days
org_log_motions_open_the_default_time: motions open the default time
org_log_requests_waiting_n_days: requests waiting {{n}} days
org_log_requests_waiting_the_default_time: requests waiting the default time
org_log_set_how_decisions_are_made_words: Set how decisions are made: {{words}}
org_log_who_no_longer_has_a_standing_vote: {{who}} no longer has a standing vote
org_log_who_votes_with_follows: {{who}} votes with {{follows}}
org_log_who_votes_abstain_as_a_rule: {{who}} votes {{abstain}} as a rule
org_log_ana_noun: {{#if_noun}}an{{/if_noun}}{{^if_noun}}a{{/if_noun}} {{noun}}
org_log_only_the_partys_leader_may_do_that: Only the party's leader may do that
org_log_by_took_name_out_of_the_party: {{by}} took {{name}} out of the party.
org_log_by_added_name_to_the_party_as: {{by}} added {{name}} to the party as {{tier}}.
org_log_by_made_name_tier_of_the_party: {{by}} made {{name}} {{tier}} of the party.
org_log_first_s_party: {{first}}'s party
org_log_by_named_the_party_name: {{by}} named the party {{name}}.
org_log_party_purse: Party purse
org_log_into_id_s_purse: Into {{id}}'s purse
org_log_by_started_the_partys_purse_with_currency: {{by}} started the party's purse with {{currency}}.
org_log_by_hired_worker_as_a_hand: {{by}} hired {{worker}} as a hand.
org_log_last_seen_at_place: last seen at {{place}}
org_log_the_party_has_a_purse: The party has a purse
org_log_a_purse_needs_money_in_play_money: A purse needs money in play (Money 2)
org_log_start_a_purse_first_the_party_pays: Start a purse first: the party pays its hands from it
org_log_hiring_needs_jobs_in_play_money_3: Hiring needs jobs in play (Money 3)
org_log_start_a_purse_first: Start a purse first
org_log_share_out_pays_core_members_and_companions: Share out pays core members and companions, and the party has none
org_log_only_the_partys_leader_shares_out_its: Only the party's leader shares out its money
org_log_wind_up_name: Wind up {{name}}
org_log_begin_winding_up_name: Begin winding up {{name}}
org_log_finish_winding_up_name: Finish winding up {{name}}
org_log_stop_winding_up_name: Stop winding up {{name}}
org_log_resuming: Resuming
org_log_winding_up: Winding up
org_log_stopped_winding_up_it_trades_again: Stopped winding up: it trades again
org_log_dissolved: Dissolved
org_log_name_began_winding_upwound_up_and_dissolved: {{name}}: {{#if_begin}}began winding up{{/if_begin}}{{^if_begin}}wound up and dissolved{{/if_begin}}
org_log_intoname_takes_over_name_as_its_subsidiary: {{intoName}} takes over {{name}} as its subsidiary
org_log_merge_name_into_intoname: Merge {{name}} into {{intoName}}
org_log_selling_the_whole_of: Selling the whole of
org_log_merging: Merging
org_log_taking_over_a_company_for: Taking over a company for
org_log_merging_into: Merging into
org_log_became_intoname_s_subsidiary: Became {{intoName}}'s subsidiary
org_log_merged_into_intoname_and_dissolved: Merged into {{intoName}}, and dissolved
org_log_name_became_intoname_s_subsidiarymerged_into_intoname: {{name}} {{#if_keep}}became {{intoName}}'s subsidiary{{/if_keep}}{{^if_keep}}merged into {{intoName}}{{/if_keep}}
org_log_a_key: a key
org_log_customers_while_it_trades_staff_only_after: Customers while it trades; staff only after hours
org_log_anyone: Anyone
org_log_daywords_all_day_open_to_close: {{dayWords}}, {{#if_close}}all day{{/if_close}}{{^if_close}}{{open}} to {{close}}{{/if_close}}
org_log_who_may_enter_as_the_world_has: who may enter as the world has it
org_log_who_may_enter_entry: who may enter: {{entry}}
org_log_its_keys_as_the_world_has_them: its keys as the world has them
org_log_no_keys: no keys
org_log_keys_pov: keys: {{pov}}
org_log_a_place: a place
org_log_a_place_2: A place
org_log_actor_set_where_said: {{#if_actor}}{{actor}} set {{/if_actor}}{{where}}: {{said}}
org_log_you: You
org_log_open_to_customers_now: Open to customers now
org_log_open_to_anyone_now: Open to anyone now
org_log_closed_now: {{closed}} now
org_log_someone: Someone
org_log_who_did_though_who_may_not_power: {{who}} {{did}}, though {{who}} may not {{power}} for {{org}}.
org_log_who_no_longer_holds_a_position: {{who}} no longer holds a position
org_log_let_name_act_for_org: let {{name}} act for {{org}}
org_log_let_name_lacking: let {{name}} {{lacking}}
org_log_hired_who_as_title: Hired {{who}}{{#if_title}} as {{title}}{{/if_title}}
org_log_let_worker_go: Let {{worker}} go
org_log_set_worker_s_pay_to_rate: Set {{worker}}'s pay to {{rate}}
org_log_set_dues_of_cents_a_every: Set dues of {{cents}} a {{every}}
org_log_ended_dues: Ended dues
org_log_no_longer_exempt_from_income_tax: No longer exempt from income tax
org_log_exempt_from_income_tax_as_status: Exempt from income tax as {{status}}
org_log_elected_to_file_one_consolidated_return: Elected to file one consolidated return
org_log_stopped_filing_a_consolidated_return: Stopped filing a consolidated return
org_log_lent_cents_to_name: Lent {{cents}} to {{name}}
org_log_admitted_who_to_org: admitted {{who}} to {{org}}
org_log_removed_who_from_org: removed {{who}} from {{org}}
org_log_appointed_who_title_2: appointed {{who}} {{title}}
org_log_gave_who_the_title_title: gave {{who}} the title {{title}}
org_log_hired_who: hired {{who}}
org_log_let_who_go: let {{who}} go
org_log_who_quit: {{who}} quit
org_log_changed_who_s_pay: Changed {{who}}'s pay
org_log_changed_who_s_pay_2: changed {{who}}'s pay
org_log_put_who_on_leave: Put {{who}} on leave
org_log_who_came_back_from_leave: {{who}} came back from leave
org_log_put_who_on_leave_2: put {{who}} on leave
org_log_brought_who_back_from_leave: brought {{who}} back from leave
org_log_sent_customer_an_invoice_for_cents: Sent {{customer}} an invoice for {{cents}}
org_log_paid_business_s_invoice_for_left: Paid {{business}}'s invoice for {{left}}
org_log_voided_the_invoice_to_customer_for_cents: Voided the invoice to {{customer}} for {{cents}}
org_log_paid_total_out_to_its_beneficiaries: Paid {{total}} out to its beneficiaries
org_log_paid_total_of_profit_out_to_its: Paid {{total}} of profit out to its owners
org_log_hired_worker_as_as: Hired {{worker}}{{#if_as}} as {{as}}{{/if_as}}
org_log_set_worker_s_pay_to_rate_basis: Set {{worker}}'s pay to {{rate}} {{basis}}
org_log_set_worker_s_hours_to_hours_a: Set {{worker}}'s hours to {{hours}} a week
org_log_changed_the_pay_schedule_to_every: Changed the pay schedule to {{every}}
org_log_grantedgave_to_cents: {{#if_grant}}Granted{{/if_grant}}{{^if_grant}}Gave{{/if_grant}} {{to}} {{cents}}
org_log_soldbought_what_for_amount: {{#if_sell}}Sold{{/if_sell}}{{^if_sell}}Bought{{/if_sell}} {{what}}{{#if_amount}} for {{amount}}{{/if_amount}}
org_log_bought_what_for_paid: Bought {{what}}{{#if_paid}} for {{paid}}{{/if_paid}}
org_log_paid_partyof_cents: Paid {{partyOf}} {{cents}}
org_log_payment: Payment
org_log_moved_cents_from_from_to_to: Moved {{cents}} from {{from}} to {{to}}
org_log_transfer: Transfer
org_log_paid_cents_toward_card: Paid {{cents}} toward {{card}}
org_log_took_cents_out_of_account: Took {{cents}} out of {{account}}
org_log_put_cents_into_account: Put {{cents}} into {{account}}
org_log_a_changed_card: {{#a}}{{a}}{{/a}}{{^a}}Changed{{/a}} {{card}}
org_log_ordered_a_replacement_for_card: Ordered a replacement for {{card}}
org_log_set_account_s_autopay_to_none: Set {{account}}'s autopay to {{none}}
org_log_set_up_a_standing_payment_label: Set up a standing payment{{#if_label}}: {{label}}{{/if_label}}
org_log_changed_the_standing_payment_flow: Changed the standing payment {{flow}}
org_log_status_resumed_the_standing_payment_flow: {{#status}}{{status}}{{/status}}{{^status}}Resumed{{/status}} the standing payment {{flow}}
org_log_applied_for_product_credit_of_cents: Applied for {{#product}}{{product}}{{/product}}{{^product}}credit{{/product}}{{#if_number}} of {{cents}}{{/if_number}}
org_log_borrowed_money_from_lendername: Borrowed {{money}} from {{lenderName}}
org_log_lent_money_to_borrowername: Lent {{money}} to {{borrowerName}}
org_log_exercised_holding: Exercised {{holding}}
org_log_started_name: Started {{name}}
org_log_paused_name: Paused {{name}}
org_log_resumed_name: Resumed {{name}}
org_log_dropped_name_why: Dropped {{name}}{{#if_why}}: {{why}}{{/if_why}}
org_log_sold_property_to_buyer_for_price: Sold {{property}}{{#if_buyer}} to {{buyer}}{{/if_buyer}} for {{price}}
org_log_let_unitname_property_to_tenant_for_rent: Let {{#if_unitName}}{{unitName}}, {{/if_unitName}}{{property}} to {{tenant}} for {{rent}} a month
org_log_ended_lease: Ended {{lease}}
org_log_put_property_up_for_sale_at_price: Put {{property}} up for sale at {{price}}
org_log_took_property_off_the_market: Took {{property}} off the market
org_log_soldgave_what_of_business_to_buyer_for: {{#if_price}}Sold{{/if_price}}{{^if_price}}Gave{{/if_price}} {{what}} of {{business}}{{#if_buyer}} to {{buyer}}{{/if_buyer}}{{#if_price}} for {{price}}{{/if_price}}
org_log_shared_out_cents_org: Shared out {{cents}}{{org}}
org_log_sent_from_s_what_where: Sent {{from}}'s {{what}} {{where}}
eng_taking_minutes: , taking {{minutes}}
eng_what_changed_changes:  What changed: {{changes}}.
eng_what_doesnt_happen_reason_not_possible_here: {{what}} doesn't happen: {{#if_requirement}}{{reason}}{{/if_requirement}}{{^if_requirement}}not possible here and now{{/if_requirement}}.
eng_what_the_result_is_decided_outcome_took: {{what}}: the result is decided — {{outcome}}{{took}}.{{changed}}
eng_time_passes_until_its_interrupted_text: Time passes until it's interrupted: {{text}}.
eng_time_passes_until_mindname_someone_steps_in: Time passes until {{#mindName}}{{mindName}}{{/mindName}}{{^mindName}}someone{{/mindName}} steps in; how they do is in the Minds section.
eng_time_passes: Time passes.
eng_the_players_message_fills_this_time_fill:  The player's message fills this time: “{{fill}}”. Narrate that as what the player character does in it.
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
eng_the_last_turns_final_review_how_the: The last turn's final review {{how}} the narrator's {{part}} section{{then}}: "{{line}}". A line it can't use often means the things are wrong: look at what it names.
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
why_this_reply_was_written_while_an_earlier: This reply was written while an earlier message or swipe it depended on changed, so switching back can't restore it.
why_cause_re_run_it_to_play_the: {{cause}} Re-run it to play the turn again.
why_cause_it_cant_be_undone_or_read: {{cause}} It can't be undone or read again.
why_the_next_turn_is_already_under_way: the next turn is already under way
why_the_sessions_part_isnt_a_stored_blobs: the session's {{part}} isn't a stored blob's hash
why_the_transcripts_length_isnt_a_count_of: the transcript's length isn't a count of its characters
why_the_transcripts_time_isnt_a_moment_in: the transcript's time isn't a moment in milliseconds
why_the_turns_reply_is_no_longer_the: the turn's reply is no longer the latest
why_the_reply_has_no_turn_record: the reply has no turn record
why_the_replys_record_was_discarded: the reply's record was discarded
why_the_reply_holds_no_text: the reply holds no text
why_the_reply_holds_a_turns_record: the reply holds a turn's record
why_no_assistant_message: no assistant message
why_invalid_marker: invalid marker
why_unknown_revision: unknown revision
why_no_message: no message
why_no_record: no record
why_not_the_active_swipe: not the active swipe
why_nothing_to_undo: nothing to undo
why_youve_swiped_away_from_the_timeline_this: You've swiped away from the timeline this reply was made on. Switch back to undo it.
why_later_events_depend_on_it: later events depend on it
why_nothing_to_read: nothing to read
why_youve_swiped_away_from_the_timeline_this_2: You've swiped away from the timeline this reply was made on. Switch back to read it.
why_not_the_head: not the head
why_not_a_stopped_head_continue: not a stopped head Continue
why_the_chat_was_paused: the chat was paused

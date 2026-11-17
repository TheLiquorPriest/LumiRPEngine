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
---
credit_approved: Approved: a {{product}}{{#apr}} at {{apr}}% APR{{/apr}}{{#limit}} with a {{limit}} limit{{/limit}}.
credit_declined: The application for a {{product}} was declined: {{reason}}.
credit_why_charged_off: a recent charge-off on their report
credit_why_score: their credit score is too low
credit_why_amount: it's more than a lender would lend them (up to {{most}})
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
flow_retry: {{label}} ({{amount}}) didn't go through; it will be tried again.
flow_fallback: {{label}}: {{amount}} paid from {{from}}.
flow_deferred: {{label}} ({{amount}}) couldn't be paid; it carries to next time.
flow_declined: {{label}} ({{amount}}) was declined: {{reason}}.
flow_why_failed: the payment didn't go through
loan_paid_off: The loan of {{borrower}} from {{lender}} is paid off.
payday: Payday: {{net}} net{{#gross}} ({{gross}} gross){{/gross}}.
invoice_late: {{memo}} from {{#business}}{{business}}{{/business}}{{^business}}a business{{/business}} is {{days}} {{#one}}day{{/one}}{{^one}}days{{/one}} late: {{amount}} due.
invoice_late_owner: {{memo}}, billed to {{#customer}}{{customer}}{{/customer}}{{^customer}}a customer{{/customer}}, is {{days}} {{#one}}day{{/one}}{{^one}}days{{/one}} late: {{amount}} owed.
bond_matured: {{asset}} matured: {{paid}} paid out{{#coupon}}, its last coupon of {{coupon}} with it{{/coupon}}.
option_exercised: {{asset}} was exercised at expiry and settled for {{value}}.
option_expired: {{asset}} expired worthless.
project_wait_start: {{project}}: {{step}} can't start until {{amount}} can be paid ({{reason}}); it tries again as money comes in.
project_wait_finish: {{project}}: {{step}} can't finish until {{amount}} can be paid ({{reason}}); it tries again as money comes in.
person_leaves: {{name}} leaves.
person_arrives: {{name}} arrives.
thing_got_back: {{name}} got {{thing}} back.
need_alert: You're getting {{word}}.
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
mind_plan_status: {{name}}'s plan {{#plan}}“{{plan}}”{{/plan}}{{^plan}}that's gone{{/plan}} is now {{status}}
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

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

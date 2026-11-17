---
description: The sentences the chat's history and the world's notices are made of, one per line: a bill, a payday, a statement, a credit decision, a loan paid off, a payment that did not go through, an arrival, a departure, a need, a late invoice, a bond that matured; a fight's start, round, act and end, a holiday set or taken off, a vehicle's driver. Each is the line the player's journal, the reply's list of what happened and the world's notices show for something that happened, and what the engine's own notes tell the player and the GM. One line per name, a name, a colon, then its text; `{{name}}` puts in what the engine knows of it (an amount in the world's own coin, a name, a number), `{{#name}}…{{/name}}` shows its block when the value is there. Change the words freely. Delete a line and that is not said at all.
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

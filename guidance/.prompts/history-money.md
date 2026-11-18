---
description: The sentences the money writes into the chat's history and the world's notices - a credit decision, a card's statement and each stage of a late payment, a standing payment that went out, came in or did not go through, a loan paid off, a payday and its payslip, a late invoice, a bond or an option at its end, a project's step that waits for its money, and the lines of the money summary and the books (accounts, prices, taxes, dividends, a business's sales and draws, an asset's depreciation). One line per name, a name, a colon, then its text. A name in double braces puts in what the engine knows of it (an amount in the world's own coin, a name, a number), and a block opened with a hash and closed with a slash shows only when that value is there. Change the words freely. Delete a line and that is not said at all.
format: lines
keys:
  name_*: the name the economy gives an account, a loan, a lease, a holding or a job it makes (name_symbol_in_account, name_lease and the rest)
  flow_label_*: the label of a standing payment or a bill the economy sets up (an autopay, a tax, rent, dues, living costs, a payroll, an invoice)
  party_*: the name of an outside party a posting names (walk-in customers, suppliers, owners, a purchaser)
  memo_*: the memo written into the books with a posting (a deposit, a fee, a bill paid, a sale, a tax, a share out, an opening balance, a reversal) - each is filled with what it names
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
asset_closed: {{asset}} closed {{on}} at {{price}}
asset_month_end: {{asset}}'s month-end closes
memo_cash_deposit_where: Cash deposit{{where}}
memo_cash_deposit: Cash deposit
memo_name_loan_paid_out: {{name}}: loan paid out
memo_name_replacement: {{name}} replacement
memo_walk_in_customers: Walk-in customers
memo_walk_in_takings: Walk-in takings
memo_sales_tax: Sales tax
memo_trust_distribution: Trust distribution
memo_profit_distribution: Profit distribution
memo_suppliers: Suppliers
memo_invoice_memo: Invoice: {{memo}}
memo_owner_s_draw: Owner's draw
memo_name_cash_advance_interest: {{name}} cash advance interest
memo_name_annual_fee: {{name}} annual fee
memo_name_late_fee: {{name}} late fee
memo_name_monthly_fee: {{name}} monthly fee
memo_name_interest: {{name}} interest
memo_name_rewards: {{name}} rewards
memo_returned_payment_fee: Returned payment fee
memo_opening_balance_changed: Opening balance changed
memo_living_costs: Living costs
memo_correction: Correction
memo_payment: Payment
memo_transfer: Transfer
memo_loan_payment_received: {{loan}}: payment received
memo_overdraft_transfer_from_link: Overdraft transfer from {{link}}
memo_overdraft_fee: Overdraft fee
memo_cash_advance_fee: Cash advance fee
memo_cash_you_said_you_had: Cash you said you had
memo_opening_balances: Opening balances
memo_opening_balance: Opening balance
memo_name_mortgage_paid_off: {{name}}: mortgage paid off
memo_bought_memo: Bought {{memo}}
memo_share_out_from_org: Share out from {{org}}
memo_unemployment_tax: Unemployment tax
memo_corporate_income_tax: Corporate income tax
memo_foundation_excise_tax_year: Foundation excise tax, {{year}}
memo_lent_money_to_borrowername: Lent {{money}} to {{borrowerName}}
memo_borrowed_money_from_lendername: Borrowed {{money}} from {{lenderName}}
memo_bought_name_for_price: Bought {{name}} for {{price}}
memo_label_strike_for_units_under: {{label}}: {{strike}} for {{units}} {{under}}
memo_memo_refunded: {{memo}} refunded
memo_memo_reversed: {{memo}} reversed
memo_cash_withdrawal: Cash withdrawal{{#where}} {{where}}{{/where}}{{#fees}} ({{fees}} in fees){{/fees}}
memo_business_invoice: {{business}} invoice
memo_payroll_gross_withheld: Payroll: {{gross}} gross, {{withheld}} withheld
memo_payroll: Payroll
memo_grant_to: Grant to {{to}}
memo_donation_to: Donation to {{to}}
memo_name_kind_reinvested: {{name}} {{kind}} reinvested: {{amount}}
memo_stolen_with: Stolen with {{item}}
memo_lost_with: Lost with {{item}}
memo_memo_paid_from_instead: {{memo}}: paid from {{from}} instead
memo_part_units: {{units}} units ({{pct}}%) of {{name}}
memo_part_share: {{pct}}% of {{name}}
memo_sold_part_for: Sold {{part}} for {{price}}
memo_gave_part_away: Gave {{part}} away
memo_penalty_year: {{tax}}, {{year}}
memo_invoice: Invoice
memo_sale: Sale
name_name_card: {{name}} card
name_name_checking: {{name}} checking
name_worker_at_employer: {{worker}} at {{employer}}
name_car_loan_name: Car loan, {{name}}
name_loan_to_borrowername: Loan to {{borrowerName}}
name_loan_from_lendername: Loan from {{lenderName}}
name_name_income: {{name}}: income
name_mortgage_name: Mortgage, {{name}}
name_name_s_work: {{name}}'s work
flow_label_walk_in_takings: Walk-in takings
flow_label_sales_tax: Sales tax
flow_label_profit_distribution: Profit distribution
flow_label_suppliers: Suppliers
flow_label_invoice_memo: Invoice: {{memo}}
flow_label_pay_title: Pay: {{title}}
flow_label_payroll: Payroll
flow_label_living_costs: Living costs
flow_label_name_autopay: {{name}} autopay
flow_label_loan: Loan
flow_label_payment: Payment
flow_label_tax_on_investment_income: Tax on investment income
flow_label_property_tax_name: Property tax, {{name}}
flow_label_insurance_name: Insurance, {{name}}
flow_label_upkeep_name: Upkeep, {{name}}
flow_label_rent_name_unit_unit: Rent, {{name}}, unit {{unit}}
flow_label_rent_name: Rent, {{name}}
flow_label_tax_saved_by_donations: Tax saved by donations
flow_label_dues_org: Dues: {{org}}
flow_label_foundation_excise_tax: Foundation excise tax
flow_label_tax_on_kept_earnings: Tax on kept earnings
party_walk_in_customers: Walk-in customers
party_purchaser: Purchaser
name_symbol_in_account: {{symbol}}{{#account}} in {{account}}{{/account}}
name_lease: Lease: {{tenant}}, {{#unit}}{{unit}}, {{/unit}}{{name}}
flow_label_name_interest: {{name}} interest
flow_label_name_dividend: {{name}} dividend
party_suppliers: Suppliers
party_owners: Owners

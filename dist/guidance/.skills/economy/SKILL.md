---
name: economy
description: Money that adds up. How to record a payment, a purchase, a price, a wage or a debt, and what to do when the story is vaguer than the books. Load it when coin changes hands or a price matters.
---
# Keeping the money

Everyone's coin is kept as accounts. Every payment has two sides: it leaves one account and arrives in another. Nothing is paid to nowhere, and nothing arrives from nowhere.

## A payment

`world_apply` with a `pay` operation: who pays, who is paid, how much, and what for.

- If something was bought, name the goods in the same operation: goods nothing recorded goes by are `spawn`ed first, earlier in the same call. The money and the goods change hands as one change, so a swipe takes both back. A meal bought is paid here; that it is eaten is the action `eat`, in the skill `time`.
- If it was a gift, a bribe, a fine or a loss, say which. The books keep the reason.
- A payment between two people who are both in the scene is one operation, not two.

## Before you name a price

Look first. The world prices most things, and a place lists what it sells.

1. Search for the thing's price (`tool_search` for "price").
2. If the world prices it, use that price. A seller may ask more or take less: that is the story's to tell, and you record what was actually paid.
3. If the world does not price it and the lore does not either, a price is an invented fact. The consent rule says what that takes.

## When the story is vaguer than the books

The prose says "she spent most of what she had". Do not turn that into a number.

- Record it as a fact about her, with precision `vague`.
- Leave the exact balance as it was. The world state will show both: the last exact figure and the vaguer line since.
- When the story next gives an exact figure ("she counts out her last nine silver"), set the balance from it. The prose is its source.

When someone's money matters and nothing recorded or told says what they have, `fill_in_detail` (find it with `tool_search`) draws their accounts from the world's tables; what it draws is recorded as assumed, never as established.

## What comes due

When time passes, what accounts and jobs arrange for the span happens as the clock passes it, in its order, and the answer's `ran` says what: wages, rent, a loan's instalment, a tax, a standing payment, interest and fees. Do not record those again with `pay`. A payment nobody arranged (a purchase, a gift, a debt paid off early) is a `pay` (a card's or a loan's instalment, `pay_card`); one the story says was missed or put off, where no record did it, is a `fact` about the one who owes it.

## The rest

Accounts opened and closed, a business and its takings, a price set: each has a tool of its own, found with `tool_search` and called with `tool_use`. The rest of money is the engine's own actions, carried out with the `world_apply` operation `act`: `{"op": "act", "action": "<id>", "who": "<who does it>", "params": {…}}`. `world_query` at `ruleset` lists every action the world has, and a call that leaves out what its action asks for is answered with what it needs. A requirement that does not hold is told in the answer, and the action is carried out all the same (`SIMULATION.md`); `act` passes no time.

- **Your own money:** `move_money`, `withdraw_cash`, `deposit_cash`, `pay_card`, `card_freeze`, `card_unfreeze`, `card_report_lost`, `card_replace`, `set_autopay`, `set_pay_prefs`; a standing payment: `flow_create`, `flow_update`, `flow_pause`, `flow_resume`, `flow_delete`.
- **Credit and lending:** `apply_credit`, `lend_money`.
- **A job:** `job_hire`, `job_end`, `job_raise`, `job_hours`, `job_leave`, `job_return`, `job_position`, `job_title`; how often an organization pays its staff, `org_pay_schedule`. Someone taken on for pay is a `job_hire`, not a line of text on the person.
- **A business:** `invoice_issue`, `invoice_pay`, `invoice_void`, `owner_draw`, `distribute_profit`, `donate`; its shares, `shares_issue`, `shares_buy_back`, `shares_classes`, `shares_list`, `shares_delist`, `stake_sell`; its projects, `project_start`, `project_pause`, `project_resume`, `project_drop`; its tax, `tax_consolidate`, `consent_dividend`.
- **Property and investments:** `property_buy`, `property_sell`, `property_list`, `lease_start`, `lease_end`, `trade`, `exercise_option`, `route_distributions`.

## What a tool tells you

A tool applies what you give it and reports what does not add up: a payment larger than what the payer holds, an account that does not exist, a sum that does not balance. `SIMULATION.md` says what to do with a report.

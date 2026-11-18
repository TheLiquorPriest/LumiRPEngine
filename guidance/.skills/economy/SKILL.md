---
name: economy
description: Money that adds up. How to record a payment, a purchase, a price, a wage or a debt, and what to do when the story is vaguer than the books. Load it when coin changes hands or a price matters.
---
# Keeping the money

Everyone's coin is kept as accounts. Every payment has two sides: it leaves one account and arrives in another. Nothing is paid to nowhere, and nothing arrives from nowhere.

## A payment

`world_apply` with a `pay` operation: who pays, who is paid, how much, and what for.

- If something was bought, name the goods in the same operation: goods nothing recorded goes by are `spawn`ed first, earlier in the same call. The money and the goods change hands as one change, so a swipe takes both back.
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

When time passes, the answer lists what the time brought due: wages, rent, a loan's instalment, a tax, a standing payment. It applies none of them. What is decided for each is recorded as what it was: paid is a `pay`; missed or put off is a `fact` about the one who owes it.

## The rest

Accounts opened and closed, loans, credit, taxes, a job taken or lost, a business and its takings, property: each is an action of the engine's (`apply_credit`, `lend_money`, `job_hire`, `job_end`, `job_raise`, `invoice_issue`, `owner_draw`, `property_buy`, `property_sell`, `trade` and the rest) or has a tool of its own. An action is carried out with the `world_apply` operation `act`: `{"op": "act", "action": "<id>", "who": "<who does it>", "params": {…}}`; `checks_odds` lists the ids, with what each takes, when it is given an id the world does not have. A tool is found with `tool_search` and called with `tool_use`.

## What a tool tells you

A tool applies what you give it and reports what does not add up: a payment larger than what the payer holds, an account that does not exist, a sum that does not balance. `SIMULATION.md` says what to do with a report.

---
description: How the tools for accounts, credit, donations and prices are called - gm_adjust_money, open_account, close_account, apply_credit, tax_status, donate and money_prices. It says how to call them, not when. Delete this file and the agents that are given it by a search are given no such guide.
---
Payments between parties go through world_apply's `pay`; these tools open and close accounts and keep the books. money_prices reads and changes nothing: give `item`, `place`, or only a `place` to list what it sells. open_account takes `who` and the account's `product`; apply_credit takes `who`, `product`, `amount`, `term` and, for a secured loan, `secured_by`, and the world's lending rules decide it; gm_adjust_money corrects an `account` by an `amount`, taken past what it holds it is applied and reported. Each tool that writes also takes `source`, `precision` and `standing`.

    money_prices {"item": "rope", "place": "Harbour chandler"}
    open_account {"who": "Ada", "product": "savings", "source": {"from": "prose", "message": "m-12"}}

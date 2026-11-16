---
description: How the tools for accounts, credit, donations and prices are called - gm_adjust_money, open_account, close_account, apply_credit, tax_status, donate and money_prices. It says how to call them, not when. Delete this file and an agent that finds one of them by search is given no such guide.
---
Name an account as it is kept (Wren's coin) or by its id, and a person or a group as the world names them, or by its id. A sum (`amount`, `limit`) is in the world's main coin as the world writes it, so 12.5 is twelve and a half; gm_adjust_money's `amount` is below 0 to take money out. `product` is a kind of account as the world's banking products name them, and a product the world has not is answered with the ones it has. apply_credit records the credit as you give it (`amount`, `term` in months, `apr` in percent, `limit`, `secured_by`) and fills in what you leave out from the world's tables, recorded as assumed. money_prices reads and changes nothing: `item` by its catalog id, its price category or in words, at a `place`; leave `item` out to list what the place sells.

What the world's rules would refuse (money taken past what an account holds, an account closed with money on it, credit its lending rules would turn down, a gift past what the giver holds) is recorded as you gave it, and the answer reports it; the books take nothing out of an account that is not open. Each write also takes `source`, and `precision` and `standing` where you know them.

    tool_use {"name": "apply_credit", "args": {"who": "Wren", "product": "loan", "amount": 40, "term": 12, "source": {"from": "prose", "message": "m-12"}}}
    tool_use {"name": "money_prices", "args": {"item": "a mug of cider", "place": "The Common Room"}}

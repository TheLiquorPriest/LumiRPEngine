---
description: How the tools that read one part of the world in one call are called - items_access, items_of, orgs_list, orgs_read, people_regard, places_route and money_balances. It says how to call them, not when. Delete this file and an agent that finds one of them by search is given no such guide.
---
Each reads and changes nothing, and takes names as the world spells them, or ids. items_access takes `who` and `item`: whose the thing is, who has it and where, and what lets this person use it. items_of takes a `person`: their things on them, held, elsewhere, lent, borrowed and missing. orgs_list lists every group, or with `who` the groups a person belongs to and their place in each. orgs_read takes an `org`, and `part` for one part of its page (overview, people, money, property, ownership, taxes, projects, rules, decisions or log). people_regard takes a `person`, and `toward` for one other: each axis with its band and value. places_route takes `to`, and `from` (left out, where the player's character is) and `mode` (walk, road, offroad, water or air; left out, every one): how long, how far and by which legs. money_balances takes `who`, a person or a group: cash, accounts, debts, standing payments and net worth.

    tool_use {"name": "places_route", "args": {"to": "The Far Road", "mode": "road"}}
    tool_use {"name": "money_balances", "args": {"who": "Bram"}}

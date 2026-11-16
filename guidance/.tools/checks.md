---
description: How checks_odds is called. It says how to call it, not when. Delete this file and the agents that are given it by a search are given no such guide.
---
checks_odds reads and changes nothing. Give the `action` and the `actor`, and `params` where the action takes them: it says whether the action can be tried now and, if not, why, the chance of each outcome in percent, and the dice. A roll is made with `roll`.

    checks_odds {"action": "climb", "actor": "Ada"}

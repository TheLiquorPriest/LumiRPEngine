---
description: How the tools for things, their owners, who may use them and saved outfits are called - item_condition, item_use, item_own, item_grant, item_revoke, item_permit, item_unpermit, item_home, item_label, item_merge, item_lose, item_remove, set_save, set_apply and set_drop. It says how to call them, not when. Delete this file and the agents that are given it by a search are given no such guide.
---
Each of these names a thing by `item` (or `who` for a person's outfit), changes one thing about it and nothing else, and answers with what changed and how the thing now stands. Whose a thing is, who may use it, where it is kept, and where it is and who holds it are separate facts, each changed by its own tool. Each tool that writes also takes `source`, `precision` and `standing`, as world_apply's operations do.

    item_use {"item": "oil lamp", "qty": 1, "source": {"from": "prose", "message": "m-12"}}
    set_apply {"who": "Ada", "set": "storm gear", "source": {"from": "prose", "message": "m-12"}}

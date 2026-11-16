---
description: How the tools for a person's or a thing's standing in the world are called - gm_set_life, gm_despawn, gm_restore, gm_classify, gm_set_entity, gm_link, gm_unlink and fill_in_detail. It says how to call them, not when. Delete this file and the agents that are given it by a search are given no such guide.
---
Each of these names the person or thing by `entity` (or `person`) and changes one thing about it: gm_set_life its life state and who is told, gm_despawn and gm_restore whether it is in the world (its record is kept either way), gm_classify its classes and tags, gm_set_entity its tier and the detail its life is kept at, gm_link and gm_unlink a relation `from` one thing `to` another. fill_in_detail takes `who` and a `part` and fills in what the world's tables give them and nobody has recorded. Each tool that writes also takes `source`, `precision` and `standing`.

    gm_despawn {"entity": "the stray hound", "source": {"from": "prose", "message": "m-12"}}
    gm_link {"relation": "employs", "from": "Harbour chandler", "to": "Tobin", "source": {"from": "prose", "message": "m-12"}}

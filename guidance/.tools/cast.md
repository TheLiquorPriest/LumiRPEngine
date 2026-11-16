---
description: How the tools of the cast are called - cast_query, cast_update and perceive, and a character's own recall, remember, reflect, dream, mind_set and relate. It says how to call them, not when. Delete this file and an agent that holds one of them is given no such guide.
---
cast_query reads a character's record as it stands on this turn's path: `who` by name or id (leave it out for who is in the cast), `part` one of sources, base, casting, growth, mind, relationships, knowledge, history or perceptions, and `with`, `words`, `history` and `skip` to narrow it.

    cast_query {"who": "Bram", "part": "relationships", "with": "Wren"}

cast_update takes `operations`, written in order in one write: `cast`, `bind`, `base`, `growth`, `history`, `relationship`, `knowledge` or `filed`, each with `who` and that operation's fields. perceive takes `perceptions`, one per character and moment: `who`, `moment`, how much reached them (`reach`: whole, part, told or none), what did (`content`), what did not (`missed`), what they now know (`knows`) and any secrets they now hold, by the id the lore map shows (`secrets`).

    cast_update {"operations": [{"op": "knowledge", "who": "Bram", "text": "The reeve's seal has a chipped corner.", "how": "He saw it on the letter."}]}
    perceive {"perceptions": [{"who": "Bram", "moment": "Wren opens the letter", "reach": "part", "content": "From behind the bar: Wren breaks a seal and goes pale.", "missed": "What the letter says.", "knows": ["Wren had a sealed letter."]}]}

A character's own tools write its own record, in its own words, as lists in one write. recall takes `cue`. remember takes `memories`, each with `text`, `gist`, `weight` and the people and places it is about; reflect turns memories (`from`) into a realization; dream takes `keep`, `fade` and `connect`; mind_set takes `entries`, each a `kind` and its `text`; relate takes `relationships`, each `with` a person.

    remember {"memories": [{"text": "She went pale at the letter, and I poured her cider as if I had not seen.", "gist": "Pretended not to see her go pale.", "weight": 2, "who": ["Wren"], "from": ["p-4"]}]}

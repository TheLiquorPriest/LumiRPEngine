---
description: How the tools of the cast are called - cast_query, cast_update and perceive, and a character's own recall, remember, reflect, dream, mind_set, relate and self_read. It says how to call them, not when. Delete this file and an agent that holds one of them is given no such guide.
---
cast_query reads a character's record as it stands on this turn's path: `who` by name or id (leave it out for who is in the cast), `part` one of sources, base, casting, growth, mind, relationships, knowledge, history, perceptions or away, and `with`, `words`, `history` and `skip` to narrow it.

    cast_query {"who": "Bram", "part": "relationships", "with": "Wren"}

With `how` gist, each entry comes by what the record holds that stands for it, with the size of the whole; with `question`, a reader reads the answer whole and answers it: you are given the reader's answer and none of the record.

    cast_query {"who": "Bram", "part": "perceptions", "how": "gist"}
    cast_query {"who": "Bram", "part": "history", "question": "When did Bram last see his brother, and how did they part?"}

cast_update takes `operations`, written in order in one write: `cast`, `bind`, `base`, `growth`, `history`, `relationship`, `away`, `knowledge` or `filed`, each with `who` and that operation's fields. `cast` may name the world's `person` the character is; `away` keeps where a principal out of view is (`whereabouts`, `place`), what it means to do (`intention`) and by when (`until`), and `drop` true when it is back; `history` names the story's beats it comes from (`beats`); `filed` names the carried files (`files`: `core.md`, and `minds` for the older minds pack's notes), and `drop` true marks them not filed again. perceive takes `perceptions`, one per character and moment: `who`, `moment`, how much reached them (`reach`: whole, part, told or none), what did (`content`), what did not (`missed`), what they now know (`knows`) and any secrets they now hold, by the id the lore map shows (`secrets`); a perception named by `id` with `drop` true is struck, and with `drop` false its strike is taken back.

    cast_update {"operations": [{"op": "knowledge", "who": "Bram", "text": "The reeve's seal has a chipped corner.", "how": "He saw it on the letter."}]}
    perceive {"perceptions": [{"who": "Bram", "moment": "Wren opens the letter", "reach": "part", "content": "From behind the bar: Wren breaks a seal and goes pale.", "missed": "What the letter says.", "knows": ["Wren had a sealed letter."]}]}

A character's own tools write its own record, in its own words, as lists in one write. recall takes `cue`. remember takes `memories`, each with `text`, `gist`, `weight` and the people and places it is about; reflect turns memories (`from`) into a realization; dream takes `keep`, `fade` and `connect`; mind_set takes `entries`, each a `kind` and its `text`; relate takes `relationships`, each `with` a person.

    remember {"memories": [{"text": "She went pale at the letter, and I poured her cider as if I had not seen.", "gist": "Pretended not to see her go pale.", "weight": 2, "who": ["Wren"], "from": ["p-4"]}]}

self_read reads a character's own record, for the agent that plays it: `part` one of perceptions, imported, memories, relationships, knowledge, history or game-side (leave it out for every part with its size), then what of it: `id` (with `to`, a range of ids), `day`, `scene`, `name`, `subject` or `tier`, as the part takes, `skip` to read on, and `how` gist for each entry by its gist with the size of the whole.

    self_read {"part": "perceptions", "day": "Sat 1 Mar 2031", "how": "gist"}
    self_read {"part": "perceptions", "id": "p-4", "to": "p-9"}
    self_read {"part": "imported", "name": "core.md"}

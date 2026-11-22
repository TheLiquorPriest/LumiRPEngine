---
description: How the tools that read and search the lore are called - lore_read and lore_search. It says how to call them, not when. Delete this file and an agent that holds one of them is given no such guide.
---
lore_search looks through every lore book attached to the chat and the world's own lore. `query` is names and words; `sources` limits it to some books or worlds by name; `limit` caps how many entries come back. Each entry found comes with its id, title, source and the words around the match.

lore_read takes `ids`, a list of entry ids as a search or the lore map gave them, and gives each entry with its title, source, the words that activate it and who may know it. A secret in an entry is shown with its id and who holds it. `how` says how much of each entry's text: `whole` (in full, which is what it gives when `how` is left out), `gist` (the short line the lore's index keeps for it, with the size of the whole), or `part` (its lines from `start` to `end`, counted from 1; with no `end`, as many lines as one part holds). What is not the whole ends with a line that says how much it is of how much. With `question`, a reader reads the entries named in full and answers it: you are given its answer and none of the entries, and `how`, `start` and `end` are left aside.

    lore_read {"ids": ["e-112", "w-31"]}
    lore_read {"ids": ["e-112"], "how": "gist"}
    lore_read {"ids": ["e-112"], "how": "part", "start": 40, "end": 80}
    lore_read {"ids": ["e-112", "w-31"], "question": "Which of the harbour's wardens owes the reeve, and for what?"}

---
description: How the tools that read and search the lore are called - lore_read and lore_search. It says how to call them, not when. Delete this file and an agent that holds one of them is given no such guide.
---
lore_search looks through every lore book attached to the chat and the world's own lore. `query` is names and words; `sources` limits it to some books or worlds by name; `limit` caps how many entries come back. Each entry found comes with its id, title, source and the words around the match.

lore_read takes `ids`, a list of entry ids as a search or the lore map gave them, and gives each entry in full with its title, source, the words that activate it and who may know it. A secret in an entry is shown with its id and who holds it.

    lore_read {"ids": ["e-112", "w-31"]}

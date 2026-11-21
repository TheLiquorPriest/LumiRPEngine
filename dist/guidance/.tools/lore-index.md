---
description: How lore_index_write is called. It says how to call it, not when. Delete this file and an agent that holds the tool is given no such guide.
---
lore_index_write takes `entries`, one for each entry of the batch you index, as many as you have in one call. Each entry has the `id` and the `revision` the batch shows for it, its `kind`, and `line`, one line saying what it is. Where they apply, `defines` lists what it is the source for, each with a `what` and the `aspect` it defines, and `related` lists the ids of other entries a reader of it would want. A further field the indexer's instructions name goes in by that name.

    lore_index_write {"entries": [{"id": "w-31", "revision": "3", "kind": "place", "line": "The Gilded Hart, a dockside inn kept by Sorrel Marsh.", "defines": [{"what": "the Gilded Hart", "aspect": "background"}], "related": ["e-12"]}]}

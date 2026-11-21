---
description: How archive_search is called. It says how to call it, not when. Delete this file and an agent that holds the tool is given no such guide.
---
archive_search looks through what the system keeps besides the chat and the lore: this chat's earlier sessions (the store `sessions`) and any other store the system has, such as databanks, the chat application's memory and summaries. `query` is names and words; `stores` limits it to some stores by name; `limit` caps how many things come back. Each hit comes with its `ref`, its title, its store and the words around the match. To read one in full, call again with its `ref` alone.

    archive_search {"query": "the toll on the north bridge", "stores": ["sessions"]}
    archive_search {"ref": "<the ref of a hit>"}

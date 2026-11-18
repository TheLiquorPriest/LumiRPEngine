---
description: How suggest is called. It says how to call it, not when. Delete this file and an agent that holds the tool is given no such guide.
---
suggest puts one proposed change before the player. Name what it is for with exactly one of `file` (a file's path as the agents see the files), `lore` (the id of a lore entry) and `new_lore` (true, for a new entry); give the proposed `text` and the `reason`. A new entry also takes its `book`, its `title` and its `keys`, a list. An edit of an entry gives `was`, the passage as it stands now, and `text`, the passage as it would be. The player is shown a lore suggestion whole, accepts it, changes it or dismisses it, and the call changes nothing itself.

    suggest {"file": "WORLD.md", "text": "The harbour freezes in winter.", "reason": "The story has said so twice."}
    suggest {"new_lore": true, "book": "The Hart's Rest", "title": "The Gilded Hart", "keys": ["Gilded Hart", "the Hart"], "text": "A dockside inn kept by Sorrel Marsh.", "reason": "The scene turned on it twice."}

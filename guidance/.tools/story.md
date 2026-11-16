---
description: How the tools that read and write the story record are called - story_query and story_record. It says how to call them, not when. Delete this file and an agent that holds one of them is given no such guide.
---
story_query reads the record as it stands on this turn's path. `part` is one of premise, chapter, scene, beat, thread, arc, player, future, canon, retcon or record; leave it out for every part. `id` reads one item; `from` and `to` limit it by message number; `who`, `open`, `due` and `hot` narrow it; `history` gives each item with every write of it. Messages are numbered as the story so far numbers them.

    story_query {"part": "thread", "open": true, "who": "Bram"}

story_record takes `operations`, recorded in order in one write. Each has an `op`, the part it writes, and that part's fields, which the tool's arguments list. Leave `id` out to add a new beat, thread, player note, future, canon or retcon; give the id the record gave an item to change it. A chapter or scene with no id is the current one while it is open.

    story_record {"operations": [{"op": "beat", "text": "Bram slides the sealed letter across the bar.", "who": ["Bram", "Wren"]}, {"op": "thread", "id": "th-4", "state": "Wren has the letter; the seal is unbroken.", "hot": true}, {"op": "record", "intent": "An action: Wren takes the letter.", "decided": "Bram gives it, uneasy.", "why": "He is frightened of the sender."}]}

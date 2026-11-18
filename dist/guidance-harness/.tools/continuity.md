---
description: How gap_check is called. It says how to call it, not when. Delete this file and an agent that holds the tool is given no such guide.
---
gap_check searches the chat, the lore and the other records the system offers for one topic. `topic` is the thing's name; `terms` are its other names and the words around it; `limit` caps the hits from each place. The answer gives each place's hits and an id: what was searched and what came back is saved with the turn under that id, and it is the id to name where a consent asks for a gap check (`gap_check` in agent_message's `consent`).

    gap_check {"topic": "the harbour master", "terms": ["Harbourmaster Orrin", "the quay office"]}

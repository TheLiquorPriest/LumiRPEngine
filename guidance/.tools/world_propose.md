---
description: world_propose as a Build job's agent is told it - what the tool does, and what each of its arguments is.
arguments:
  proposals: "Import from lore and Refine: the proposals, each {collection, key, value, source, confidence, note}."
  entries: "Index this text: the lore entries, each {key, title, content, aliases, topics, links, terms, confidence, note}."
  map: "Describe a map: the whole map, in the map format."
  routines: "Propose routines: the routine blocks, each with its owner and source."
  schedules: "Propose routines: the schedules, each with its owner and source."
---
Proposes world data for him to review: the job's kind says which argument it takes. Each call is checked against the world's draft at once and kept with the job; the answer says what stands and what was dropped or is wrong, and why. Send a thing again with the same id to fix it. Nothing is written to the world.

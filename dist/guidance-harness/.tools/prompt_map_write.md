---
description: prompt_map_write as the model is told it - what the tool does, and what its argument is.
arguments:
  slices: Every slice of the map, each with its marker (the name agents will ask for it by), its kind, one line on what it is, how it behaves (fixed, scene for one that changes with the scene, turn for one that changes every turn), the parts of the prompt it is made of by the names prompt gives them, and, where it begins partway through its first part, its first words as starts.
---
Saves the map of the prompt's preset, which every chat on that preset then uses: a slice for each thing a reader would call one thing, made of parts of this prompt. Where a slice begins partway through a part, the slice before it in that part ends there. Chat history and lore are not mapped: they go by message and by entry. The player's own changes to the map are kept. The answer says whether the map was saved, and names any text that belongs to no slice.

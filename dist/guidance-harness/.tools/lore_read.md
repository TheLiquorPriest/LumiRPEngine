---
description: lore_read as the model is told it - what the tool does, and what each of its arguments is.
doing: reading the lore
arguments:
  ids: The ids of the entries to read, such as e-112 or w-31.
  how: How much of each entry - whole (its text in full, which is what it gives when you leave this out), part (some of its lines), or gist (the short line the lore's index keeps for it).
  start: With how part, the first line to give, counted from 1. Leave it out to start at the first.
  end: With how part, the last line to give. Leave it out for as many lines as one part holds.
  question: A question about these entries. A reader reads them in full and answers it, and its answer is what you are given in place of the entries; how, start and end are then left aside.
---
Reads lore entries, each with its title, its source, the words that activate it and who may know it: in full, or as much of each as you ask for. Its secrets are shown as secrets, with their ids and who holds them. What is not the whole entry ends with a line that says how much it is of how much. Asked with a question, it gives the answer of a reader that read the entries in full, and not the entries.

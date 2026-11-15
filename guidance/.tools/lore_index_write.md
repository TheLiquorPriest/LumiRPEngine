---
description: lore_index_write as the model is told it - what the tool does, and what each of its arguments is.
arguments:
  entries: The index lines, one for each entry you index, as many as you have in one call.
  entries.id: "The entry's id, as the batch shows it: e-12, w-31."
  entries.revision: The entry's revision, as the batch shows it beside the entry. The lines are kept for that revision.
  entries.kind: "What kind of thing the entry is: character, place, item, faction, rule, event, concept or style; unclear if it does not say."
  entries.line: One line saying what the entry is, from the entry itself.
  entries.defines: The people, places, things or quests the entry is the source for.
  entries.defines.what: Its name, as the entry gives it.
  entries.defines.aspect: "Which side of it the entry defines: background, appearance, voice, layout, rules."
  entries.related: Other entries a reader of this one would want, by id.
---
Keeps the index lines of lore entries: for each, its kind, one line saying what it is, what it defines and the entries related to it. The Author's lore map shows these lines, so it knows what the lore holds without reading all of it. Each line is kept for the revision of the entry the batch showed; if the entry has changed since, it is handed out again. The answer says what was kept and gives the next entries not indexed yet, with their text.

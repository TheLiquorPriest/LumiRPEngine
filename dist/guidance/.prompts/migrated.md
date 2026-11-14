---
description: The layout of what the migration carried of a chat from the earlier build, given to the notice `migrated_chat` (in notices.md) as its `carried`, in the chat's first briefing on RPE. Which engine played it and how many turns its path holds, and how many of them it shares with the chat it was branched from; each character's mind files, attached word for word and not yet filed; what the story record held; where the notes are. Each part appears only when there is something in it. It lays facts out; it asks for nothing.
---
{{#played}}
It was played by the earlier build's {{played.engine}} engine; {{played.turns}} of its turns were carried, each with what it changed{{#played.shared}}, {{played.shared.turns}} of them shared with the chat it was branched from{{/played.shared}}.
{{/played}}
{{#marked}}
Where RPE's reckoning of a turn's state differed from the earlier build's, the earlier build's state was kept as that turn's.
{{/marked}}
{{#characters}}
Mind files from the earlier build, on each character's record word for word, not yet filed:
{{#characters.items}}
- {{name}}: {{files}}
{{/characters.items}}
{{/characters}}
{{#story}}
From the earlier build's story record: {{story.beats}} beat(s) and {{story.struck}} strike(s) on the timeline, {{story.futures}} draft(s) as proposed futures, {{story.castings}} casting(s) in the cast.
{{/story}}
{{#notes}}
The Author's notes from the earlier build are in `{{notes.folder}}`, as they stood at its last turn; each earlier version is in `{{notes.versions}}`, by the turn that wrote it{{#notes.learned}}; what it had learned is in `{{notes.learned.folder}}`{{/notes.learned}}.
{{/notes}}

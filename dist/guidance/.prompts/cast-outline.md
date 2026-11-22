---
description: The layout of the rest of a character's record, in outline (the `outline` of `cast:self`) - what their own agent is not handed whole when it starts, each line with how many it counts, their size in tokens as the chat counts them, and the self_read call that opens them. What they perceived earlier and have not taken in, by day and by scene, each perception with its id, its size, the moment as it was named and the lines of what they came to know by it (nothing of what reached them is put in a line - that is read whole); their memories by tier; how they feel about people who are not here; what they know; their history; and their old mind files, where the `imported` view is not given beside it. A scene is named by its id, under its day, and never by its title, which is the story record's words and is not the character's to read. It fills at most the setting cast.outlineTokens - the people, the days, the scenes and the perceptions are listed, the newest first, as far as that holds, and what is not listed is counted in the line above it. Where the newest perceptions are given whole beside it, the to part of a line ends its call at the last one that waits, so that a call brings what its line counts. self_read is the character's own tool; for anyone else, cast_query reads the same record. When none of the views an agent is given by cast:self has anything in it, the none part says so. It lays out what the record holds; it asks for nothing.
---
{{#name}}
### The rest of {{name}}'s record, in outline
{{/name}}
{{#none}}

Nothing more of theirs is recorded.
{{/none}}
{{#perceived}}

Perceived{{#earlier}} earlier{{/earlier}} and not yet taken in: {{count}} {{#one}}perception{{/one}}{{^one}}perceptions{{/one}}, {{tokens}} tokens. self_read reads them: part perceptions{{#to}}, to {{to}}{{/to}}; with how gist, each by what they came to know by it.
{{/perceived}}
{{#perceived.older}}
- Before the days listed here: {{count}} {{#one}}perception{{/one}}{{^one}}perceptions{{/one}}, {{tokens}} tokens.{{#to}} self_read reads them: part perceptions, to {{to}}.{{/to}}
{{/perceived.older}}
{{#perceived.days.items}}
- {{#day}}{{day}}{{/day}}{{^day}}With no date{{/day}}: {{count}} {{#one}}perception{{/one}}{{^one}}perceptions{{/one}}, {{tokens}} tokens.{{#day}} self_read reads them: part perceptions, day {{day}}{{#to}}, to {{to}}{{/to}}.{{/day}}
{{#scenes.items}}
  - Scene {{id}}: {{count}} {{#one}}perception{{/one}}{{^one}}perceptions{{/one}}, {{tokens}} tokens. self_read reads them: part perceptions, {{#day}}day {{day}}, {{/day}}scene {{id}}{{#to}}, to {{to}}{{/to}}.
{{#items}}
    - [{{id}}] {{tokens}} tokens{{#moment}}, {{moment}}{{/moment}}{{#knows}}: {{knows}}{{/knows}}
{{/items}}
{{/scenes.items}}
{{#loose.items}}
  - [{{id}}] {{tokens}} tokens{{#moment}}, {{moment}}{{/moment}}{{#knows}}: {{knows}}{{/knows}}
{{/loose.items}}
{{/perceived.days.items}}
{{#memories}}

Memories: {{count}} {{#one}}memory{{/one}}{{^one}}memories{{/one}}, {{tokens}} tokens. self_read reads them: part memories; with how gist, each by its gist.
{{/memories}}
{{#memories.top}}
- At the top of their mind: {{count}}, {{tokens}} tokens. self_read reads them: part memories, tier top.
{{/memories.top}}
{{#memories.short}}
- Lately: {{count}}, {{tokens}} tokens. self_read reads them: part memories, tier short.
{{/memories.short}}
{{#memories.long}}
- From longer ago: {{count}}, {{tokens}} tokens. self_read reads them: part memories, tier long.
{{/memories.long}}
{{#absent}}

How they feel about people who are not here: {{count}} {{#one}}person{{/one}}{{^one}}people{{/one}}, {{tokens}} tokens. self_read reads one: part relationships, name and the person's name.
{{/absent}}
{{#absent.who.items}}
- {{who}}: {{tokens}} tokens
{{/absent.who.items}}
{{#knowledge}}

What they know: {{count}} {{#one}}statement{{/one}}{{^one}}statements{{/one}}, {{tokens}} tokens. self_read reads them: part knowledge; with subject and a few words, only those that hold the words.
{{/knowledge}}
{{#history}}

Their history in the story: {{count}} {{#one}}entry{{/one}}{{^one}}entries{{/one}}, {{tokens}} tokens. self_read reads it: part history.
{{/history}}
{{#imported}}

Their old mind files, not yet filed: {{count}} {{#one}}file{{/one}}{{^one}}files{{/one}}, {{tokens}} tokens. self_read reads one: part imported, name and the file's name.
{{/imported}}
{{#imported.files.items}}
- {{file}}: {{tokens}} tokens
{{/imported.files.items}}
{{#imported.minds}}
- The notes the older minds pack kept of them (minds): {{tokens}} tokens
{{/imported.minds}}

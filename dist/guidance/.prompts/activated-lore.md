---
description: The layout of `ACTIVATED-LORE.md` in a session's cache folder. Every lore entry Lumiverse activated for a prompt of this scene, one line each - its id and title, where it is from, its size, how it activated, whether it is new this turn, changed or as last turn, what the Author did with it when its prompt last held it, and the file in the same folder that holds its text as the Author reads it in full. Written at each turn's start, before the Author's first call; not written for a scene whose prompts have held no entry. It lists what the scene's prompts have held; it asks for nothing.
---
{{#any}}
# The lore this scene's prompts have held

Each entry's text is in the file its line names, as the Author reads it in full. A text is written once, and again only when it changes.
{{#here}}

## In this turn's prompt ({{here.count}})

{{#here.entries}}
- [{{id}}] {{title}}{{#source}}, from {{source}}{{/source}}{{#tokens}}, {{tokens}} tokens{{/tokens}}{{#no_text}}, its text not found in the prompt{{/no_text}}{{#how_constant}}, on every turn{{/how_constant}}{{#how_keyword}}, by a key{{/how_keyword}}{{#how_vector}}, by meaning{{/how_vector}}{{#how_sticky}}, still sticky from an earlier turn{{/how_sticky}}{{#is_new}}; new this turn{{/is_new}}{{#is_changed}}; its text changed since last turn{{/is_changed}}{{#is_same}}; as last turn{{/is_same}}{{#kept}}; kept whole by the Author when a prompt last held it{{/kept}}{{#let_go}}; let go by the Author when a prompt last held it{{/let_go}}{{#file}}: {{file}}{{/file}}
{{/here.entries}}
{{/here}}
{{#left}}

## In an earlier prompt of this scene, not in this one ({{left.count}})

{{#left.entries}}
- [{{id}}] {{title}}{{#source}}, from {{source}}{{/source}}{{#tokens}}, {{tokens}} tokens{{/tokens}}{{#is_gone}}; it left with this turn{{/is_gone}}{{#kept}}; kept whole by the Author when a prompt last held it{{/kept}}{{#let_go}}; let go by the Author when a prompt last held it{{/let_go}}{{#file}}: {{file}}{{/file}}
{{/left.entries}}
{{/left}}
{{/any}}

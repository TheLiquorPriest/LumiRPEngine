---
description: The layout of `active-wi-content.md` in each turn's folder. The lore map, then one line for each lore entry that activated for this prompt, with its size and the file that holds its text as the Author reads it in full. The texts themselves are not in it - each is kept once, in the session's cache folder, and the scene's own list there (`ACTIVATED-LORE.md`) says how each entry stands turn against turn; each entry still gives its text as `text`, for a layout that prints it. It lays the lore out; it asks for nothing.
---
{{#lore_map}}
# Lore map

{{lore_map}}

{{/lore_map}}
{{#listed}}
# The lore that activated for this prompt

{{#scene_list}}
Every entry this scene's prompts have held is listed in {{scene_list}}

{{/scene_list}}
{{#entries}}
- [{{id}}] {{title}}{{#source}}, from {{source}}{{/source}}{{#how}}, activated by {{how}}{{/how}}{{#tokens}}, {{tokens}} tokens{{/tokens}}{{#file}}: {{file}}{{/file}}
{{/entries}}
{{/listed}}

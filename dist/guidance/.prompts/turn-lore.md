---
description: The layout of `active-wi-content.md` in each turn's folder. The lore map, then each lore entry that activated for this prompt, in full, as agents read it. It lays the lore out; it asks for nothing.
---
{{#lore_map}}
# Lore map

{{lore_map}}

{{/lore_map}}
{{#entries}}
## [{{id}}] {{title}}{{#source}}, from {{source}}{{/source}}{{#how}}, activated by {{how}}{{/how}}

{{text}}

{{/entries}}

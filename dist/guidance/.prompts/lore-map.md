---
description: The layout of the lore map the Author is given at the start of every turn. One line per entry, with its id. Each part appears only when there is something in it. It lays out what the lore holds and what the story has changed; it asks for nothing.
---
{{#in_prompt}}
### In the prompt

{{#in_prompt.lines}}
- {{.}}
{{/in_prompt.lines}}
{{/in_prompt}}
{{#changed}}

### Changed by the story

{{#changed.lines}}
- {{.}}
{{/changed.lines}}
{{/changed}}
{{#world}}

### From the world's own lore, not in the prompt

{{#world.lines}}
- {{.}}
{{/world.lines}}
{{/world}}
{{#bound}}

### Not in the prompt, but bound to who and what is at hand

{{#bound.lines}}
- {{.}}
{{/bound.lines}}
{{#bound.left_out}}
- and {{bound.left_out}} more
{{/bound.left_out}}
{{/bound}}
{{#not_indexed}}

{{not_indexed}} attached entries are not indexed yet. They show by title and keys only.
{{/not_indexed}}

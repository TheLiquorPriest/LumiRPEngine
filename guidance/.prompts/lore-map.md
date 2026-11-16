---
description: The layout of the lore map the Author is given at the start of every turn. One line per entry, with its id. Each part appears only when there is something in it. It lays out what the lore holds and what the story has changed; it asks for nothing.
---
{{#in_prompt}}
### In the prompt, each in full, as its text alone with no title or id

{{#in_prompt.lines}}
- {{.}}
{{/in_prompt.lines}}
{{#in_prompt.entries}}
- [{{id}}] {{title}}{{#kind}} ({{kind}}){{/kind}}{{#line}}: {{line}}{{/line}}{{#defines}} Defines {{defines}}.{{/defines}}{{#extras}} {{extras}}.{{/extras}}{{#notes}} {{note}} (on turn {{turn}}).{{/notes}}{{#how_constant}} (on every turn){{/how_constant}}{{#how_keyword}} (by a key){{/how_keyword}}{{#how_vector}} (by meaning){{/how_vector}}{{#how_sticky}} (still sticky from an earlier turn){{/how_sticky}}{{#stale}} (changed since it was indexed){{/stale}}{{#keys}} (not indexed yet; keys: {{keys}}){{/keys}}
{{/in_prompt.entries}}
{{/in_prompt}}
{{#changed}}

### Changed by the story

{{#changed.lines}}
- {{.}}
{{/changed.lines}}
{{#changed.entries}}
- [{{id}}] {{title}}:{{#notes}} {{note}} (on turn {{turn}}){{/notes}}
{{/changed.entries}}
{{/changed}}
{{#world}}

### From the world's own lore, not in the prompt

{{#world.lines}}
- {{.}}
{{/world.lines}}
{{#world.entries}}
- [{{id}}] {{title}}{{#kind}} ({{kind}}){{/kind}}{{#line}}: {{line}}{{/line}}{{#extras}} {{extras}}.{{/extras}}{{#notes}} {{note}} (on turn {{turn}}).{{/notes}}{{#stale}} (changed since it was indexed){{/stale}}{{#keys}} (not indexed yet; keys: {{keys}}){{/keys}}
{{/world.entries}}
{{/world}}
{{#bound}}

### Not in the prompt, but bound to who and what is at hand

{{#bound.lines}}
- {{.}}
{{/bound.lines}}
{{#bound.entries}}
- [{{id}}] {{title}}{{#kind}} ({{kind}}){{/kind}}{{#line}}: {{line}}{{/line}} Bound to {{bound}}.{{#extras}} {{extras}}.{{/extras}}{{#notes}} {{note}} (on turn {{turn}}).{{/notes}}{{#stale}} (changed since it was indexed){{/stale}}{{#keys}} (not indexed yet; keys: {{keys}}){{/keys}}
{{/bound.entries}}
{{#bound.left_out}}
- and {{bound.left_out}} more
{{/bound.left_out}}
{{/bound}}
{{#not_indexed}}

{{not_indexed}} attached entries are not indexed yet. Where one is listed here, it shows by title and keys only.
{{/not_indexed}}

---
description: The layout of the lore map the Author is given at the start of every turn. One line per entry, with its id, its size and the secrets it holds, each with who holds it; an entry in the prompt also says whether it is new this turn, changed or as last turn, and what the Author did with it then. Each part appears only when there is something in it. It lays out what the lore holds, what the story has changed and what has left the prompt; it asks for nothing.
---
{{#in_prompt}}
### In the prompt, each in full, as its text alone with no title or id

{{#in_prompt.lines}}
- {{.}}
{{/in_prompt.lines}}
{{#in_prompt.entries}}
- [{{id}}] {{title}}{{#kind}} ({{kind}}){{/kind}}{{#tokens}}, {{tokens}} tokens{{/tokens}}{{#line}}: {{line}}{{/line}}{{#defines}} Defines {{defines}}.{{/defines}}{{#extras}} {{extras}}.{{/extras}}{{#notes}} {{note}} (on turn {{turn}}).{{/notes}}{{#secrets}} Secret {{id}}{{#holders}}, held by {{holders}}{{/holders}}.{{/secrets}}{{#how_constant}} (on every turn){{/how_constant}}{{#how_keyword}} (by a key){{/how_keyword}}{{#how_vector}} (by meaning){{/how_vector}}{{#how_sticky}} (still sticky from an earlier turn){{/how_sticky}}{{#is_new}} (new this turn){{/is_new}}{{#is_changed}} (its text changed since last turn){{/is_changed}}{{#is_same}} (as last turn){{/is_same}}{{#kept_last_turn}} (you kept it whole last turn){{/kept_last_turn}}{{#let_go_last_turn}} (you let it go last turn{{#starts_let_go}}, and it starts this turn let go, as its line{{/starts_let_go}}){{/let_go_last_turn}}{{#stale}} (changed since it was indexed){{/stale}}{{#keys}} (not indexed yet; keys: {{keys}}){{/keys}}
{{/in_prompt.entries}}
{{/in_prompt}}
{{#changed}}

### Changed by the story

{{#changed.lines}}
- {{.}}
{{/changed.lines}}
{{#changed.entries}}
- [{{id}}] {{title}}:{{#notes}} {{note}} (on turn {{turn}}){{/notes}}{{#secrets}} Secret {{id}}{{#holders}}, held by {{holders}}{{/holders}}.{{/secrets}}
{{/changed.entries}}
{{/changed}}
{{#world}}

### From the world's own lore, not in the prompt

{{#world.lines}}
- {{.}}
{{/world.lines}}
{{#world.entries}}
- [{{id}}] {{title}}{{#kind}} ({{kind}}){{/kind}}{{#tokens}}, {{tokens}} tokens{{/tokens}}{{#line}}: {{line}}{{/line}}{{#extras}} {{extras}}.{{/extras}}{{#notes}} {{note}} (on turn {{turn}}).{{/notes}}{{#secrets}} Secret {{id}}{{#holders}}, held by {{holders}}{{/holders}}.{{/secrets}}{{#stale}} (changed since it was indexed){{/stale}}{{#keys}} (not indexed yet; keys: {{keys}}){{/keys}}
{{/world.entries}}
{{/world}}
{{#bound}}

### Not in the prompt, but bound to who and what is at hand

{{#bound.lines}}
- {{.}}
{{/bound.lines}}
{{#bound.entries}}
- [{{id}}] {{title}}{{#kind}} ({{kind}}){{/kind}}{{#tokens}}, {{tokens}} tokens{{/tokens}}{{#line}}: {{line}}{{/line}} Bound to {{bound}}.{{#extras}} {{extras}}.{{/extras}}{{#notes}} {{note}} (on turn {{turn}}).{{/notes}}{{#secrets}} Secret {{id}}{{#holders}}, held by {{holders}}{{/holders}}.{{/secrets}}{{#stale}} (changed since it was indexed){{/stale}}{{#keys}} (not indexed yet; keys: {{keys}}){{/keys}}
{{/bound.entries}}
{{#bound.left_out}}
- and {{bound.left_out}} more
{{/bound.left_out}}
{{/bound}}
{{#gone}}

### In last turn's prompt, not in this one

{{#gone.lines}}
- {{.}}
{{/gone.lines}}
{{#gone.entries}}
- [{{id}}] {{title}}{{#tokens}}, {{tokens}} tokens{{/tokens}}
{{/gone.entries}}
{{/gone}}
{{#not_indexed}}

{{not_indexed}} attached entries are not indexed yet. Where one is listed here, it shows by title and keys only.
{{/not_indexed}}

---
description: The layout of what waits for a character's own agent to take in, as work (the `take-in` of `cast:self`, which the character definition names for a start whose purpose is take-in). Where what it perceived and has not taken in fits one batch (the setting cast.takeInTokens), the whole part says how many and how large, and the perceptions follow in full, laid out by cast-perceptions.md. Where it does not, the batches part lists the batches - each a range of perceptions by their ids, oldest first, with the name that opens it, how many it holds, its size and the dates it runs between - and none of the perceptions is given. The files part lists the old mind files carried over from the earlier build that are not yet filed, each with the name that opens it and its size. The none part says so when nothing waits. It lays out what the record holds; what the agent does with it is in its definition.
---
### What waits for {{name}} to take in
{{#none}}

Nothing waits: every perception has been taken in, and no old mind file is waiting to be filed.
{{/none}}
{{#whole}}

{{count}} perception{{^one}}s{{/one}}, about {{tokens}} tokens, in full below.
{{/whole}}
{{#batches}}

{{perceptions}} perceptions, about {{tokens}} tokens, in {{count}} batches of at most {{most}} tokens each, oldest first. None of them is in front of you: each batch is opened by its name.
{{#items}}
- Batch {{n}}: `cast:self({{view}})`, {{count}} perception{{^one}}s{{/one}}, about {{tokens}} tokens{{#since}}, {{since}}{{#until}} to {{until}}{{/until}}{{/since}}.
{{/items}}
{{/batches}}
{{#files}}

Old mind files not yet filed ({{count}}), each opened by its name:
{{#items}}
- `cast:self({{view}})`, about {{tokens}} tokens.
{{/items}}
{{/files}}

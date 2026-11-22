---
description: The layout of the ruleset's index an agent is given by name (ruleset:index) in place of the ruleset whole. One line for each part of the world's ruleset, with how many entries it holds and its size in tokens, and the tool that reads a part or one entry of it. When the world has no ruleset to list, the none part says so. It lays the index out; it asks for nothing.
---
{{#none}}
This world's ruleset has no parts.
{{/none}}
{{^none}}
The world's ruleset, by its parts ({{tokens}} tokens whole). ruleset_read with a part reads that part whole; with an id too, one entry of it. world_query at ruleset reads all of it.

{{#parts}}
- {{part}}{{#entries}}: {{entries}} entries{{/entries}}{{#tokens}}, {{tokens}} tokens{{/tokens}}
{{/parts}}
{{/none}}

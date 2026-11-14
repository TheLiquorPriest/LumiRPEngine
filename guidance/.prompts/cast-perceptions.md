---
description: The layout of a character's perceptions not yet turned into memory, in full, oldest first, each with its id and the reply it is of (the `unprocessed-perceptions` of `cast:self`). Each field appears only when it was written. It lays out what the record holds; it asks for nothing.
---
### What {{name}} has perceived and not yet taken in
{{#perceptions.items}}

[{{id}}]{{#moment}} {{moment}}{{/moment}}{{#date}} ({{date}}){{/date}}{{#message}}, message {{message}}{{/message}}
- How much reached them: {{reach}}
{{#content}}
- What reached them: {{content}}
{{/content}}
{{#missed}}
- What they missed: {{missed}}
{{/missed}}
{{#knows}}
- What they now know: {{knows}}
{{/knows}}
{{#told_by}}
- Told by {{told_by}}{{#reliability}}: {{reliability}}{{/reliability}}
{{/told_by}}
{{/perceptions.items}}

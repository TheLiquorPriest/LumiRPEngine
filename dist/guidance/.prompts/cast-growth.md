---
description: The layout of how a character has changed from their base, each change with what caused it and when, as it is given apart from the base (the `growth` of `cast:self`). Beside the base it adds nothing, since the base shows it already. When none of the views an agent is given by cast:self has anything in it, the none part says so. It lays out what the record holds; it asks for nothing.
---
{{#name}}
### How {{name}} has changed
{{/name}}
{{#none}}

No change from their base is recorded.
{{/none}}

{{#growth.items}}
- {{text}}{{#cause}} Because: {{cause}}{{/cause}}{{#date}} ({{date}}){{/date}}
{{/growth.items}}

---
description: The layout of a character's base as it is given (the `base` of `cast:self` in a definition's given list), with how they have grown laid over it and the sources it was drawn from. Each part appears only when there is something in it. It lays out what the record holds; it asks for nothing.
---
### {{name}}{{#casting}} ({{casting}}){{/casting}}
{{#line}}

{{line}}
{{/line}}
{{#seed}}

Seed: {{seed}}
{{/seed}}
{{#soul}}

Soul: {{soul}}
{{/soul}}
{{#inner_voice}}

Inner Voice: {{inner_voice}}
{{/inner_voice}}
{{#background}}

Background: {{background}}
{{/background}}
{{#growth}}

How they have changed since:
{{#growth.items}}
- {{text}}{{#cause}} Because: {{cause}}{{/cause}}{{#date}} ({{date}}){{/date}}
{{/growth.items}}
{{/growth}}
{{#sources}}

Drawn from:
{{#sources.items}}
- {{kind}} {{id}}{{#title}}: {{title}}{{/title}}{{#defines}}, for {{defines}}{{/defines}}{{#changed}} (changed since the base was drawn from it){{/changed}}{{#unseen}} (bound after the base was drawn){{/unseen}}{{#gone}} (no longer in Lumiverse){{/gone}}
{{/sources.items}}
{{#older}}

This base is older than a source marked here.
{{/older}}
{{/sources}}

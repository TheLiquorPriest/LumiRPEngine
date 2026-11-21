---
description: The layout of how a character feels about each person on stage with them, in their own voice, with the dimensions written where there are any, from -100 to 100 (the `relationships:present` of `cast:self`). When none of the views an agent is given by cast:self has anything in it, the none part says so. It lays out what the record holds; it asks for nothing.
---
{{#name}}
### How {{name}} feels about those here
{{/name}}
{{#none}}

Nothing is recorded of how they feel about anyone here.
{{/none}}

{{#relationships.items}}
- {{with}}: {{text}}{{#trust}} Trust {{trust}}.{{/trust}}{{#warmth}} Warmth {{warmth}}.{{/warmth}}{{#respect}} Respect {{respect}}.{{/respect}}{{#fear}} Fear {{fear}}.{{/fear}}
{{/relationships.items}}

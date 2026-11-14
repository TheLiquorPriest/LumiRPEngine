---
description: The layout of what is on a character's mind now, by kind, in the words their own agent wrote, each with what it is about (the `mind` of `cast:self`). Each kind appears only when there is something in it. When none of the views an agent is given by cast:self has anything in it, the none part says so. It lays out what the record holds; it asks for nothing.
---
### On {{name}}'s mind
{{#none}}

Nothing is recorded on their mind.
{{/none}}
{{#attention}}

Attention:
{{#attention.items}}
- {{text}}{{#about}} (about {{about}}){{/about}}
{{/attention.items}}
{{/attention}}
{{#feeling}}

Feeling:
{{#feeling.items}}
- {{text}}{{#about}} (about {{about}}){{/about}}
{{/feeling.items}}
{{/feeling}}
{{#belief}}

Beliefs:
{{#belief.items}}
- {{text}}{{#about}} (about {{about}}){{/about}}
{{/belief.items}}
{{/belief}}
{{#want}}

Wants:
{{#want.items}}
- {{text}}{{#about}} (about {{about}}){{/about}}
{{/want.items}}
{{/want}}
{{#plan}}

Plans:
{{#plan.items}}
- {{text}}{{#about}} (about {{about}}){{/about}}
{{/plan.items}}
{{/plan}}
{{#hiding}}

What they hide:
{{#hiding.items}}
- {{text}}{{#about}} (about {{about}}){{/about}}
{{/hiding.items}}
{{/hiding}}

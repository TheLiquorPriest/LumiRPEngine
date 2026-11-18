---
description: The layout of what comes to a character's mind in a scene (the `what-comes-to-mind` of `cast:self`) - what is at the top of their mind, in full; recent memories that touch who and what is here; the strongest older ones that touch them, a faded one by its gist alone, marked faint; and how many more touch them but were left out for room. Each memory has its id. When none of the views an agent is given by cast:self has anything in it, the none part says so. It lays out what the record holds; it asks for nothing.
---
{{#name}}
### What comes to {{name}}'s mind
{{/name}}
{{#none}}

Nothing comes to their mind about who and what is here.
{{/none}}
{{#top}}

At the top of their mind:
{{#top.items}}
- [{{id}}] {{text}}{{#tone}} (felt {{tone}}){{/tone}}{{#date}} ({{date}}){{/date}}
{{/top.items}}
{{/top}}
{{#short}}

Lately:
{{#short.items}}
- [{{id}}] {{#faint}}(faint) {{gist}}{{/faint}}{{^faint}}{{text}}{{/faint}}{{#tone}} (felt {{tone}}){{/tone}}{{#date}} ({{date}}){{/date}}
{{/short.items}}
{{/short}}
{{#long}}

From longer ago:
{{#long.items}}
- [{{id}}] {{#faint}}(faint) {{gist}}{{/faint}}{{^faint}}{{text}}{{/faint}}{{#tone}} (felt {{tone}}){{/tone}}{{#date}} ({{date}}){{/date}}
{{/long.items}}
{{/long}}
{{#left}}

{{left.count}} more memories touch who and what is here, and were left out for room.
{{/left}}

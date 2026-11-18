---
description: The layout of a character's history through the story, as the Author recorded it, oldest first, each with its date in story time and the beats it comes from, each with the words the story record has for when it happened (the `history` view - of a character, or of each one on stage the Author is given). When none of the views an agent is given by cast:self has anything in it, the none part says so. It lays out what the record holds; it asks for nothing.
---
{{#name}}
### {{name}}'s history in the story
{{/name}}
{{#none}}

Nothing of their story is recorded yet.
{{/none}}
{{#history.items}}
- {{text}}{{#date}} ({{date}}){{/date}}{{#linked}} (beat {{id}}{{#when}}, {{when}}{{/when}}){{/linked}}
{{/history.items}}

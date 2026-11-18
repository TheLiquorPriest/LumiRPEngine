---
description: The layout of a character's game side, as the world state holds the person they are (the `game-side` of `cast:self`) - the reference that opens them in the world state, where they are, what they have on them, what they own that is kept elsewhere and where, and each value the state keeps of them (coin, condition, what they wear, their groups) by its key; and, for a principal out of view, where it is, what it means to do and by when, as the Author recorded them (cast_update's away). The person is the one the character is tied to (at casting, by the migration or by the player), else the one their name finds; there is no game side when the world holds no such person, or more than one by their name. When none of the views an agent is given by cast:self has anything in it, the none part says so. It lays out what the record holds; it asks for nothing.
---
{{#name}}
### {{name}} in the world{{#ref}} ({{ref}}){{/ref}}
{{/name}}
{{#none}}

The world holds no person this character is: none is tied to them, and their name finds no one, or more than one.
{{/none}}
{{#where}}

Where: {{where}}
{{/where}}
{{#holds}}

On them:
{{#holds.items}}
- {{name}}{{#what}} ({{what}}){{/what}}
{{/holds.items}}
{{/holds}}
{{#owns}}

What they own that is kept elsewhere:
{{#owns.items}}
- {{name}}{{#what}} ({{what}}){{/what}}{{#where}}, at {{where}}{{/where}}
{{/owns.items}}
{{/owns}}
{{#values}}

As the world state has them:
{{#values.items}}
- {{key}}: {{value}}
{{/values.items}}
{{/values}}
{{#away}}

Away from the scene, as the Author recorded:
{{#whereabouts}}
- Where: {{whereabouts}}
{{/whereabouts}}
{{#intention}}
- Meaning to: {{intention}}
{{/intention}}
{{#until}}
- By: {{until}}
{{/until}}
{{/away}}

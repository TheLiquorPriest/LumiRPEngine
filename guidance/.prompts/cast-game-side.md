---
description: The layout of a character's game side, as the world state holds the person they are (the `game-side` of `cast:self`) - the reference that opens them in the world state, where they are, what they have on them, and each value the state keeps of them (coin, condition, what they wear, their groups) by its key. There is none when the world holds no one, or more than one, by their name. When none of the views an agent is given by cast:self has anything in it, the none part says so. It lays out what the record holds; it asks for nothing.
---
{{#name}}
### {{name}} in the world{{#ref}} ({{ref}}){{/ref}}
{{/name}}
{{#none}}

The world holds no one by their name, or more than one.
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

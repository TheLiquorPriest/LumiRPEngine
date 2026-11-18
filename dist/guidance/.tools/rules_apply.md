---
description: rules_apply as the model is told it - what the tool does, and what each of its arguments is.
doing: putting a tabletop rule set on this chat's world
arguments:
  rules: "The rule set, by its id."
  take: "A list of paths the world has its own value at, which the rule set would change: the rule set's value goes in their place. Left out, the world's own are kept."
  preview: "True to be told what it would add and keep, with nothing changed."
---
Puts a shipped tabletop rule set (its abilities, skills, classes, conditions, weapons and the numbers a check and an attack are worked out with) on this chat's world, so a world played without rules is played with them. The rule set is made the world's next revision and this chat moves to it from its next turn; the world's other chats stay on the revision they play until someone moves them. What the world has of its own where the rule set would write is never changed unless take names it, and the answer says each one it kept. It turns the tabletop rules on for this chat, then says who in the chat has no sheet yet. It does not touch a world whose draft in Build holds changes that are not kept yet, nor a chat that plays an older revision than the world's newest: the answer says which. One Undo (the Upgrade's) takes it back.

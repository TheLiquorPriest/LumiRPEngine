# Worlds in RPE

A world is the setting a chat plays in: its places, people, belongings, money, rules and calendar, kept by RPE and changed as the story goes. A chat does not need one: a chat with no world plays on a blank world (see [How behaviour lives in files](behaviour.md#prompt-parts)). With one, RPE settles what rules should settle (prices, travel times, dice odds, who is where) and the agents spend their effort on the story.

## What a world is

- A world is one document in the format `lre-world-v1`: collections keyed by id (`kinds`, `relations`, `entities`, `places`, `routes`, `maps`, `rules`, `actions`, `checks`, `schedules`, `tracks`, `tables`, `lore` and more) and single parts (`calendar`, `time`, `start`, `pov`, `currency`, `pins`).
- Each commit makes an immutable **revision**, named by the hash of its content; the newest is the world's **head**. A chat plays the revision it was started on, so committing changes no chat that is playing. RPE keeps every revision in its database.
- What is in a world, and how it changes as the story goes, is the engine's: the **packs** each add their own kinds, fields, effects and formula functions. RPE ships `calendar`, `space`, `economy`, `gear`, `vehicles`, `weather`, `relationships`, `castlife`, `sheets`, `story`, `combat`, `minds` and `orgs` beside the engine itself, with starter worlds to begin from. Every kind, field, effect, function, action and lint code is listed in the [reference](REFERENCE.md).
- The parts that compute something (an action's requirements, a check's modifier, a derived field, a rule's condition, a quest stage's way forward) are formulas in one small, safe language: [Expressions](EXPRESSIONS.md). [Recipes](RECIPES.md) are small worlds that each show one thing working end to end.

## Building a world: the Build page

**Build** is the page for it, in the drawer tab and in the web app: the worlds RPE keeps, each opened, edited (the map editor among them), checked and committed as a new revision. RPE checks a world as you edit and lists what is wrong with it before a commit. What Build cannot do in this build is on [the install page](install.md#the-pages).

Worlds you had in the previous build are carried by the migration into Build (see [Moving from the previous build](migration.md)).

## Playing in a world

- On the **Play** page, a chat with no world shows the world picker: **Attach** gives the chat a world from Build, and the chat plays its head revision from then on.
- The **World** page shows the world's state as one tree at the chat's head or at any turn, with where each value comes from. The **Cast** and **Story** pages show the people and the story record RPE keeps beside it.
- The Author reads the world state at the start of each turn, and changes it only through the engine's operations ([The engine's operations](operations.md)); each change is recorded with the turn that made it, so a swipe, an edit or a branch rewinds the world with the story.
- A tap on Play that manages something (taking a thing off, paying, moving the clock) is your own change, kept on the chat's newest turn with an **Undo**.

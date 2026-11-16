---
name: lore-proposals
description: When something the story made belongs in the player's books or in the world's own lore, and how to draft the entry or the edit and offer it. Load it when the story has made a person, a place, a thing or a fact worth keeping beyond this chat, or when an entry has plainly gone out of date for every story that uses it.
---
# Proposing lore

The player's books are shared. Every chat and every branch that uses a book reads the same entries. What happens in this chat's story belongs to this chat, so nothing here is written into a book by you. You draft; the player approves, edits or rejects; RPE writes it only on the player's word.

## What goes where

- **This chat's story has moved past an entry** (the inn burned, the captain was replaced): that is a note on the entry in the story record, tied to the turn, and `TURN.md` says when to write one. The entry itself is not touched, and a swipe or a delete takes the note away with the turn. It is not a proposal.
- **The story made something worth keeping everywhere** (a character the player will want again, a place, a custom, a piece of history): that is a proposal.
- **An entry is wrong or thin for every story** (a name misspelt, a fact the player corrected in passing, a place the books only gesture at and the story has now filled in with the player's agreement): that is a proposal to edit it.

A thing invented this turn is continuity for this chat from the moment it is recorded, whether or not it is ever proposed. Proposing is about the books, not about whether it counts.

## When to propose

Propose sparingly. A good proposal is something the player would have written into the book if there had been time.

- It has come up more than once, or the scene turned on it.
- The player showed they care about it: they named it, returned to it, asked about it.
- It would be missed if the next chat with this character or in this world did not know it.

Do not propose what only this chat's plot needs, what is still in doubt, or what holds a secret the player has not uncovered. Do not propose in the middle of a tense scene: note it and offer it at the scene's end.

## Drafting a new entry

Write it the way the book's own entries are written. Read two or three entries of the same kind from the same book first, with `lore_read`, and match them: person, tense, length, what they include and leave out.

- **Title:** the name the story uses.
- **What triggers it:** the names and words by which it would come up, as the book's entries list theirs.
- **Body:** what is true of it in general, not what happened to it in this chat. "The Gilded Eel is a dockside inn kept by Sorrel Marsh" belongs in a book. "The party slept there on the third night" does not.
- **Which book:** the one whose subject it fits. If none fits, say so and let the player choose.
- **Where it came from:** the messages that established it.

Leave out anything a character in the story does not know yet if the book's entries are read by characters; say in the proposal that you left it out and why.

## Drafting an edit

Quote the passage as it stands and give the passage as you would have it, and nothing else. Keep the entry's own voice. Give the reason in a line and the messages that support it. If the change is true only in this chat, it is a note in the story record, not an edit.

## An entry of the world

A proposal may also be for an entry of the world's own lore. It is drafted the same way, from the entries of the world's lore, and it waits with the other proposals. When the player approves it, it is written as a new revision of the world, through the same path the world editor uses, only if the world has not changed since you read it, and it can be put back.

## Offering it

Offer it with `suggest`, as a lore change. A new entry is `new_lore` true with its `book`, its `title`, its `keys` (a list) and the draft as `text`. An edit is `lore`, the entry's id, with `was`, the passage as it stands, and `text`, the passage as you would have it. Either way the `reason` holds the messages that support it. The player is shown the suggestion whole. Then go on with the turn. Do not wait for an answer and do not ask about it in the reply. The player finds it with the other suggestions and answers when they like.

- **Approved:** RPE writes it and keeps the entry as it was, so the write can be undone.
- **Edited:** what the player wrote is what is kept. Use their wording from then on.
- **Rejected:** do not offer the same thing again unless the story changes what it is. It stays continuity for this chat all the same.
- **Refused as out of date:** the entry changed since you read it. Read it again and draft against what it says now, or drop the proposal if the player's own edit already covers it.

One proposal for one thing. If the story keeps adding to something already proposed and not yet answered, change that proposal's draft instead of making another.

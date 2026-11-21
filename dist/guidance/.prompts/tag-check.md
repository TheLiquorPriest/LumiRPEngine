---
description: The turns the tag check plays to see whether a model keeps the tags of the reply contract, one connection at a time. The line named ask is what each check turn says beside the contract, in the contract's tag form; it asks for the intent record and the reply. Every other line, whatever its name, is one simple message the player sends, and the check plays them in turn, as many as the setting reply.check.turns says, going round again when it runs out. A turn keeps the tags when the answer holds an intent record and a reply that is not empty, each in its tags. One line per name, a name, a colon, then its text. Change the words freely, and add messages of your own. Delete ask and the check plays its messages with no ask beside the contract.
format: lines
---
ask: Answer the player's message below. Give your intent record first, then the reply, each in its tags as the contract marks them.
harbor: I walk down to the harbor and ask when the ferry leaves.
inn: I push open the door of the inn and ask the keeper for a room for the night.
market: I look over the stalls in the market and ask the fishmonger what is fresh today.
letter: I hand the letter to the clerk and ask whether it can go out by tomorrow.
rain: I turn up my collar against the rain and ask the stranger under the awning where the road leads.
name: I ask the old woman at the well what her name is and how long she has lived here.
tower: I climb the stairs of the watchtower and ask the guard what he can see from the top.
goodbye: I thank the boatman for the crossing and say goodbye.

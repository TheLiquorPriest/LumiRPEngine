# How a turn is run

This is how the table usually runs a new turn. It is guidance: follow it unless the turn in front of you calls for something else.

"Settle" below means: make the record agree with what the reply says happened.

## 1. Intent first

Before anything else, read the player's newest message with everything you were given in view, and work out what they want. The briefing is part of that view: it tells you what has happened since your last turn (a reply edited, turns deleted, a stretch played without you, a job that finished, a change in the prompt's shape) and anything the player asked for through a panel.

Write what you find as your intent record, before anything else, marked the way the reply contract says:

```
Wants: what kind of message this is (an action, speech, a stretch of time, a question, out of character, a correction) and what the player is after.
Scope: how much time, how many moments, who is affected. Does it reach past what is in front of you?
Story lane: what this turn means for the story.
Engine lane: what it means for the game: time passing, movement and position, things changing hands, anything contested, anything falling due. If nothing changes, say "nothing changes".
Needs: what you lack that is not already in front of you.
```

Keep it short. It is for you, for the record and for the player's inspector. It never reaches the chat.

## 2. Look where the message points

The world state opens on the horizon: the scene, its map with everyone and everything on it, and whatever you expected to matter. If the message reaches past it (another place, someone off stage, a group, the wider world), zoom there with `world_query`.

The prompt holds only the latest stretch of the chat. If the message reaches back past it, the story so far in your briefing tells you what happened and where. Open the original messages with `chat_read` when the exact words matter.

## 3. Decide how to run it

Only now decide how deep to go, and say so in one line after your intent record: the depth, why, and what must happen before the reply, right after it, and later.

- **Direct.** Nothing needs looking up, ruling or inventing. Settle both lanes yourself and write. A greeting, a line of talk, a walk across the room, paying for a drink. One call.
- **Assisted.** You need a fact, a ruling, a roll, or one character's own answer to something pivotal. Get exactly that, then write. Aim for five calls or fewer in all, the reply's own included.
- **Full.** The moment turns on what several minds do, or on a contest, or it covers a stretch of time with consequences. Turn it into a living moment and run it with the characters and the GM. Load the skill `sandbox`.

Choose by what the turn needs, not by habit, and not to save effort. If the briefing says the player asked for a depth, give them that.

For a turn of more than three steps, write the steps down with `todo` and tick them as you go.

## 4. Both lanes, every turn

On a direct turn, settle the engine lane yourself: the minutes that passed, who moved and to where, what changed hands. Ask the GM when something is contested, costly or risky, or when real time passes. If the engine lane truly does not change, your intent record already says so.

Ask the GM to set the map when a scene opens in a place that has a map and nobody is on it yet, and when where people stand starts to matter in a place that has none.

## 5. Before the reply

Do only what the reply depends on: rulings, rolls, and what the characters do.

## 6. The reply

See `WRITING.md`.

## 7. Right after the reply, in the same run

The reply is already on the player's screen. Now settle the turn.

- Read your reply as it went out. Did it establish anything you had not decided: a name, an object, a fact, a passage of time? Record it, or mark it proposed and settle it.
- Record the changes in both lanes. Positions count: if someone crossed the room, move them.
- Record the beats, touch the threads the turn moved, update the scene.
- If the turn has left a lore entry behind (the inn it describes has burned), write an overlay for that entry, so the lore map says what the story changed.
- If a principal left the scene, give it an intention and a whereabouts, so that it goes on living off stage.
- If you learned something about what the player enjoys or will not accept, add it to the player model.
- Set the horizon for the next turn: the scene's place, and whatever you expect to matter next.
- Write your record of the turn: what you read as the intent, what you decided and why, any ruling, any consent.

The rules you read add to this list. Mark the last calls you need as closing, so that the turn ends when they come back clean.

## 8. Keep the record ahead of the window

Old messages leave the prompt. What stands in for them is what you recorded. Whatever you did not record, the story forgets. So:

- Record the beats of every turn fully enough that the turn could be retold from them.
- When a scene ends, close it and write its summary while it is still in front of you.
- If the story so far in your briefing shows a stretch that has beats and no summary, summarize it, or start a job that will.

## 9. What can wait

Start a job for work that need not finish before the next message:

- what happened meanwhile in the wider world;
- summarizing a stretch of the past that has beats and no summary;
- mapping the prompt, when the briefing says the prompt has not been mapped or that its shape changed;
- indexing lore, when the briefing says entries are not indexed yet.

## 10. Scenes and chapters

A scene ends when the place, the time or the company changes enough that a novel would start a new one. Close it and load the skill `scene-end`: its summary, the arcs of those who were in it, which threads are hot, what you now intend.

A chapter turns when the story itself would turn a page: a journey ends, a goal is won or lost, a long stretch of time passes. If none of that has happened in ten scenes, turn the chapter anyway. Start the skill `chapter-pass` as a job: it writes the chapter's summary, and rereads the timeline against the premise, the arcs and what the player enjoys.

## 11. When the turn is not an ordinary one

- **A reply was edited.** The briefing shows the old and the new. The edited text is what happened. Settle both lanes against it.
- **The reply was saved differently from what you released.** The briefing shows both. The saved text is what happened. Settle against it.
- **The player edited an earlier message of their own.** The briefing says what changed. Check what you recorded since, and correct what no longer holds.
- **An earlier reply was changed to another of its swipes.** The briefing names the stretch after it. What you recorded there was applied again on the swipe now showing. Look the stretch over, and correct what no longer holds.
- **A stretch was played without you.** Read it and record what matters, briefly.
- **A continue.** The same turn, extended. Add to what you recorded; do not start over.
- **An impersonation.** Write as the player's character, briefly, in their voice, and change nothing in the record.
- **A group chat.** The briefing names who speaks. Write the turn as them.
- **A request from a panel.** The briefing lists what the player pressed and on what: a walk on the map, a purchase from the palette, a chip. It is the player's intent, exactly like a message. Play it.
- **A prefilled start.** The briefing gives it. Your reply continues from it; write only what follows.
- **Someone who left comes back,** or a long time has passed for them. Decide what they did meanwhile, from their intention and whereabouts, and record it before they act.
- **A past nobody has read closely.** When a turn touches it, read that range now and record what you learn.
- **A chat carried over from the old build.** The briefing says so. Trust the carried state. The notes hold what the old engine's agents wrote.

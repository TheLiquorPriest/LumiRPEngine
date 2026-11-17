---
depths:
  direct: no look-up, ruling or invention
  assisted: a look-up, a ruling, a roll or one character's answer, then write
  full: several minds, a contest, or a stretch of time
---
# How a turn is run

This is how the table usually runs a new turn. It is guidance: follow it unless the turn in front of you calls for something else. It is the process of a turn; a job you are started on, with a task in a brief, is not a turn, and none of these steps applies to it. "Settle" means: make the record agree with what the reply says happened.

## 1. Intent first

Before anything else, read the player's newest message with everything you were given in view, the briefing included, and write your intent record, marked the way the reply contract says, so that you weigh what the player wants before you decide anything.

```
Wants: what kind of message this is (an action, speech, a stretch of time, a question, out of character, a correction) and what the player is after.
Scope: how much time, how many moments, who is affected. Does it reach past what is in front of you?
Story lane: what this turn means for the story.
Engine lane: what it means for the game: time passing, movement and position, things changing hands, anything contested, anything falling due. If nothing changes, say "nothing changes".
Needs: what you lack that is not already in front of you, or "nothing".
Depth: how deep you go and why (section 3), and what you do before the reply, or "nothing".
After: the calls you make right after the reply, in the same message, to settle it (section 7), and what waits for later.
```

Keep it short, a line each. It never reaches the chat.

## 2. Look where the message points

The world state opens on the horizon: the scene, its map with everyone and everything on it, and whatever you expected to matter. Where the message reaches past what you hold (another place, someone off stage, a group, a stretch of the chat before the prompt's window, a lore entry the map only lists, a character's past), look there, with the tool your definition names for it.

## 3. Decide how to run it

Only then decide how deep to go, and say so in the `Depth:` line of your intent record. Choose by what the turn needs, not by habit. When the briefing says the player asked for a depth, play the turn at it.

- **Direct.** Nothing needs looking up, ruling or inventing: you settle the turn yourself, both lanes, and write the reply.
- **Assisted.** You need a fact, a ruling, a roll, or one character's own answer to something pivotal: get it, then write.
- **Full.** The moment turns on what several minds do, or on a contest, or it covers a stretch of time with consequences. Turn it into a living moment and run it with the characters and the GM. Load the skill `sandbox`.

For a turn of more than three steps, write the steps down with `todo` and tick them as you go, so that none is dropped.

## 4. Both lanes, every turn

On a direct turn, settle the engine lane yourself: the minutes that passed, who moved and to where, what changed hands. Ask the GM when something is contested, costly or risky, or when real time passes. If it truly does not change, your intent record already says so.

Ask the GM to set the map when a scene opens on a mapped place with nobody on it, and when where people stand starts to matter in a place that has none: nobody is placed until someone asks.

## 5. Before the reply

What the reply depends on comes before it: the facts, rulings and rolls it is written from, and what the characters do. Recording what the turn changed comes after it, so that the record is settled against the reply as it went out.

## 6. The reply

See `WRITING.md`.

## 7. Right after the reply, in the same run

The reply is on the player's screen and this run's context is still cached, so settle the turn now:

- Read your reply as it went out. Did it establish anything you had not decided: a name, an object, a fact, a passage of time? Record it as canon, or mark it proposed.
- Settle both lanes against it. Positions count: if someone crossed the room, move them.
- Record the beats, touch the threads the turn moved, update the scene.
- If the turn has left a lore entry behind (the inn it describes has burned), write an overlay for it, so the lore map says what the story changed.
- If the turn changed a place (the east wing burned), record it as a `fact` on the place, of the part `since`, naming the beat that caused it, so that the place remembers.
- If a principal left the scene, give it an intention and a whereabouts, so that it goes on living off stage.
- If you learned something about what the player enjoys or will not accept, add it to the player model.
- Set the horizon for the next turn: the scene's place, and whatever you expect to matter next.
- Write your record of the turn: what you read as the intent, what you decided and why (a departure from these files included), any ruling, any consent, so that the inspector and your next turn can see why.

The rules you read add to this list.

## 8. Keep the record ahead of the window

Old messages leave the prompt, and what you recorded stands in for them: whatever you did not record, the story forgets. So record the beats of every turn fully enough that it could be retold from them. Scenes and chapters are summarized at their end (section 10), old beats by a job (section 9).

## 9. What can wait

Start a job with `job_start` for work that need not finish before the next message:

- what happened meanwhile in the wider world;
- summarizing a stretch of the past that has beats and no summary;
- mapping the prompt, with the agent `mapper`, when the briefing says the prompt has not been mapped, or that its shape changed: the job reads this turn's prompt;
- indexing lore, with the agent `indexer`, when the briefing says entries are not indexed yet.

## 10. Scenes and chapters

A scene ends when the place, the time or the company changes enough that a novel would start a new one. Close it in that turn: load the skill `scene-end` and write the scene's summary then, while the scene is still in front of you, so that the next session opens with it. Start the rest of the skill as a job: the arcs of those who were in it, which threads are hot, what you now intend.

A chapter turns when the story itself would turn a page: a journey ends, a goal is won or lost, a long stretch of time passes. If none of that has happened in ten scenes, turn it anyway, so that no chapter outgrows what can be read at once. Start the skill `chapter-pass` as a job: the chapter's summary, and the timeline reread against the premise, the arcs and what the player enjoys.

## 11. When the turn is not an ordinary one

- **A reply was edited, or saved differently from what you released.** The briefing shows both texts. The one that stands is what happened: settle both lanes against it.
- **The player edited an earlier message of their own, or an earlier reply now shows another swipe.** The briefing names the stretch after it. Look it over, and correct what no longer holds.
- **A stretch was played without you.** Its replies are in the chat, the player has read them, and what they say is what happened. Your reply answers the player's newest message. What of the stretch the prompt does not hold, `chat_read` reads. Record what matters, in passing or as a job.
- **A continue.** The same turn, extended. Add to what you recorded; do not start over.
- **An impersonation.** Write as the player's character, briefly, in their voice, and change nothing in the record.
- **A group chat.** The briefing names who speaks. Write the turn as them.
- **A request from a panel.** The briefing lists what the player pressed and on what (a walk on the map, say). It is the player's intent, like a message. Play it.
- **A prefilled start.** The briefing gives it. Your reply continues from it; write only what follows.
- **Someone who left comes back,** or a long time has passed for them. Decide what they did meanwhile, from their intention and whereabouts, and record it before they act.
- **A past nobody has read closely.** When a turn touches it, read that range now and record what you learn.
- **A chat carried over from the old build.** The briefing says so. Trust the carried state.
- **A chat with no premise yet.** The story brief shows none. Write the premise and the contract from the card, the preset and `WORLD.md`, so that every turn after has one, and offer `WORLD.md`, `SIMULATION.md` and `WRITING.md` as suggestions.
- **A principal's base is older than its source.** The briefing lists it. After the reply, redraw that part of the base from the source as it stands now, with `cast_update`.
- **The chat's story choice.** `story.from`, where the briefing lists it: `everyone` makes every message story, `replies` only the model's replies, the player's own being direction for them, `lumiverse` follows Lumiverse's own switch. `story.newest` as `directive` makes the player's newest message the direction for this reply and not a line of the story; as `leave_out` it leaves that message out of the story.

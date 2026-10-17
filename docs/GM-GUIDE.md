# LumiRPEngine GM guide

This guide is for whoever runs the game: you, playing your own world as its GM, or a friend running one for you. The player's side of LumiRPEngine shows only what the point-of-view character knows or can see. The GM side sees everything, secrets included, and can change anything in a running chat. Here is how to use it without breaking the story: what the player sees and why, the GM view and its edits, fixes and Undo, the rules for checks, realism and time in one chat, moving a chat to a new revision of its world, and reading the Context inspector.

Every button is described in the [user guide](USER-GUIDE.md); this guide is about using them well. Authors who build the secrets in the first place will want [RECIPES.md](RECIPES.md) and the [reference](REFERENCE.md).

## Who sees what

Everything in a world has a visibility, and every rule about it fails closed: when in doubt, the player doesn't see it.

| Visibility | Who sees it |
|---|---|
| `public` (the default) | Everyone |
| `known_by` | Whoever knows it: a `knows` link to it, or a match for its **Known by** selector (the members of a group, people of a kind or a tier, a tag, a classification) |
| `secret` | The GM only |
| `discoverable` (places only) | Hidden until the POV has been there, has a `knows` link to it, or matches its **Known by**; found for good after that |

People, places, tracks and single fields of a kind each take one. A value the engine doesn't understand hides the thing, and a **Known by** that names nothing the engine reads grants nobody; lint flags both.

**The player layer.** Scene, Cast, the palette, the map, the travel list, chips and the Journal show only what the POV knows or can see. Cast lists the people you have met and the people where you stand; someone who isn't here shows only where and when you last saw them, never where they are now or what they plan. The map draws the places you know; in **Known** display a place you have only heard of is a dashed ring, and in **Fog** what you haven't seen lies under fog. Another person's money stays out of sight unless you hold the account.

**The narrator** is told the same facts the player may see, plus cues. A secret's truth reaches the prompt only once the secret is revealed, and the engine drops anything the model proposes that would carry an unrevealed truth. When the model suggests that you learned something, it may only be a public fact, or a place you could hear of; secrets move only by their own conditions.

**Secrets in a world** live in two places: a track's stages, each with an optional `truth` that stays GM-only until the stage is revealed, and secret lore entries, which have a **gate** (a condition that opens them) and an **audience** (the helper steps that may read them before then; none by default). Lint refuses a public lore entry that repeats a track's truth, and warns when a helper that writes prose, such as the brief or the outline, is in a secret's audience, because what it writes can reach the narrator.

**Before a session,** run **Check world** in Build: its transcript is the author's view of each day, secrets included, and its notes flag any secret that leaked into a section.

## The GM view

Open **Play → GM view** and tap **Show the GM view** past its spoiler gate. Its data is fetched only while it is open and never travels with what Play shows, so a player glancing at the screen with it closed sees nothing. Looking never changes the chat.

- **Entities:** every person, thing, vehicle, group and account, including the ones spawned in this chat and the ones removed, with badges for **You**, **Removed**, **Spawned**, **Agent** and anything that isn't public. Each opens a form: its fields as its kind defines them, its designed sheet, where it is, its relations, and its simulation detail (tier, whether it lives off-screen, and each domain's level).
- **Places:** every place with its visibility.
- **Tracks:** every quest, secret, puzzle and agenda, with all its stages and every truth.
- **Money:** each person's money at their own Money level: their band, accounts, bills and latest transactions.
- **Edits:** the corrections in force on this version of the story, and every change that didn't apply after a reply, with the exact reason.

## GM edits

Anything the GM view shows, you can change: a field (set it, or add to a number), a relation and its fields, where something is (at a place, inside a container, or out of it), money on an account (**Add** and **Take**), a track's stage, someone's tier, whether they live off-screen and their levels, and you can **Spawn** a new entity or **Remove from the world** an existing one.

- **Checked, all or nothing.** Every save is checked as the change it makes: a number outside its range, a choice that isn't one of its values, a relation that breaks its kinds or how many it allows, is refused with the reason, and nothing in that save applies. Values are taken as typed, never as formulas.
- **Locked fields** (🔒, the ones the AI never sees or writes) are writable here and nowhere else.
- **Money stays balanced.** Adding or taking money posts against an outside **Correction** account, so the books still balance and the Money panel shows it as a correction.
- **Remove, don't delete.** **Remove from the world** takes someone out of every scene, list, process and prompt, with whatever they hold, and drops their relations; **Restore** brings them back where they were. Undoing the removal brings the relations back too. Your own character can't be removed.
- **The world's definitions stay in Build.** Kinds, classifications, tags and the world's places are edited in Build and reach the chat through an Upgrade (below).

Each save is one correction: a **Corrected** chip on the latest reply, with **Undo**, worded as the Journal words it. A save made while a reply is streaming waits for the reply and lands right after it.

## Fixes and Undo

A **✎ fix** is the player's quick correction of a value, from the status pill: the place, the weather (from Weather 2), the cash and the scene type. It is checked like a GM edit, refused rather than clamped, and saved the same way, with a **Corrected** chip and **Undo**.

- **Undo covers the latest reply.** Each fix and GM edit on it has its own Undo, and so do automatic changes the engine read from the reply. For anything earlier, change it again with a new edit, or use Keep or Discard after editing an earlier message.
- **Swipes carry corrections.** Re-narrate checks every fix and GM edit on the turn against the same outcome, and Re-run against the new roll. One that no longer fits (the new roll spent the money it corrected, or removed what it changed) is dropped with a **Not carried** note in the Journal; one you undid stays undone.
- **A correction that came too late.** A fix or edit made while a reply streamed waits for the reply; if the reply changed things so it no longer fits, a **didn't apply after the reply** chip says so until dismissed, and the **Edits** tab keeps the exact reason.
- **Switching swipes and branches.** A correction belongs to the version of the story it was made on. Swipe away and it stops counting; swipe back and it counts again.

## Checks in this chat

How a check is decided (when the dice roll, what the player's described approach is worth, who settles it, and when a failed try may be tried again) is a policy. The world sets one in **Build → World → Ruleset → How checks are decided**, a player sets their own for new chats, and a running chat can change its own in **Settings → Checks → This chat**: pick **Narrative-first**, **Balanced**, **Crunchy** or **Custom**, and tap **Apply to this chat**.

- The change applies from the next turn and is recorded like a realism change, so it follows swipes and branches, and earlier turns keep the rules they were played under.
- **Narrative-first** rolls only risky checks and lets the story settle them, with the exact odds as guidance; **Balanced** rolls every check except sure things and hopeless ones, counts the player's approach as a small bonus and flags close calls; **Crunchy** rolls everything and lets the dice settle it. **Custom** sets each value.
- **Marked checks.** With **When checks roll: only where marked**, a check rolls only for an action marked **Its check always rolls**, at a place marked **Checks roll here** (and the places inside it), or while a quest marked **Checks roll while it's in progress** is under way. Mark the dangerous moments in Build and let the rest of the story flow.
- **What the table sees.** The palette shows the verdict before anyone commits (**No roll needed**, **Too hard to try**, **Retry needs a change**, **The story decides (odds 35%)**), and the **Roll** chip says what was rolled, or "No roll:" and why, with how the approach was rated and any close call. NPC checks rolled by the world's own rules always roll.

The full table of presets is in the user guide's [How checks are decided](USER-GUIDE.md#how-checks-are-decided).

## Realism and time

Both are per chat once the chat has started, and both are recorded with the story.

- **Realism:** **Settings → Realism → This chat** changes the running chat for **Everyone**, or for one band: Leads, Supporting or Background. Before you apply, the migration preview names what stops, what freezes and what will be filled in when it is first shown, and any rule of the world that depends on something that would stop updating. A world's ruleset can set floors (stat modifiers need Sheets 3; the grid system keeps Space at 3), and the sliders never go below them. For a single person, set their levels in the GM view's **Simulation** section.
- **Time:** **Play → Calendar** changes this chat's ticks per scene type, time scale, Timelapse interrupts, Speed through and Montage. **Pause clock** stops time for the current scene, for a conversation that shouldn't cost the afternoon.
- Changes apply from the next turn; earlier turns keep the levels and times they were played at.

## Upgrading a chat

A chat stays on the world revision it started on. When the world has a newer revision (your commit in Build, an import, newer tables from an extension update), **Settings → Pins and upgrade** offers **Upgrade to the latest revision**, and shows what it brings into this chat, entity by entity, before anything changes.

- **New** people and things are listed, and so are ones the revision no longer has: they stay in the chat unless you pick **Remove**.
- **Each change** to the rest (a field, a name, a tier, classes, a relation, an account's opening balance) shows the chat's value, the revision's value and a pick. **Unchanged in play** (nothing in the chat touched it) starts on **Take**. **Changed in play** (a turn, a fix or a GM edit touched it, even if it later changed back) starts on **Keep**, so an Upgrade never overwrites what happened in the story unless you say so.
- **Take all unchanged** resets the untouched ones to Take, and **Review changed in play** lists only the touched ones. **Upgrade with these picks** applies it.
- A quest sitting at a stage the revision removed goes back to its first stage, with a Journal note.

The Upgrade takes effect from the next turn and is recorded like any other change, carrying only your picks, so swipes, branches and Re-narrate treat it alike. Detail the chat has already shown stays as it was; new tables apply to what hasn't been shown yet.

## Reading the inspector

**Play → Context** shows what the engine put into the prompt for each generation. Step through earlier ones with **Older** and **Newer**; the last ten are kept per chat, and survive a restart.

- **Sections** (Outcome, Scene, People and the rest) each show their size in your main model's tokens and a badge. **Delivered** means the test prompt build found the section in the prompt. **Not delivered** means it didn't: check where the world's book and your preset place it. **Unchecked** is normal for Outcome, Montage and Outline, which only a real turn fills. **Unverified** means the engine couldn't work out where a section lands (inside a character card, say), so it keeps its normal place. **Clipped** means it went over the section budget and was left out of that turn.
- **The budget bar** is the section budget spent. Sections are kept in rank order and Outcome is never left out, so a clipped section is a hint to raise **Settings → Model use → Engine budget (tokens)**, or to give the section a lower rank in the world's sections.
- **Activation** reads **Activation confirmed** when the engine's sections went into the prompt as planned; **Worker stalled: engine sections absent** means the turn ran without them, and the turn is flagged.
- **Warnings** say when the fixed part of the prompt is too large for the context (Lumiverse then drops the chat history), when the prompt had to be clipped, and when a damaged journal was set aside, with where the old file is.

Your own World Books work as they do anywhere in Lumiverse, so the inspector doesn't list them.

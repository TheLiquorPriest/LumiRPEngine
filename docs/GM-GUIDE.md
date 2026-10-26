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

**The narrator** is told the same facts the player may see, plus cues. A secret's truth reaches the prompt only once the secret is revealed, and the engine drops anything the model proposes that would carry an unrevealed truth. When the model suggests that you learned something, it may only be a public fact, or a place you could hear of; secrets move only by their own conditions. The **Stance** section tells it how the people with the POV behave: whether they know you and their regard in words, what they are about, and the cues the author wrote for their secrets, while those stay hidden. A cue that would carry an unrevealed secret, or name someone or something the POV doesn't know, is left out, and nobody the POV can't see gets a line.

**Secrets in a world** live in two places: a track's stages, each with an optional `truth` that stays GM-only until the stage is revealed, and secret lore entries, which have a **gate** (a condition that opens them), an **audience** (the helper steps that may read them before then; none by default) and their **holders** (the people whose own secret it is: only their minds read it). Lint refuses a public lore entry that repeats a track's truth, and warns when a helper that writes prose, such as the brief or the outline, is in a secret's audience, because what it writes can reach the narrator. How a secret shows before then is the **cue**: a track stage's cue, or a person's own **Cues** in Build, each standing for one secret (a lore entry, a track or a story flag). Write behaviour, never the secret ("evasive about the cellar"); lint refuses a cue that holds its secret's words and warns about one that names what the player may not know.

**Before a session,** run **Check world** in Build: its transcript is the author's view of each day, secrets included, and its notes flag any secret that leaked into a section.

## The GM view

Open **Play → GM view** and tap **Show the GM view** past its spoiler gate. Its data is fetched only while it is open and never travels with what Play shows, so a player glancing at the screen with it closed sees nothing. Looking never changes the chat.

- **Entities:** every person, thing, vehicle, group and account, including the ones spawned in this chat and the ones removed, with badges for **You**, **Removed**, **Spawned**, **Agent** and anything that isn't public. Each opens a form: its fields as its kind defines them, its designed sheet, where it is, its relations, its simulation detail (tier, whether it lives off-screen, and each domain's level), and its classification and tags.
- **Places:** every place with its visibility.
- **Tracks:** every quest, secret, puzzle and agenda, with all its stages and every truth.
- **Money:** each person's money at their own Money level: their band, accounts, bills and latest transactions.
- **Edits:** the corrections in force on this version of the story, each on the latest reply with its **Undo**, and every change that didn't apply after a reply, with the exact reason.

## GM edits

Anything the GM view shows, you can change: a field (set it, or add to a number), a relation and its fields, where something is (at a place, inside a container, or out of it), money on an account (**Add** and **Take**), a track's stage, someone's tier, whether they live off-screen and their levels, their classifications and tags, and you can **Spawn** a new entity or **Remove from the world** an existing one.

- **Checked, all or nothing.** Every save is checked as the change it makes: a value outside its range, a choice that isn't one of its values, a relation that breaks its kinds or how many it allows, is refused with the reason, and nothing in that save applies. **Add** to a number is the one exception: it keeps the result inside the field's range instead of refusing. Values are taken as typed, never as formulas.
- **Locked fields** (🔒, the ones the AI never sees or writes) are writable here and nowhere else.
- **Money stays balanced.** Adding or taking money posts against an outside **Correction** account, so the books still balance and the Money panel shows it as a correction.
- **A track's stage plays as the story would.** Moving a track on, to a stage that follows from where it stands, is that stage's real entry: the stage it leaves grants its rewards (not when the new stage is how it fails), and the new stage applies its effects, grants its own rewards when it is an end and records its reveal. Stages it skips play no part. Moving a track back, to a stage it has passed or can't reach, only sets the stage, so nothing is granted, spawned or revealed twice. Either way it is one edit with its **Undo**, and the new stage's own ways on wait for the next turn.
- **Remove, don't delete.** **Remove from the world** takes someone out of every scene, list, process and prompt, with whatever they hold, and drops their relations: no rule, schedule or zone picks them out, they don't count in a group's regard, and a removed group's schedules stop moving its members. **Restore** brings them back where they were. Undoing the removal brings the relations back too. Your own character can't be removed.
- **Claimed things.** A thing the player said they had that the engine made real is marked **Claimed** in **World**, and while there are any, **Claimed by the player** lists them at the top with who holds each or where it lies. Open one and **Remove from the world** to take back a claim you don't want in the story.
- **Life and death.** An entity's **Life** card shows its life state, who knows it, and sets it: pick a state and save, and anyone with them learns it then; **Tell someone…** adds people who learn it too (you included). Nobody else hears until they walk in on it or are told, so the player sees only what their character knows. A dead or dying person stays where they lie, unlike **Remove from the world**.
- **Classify for this chat.** An entity's **Classification** card sets its value of each of the world's classifications, hidden ones included, and its tags, for a person spawned in play as much as for one the world defines. A classification or value the world doesn't have is refused. What you set holds in this chat over the world's definition, so rules, schedules and **Known by** selectors match it from then on, and an Upgrade keeps it by default (below). A classification players can't see stays out of their Journal, and tags never reach Play.
- **The world's definitions stay in Build.** Kinds and the world's places are edited in Build and reach the chat through an Upgrade (below).

Each save is one edit: a notice in the GM view says what it did, in a sentence that names who, what the setting means and the value in words ("Marcus Delgado now sleeps at Alder Automotive (Lakeshore County › Port Alder)", "3 minds are now pinned at Near fidelity"), with **Undo**, and a **GM edit** chip on the latest reply has the same **Undo**. The chip says only what the player's character could know: the change when they see it, else whom it was about if they know them ("About Sam Reyes"), never where someone went or what was set, and otherwise that it happened behind the scenes. A save made while a reply is streaming waits for the reply and lands right after it.

## Fixes and Undo

A **✎ fix** is the player's quick correction of a value, from the status pill: the place, the weather (from Weather 2), the cash and the scene type. It is checked like a GM edit, refused rather than clamped, and saved the same way, with a **Corrected** chip and **Undo**.

- **Undo covers the latest reply.** Each fix and GM edit on it has its own Undo, and so do automatic changes the engine read from the reply. For anything earlier, change it again with a new edit, or use Keep or Discard after editing an earlier message.
- **Swipes carry corrections.** Re-narrate checks every fix and GM edit on the turn against the same outcome, and Re-run against the new roll. One that no longer fits (the new roll spent the money it corrected, or removed what it changed) is dropped with a **Not carried** note in the Journal; one you undid stays undone. A swipe that finishes while the chat is paused (an earlier message edited and not yet kept or discarded) carries none of them, and each gets that note.
- **A correction that came too late.** A fix or edit made while a reply streamed waits for the reply; if the reply changed things so it no longer fits, a **didn't apply after the reply** chip says so until dismissed, and the **Edits** tab keeps the exact reason.
- **Switching swipes and branches.** A correction belongs to the version of the story it was made on. Swipe away and it stops counting; swipe back and it counts again.

## Checks in this chat

How a check is decided (when the dice roll, what the player's described approach is worth, who settles it, and when a failed try may be tried again) is a policy. The world sets one in **Build → World → Ruleset → How checks are decided**, a player sets their own for new chats, and a running chat can change its own in **Settings → Checks → This chat**: pick **Narrative-first**, **Balanced**, **Crunchy** or **Custom**, and tap **Apply to this chat**.

- The change applies from the next turn and is recorded like a realism change, so it follows swipes and branches, and earlier turns keep the rules they were played under.
- **Narrative-first** rolls only risky checks and lets the story settle them, with the exact odds as guidance (when no judgement of the player's approach is available, the dice settle them instead); **Balanced** rolls every check except sure things and hopeless ones, counts the player's approach as a small bonus and flags close calls; **Crunchy** rolls everything and lets the dice settle it. **Custom** sets each value.
- **Marked checks.** With **When checks roll: only where marked**, a check rolls only for an action marked **Its check always rolls**, at a place marked **Checks roll here** (and the places inside it), or while a quest marked **Checks roll while it's in progress** is under way. Mark the dangerous moments in Build and let the rest of the story flow.
- **What the table sees.** The palette shows the verdict before anyone commits (**No roll needed**, **Too hard to try**, **Retry needs a change**, **The story decides (odds 35%)**), and the **Roll** chip says what was rolled, or "No roll:" and why, with how the approach was rated and any close call. Other people's checks always roll, under narrative authority too.
- **Inferred checks.** Below the rules, the same page sets how a typed attempt no action covers is read as a check of the world's sheet: off, offered on a chip or rolled automatically, for which attempts, who rolls, with which skills and difficulty bands, how much the narrator is told and whether others' numbers show. Change it, tap **Review the change**, then **Apply to this chat**; it applies from the next turn like the rest. The world's default is beside the rules in Build, and each value is in the user guide's [Inferred checks](USER-GUIDE.md#inferred-checks).

The full table of presets is in the user guide's [How checks are decided](USER-GUIDE.md#how-checks-are-decided).

## Realism and time

Both are per chat once the chat has started, and both are recorded with the story.

- **Realism:** **Settings → Realism → This chat** changes the running chat for **Everyone**, or for one band: Leads, Supporting or Background. Before you apply, the migration preview names what stops, what freezes and what will be filled in when it is first shown, and any rule of the world that depends on something that would stop updating. A world's ruleset can set floors (stat modifiers need Sheets 3; the grid system keeps Space at 3), and the sliders never go below them. For a single person, set their levels in the GM view's **Simulation** section.
- **Player claims:** below the sliders, **Player claims** sets what this chat makes of a thing the player says they have that the world doesn't: **Make it real**, **Ask first** or **Hold me to the world**, and whether Make it real asks first above the world's claim cap. It applies at once, from the next turn. See the [user guide](USER-GUIDE.md#player-claims).
- **Time:** **Play → Calendar** changes this chat's ticks per scene type, time scale, Timelapse interrupts, Speed through and Montage. **Pause clock** stops time for the current scene, for a conversation that shouldn't cost the afternoon.
- Changes apply from the next turn; earlier turns keep the levels and times they were played at.

## Upgrading a chat

A chat stays on the world revision it started on. When you commit a newer revision of the world in Build, **Settings → Pins and upgrade** offers **Upgrade to the latest revision**, and shows what it brings into this chat, entity by entity, before anything changes. (Importing a world makes a new world, so it never upgrades an existing chat.) The world's other definitions, such as places, rules and actions, come with the revision without a pick.

- **New** people and things are listed, and so are ones the revision no longer has: they stay in the chat unless you pick **Remove**.
- **Each change** to the rest (a field, a name, a tier, classes, a relation, an account's opening balance) shows the chat's value, the revision's value and a pick. **Unchanged in play** (nothing in the chat touched it) starts on **Take**. **Changed in play** (a turn, a fix or a GM edit touched it, even if it later changed back) starts on **Keep**, so an Upgrade never overwrites what happened in the story unless you say so.
- **Take all unchanged** resets the untouched ones to Take, and **Review changed in play** lists only the touched ones. **Upgrade with these picks** applies it.
- A quest sitting at a stage the revision removed goes back to its first stage, with a Journal note.

The Upgrade takes effect from the next turn and is recorded like any other change, carrying only your picks, so swipes, branches and Re-narrate treat it alike. Detail the chat has already shown stays as it was; new tables apply to what hasn't been shown yet.

## Reading the inspector

**Play → Context** shows what the engine put into the prompt for each generation. Step through earlier ones with **Older** and **Newer**; the last ten are kept per chat, and survive a restart.

- **Sections** (Outcome, Scene, People and the rest) each show their size in your main model's tokens and a badge. **Delivered** means the test prompt build found the section in the prompt. **Not delivered** means it didn't: check where the world's book and your preset place it. **Unchecked** is normal for Outcome, Montage and Outline, which only a real turn fills. **Clipped** means it went over the section budget and was left out of that turn.
- **The budget bar** is the section budget spent. Sections are kept in rank order and Outcome is never left out, so a clipped section is a hint to raise **Settings → Model use → Engine budget (tokens)**, or to give the section a lower rank in the world's sections. Stance comes last by default, so it is the first to go on a small budget. Its size counts its people lines only: its cues ride in whatever budget is left and aren't counted, since they change with secrets the player hasn't found.
- **Activation** reads **Activation confirmed** once Lumiverse reports every section the engine switched on as activated, and **Not confirmed** until then or when one wasn't.
- **Warnings** say when the world's book wasn't attached to the chat or some of its section entries were missing (both are put right for the next turn), when your preset has a setting that causes trouble, and when a damaged journal was set aside, with where the old file is.

Your own World Books work as they do anywhere in Lumiverse, so the inspector doesn't list them.

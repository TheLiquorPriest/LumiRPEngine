# RPE user guide

This guide is for two kinds of people: players, who want to chat in a world that remembers, and authors, who build those worlds. It follows the order you meet RPE in: a chat first, then its pages, then building worlds and running RPE. If you only want to play, read the first part and dip into the rest when you need it. To install RPE, start with the [README](../README.md) and [Install and run RPE](install.md).

- [How RPE works](#how-rpe-works)
- **Playing:** [Playing in a chat](#playing-in-a-chat) · [The Play page](#the-play-page) · [Time, needs and routines](#time-needs-and-routines) · [Realism](#realism) · [How checks are decided](#how-checks-are-decided) · [Swipes, edits, deletes and branches](#swipes-edits-deletes-and-branches)
- **The story and what feeds it:** [The world's record, and who may see what](#the-worlds-record-and-who-may-see-what) · [Lore](#lore) · [The prompt and its map](#the-prompt-and-its-map)
- **The agents:** [Files, agents, rules and skills](#files-agents-rules-and-skills) · [Models and connections](#models-and-connections) · [Jobs and sessions](#jobs-and-sessions)
- **Building:** [Authoring](#authoring)
- **Running RPE:** [Settings, storage and the runtime](#settings-storage-and-the-runtime) · [What is not in this build](#what-is-not-in-this-build) · [When something is wrong](#when-something-is-wrong)

## How RPE works

You chat in Lumiverse as you always do. A chat whose connection is "RPE" is played by RPE's agents, and RPE keeps a record of the story and of the world beside the chat, turn by turn.

**The agents.** A turn is run by a team, each member an agent with its own instructions:

- **The Author** leads every turn. It is the story's author: it decides what happens, brings in the others when the turn needs them, and writes the reply.
- **The game master (GM)** keeps the game side: it rules, rolls, stages the consequences and keeps the map. The Author asks it when something is contested, costly or risky, or when real time passes.
- **The characters.** A principal character can be run as an agent of its own, in its own mind and voice, one run per character.
- **The narrator** writes the prose from the Author's brief, when the Author hands it over. As shipped, the Author writes the reply itself, and hands it over when this chat's notes on writing ask for a separate voice, or when the turn's working has grown large.
- **The keeper, the historian, the indexer and the mapper** do work that can wait: bookkeeping after the reply, reading a stretch of the chat's past, indexing your lore, and mapping the preset's prompt. The Author starts them as jobs.
- **The Author's assistant** takes one part of the Author's work when the Author hands it on: a search across the record, a comparison, a stretch to weigh, records to write from what the Author decided. It works by the Author's rules, with the tools that read and the tools that record, and it cannot write to you.
- **The reader** answers a question about a long text. An agent that wants one thing out of a lore entry, a stretch of the chat, a file or a record asks its reading tool with a question; a reader reads the whole and answers, and only the answer goes back.

How each agent behaves is written in plain files you can read and change, not fixed in code (see [Files, agents, rules and skills](#files-agents-rules-and-skills)).

**A turn.**

1. **You act.** You send a message, swipe, regenerate or continue a reply, or press something in the play views that plays at once.
2. **Lumiverse builds the prompt** from your preset, character, lore and history, as it does for any chat. RPE's extension leaves the history beyond your window out of it: the latest 40 messages stay (**History window**, `history.window`).
3. **The Author is briefed.** It starts from that whole prompt and a briefing: what kind of turn this is, what changed since its last turn (a reply you edited, turns you deleted, a stretch played without RPE), what you asked for beside your words, the world state, who is on stage, a map of the lore, the story so far beyond the window and the story brief.
4. **Intent first.** The Author weighs what you want before it decides anything, and writes a short intent record. Then it decides how to run the turn, and works as an agent: it looks things up with its tools, asks the GM and the characters, and changes the world only through the engine's operations, carrying out the world's own actions (a meal, a night's sleep, someone joining a crew) as the world defines them. The engine keeps the numbers: the clock, prices and balances, rolls. Nothing cuts the Author's work short unless you set a limit, and it thinks at its highest effort unless you set another. Work that can be done apart it splits with the tool `task`: several agents started at once, each with a brief and a window of its own (the characters who act in one moment, the GM's questions beside them), each answering with a receipt that names the file of its whole answer. Every agent holds `task`; as shipped the Author and the assistant may start any agent, and every other agent only instances of itself (its header's `starts:` line, which the Agents page shows). How deep agents may start agents and how many work at once are settings (`limits.turn.depth`, `limits.turn.agentsAtOnce`), and an agent that waits for its pieces gives its place back meanwhile.
5. **The reply** reaches the chat as Lumiverse's own reply, streamed.
6. **Once the reply is out**, the Author settles the turn against the reply as it went out: who moved where, what changed hands, the story's beats, threads and scene, what each character on stage perceived, and its own record of the turn. It does so as it is, from a fresh window with a note of what it decided, or by handing the bookkeeping to the keeper: which, is its own call each turn (`TURN.md`). What can wait runs as a job.

**Two lanes.** Every change RPE records is marked with its lane. The **story** lane holds beats, threads, arcs, the scene, perceptions and what characters remember and feel. The **engine** lane holds time, places and positions, what people wear, carry and own, money, stats and conditions, quests' stages, rolls and rulings. When the two disagree, the story is what happened, and the record is brought in line with it.

**The world's rules advise.** The engine applies what an agent records and reports anything that does not add up: a sum that does not balance, a thing in two places, a requirement not met. The report goes to the agent, stays listed as unsettled, and shows on the turn's page. How binding the rules are is written in `SIMULATION.md`, which you can change. RPE refuses only what it cannot use: a name that is nothing it knows, or input it cannot read.

**The record follows the chat.** Each change belongs to the turn that made it, so a swipe, an edit, a deleted message or a branch takes RPE's record with the story (see [Swipes, edits, deletes and branches](#swipes-edits-deletes-and-branches)).

**A world is optional.** A world is a setting RPE keeps in its own database: places, people, belongings, money, rules and a calendar ([Worlds in RPE](world.md)). Attach one to a chat and RPE settles what rules should settle. A chat with no world plays on a blank world, which the agents fill as the story goes.

## Playing in a chat

### Switching a chat to RPE

In Lumiverse, open a chat and choose the connection "RPE" for it, which `rpe up` made ([Install and run](install.md#rpes-connection-in-lumiverse)). Write a message: RPE plays the turn. A chat on any other connection is not RPE's, and RPE leaves it alone.

What you type is read by the Author, with the rest of the prompt. Write as you would in any chat: an action, speech, a stretch of time, a question, an out-of-character note. The Author decides what it means and what happens. Nothing reads your words for a list of commands.

A request Lumiverse makes on RPE's connection that is not a reply in a chat (a title or a summary of its own) is passed on to a model connection of RPE's: the default one, or the one named by **Connection for requests with no tag** (`turn.passConnection`).

### The composer: Depth and Swipe

RPE adds two controls to the row of tools beside Lumiverse's message box. Each offers the choices its file lists, so they change when you change the file.

- **Depth** asks how deep the Author goes on your next message. **None** ("The Author chooses") is the default. The others come from the `depths:` list in `TURN.md`. As shipped: **direct** (no look-up, ruling or invention), **assisted** (a look-up, a ruling, a roll or one character's answer, then write) and **full** (several minds, a contest, or a stretch of time). The choice waits for your next message, and the button shows it until that turn takes it.
- **Swipe** asks how the next swipe or regenerate is played. The choices come from the `modes:` list in `SWIPE.md`. As shipped: **another-telling** (the same outcomes, told differently) and **afresh** (the turn run again from the start, with new rolls). You can add a line under "What was wrong with it? (optional)". **Set for the next swipe** keeps it for your next swipe, and **Clear** takes it away. A new message does not take it: it waits for a swipe.

Feedback you type in Lumiverse's own regenerate dialog reaches the Author too. Where RPE can tell it apart, the turn's page shows it under **What you asked for**.

### Under each reply

Under each reply RPE played, a line says:

- the world's date and time when the turn ended, and where your character was, where the chat plays a world;
- **Story** and **Engine**, each with how many changes the turn made in that lane; tap one for the short list;
- the turn's **marks**, where it has any: **edited** (its reply was edited in the chat after it was saved; the Author is told the text before and after at the next turn), **interrupted** (RPE restarted while a run of the turn went on), **saved otherwise** (what Lumiverse saved is not what was released), **an earlier message edited** and **a message inserted before it**. Each is a short word: point at it or press it for what it means, with **See it on the turn's page**;
- **Turn**, which opens the turn's page (see [The Turns page](#the-turns-page)).

A reply RPE did not play says **Made without RPE.** A reply carried over from the previous build says which engine played it.

A reply whose turn's record was not finished (its run failed or was stopped after the reply had begun to go out) says why. Where it can be settled, **Settle now** has the Author finish the record of that reply now; nothing is written to your chat.

An empty reply, which Lumiverse keeps when a turn ended before a word of its reply went out, says so: "Swipe it or delete it in Lumiverse." The button beside it opens the setting **Take away an empty reply a failed or stopped turn left** (`lumiverse.reply.removeEmpty`), which is off as shipped. Switched on, RPE takes such a reply away itself, through Lumiverse's own routes, once Lumiverse says the generation ended and only while its text is still empty: the whole message, or only the swipe the turn added ([what it does](troubleshooting.md#a-turn-ends-without-a-reply)).

**Questions under a reply.** Where you set a lane's writes to wait for your word (see [Who may write what](#who-may-write-what)), each write that waits shows under its turn's reply with **Go ahead** and **No**.

**While the Author is still working** after the reply went out, a marker under the newest reply shows the run's newest progress line, or "The Author is still working.", with **Live**.

**Where the window ends.** A thin line stands under the last message the prompt leaves out, and says how many messages lie above the window and how many of those the story record does not cover yet: "40 messages above the window, 12 not covered by the story yet." Where that message is not loaded, the line shows at the top of the chat.

RPE's notices show in the chat's toolbar, so you see them with the drawer shut.

### The HUD

While the chat plays a world, RPE shows the world's status over the chat.

- **On a wider screen**, a small pill floats over the chat. Drag it where you like; it remembers its place, the phone's and the desktop's apart. It shows the time (with a pause sign while the clock is paused, and the time scale when it is not 1×), your place, the weather and your cash, each when the world has it, and ✎ where a value can be fixed. On a screen narrower than 760 px it shows the time and **Show place, weather and cash**. **Paused** shows while a turn is held on the Live page.
- **On a phone**, a status line sits above the message box instead: the time, your place and your cash, **Paused**, and **Act**, which opens the actions sheet.

**While a turn runs**, the HUD says who is at work and the newest progress line it gave, with how long the turn has run (where there is little room, only the time). A turn that failed or stopped at a limit says why, where there is room, in the words of its Turn page: which limit it reached and how far it went (or how little was left under it for an answer), what failed, or how many tries the model's provider was given and what broke the last. Press it to open the turn's page. Where a turn ended before a word of its reply went out, it says that the empty reply stays in your chat and what to do with it. This holds when you open the chat while a turn runs, or after one ended.

**While a press waits for your next message**, the HUD shows **With your next message:** and what you pressed and on what, with **Send now** and ✕ (**Take it back**); see [What a press does](#what-a-press-does).

**When a turn did not carry out a press you made for it**, and the world did not refuse it either, the HUD shows **Not carried out:** and what you pressed. **Send again** holds it for your next message once more; ✕ (**Drop it**) lets it go. It stays until you choose one.

Tap either for the **World** details: the time and the part of the day, your place, the scene type and how long the last turn took, the weather and your cash, each with its ✎ where it can be fixed; **This turn**, with its calls, seconds, tokens and lore lookups; **Pause clock** or **Resume clock**; **Map**, where the world has a map; and **Actions**.

While the chat plays a world, the composer's action bar has **World actions…** (the actions sheet), **Timelapse…** (the sheet at its Timelapse tab), **Pause clock** or **Resume clock**, and **World map**.

#### Fixing a value

✎ beside a value corrects it: the time, your place, the scene type, the weather or your cash.

- **Time** sets the date and the time of day, in the world's calendar and as the clock reads where you are. A later time moves the clock on; what the time in between brought is the Author's to decide, at the next turn. An earlier time puts the clock back.
- **Place** moves your character to a place you know: search it by any word of its name, or browse from the top level down.
- **Scene type** lists the scene types you may know of; **Place default** goes back to the type of wherever you are.
- **Weather**, where the world simulates the sky, picks one of the climate's states for where you are.
- **Cash**, from Money level 2, is typed in the world's own money.

A fix is your own change, made at once and kept on the chat's newest turn, with **Undo**. The Author is told of it at the next turn. A fix the world's rules cannot take (a value outside the field's range) is answered with why, and nothing changes.

### The actions sheet

**World actions…**, **Act**, and **Actions** in the World details open the actions sheet over the chat. It lists what your character can do here and now, by tab: **Actions**, **Buy**, **Pay**, **Transfer**, **Lend**, **Drive**, **Timelapse** and, in a world with combat, **Combat**, each where it has something. An action shows its targets, its minutes and its price, and an action with a check shows its odds. One that is not possible here and now stays listed, with why. **Go to** asks who comes along. **Timelapse** offers lengths of time, times to go until, and what may stop it.

What you pick does not play by itself. It waits for your next message, and the Author is told what you pressed and on what, and plays it as what you want, with your words for how. While it waits, the sheet shows it chosen, marked **With your next message**, and its button reads **Take back** …; pick it again to take it back. **Send now**, beside a choice, puts it in the chat as your message at once and starts the reply. See [What a press does](#what-a-press-does).

**World map** opens the map over the chat (see [The map](#the-map)).

### RPE's pages

RPE's pages are in a tab of Lumiverse's drawer called **RPE**, for the chat Lumiverse has open. Its bar holds **Live**, **Turns**, **World** and **Play**, and **More** holds the rest. The same pages are in RPE's web app, where the **Chats** page lists the chats RPE plays, the latest played first, and you pick one ([the web app](install.md#the-web-app-and-its-key)).

- For one chat: **Live**, **Turns**, **Sessions**, **World**, **Cast**, **Prompt**, **Story**, **Places**, **Quests**, **Lore** and **Play**.
- For everything: **Jobs**, **Usage**, **Agents**, **Rules**, **Build**, **Files**, **Connections**, **Settings**, **Runtime**, **Storage** and **Migration**.

At the top, a line says how the page reaches RPE: **Direct**, or **Through Lumiverse** (by way of the extension). Where the extension does not hold RPE's registration or lacks a permission, a banner says so, with **Check again**. Where RPE refuses something, the page shows it in RPE's own words.

**The spoiler gate.** What the agents planned and did can give away what comes next. So the intent record, the agents' work and much of what RPE keeps (secrets, the Author's plans, every character's mind) stay behind a notice, **Spoilers are hidden**, until you press **Show them for this chat**. **Hide them** shuts it again. The gate opens for one chat at a time, and shuts when you leave the chat or reload the page.

### Live

**Live** shows what runs in the chat as it runs: every run under way, a turn and the jobs that began beside it. Each shows what it is, how it stands and what it has spent, with **Stop**, and what went to the chat as it streams. Behind the spoiler gate: the intent record, and the agents as a tree, each with its model calls, its tool calls and their results, its `todo` list and the rules that fired.

- **Pause** holds a turn before its next model call (the call in flight finishes), and **Resume** lets it go on.
- **Say something to the Author** sends a line the Author hears at its next call.
- With nothing running, Live shows the last runs as they ended. With no chat open, it shows your jobs of no chat.

## The Play page

**Play** holds the play views of the previous build, running on RPE: the scene, your character, money, gear and vehicles, the people you know, organizations, quests and the map, each as the chat's world has them. It is for a chat that plays a world.

A chat with no world shows **Not a world chat** and the worlds Build holds, each with **Attach**; **Open Build** goes to Build. Attach gives the chat that world, and it plays the world's newest revision from then on. A chat plays one world: attaching another is refused with the world and revision it plays.

A bar of six places runs along the page: **Now**, **Me**, **People**, **Orgs**, **Places** and **Story**. A place that holds more than one part shows them as tabs. A place shows only while it has something to show: a place whose packs the world does not use is left out. What each shows follows the world's [realism](#realism) levels: a domain that is off shows nothing, and one at a low level shows less. A dot on a place or a tab means something there wants you. Details open as sheets over the page (a person, a place, a thing, an account, a quest), each with a back button; Escape goes back one level.

Everything here is shown as your character knows it. Someone your character cannot know of is never listed, and a place stays hidden until your character has been there or heard of it. A secret stays out of every place, sheet and Journal line until the story reveals it.

On this page, **Act**, **Timelapse** and **Actions** in the HUD's details open the actions sheet, **Map** in the HUD's details opens the map, and the map's **Full screen** opens it filling the window: the same sheet and map the chat's own entries open (see [The HUD](#the-hud)). In Lumiverse the drawer closes first for the map, which it would cover; in RPE's own web page they open over the page.

### What a press does

A press in the play views (here, in the HUD, in the actions sheet or on the map in the chat) does one of these things.

- **It is done at once.** Every money and organization control (paying, moving money, cards, standing payments, credit, investing, property, invoices, staff, members, structure, votes, the plan), your Belongings' controls, **Show a hint** on a quest, and each ✎ fix. It is your own change, kept on the chat's newest turn. A notice where you pressed says what was done ("Done: …"), with **Undo** in it. No message is sent, no reply is written and no time passes.
- **It waits for your next message.** Everything else: going somewhere, taking or giving a thing, buying, driving, a Timelapse, **Walk here**, an action of the world's own. RPE keeps it with your next message, and the Author is told what you pressed and on what, and plays it as what you want, with your words for how. While it waits, the HUD (and the actions sheet or the map, where you pressed it) shows **With your next message:** and what you pressed, with **Send now** and ✕; the actions sheet shows the action chosen, and the map the square. Press the same thing again, or ✕, to take it back. Once the turn has run, its page lists it under **What you asked for**. Where the turn neither carried it out nor had the world refuse it, the HUD shows **Not carried out:** and what you pressed, through the turns after, until you press **Send again** (it waits for your next message once more) or ✕ (**Drop it**). A swipe that carries it out takes it away; flip back to the one that did not, and it shows again.
- **It plays now.** **Send now**, on what waits or beside a choice in the actions sheet and the Timelapse, puts that line in the chat as your message and starts the reply, as if you had sent it: "Sent as your message: the reply is on its way in the chat." It cannot be pressed while a turn of the chat runs ("A turn is running: send it once the reply is in."), and it needs RPE connected to your Lumiverse. Where it cannot send, it says why, nothing is put in the chat and what waits still waits ([each answer](troubleshooting.md#a-panel-on-the-play-page-refuses)).
- **It reads.** Opening a sheet, a tab or a place changes nothing.

**Telling the Author.** A control that is done at once has **Tell** and **Don't tell**: whether the next turn's Author is told you did it. When you choose neither, its group's setting decides: **Tell the Author: Payments to others**, **Credit**, **Property**, **Business**, **Staff**, **Members**, **Structure** and **Hand-overs and outfits** are on as shipped; **Your own accounts**, **Investing**, **Governance** and **Things** are off (`taps.tell.<group>`). **Payments told from** (`taps.tell.paymentsFrom`) sets the amount from which a payment to someone else is told. The Author is told what you pressed, by its name, and what it changed, in the words the turn's review card gives a change. An **Undo** is told with what it took back: of an edit of yours when that edit was told, and of a change a turn made always. The words are the line `player_edit` in `.prompts/notices.md`.

**When the world's rules say no.** The world's rules advise. Where a press does not add up by them (a requirement not met, someone who is not there), it is done all the same, and the notice says "Done, though the world's rules say: …". It is refused only where it names someone, somewhere or something your character does not know ("Rena isn't anyone you know"), where it would change nothing ("That changes nothing."), or where the world cannot do it at all, and then the notice says why and nothing changes. The words are in `.prompts/play-answers.md`, yours to change.

**Undo** takes back what it still can of a change. Every kind of change a press, a fix or a turn makes has its Undo, but a roll you have seen ("… stays as it is, because you have seen how the roll fell"). Where something has changed part of it since, Undo takes back the rest and says which part stays and why ("… stays as it is, because something has changed it since"); where it took back only some, it says "Undone, but not all of it.". It undoes nothing once the turn it was kept with is no longer part of the chat's story (a swipe or a rewind took that turn away), and nothing of a turn that has not finished yet.

**While a turn runs**, Now says **A turn is running**: "A change you make now applies at once, and the running turn goes on from where it began", with **Watch it work**, which opens Live. While a turn is held on Live, Now says **Paused**, with **Open Live**.

### Now

**Now** is where Play opens. From the top: the banners above; the **scene card** (the time and the part of the day, **Clock paused** while it is, your place, the scene type with how long the last turn took, the weather and your cash, each with ✎ where it can be fixed); **Needs you**, the questions waiting under replies, each opening its reply in the chat; the **Encounter** while a fight is under way (the round and whose turn it is, the order with HP and conditions, what you have left, this round's acts, and **Combat actions** or **The whole fight**, which opens the fight's page; see [Combat and encounters](#combat-and-encounters)); **Here**, the people with you, each opening their sheet; **glances**, short cards from the world's packs (what is coming up, the quest in hand, your vehicles, money alerts, things lent and overdue, your conditions, your organizations), each with **Open**; and **Act**, **Timelapse** and **Map**.

### Me

**Me** has a tab for each part of your own life, each where the world has it:

| Tab | What it shows |
|---|---|
| **You** | Your name, where you are and what you are doing, your tier and your conditions; then your character sheet: stats, skills and derived values, as numbers or in words by the level. A pool such as HP is a bar that turns red at a quarter or less; a level shows its XP. With the tabletop rules on in the chat, **You** is your sheet under them: your classes and levels; hit points, temporary hit points and nonlethal harm, with the state they put you in (disabled, dying); experience toward the next level; defence, touch and flat-footed, and initiative; each attack of what you have readied and of your own, with its damage, when it threatens a critical, its range and the rounds loaded; your saves, abilities and skills with their ranks; what you are under, with what is left of it; your daily gauges; and your traits, each with what it does. Press a total, or hover over it, for where its number comes from: each part, and each bonus with where it came from and whether a better one of its type counted instead. Your abilities, hit points, experience and daily gauges have ✎, each fix with its own Undo. |
| **Needs** | From Cast life 4: hunger, fatigue, social and fun, each a gauge from 0 (met) to 100 (urgent), in words once it is pressing ("hungry"), with the point it is pressing from and what meets it ("Met by eating"). |
| **Money** | Your own money: see [Your money](#your-money). |
| **Garage** | A card for each vehicle: whose it is, its class, fuel, condition, where it is and its home base, its odometer or hours, cargo, specs, who has it on loan and who may use it, and service due. **Where is it?**, **Home base…**, **Owner & use…**, and **Specs…** (your own lines, "Seats: 5") are done at once; **Drive…** waits for your next message. **+ Add a vehicle** follows the world's claims policy. |
| **Belongings** | Everything you have, wear, keep at home and lend: see [Belongings](#belongings). |

#### Belongings

- **At the top:** **Search your things** (inside bags too), **Select**, and **+ Add**, which the chat's claims policy hides under **Hold me to the world** (see [Realism](#realism)).
- **Filter chips:** **All**, **Wearing** (Gear 3+), **Carried**, **Arsenal** (weapons, armor and ammunition), **Home**, **Here** and **Lent**.
- **The outfit bar** (Gear 3+) names the saved outfit you wear now. Tap it for **Outfits & loadouts**: each saved set with its pieces, **Change into**, **Forget**, and **Save what I'm wearing as…** an **Outfit** or a **Loadout**. An outfit dresses you; a loadout is what you carry ready and the arms and armor you wear.
- **Sections:** **Wearing**, **Carried** (bags open in place, with their load), **Here**, **Home storage**, **Elsewhere**, **Lent and borrowed**, and **Vehicles (n)**, which opens the Garage.
- **Each row** has one main verb (**Take off**, **Ready** or **Stow**, **Wear**, **Put in**, **Take**, **Take back** or **Give back**), and **⋯** holds the rest: **Move to…**, **Put away**, **Drop**, **Owner & use…**, **Rename** and **Size**.
- **Every change here is done at once**, with **Undo** in the notice. **Select** lets you pick rows and do one thing to them all, as one change with one Undo.
- **Move to…** offers the places you know, yourself, the people here and every holder you can use, with **Where it's kept**, **Recent**, **On you**, **Here** and **Home** first. A holder too small or too full is greyed, with why.
- **Owner & use…** shows whose a thing is (**Mine**, **Household** or **Nobody's**) and who may use it, each with **Stop**, and offers **Let someone use it…**.
- **+ Add** asks the name, the kind (**Item**, **Clothing**, **Container**, **Kit**, **Weapon**, **Armor**, **Ammo** or **Vehicle**), what it is, how many and where. Under **Make it real** it is made at once; keys, weapons and documents ask first, and so does anything priced over the world's claim cap while that is on. Under **Ask first** it always asks.

Tap a thing for its sheet: where it is and what holds it, whose it is and why you have it, where it is kept, its slot, quantity and condition, whom it is lent to, a kit's pieces and a container's load. **In the story** (**Fetch**, **Put away**, **Give back**, **Hand to…**) waits for your next message; **Change it** (**Move to…**, **Owner & use…**, **Rename**, **Size**) is done at once. A holder of yours opens as its container page, with **Put in from…**, **Add here…** and **Empty into…**.

### Your money

**Me → Money** is your own money. What it shows follows your Money level: at 1 a wealth band; from 2 your cash and accounts; from 3 cards, standing payments, income and bills; at 4 the full books (terms, statements, pending lines and holds, what your net worth is made of, investment lots, your paycheck's taxes and your credit report).

**Money detail.** Below the top Money level the money hub keeps the books simple, and at the top level it shows them all. Under any preset, a world can turn single money features on or off in **Build → Packs → economy** (**Money features** → **Feature switches**). Switched on, a feature runs from the lowest level it can, and the hub shows its own detail there; switched off, it runs at no level, and its detail is gone from the hub at the top level too.

A row of segments sits under Me's tabs, each where you have something in it:

- **Summary**: your net worth and wealth band, cash on hand, your first alerts (**All alerts** opens the rest), what is coming up in the next seven days, and the last 30 days' cash flow.
- **Accounts** (from Money 2): **Move money** (**Transfer**, **Pay a card or loan**, **Cash out**, **Cash in**, and from Money 3 **Lend money**), every account you hold or share, the cards you hold on others' accounts, **Activity** with its filters, and **How you pay**. An account's page has its balance, limit, what is due, its interest (from Money 3), its owners, cards and lines, with **Pay**, **Transfer**, **Autopay** and, for a card, **Change** (**Freeze**, **Unfreeze**, **Report lost**, **Replace**). **Income and spending** opens your statements for a period.
- **In & out** (from Money 3): **Income** (each job, its pay, payslip and deductions, **Pay goes to**, **Quit**), **Standing payments** (**Active**, **Paused**, **Ended**, and **New standing payment or one-off**, with **Edit**, **Pause**, **Resume** and **Delete** on each), **Invoices to pay**, your **Household**'s share, and **Autopay**.
- **Assets**: what your net worth is made of (full books), **Investments** (each holding with **Performance**, **Buy more**, **Sell**, **The market** and **Buy something new**, from Money 4), **Property you own** and **For sale** (**Let it**, **End the lease**, **Sell**, **Buy** with a mortgage), your stakes in organizations, and your vehicles.
- **Credit** (Money 4): your score from 300 to 850 and the credit you could apply for, each opening its **Apply** page.

Each page opens over the page with a back button. A control's page has you fill it in, then press its one button, which says what it does (**Pay** *amount*, **Start the lease**); while something is missing, the button waits and the page says why. Every one is done at once (see [What a press does](#what-a-press-does)), but buying something in a shop, which waits for your next message. A business's or your household's money is on its page in [Orgs](#orgs).

### People

**People** lists **Here** and then **People you know**: each with their role, what they are doing or when and where you last saw them, how they feel about you, and any life state but alive. **Filter and group** groups and filters them by the classifications the world lets players see, by group and by tier. **Your groups** lists the organizations you belong to.

A person's sheet shows where they are, or **Last seen** (from Cast life 2); their **Next** commitment; **Today**, a 24-hour timeline of where their routine and commitments put them, with **Why this plan?**; **Their usual day**, where each block comes from as far as you may know (a private block reads **Busy**); **How they see you**; **What they're after**, their public agendas; their **Organizations**; and **Known as**. Their day is what they would usually do. What the story establishes comes first, and nobody moves by their routine until an agent records it (see [Time, needs and routines](#time-needs-and-routines)). With the tabletop rules on, someone standing where you are, or in the fight, has **Their sheet** too, laid out as yours, with no ✎; their hit points are told as the fight tells them, the numbers where the world's rules show them, else how hurt they look.

**Where are they?** corrects where someone is, as ✎ on your own place does: search a place by any word of its name or browse from the top, among the places you may know. It is done at once, with Undo.

### Orgs

**Orgs** is every organization your character belongs to or knows of: your household, the company you work for or own, a group, a trust, and your party. Members, positions, titles, powers and delegation show at every Money level; an organization's money, payroll, ownership and taxes show at its Money level, as yours do. Every control on its pages is done at once, with **Tell** and **Don't tell** and **Undo** (see [What a press does](#what-a-press-does)).

**The home**: **Your party** (who is in it, here and away, and its **Purse**); the organizations you belong to, as a tree (**Households**, **Companies**, **Groups**, **Trusts**), each row with the one figure you may see and your title there, nested by who holds what, four levels deep with **Show from here**; **Known organizations**; and **Start something…**: **Start a company**, **Settle a trust** and **Start a nonprofit** (from Money 3), **Start a group** and **Name your party**.

**An organization's page** has its name, a badge for what it is ("Company · LLC", "Household", "Party") and your title there. **⋯** holds **Rename** where you may govern it, **Leave** where you belong by a link of your own, and **Open in GM**, which opens it on the World page behind the spoiler gate. Its tabs, those it has and you may see:

| Tab | What it shows |
|---|---|
| **Overview** | Its headline and figure; its alerts, those that ask something of you marked **Needs you**; **Your place here**; **What you may do**, power by power, with what each rests on; **Delegations you hold**; a trust's terms; **Coming up** (paydays, invoices, dues and lease ends); and its **History**. |
| **People** | **Hire someone** and **Admit a member** where you may; each position with its seats and holders, or **Vacant**; staff, members and owners; and a company's **Payroll**. A person's sheet has their positions, powers and job, and the controls you may use on them: **Appoint…**, **Change title…**, **Delegate…**, **Revoke…**, **Raise**, **Change hours**, **Put on leave**, **Let go** and **Remove**. |
| **Chart** | Who reports to whom and who holds each seat, and who owns it up to the top and what it owns, as lists you tap through. |
| **Plan** | Its goals and the orders given for them, with their status (**Open**, **Under way**, **Blocked**, **Done**, **Dropped**, **Refused**), **Late** where their time has passed, and **Add a goal**, **Give an order**, **Edit**, **Done**, **Drop** and **Reopen** where you may. |
| **Money** | Its own money in the same segments as yours, with a company's **Books**, its invoices (**Issue an invoice**, **Void**, **Pay**), **Revenue streams**, and **Pay as…** where you may spend its money. |
| **Projects** | What it builds or works toward over weeks, with **Start a project**, **Pause**, **Resume** and **Drop**. |
| **Ownership** | A company's structure, its cap table and worth, a listed company's market, its structure above and below, **Pay out profit**, **Owner's draw**, **Sell shares**, and the decisions that need the owners' votes: **Issue shares**, **Buy back**, **Classes**, **Start a subsidiary**, **Change structure**, **Merge**, **List on the market**, **Wind up**, each with **Put it to a vote** where your votes fall short. |
| **Taxes** | How its income is taxed, a tax-exempt status with **Donate**, a consolidated return, unemployment taxes, what falls due next, this year and last, and what it carries forward. |
| **Decisions** | **To a vote** (each open motion, with **Your vote**: **For**, **Against** or **Abstain**), **Waiting for approval** (**Approve** or **Deny**), **Decided**, and **How decisions are made**. |
| **Property** | Its premises, each with who may enter, its hours and keys, and **Change entry** where you may. |
| **Rules** | Its positions (with **Add position** and **Edit** where you may govern it), its delegations and its dues (**Set dues**); a party's tiers. |

**Powers.** What anyone may do for an organization is one of its 21 powers, in seven families: **Members**, **Staff**, **Money**, **Things**, **Property**, **Ownership** and **Governance**. A power rests on an owner's role, a position, a delegation, what the organization's type gives a member, or control through an organization that holds this one. A position or a delegation may carry limits (so much a payment, so much a month). An act over your limit can be put to those above you for approval (**Ask for approval to pay**, in **Pay as…**), and waits under **Decisions**.

**Acting for an organization.** Where you may spend for an organization, **Pay** and **Buy** in the actions sheet offer **Paying as**, and its **Money** tab has **Pay as…**.

**In the story.** When the story has someone taken on by an organization, given a title or a position, or leaving it, the Author or the GM carries out the organization's own action for it (`org_admit`, `org_title`, `org_appoint`, `org_leave` and the rest), as it does any of the world's actions ([how](#how-checks-are-decided)). The person then shows here as a member, with their title, and the organization's **History** has the line. Where the one who takes them on may not admit members, the agent is told so, and they are admitted all the same.

**The party.** Your party is the people who travel with you, each in a tier: **Core** and **Companion** come along wherever you go (a companion unless their own commitment is due); **Hired** and **Ally** come only when you take them. Its page lists them by tier. As its leader you have **Add someone you know**, **Change a tier**, **Name the party**, **Start a purse** (from Money 2), **Share out** and **Hire a hand** (from Money 3).

### Story

**Story** has four tabs.

- **Quests**: quests, puzzles, secrets and agendas, sorted into **Active**, **Done** and **Failed**, each with its stage and objectives. A quest's sheet shows where it stands, **Stages gone by** (each stage the quest has been moved past, with whether it was done or failed and why, as the Author gave it), its objectives, each marked done or not yet, what you have learned, and its hints, which stay closed until you open them one at a time (**Show a hint**, then **Show another hint**); opening one is done at once, with Undo. When what moves a quest on has happened, its sheet says so, and the Author moves the quest on at its next turn. Only what you know is shown. To answer a puzzle, say it in the chat. The quests as the Author keeps them, secrets and all, are on the [Quests page](#places-and-quests).
- **What you know**: the facts your character holds, newest first, while the chat tracks who knows what (**Track who knows what**, `secrets.tracked`, on as shipped): each with how you came by it (**Told by** someone, **You saw it**, **From the start**, **You worked it out**, **A guess**) and since when, and badges for a suspicion, an open question or what you make of it.
- **Journal**: what each turn recorded that your character may know, newest first, and what took no effect and why, filtered by **All**, **Notes & montages** or **Not applied**. It reads the newest 100 turns at a time (**Turns the Journal reads at a time**, `taps.journalPage`). **Save to lore…** keeps the latest reply, or a part of the chat you select or paste, as a lore entry in the world's draft in Build.
- **Calendar**: the date and the clock, today's holidays and what is coming up, with **Pause clock** or **Resume clock**.

### The map

The map is **Places**. Its bar holds the **breadcrumbs**, **List of places** and **Full screen**. Drag to pan, scroll or pinch to zoom, or use **Zoom in**, **Zoom out** and **Fit map**. The map shows one place at a time, with the places inside it and the routes between them, and opens where you are; the breadcrumbs lead out a level at a time, up to **World**.

Tap a place for its sheet: whether you are here, have been or have only heard of it, and **Getting there**, each way with its mode, time, vehicle and cost, or why there is none. Choosing a way waits for your next message. Where you are, the sheet adds **Things here**, and your own things there have Belongings' controls. **Parked here** lists vehicles, with **Drive…** and **Park here**; **Property here** has **Buy…** and **Live there**; **Make this a property** follows the chat's claims policy.

**Known** and **Fog** choose how the map shows what your character knows, for this chat: **Known** draws a place you have only heard of as a dashed ring; **Fog** dims what you have not been to and covers what you have not seen. Your choice is the chat's setting **How the map panel shows the map** (`map.display`).

Where the world uses the grid system, you stand on a square: tap a square of your grid and its card offers **Walk here** with the time it takes, around the walls and through the doors, or says "No way there from here."; the walk waits for your next message, its square marked on the map, and the card then offers **Take back Walk here**. Walls and doors are drawn as thin lines; a place you know may carry a mark (**Home**, **Yours**, **For sale**), named in the legend under **The map shows**.

In the chat, **World map** and **Map** open the same map over the chat; **Full screen** on Places opens it filling the window. Where Lumiverse's drawer is open, it closes first, since it would cover the map.

## Time, needs and routines

A chat has one clock. With a world, it runs on the world's calendar, and the HUD, the scene card and **Story → Calendar** show it. A chat with no world has a clock with no date until the story sets one: nobody chose its start, so no date is shown, and times are given as how long from now.

**Time passes when an agent passes it.** The Author, or the GM it asks, passes the time the story took: a conversation is minutes, a meal an hour, a night's sleep a night. In a fight on a room grid, time moves in rounds of a few seconds. Nothing moves the clock by itself between turns, and a turn takes no set time of its own.

**What time brings due.** When time passes, what your world's own records arrange over the span happens as the clock passes it, in its order, and is recorded: pay, bills, standing payments, interest, and a schedule that sets something's own value, such as a business's hours. The answer says what happened. What is left is listed, near the scene: where people's routines now put them, who arrives, a need that crossed its point, an effect that ended, something the Author scheduled, a change in the weather or in prices. The engine applies none of that list. Whoever runs the turn decides each item (it happened as scheduled, differently, or not at all) and records what happened. An item nobody decides did not happen: someone listed at school at 8:00 is still at home. For a long skip, the Author asks ahead what will come due, passes the time a stretch at a time (the engine runs your records over a year at most in one go), says what the people off stage did meanwhile, and records totals for the routine remainder (meals and sleep). All of this is written in the shipped skill `time` (`.skills/time/SKILL.md`), which you can change like any file.

**Your controls.**

- **Pause clock** and **Resume clock** (in the World details, the actions sheet, the composer's action bar and **Story → Calendar**) pause the clock for the scene. The pause is a mark, not a lock: an agent that moves the clock while it is paused is told so, and the move stands.
- **✎ on the time** sets the clock (see [Fixing a value](#fixing-a-value)). Moving it on decides nothing about what the time in between brought: that is the Author's, at the next turn.
- **Timelapse**, in the actions sheet in the chat: **For** (lengths, with **Custom**), **Until** (the next morning or another part of the day, your next shift, the end of a trip, a date), **Follow my routine** for your own character, and **Interrupts for this run**. What you pick goes with your next message: the Author is told the length or the target and your choices, and moves the clock by it with `pass_time`, which answers with what the time brought due. The clock stops short where something you set to stop a skip comes due (an arrival, a need reaching its line, a change in the weather), and the answer says so; what you set to be ignored is not listed, and with **Follow my routine** off, where your own routine would put you is not listed either.

### Needs

From Cast life 4, people get hungry, tired, lonely and bored: hunger, fatigue, social and fun, each from 0 (met) to 100 (urgent). They rise with the clock, and come down when what meets them is played as the world's own action: **eat** for hunger, **sleep** for fatigue, **chat_with** for social, **rest** for fun. When the story has someone eat or sleep, the Author or the GM carries out that action for them, as the world defines it ([how](#how-checks-are-decided)), and the need is met at the action's end: after a thirty-minute meal, hunger reads 0 and grows again from there; a night's sleep takes the sleeper to their bed, where they have one, and meets fatigue when they wake. The action passes no time itself: the agent passes the meal's minutes, or the night, as it passes any time, and minutes passed with no meal carried out meet nothing. As shipped, the `time` skill tells the agents so.

**Me → Needs** shows your own, each from 0 (met) to 100 (urgent), with the point from which it presses ("From 60 you're hungry.", or "You're hungry." once it does) and what meets it. The Author is told the same, in words: the world state it is given each turn gives each of your needs by its name and number, the word it is marked with once it presses and since when by the story's clock, what meets it and from what point it is listed as due ("Hunger 64 of 100, so hungry since …. Met by eating; from 80 it falls due when time passes."). It also lists a need that will reach that point within the time ahead it lists (**Time ahead listed as due**, `worldState.dueAheadMinutes`, 360 minutes), and one that reached it as the last turn moved the clock, in the same words; so does what an agent's tools say falls due when it passes time. The words are the line `need_standing` in `.prompts/history-records.md`. A world sets each need in **Build → Needs**: how fast it grows (**Grows by … points an hour, out of 100**), the point from which the Needs panel marks it as pressing (**Marked as pressing from …**) and the point from which it is listed as due (**Listed as due from …**), with an **On** or **Off** for each and **Use the defaults**. Anyone can have a **bed** (the person's **Bed** field in Build): **sleep** takes them to it.

### Routines and schedules

A **routine** is what someone can be relied on to do on an ordinary day: opening the shop at seven, a walk by the lake on a fair weekend. A **schedule** is a commitment with set hours, such as a shift or school. A world's routines and schedules are written in Build (see [Routines in Build](#routines-in-build)).

They are defaults, never a script. They show what someone would usually do: on a person's sheet in **People** (**Today**, **Their usual day**), and among what falls due when time passes. Nobody moves by their routine until an agent records the move. What the story established always comes first.

An agent can change one character's routine in a chat (the tool `gm_routine_edit`), as a change of that turn, without touching the world.

## Realism

Realism is how closely a world keeps each part of life. It is set per **domain**, each at a level from 0 to 4: **Off**, **Narrative**, **Simple**, **Detailed** or **Simulation**. The domains are **Money**, **Gear**, **Vehicles**, **Cast life**, **Relationships**, **Space & travel**, **Calendar & time**, **Weather** and **Sheets & checks**.

A higher level keeps a domain more exactly, and the play views show and list more of it: Money 1 is a wealth band, Money 4 the full books; Space 2 is places and routes, Space 3 adds grids and positions. A level never decides whether a change is applied: every write is applied, and every report made, at every level. The world state the Author is given each turn opens with the chat's realism, level by level.

**Presets.** A world's realism starts from a preset:

| Preset | Money | Gear | Vehicles | Cast life | Relationships | Space | Calendar | Weather | Sheets | Band caps (Leads / Supporting / Background) |
|---|---|---|---|---|---|---|---|---|---|---|
| **Story** | 1 | 1 | 1 | 1 | 1 | 2 | 2 | 1 | 1 | none |
| **Grounded** | 2 | 2 | 2 | 2 | 2 | 2 | 3 | 2 | 2 | none / none / 1 |
| **Simulation** | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 4 / 3 / 2 |

Moving any level yourself makes it **Custom**.

**Tiers and bands.** Not everyone is kept as closely as your own character. Every character has a **tier**, one of the world's own (**Build → Tiers**), and each tier belongs to a **band**: **Leads**, **Supporting** or **Background**. A band can cap each domain, and a character is kept at the lower of the domain's level and their band's cap. Your own character is never capped.

**Where it is set.** A world sets its realism in **Build → Realism defaults**, and a chat takes its realism from its world as it starts. On the World page, **For this chat** sets one chat's own: each part of life's level and each kind of person's cap (a dash is no cap). It holds from now on, as your own edit with **Undo**: nothing already recorded changes, a part you set lower stops working out detail, and setting it back does not fill in what it skipped meanwhile. Where the world's ruleset needs a level (its **Level floors**), the chat cannot be set below it ("This world's rules play … at … or higher, so this chat cannot be set lower.").

**Things you say you have.** The claims policy decides what the **Add** on a panel does when you say you have something the world doesn't: **Make it real** adds it at once (a key, a weapon or a document asks you first), **Ask first** asks before it is added, and **Hold me to the world** hides **+ Add**. **Ask first above the world's claim cap** makes something priced over the cap ask first under Make it real. A world sets it in **Build → Realism defaults**, under **What you add that the world doesn't have**, once **This world sets what the Add on a panel does with them** is on; not set, a chat plays it by its realism preset (Story makes it real at any price, Grounded up to the claim cap, Simulation asks first). **For this chat**, on the World page, sets one chat's own from now on (what you added before stays), and **Follow the world again** goes back to the world's. In what you type, a thing you say you have is the Author's to weigh, with `SIMULATION.md` and the lore.

## How checks are decided

A **check** is the dice an action of the world rolls: a stat or a skill against a difficulty, with outcomes such as success and failure (see [Checks, pools, progression and sheets](#checks-pools-progression-and-sheets)). In RPE the game master rules by the world's actions and checks. They are what it rules with, not gates in code.

- **Who rolls.** As shipped, the GM rolls when an outcome is uncertain and it matters, so that chance decides it, and says what was rolled and why (`SIMULATION.md`, "Dice"). The Author asks the GM when something is contested, costly or risky.
- **How.** The GM carries out one of the world's actions with the operation `act`, naming the outcome it ruled, or leaving it out: then an action of one outcome takes it, and an action with a check has its check rolled by the world's rules. The tool `roll` rolls dice or one of the world's checks for someone, records the roll with what it was for, and gives its id, which a later change can cite as its source. `checks_odds` reads an action's odds and changes nothing.
- **Requirements advise.** An action whose requirement does not hold (you would need something you do not have) is carried out all the same, and the answer says which requirement did not hold. What to do about it is written in `SIMULATION.md`: as shipped, apply it and let the report stand, so that it can be put right later. To make the rules bind, change that paragraph.

**The world's rules for checks.** A world can set how its checks are decided in **Build → Ruleset**, under **How checks are decided**: **When checks roll** (**Every check**, **Only risky ones**, **Only where marked** or **Never**), the lines under which **Sure things pass without a roll** and **Hopeless tries fail without a roll**, and **Retrying a failed check** (with **Time that counts as a change**). **Start from** offers **Narrative-first**, **Balanced** and **Crunchy**; any change makes it **Custom**. **For this chat**, on the World page, sets the same for one chat from now on (a roll already made stands), with **Follow the world again**. These rules apply wherever a check is rolled by the world's rules: an `act` with no outcome, and the odds the actions sheet shows. What a world's file still holds of the previous build's judge (how a described approach counts, who settles a check) is named at the foot of Build's sheet, under **Kept in the file, not used by this build**.

**What you see.** The actions sheet shows each action's odds before you pick it, and what the world's rules will make of it. After the turn, the turn's page lists every roll and ruling in its engine lane, behind the spoiler gate.

## Swipes, edits, deletes and branches

A **turn** is one reply attempt. Every change RPE records belongs to the turn that made it, and RPE's record of the chat follows the messages Lumiverse shows. At the start of every turn, RPE compares the chat as Lumiverse has it (which messages, which swipe shows, what each says) with its own record, and tells the Author what it found.

### Swipes and regenerates

A swipe or a regenerate is another attempt at the same turn: a new turn beside the earlier one, which starts from the record as it was before the earlier attempt. The Author reads `SWIPE.md` with `TURN.md`. As shipped, it keeps what was decided (the outcomes, the rolls, what the characters did) and tells it differently, and does not repeat the earlier attempt's opening, structure or key images. The earlier attempts are in the turn's folder, under `previous-attempts/`, each with its reply, its intent record and anything you typed about why.

- The composer's **Swipe** control asks for one way: **another-telling** or **afresh** (the turn run again from the start, with new rolls), with a line of what was wrong (see [The composer](#the-composer-depth-and-swipe)).
- What you asked for with the turn you swipe (its depth, a press in the play views) is asked again of the new attempt.
- What you record belongs to the attempt you keep. Show another swipe on the newest reply, and that attempt's record is the chat's, its own changes intact.
- Flip an earlier reply to another of its swipes, with later replies still after it, and the later turns are kept and their changes applied again on top of the swipe now showing. A change that no longer applies there is listed, never dropped silently: the next briefing tells the Author which stretch to look over, and the world state lists what no longer applies.

### Edits

- **A reply you edit** in Lumiverse: the turn is marked **edited**, on its page and under the reply, and at the next turn the Author is told the text before and after. The text that stands is what happened, and the Author settles both lanes against it. **Settle now** has it do that at once (below).
- **A message of yours you edit**, with turns after it: the later turns are marked "an earlier message edited", and the next briefing names the stretch after it, for the Author to look over.
- **A reply Lumiverse saved differently** from what RPE released is marked **saved otherwise**.

How much the briefing gives of edited replies is **Edited replies in the briefing** (`briefing.editedTokens`): every one in full, as shipped.

### Deletes

Delete a message and its turns leave the chat's story: everything they recorded goes with them (the world's changes, perceptions, memories, beats, the Author's records and notes), and the record is as it was before them. The next turn's briefing names the turns that are gone, and the Author reads `DELETE.md`: it does not refer to what was deleted, checks the scene, and takes your new message on its own terms.

A deleted turn stays on the Turns page, marked **off the path**, as does an attempt you swiped away from.

### Continue and impersonate

**Continue** extends the same turn: the Author adds to what it recorded and does not start over. The Turns page shows the turn as continued, and **Where a continue went on from**. **Impersonate** has the Author write as your character, briefly, in their voice, and change nothing in the record.

### Branches

A branch in Lumiverse is a new chat whose turns point back into the chat it was branched from, so the history they share is shared, not copied. Turns played in the branch are its own. Until the branch has a turn of its own, what would write to its newest turn (a strike on the Cast page, Settle now) is refused, because it would go into the other chat's history too.

### A stretch played without RPE

Replies written while the chat was on another connection, after RPE's first turn in it, are a stretch played without RPE: the Author is told the range, and as shipped it records what matters of it, in passing or as a job. The line under each of those replies says **Made without RPE.**

### The Turns page

**Turns** lists every turn RPE has played in the chat, newest first: what it was (**New reply**, **Swipe**, **Regenerate**, **Continue**, **Impersonation**, **Settle run**), when, how long it took, its calls and tokens and what they weigh (see [What is spent](#what-is-spent)), the jobs it started with what they spent, its marks, and how it ended (**Reply released**, **No reply**, **Stopped**, **Stopped at a limit**, **Failed**). A turn the migration carried is marked **carried**, and opens to what the old engine recorded.

A turn's own page has its sections, those behind the spoiler gate shown once you open it:

- **Marks on this turn**, **Timings**, **Tokens** (with what its calls weigh, and each job it started with its own use), **Its runs** and **What went to the chat**;
- **What you asked for**: your depth, your swipe's way and feedback, what you pressed in the play views;
- **What the Author was given** (gated): the prompt by part, its lore, the turn's files, and what each agent's first call was sent;
- **The prompt's front, and what changed in it**, and **A reply asked for whole**, where one was;
- **Intent record**, **The Author's record of the turn**, **Tokens by agent** and **The run, step by step** (gated);
- **Where the tokens went** (gated): each agent with what it was handed as it started and its calls one by one, each call with its tokens, what they weigh and its request part by part; a call made after the reply went out is marked **after the reply**, and one that read nothing from the provider's cache and wrote it again is marked **cold write**, with why; between its calls, what an agent did to **its window** (let things go, brought them back, went on in a fresh one), with what that spares on each later call and what it took once, read from the trace the turn's folder keeps; below, the jobs the turn started, each with its own use;
- **Changes by lane**, and **The changes, lane by lane** (gated), each with who made it, how sure it is and where it came from;
- **The review card** (gated): every change the turn made, under **The story's changes** and **The engine's changes**, each told in words (what changed, who made it and how sure it is, what it reported), with **Undo it** and a line saying what an Undo takes back and what it would leave; **The record as written** is closed under each, for whoever is looking for a fault. **Questions asked on it** holds the writes that wait for your word (see [Who may write what](#who-may-write-what));
- **Who perceived the turn**;
- **Quests it touched**, **Threads it left open**, **What is still open** and **Unsettled**, what did not add up (gated);
- **Gap checks, consents and what it was told** (gated): each gap check and what came back, each consent, each rule that fired.

A turn whose reply ended empty says **Its empty reply is still in your chat**, with the setting that would take such replies away. A turn that ended with nothing of its reply saved was dropped with everything it had changed: its card says **Nothing of this turn stands**, each change is marked **dropped**, and there is nothing to undo.

### Settle now

**Settle now**, on the Turns page, on the page of the chat's newest turn, and under a reply whose record was not finished, runs the Author on the chat's newest turn against the chat as it reads now. Use it after you edit a reply, or when a turn's run stopped before it recorded everything. It writes no reply and adds nothing to your chat; its run shows on the turn's page as a **Settle run**. It waits while a turn of the chat runs ("Settle it once that turn is over"), and is refused where the chat has no turn of RPE's, or where its newest turn is shared with the chat it was branched from.

## The world's record, and who may see what

RPE keeps four records for a chat: the world's state, the places and quests, each character's record, and the story record. The Author reads them at every turn, and the agents write them through their tools as the turn's changes, so a swipe or a delete takes them back with the turn. You can read each on its page and correct it, as your own change, which the Author is told of at the next turn.

What the records hold can give away what comes next: secrets, the Author's plans, what a character knows that yours does not. So most of each page stays behind the [spoiler gate](#rpes-pages) until you open it for the chat. What your own character knows is on the [Play page](#the-play-page), which shows only that.

### World

**World** shows the chat's world as one tree, at the chat's newest turn or as it stood at any turn: the world, its places, the people and things in them, their groups. Open any level to any depth (**Fewer levels**, **More levels**, **Up a level**, **The whole world**). Each value says where it comes from (its own, inherited from a level above, or kept by a game system) and which change last wrote it; facts recorded on the same key stand beside it and never overwrite it. The tree is behind the spoiler gate.

**For this chat**, above the tree and outside the gate, is what this chat plays by on its own: **How closely life is worked out** (each part of life's level, and **Caps for each kind of person**), **When you add something the world doesn't have** (the claims policy) and **How checks are decided**. Each says whether **This chat follows its world** or **This chat sets this for itself**. A change is your own edit from now on, over nothing already recorded, with **Undo**; the claims and the check rules have **Follow the world again** (see [Realism](#realism) and [How checks are decided](#how-checks-are-decided)).

- **History** reads a value's changes turn by turn.
- **Change** and **Remove** change a value as your own edit, with **How exact** and **Tell the Author at the next turn**, and **Undo**. **Add a value or fact** adds one to a level.
- **Systems** shows what each game system keeps at a level (money, gear, a person's sheet), as the system keeps it.
- **What the time brought due** shows, where it concerns, what a turn's time listed.
- After you flip an earlier reply to another swipe, the page lists the later changes that no longer apply.
- The things browser stands below the tree: who has what and where, a thing's page with its history, and **Tidy up**, which finds holds that cannot be (a sofa on someone, a coat worn and lying elsewhere) and offers the fix for each, or **Leave it**. Nothing is fixed by itself. Whether each turn's world state lists such holds is **Tidy-up findings in the world state** (`things.tidy`), which follows the world's own switch until you set it. **Keep in the world** copies what the chat made in play into the world's draft in Build.

### Places and quests

**Places** lists every place of the chat, the world's own and those made in play, searchable a page at a time. A place opened shows its record, now or as it stood at a turn, in nine parts: **What defines it** (the lore entries bound to it), **Its base** (which you can write over with **Write it as your base**), **What the story changed there since**, **Its features**, who and what is here, its ways, who may enter and its doors, its history and who knows of it. Its grid, where it has one, shows everyone and everything on it: pick a person or a thing, then tap a square, to move them there at once, with Undo. A grid the chat made has **Keep in the world**. The records are read only while the gate is open.

**Quests** shows every quest, secret, puzzle and agenda as the Author keeps it, behind the gate: what it is, its stages with what moves each on and, for each stage the story has moved it past, how that stage ended (done or failed) and why, who and where, its stakes and rewards, how much of it you are shown, how it closed, and its history, each move with its turn. A quest standing on an end stage reads closed, as that stage ended it. Outside the gate, **What you see in your journal** shows each quest as far as it lets you see: the whole quest, only its name and the stages named, or nothing.

### Cast

**Cast** lists every character the chat knows, with its casting: **principal**, **supporting** or **extra**. A principal is run as an agent of its own when the turn needs it. Opened, behind the gate, a character's whole record:

- **Base**: who they are, drawn from their sources (the card, lore entries), with **Growth** laid over it as the story changes them; each source marked current, changed, not drawn from yet, or gone. Growth a character's own reflection proposed is laid over the base only once the Author accepts it; until it decides (accepts or strikes it), the entry under **Growth** is marked **proposed: waits for the Author's decision since message …**, and from a turn after, the rule `growth-waiting` reminds the Author at each turn's start.
- **Mind**: what is on their mind now, by kind.
- **Memories**, by strength: a memory fades over story days unless it matters or is recalled, and a faint one shows as its gist. As shipped, when a principal sleeps or days pass for it, the Author has its agent dream, which settles what it lived into long-term memory. The settings under **Characters and their memories** set how fast (`cast.fadeDays`, `cast.topOfMind` and the rest).
- **Relationships** (trust, warmth, respect, fear), **Knowledge**, and **History** with its beats.
- **Perceptions**: what reached each character of each moment it was on stage for. Every principal and supporting character on stage gets one; extras do not. A character's memories and beliefs are built from them, by its own agent. As shipped, the rule `perceptions` says who gets one and what goes in it, and the rules `perceptions-owed` and `perceptions-missing` remind the Author of one that is missing.
- **Game side**: the world's person it is; **Away**: while a principal is off stage, where it is and what it means to do; and the mind files the migration carried from the previous build.

**What waits for its own agent** says how many perceptions a character holds that its agent has not made memories of, and about how many tokens they are. **Have its agent take them in now** starts a job of yours in which its agent does; above the list, **Have their agents take them in now** starts one job for each principal that holds any, and says which were started. While a job of a character's own agent is at work, what it was given is in its hands: the page does not count it as waiting, and the press starts no second job for that character, naming the job at work instead. A backlog is never handed to one agent whole: past the size of one batch (**A batch of what a character takes in**, `cast.takeInTokens`, 30,000 tokens as shipped), its agent is given the batches by name, hands each to an instance of itself, and settles the character's mind and relationships once from what the instances report. As shipped, the Author starts memory work the same way, and its reminders say how large what waits is.

You can strike an entry and take the strike back; write a perception for a turn the character was on stage in and has none of; set or pin its casting ("it stands over the Author's casting until you take the pin away"); redraw its base; bind a source; and name the world's person it is. Each is your own change, and the page says what the cast did with it. Whether your own character has a mind of its own is **Your character has a mind** (`cast.playerMind`, off as shipped).

**What a character's agent starts with.** A character's own agent does not carry its whole record on every call. It starts with who it is, what is on its mind, what comes to mind for who and what is on stage, how it feels about the people there, its game side, and the newest of what it has perceived and not yet taken in, whole, up to **Newest perceptions a character starts with** (`cast.newlyPerceivedTokens`, 6,000 tokens as shipped). Nothing is cut to fit: what does not fit waits whole, and a line says how many perceptions wait, how large they are and the call that reads them. Beside these it is given an **outline** of the rest of its record, within **An outline of a character's record** (`cast.outlineTokens`, 1,500 as shipped): the perceptions that wait, by day and by scene, each with what the character came to know by it; its memories; how it feels about people who are not there; what it knows; and its history. Every line says how many entries it counts, their size in tokens and the call that opens them. A scene is named to the character by its id, under its day, and never by its title: the title is the Author's account of what happened in the scene, which the character may never have seen.

The call is the character's own tool, `self_read`: a part of its record, one entry, a day's or a scene's perceptions, or a file; whole, or by gist (a memory's gist, a perception's lines of what was learned) with the size of the whole. It reads only the record of the character the agent plays, and only what that character may know: what the character missed of a moment, and how far a telling can be trusted, stay with the Author, who reads them with `cast_query`. A migrated character's old mind files are listed by name and size and opened the same way (**Old mind files a character starts with**, `cast.importedTokens`, 0 as shipped, so none is handed over whole), and a game side that has grown large is given by name and count, each part closed at the world state's own size (`worldState.foldTokens`). Set either of the two sizes to `~` and the agent is handed all of it on every start. What the agent is given is the `given:` list of `guidance/.agents/character.md`: take `outline` out of it and no outline is given. The sizes hold back only what the agent can open: a character definition of yours whose `tools:` does not hold `self_read` (one copied from an earlier build, say) is handed every view whole, as before.

### Story

**Story** shows the story record as the Author keeps it, behind the gate: the **Timeline** (chapters, scenes and beats in the chat's order, each beat beside the message it stands for); **What the record covers** of the chat, with every stretch it does not cover or has beats for and no summary of; **The story so far, as the Author is given it** for what lies beyond the window; and the parts of the story model: **Premise**, **Threads**, **Arcs**, **You, as the Author reads you**, **Canon**, **Retcons**, **The Author's records**, the **Horizon** and the **Futures**. You can strike or correct any item, as your own change.

The story record stands in for the history the window leaves out: the Author keeps it ahead of the window, so that what leaves the prompt is still known. The briefing's story so far fills at most a set number of tokens, the same on every model (**The story so far: tokens**, `story.soFar.tokens`, 16,000 as shipped): the newest stretches come whole, what is further back by its chapters' summaries, and what does not fit is counted in a line the Author opens with `story_query`. **Hold uncovered messages** (`history.hold.on`, off as shipped) keeps a message in the prompt until the record covers it. Above the record, the Story page has the chat's **Bootstrap** (see [Jobs and sessions](#jobs-and-sessions)).

### Secrets

A secret is something kept from some characters, or known only to some. You mark it in a lore entry's own text:

```
{{// Secret: The lighthouse keeper is the smuggler.}}
{{// Secret (known to Ada Lorne): The key is under the third step.}}
{{// Secret (kept from you): Tobin has already sold the boat.}}
```

Lumiverse strips every mark from a prompt by itself. In a chat that plays a world, RPE puts each one back into the prompt, marked as a secret with who holds it, unless what the prompt is cut to leaves it out: **Narrator's knowledge** (`secrets.narrator.knowledge`: `scene`, everyone in the scene, or `pov`, your character only) and **Narrator's secrets** (`secrets.narrator.secrets`: `marked`, or `omit`, left out). A secret your character has come to hold goes in as theirs. When RPE cannot read the chat's state, every secret stays out.

A character holds a secret once the story gives it to them (told, found out, shown) and an agent records it with `perceive`. **Track who knows what** (`secrets.tracked`) and **How sure a holding must be** (`secrets.threshold`) decide when a holding counts. Build has tools to mark secrets in your books and to move an older build's secrecy into marks (see [Secrecy in your World Info](#secrecy-in-your-world-info)).

### Who may write what

Each lane's writes go ahead, wait for your word, or are left out, by the **Write permission** settings: **the story lane** (`permissions.story`), **the engine lane** (`permissions.engine`), and **tools that reach outside RPE** (`permissions.external`: the web, a command, an MCP server). Each is `auto` (go ahead) as shipped; `confirm` makes each write wait for your word; `never` leaves it out.

A write that waits shows under its turn's reply with **Go ahead** and **No**, and on the turn's page under **The review card**: each change by lane, told in words (what changed, who made it and how sure it is, what it reported, what **Undo it** does and what it would leave as it is), with **The record as written** closed under it for whoever is finding a fault, and **Questions asked on it** with **Let it go ahead** and **Do not**.

## Lore

RPE uses your lore; it does not replace it. Lore comes from two places: **your books** in Lumiverse (every book the chat reads, or the ones **Books the lore reads**, `lore.books`, names), and **the world's own lore**, the entries the world's document holds, which Build writes and **Save to lore…** adds to. An id says which an entry is (`e-112` a book entry, `w-31` a world entry). Lumiverse still puts your activated entries into the prompt as it always does.

**The lore map.** At the start of every turn, the Author's briefing maps the lore: each entry activated in the prompt, with what it is and what it defines; entries the story has since moved past, with the note; the world's own entries whose keys match the recent chat; and, up to 12 (**Lore map, bound entries**, `lore.index.bound`), entries bound to who and what is on the horizon that did not activate. Every line gives the entry's size in tokens. The agents read any entry in full, and search every book the chat reads and the world's lore, when they need more.

**The activated lore, turn against turn.** RPE compares what each turn's prompt holds of your lore with the turn before it. The lore map says of each entry in the prompt whether it is new this turn, changed, or as last turn, and what the Author did with it then; and it lists what last turn's prompt held that this one does not. The first call of a turn holds every entry in full, as Lumiverse sent it. Once the Author has written its intent it keeps the entries the reply needs and may let the others go: each stands as one line that says what it is and how large, and comes back whole the moment the Author asks. What it let go is not sent again with every later call of the turn. **The Author's choice of lore stands** (`lore.choiceStands`, off as shipped) carries that choice into the next turn: an entry the Author let go, whose text has not changed since, starts the turn as its line; a new or changed entry always starts whole. Each entry's text is kept once for the scene, in a file of the session's cache folder, and written again only when it changes. `ACTIVATED-LORE.md`, beside those files, lists every entry the scene's prompts have held: its size, how it activated, how it stands, what the Author did with it and the file of its text. A turn's own `active-wi-content.md` holds the lore map and one line for each entry that names that file; it no longer repeats every entry's text each turn. On the Turn page, **What the Author was given** shows the same of each entry of that turn.

**The index.** The **Lore** page shows your books and the world's lore as RPE understands them: the index, a page at a time and searchable, each entry with its book, its kind, a line saying what it is, what it defines and the records it is bound to. An entry no indexing run has read yet shows its title and keys. The lines come from an indexing job: **Index now** starts one, on the connection the indexer's definition names (its `model:` is `default`, your default connection, unless you name another); the Author starts one when its briefing says entries are not indexed; and an entry whose lines were written for an earlier revision is marked **out of date**, with **Index again**. A job does not read your whole library in one window: when it starts, the entries not yet indexed are cut into numbered batches of up to 20 entries (**Lore indexing, entries per call**, `lore.index.entriesPerCall`, and **Lore indexing, characters per call**), kept with the job, and the job's agent hands each batch to an instance of itself, so no batch's text rides on the next and no entry is indexed twice. You can set an entry's kind, its line and its related entries yourself; each is yours from then on, over any run's, with a way back to the run's.

**Where the story moved past an entry.** When a turn leaves an entry behind (the inn it describes has burned), the Author writes an **overlay**: a note tied to that turn, which the lore map gives from then on. The entry itself is not touched. The Lore page lists each overlay on the chat's path with its turn.

**Proposals.** RPE never writes your books by itself. When something the story made belongs in your books, an agent drafts the entry or the edit and offers it (the skill `lore-proposals`). **Proposals waiting on you** shows each one with the passage as it stands beside what would replace it: **Approve**, **Approve with my edits** (its book, title, keys and text are yours to change first) or **Reject**. **What RPE wrote to your lore** lists every write it made, newest first, each with **Put it back**, after a question that says what that does. A write checks that the entry is as it was read, and keeps a copy of what it was.

**This chat's projection book.** Off as shipped. Switched on (**Projection book**, `lore.projection`, for this chat), RPE keeps a book of the chat's own, attached to it, that carries what the story changed and made into Lumiverse's own activation: notes on your entries, the people it brought in, the canon it set down. It is rewritten after scenes and when the chat's path changes, and a branch gets its own. **Apply now** makes or rewrites it at once, or takes it away when it is off. Your own books are never touched.

## The prompt and its map

Lumiverse builds the prompt from your preset, the character, your persona, the lore and the history, as it does for any chat, and the Author reads all of it. The **prompt map** is what lets an agent name a part of it ("the persona", "the style rules", "that lore entry") and get exactly that text, or hand it to another agent.

- A **part** (a *slice*) is one named piece of the prompt, and its **marker** is its name, which stays the same from turn to turn. Each part has a **kind**: `instructions`, `style`, `character`, `persona`, `world`, `note`, `lore`, `history` or `other`. An agent's definition can ask for parts by kind (`prompt:kind(style)`), so it works on any preset.
- The map belongs to the **preset**: learned once, by the mapper (an agent the Author starts as a job when its briefing says the prompt has no map yet, or its shape changed), kept with the preset and used by every chat on it. `PRESET.md` tells the mapper how to cut it, and which parts suit which agent. Until a map is learned, the parts are named by Lumiverse's own blocks and by place.
- History is addressed by message and lore by entry, so neither needs learning.

**The Prompt page** shows how the chat's preset is cut: every part in order, with its marker, kind, line, how it behaves (fixed, changing with the scene, or every turn) and how it was found in the turn's prompt; its text behind the spoiler gate; and the text no part claims. Your five edits, from each part's own controls: **Rename**, **Kind**, **Correct its line**, **Merge with another** and **Split**, each kept with **Keep this edit**. They are kept with the preset, for every chat on it, and survive a new mapping. **Map again** starts the mapper afresh, as a job you can watch on Live.

Turn by turn, the page lists what changed in the prompt's shape (a fixed part whose text changed, a part gone, text no part claims, parts out of order, another preset), and how much of the prompt's front stayed the same and which part broke it. The Author is told the same in its briefing. Nothing is held back for it: as shipped, `PRESET.md` tells the Author to carry on with the whole prompt.

The page also says when the preset still holds the previous build's engine blocks ("RPE does not edit presets: take these out of the preset in Lumiverse"), and when Lumiverse's own clipping cut the prompt inside RPE's window.

**What each agent is given** of the prompt is a line in its definition (`given:`). As shipped, the Author is given the whole prompt; the GM, the lore in it; a character, its style parts; the narrator, the prompt exactly as Lumiverse sent it. A turn's page shows **What the Author was given**, the prompt by part with its lore, behind the gate. A definition may also name **purposes** (`purposes:`, one list of names for each): a start that says what it is for (`for`, on `delegate`, `job_start` and the job you start by hand) is handed that purpose's list in place of the whole of `given:`, and may leave names out of it (`leave`). A start that names no purpose, or one the definition does not have, is handed `given:` as before. The turn's page says what each agent was given, and for which purpose.

## Files, agents, rules and skills

Everything that decides how RPE's agents behave is written in plain files: how a turn is run, who writes the reply, when a reminder is owed, what a tool is said to do. To change what the agents do, change a file; the next turn reads it. [How behaviour lives in files](behaviour.md) says what each file does, with four worked examples.

**The four levels.** The files are under `files/` in RPE's data folder, at four levels, from far to near:

| Level | Folder | What it is |
|---|---|---|
| Shipped | `files/defaults/` | Every file RPE ships. Read-only, and laid out again at every start. |
| Yours | `files/` | Your own files, for every chat. |
| A character's | `files/chats/<character>-<id>/` | Your files for every chat with one character or group. |
| A chat's | `files/chats/<character>-<id>/<chat>-<id>/` | Your files for one chat, with its config file `RPE.yml`. |

A file at a nearer level replaces the file of the same name at a farther one (only `AGENTS.md` adds up, the character's and the chat's both). A shipped file can be switched off without replacing it. When an update changes a shipped file you replaced, your file is kept, and the Files page says the default changed.

**The kinds of file.** Instruction files (`TURN.md`, `SWIPE.md`, `WRITING.md`, `WORLD.md`, `SIMULATION.md`, `PRESET.md`, `ALL-AGENTS.md`, and an `AGENTS.md` of yours); **agent definitions** (`.agents/`); **rules** (`.rules/`); **skills** (`.skills/`, each a folder with a `SKILL.md`); **tool descriptions** (`.tools/`); and **prompt parts** (`.prompts/`), which lay out what the agents are given and word what RPE answers you, the play views' refusals among them.

### The Files page

**Files** shows the agents' files as a folder, level by level (**This chat's top** and up), a folder and a page at a time, with a search across every level by name and by text. Each file says what RPE does with it: in force, switched off (and which lists name it), replaced by a nearer one, held out and why, an example, or read by no agent.

- Open a file and edit it: **Save it as** yours at a level. A shipped file is edited as yours. **Delete it**, on a file of yours in place of a shipped one, puts the shipped one back. **Switch off** and **Switch on** a file, for this chat or every chat. **Compare with the default**, and with each change an update made to it.
- **New** makes a file of any kind at a level that holds it, blank or from the shipped file of its name, or a folder; and renames, moves or copies one of yours.
- **Pin it for** an agent: a pinned file is handed to that agent whole at the start of each of its runs.
- A prompt part shows, as you type, what it renders to with the values of its last use in the chat.
- **The agents' suggestions.** The agents read your files and never write them. When an agent thinks one should change, it files a suggestion: what it would change and why. **Accept**, **Edit, then accept**, or **Dismiss**.
- **An agent's stack**: every part an agent is given, in order, each with its file. **Apply now** starts the open session's opening block afresh, so a change to an agent's tools or what it is given holds at once; otherwise it holds from the next session.

The agents keep their own notes in the chat's `persistent-workspace/` folder, and their working files in the turn's folder; a job, which has no turn, keeps its working files in its session's `scratch/` folder, where the pieces of a job split among instances share their notes. Notes follow the turn: a swipe or a deleted turn takes back that turn's notes.

### The Agents page

**Agents** lists every agent definition in force for the open chat, or as a new chat takes them with none open, each with what it runs on. One opened shows **What it runs on** (the connection, model and effort it will really run with, or why no connection resolves for it; where its model has no level as high as the effort set, the level it is sent: "It is set to think at max; its model has no level so high, so it is sent high"), its effort, limits and sampling as settings (for every chat or this chat, with what its header says beside each and a way back to it), **Its tools** (with how many tokens their descriptions take against **Size of an agent's tool list**, marked where it is over: nothing is refused), **What it reads** (its stack, part by part), and **What it is given**: each name with what provides it and, for RPE's own views, its size in tokens in the open chat now, then, where its header names purposes, each purpose with the list a start for it is handed and that list's size. What RPH finds itself (files, messages, lore, the prompt) is measured at the run. **Change it** edits its header as fields (its model from your connections, its tools, what it reads, what it is given) and its text: **Save as mine** at a level, reset a shipped one to its default, or **Make a copy** as a new agent. **Open its file on Files** goes to its file.

The shipped agents and their efforts are in [How RPE works](#how-rpe-works) and [Models and connections](#models-and-connections). Which agent leads a chat's turns is **The Author** (`turn.lead`).

### The Rules page

A **rule** is a file with a header and a text. **Always on**, its text is part of the instructions of the agents its header names. **Triggered**, it costs nothing until its condition holds: a moment of the turn, a fact drawn from the records, a pattern in what the agent writes, a yes-or-no question a small model answers, or a count of turns; then its text is put in front of the agent.

**Rules** lists every rule of the chat's stack, in force or not and why, whom it is for and what triggers it in words, with the examples marked as examples. One opened can be edited and saved as yours at a level, reset, deleted, switched off or on for this chat or every chat, or, for an example, copied into force; **Try it on a turn already played** runs it as its file stands against a past turn, writing nothing. **Facts a trigger can use** lists each fact with its value for the open chat (`todo.open > 0`). **What fired** is the log: which rule, in which run, on what, and what the agent did next (behind the gate).

**Hooks**, on the same page, are commands of yours that run at a moment of a turn: each with its moment, its command and its timeout, whether it runs and why not.

### Skills

A skill is a folder in `.skills/` with a `SKILL.md`: a name, a description and a body. An agent that holds `skill_load` is shown the list of skills in force, each by its name and description, and loads a skill's body when it needs it. The shipped skills include `time`, `places-and-maps`, `combat`, `economy`, `quests`, `casting`, `sandbox`, `scene-end`, `chapter-pass`, `bootstrap` and `lore-proposals`. Write one of your own, or replace or switch off a shipped one, as any file.

### What runs a command or calls out

The agents have no shell of their own. What runs a command or calls out is only a hook, a command a rule runs, a command tool, an HTTP tool or an MCP server that you wrote or added, or a connection's key at a new address. Each is listed as waiting until you switch it on, from the server's own command line:

```sh
rpe allow <name>
rpe deny <name>
```

No page can switch one on: the Rules page, and the Settings page under **Server and service**, show each thing, whether it waits, is on or is off, and what it runs or calls, with the line to run; the Files page shows what waits in the file you have open. A thing whose command or address changes waits again. See [What RPE never does by itself](security.md#what-rpe-never-does-by-itself).

A rule whose command waits does not fire. Where it matched in a run, the run's trace (on Live, and on the turn's page under **The run, step by step**) says so: "Your rule … matched, but its command waits for you to allow it, so it did not run and the rule did not fire. To allow it, type on the server: rpe allow …", with its command.

## Models and connections

RPE calls your model providers itself, on connections you add to it. Lumiverse's own connections are not used for this; Lumiverse reaches RPE through RPE's connection, "RPE", which offers the model `rpe`.

### The Connections page

**Connections** lists RPE's model connections, with **Add a connection**, and on each **Change**, **Remove**, **Make it the default** and **Test it**. A connection has a **Name**, a **Provider**, **How its calls are signed** (a key, a sign-in with the provider, or none for one on your own machine), a **Model**, a **Thinking effort**, and, where you need them, another **Address** (a compatible server's, or a proxy's), how many times a failed call **Tries again**, and its model's **Context window** and longest reply in place of the figures RPE would use. Each model shows its limits and where each comes from, and whether it takes audio and video. A key is typed once and never shown again: the page says only whether one is set. A connection that signs in has **Finish signing in** and **Sign out**. `rpe connection add` does the same from the server ([Model connections](install.md#model-connections)).

**Check the tags.** A reply and the Author's intent record are marked with tags as shipped (**Reply form**, `reply.form`: `tags`). Some models do not keep to them; such a connection takes the `two-step` form. **Check the tags** plays a number of simple turns on a connection and gives it the tag form only if enough come back in their tags; **Use tags** and **Use two steps** set it yourself ([more](install.md#a-model-that-does-not-keep-to-the-replys-tags)).

**Web search.** Where an agent's `web_search` goes: the provider's **Address**, and a key where it wants one. With no address it is off.

A connection moved to another server holds its key back until you allow its new address on the server (`rpe allow <connection>`; see [What runs a command or calls out](#what-runs-a-command-or-calls-out)).

### Which model an agent runs on

Each agent definition's `model:` names a connection, or `default`: your default connection. The shipped agents all say `default`; name another of your connections in a definition to run that agent on it (the indexer's file says it is meant for a smaller model). The Agents page shows, for each agent, the connection, model and effort it will really run with.

**Effort** is how hard a model thinks, from `off` to `max`; a level a model does not have is sent as the nearest it has. The Agents page shows the level set and, where it differs, the level sent ("max (sent high)"), and a run's trace shows both at each agent's start. As shipped, the Author thinks at `max`, the GM at `high`, a character and the narrator at `medium`, the keeper and the indexer at `low`. An agent's **Effort** setting (`agents.<definition>.effort`), set on the Agents page for every chat or for one, stands over its definition; a connection's own effort (`connections.<connection>.effort`) stands over the definitions on it.

### Limits

**No limit cuts an agent's work short by default.** Calls, tool rounds, tokens and time have no default limit, for an agent, a turn or a job, and the next turn waits for the previous turn's run to end. Each is a setting you can set:

- for one agent (**Effort and limits, for each agent**: `agents.<definition>.limits.calls`, `.toolRounds`, `.tokensIn`, `.tokensOut`, `.seconds` and the rest), on the Agents page;
- for a whole turn (**Limits on a turn's work**: `limits.turn.calls`, `limits.turn.tokensIn`, `limits.turn.seconds` and the rest);
- for a day, across turns and jobs (**Tokens in a day**, `limits.day.tokens`);
- for the wait on the turn before (**Wait for the previous run**, `limits.previousRunSeconds`).

One guard is on as shipped: the same tool call with the same arguments **10** times in a row, with nothing written between, ends that agent's work (**Same call in a row**, `limits.repeats`). How deep sub-agents may go (`limits.turn.depth`, 2) and how many work at once (`limits.turn.agentsAtOnce`, 3) are set too. A turn that reaches a limit you set ends with a line that says which ("The turn reached its limit of …").

An agent's sampling (temperature, top P and the rest) is the provider's own unless you set it per agent; the Author's samples as its own model does unless **The lead's sampling** (`reply.leadSampling`) says the preset's.

### What is spent

- The HUD's **This turn**: the newest turn's calls, seconds, tokens and lore lookups.
- **Live**: what each run has spent as it goes.
- **Turns**: each turn's calls and tokens, what they weigh, and the jobs it started; and on its page **Tokens**, **Tokens by agent** and **Where the tokens went**.
- **Usage**: where the tokens went over the turns played last, or over the last days, for the chat open or for every chat: in all, by agent, by what the calls were for, by part of the request, by chat and by day, each set against the span before it, so that what grew and what shrank shows.
- **Sessions** and **Jobs**: the calls a run made against the limit that applies to it, and each agent's window as a gauge, how near compaction it is.
- **Runtime**: where the time goes across the latest turns.

Every figure is tokens, as the provider counted them. Beside them stands one **weighted** figure: a token sent fresh counts 1, and one read from the provider's cache, one written to it and one the model wrote count by a weight. The weights are settings (`usage.weights.cacheRead`, `cacheWrite`, `cacheWriteLong` for a call that asked the cache's long lifetime, and `output`), shipped as the terms of one provider; other providers' terms differ, so each can be set for one connection too (**For each connection** on the Settings page). The figure is worked out as a page reads it: a weight you change shows at once, for everything kept. It is never money.

RPE keeps a row for each model call as it ends, for good unless **Rows of model calls kept** (`usage.rowsKeptDays`) says a number of days. What was played before it kept them can be read in from the turns' own traces with **Read them in** on the Usage page; a call read in from an older trace carries its totals alone, without its parts.

## Jobs and sessions

### Jobs

A **job** is work that need not finish before your next message: summarizing a stretch of the past, mapping the prompt, indexing lore, what happened meanwhile in the wider world. The Author starts one when its turn can leave the work for later; you start one from a page (**Index now**, **Map again**, a bootstrap, Build's model jobs) or by hand. A job runs as an agent of its own, beside the chat, and what it records is placed before the next turn that begins after it ends. The next briefing tells the Author what a finished job changed.

**Jobs** lists every job of every chat, or of the open chat (**This chat's**, **Every chat's**), newest started first, filtered by **Where it stands**. Each shows its agent and what it was asked, who started it and when, what it spent, the limit it ended at, who ended it where someone did ("You cancelled it.", the agent that cancelled it with its run, or RPE and why: "RPE ended it: the turn that started it left the chat's path.", "RPE found it cut off by a restart. You can resume it."), and its report. One opened shows its work step by step, as Live draws a run (behind the spoiler gate), with its calls against its limit and each agent's window, and **What it wrote**. By where it stands: **Cancel**, **Start again**, **Pause** and **Resume**, **Hold** and **Let it go**, **Carry it on with more** at a limit, and **A word to its lead**, which it gets at its next call as yours. A job that asks you a question waits for your answer there.

- **Start a job** by hand: **The agent that does it**, **What it is started for** where its definition names purposes, **What it is to do**, **What it is given**, and limits of its own, which hold only where tighter than the limits of every job. Under the agent stands **What it would be handed**: each name of its list, with its size here now. It starts at once, or waits for the jobs running to end. An opened job says what it was started for.
- **All jobs**: switch jobs off (no job starts, by an agent's call or from a page; those waiting keep waiting), or hold them (those running stop at their agent's next call, and none starts, until you let them go). Beside them, **Limits on jobs**, each with what it is held against: the jobs running now, the jobs started in the last 24 hours "of the … you allow", the tokens used in the last 24 hours.
- As shipped, two jobs run at once across your chats (**Jobs at once**, `jobs.atOnce`); a job's run has no limit of calls, tokens or time unless you set one (`jobs.run.calls`, `jobs.run.seconds` and the rest); and a job's record is kept 90 days (`jobs.keepDays`).

### Bootstrap: a chat with a past

A chat that comes to RPE with a long past, new to RPE or carried from the previous build, has no story record for it yet. Your past is in Lumiverse, and the agents can read it at any time; the briefing says which range is neither in the prompt nor covered by the record. **Bootstrap** is a job the Author leads, with the skill `bootstrap`, to go over the chat's past and fill in its records, nearest stretch first. Nothing starts one but you.

The **Story** page (and **Jobs**, for any chat) shows how far the record stands, as six facts with their counts: **The lore index**, **The history the window leaves out**, **The cast**, **The story model**, **The horizon**, and **Each principal's base and memories**. Whether that is enough is the job's to judge. **Start a bootstrap job** starts one, with how much to relive (the words the skill offers) and its own token limit. At that limit (**Bootstrap asks before**, `bootstrap.askAtTokens`, 200,000 tokens) the job is held and asks you: **Go on**, with how many more tokens before it asks again, or **End with what it has**. The **Migration** page offers a start for every chat the migration carried.

### Sessions

A **session** is the Author's working memory between turns. Each scene of the story is a session. **Sessions** lists them, newest first, open or closed, with what closed it and when (you, a turn's scene change, RPE, the end of its run or the end of its job), and the sessions of the sub-agents, jobs and talks it ran beneath the turn that started them.

A session opened shows **What its next turn carries**, in each of the three ways a session can carry its earlier turns:

- **Continuing**: what the Author did in its earlier turns, as it did it;
- **Records**: the Author's own record of each earlier turn;
- **Nothing**: only the summary the scene opened with.

Which one the chats use is **Context carried in a session** (`sessions.carry`, **Continuing** as shipped). The page's **What carrying costs and buys** shows the latest measurement of the three, when one has been run, and **Make a mode the default for** **Every chat** or **This chat**: nothing changes it by itself.

**Compaction.** When a call would not fit its model's window less the room kept for the answer (`compaction.reserveTokens`), a session's earlier turns are summarized, keeping the newest three whole (`compaction.keepTurns`); as shipped, the Author is first given the chance to save what matters (the rule `save-before-compaction`). **Its compactions** lists each, with **Undo the summary**, after a question that says what that costs. **Compact now** asks for one at the next turn; where there is nothing to fold yet (its earlier turns are already under a summary, or no more than those kept whole), it says **Nothing to compact yet**, with its turns. **Close this scene** closes the session, and **Reopen it** opens it again. **Its turns** lists the turns that ran in it, each with its transcript behind the spoiler gate.

## Authoring

You build worlds on the **Build** page, in the drawer and in the web app. What a world is, and how a chat comes to play one, is in [world.md](world.md). For the formulas you write in requirements, checks and rules see [EXPRESSIONS.md](EXPRESSIONS.md); for every kind, field, effect, function and lint code the packs offer, the [reference](REFERENCE.md); for small worlds to copy from, [RECIPES.md](RECIPES.md).

### Your worlds

Build opens on your worlds: each with its name and how many revisions it has, and a **This chat** badge on the world the open chat plays. Its **More for** *name* button (⋯) holds **Export** and **Delete**. Delete asks first, and names the chats that play the world: their stories stay as played.

**New world** asks what to **Start from**: **Blank**, or one of the starter worlds (**Fantasy town**, **Mystery manor**, **Modern slice-of-life**), each with a line on what it is. Give it a name and press **Create world**. **Import a file** brings in an `lre-world-v1` file, as Export writes it. Worlds you had in the previous build are carried into Build by the migration ([migration.md](migration.md)).

An open world shows its parts (**World**, **Calendar**, **Realism defaults**, **Tiers**, **Time limits**, **Ruleset**, **Lore lookup table**, **Routines and the story**, **Needs**), then its collections in groups: **People & things** (People, Organizations, Things, Money, Kinds, Classifications, Relations), **Places** (Places, Maps, Routes, Grids), **Daily life** (Routines, Schedules), **Rules** (Actions, Checks, Rules), **Story** (Tracks, Lore), **Engine** (Data tables, Packs) and **Advanced** (All entities). Then its **Tools**, its **Revisions** and its **Chats**. When the open chat plays no world, **Attach to this chat** gives it this one, after a question.

**Time limits** is how far one look-ahead through time may go (**People-days**, **Changes**): where an agent asks what a stretch of time will bring, and Check world's day, stop. A part whose world file still holds fields RPE does not use names them once at its foot, in a closed line, **Kept in the file, not used by this build**, and saving the part leaves them as they are: under Time limits, the previous build's minutes a turn takes by kind of scene, what stops a time skip, Speed through and the montage; under World, a re-run's rolls and the people and places a reply may make; under Routines and the story, the levels of the previous build's closeness ladder above Background, how a model planned a time skip, and what the narrator read of routines; under Ruleset, inferred checks (how a typed attempt was read as a check). A person's or a place's page names the lore pinned to it the same way. The previous build's **Minds** (its ladder, focus weights and what each person knew from the start), **Pinned lore**, **Sections** and **Step templates** are not offered at all: the file keeps them, and nothing in RPE reads them.

Each item opens on a page of its own. **New** asks for a name and makes the id from it. **Save to draft** and **Revert** sit at the bottom; the **Item actions** button (⋯) holds **Delete**, which asks first.

### The draft, Problems and Commit

You edit a world as a **draft**. The bar at the top says **Uncommitted** while the draft has changes, or **All committed**, with its error and warning counts. Press **Uncommitted** to see your draft set against the world's last revision, part by part: how many things were added, changed and removed. **Draft actions** (⋯) holds **Discard changes**.

**Problems** checks the whole draft and lists what is wrong in plain words, each marked **Error**, **Warning** or **Info**, with where it is by name and **Open** to go there. RPE checks a world as you edit, too, and each page shows its own problems.

**Commit** makes the draft a new revision, with a **Note** of one line on what changed, kept with the revision (`worlds.noteChars`, 200 characters). Errors keep a draft from being committed. A chat plays the revision it is at until you move it on (below).

### Revisions

**Revisions**, on a world's page, lists its revisions newest first: when, how it came (**Committed in Build**, **Committed by an outside agent**, **Imported from a file**), its note, how many things it changed, and the chats that play it. Open one to see what changed, set against **The revision before it**, the **Latest**, or **An earlier revision**. **Put this revision in the draft** brings an earlier revision back, to commit again.

### Upgrade

A world's **Chats** lists each chat that plays it, with the revision it plays. A chat marked **Behind** plays an older revision than the world's latest: press it to see what **Upgrade to revision** … brings, person by person and thing by thing, as **New**, **Changed** or **Gone**.

- Each change shows the chat's value and the revision's. One **Unchanged in play** is set to **Take**; one **Changed in play** (by a turn or your own edit) is set to **Keep**. Flip any of them. Someone the revision no longer has stays in the chat unless you pick **Remove**. **Take all unchanged** puts the untouched ones back to Take.
- A change that would give a secret away reads as hidden until you press **Show spoilers**; its pick still applies.
- **Upgrade with these picks** moves the chat; its next turn plays the new revision, and a turn running now keeps the one it started with. Rules, schedules and tables come with the revision. **Undo the move** takes it back whole.

### Routines in Build

**Build → Routines** lists the world's routines by whom they are for: **Someone's own**, **A group's**, **A kind's**, **By selector** and **Everyone's**. Where several set the same block for someone, the most specific wins. A routine can say **No routine** for whom it covers, or turn off a broader routine's block (**Turned off here**).

**Routines and the story**, a part of the world, sets **Everyone's routine** (**Informative**, **Enforced**, the default, or **Off**), how everyone spends a stretch of time that is run through, whether a Timelapse follows your routine by default, **Story and lore awareness** (how firmly an enforced routine holds against what the story and its lore establish), whom **Routine blocks may invite**, **How social people are**, and **How plans bend routine** (which plans may move work or school). Whatever it says, the story comes first for anyone in a scene with your character.

Each **block** says what it reads as, what they are doing, when (**At a set time**, **Within a window**, or **Optional**), how long, where, with whom, on which days, and what it rests on: **Written here**, **From lore** (an entry and its words) or **From a sheet** (a field). **Schedules** are commitments with set hours (shifts, school, opening hours, weather, prices), drawn as slots on a bar across the day. In play, routines and schedules are defaults the agents read, never a script ([Routines and schedules](#routines-and-schedules)). **Propose routines from lore** (below) drafts them from what the world already says.

### Checks, pools, progression and sheets

**Build → Ruleset** holds the world's rules of play: **Start from a profile…** (ready-made rulesets, Modern, Classic, Fifth and Custom, applied to the draft after a preview of what they add and what they would replace), **How checks are decided**, **Level floors**, **Progression**, the **Sheet Designer** (what **Play → Me** shows of your character) and **Combat**. A **check** is dice and outcome bands, with a difficulty, advantage and an opposed roll if you want them; a **pool** is a number field kept between 0 and a maximum (hit points); a **progression** raises a level from XP. The formulas are in [EXPRESSIONS.md](EXPRESSIONS.md).

In play the GM rules by them: it reads a sheet before it rules, says what each outcome will do, rolls once with `roll`, and applies the outcome (the skill `ruleset-and-sheets`). When the dice are rolled at all is [How checks are decided](#how-checks-are-decided). As shipped the GM starts with the ruleset by its index (`ruleset:index`: each part with how many entries it holds and its size) and reads a part, or one entry of it, with the tool `ruleset_read`; a definition of your own that lists `ruleset` is still handed all of it. Of the scene it starts with the messages the Author's own prompt holds (`chat:history[scene-window]`) and a digest of what lies before them (`story:scene-digest`: the scene before by its recorded summary, and this scene's earlier beats); `chat:history[scene]` still names every message of the scene. Started for the map or for a moment's perceptions (`for: map`, `for: perceptions`), it is handed what that work needs alone; the Agents page shows each list with its size.

Under the tabletop rules, a feat, a race, a condition, a size, a weapon or a piece of armour is a row of its table in **Data tables**, and what it does to the numbers is its **modifiers**. A row's modifiers open as a form, a card for each: **What it changes**, offered from what this world's totals and the rules' procedures ask for (any other word is taken, and changes nothing until a total names it), its **Value** (a number, or a formula with `self`), its **Bonus type**, offered from the types the world's rules name, **When it counts** (a formula), and a **Note**. **Add a modifier** adds one; the bin takes one away. What cannot work is said under its field. A table's other cells are typed as they always are, and Build still makes no new table and adds no column.

### Combat and encounters

Only a world whose ruleset has **Combat** has fights: initiative, the action economy, the hit-point pool, when someone is down, the sides and when a fight is over. Combat actions are actions with a cost; an attack's check reads the target's defence.

In play the GM runs a fight with the skill `combat`: who is in it, where each stands on the map, what each has to hand, then a round at a time. Your character acts from your message; each principal's own agent chooses what they do; the GM chooses for everyone else, and records each round with `fight_round`, which moves the clock by the rounds it records. A fight ends when a side is down, has fled or has yielded, or when the story interrupts.

On the Play page, the **Encounter** on Now opens **The fight**: the same card in full, with each combat action you can take now against each target, with its odds. Pressing one waits for your next message, as **End turn** does. **This round** lists each act; one taken by the tabletop rules says the roll, the total and where each number came from, the defence it met and the harm it did.

### Lore in Build

**Build → Lore** holds the world's own lore: entries with a title, text, aliases, topics, keywords and links to people and places, each with where it came from and whether it is secret. The **Lore lookup table** leads terms and topics to entries. **Lore books** names the World Info books the world reads (**Add a book**). **World Info entries** opens an entry of one of your books: **Make this entry secret**, **Add a secret line**, **Change names** for whom a line is **Known to** and kept from. These write into the entry's own text in your book, at once. How the agents use lore is [Lore](#lore).

#### Secrecy in your World Info

A secret in your World Info is a line in the entry's own text: `{{// Secret: …}}` (kept from everyone), `{{// Secret (known to Marcus): …}}` or `{{// Secret (kept from Jordan Ellis): …}}`. Lumiverse leaves such a line out of every prompt by itself. The previous build kept a secret instead with fields of its own on the entry, switched off in its book. **Secrecy in your World Info**, a tool in the Lore list, moves a book to secret lines, one book at a time and only when you press:

1. **Look at what moves**: what would **Become secret marks**, what is **Marked already**, and what **Can't become a mark**, with why. Looking writes nothing.
2. **Apply to this book**: RPE keeps a copy of every entry it changes, then writes the marks.
3. **Check, then confirm**: play a turn or two, then **It reads right: take the old fields off**.

**Restore secrecy as it was…** puts the book back as it stood before its move, after a question that names what you changed or deleted since.

### Build's model jobs

The **Tools** of a world include five jobs that call a model: **Import from lore** (entities, places and facts from your books), **Index this text** (lore entries from text you paste), **Build / Refine with AI** (describe a change), **Describe a map** (a place's inside in your words, drawn as a map) and **Propose routines from lore** (routines and schedules, each citing the entry or sheet field it rests on). Each runs as an agent that proposes and holds no tool that writes ([how they are worded](behaviour.md#agent-definitions)). You review the proposals, tick the ones you want, and **Apply** … **to the draft**. Nothing reaches a chat until you commit, and a chat already playing the world until you upgrade it. A job keeps its last run, with **Run again with new input** and **Dismiss**. Their limits are on the **Settings** page under **Build** (`build.jobs.atOnce`, `build.import.maxBooks` and the rest).

### Playtest and Check world

Two more tools play the world's latest revision with the engine alone, on RPE's worker threads, without touching any chat and without a model:

- **Playtest** runs typed turns you give it (up to 50, `build.playtest.maxTurns`) and shows the **Transcript** and the **Issues found**.
- **Check world** simulates days (3 unless you say, at most 14: `build.check.days`, `build.check.maxDays`) and reports **Day by day** what happened, with what was dropped, what failed and what leaked, and each day's slowest processes.

Neither is a turn of RPE: no agent plays in them.

## Settings, storage and the runtime

### The Settings page

**Settings** holds every setting RPE and its harness read, found by what it does: in sections of plain words, chosen from a row of them (a column beside the settings on a wide page), with **Find a setting** over every name and what it does, and **Changed** to show only the ones you changed. Each setting shows what it does, the control that fits it, its unit, the advice its value passes, what was shipped with the way back to it, and where it is set. A switch or a choice is written at once; a typed value waits for **Save** (or Enter). RPE takes or refuses a value in its own words.

With a chat open, **Where a change goes** chooses **For every chat** or **For this chat only**. Your changes for every chat are kept in `files/RPE-global.yml`; a chat's own in its `RPE.yml`. The settings set for one connection or one agent at a time are a table, a row for each: press a cell to change it. **Server and service** lists what the server's own command line sets (`rpe up`, `rpe lumiverse`) and [anything that runs a command or calls out](#what-runs-a-command-or-calls-out): no page can change those. Every setting, its default and what it does is in [settings.md](settings.md).

**On this device** holds what this browser keeps for itself, not in RPE's settings and not on your other devices: **Show ids**, which shows each id beside its name in Build (people, places, things, kinds, tables and the rest), for when a rule, a formula or a line of lore names one by its id. Play shows names only.

### The Storage page

**Storage** shows what RPE keeps and how much, on disk and in its database:

- **What RPE keeps**: each kind, with how many, how big, the oldest, how long it is kept ("kept as" the setting that decides it says, which opens on Settings; "kept until its chat is deleted or you prune it"; or "RPE never removes it") and when you last pruned it;
- **Chat by chat**: each chat's folder by area and its rows of the database, with its notes; a chat Lumiverse deleted says so, with **Prune what is left of it**;
- **The notes agents lean on**, each opening on the Files page;
- **Backups and copies of the database**, with **Make a backup now**.

Nothing is pruned by a press alone: **Prune old turn folders**, **Prune closed sessions' files**, and, on a chat's line, **Prune note versions past what is kept** and **Prune decided suggestions past what is kept** first say exactly what would go and what stays, and take exactly that on **Yes, prune exactly that**. **Make a backup now** first says what it would make (one archive in the backups folder, with the database and the files of the tree, and their size), and makes it on **Yes, make it**: the same archive as `rpe backup`.

### The Runtime page

**Runtime** shows how RPE runs, and which build:

- **How RPE runs**: as a service or started by hand, since when, the addresses it listens on, and the build; **Memory it holds** (now, the most since it started, and the worker threads running) and, under a service, **Against its service's limit**. **Restart** waits for the turns and jobs running, and says so; once RPE answers again, the page says **RPE is back** on its build, with how long the restart took. What only the server's command line can do is listed with the line to run there (`rpe up --memory`, `rpe up --systemd`). A worker thread with nothing to do ends after a while (`workers.idleSeconds`) and lets its memory go.
- **Builds**: the build RPE runs, the app file on disk and what the extension says it is; the newest update stage by stage; and **Update now**, which takes a new build that has passed its checks, or says there is none, or why the last one was refused. How an update arrives is in [install.md](install.md#updating). In the web app, what this browser signs in with: its session and when it ends, and the web key.
- **RPE's log**: its newest lines first, a page at a time, narrowed by level, area, chat, turn and job. The Jobs and Turns pages link to the lines of one job or one turn. Its first line says why this run started: its first start here, the restart you asked for, an update from an earlier build, a stop, or that the last run failed or ended without saying why (killed, out of memory, or the machine stopped). A refused sign-in, with the address it came from, and a connection's test that failed are logged too.
- **Where the time goes**: for **This chat** or **Every chat**, each part of a turn over the latest turns, with its middle time, the slowest and the latest. It reports; it decides nothing.

### The Migration page

**Migration** moves you from the previous build: **A rehearsal** that reads its data and writes nothing, **The last real run** with its report, **The backup**, what is **Waiting on you**, **The switch** and **Going back**. Its steps are in [migration.md](migration.md).

Where a real run could not carry a chat that holds records of the previous build (that build's own reader or fold failed on it, RPE's store refused what it gave, or the check could not be made), RPE keeps the cause in the chat's own record of why, in its data folder and readable by your account alone, until a run carries the chat. The page says so at its top while the record is kept: each such chat by its name, its character's and its id, in one sentence made from its record (the stage, the message it stood at, the error's own words and the record's file), what of it RPE holds and what it does not, and the lines to run once the cause is mended, one of them carrying that chat alone (`rpe migrate` with `--chat <chat id>`); **The record of why** under the chat opens the record. Once a run carries the chat, the page says when. `rpe migrate` and `rpe up` say the same ahead of their report and again last, and end with exit code 1; they also say how many of the previous build's files they could not read, and where each is kept with its error ([A chat it could not carry](migration.md#2-the-real-run)).

## What is not in this build

Two things come with a later build:

- **The `lumirpengine` command line and MCP server**, through which your own agent (Claude Code, Codex, Cursor…) or your shell manages your worlds. Until then a command that reads or changes worlds and chats says that it returns with a later build, and you edit worlds in **Build**. [MCP.md](MCP.md), [RECIPES.md](RECIPES.md) and [AGENT-GUIDE.md](AGENT-GUIDE.md) describe it and the world format it works on.
- **Talk, the GM assistant chat.** The assistant's definition ships, and nothing starts it yet. The GM assistant threads you had in the previous build are kept in the migration's backup.

## When something is wrong

[troubleshooting.md](troubleshooting.md) goes through what can go wrong and what to do: [chats on RPE's connection that are not played](troubleshooting.md#chats-on-rpes-connection-are-not-being-played), [a reply that fails before RPE plays it](troubleshooting.md#a-reply-fails-before-rpe-plays-it), [a turn that waits](troubleshooting.md#a-turn-waits-before-it-starts) or [ends without a reply](troubleshooting.md#a-turn-ends-without-a-reply), [a panel on the Play page that refuses](troubleshooting.md#a-panel-on-the-play-page-refuses), [a view that will not load](troubleshooting.md#a-view-will-not-load), and [what to look at after an update](troubleshooting.md#after-an-update).

To see what happened in a turn, open it on [the Turns page](#the-turns-page); to watch one as it runs, **Live**. RPE's own log, narrowed to a chat, a turn or a job, is on [the Runtime page](#the-runtime-page).

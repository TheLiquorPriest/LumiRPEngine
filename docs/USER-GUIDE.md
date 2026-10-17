# LumiRPEngine user guide

This guide is for two kinds of people: players, who want to chat in a world that remembers, and authors, who build those worlds. If you only want to play, read the first part and dip into the rest when you need it. If you are installing for the first time, start with the [README](../README.md).

- [How it works in one page](#how-it-works-in-one-page)
- **Playing:** [Play](#play) · [Swipes, edits and branches](#swipes-edits-and-branches) · [Time controls](#time-controls) · [Realism](#realism)
- **Tuning:** [Model use](#model-use) · [Extraction modes](#extraction-modes) · [The Context inspector](#the-context-inspector)
- **Building:** [Authoring](#authoring)
- [Troubleshooting](#troubleshooting)

## How it works in one page

A **world** is a description of a place and the things in it: people, belongings, money, vehicles, locations, schedules, rules and quests. You attach a world to a chat, and the chat becomes a **world chat**. Everything the engine knows about the story so far is kept in two places: the world itself, and a small **record** saved on every AI reply that says what happened during that turn.

Every turn goes the same way:

1. **You act.** You type, tap an action in the palette, tap the map, or tap a chip.
2. **The engine plans.** Before the AI writes, the engine works out how much time passes, settles your action (its requirements, its dice check if it has one, its effects, how long it takes), and steps the world forward: NPCs go about their day, bills fall due, fuel burns. None of this needs the AI.
3. **The engine writes the facts.** It writes the established facts as short lines in the world's own sections (Outcome, Scene, People and so on), which go into the prompt.
4. **The narrator writes.** The AI writes the reply, with the outcome already decided. Its instructions are to use the facts' numbers and not invent prices, balances, quantities, fuel or times.
5. **The engine reads the reply.** It looks for changes the story implies (someone bought a coffee, moved to the kitchen, learned a public fact), checks each one against its limits, applies or asks about it, runs the people who are off screen, and saves the turn's record.

The AI proposes; the engine decides. Because the decisions and the numbers belong to the engine, they stay consistent however many times you swipe, edit or branch.

Where things live: the world's definition lives in LumiRPEngine's own storage, and your lore stays in your World Books, which work as usual: LumiRPEngine doesn't manage World Info for now. The world adds one lore book of its own, named "LumiRPEngine · *your world*", which holds only the sections the engine fills in each turn. Records live on the replies themselves, so they follow swipes, branches, exports and deletions, and a backup journal in extension storage restores them if something overwrites them.

## Play

### The drawer: the Play tab

Open the **LumiRPEngine** tab in the Lumiverse drawer. A switch at the top moves between **Play**, **Build** and **Settings**. **Play** has a panel for each part of the world. Panels follow your [realism](#realism) levels: a domain that is switched off has nothing to show, and a domain at a low level shows less. A dot on a panel's tab means it has detail waiting.

If the chat isn't a world chat, Play says **Not a world chat** and offers **Attach a world to this chat…**: pick a world from the list, tap **Attach** and confirm with **Attach world**. **Open Build** takes you to the editors. A chat keeps the world it started with: attaching the same world again only re-attaches its lore book, and attaching a different one is refused with "This chat already plays another world. Start a new chat for this one."

| Panel | What it shows |
|---|---|
| **Scene** | Where you are, the time, the weather and your cash, who is here, what is going on, and the scene type. It has **Actions**, **Timelapse** and **Map** buttons. |
| **Map** | The map, inside the drawer. See [The map](#the-map). |
| **You** | Your character sheet: conditions, stats, skills and derived values, as numbers or as words, depending on the level. |
| **Money** | Your wealth: a band at the lowest level, then net worth, balances, accounts, cards, what is coming due and recent postings, in the world's own currency. In a new chat it shows the balances the world gives you to start with, and the status pill's cash matches; opening the panel puts those amounts on your books, so the figures don't change when it does (during a reply they go on when the reply finishes). |
| **Garage** | A card for each vehicle: fuel, location, odometer or engine hours, condition, who has it on loan (with *overdue*), and upcoming service. |
| **Gear** | What you have, sorted into **Owned**, **Worn**, **Carried** (the one that opens first) and **Stored**, with container capacity, kits (what's complete and what's missing, like "kit 3/5 · missing …") and what you have lent out, "lent to … until …" (shown under **Owned**, without your equip slot, since it is with the borrower). A container whose contents haven't been listed yet offers **Look inside**, which opens it (and, once shown, what's in it stays). |
| **Cast** | The people in the story: who is here, what they are doing, a 24-hour timeline of where they will be, their agendas and how they feel about you (each axis as a word and a number). **Why this plan?** under a person's timeline gives the reasons for each block: a fixed commitment, the need pressing them ("hungry (hunger 62)"), a close call ("close call, Maddie chose"), or "a close friend". |
| **Calendar** | The date, the clock, holidays and what is coming up. This is also where you pause the clock, start a Timelapse and change **this chat's time controls**. |
| **Quests** | Quests, puzzles, secrets and agendas, sorted into **Active**, **Done** and **Failed**, with stages, cues and objectives (n of m). **Show a hint** gives one at a time. Only what you know is shown. |
| **Journal** | A running list of what changed, including the full list behind every Montage, plus notes about things the engine dropped or expired. It lists what was applied: a change you undid, or one a later switch dropped, isn't shown as made. A group of changes dropped together (a purchase and its payment) is one note, worded like its Keep report row, with "(2 linked changes)" when the group has more than one change. A turn's entry lists the same lines as its change chip, at most 8; when more exist, money, quest and signal lines are kept and routine ones (activities, other people's moves, needs) go first. Filter by **All**, **Notes & montages** or **Not applied**. |
| **Context** | The [Context inspector](#the-context-inspector). |
| **GM view** | Everything, including secrets, labelled as previews. See [The GM view](#the-gm-view). |

What you can see is always filtered to what your point-of-view character knows. Facts are public, known by particular characters, or secret, and a secret stays out of every panel, chip, choice and Journal line until the story reveals it.

### The status pill

A small pill floats over the chat. You can drag it, and it remembers where you left it (the phone and the desktop remember it separately, and when the window crosses between phone and desktop width, the pill moves to that layout's place straight away; until you move it, it stays centred as its content changes). It shows the time (with **⏸** when the clock is paused, and the time scale as ×n when it isn't 1), your place, the weather and your cash. On screens narrower than 760 px it collapses to the time and a **▾**. A **⋯** mark means a turn is running, and **Paused** means the chat is waiting on an edit.

Tap the pill for the world's details: the time and day part, your place, the scene (and the last turn), the weather and your cash, then **This turn** (calls, seconds and tokens: the [call meter](#the-call-meter)), the clock button (**Pause clock** or **Resume clock**), and the **Map** and **Actions** buttons.

Tap the **✎** next to a value to correct it: your place, the weather, your cash or the scene type. A correction like this is a **fix**. It is saved with the reply like anything else, so it survives swipes and branches in the same way, and the pill and the details show the corrected value at once.

- **Weather** has a ✎ from Weather level 2, where the sky is simulated; you pick one of the climate's states (Clear, Overcast, Rain and so on) for the region you're in. The weather still follows its climate, so your correction holds only until the climate next changes the sky. During a scripted spell of weather, the corrected sky holds until the spell ends.
- **Scene type** lists the world's scene types. Your pick holds until an action, a rule or another fix sets the scene type, even when you move. **Place default** goes back to the scene type of wherever you are.
- **Cash** amounts are typed in the world's own money: "5" is 5 bits in Brindlemere, 5d in Harrowmere and $5.00 in Port Alder, with as many decimals as the currency has. When your cash is held in cash accounts (your wallet), a cash fix doesn't overwrite a number: it moves the difference between your wallet and an outside **Correction** account, so the Money panel shows it as a correction and the books still balance. In a new chat whose accounts aren't on your books yet, the fix puts them on first, so the difference is measured from the cash you start with. Undo and swipes treat it like any other fix.

### Chips

Chips are the small buttons and notes under a reply. They tell you what the engine did, and give you a chance to change it.

| Chip | What it does |
|---|---|
| **The change** (for example "Moved to the kitchen", or "3 changes") | What the engine applied, worded for you: "Danny Okafor → you: warmth +2, trust +1", "Transfer: $200.00 from checking to savings". With several changes it says how many, and the list opens on tap. A change you undid (Undo, or **Not an action?**), or one an earlier switch dropped, isn't listed as made. A **+n min** chip beside it shows the elapsed time. |
| **Roll** | For an action with a dice check: the action and its outcome, the dice, the modifier and the total, and the exact odds ("Rolled 1d20 + 2 = 14. Odds: …"). |
| **Apply** / **No** | The engine read a change in the story (see [Extraction modes](#extraction-modes)) that would apply, and asks "The narration says this happened. Apply it?" If you ignore it, it expires when you send your next message, and the Journal notes that. A change that couldn't apply at all (an item that doesn't exist, no price) never gets an Apply button; if the engine would have made it on its own, a **Didn't apply** chip says so. A reply that tells your own action again gets no second chip: when the turn lent something to someone, the reply handing that thing (or something inside it, like a lent truck's glovebox) to the same person is the loan itself, and when the turn bought something, the reply telling the purchase again (even in slightly different words, like "brass lantern" for "old brass lantern") is that purchase. Keys handed over with a lend do get their own chip, and so does a different thing bought or given in the same reply. |
| **Undo** | Reverses an automatic change ("Applied automatically."). Undo covers the latest reply; for anything earlier, use Keep or Discard (see below). An automatic purchase's chip shows what it charged and the catalog item it was priced as ("Bought milk: $3.63 (priced as Milk, whole)"); when the narrated price was capped or clamped it says so and has **Edit amount**, which charges what you type instead. |
| **Also bought (item)?** | The reply told a purchase like the one you just made, and the engine can't tell whether it's the same one told again or another one (another colour, a price far from yours, "another" in the prose). **Apply** charges it as a second purchase; **No** drops it. A reply that only tells your purchase again gets no chip at all. |
| **Bought (item): no price** | The reply told a purchase that nothing prices: the catalog doesn't list it and the reply gave no price. **Set price** charges the amount you type, **Pick item** prices it as a catalog item you choose (when the catalog has any close to it), and **Dismiss** drops it. |
| **Couldn't read your action** | The helper that reads typed text as an action failed twice (a dropped connection or a provider error; the engine asks once more on its own before giving up), so your text was played as plain roleplay. **Retry** re-runs the turn and reads it again. |
| **Not an action?** | The engine read your typed text as an action and you didn't mean it. **Not an action** undoes it, and a Re-run treats the text as plain roleplay. It lapses at your next message. |
| **Action: couldn't** / **Action: declined** | An action you chose could not run (a requirement wasn't met, for example **Pay** without enough money), or ran but part of it was refused. The chip says why, and nothing changes. |
| **Buy: declined** | A palette **Buy** or **Pay** ran but the payment was declined; the chip gives the reason. See [Prices and purchases](#prices-and-purchases). |
| **Couldn't pay for (item)** / **Declined: (change)** / **Didn't apply: (change)** | The narration claimed a purchase or payment your money can't cover (**Pay another way**, **Remove it** or **Accept**), or a change the engine would have made on its own couldn't apply (no amount, an unknown item): **Didn't apply** says nothing changed, and **Remove it** or **Accept** only reword the note the next reply is given. See [Prices and purchases](#prices-and-purchases). |
| **The reply contradicts the facts** | After the reply, the contradiction check found something that goes against an engine fact (a price, a balance, where someone is), and the chip says which. **Re-narrate** writes the reply again with the same outcome; **It's fine** dismisses it. Either way the next turn is told the correction. Needs the *Contradiction check* step (Full, or Custom). |
| **Suggested choices** | Up to three next moves for you, each its own chip; **Send** sends one as your message. They lapse at your next message. Needs the *Suggested choices* step (Custom). |
| **Retry** | The reply came back empty. The turn is marked *degraded*, and nothing is regenerated until you tap Retry. |
| **Retry read** | The reply was stopped part-way ("The reply stopped early; read what was saved."). **Retry read** has the engine read everything saved by then, a Continue made afterwards included, and replaces what was read in the meantime, so no change or charge lands twice. Once the reply is read, the chip goes. |
| **Swipe as…** | **Re-narrate** keeps this turn's outcome and writes new prose; **Re-run** plays the turn again with a fresh roll. See [Swipes, edits and branches](#swipes-edits-and-branches). |
| **Re-read edit** | You edited a reply, or a Continue was accepted without being read ("The engine kept the world as simulated. Re-read this text to update it."). This re-reads the text so the world matches it, replacing the earlier read: a change you had applied from its chips is undone and offered again, so nothing is charged twice. |
| **Not fully simulated** | Part of the turn ran on the engine alone. There is no button; the turn is marked *degraded*. |
| **Keep report (n)** | You changed something earlier in the chat and later turns were re-checked. **Review** lists what was dropped, with a **Convert** button for each row. A dropped purchase is one row, its payment first with "(2 linked changes)", and **Convert** converts the whole group. It also lists entries "made on another branch". |
| **Edited message: keep or discard later turns?** | You edited an earlier message of yours. **Keep** re-checks the later turns; **Discard** removes them. |
| **Overdue: (thing)** | A loan has run out ("Danny Okafor still has it; the loan ran out."). If you lent it, **Take it back**; if you borrowed it, **Give it back**. A loan also ends, and is no longer overdue, as soon as the thing is back with its owner (handed back, taken back) or is given to a new owner; passed on to someone else, it stays lent. |
| **Timelapse to 07:00 (8 h 55 min)?** | After an activity that takes a long time (a shift, a night's sleep), a chip offers a Timelapse to its end, with the weekday when it is another day: tap **Timelapse**. See [Speed through](#speed-through-and-timelapse-offers). |
| **Timelapse 3 d?** | You asked in your own words to let more than a day pass. Tap **Timelapse** to run it. |
| **Timelapse stopped: an invitation** | An interrupt ended a Timelapse early; the chip says why (an invitation, a bill, a declined payment, an incident, a quest event, a world rule, someone arriving, an overdue loan, a need, a weather alert) and **Continue** carries on to the original target. The narrator is told the span that actually ran. |
| **Continue timelapse (n left)** | A long Timelapse was cut at the safety cap; **Continue** carries on from there, with the time left. |
| **Timelapse didn't run** | A Timelapse could not finish and was not applied at all. **Retry** sends the same request again. |
| **The narration skipped ahead — run it as a timelapse?** | The reply jumped ahead further than a turn can cover. **Run timelapse** runs the interval so the world catches up. |
| **Mode change** | A type of change is now applied automatically (or went back to asking) because of how you've been answering. It has an **Undo** button. See [Learning on your own model](#learning-on-your-own-model). |
| **pending** | Not a chip but a mark: detail you opened, or changes you made, while a reply was still streaming. They land right after the reply finishes. |

Chips that start a turn (the Timelapse ones) work like palette actions, and they lapse when you send your next message.

### The action palette

The palette opens as a sheet from the input bar's **World actions…** button, or from the **Actions** buttons on the Scene panel and in the status pill's details. It lists the actions that are possible right now, each with its targets, its minutes and price, and, for actions with a dice check, the **exact odds** of every outcome as a bar. You see the odds before you commit, and they are the real ones: the roll that follows uses exactly those faces. An option that isn't possible says why in plain words ("Not possible here and now" when a requirement isn't met). Before your first turn in a chat, options are judged at your own realism settings, so an option offered isn't declined when the turn runs.

- **Actions**: whatever the world offers here: move, go to, take, drop, wear, use, wait, rest, sleep, examine, lose something (the cash in a lost wallet goes with it), and the world's own. **Go to** lists the places you can see, nearest first (a route away, or a place inside or around where you are). **Attempt** lists one option per stat on your sheet, each with its odds. **Take** from a kit asks for the kit, then a piece still in it, with how many are left ("Socket, 3/8 in drive (8 left)"). **Accept invitation** lists only the people who invited you.
- **Buy**: what is sold where you are, one priced option for each offer, at the world's price for that place.
- **Pay**, **Transfer**, **Lend**: money and belongings between you and others. A money option asks for an **Amount** in the world's currency (the box shows its symbol or unit, and its limits), with only as many decimals as the currency has. **Lend** asks for the item, then the person, and has a number box for the days (in typed text you can say an end instead; see [Typed text](#typed-text)).
- **Drive**: pick a vehicle you can use, then the destination.
- **Timelapse**: duration chips, *until* targets and interrupt overrides. See [Timelapse](#timelapse).

Actions that need a second pick show a second list under the first; choosing again at any step replaces that pick and the ones after it. Only the tabs that have entries appear. The header holds **Pause clock** / **Resume clock** and a close button; the button at the foot of the sheet names your choice (for example "Drive: *vehicle* → *destination*"). Picking something adds a message to the chat with the action attached, and triggers the reply. The engine settles it first, then the narrator describes a result that is already decided.

The input bar has four buttons for the world: **World actions…**, **Timelapse…**, **Pause clock** / **Resume clock** and **World map**. They work only in a world chat.

### Typed text

You don't have to use the palette. When what you type looks like an action (a risky verb, handing something over, travel, quantities, money, a place, losing something, letting time pass), the engine asks a small helper call to read it as an action and fills in the details. The action still has to satisfy its requirements, and a name that matches nothing in the world makes it plain roleplay instead of an action that would only fail. If it got it wrong, tap **Not an action?**: that undoes it, and a Re-run treats the text as plain roleplay. Text that doesn't look like an action is just roleplay and costs nothing.

Typed text can also let time pass. Phrases like "wait until", "sleep until", "next morning", "skip ahead", "skip to", "pass the time", "sleep through", "wait for" (or "hours later", "days later") make the engine read a request to let time pass: a number of minutes, or *until* a part of the day, your next shift, or your next commitment. Up to 24 hours it runs as the turn's own Timelapse, with your interrupt policy and a Montage. A longer wait is never run unasked: a **Timelapse 3 d?** chip offers it, and **Timelapse** runs it. The narration can still skip ahead on its own, as described in [When the story jumps ahead](#when-the-story-jumps-ahead).

Some details can be said in your own words. A loan ends when you say it does: "I lend Danny my truck until 7 tonight", "for 3 hours", "until Friday", "tomorrow morning". A said end wins over the days. Words that name no time fall back to the days you gave, and a lend with neither is declined ("… names no time; say how many days or until when"). A piece of a kit can be named by its words in any order ("the metric combination wrench"): filler words and plurals don't count, at least half the words must match, and a lone number doesn't.

### Prices and purchases

When the story has you buy something, the engine prices it from the world's catalog, or from the item's category band with a little seeded variance. A purchase described in your own words ("a round of beers", "a large pepperoni pizza for delivery") is priced from a catalog row only when the row names it: whole words (plurals count), the item's main noun among them, preferring the row that holds most of its words and then what the place sells. A "desk lamp" is not a desk, a "coffee machine" is not a coffee, and "lantern oil" is not vegetable oil (a row that is another kind of the thing doesn't name it); with no row that fits, the stated price is used, then the category. Brindlemere and Harrowmere price their categories in their own money (bits and pence). For something the catalog doesn't list you can state the price yourself, and the engine uses it. In worlds set to *lenient* pricing, a price the narrator states is accepted if it falls inside the band, and clamped (with a chip) if it falls outside. A price the narration gives for something the catalog doesn't list is capped at the world's **narrated-price cap** (by default the top price of its dearest catalog item or category, or 500 of its currency without either), and the chip says so ("narrated $12,000.00, capped at $6,000.00"). To set it, open **Build → Packs → economy**: the **Narrated-price cap** field takes it in the currency's minor units (cents, bits, pennies), shows the default it uses when left empty, and Problems warns about a cap that isn't a whole number above zero. Two things bought are two purchases: when the reply bundles your own purchase with something else ("a coffee and a bran muffin"), your part is dropped and the rest is priced on its own.

**How you pay.** A purchase can say how it is paid, whether you pick Buy or write it: "with my credit card" pays on a card; "my debit card", "checking" or "from the bank" pays from checking; "from savings" pays from savings; "in cash" or "from my wallet" pays from your wallet. A card you don't have falls back to checking, and any other missing account falls back to the way the engine would pay anyway. The same holds for a purchase the narration describes: "paid with my debit card" charges checking, and if the reply names something someone owns as the payer (a debit card in the wallet), its owner pays the way its name says. A named source pays only when it is the payer's own cash, checking, savings or card account; a loan or brokerage account named as the source is ignored and the usual way is used. When you type a Buy and the reading of your line leaves the way of paying out, your own words fill it, but only when you say it as a payment: after "with", "on", "using", "by", "from" or "in" ("pay with my credit card", "in cash", "from savings"). A mention you rule out ("not with cash") is skipped and the last mention counts, so "not with cash, with my debit card" pays by debit card, and "I buy a credit card holder for $12" is something you buy, not how you pay.

**Money handed over.** When the reply has someone hand over money ("Danny hands me $20 for gas", "a twenty", "a $20 bill"), the engine moves that amount from their money to yours and never turns cash into an item. Cash handed over goes into the wallet of the person who gets it (or their checking, if they carry no cash), and comes out of the giver's wallet when it holds enough, otherwise the way they'd usually pay. Only an item that is money as a whole counts: "my $300 jacket" or "a $20 gift card" is a thing with a price, handed over as a thing. A payment in the story is between people, or between someone's own cash, checking, savings or card accounts ("I move $100 from checking to savings" moves it; nothing is lost or made up). A payment to or from a thing, a loan or an investment account doesn't happen. If a change like that, or any other the engine would have applied by itself, can't apply (for example, there is no amount), a **Didn't apply** chip says so instead of letting it vanish, and the next reply is told, in the chip's own words with names as written, that it didn't happen.

**When you can't pay.** From Money level 2 up, a payment the account can't cover is declined: nothing changes hands and no item is created. If you chose **Buy** or **Pay** in the palette, the action still runs, the narrator is told "it didn't go through (… doesn't have $X available)" and to narrate it failing, and the reply shows a **Buy: declined** chip with the reason (no buttons; it lapses at your next message). If an action's own requirement fails (**Pay** requires that you can afford it), you get **Pay: couldn't** instead. If the narration claims a purchase your money can't cover, the engine checks it after the reply, declines it and shows **Couldn't pay for** the item, with three choices:

- **Pay another way** retries from savings, then card, checking and cash, and applies the first that covers it. If none does, a notice says "No other way to pay covers it." and the chip stays.
- **Remove it** tells the next reply that the item was narrated but never happened, and to leave it out.
- **Accept**, which is also what ignoring the chip does, tells the next reply that the payment was declined and that you don't have the item.

That note goes only to the next turn and its swipes. It is saved with the chat, so it still reaches that turn if the server or the extension restarts in between. At Money level 1 nothing is declined: payments overdraw, and the books track it in bands.

### The map

Open the map from the **World map** button in the input bar, **🗺 Map** in the status pill's details or on the Scene panel, or the **Map** tab in Play. It opens as a floating widget (480 px wide, resizable, with ⤢ for fullscreen and ✕ to close); the phone and the desktop remember its size and position separately. Drag to pan, scroll or pinch to zoom, and use **+**, **−** and **Fit**. Tap a place to see how to get there: each travel option shows its mode (walk, road, off-road or water), time, vehicle and cost, or why it isn't available ("No route from here."); choose one and the move or drive is sent and the map closes. The map shows places you know, with the routes between them, and a grid with terrain if the world has one. Place names never overlap: a name sits beside its dot, or further out on a short line, on two lines, or shortened (the full name shows in the place's card when you tap it); on a crowded map a name may be left off, and its dot stays tappable. On a phone (a screen up to 600 px wide, or any touch screen), opening the map closes the drawer first and goes fullscreen; if the drawer can't close, the map opens in **Play → Map** instead.

### The GM view

The **GM view** shows everything the engine knows, including secrets and truths you haven't discovered, as **previews**. It sits behind a spoiler gate ("Spoilers ahead"): tap **Show GM view** to open it, and **Hide** to put it away. It is labelled "Previews — not recorded" because it is exactly that: the GM view, the inspector, audits, Dry Run and playtests never write anything to your chat. Its cards cover the secret truths, the agendas, everyone's money and the previews. Each person's preview lists how they feel right now about everyone they have a feeling for, other NPCs included ("regard → Jess Kowalczyk: 55"; decayed with time at Relationships level 4), so you can see what an off-screen encounter did.

Each **Money · *name*** card shows another person's money at their own Money level, as your Money panel shows yours: their wealth band, then from level 2 their net worth and accounts, from level 3 their bills (who each one is paid to), and their latest transactions and notes (paydays, bills paid, anything declined). A person whose accounts haven't been opened yet is shown with the balances the world gives them to start with. None of this reaches your chat: their paydays and bills never appear in your chips, Journal or Montage, and their declines never stop your timelapse.

### Detail on demand

The world doesn't store every coin in every wallet. When you look at something that has no detail yet (open a trunk, check what a character is carrying, audit an account, open a Play panel such as **Money**), the engine generates it then, consistent with what is already known: a character known to be "rich" gets a balance inside the rich band. Once shown, it is recorded and never changes. Previews in the GM view and the inspector are generated from the same seed but are not recorded. If a recorded detail is removed from the story, for example by a branch, it is generated again and labelled **regenerated**, because it may come out differently.

## Swipes, edits and branches

A world chat survives all the ways people mess with a chat. Here is exactly what each one does.

### Re-run and Re-narrate

There are two ways to retry a reply:

- **Re-run** plays the turn again with a **fresh roll**. Your typed text keeps the reading it was given, but the engine draws new dice, so a failed check can succeed. This is the default.
- **Re-narrate** keeps everything the engine decided (the same dice, the same outcome, the same events) and only asks for **new prose**. Use it when you like what happened but not how it was told.

Which one a plain swipe uses is a setting (**Settings → Swipes**: *Re-run (new roll)* or *Re-narrate (same outcome)*). Either way, the **Swipe as…** chip on a reply has **Re-run** and **Re-narrate** buttons for a single swipe. With Re-narrate, anything you fixed by hand (✎) or any detail you opened on the original reply carries over where it still makes sense, and anything that depended on results of the original narration is dropped with a note in the Journal.

### Switching to an earlier swipe

Swipe back to an earlier version of a reply, or delete or add a swipe on an earlier message, and the turns after it are **automatically rebased**: the engine re-checks each of their results against the new situation. Something that no longer makes sense (an item you never bought, a payment under a different balance) is dropped, with a note. A purchase or payment is one unit, so the money and the item are kept or dropped together. Nothing pauses and nothing is erased.

A **Keep report (n)** chip lists what was dropped; tap **Review** to open it. For each entry you can **Convert** it (keep the effect as a fixed correction; it is your own adjustment, so it is kept even if it leaves an account short). It also lists anything that was done on a different branch of the story as "made on another branch", and shows converted entries as "kept".

Everything is reversible: switch back to the original swipe and the world is exactly as it was. Anything you do while you are on a different swipe, such as a fix, a chip confirmation or a new turn, counts only while you stay on that version of the story. A new turn on a rebased path builds on the rebased version.

### Editing the AI's reply

Fixing a typo, a name or a trimmed line is routine, and the world doesn't care. **When you edit an AI reply, the world stays as it was**: nothing pauses and nothing is re-read. If the edit changes what *happened*, tap **Re-read edit** on that reply and the engine re-reads the new text, replacing what it had read from the old one. A change you had already applied from the old read's chips is undone with it and offered again from the new text, if the new text still tells it, so nothing is charged twice. While the chat is paused, or when the message is a switched-away view, the read is refused without calling a model and the chips stay as they were; Keep or Discard, or switch back, first. Keeping is the default.

Re-read edit runs only on a reply that is on its own timeline. If you have swiped away from it (so it's a rebased view), the chip asks you to switch back first.

### Editing an earlier message of yours

If you change what *you* wrote earlier in the chat, every turn after it was built on something that no longer exists, so the chat **pauses**: a **Paused** banner appears in Play, and a chip asks "Edited message: keep or discard later turns?":

- **Keep**: the later turns are re-checked against the edited message, as in the swipe case above, with a Keep report.
- **Discard**: the later turns' records are removed for good. Their messages stay in the chat as plain text, and the world forgets what happened in them. This cannot be restored, not even after a restart.

While the chat is paused, a new turn is written but gets no simulation (it is marked *degraded*), and fixes and confirmations are refused until you choose. If the edit lands while a reply is streaming, that reply is left unread.

### Continue

When you use Lumiverse's Continue on the latest reply, the engine reads only the new text and applies what it says, as one more step of that turn. Some Continues can't be read that way: a Continue on an older message, on a message the engine never simulated (a greeting), one you stopped half-way, or one where Lumiverse re-rendered the earlier text. These are accepted as they are, like an edit. The world stays as it was until you tap **Re-read edit** (or **Retry read** for a stopped Continue). Before the reply starts, a Continue shows the world as it was, because the engine learns which message you're continuing only when the reply ends.

### Undo, retry and what lapses

- **Undo** covers the latest reply. Earlier changes go through Keep or Discard.
- **Apply / No chips** from a reply expire when you send your next message, and the Journal says so.
- **Timelapse chips** (offers, Continue, Retry), **suggested choices** and the **contradiction** chip lapse at the next send as well.
- An empty reply is *degraded* and shows **Retry**. The engine never regenerates on its own.

### Branches

A Lumiverse chat branch carries the world with it. Records that belong to the branch you're on apply; changes made on another branch stay stored but do nothing until you go back. When you delete a reply, the settings changes recorded on it (realism, time controls, Upgrade) move to the nearest earlier reply, and its other-branch changes are dropped with it.

## Time controls

Time is deterministic: nothing here needs the AI.

Every turn has an **elapsed time**. It is one of: the length of a Timelapse, the length of the action you took (a drive, a rest), or the **default tick** of the current scene type multiplied by the **time scale**. The change chips' **+n min** shows it, and the narrator is told it in the Scene section ("This turn took 20 min.", or "No time passes this turn." while the clock is paused).

### Ticks, scale and pause

- **Tick per scene type.** The time a turn takes when nothing else sets it. The defaults are **conversation 2 minutes**, **action 1 minute**, **exploration 10 minutes** and **downtime 30 minutes**. Worlds can add scene types. The scene type is set by actions and by places, or by a ✎ fix.
- **Time scale.** A multiplier on default ticks only, from 0.25× to 10×, default 1×; a tick after scaling is never longer than a day. Action durations, travel times and Timelapses stay exact. When it isn't 1×, the status pill shows it.
- **Clock pause.** While paused for the scene, no time elapses (neither ticks nor action durations) until you resume it or the scene changes. The pill shows **⏸**. A Timelapse asks you to resume first. Pause and resume from the status pill's details, the palette sheet's header, the input bar's **Pause clock** / **Resume clock** button, or **Play → Calendar**.

Where to change them:

- **Settings → Time** fills in, for **new chats**, what a world's own time defaults leave out (always the time scale and the NPC calls); with **Use my settings instead of a world's defaults for new chats** on, it replaces them.
- **Play → Calendar** changes **this chat**.

Both places have the same sections: **Default tick per scene type**, **Time scale**, **Timelapse interrupts**, **Speed through** and **Montage and limits**.

A change in a running chat applies from the next turn forward, is recorded like any other change, and respects swipes and branches. Earlier turns keep their recorded times. Changing Settings later leaves existing chats alone.

### Timelapse

A Timelapse skips ahead while the world keeps living: bills fall due, you commute to work, NPCs go about their days. Open it from the **Timelapse…** button in the input bar (it opens the palette sheet on its **Timelapse** tab), from the **Timelapse** buttons on the Scene panel and **Play → Calendar**, or from a chip. The sheet has a **For** row of duration chips (with a **Custom** length in minutes, hours, days or weeks), an **Until** list, and **Interrupts for this run**.

**Targets** are either a duration (minutes, hours, days, weeks) or *until* something: next morning or another part of the day, your next shift or commitment, arrival (when the current trip ends), a date and time, a quest reaching a stage, or "until something happens".

**Interrupts.** While the time passes, some things should stop it. Each kind has a policy: **stop**, **note** or **ignore**. The kinds are invitations, bills and declines, incidents, quest and rule triggers, NPC arrivals at your place, overdue loans, needs thresholds and weather alerts. The defaults:

| Policy | Kinds |
|---|---|
| **stop** | invitations, declines, incidents, quest triggers, arrivals |
| **note** | bills and paydays, rule triggers, overdue loans |
| **ignore** | needs thresholds and weather alerts |

The first *stop* ends the Timelapse at the end of that time slot. *Notes* go into the Montage. The same world and the same policy always stop in the same place, and you can override the policy for a single Timelapse in the sheet.

**The safety cap.** One Timelapse segment is limited, by default, to **600 agent-days** (the people who are simulated in detail, plus you, times the days) and **5,000 events**; you can lower either but not raise it. A longer request ends at the last whole time slot inside the cap, and a **Continue timelapse** chip carries on from there. Segments add up exactly as if you had done it in one go, as long as nothing else changes the world between them. A Timelapse can reach at most 366 days ahead.

**NPC choices** during a Timelapse use the numbers only; the AI isn't called. A Custom setup can allow some AI choices: **NPC model calls per timelapse (Custom)**, under **Montage and limits**, is how many calls a Timelapse may spend (0 to 50), and it starts at 0. If a Timelapse can't finish in time, it isn't applied at all, because a partial result would depend on the clock. You get a **Timelapse didn't run** chip with **Retry**, which sends the same request again.

### Montage

A Timelapse turn is narrated from a **Montage**: the key events the point-of-view character would know (about people and places you have met; the weather counts when it is your region's), plus totals (money in and out per account at your Money level, distance travelled, changes in how people feel that crossed a band, notable needs). A field that changed several times in one batch, such as an hourly temperature, is listed once at its latest value. The narrator is told to narrate the interval from the Montage and not add events. The Journal keeps the full list, with spans worded in days, hours or minutes. Under **Montage and limits** you can choose the **Montage granularity**: **Key events** (the default), **Per day** or **Per week**; it is shortened to fit the budget.

### Speed through and Timelapse offers

For long activities (sleep, a work shift, travel, waiting), the engine can skip the dull part. When an activity's remaining time is longer than its threshold (**When longer than (min)**, 30 minutes by default), one of two things happens, per activity type (**Settings → Time → Speed through**):

- **Offer a timelapse** (the default): the turn takes only the action's own time, and a chip offers a Timelapse to the end of the activity.
- **Run it**: the turn runs that Timelapse itself, with your interrupt policy and a Montage.

When the narration implies an activity the engine hadn't seen start, you always get the offer chip, because the engine never starts a generation by itself. Activities shorter than the threshold simply elapse. The offer reads "Timelapse to 07:00 (8 h 55 min)?" (with the weekday when it is another day); the **Timelapse** button on it runs the Timelapse. A threshold can be anything from a minute to a week.

### When the story jumps ahead

If the reply says "three days later", the engine can read that as a time jump, but only for time the reply describes *beyond* what the turn already used, and only within a cap. It runs the whole interval so the world catches up, and if the jump is too long or can't finish, it becomes a **Timelapse** chip instead. The time advance has its own mode, see [Extraction modes](#extraction-modes).

## Realism

Realism is how much of life the engine keeps track of. It is set **per domain**, from level 0 (off) to level 4 (simulation), and the story never needs it: quests and secrets work at any setting. Use as much or as little as your story enjoys.

| Domain | 1 Narrative | 2 Simple | 3 Detailed | 4 Simulation |
|---|---|---|---|---|
| **Money** | A wealth band | Cash plus one account | Accounts, cards (with autopay), recurring income and bills | Interest and APR, statements, minimum payments, loans, investments, withholding |
| **Gear** | Notable items | Items, containers, cash in a wallet | Worn and equipped slots, kits, condition | Wear per use, consumables |
| **Vehicles** | "Runs fine" | Fuel %, location, owner | Specs, consumption, odometer, loans, home base | Maintenance intervals, breakdowns, registration and insurance, marine and off-road specifics |
| **Cast life** | Day-part routines, agendas | Commitments set the day | A day planner | Needs and drives, invitations, NPC-to-NPC encounters, knowledge spreading |
| **Relationships** | One band per pair | One number per pair | Several axes plus appraisal rules | Decay, history, faction standing |
| **Space and travel** | Named places | Places, routes and travel times | Grids and positions | Terrain multipliers, mode-specific routes |
| **Calendar and time** | Day parts | Clock and dates | Recurrence and time zones | Holidays, school terms, exceptions |
| **Weather** | Season mood | Climate states | Regional climates | Microclimate effects on travel and rules |
| **Sheets and checks** | Bands as words | Stats plus one check | Skills and derived fields | The full sheet |

The time controls and Timelapse need Calendar at level 1 or higher. At level 1, Timelapse targets round to parts of the day.

### Presets

| Preset | Money | Gear | Vehicles | Cast life | Relationships | Space | Calendar | Weather | Sheets | Band caps (Leads / Supporting / Background) |
|---|---|---|---|---|---|---|---|---|---|---|
| **Story** (the default) | 1 | 1 | 1 | 1 | 1 | 2 | 2 | 1 | 1 | none; every domain level applies to everyone |
| **Grounded** | 2 | 2 | 2 | 2 | 2 | 2 | 3 | 2 | 2 | no cap / no cap / 1 |
| **Simulation** | 4 | 4 | 4 | 4 | 4 | 4 | 4 | 3 | 3 | 4 / 3 / 2 |
| **Custom** | any | any | any | any | any | any | any | any | any | any |

Moving any dial yourself makes the preset *Custom*.

### Tiers and bands

Not everyone needs to be simulated in depth. Every character has a **tier**, one of the world's own (a new world has **Leads**, **Supporting** and **Background**; an author can rename them, add more and reorder them in **Build → Tiers**). Each tier belongs to one of three **bands**, Leads, Supporting or Background, and each band has a cap per domain. A character's **effective level** is the lower of the domain level and its band's cap, unless you set a per-character override (**Level overrides** in the character's editor), which can never go above the domain level. Your own character is never capped. In Simulation, Leads run at level 4 while a Background shopkeeper runs at 2.

A tier can make its people **LOD1 agents by default**, and a world names the tier **new people join** (by default its first Background tier): people the story introduces, and anything spawned without a tier.

People you mark as a **LOD1 agent** in their entity editor get goals and agendas that feed their choices, even on Story. They are consulted by the AI only on close calls or invitations. Everyone else follows schedules and seeded incidents.

### Promote and demote

You can change a domain's level at any time in **Settings → Realism**. A new chat starts from its world's own realism and time defaults, and the **New chats** tab fills in only what a world leaves out; turn on **Use my settings instead of a world's defaults for new chats** (also in **Settings → Time**) if you always want your own levels, say Story everywhere. Its **This chat** tab changes the running chat, for **Everyone** or for just the **Leads**, **Supporting** or **Background** band (it names the world's tiers in that band); before the chat's first turn it shows the levels that turn will use. A single character's level is set on the character in the Build editors (**Level overrides**).

- **Promoting** switches processes on. Anything the character lacks is generated on demand, inside what is already known.
- **Demoting** switches processes off and trims what is shown. The data stays; nothing goes dormant, so promoting again never brings back stale detail. Money is conserved either way.

Before you confirm, a **migration preview** lists what will happen, naming the domain the way the panels do and saying whose level it is: "*Cast life for supporting characters* drops from level 4 to 2: processes above level 2 stop and their inputs freeze; detail stays stored." (❄), "*Money* rises from level 2 to 4: detail is materialized when first shown." (⬆, followed by "People without money detail get it from the pinned tables when you open them."), or "… stays at level 3." It also lists conditions in your world's rules that depend on something that will stop updating. The buttons are **Apply to this chat** and **Cancel** (**Apply** in the new-chat defaults), and a toast confirms ("*Money* is now *Simulation*."). In a running chat the change is recorded like any other and applies from the next turn forward.

### Mixed levels

A character at a low level can still deal with one at a high level: each side records at its own level, and the low-level side's money is represented by an *external economy* account, so the books always balance.

### Other people's money

From Money level 3, the people in the world live on their money as you do. They are paid, they pay their bills, and every Monday they pay a week of living costs that follows their wealth band (a world can set its own amounts; the Modern US data prices them from a weekly grocery basket), so their balances go down as well as up. A bill paid to someone in the world, like your rent to your landlord, lands in that person's own account. The first morning their bills run, the engine opens their accounts with the balances the world gives them. You see all of this only in the [GM view](#the-gm-view).

## Model use

LumiRPEngine does most of its work without the AI. When it does ask a model, it uses small, focused calls, each with its own job. **Model use** presets set which steps may call a model, when, and how many calls a phase may spend.

| Preset | Before the reply | After the reply | Model steps beyond the narrator: most in one turn | Budgets (calls before / after) | Engine budget (sections) |
|---|---|---|---|---|---|
| **Lean** | Reads typed text only when it looks like an action | Reads the reply | 2 (reading your text, reading the reply) | 1 / 1 | 300 tokens |
| **Standard** (the default) | Reads typed text when needed; asks about NPC choices on close calls and invitations | Reads the reply; NPC choices off screen on close calls | 4 (reading your text, two NPC choices, reading the reply) | 2 / 2 | 600 tokens |
| **Full** | Reads typed text, decides NPC choices for everyone present, writes a brief and a prose outline | Reads the reply, decides off-screen NPC choices, checks for contradictions | 8 (adds the brief, the prose outline, the contradiction check, and judging a puzzle answer) | 8 / 4 | 1,000 tokens |
| **Custom** | Any step, any trigger, any connection and model | Same | Depends on the steps you enable; the call meter shows it live | Yours | Yours |

The number is the most a turn can run: each step takes one call from its phase's budget when it starts, so a phase never runs more steps than its budget allows. Most turns cost less, because a step runs only when its trigger fires; the call meter shows each turn's real count. The meter counts every engine model call, not the narrator: a reply that needs a JSON repair, or a Decision call that falls back to the helper, adds one. **Lean** is the floor. It keeps the cost down and leaves NPC choices to the engine's own rules rather than a model. Standard is where a model starts deciding close calls.

### The steps

| Step | When it runs | What it does |
|---|---|---|
| `interpret` (Interpret typed input) | Before the reply | Reads typed text as an action, including a request to let time pass. |
| `npc.choose` (NPC choices) | Before the reply for people who are with you; after the reply for people elsewhere | Picks what an NPC does on a close call or invitation, from a list the engine enumerates (always including "do nothing"). |
| `puzzle.answer` (Puzzle answers) | Before the reply | Judges a free-text puzzle answer, only for puzzles whose author opted in; the answer is a probability against a threshold. It runs unless you turn it off. |
| `brief` (Scene brief), `outline` (Prose outline) | Before the reply, once the engine has planned the turn | Write a short briefing or a prose outline for the narrator. The engine always writes a deterministic outline from its own beats; the brief and the prose outline stack on top of it in the Outline section. |
| `extract` (Extract changes) | After the reply | Reads the reply for changes. See [Extraction modes](#extraction-modes). |
| `contradiction` (Contradiction check) | After the reply | Checks the reply against the established facts. If it finds a clash, a **The reply contradicts the facts** chip appears, and the next turn is told the correction. |
| `choices` (Suggested choices) | After the reply | Offers next-step options as **Suggested choices** chips. |

A step runs when one of its **signals** fires (in **Settings → Steps and connections**, each step lists its signals). `always` fires every turn; `never` turns the step off and wins over the rest. The others:

| Signal | Fires when |
|---|---|
| `typed_input`, `classifier` | The turn's text was typed rather than chosen; the typed-text check thinks it looks like an action. |
| `reply` | A reply exists (after the reply). |
| `scene_change`, `slot_crossed`, `day_start` | You changed place; the turn crossed a part of the day; it crossed midnight. |
| `beat` | The plan has outline beats. |
| `agents_present`, `present`, `offscreen`, `tie_zone` | Agents are with you; a close call is open for someone with you; for someone elsewhere; for the people this phase decides for. |
| `invitation`, `timelapse`, `conflict` | An invitation was made; the turn was a Timelapse; your action failed, was declined or rolled a failing band. |
| `every_n:k` | Every *k*th assistant turn. |

Prose steps (`brief`, `outline`, `choices`) are shown only what your character could see: the facts they get are the player-visible ones, and any line that would give away an unrevealed truth is dropped before the call. A question that carries a secret never shares a call with prose.

### Connections

Each step runs on the **connection and model you choose for it**, in **Settings → Steps and connections**: every step has **Enabled**, a **Provider** (*Decision* or *Helper*), a **Connection**, a **Model**, **Max tokens** (with a warning below 1,500) and its **Signals**. Nothing is cut or simplified because a model is small; the defaults are cautious, and each one is a tap to change.

By default, the helper call (a small JSON-producing call on your chat connection) handles `interpret`, `extract`, `contradiction` and the prose steps, and your **Decision connection** (Lumiverse's Decisions API) handles `npc.choose`. If a decision call fails, the step falls back to the helper, and then to the engine alone. A failed call is never blindly retried, and neither a repair of malformed JSON nor a decision falling back to the helper is charged against a budget. The model and connection you pick for a step are the ones its call uses.

### Budgets, deadlines and fallbacks

Budgets are a **number of calls and a time limit for each phase**: **Before the reply** (reading your text, the NPC choices for people with you, puzzle answers, the brief and the prose outline) and **After the reply** (reading the reply, off-screen NPC choices, the contradiction check, suggested choices). You set them in **Settings → Model use** under *Budgets per phase*, each with **Calls** (0 to 20) and **Wall clock (ms)**, beside the **Engine budget (tokens)** for the sections. Each step takes one call from its phase's budget before it starts; when a budget is spent, or its time is up, each remaining step uses its fallback (**Calls** 0 means no model at all in that phase): number-only NPC choices, the deterministic outline, or plain roleplay plus reading the reply. Steps run by priority, and independent ones run in parallel. Lumiverse's own limits also apply: 120 seconds for the context handler, 10 seconds for the World Info interceptor, 30 seconds per decision call. Simulation itself is never cut off by a clock; it is bounded by counts (days, agents, events).

### The call meter

The call meter shows each turn's calls, seconds and tokens ("This turn: n calls · s s, n tokens") in the status pill's details. **Settings → Model use** has the **Call meter** table with **This turn**, **Average** and **95th pct**. If a preset costs more than you want, this is where you see it. The meter is saved for you, so a restart keeps its numbers.

### Engine tokens versus your context

The engine's sections are a fixed overhead in every prompt. Settings and the world checker compare the engine budget with your connection's context size. If the fixed part is larger than the context, Lumiverse drops the chat history, including your latest message, so keep the budget well inside it; the inspector flags turns where this happened.

## Extraction modes

After the narrator writes, the engine reads the reply for changes the story implies. Each kind of change is a **type**, and each type has a **mode**.

| Mode | What happens |
|---|---|
| **auto** | The change is checked and applied, and an **Undo** chip appears. |
| **confirm** | A chip asks you first, with **Apply** and **No**. If you ignore it, it expires when you send your next message and nothing is applied. |
| **never** | The change is ignored. |

| Type in Settings (as a Mode change chip names it) | What it covers | Starting mode |
|---|---|---|
| **Time passing** (Time skips) · `time_advance` | The story jumps ahead ("three hours later") | auto |
| **Moving somewhere** (Moves) · `location` | Someone moves | auto |
| **Conditions (hurt, tired…)** (Condition changes) · `condition` | A status changes (tired, injured, soaked) | auto |
| **Learning a fact** (New facts) · `knows` | You learn a public fact | confirm |
| **Giving things** (Handovers) · `give` | A handover between two characters | confirm |
| **Purchases** · `purchase` | A narrated purchase, priced from the catalog | confirm |
| **Money transfers** (Payments) · `transfer` | Money moves between people, or between someone's own accounts | confirm |
| **Feelings toward others** (Feelings) · `regard` | Someone's feelings change | confirm |
| **Quantities** · `quantity` | A count changes (ammunition, supplies) | confirm (no starting mode of its own; Settings shows *From the field's bound*) |
| **New people** (New characters) · `spawn` | A new character appears (capped, and duplicates are removed) | confirm |

Beyond the mode, every field has a limit on how much a single change may be, and **the strictest rule always wins**. Fields a world marks as locked are never offered to the model. If a narrated change contradicts the engine's own outcome, the engine's outcome wins. A purchase takes in the seller's handover and the payment, so one sale is not applied three times, and a payer has to be an account.

The strict reading rules are: time jumps only for an explicit jump or stated duration; knowledge only for public facts you newly learn; feelings only when the prose states a change; handovers only between two characters.

### Learning on your own model

The starting modes come from measurements on a small model. Your model may do better or worse, so the engine **learns from how you answer**, on each connection separately, with no extra model calls:

- Each time you confirm or reject a change, or undo an automatic one, that counts. Something applied automatically and not undone by the next turn also counts as accepted. An ignored confirm chip counts nothing.
- When a `confirm` type reaches **90% accepted over its latest 30 outcomes** on a connection, it flips to `auto` there, and a **Mode change** chip tells you ("Purchases now apply automatically") with an **Undo** button.
- When an `auto` type's undo rate in the latest 30 passes **10%**, it flips back to `confirm`, with the same chip ("Purchases need your confirm again").
- **Undo** on either chip restores the previous mode and holds it for another 30 outcomes.

You can pin any type to **Auto**, **Confirm** or **Never** in **Settings → Changes from the reply**; **Unpin · let it learn** hands it back. Each type shows where its mode comes from: *Pinned by you*, *Learned on <connection> (n kept, n rejected)*, *Default* or *From the field's bound*. A pinned type is still counted but never flipped. The order of precedence is: your pinned mode, then what was learned on the turn's connection, then the starting mode, then the field's own bound.

## The Context inspector

The **Context** panel in Play shows what the engine put into the prompt for each generation: the sections it filled in (Outcome, Scene, People and so on) with their sizes and whether each was **delivered**, **not delivered** or **unchecked**. A section that was left out because it went over the section budget shows a **clipped** badge and "left out: over the section budget", and is never shown as delivered. An **Activation** card reads **Activation confirmed**, **Not confirmed** or **Worker stalled: engine sections absent**, with a **Budget used n / m tokens** bar for the section budget; **Older** and **Newer** buttons step through earlier generations; and warnings: the fixed overhead is too large for the context, the prompt had to be clipped, or a damaged journal was replaced (with where the old file is kept). Sizes are the token counts of Lumiverse's tokenizer for each section's exact text, counted for your main model. Until Lumiverse has counted a section, or if that takes more than a second, the engine uses an estimate that stays above the real count.

### Your lore in world chats

LumiRPEngine doesn't manage World Info for now. In a world chat your own lore books work as they do anywhere else in Lumiverse: their entries activate by Lumiverse's own rules (keywords, constant entries, groups, recursion and the World Info budget), and the engine never switches one on or off. The Context panel doesn't list them.

- The engine switches on only the sections it fills in, in the world's own book, and keeps every other entry there switched off, even one you switch on by hand.
- The sections share the section budget in rank order. The Outcome section is never left out.
- World Info recursion follows your own settings, so a section's text can trigger one of your entries, as any other entry's text can.
- If the worker stalls, the world's sections are missing for that turn, and the turn is flagged.
- The world's own lore (Build → Lore) is kept in the world but isn't delivered to the AI yet.

### Delivery verification

Activation isn't delivery: an entry can be switched on and still land somewhere unexpected. The engine works out where each section will land from the World Info and preset settings. Opening the **Context** panel also runs a **test prompt build**, a dry run that sends nothing and saves nothing, to check that the world's sections really appear in the prompt. Outcome, Montage and Outline come only from a real turn's plan, which a dry run doesn't make, so the test build leaves them **unchecked** rather than **not delivered**. Anything else it can't confirm is marked **unverified** and keeps its normal place. Entries placed in positions it can't check (for example, inside a character card) show as unverified.

Anything the engine inserts into the prompt, a name, a price, a number, a model's output, an Import or Refine proposal, has every brace replaced with a look-alike (｛ and ｝), its control characters removed (Lumiverse's macro engine turns some of them back into braces on a later pass) and its `<user>`, `<char>` and `<bot>` shorthands broken with look-alike angle brackets (＜ and ＞), so it can never form a Lumiverse macro, however many times it is processed. The same goes for the labels and the text of the sections and for the messages the engine writes into your chat. Your own authored lore is not changed: it keeps its macros, as it would in a native World Book (see [Import and export](#import-and-export) for reviewing a world someone else made).

## Authoring

You build worlds in the **Build** tab, which is designed to work at phone width as well as on a desktop. It opens on your worlds (each with **Export** and **Delete**), **New world** and **Import an lre-world-v1 file…**. Open a world to get its bar (**‹ Back**, the name, **Commit** and **Discard**), its World card (name, calendar, realism defaults, tiers and time defaults), its **Content** lists (Entities, Places, Routes, Grids, Kinds, Relations, Actions, Checks, Rules, Schedules, Tracks, Lore, Data tables, Sections, Step templates and Packs, each with a count and an issue badge, a search box and **+ New**) and its tools. Edit an item and **Save to draft**, or **Revert**. **Check world**, **Import from lore**, **Build with AI**, **Refine with AI**, **Playtest** and **Attach to this chat** are tools inside a world.

### Editors and lint

Every part of the world has a **schema-driven editor**. Four parts get special tools: a **map and grid** editor, a **schedule and timeline** editor, a **quest graph**, and an **expression** editor for formulas.

What you can define:

- **Kinds**: types of things, with single inheritance and typed fields (number, text, yes/no, choice, reference, list, dice, money, date, duration), each with a default, limits, **bands** (numbers shown as words), **derived** formulas, a lock, a limit on model-proposed changes, and a **visibility**: public, known by particular characters, or secret.
- **Relations**: containment, ownership, use grants ("assigned to", loans, with an end time), worn or equipped, knowledge, membership, regard, routes, and your own, with cardinality and symmetry.
- **Entities**, **places** (with hierarchy and time zones), **routes** with travel modes, and optional **grids** with terrain.
- **Actions**: parameters, requirements, an optional dice **check** with outcome bands (the odds shown to players are computed exactly from it), effects per outcome, a duration, and the activity it starts.
- **Rules**: "when this happens and that is true, do this", with run-once and cooldowns. A cascade stops at eight steps.
- **Tracks**: quests, secrets (revealed by conditions only), puzzles with attempts and a hint ladder, and NPC agendas.
- **Schedules**: calendar recurrence plus tables of fixed values or weighted choices, for shifts, timetables, routines, weather, bills, paydays and price paths.
- **Lore**: what the world knows, as entries with a title, keywords and links (see [Lore books](#lore-books)). It is kept in the world but isn't delivered to the AI yet. Lore holds cue text only; the truth of a secret lives in its track, and lint refuses lore that repeats it.
- The **calendar** (Gregorian or your own) and **realism** defaults, with the band caps under the band labels.
- **Tiers**: the world's own ranks of importance. Each has a label, a band (Leads, Supporting or Background), a place in the order (↑ and ↓), an optional description, and whether its people are LOD1 agents by default; **+ Add tier** makes a new one, and a tier still in use can't be removed. **New people join** picks the tier for people the story introduces (by default the first Background tier). An entity's editor picks its tier from these, and its **LOD1 agent** choice can follow the tier ("As its tier"); lint flags an entity whose tier the world doesn't have.
- **Section templates**: how a section's lines are wrapped when they go into the prompt. A template may use only the engine's `{{lines}}` marker; any other macro, control character or `<user>`-style shorthand in one is a lint error (`section_macro`), because it would run beside the engine's own values.
- **Step templates**: your own wording for a model step, per purpose (interpret, NPC choices, contradiction, puzzle answers, brief, outline, extract, suggested choices), with an output (text, decision, or `effects` for the steps that read changes, which run after the reply only), the signals it runs on (a template's own signals replace the step's), and engine placeholders such as `{{world}}`, `{{pov}}`, `{{place}}`, `{{clock}}`, `{{scene}}`, `{{present}}`, `{{facts}}`, `{{outcome}}`, `{{beats}}`, `{{brief}}`, `{{user}}`, `{{reply}}` and `{{recent}}`. They are all player-visible: a line that would reveal an unrevealed truth is dropped before the call. A template whose output can't be used by its purpose, an unknown signal and an unknown placeholder are lint warnings. Changes a step template proposes with `effects` are checked and bounded exactly like extraction, and money in them is stated as a plain amount in the world's currency (8 for $8), which the engine converts. Which steps run at all is still your choice, in **Settings → Steps and connections**. A world made with an earlier version keeps its step templates, except those for lore selection, which no longer exists.

Formulas use a small, safe expression language: numbers, comparisons and a fixed set of functions. They can't run code and they always produce a finite number. `table(id, key, column)` reads a cell of one of the world's data tables, and `table_step(id, value, column)` reads the row whose number key is the largest at or below `value` (a level table keyed by XP, say). `roll(notation)` works only in an effect's arguments (a value that starts with `=`): the effect's event records the result, so a replay or a swipe sees the same number. Anywhere else a roll would change the odds you were shown and what the engine reads, so it is a lint error and reads as nothing.

### Checks, pools, progression and sheets

These are the pieces a tabletop ruleset is built from. They work the same whatever ruleset you write.

- **Checks.** A check is dice plus outcome bands. A band can test the total (`min`, `max`), the **natural** die (`natural: {min: 20}`: the face of the first die when the dice start with a single kept die, such as `d20` or `2d20kh1`), and the **margin** over a **DC** (`margin: {min: 5}`, the total minus the DC). Natural bands are tried first. A check with a `dc` and no bands has two outcomes: `failure` below the DC and `success` at or above it. **Advantage** is a formula that gives 1, 0 or −1: it adds a die to the natural die and keeps the higher (`d20` becomes `2d20kh1`) or the lower, and advantage and disadvantage cancel a die at a time. An **opposed** check names its opponent with `vs` (by default the action's `target`): the opponent rolls another check (`vs.check`), this check's dice with their own modifier (`vs.modifier`), this same check (neither), or doesn't roll and has a **passive** score that becomes the DC (`vs.passive`). Whatever you write, the palette's odds stay exact and are the real ones; the palette says "with advantage" and the DC beside them. An outcome's effects can read the roll as `roll.natural`, `roll.total`, `roll.modifier`, `roll.dc`, `roll.margin` and `roll.outcome`.
- **Anyone can roll.** The `check` effect (`{check, actor, target?, outcomes}`) lets a rule or another effect have someone else roll, such as a guard noticing you. Their roll never moves yours, and it is recorded for Check world and the GM.
- **Pools.** Give a number field a `pool` (`max`: another field, often a derived one, or a formula) for hit points, mana or stress. Effects keep it between its `min` (0 unless set) and its max, a pool nobody has set yet is full, and the `recover` effect restores it by an amount, by the pool's own `recover` formula, or to the max. A pool is still a field, so undo, swipes and Keep treat it like any other.
- **Progression.** In **Build → World → Ruleset**, a progression names an XP field, a level field and the XP each level needs, from level 1 (usually 0), as a list or a data table's column. Whenever an effect, a quest reward, a narrated change or a ✎ fix raises someone's XP past a threshold, the engine raises their level one level at a time and runs the progression's `onLevel` effects for each, with `level` (the new level) and `from` (the level before the gain); the Journal says "You reached Level 3." for your character. The `award` effect (`{entity, progression, amount}`) adds XP. Levels only go up.
- **The sheet.** The ruleset's `sheet` lays out **Play → You**: sections of rows, each a field, a formula with a label, a pool (shown as a bar of current over max) or a progression (the level, with a bar of XP toward the next level). Without one, You shows the Sheets pack's stats as before.
- **Level floors.** A ruleset's math may need more than the realism settings give: stat modifiers count only from Sheets 3. `minLevels` (for example Sheets 3) raises every character's effective level in that domain to at least the floor, whatever the preset, tier caps or overrides say. Lint notes when the world's realism defaults sit below a floor.

**Lint** runs as you edit and speaks plainly. It catches broken references, wrong types, cycles, unreachable quest stages, sections that are too big, labels that leak secrets, secret truth in the world's lore, a section template that holds a macro other than `{{lines}}`, step templates that could never run, unbalanced postings, double-booked commitments, conditions that depend on something frozen after a demotion, a Timelapse cap smaller than one time slot, and problems with the active preset (see [Troubleshooting](#troubleshooting)).

### Lore books

Each world has its own book, **"LumiRPEngine · *your world*"**, created for you. It holds only the engine's sections: their entries are stored switched off and only the engine turns them on, so a section the engine can't fill never leaks into the prompt. Lore entries an earlier version of LumiRPEngine copied into the book are removed the next time you commit or Upgrade the world, attach it to a chat, or play a turn in one of its chats.

The world's **Lore** list in Build stays in the world: each entry has a title, content, keywords and **links** to the places and people it describes, and can have a **group**, a **priority**, and a **secret** flag with a **gate** formula. LumiRPEngine doesn't deliver it to the AI yet, and it never edits your own lore books. The text of an entry is kept exactly as you wrote it, macros included, as in any World Book; that is why a world from someone else is worth a look before you play it (see [Import and export](#import-and-export)).

Secret truth never lives in a World Book. It stays in the world and enters a section only at the moment it's revealed.

### Import from lore

Already have lore books? **Import from lore**, a tool inside a world, builds a starting world from them:

1. Pick the books.
2. The engine reads them on a background task and turns them into proposals: entities, places, rules and more. When the helper's reply has nothing usable (it comes back empty, isn't valid JSON, lists no proposal the engine can read, or proposes nothing for entries that have text), the engine asks once more with a reminder of the format (Refine with AI does the same, though there an empty answer stands); only if that reply fails too does the job say "The helper proposed nothing (or its reply wasn't valid JSON)." Each call's outcome and time go to your diagnostics log.
3. You review the proposals. Each has a checkbox and a confidence badge (70% or more start ticked), **Select all** and **None** are there, and **Show value** reveals what a proposal would set, its sources named by entry and book (*Lighthouse · B2 Chat Lore*). Under each one, **From lore: *book name*** names the book it came from (the entry it cites is linked back to), and **Assumed from a table: *field*, …** lists any fields the lore didn't state and the engine filled from a table. An entity the lore gave no kind takes the world's one base kind, **Thing**, says **Assumed kind: thing** and starts unticked whatever its confidence, so a person filed as a thing is applied only if you tick it; a world with more than one base kind drops it instead, and the job says why. There is no per-proposal edit step: accept or reject, then edit what you accepted in the editors.
4. **Apply n to the draft** adds the ticked proposals as entities; the books are linked, never edited. **Commit** when you are happy with the result.
5. Anything the books don't say is left to the data tables and to [detail on demand](#detail-on-demand). A field that comes from a table (an occupation, a region, a catalog item) which the lore leaves out or names loosely takes the best-matching table row, and its proposal says so.

### Build with AI and Refine with AI

**Build with AI** and **Refine with AI** are tools inside a world. You can ask the AI to draft or improve parts of it, and it returns **proposals**, never direct changes: you review them as you would an import, tick the ones you want (each has a confidence badge, and proposals at 70% or more start ticked) and apply them to the draft. A change to an existing entity that leaves out its kind keeps the kind it has. Proposals are checked by the world checker as part of this, and the work happens in the background, so you can keep editing.

Each tool remembers its last run, with its status and its proposals, so you can leave Build, reload or restart and come back to review them. An import saves its proposals as it reads each part of the books. A job the server or the extension stopped while it ran shows as **interrupted**: the proposals it made before it stopped are still there to review and apply, and **Run it again** starts it over with the same books or request. **Dismiss** clears a finished job; the engine keeps only the last few anyway.

### Data tables

Prices, pay, taxes, rents, vehicles, gear and the calendar's holiday rules come from **data tables**. The defaults are **Modern US**: approximate figures reflecting roughly 2025–26, recalled from public sources and rounded, not live data. Prices are national averages; each state's cost-of-living multiplier scales them when something is priced. Included are about 340 priced items in 19 categories, 56 occupations with pay and typical schedules, the 50 states and DC with tax rates, rents, electricity and minimum wage, finance parameters (credit cards, deposit accounts, loans, investing, payroll deductions, federal tax), 19 vehicle classes, 90 gear items, 34 containers, 5 kits, and federal holidays, common observances and school-year and work-shift patterns.

You can edit your world's copy of any table in the **Data tables** editor. Each table lists its pack, its rows and whether the figures are *approximate* or *authored*; rows are searchable and paged, and **Save table** makes a new revision. Each world revision pins the table revisions it uses, so a running chat never sees a table change until you [Upgrade](#upgrade). Swapping in another region's table isn't in the editor yet.

### Templates

In **Build → New world**, pick a **Template** (**Blank**, **Fantasy town**, **Mystery manor** or **Modern slice-of-life**), give the world a name and tap **Create world**. A template is a normal world with its own cast, schedules, quests, rules, weather and belongings, plus two dozen or so lore entries on its places, people and history (kept in the world; not delivered to the AI yet); change anything you like. Its puzzles show in **Quests** once you have come across them: the study safe when you step into the study, the vestry tiles when you find the vestry floor, the township truck when the shop takes the job.

- **Fantasy town** is *Brindlemere*, a river-ford market town on the eve of harvest, on a made-up calendar of thirteen moons. It starts on the **Story** preset and counts money in bits, marks and crowns.
- **Mystery manor** is *Harrowmere Hall*, a storm-bound fenland country house in October 1934, in pre-decimal money. It starts on the **Grounded** preset and has clues to find and a locked safe to open.
- **Modern slice-of-life** is *Port Alder*, a Lake Michigan harbor town in September 2026, in US dollars. It runs on the **Simulation** preset: payroll, rent, a garage, a boat and a shop to look after, a small index-fund account to invest in (Invest and Sell investments, on the Simulation preset), a school term for the landlady's youngest granddaughter, and a neighbor away on a weekend trip.

### Check world and Playtest

**Check world** is a tool inside a world. It runs the full lint in the background and reports every problem in plain language: filter by **All**, **Errors**, **Warnings** or **Info**, tap **Open** to jump to the thing, and **Check again** after a fix. It also plays the world forward and shows a transcript of each day as the author's view: every event, worded with names (no ids or bookkeeping, up to 40 lines), including people the player hasn't met and secrets, so you can check off-screen routines. Dropped changes, failures and leaks go in the notes. **Playtest** plays through the world in the background, without touching any chat: pick the number of turns (1 to 50), optionally give it a script, and tap **Run playtest** for a transcript and an **Issues found** list; its transcript shows each turn as a player would see it. A scripted line can say an action in its own words, with filler words in between ("walk down to the coffee shop"); when several actions fit, the one whose details the line fills is used. An action's words count only when you are the one doing it, in the first person ("I", "we", "let's") or as a command; a line that negates it ("I don't want to walk to the market"), says it of someone else ("Danny says he'll walk over to the marina"), muses about it ("I wonder whether to buy a boat", "I might", "thinking about") or uses it in an idiom ("I pay attention") triggers nothing. Like the GM view, Playtest leaves nothing recorded.

### Import and export

The **Build** tab's world list gives each world an **Export** and a **Delete** button, and **Import an lre-world-v1 file…** brings one in. Worlds export in the published **`lre-world-v1`** format and import from the same; the world's own lore travels inside the file, and your World Books stay separate. A world is one document, so it can be copied, shared and read by other tools. It carries its own **currency** (a code, symbol, minor unit, number of decimals and display format), which is why a fantasy town can count in *bits* and the mystery manor in pence (*12d*); every amount in the panels and chips is written with it. Importing never changes your settings.

**Imported worlds list any macros in their lore for your review.** After an import, a **Review before playing** card appears above the list of worlds if the file's lore, section templates or step templates contain macros, control characters or `<user>`, `<char>` or `<bot>` shorthands (all things Lumiverse's macro engine acts on): "“*name*” came from a file. Its lore and templates contain macros that Lumiverse runs when it builds a prompt; open each one and check it before you play." Each row names the macro, control character or shorthand and where it is, and **Open** takes you to that lore entry, section or step; **Done reviewing** puts the card away (it is not kept, so open the Lore list and look for double braces if you come back later). The toast says how many items there are to review. Nothing is changed for you: macros in lore you write yourself are kept as written, just as in any World Book.

### Revisions and Upgrade

You edit a world as a draft: the world bar in **Build** shows **unsaved draft** and a **Commit** button that carries its warning count, and **Discard** throws away every uncommitted change once you confirm. When you **commit**, the draft becomes a new revision; revisions that a chat depends on are never deleted automatically. A chat stays on the revision it was started on. When you have a newer revision (yours, from an import, or one that ships newer tables with an extension update), **Settings → Pins and upgrade** shows the chat's revision and its pinned generators and tables, and offers **Upgrade to the latest revision**.

#### Upgrade

Upgrade moves a chat to the newer revision from the next turn forward; you confirm with **Upgrade world**. It is recorded like any other change, so it works with swipes, branches and Re-narrate. Detail that has already been shown stays as it was; the new tables and generators apply to anything not yet shown. Nothing ever changes silently.

## Troubleshooting

**A reply came back empty, and the turn says "degraded" with a Retry chip.**
The model returned nothing, which reasoning models do when their thinking uses up the token limit. The engine won't regenerate on its own. Raise **max tokens** to **1,500 or more** in your preset or connection settings, then tap **Retry**. The world checker warns you when a preset's max tokens are below 1,500 with a reasoning model.

**The helper steps fail, or return nothing.**
The same limit applies to the helper calls (reading typed text, reading replies). A reasoning model needs about 1,500 tokens or more, because its thinking counts toward the limit. Set the step's **Max tokens** accordingly in **Settings → Steps and connections**; it warns you below 1,500.

**The AI keeps writing a JSON block, or the replies look wrong.**
Some presets contain a **JSON-ledger block**: a block that makes the narrator append a JSON object (gold, inventory) to its replies. It can confuse reasoning models, and it competes with the engine's own record of money and belongings. The world checker warns you if the active preset has one. Use a preset without that block for world chats.

**An entry says "unverified".**
The engine confirmed it was activated but couldn't confirm where it landed. Open the **Context** panel of the [Context inspector](#the-context-inspector); opening it runs a test prompt build. If it's still unverified, the entry sits in a position the engine can't check, such as a character-card field. Move it to a chat-depth position, or accept that it keeps its normal place.

**The chat is paused.**
You edited an earlier message of yours. Choose **Keep** or **Discard** (see [Editing an earlier message of yours](#editing-an-earlier-message-of-yours)). Until you do, new turns are written without simulation.

**The world doesn't match what the reply says.**
You edited the reply, or continued it in a way the engine couldn't read. Tap **Re-read edit** on that reply (or **Retry read** for a stopped Continue).

**A warning says a saved file was damaged.**
A saved file the engine couldn't read, or couldn't make sense of, is kept next to the original as `<name>.corrupt-<time>` (a second damaged copy of the same file gets its own time), and the engine carries on: settings fall back to their defaults, and the chat's journal, extraction learning, chips, plans, Outcome notes or inspector history, your jobs or the call meter start fresh. A damaged journal is also reported in the **Context** panel's warnings, with where the file is kept. The records saved on your messages still apply; edits, pauses and discards that only the journal held may be gone. A single record on a message that has the wrong shape (from an imported or forked chat, or another extension writing to the same message) is skipped instead: the message reads as if the engine had not simulated it, and the **Context** warnings name the message and swipe. Nothing is deleted.

**Something shows "pending".**
You opened detail or made a change while a reply was streaming. It lands right after the reply finishes.

**A Timelapse stopped early.**
Something interrupted it, and the chip says what: **Timelapse stopped: an invitation** (or a bill, a declined payment, an incident, a quest event, a world rule, someone arriving, an overdue loan, a need, a weather alert), with a **Continue** button that carries on to the original target. The Montage and the Journal say the same. A **Continue timelapse** chip means it hit the safety cap, and **Timelapse didn't run** (with **Retry**) means it couldn't be applied.

**My own lore entries are missing.**
LumiRPEngine doesn't touch your World Info for now, so your entries follow Lumiverse's own rules. Check that the book is attached to the chat, the entry is enabled and its keywords match, and Lumiverse's World Info budget leaves room for it.

**I imported a world and I'm not sure what's in it.**
A world file is someone else's content, and its lore and templates may contain Lumiverse macros (double braces such as `{{…}}`), which Lumiverse runs whenever it builds a prompt, in a World Info entry or here. LumiRPEngine keeps your own authored text exactly as written, macros included, and never lets a value it inserts (a name, a price, what a model said) form a macro. Besides double braces, Lumiverse's macro engine also acts on control characters and on the `<user>`, `<char>` and `<bot>` shorthands, so the import lists those too. After an import it lists what it found: a **Review before playing** card appears above the world list, with each item as "Review this macro before playing: …", the place it sits in (`lore.<id>.content`, `sections.<id>.template`, `steps.<id>.template`) and an **Open** button for it. Open each, delete or rewrite what you don't want, and tap **Done reviewing** before you attach the world to a chat. The card is shown only right after the import. The step templates' own placeholders (`{{pov}}`, `{{facts}}` and the like) appear in the list too; they belong to the engine and are harmless. Section templates may use only `{{lines}}`; the world checker reports any other macro, control character or shorthand in one as an error.

**A step never seems to run, or the call meter shows fewer calls than I expected.**
A step runs only when one of its signals fires and its phase's budget still has calls. Check the step's **Enabled** switch and **Signals** in **Settings → Steps and connections**, and the *Budgets per phase* in **Settings → Model use** (**Calls** 0 means no model at all in that phase). Lean has NPC choices switched off, so it never asks a model about them.

**The prompt is too long, or the chat history disappeared from it.**
The engine's fixed overhead plus your context is over the connection's limit. Pick a smaller preset (Lean), lower the budgets in **Settings → Model use**, or use a connection with a larger context.

**The map closed the drawer.**
On a phone the map goes fullscreen, so opening it closes the drawer first. Reopen the drawer when you're done. If the drawer can't be closed, the map opens in **Play → Map** instead, with a note ("The map opened here because the drawer couldn't close.") and a **Done** button.

**A step failed and the engine did something simpler.**
That's the fallback: a failed decision call goes to the helper, then to the engine alone, and a step that passes its deadline uses its deterministic fallback. The turn still finishes. Check the call meter and your connections.

For anything not covered here, see the list of known limits in the [README](../README.md).

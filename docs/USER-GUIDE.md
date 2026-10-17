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
| **Cast** | The people you know, and anyone you can see where you are. Someone with you shows what they are doing and, for someone who lives their own day, a 24-hour timeline of where they will be and their next commitment; **Why this plan?** under the timeline gives the reasons for each block: a fixed commitment, the need pressing them ("hungry (hunger 62)"), a close call ("close call, Maddie chose"), or "a close friend". Someone away shows only **Last seen** (from Cast life 2): where and when you last saw them. Agendas show when they're public, and how each person feels about you shows either way (each axis as a word and a number). **Your groups** lists the groups your character belongs to and your role in each. **Group by** sorts people under the world's classifications that players may see (a story role, say), under their groups, or under their tiers, and the chips under it filter by those classifications' values and by group (see [Classifications, groups and kinship](#classifications-groups-and-kinship)). |
| **Calendar** | The date, the clock, holidays and what is coming up. This is also where you pause the clock, start a Timelapse and change **this chat's time controls**. |
| **Quests** | Quests, puzzles, secrets and agendas, sorted into **Active**, **Done** and **Failed**, with stages, cues and objectives (n of m). **Show a hint** gives one at a time. Only what you know is shown. |
| **Journal** | A running list of what changed, including the full list behind every Montage, plus notes about things the engine dropped or expired. It lists what was applied: a change you undid, or one a later switch dropped, isn't shown as made. A group of changes dropped together (a purchase and its payment) is one note, worded like its Keep report row, with "(2 linked changes)" when the group has more than one change. A turn's entry lists the same lines as its change chip, at most 8; when more exist, money, quest and signal lines are kept and routine ones (activities, other people's moves, needs) go first. Filter by **All**, **Notes & montages** or **Not applied**. At the top, **Save to lore** keeps the latest reply, or an excerpt you select or paste, as a lore entry for the world (see [World lore](#world-lore)). |
| **Context** | The [Context inspector](#the-context-inspector). |
| **GM view** | Everything, secrets and removed people included, and an editor for all of it. See [The GM view](#the-gm-view). |

What you can see is always filtered to what your point-of-view character knows. Facts are public, known by particular characters, or secret, and a secret stays out of every panel, chip, choice and Journal line until the story reveals it.

- **People.** Someone you can't see (a secret, or someone known only to particular characters whom you don't know) is never listed: not under **Present**, in **Cast** or as an action's target, even standing in the room, and the narrator isn't told they're there. You know the people you have dealt with (anyone you have a relation with, or whose things you hold) and anyone you're with. When someone leaves, Cast keeps what you saw: where and when you were last together, never where they are now or what they're up to.
- **Places.** Some places are hidden until you find them: they stay off the map, the travel list, the place ✎ and the narrator's facts until you have been there or hear of them. Once found, they stay found. A reply can tell you of one ("you hear about the old boathouse"): that's a **New facts** chip like any other. A secret place is never learned this way; the story reveals it.
- **What you've seen.** The engine keeps a record of every place you have been and of whom you last saw where, written as the story moves people around, so an existing chat builds it from its history.

### The status pill

A small pill floats over the chat. You can drag it, and it remembers where you left it (the phone and the desktop remember it separately, and when the window crosses between phone and desktop width, the pill moves to that layout's place straight away; until you move it, it stays centred as its content changes). It shows the time (with **⏸** when the clock is paused, and the time scale as ×n when it isn't 1), your place, the weather and your cash. On screens narrower than 760 px it collapses to the time and a **▾**. A **⋯** mark means a turn is running, and **Paused** means the chat is waiting on an edit.

Tap the pill for the world's details: the time and day part, your place, the scene (and the last turn), the weather and your cash, then **This turn** (calls, seconds and tokens: the [call meter](#the-call-meter)), the clock button (**Pause clock** or **Resume clock**), and the **Map** and **Actions** buttons.

Tap the **✎** next to a value to correct it: your place, the weather, your cash or the scene type. A correction like this is a **fix**. It is saved with the reply like anything else, so it survives swipes and branches in the same way, and the pill and the details show the corrected value at once.

- **Weather** has a ✎ from Weather level 2, where the sky is simulated; you pick one of the climate's states (Clear, Overcast, Rain and so on) for the region you're in. The weather still follows its climate, so your correction holds only until the climate next changes the sky. During a scripted spell of weather, the corrected sky holds until the spell ends.
- **Scene type** lists the world's scene types. Your pick holds until an action, a rule or another fix sets the scene type, even when you move. **Place default** goes back to the scene type of wherever you are.
- **Cash** amounts are typed in the world's own money: "5" is 5 bits in Brindlemere, 5d in Harrowmere and $5.00 in Port Alder, with as many decimals as the currency has. When your cash is held in cash accounts (your wallet), a cash fix doesn't overwrite a number: it moves the difference between your wallet and an outside **Correction** account, so the Money panel shows it as a correction and the books still balance. In a new chat whose accounts aren't on your books yet, the fix puts them on first, so the difference is measured from the cash you start with. Undo and swipes treat it like any other fix.

Every ✎ fix is checked before it is saved: a value outside the field's range (energy above 100, cash below zero) or not among its choices is refused with the reason, and nothing changes. A saved fix shows a **Corrected** chip on the latest reply, with **Undo**. A fix you make while a reply is streaming waits for the reply to finish; if the reply changed things so the fix no longer fits, a chip says it didn't apply.

### Chips

Chips are the small buttons and notes under a reply. They tell you what the engine did, and give you a chance to change it.

| Chip | What it does |
|---|---|
| **The change** (for example "Moved to the kitchen", or "3 changes") | What the engine applied, worded for you: "Danny Okafor → you: warmth +2, trust +1", "Transfer: $200.00 from checking to savings". With several changes it says how many, and the list opens on tap. A change you undid (Undo, or **Not an action?**), or one an earlier switch dropped, isn't listed as made. A **+n min** chip beside it shows the elapsed time. |
| **Roll** | For an action with a dice check: the action and its outcome, the dice, the modifier and the total, and the exact odds ("Rolled 1d20 + 2 = 14. Odds: …"). When the world's rules for checks rolled nothing, it says so and why ("No roll: a sure thing (98% to succeed)."), and it shows how your approach was rated when that counted (see [How checks are decided](#how-checks-are-decided)). |
| **Apply** / **No** | The engine read a change in the story (see [Extraction modes](#extraction-modes)) that would apply, and asks "The narration says this happened. Apply it?" If you ignore it, it expires when you send your next message, and the Journal notes that. A change that couldn't apply at all (an item that doesn't exist, no price) never gets an Apply button; if the engine would have made it on its own, a **Didn't apply** chip says so. A reply that tells your own action again gets no second chip: when the turn lent something to someone, the reply handing that thing (or something inside it, like a lent truck's glovebox) to the same person is the loan itself, and when the turn bought something, the reply telling the purchase again (even in slightly different words, like "brass lantern" for "old brass lantern") is that purchase. Keys handed over with a lend do get their own chip, and so does a different thing bought or given in the same reply. |
| **Undo** | Reverses an automatic change ("Applied automatically."). Undo covers the latest reply; for anything earlier, use Keep or Discard (see below). An automatic purchase's chip shows what it charged and the catalog item it was priced as ("Bought milk: $3.63 (priced as Milk, whole)"); when the narrated price was capped or clamped it says so and has **Edit amount**, which charges what you type instead. |
| **Corrected** | A ✎ fix or a GM edit you saved on this reply, worded as the Journal words it ("Corrected · Rosie Alvarez's mood: happy"). **Undo** takes it back. |
| **Your correction didn't apply after the reply** (or *A confirmed change*, *Opened detail*, …) | Something you did while a reply was streaming (a ✎ fix or GM edit, a confirmation, opening a panel) waited for the reply to finish and no longer fit by then: the turn spent the money a correction took, or removed what it changed. Nothing changed. **Dismiss** clears it; the GM view's **Edits** tab has the exact reason. |
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

The palette opens as a sheet from the input bar's **World actions…** button, or from the **Actions** buttons on the Scene panel and in the status pill's details. It lists the actions that are possible right now, each with its targets, its minutes and price, and, for actions with a dice check, the **exact odds** of every outcome as a bar. You see the odds before you commit, and they are the real ones: the roll that follows uses exactly those faces. An option that isn't possible says why in plain words ("Not possible here and now" when a requirement isn't met). When the world's rules for checks decide without dice, the option says so instead of showing a bar: **No roll needed**, **Too hard to try** or **Retry needs a change**; **The story decides (odds 35%)** keeps the bar as the guidance (see [How checks are decided](#how-checks-are-decided)). Before your first turn in a chat, options are judged at your own realism settings, so an option offered isn't declined when the turn runs.

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

Open the map from the **World map** button in the input bar, **🗺 Map** in the status pill's details or on the Scene panel, or the **Map** tab in Play. It opens as a floating widget (480 px wide, resizable, with ⤢ for fullscreen and ✕ to close); the phone and the desktop remember its size and position separately. Drag to pan, scroll or pinch to zoom, and use **+**, **−** and **Fit**. Tap a place to see how to get there: each travel option shows its mode (walk, road, off-road or water), time, vehicle and cost, or why it isn't available ("No route from here."); choose one and the move or drive is sent and the map closes. Place names never overlap: a name sits beside its dot, or further out on a short line, on two lines, or shortened (the full name shows in the place's card when you tap it); on a crowded map a name may be left off, and its dot stays tappable. On a phone (a screen up to 600 px wide, or any touch screen), opening the map closes the drawer first and goes fullscreen; if the drawer can't close, the map opens in **Play → Map** instead.

The map shows one place at a time, with the places directly inside it (a town's streets and shops, a manor's rooms) and the routes between them. It opens where you are: on your own place when there are places inside it, otherwise on the nearest place around you that has a map or a grid, or else on the place just around yours. The **breadcrumbs** along the top lead back out, a level at a time, up to the **World** (the places at the top of the world), and a place with places inside it has **Open** on its card. **You are here** marks where you stand. The map draws the places you know and the places you're inside; a place you're inside without knowing it (a secret one, or a stranger's home you were let into) shows only as **Somewhere**, never by its name. Travel isn't limited to the place on screen: the palette and a typed move reach any place you know, and so does the map from any of its levels. From Space and travel level 2, a place with a grid shows its walls, doors and terrain behind its rooms, and from level 3 the square you're standing on.

**Known** and **Fog**, at the map's bottom left, choose how it shows what you know, for this chat only (until you pick, the world's choice). **Known** draws a place you've heard of but never been to as a dashed ring, and its card says so. **Fog** dims the places you haven't been to and lays fog over what you haven't seen: the squares you haven't had in sight when the world uses the grid system, or else the rooms you haven't been in. Under fog there is nothing to find: the map is sent without what lies there. In either display, a room you don't know about is solid nothing on the grid. Things lying on a grid's squares show as small amber diamonds only where you see them now: within your sight when the world uses the grid system, or else in the place you're in. Something you saw earlier isn't shown, so the map never tells you where it went. Tap the square to see what lies there.

When the world uses the **grid system**, you stand on a square of the grid you're on, and walls and doors are walked: tap a square of that grid and its card offers **Walk here** with the time it takes, going around the walls and through the doors, or says "No way there from here.". Walking into a room puts you in it, but never into a room you don't know about, nor through one. You see a few squares around you (the world sets how far), and walls block the view.

### The GM view

The **GM view** shows everything the engine knows, including secrets, truths you haven't discovered and people who were removed, and lets you change any of it. It sits behind a spoiler gate ("Spoilers ahead"): tap **Show the GM view** to open it, and **Hide** to put it away. Its data is fetched only while it is open, so none of it travels with what Play shows you. Looking never changes your chat; only the edits you save do. The [GM guide](GM-GUIDE.md) covers running a chat from here.

It has five tabs:

- **Entities**: every person, item, vehicle, group and account in the world, including the ones spawned during this chat and the removed ones, with a search box and a kind filter. Badges mark **You**, **Removed**, **Spawned**, **Agent** (someone who lives off-screen) and anything that isn't public. Tap one to open its form.
- **Places**: every place, with its visibility (public, discoverable, secret and so on).
- **Tracks**: every quest, secret and agenda, with every stage and its truth. Pick a stage to move the track there.
- **Money**: everyone else's money (below).
- **Edits**: the corrections in force on this version of the story, worded in full, and any change that didn't apply after a reply, with the exact reason.

An entity's form shows its fields as its kind defines them: a number shows its range, a choice (a mood, a reference to someone or somewhere) gives a picker, 🔒 marks a field the AI never sees or writes, and a value worked out from others (*worked out*) is shown but not edited. Tap ✎ to change a value, or **Add** to add to a number. Below are its designed sheet (as Play → You shows yours), **Placement** (move it to a place, put it inside something or take it out; an account also has **Add** and **Take** for money), **Relations** (add or update one with its fields, each checked against its range, or **Remove** it), and **Simulation** (its tier, whether it lives off-screen, and each domain's level, or *From the tier*). **Spawn**, under the list, adds a new entity of any kind.

**Remove from the world** takes an entity out of the story without deleting it: it disappears from Scene, Cast, the palette, what the narrator is told, schedules and the money processes, and its relations, and everyone's relations to it, go. Whatever it holds goes with it. **Restore** brings it back where it was, without the relations it lost (undo the removal instead to get those back too); someone who lives off-screen picks up from then, without catching up on the time they were away. Your own character can't be removed.

Every change you save is checked first: a number outside its range, a choice that isn't one of its values or a relation that doesn't fit is refused with the reason, and nothing changes. A save is one correction, however many things it changes: a **Corrected** chip appears on the latest reply with **Undo**, and swipes and Re-runs treat it like a ✎ fix (see [Re-run and Re-narrate](#re-run-and-re-narrate)). Saved while a reply is streaming, it lands when the reply finishes.

Kinds, classifications, tags and the world's places are the world's own definitions: the button at the bottom takes you to **Build** to edit them.

Each **Money · *name*** card shows another person's money at their own Money level, as your Money panel shows yours: their wealth band, then from level 2 their net worth and accounts, from level 3 their bills (who each one is paid to), and their latest transactions and notes (paydays, bills paid, anything declined). A person whose accounts haven't been opened yet is shown with the balances the world gives them to start with. Type an amount and tap **+** or **−** beside an account to add or take it, as a correction against an outside account, so the books still balance. None of this reaches your chat: their paydays and bills never appear in your chips, Journal or Montage, and their declines never stop your timelapse.

### Detail on demand

The world doesn't store every coin in every wallet. When you look at something that has no detail yet (open a trunk, check what a character is carrying, audit an account, open a Play panel such as **Money**), the engine generates it then, consistent with what is already known: a character known to be "rich" gets a balance inside the rich band. Once shown, it is recorded and never changes. Previews in the inspector are generated from the same seed but are not recorded, and the GM view shows what isn't generated yet as it stands (an account not opened yet shows the balance it will open with). If a recorded detail is removed from the story, for example by a branch, it is generated again and labelled **regenerated**, because it may come out differently.

## Swipes, edits and branches

A world chat survives all the ways people mess with a chat. Here is exactly what each one does.

### Re-run and Re-narrate

There are two ways to retry a reply:

- **Re-run** plays the turn again with a **fresh roll**. Your typed text keeps the reading it was given, but the engine draws new dice, so a failed check can succeed. This is the default.
- **Re-narrate** keeps everything the engine decided (the same dice, the same outcome, the same events) and only asks for **new prose**. Use it when you like what happened but not how it was told.

Which one a plain swipe uses is a setting (**Settings → Swipes**: *Re-run (new roll)* or *Re-narrate (same outcome)*). Either way, the **Swipe as…** chip on a reply has **Re-run** and **Re-narrate** buttons for a single swipe. Anything you fixed by hand (✎) or changed in the GM view carries over to the new swipe either way, where it still makes sense: Re-narrate checks it against the same outcome, and Re-run against the new turn, after everything the new roll did. One that no longer fits (the new roll spent the money it corrected, or the thing it changed is gone) is dropped with a **Not carried** note in the Journal, and a correction you undid stays undone. With Re-narrate, any detail you opened on the original reply carries over too, and anything that depended on results of the original narration is dropped with a note in the Journal.

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

- **Undo** covers the latest reply. Earlier changes go through Keep or Discard. Each ✎ fix and GM edit on the latest reply has its own **Undo**, on its **Corrected** chip.
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
| **Relationships** | One band per pair | One number per pair | Several axes plus appraisal rules | Decay, history, group standing |
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

A tier can make its people **live their own day (agendas and plans) by default**, and a world names the tier **new people join** (by default its first Background tier): people the story introduces, and anything spawned without a tier.

People you mark as **Lives their own day (agendas and plans)** in their entity editor get goals and agendas that feed their choices, even on Story. They are consulted by the AI only on close calls or invitations. Everyone else follows schedules and seeded incidents.

### Promote and demote

You can change a domain's level at any time in **Settings → Realism**. A new chat starts from its world's own realism and time defaults, and the **New chats** tab fills in only what a world leaves out; turn on **Use my settings instead of a world's defaults for new chats** (also in **Settings → Time**) if you always want your own levels, say Story everywhere. Its **This chat** tab changes the running chat, for **Everyone** or for just the **Leads**, **Supporting** or **Background** band (it names the world's tiers in that band); before the chat's first turn it shows the levels that turn will use. A single character's level is set on the character in the Build editors (**Level overrides**).

- **Promoting** switches processes on. Anything the character lacks is generated on demand, inside what is already known.
- **Demoting** switches processes off and trims what is shown. The data stays; nothing goes dormant, so promoting again never brings back stale detail. Money is conserved either way.

Before you confirm, a **migration preview** lists what will happen, naming the domain the way the panels do and saying whose level it is: "*Cast life for supporting characters* drops from level 4 to 2: processes above level 2 stop and their inputs freeze; detail stays stored." (❄), "*Money* rises from level 2 to 4: detail is filled in when first shown." (⬆, followed by "People without money detail get it from the pinned tables when you open them."), or "… stays at level 3." It also lists conditions in your world's rules that depend on something that will stop updating. The buttons are **Apply to this chat** and **Cancel** (**Apply** in the new-chat defaults), and a toast confirms ("*Money* is now *Simulation*."). In a running chat the change is recorded like any other and applies from the next turn forward.

### Mixed levels

A character at a low level can still deal with one at a high level: each side records at its own level, and the low-level side's money is represented by an *external economy* account, so the books always balance.

### Other people's money

From Money level 3, the people in the world live on their money as you do. They are paid, they pay their bills, and every Monday they pay a week of living costs that follows their wealth band (a world can set its own amounts; the Modern US data prices them from a weekly grocery basket), so their balances go down as well as up. A bill paid to someone in the world, like your rent to your landlord, lands in that person's own account. The first morning their bills run, the engine opens their accounts with the balances the world gives them. You see all of this only in the [GM view](#the-gm-view).

## How checks are decided

A check is the dice an action rolls (see [Checks, pools, progression and sheets](#checks-pools-progression-and-sheets)). How much those dice matter, against how you describe what your character does, is up to the world and to you. A world can set its own rules for checks in **Build → World → Ruleset**, under **How checks are decided**. A world that sets none rolls every check and lets the roll settle it, exactly as before.

### The presets

| Preset | When checks roll | Your described approach | Who settles it | Retrying a failed check |
|---|---|---|---|---|
| **Narrative-first** | Only risky ones (under 75% to succeed); likelier actions just succeed | The judge reads it as it picks the outcome | The story: a helper picks the outcome, with the exact odds as guidance | Needs a change |
| **Balanced** | Every check, except that sure things (95% or more) pass and hopeless ones (5% or less) fail without a roll | Adds up to +2 | The roll; a roll within 2 of another result is a close call, and the narrator may add a cost or partial progress | Needs a change |
| **Crunchy** | Every check | Doesn't count | The roll | Any time |

Crunchy is how the engine has always played. **Custom** lets you set each value, and changing any value of a preset makes it Custom:

- **When checks roll**: every check; only risky ones, below a chance you set; only where marked (an action marked **Its check always rolls**, a place marked **Checks roll here** and the places inside it, or a quest marked **Checks roll while it's in progress** while it is under way); or never. A check that isn't asked for succeeds.
- **Sure things pass without a roll** and **Hopeless tries fail without a roll**, each from a chance you set.
- **How the player's approach counts**: not at all, as a bonus up to **The most it counts**, as advantage from a rating you set, or as a DC lower by up to the most it counts (a check without a DC takes it as a bonus). It shifts a check that rolls; the palette shows the odds before it.
- **Who settles a check**: the roll; the roll, with close calls within the points you set; or the story.
- **Retrying a failed check**: any time; after a change (the minutes you set passing, better or worse odds, another way of doing it such as another stat, tool or target, or going somewhere else; rewording the same thing isn't a change); or once per scene (until you leave and come back).

A chance is a check's exact chance of success, as the palette shows it. Success is the outcomes a check lists as success, else its `success` band and every band after it. A check that names no success rolls whenever it's asked for, and a failed try at it isn't remembered.

When nothing is rolled, the check passes as `success` (when the action and the check have none, as the check's **Outcome when not rolled**, else its likeliest passing band); a hopeless try fails as `failure` (else its likeliest failing band); and a retry that needs a change fails the way it failed before.

### Your approach and the judge

When the rules weigh your words, or leave the check to the story, the **Judge your approach** step reads what you wrote before the reply. It rates your approach from 0 up to the most it counts, with one line on why, and when the story decides it also gives each outcome's odds, which the engine draws from with the turn's seed. It takes one call from the before-the-reply budget, runs only for a check the rules would roll or leave to the story, and is off in the Lean preset. Its answer is kept with your turn: a Re-narrate keeps the outcome, and a Re-run reads the same judgement with a fresh draw. If it is off or fails, a rolled check rolls as the palette showed, and a check the story decides succeeds.

### What you see

The palette says what the rules will do before you commit: **No roll needed**, **Too hard to try**, **Retry needs a change** (or **Retry needs a new scene**), or **The story decides (odds 35%)**, with the odds bar as the guidance. After the turn, the **Roll** chip says what was rolled, or "No roll:" and why, with how your approach was rated when it counted and the close call when there was one. The narrator is told the same: to narrate the result, that a close success may come at a cost or a close failure leave partial progress, or what the story decided.

### New chats and this chat

**Settings → Checks** has two tabs. **New chats** holds your own rules: a new chat in a world that sets none uses them, and **Use my check rules instead of a world's for new chats** makes every new chat use them. A chat keeps the rules it started with, whatever you change later. **This chat** shows the rules in force in the chat you have open; change them and tap **Apply to this chat**. The change applies from the next turn, and it is recorded like a realism change, so it follows swipes and branches.

## Model use

LumiRPEngine does most of its work without the AI. When it does ask a model, it uses small, focused calls, each with its own job. **Model use** presets set which steps may call a model, when, and how many calls a phase may spend.

| Preset | Before the reply | After the reply | Model steps beyond the narrator: most in one turn | Budgets (calls before / after) | Lore lookups (before / after) | Engine budget (sections) |
|---|---|---|---|---|---|---|
| **Lean** | Reads typed text only when it looks like an action | Reads the reply | 2 (reading your text, reading the reply) | 1 / 1 | none | 300 tokens |
| **Standard** (the default) | Reads typed text when needed; asks about NPC choices on close calls and invitations | Reads the reply; NPC choices off screen on close calls | 4 (reading your text, two NPC choices, reading the reply) | 2 / 2 | 2 / 1 | 600 tokens |
| **Full** | Reads typed text, decides NPC choices for everyone present, writes a brief and a prose outline | Reads the reply, decides off-screen NPC choices, checks for contradictions | 9 (adds the brief, the prose outline, the contradiction check, judging a puzzle answer, and judging your approach) | 8 / 4 | 3 / 2 | 1,000 tokens |
| **Custom** | Any step, any trigger, any connection and model | Same | Depends on the steps you enable; the call meter shows it live | Yours | Yours | Yours |

The number is the most a turn can run: each step takes one call from its phase's budget when it starts, so a phase never runs more steps than its budget allows. Most turns cost less, because a step runs only when its trigger fires; the call meter shows each turn's real count. The meter counts every engine model call, not the narrator: a reply that needs a JSON repair, or a Decision call that falls back to the helper, adds one. **Lean** is the floor. It keeps the cost down and leaves NPC choices to the engine's own rules rather than a model. Standard is where a model starts deciding close calls.

### The steps

| Step | When it runs | What it does |
|---|---|---|
| `interpret` (Interpret typed input) | Before the reply | Reads typed text as an action, including a request to let time pass. |
| `npc.choose` (NPC choices) | Before the reply for people who are with you; after the reply for people elsewhere | Picks what an NPC does on a close call or invitation, from a list the engine enumerates (always including "do nothing"). |
| `puzzle.answer` (Puzzle answers) | Before the reply | Judges a free-text puzzle answer, only for puzzles whose author opted in; the answer is a probability against a threshold. It runs unless you turn it off. |
| `judge` (Judge your approach) | Before the reply | Rates how well you describe your approach to an action's check, with one line on why, and when the story decides gives each outcome's odds. It runs only when the world's rules for checks need it; see [How checks are decided](#how-checks-are-decided). Off in Lean. |
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

Prose steps (`brief`, `outline`, `choices`) are shown only what your character could see: the facts they get are the player-visible ones, and any line that would give away an unrevealed truth or a secret lore entry's text is dropped before the call. A question that carries a secret never shares a call with prose.

### Connections

Each step runs on the **connection and model you choose for it**, in **Settings → Steps and connections**: every step has **Enabled**, a **Provider** (*Decision* or *Helper*), a **Connection**, a **Model**, **Max tokens** (with a warning below 1,500) and its **Signals**. Nothing is cut or simplified because a model is small; the defaults are cautious, and each one is a tap to change.

By default, the helper call (a small JSON-producing call on your chat connection) handles `interpret`, `extract`, `contradiction` and the prose steps, and your **Decision connection** (Lumiverse's Decisions API) handles `npc.choose`. If a decision call fails, the step falls back to the helper, and then to the engine alone. A failed call is never blindly retried, and neither a repair of malformed JSON nor a decision falling back to the helper is charged against a budget. The model and connection you pick for a step are the ones its call uses.

### Budgets, deadlines and fallbacks

Budgets are a **number of calls and a time limit for each phase**: **Before the reply** (reading your text, the NPC choices for people with you, puzzle answers, judging your approach, the brief and the prose outline) and **After the reply** (reading the reply, off-screen NPC choices, the contradiction check, suggested choices). You set them in **Settings → Model use** under *Budgets per phase*, each with **Calls** (0 to 20) and **Wall clock (ms)**, beside the **Engine budget (tokens)** for the sections. Each step takes one call from its phase's budget before it starts; when a budget is spent, or its time is up, each remaining step uses its fallback (**Calls** 0 means no model at all in that phase): number-only NPC choices, the deterministic outline, a check rolled or decided as if unjudged, or plain roleplay plus reading the reply. Steps run by priority, and independent ones run in parallel. Lumiverse's own limits also apply: 120 seconds for the context handler, 10 seconds for the World Info interceptor, 30 seconds per decision call. Simulation itself is never cut off by a clock; it is bounded by counts (days, agents, events).

### Lore for the helpers

The engine's own helpers read the world's lore ([World lore](#world-lore)) to do their jobs: `interpret` resolves names and aliases, `extract` recognises who and what the reply is about, `npc.choose` weighs a person's past and motives, `judge` weighs your described approach against what the world says, and the brief, the outline, the contradiction check and puzzle answers read what bears on the scene. The narrator doesn't get world lore yet.

- **Prefetch.** Before a step asks its model, the engine searches the lore with the step's own inputs: your message or the reply, the people and places in the scene, the quests you can see, or the people and options of an NPC choice. What it finds goes into that step's prompt, cut to fit the step's lore tokens. A prefetch costs no call.
- **Lookups.** A step can also ask for more. On most connections it calls the lore tools (search, read one entry, list a topic); on a connection that refused tools once, it asks in a plain form instead (`{"need": [...]}`), and the engine remembers that connection. Each time the model asks, the engine answers and the step is asked again: one more call, a **lore lookup**. Steps on the Decision connection can't use tools, so before deciding they get one lookup on the helper that asks what lore the decision needs.
- **Per step**, in **Settings → Steps and connections**: **Lore** (*Off*, *Prefetch*, *Look up* or *Both*), **Lore tokens**, and **Lookups by** (*Auto*, *Tools* or *Ask form*). A step without its own setting takes its preset's.
- **Per phase**, under *Budgets per phase*: **Lore lookups** and **Lookups may start within (ms)**. Each lookup takes one from its phase's lookup budget, apart from the phase's calls, and the steps that run first get them first. A lookup starts only while a third of the phase's time is left, so a step still has time to answer. When none is left, the step answers with what its prefetch found. **Lean** makes no lookups.
- **Secrets.** A secret entry reaches only the helpers its audience names, until its gate holds; the brief, the prose outline, suggested choices and extraction never get it, even if ticked. An entry marked **Known by** is read only once your character knows every person and place it links. Nothing a helper writes for you may carry a secret's text: a chip, a Journal line, a section, an action read from your words or the reason given for a judged approach that would is dropped, unless the words were yours. The helpers are told only who your character can see there, and a reason for a judged approach that names someone, a quest or a place your character can't see is dropped whatever you typed; the rating stands.

### The call meter

The call meter shows each turn's calls, seconds and tokens ("This turn: n calls · s s, n tokens"), and its lore lookups when there were any, in the status pill's details. **Settings → Model use** has the **Call meter** table with **This turn**, **Average** and **95th pct**, and a **Lookups** column. If a preset costs more than you want, this is where you see it. The meter is saved for you, so a restart keeps its numbers.

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
| **Learning a fact** (New facts) · `knows` | You learn a public fact, or hear of a place you didn't know (never a secret one) | confirm |
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

**Lore the helpers read** lists, for each model step of the generation, what it read of the world's lore ([Lore for the helpers](#lore-for-the-helpers)): its searches (the prefetch and each lookup) with how many entries each found, the entries it was given with their tokens (and *cut to fit* when shortened), its lookups and whether they went as tools or the ask form, and why a lookup didn't happen. It shows only what you may know. A secret entry shows only as *A secret entry*. An NPC choice's prefetch shows only whose choice it is (*Dev's choice*, or *An NPC's choice* for someone you haven't met), never what they might do. A step that may read a secret shows its lookups as — with how many entries they found, never what it asked. Any other search that would name a secret, a secret entry, someone you haven't met or a place you don't know is withheld, unless you or the reply said those words that turn.

### Your lore in world chats

LumiRPEngine doesn't manage World Info for now. In a world chat your own lore books work as they do anywhere else in Lumiverse: their entries activate by Lumiverse's own rules (keywords, constant entries, groups, recursion and the World Info budget), and the engine never switches one on or off. The Context panel doesn't list them.

- The engine switches on only the sections it fills in, in the world's own book, and keeps every other entry there switched off, even one you switch on by hand.
- The sections share the section budget in rank order. The Outcome section is never left out.
- World Info recursion follows your own settings, so a section's text can trigger one of your entries, as any other entry's text can.
- If the worker stalls, the world's sections are missing for that turn, and the turn is flagged.
- The world's own lore (Build → Lore) is kept in the world. The engine's helpers read it ([Lore for the helpers](#lore-for-the-helpers)); the narrator doesn't get it yet.

### Delivery verification

Activation isn't delivery: an entry can be switched on and still land somewhere unexpected. The engine works out where each section will land from the World Info and preset settings. Opening the **Context** panel also runs a **test prompt build**, a dry run that sends nothing and saves nothing, to check that the world's sections really appear in the prompt. Outcome, Montage and Outline come only from a real turn's plan, which a dry run doesn't make, so the test build leaves them **unchecked** rather than **not delivered**. Anything else it can't confirm is marked **unverified** and keeps its normal place. Entries placed in positions it can't check (for example, inside a character card) show as unverified.

Anything the engine inserts into the prompt, a name, a price, a number, a model's output, an Import or Refine proposal, has every brace replaced with a look-alike (｛ and ｝), its control characters removed (Lumiverse's macro engine turns some of them back into braces on a later pass) and its `<user>`, `<char>` and `<bot>` shorthands broken with look-alike angle brackets (＜ and ＞), so it can never form a Lumiverse macro, however many times it is processed. The same goes for the labels and the text of the sections and for the messages the engine writes into your chat. Your own authored lore is not changed: it keeps its macros, as it would in a native World Book (see [Import and export](#import-and-export) for reviewing a world someone else made).

## Authoring

You build worlds in the **Build** tab, which is designed to work at phone width as well as on a desktop. It opens on your worlds (each with **Export** and **Delete**), **New world** and **Import an lre-world-v1 file…**. Open a world to get its bar (**‹ Back**, the name, **Commit** and **Discard**), its World card (name, calendar, realism defaults, tiers, time defaults, ruleset and the lore lookup table), its **Content** lists (Entities, Places, Maps, Routes, Grids, Kinds, Classifications, Relations, Actions, Checks, Rules, Schedules, Tracks, Lore, Data tables, Sections, Step templates and Packs, each with a count and an issue badge, a search box and **+ New**) and its tools. Edit an item and **Save to draft**, or **Revert**. **Check world**, **Import from lore**, **Index a World Info book**, **Index this text**, **Build with AI**, **Refine with AI**, **Describe a map**, **Playtest** and **Attach to this chat** are tools inside a world.

For the formulas you write in requirements, checks, derived fields and rules, see [EXPRESSIONS.md](EXPRESSIONS.md); for every kind, field, effect, function and lint code the packs offer, the [reference](REFERENCE.md); and for small worlds to copy from, [RECIPES.md](RECIPES.md).

### Editors and lint

Every part of the world has a **schema-driven editor**. Four parts get special tools: a **map and grid** editor, a **schedule and timeline** editor, a **quest graph**, and an **expression** editor for formulas. **Maps** have an editor of their own (see [Maps](#maps)).

What you can define:

- **Kinds**: types of things, with single inheritance and typed fields (number, text, yes/no, choice, reference, list, dice, money, date, duration), each with a default, limits, **bands** (numbers shown as words), **derived** formulas, a lock, a limit on model-proposed changes, and a **visibility**: public, known by particular characters, or secret.
- **Relations**: containment, ownership, use grants ("assigned to", loans, with an end time), worn or equipped, knowledge, membership, regard, routes, kinship and your own, with the kinds allowed at each end, cardinality, symmetry and an **inverse** (the relation the other side holds back). The relation picker lists the packs' relation types beside the world's own.
- **Entities**, **places** (with hierarchy and time zones), **routes** with travel modes, and optional **grids** with terrain. Entities, places, tracks and fields each have a **visibility**. **known_by** shows the thing to whoever knows it: a `knows` relation to it, or matching its **Known by**, a [selector](#selectors) (the members of a group, people of a kind or tier, chosen ids) that the editor shows beside a known_by visibility. A place can also be **discoverable**: hidden from the player until they have been there, are told of it or have it in `known_places`. A visibility the engine doesn't recognize, or a Known by it can't read in full, hides the thing rather than showing it, and lint says so. A point-of-view character with no place of its own starts at the world's start place, and from Space 3 arriving at a place drawn on a grid puts them on its cell.
- **Maps**: the inside of a place, drawn on a grid or as linked places, which make that place's places, grid and routes (see [Maps](#maps)).
- **Actions**: parameters, requirements, an optional dice **check** with outcome bands (the odds shown to players are computed exactly from it), effects per outcome, a duration, and the activity it starts. A ref parameter can say **Only candidates matching** a [selector](#selectors): the palette offers only those, and typed text or a request naming anyone else is refused.
- **Rules**: "when this happens and that is true, do this", with run-once and cooldowns. A cascade stops at eight steps.
- **Tracks**: quests, secrets (revealed by conditions only), puzzles with attempts and a hint ladder, and NPC agendas.
- **Schedules**: calendar recurrence plus tables of fixed values or weighted choices, for shifts, timetables, routines, weather, bills, paydays and price paths. A schedule's owner is an entity, a group (its members), a kind, or a [selector](#selectors). When several set the same field of the same person, the most specific owner wins while its slot runs: their own schedule, then a group's, then their kind's, then a selector's; when the more specific slot ends, the field returns to the less specific one still running.
- **Lore**: what the world knows, as entries with a title, text, keywords, aliases, topics and links, where each came from, and secrets with a gate and the helpers that may read them, plus a lookup table of terms and topics (see [World lore](#world-lore)). It is kept in the world but isn't delivered to the AI yet.
- The **calendar** (Gregorian or your own) and **realism** defaults, with the band caps under the band labels.
- **Tiers**: the world's own ranks of importance. Each has a label, a band (Leads, Supporting or Background), a place in the order (↑ and ↓), an optional description, and whether its people live their own day (agendas and plans) by default; **+ Add tier** makes a new one, and a tier still in use can't be removed. **New people join** picks the tier for people the story introduces (by default the first Background tier). An entity's editor picks its tier from these, and its **Lives their own day** choice can follow the tier ("As its tier"); lint flags an entity whose tier the world doesn't have.
- **Section templates**: how a section's lines are wrapped when they go into the prompt. A template may use only the engine's `{{lines}}` marker; any other macro, control character or `<user>`-style shorthand in one is a lint error (`section_macro`), because it would run beside the engine's own values.
- **Step templates**: your own wording for a model step, per purpose (interpret, NPC choices, contradiction, puzzle answers, brief, outline, extract, suggested choices), with an output (text, decision, or `effects` for the steps that read changes, which run after the reply only), the signals it runs on (a template's own signals replace the step's), and engine placeholders such as `{{world}}`, `{{pov}}`, `{{place}}`, `{{clock}}`, `{{scene}}`, `{{present}}`, `{{facts}}`, `{{outcome}}`, `{{beats}}`, `{{brief}}`, `{{user}}`, `{{reply}}` and `{{recent}}`. They are all player-visible: a line that would reveal an unrevealed truth is dropped before the call. A template whose output can't be used by its purpose, an unknown signal and an unknown placeholder are lint warnings. Changes a step template proposes with `effects` are checked and bounded exactly like extraction, and money in them is stated as a plain amount in the world's currency (8 for $8), which the engine converts. Which steps run at all is still your choice, in **Settings → Steps and connections**. A world made with an earlier version keeps its step templates, except those for lore selection, which no longer exists.

Formulas use a small, safe expression language: numbers, comparisons and a fixed set of functions. They can't run code and they always produce a finite number. `table(id, key, column)` reads a cell of one of the world's data tables, and `table_step(id, value, column)` reads the row whose number key is the largest at or below `value` (a level table keyed by XP, say). `roll(notation)` works only in an effect's arguments (a value that starts with `=`): the effect's event records the result, so a replay or a swipe sees the same number. Anywhere else a roll would change the odds you were shown and what the engine reads, so it is a lint error and reads as nothing. For classifications and groups: `kind_is(e, 'person')` (a kind or one inheriting from it), `in_class(e, 'role', 'antagonist')` (a value or one nested under it), `has_tag(e, 'smuggler')`, `member_of(e, harlows)` (directly or through a member group), `tier_of(e)` and `band_of(e)` (the band its tier belongs to).

In the **expression editor**, **ƒx** opens the operators and every function a formula can call there: the math built-ins, the engine's own and the formulas of the packs the engine runs, taken from the engine itself, so the list never names one that doesn't exist. Typing suggests the ids, fields and functions that start with what you typed, and the names every formula can read (`self`, `pov`, `here`, `clock`, `hour`, `daypart` and the rest of the clock). An effect's **arguments** are edited one by one: each is a **Value** (`self`, `might`, `2`, or JSON for a list or an object) or a **Formula**, worked out when the effect runs. Only an argument's formula offers `roll(`.

### Maps

A **map** draws the inside of one place, its `scope`: a manor's floor as rooms on a grid, or a town as places linked by routes. It is a small JSON document in the **lre-map-v1** format (its JSON Schema is `src/shared/lre-map-v1.schema.json` in the source), which you write in the map editor or describe in your own words for the AI to write (see [Describe a map](#describe-a-map)). A map makes its places (inside its scope), its grid and its routes for you, and keeps them in step with it: they show in the Places, Grids and Routes lists as the map's, read-only, with **Edit in map** to change them where they come from. Delete the map and they go with it. A place, grid or route you made yourself always wins: a map that would make one with the same id leaves yours alone, and the lint says so.

A **grid map** is rows of characters, one per square, all the same length. The `legend` says what a character means: a terrain (`{"terrain": "grass"}`, with `"blocked": true` for one you can't cross), a place's area (`{"place": "kitchen"}`), a zone (`{"zone": "cellar"}`) or a thing lying on that square (`{"item": "lantern"}`, which must be a thing of the world on one square only, and not inside something; add `"place"` to say which room's floor it is, otherwise the room around it). Without a legend entry, `#` is a wall, `.` floor, `+` a door and a space nothing. A place stands at its `at` square, or in the middle of its area. `cellMeters` says how many metres a square is across (80 when you leave it out), for walking times.

```json
{
  "id": "manor_ground",
  "scope": "manor",
  "title": "Ground floor",
  "layout": [
    "#############",
    "#ppppp#kkkkk#",
    "#ppppp+kkkkk#",
    "#ppppp#kkkkk#",
    "###+#####+###",
    "#hhhhhhhhhhh#",
    "#####+#######"
  ],
  "legend": {
    "p": { "place": "parlour" },
    "k": { "place": "kitchen" },
    "h": { "place": "hallway" }
  },
  "places": [
    { "id": "parlour", "name": "Parlour" },
    { "id": "kitchen", "name": "Kitchen" },
    { "id": "hallway", "name": "Hallway" }
  ]
}
```

A **node map** sets its places in a frame of `size` by their `at` (leave it out and the place goes on a ring), and its `links` are the routes between them, each with its `minutes` and, if you like, its `modes`. Link every place on the map or none, because once a place's inside has links, travel there follows only them.

```json
{
  "id": "old_town",
  "scope": "town",
  "title": "Old town",
  "size": [100, 100],
  "places": [
    { "id": "square", "name": "Market square", "at": [50, 50] },
    { "id": "inn", "name": "The Gull Inn", "at": [25, 30] },
    { "id": "docks", "name": "Docks", "at": [80, 75] }
  ],
  "links": [
    { "from": "square", "to": "inn", "minutes": 3 },
    { "from": "square", "to": "docks", "minutes": 6 }
  ]
}
```

Without the grid system, walls and doors are drawn, not walked: travel inside a place follows its routes, or, with none, a short walk between any two of its places.

**Map settings** are in Build's world settings. **Display** is how a new chat's map starts out, **Known** or **Fog** (players can switch it on their map). **Grid movement** turns on the **grid system**: Space and travel is at least level 3 in every chat of the world, and on a grid, people stand on squares.

- Arriving at a place puts you on its square, or else on a door at the edge of the map, and you walk from there with **Walk here** on the map or the **Move on the map** action, around walls and through doors.
- A floor plan without `links` gets walking routes through its doors, between rooms a walk joins without crossing a third room, so **Go to** the kitchen walks there in the time the walk takes. A room no door leads to gets a warning.
- **Sight radius** (3 squares unless you change it) is how far you see; walls block it, and Fog shows only the squares you've seen.
- A thing drawn in the legend starts on its square. To take it, wear it or use it there, you have to be on its square or next to it: rules and actions can ask the same with `reach(self, thing)`, and `on_grid(thing)` says whether it lies on a square.
- A rule can fire when someone steps into a zone or onto a square: `{"zone": "cellar", "in": "manor"}` or `{"cell": [4, 2], "in": "manor"}` (every room's area is also a zone named after the room). It fires for you unless `who` picks others (a selector, like `{"kind": ["guard"]}`), once each time they step in, never while they stay.

The **map editor** (open a map from **Maps**, or **+ New**) checks the JSON as you type, against the format and against the rest of the world, and marks each problem on its line: rows of different lengths, a character the legend doesn't know, a place outside the grid, a link to a place that doesn't exist, an id another place already has. **Insert template** gives you a small grid or node map to start from, **Tidy** lays the JSON out a field per line, and a preview draws the map as Play will show it.

### Rulesets and profiles

A profile is a ready-made ruleset to start from; once applied, everything it added is yours to edit. Open **Build → World → Ruleset → Start from a profile…** and pick one:

- **Modern**: contemporary heroes on a d20. Six abilities (10 is average) with modifiers of (score − 10) ÷ 2 rounded down; **Defense** of 10 + Dexterity + a level bonus + an equipment bonus; twelve skills with ranks (Athletics, Drive, Stealth, Computers, Investigate, Repair, Notice, Sense Motive, Treat Injury, Persuade, Bluff, Intimidate); Fortitude, Reflex and Will; **Action Points**, which **Push a skill** spends to add 1d6 to the roll and each new level refills; HP from Constitution; Reputation; and levels at 0, 1,000, 3,000, 6,000 XP and so on.
- **Classic**: d20 fantasy of the 3.x style. Base attack and saves on good, average or poor progressions (each character's progression is a field), thirteen skills with ranks, Armor Class, HP from a hit die, and the same XP scale.
- **Fifth**: d20 adventure of the fifth-edition style. A proficiency bonus by level (+2 to +6), skills at proficiency 0, 1 or 2 (2 is expertise, twice the bonus), two proficient saves, Armor Class, **Dodge** (attacks on you roll with disadvantage until your next turn), and hit dice: a **Short rest** spends one to heal, a **Long rest** heals fully and regains half. A well-told approach earns advantage rather than a bonus.
- **Custom**: the least to grow from: one stat (Skill), one check (**Try something**), an HP pool whose max is a formula, a plain attack, and a progression with level 1 only.

Every d20 profile has **Use a skill** and **Make a save**, with one palette option per skill or save and its exact odds; the difficulty is moderate (10) unless the action is given easy, hard, very hard or a number. In an attack a natural 1 always misses and a natural 20 is a critical (the damage dice roll twice). **Total defense** (Dodge in Fifth) lasts until your next turn, and **Rest for the night** heals. Each profile also brings Balanced checks, a Sheets 3 floor so modifiers count under any realism, a sheet for **Play → You** and combat rules; the focus stays on skills and talking your way through, and fights are there when the story needs them.

**What applying does.** The picker previews the profile on your draft: the fields it adds to your character's kind (in the starters, Character), and the checks, actions, data tables and ruleset parts it adds. Anything already in the world with the same id and different content is listed with **Keep mine** (the default) or **Take the profile's**, and items that already match are counted. Everyone of that kind reads the new fields' defaults; nobody's stored values change unless a new field can't hold one (a level of 0 under a minimum of 1), and the preview lists those. **Apply to draft** writes it all at once and lint runs as usual; applying the same profile again changes nothing ("Nothing to apply"). Save or revert your own ruleset edits first.

**Adapting it.** A profile is ordinary data, so you change it like anything else:
- **Level your own way.** The XP thresholds are a column of the profile's level table (Modern levels, Classic levels, Fifth levels) or a list in **Progression**; change them, set a **Top level**, or add effects **On each level gained** (Modern refills Action Points there, Fifth adds a hit die). Custom starts at level 1 only: give it thresholds such as "0, 100, 250".
- **XP trackers.** XP is a number field. Add it with the `award` effect from quest rewards, track stages, rules (one on `combat.end` rewards a fight) or action outcomes, or correct it with ✎ on the sheet; crossing a threshold levels up. A second progression on other fields (milestones, renown) runs beside the first.
- **Skills and saves** are rows of the profile's skills and saves tables: add a row (its label and the modifier field it adds) and a number field of the same id for the ranks, and **Use a skill** offers it. Any action can do the same: a text parameter with a `table` offers that table's rows.
- **Everything else** is a formula or a field: Defense or max HP, a check's bands, each character's `damage` dice, the action economy, the sheet.

The profiles are original implementations of common tabletop mechanics: neutral names and numbers, no rules text.

### Checks, pools, progression and sheets

These are the pieces a tabletop ruleset is built from. They work the same whatever ruleset you write.

- **Checks.** A check is dice plus outcome bands. A band can test the total (`min`, `max`), the **natural** die (`natural: {min: 20}`: the face of the first die when the dice start with a single kept die, such as `d20` or `2d20kh1`), and the **margin** over a **DC** (`margin: {min: 5}`, the total minus the DC). Natural bands are tried first. A check with a `dc` and no bands has two outcomes: `failure` below the DC and `success` at or above it. **Advantage** is a formula that gives 1, 0 or −1: it adds a die to the natural die and keeps the higher (`d20` becomes `2d20kh1`) or the lower, and advantage and disadvantage cancel a die at a time. An **opposed** check names its opponent with `vs` (by default the action's `target`): the opponent rolls another check (`vs.check`), this check's dice with their own modifier (`vs.modifier`), this same check (neither), or doesn't roll and has a **passive** score that becomes the DC (`vs.passive`). Whatever you write, the palette's odds stay exact and are the real ones; the palette says "with advantage" and the DC beside them. An outcome's effects can read the roll as `roll.natural`, `roll.total`, `roll.modifier`, `roll.dc`, `roll.margin` and `roll.outcome`.
- **Anyone can roll.** The `check` effect (`{check, actor, target?, outcomes}`) lets a rule or another effect have someone else roll, such as a guard noticing you. Their roll never moves yours, and it is recorded for Check world and the GM.
- **What counts as success.** A check can list **Outcomes that count as success** (`pass`; by default `success` and every band after it) and its **Outcome when not rolled** (`auto`). [How checks are decided](#how-checks-are-decided) reads both.
- **Pools.** Give a number field a `pool` (`max`: another field, often a derived one, or a formula) for hit points, mana or stress. Effects keep it between its `min` (0 unless set) and its max, a pool nobody has set yet is full, and the `recover` effect restores it by an amount, by the pool's own `recover` formula, or to the max. A pool is still a field, so undo, swipes and Keep treat it like any other.
- **Progression.** In **Build → World → Ruleset**, **Progression** lists the ruleset's progressions; add one by id and open it to edit it. A progression has a **Label** (the sheet and the Journal show it), the kind it **Applies to** (or any kind with both fields), an **XP field** and a **Level field** picked from that kind's number fields (derived fields aren't offered, since the engine sets the level), and the XP each level needs, from level 1 (usually 0), as **A list** ("0, 300, 900, 2700") or **A data table**'s column, read in row order. A **Top level** is optional. **On each level gained** is a list of effects, edited like a rule's. Whenever an effect, a quest reward, a narrated change or a ✎ fix raises someone's XP past a threshold, the engine raises their level one level at a time and runs those effects for each, with `level` (the new level) and `from` (the level before the gain); the Journal says "You reached Level 3." for your character. The `award` effect (`{entity, progression, amount}`) adds XP. Levels only go up.
- **The sheet.** The ruleset's sheet lays out **Play → You**: sections of rows, each a field, a formula with a label, a pool (shown as a bar of current over max) or a progression (the level, with a bar of XP toward the next level). Without one, You shows the Sheets pack's stats as before. Lay it out in the **Sheet Designer**, below the progressions. **+ Add section** makes a section, its **Section title** renames it, and ↑, ↓ and ✕ move or remove it. **+ Add row…** picks what a row shows: one of your character's fields (inherited and derived ones too), a pool, a progression, or a **Formula with a label**, written in the expression editor with your character as `self`; each row has its own label, ↑, ↓ and ✕. **Sheet preview** shows the sheet as your character will see it when a new chat starts, from the ruleset as you edit it, before you save.
- **Level floors.** A ruleset's math may need more than the realism settings give: stat modifiers count only from Sheets 3. **Level floors** (for example Sheets 3) raise every character's effective level in that domain to at least the floor, whatever the preset, tier caps or overrides say. The world's **Realism defaults** in Build name the floors ("This world's ruleset needs Sheets & checks 3.") and don't offer a level below one, and **Settings → Realism → This chat** shows the same line, each domain at the level actually in force, and starts that domain's slider at its floor. Lint notes when the world's realism defaults sit below a floor.

**Lint** runs as you edit and speaks plainly. It catches broken references, wrong types, cycles, unreachable quest stages, sections that are too big, labels that leak secrets, secret truth in public lore, secret lore without a gate or readable by a step that writes prose, a lore entry whose **Secret** is neither on nor off in its file (such as `"true"` in quotes; it is kept secret until fixed), lookup-table terms and topics that lead to missing entries, lead nowhere or contradict an alias, a section template that holds a macro other than `{{lines}}`, step templates that could never run, unbalanced postings, double-booked commitments (two schedules setting the same field of the same people at once, with the same precedence), classification values that don't exist or nest in a loop, several values on a one-value classification, relations between kinds their type doesn't allow or beyond its cardinality, kinship written on one side only, conditions that depend on something frozen after a demotion, a Timelapse cap smaller than one time slot, rules for checks that hold a value they can't (each plays as the nearest it can), a sure thing that doesn't start above too hard to try, checks that roll only where marked with nothing marked, checks whose success the rules can't tell, and problems with the active preset (see [Troubleshooting](#troubleshooting)).

### Combat and encounters

Fights are part of a ruleset, and only a world whose ruleset has **Combat** (Build → World → Ruleset → **Combat**) has any: without it there is no Fight, no Combat tab and nothing changes. Combat is all data, so a Modern, Classic or Fifth-style fight is the same engine with different numbers.

- **The rules.** The **initiative** check everyone rolls when a fight starts (highest first; equal totals go by the initiative modifier, or the **tie-break** formula, then you, then your side, then id order); the **action economy**, budgets such as Action, Bonus, Move or Reaction with how many each fighter gets and whether they refill each turn or each round (a reaction is spent off your own turn, so it never keeps your turn open); the **HP field**, a pool; when someone is **down** (by default at 0 HP) and the condition they then have (it goes on the character sheet through the Sheets pack); the **sides** (who is hostile to whom, by default a `hostile` relation, and who fights beside whom); when the fight is **over** (by default when one side has no one standing); whether your turn ends once nothing you could do fits what's left or only on **End turn**; everyone else's **tactics** (whom they attack first, when they defend); and whether others' HP shows as **wounds** ("hurt", "badly hurt") or exact numbers.
- **Combat actions.** Any action becomes a combat action with a **cost** (budget → how many; Attack 1, or Attack 1 and Move 1 for a full attack). An attack is an ordinary action whose check reads the target's defense (a DC such as `target.defense`, or an opposed roll) and whose hit outcomes take `roll()` damage off the HP pool, which stops at 0 and at its max. Mark it **attack** or **defend** for everyone else's tactics. A combat action that **starts a fight** (an ambush) is offered only when none is under way; every other one needs a fight, your turn and enough left.
- **Starting and ending.** **Fight** (in the palette's Combat tab) starts one against someone; rules and actions can use the `combat.start` effect (named foes, a selector, or everyone here hostile to you) and `combat.end`. Formulas read a fight with `in_encounter`, `is_foe`, `is_ally`, `is_down`, `has_turn`, `standing(side)`, `encounter_round()` and `budget_left`; a rule on `combat.end` can award XP.
- **Playing a fight.** While one is under way, **Play → Encounter** shows the initiative order with whose turn it is, HP (yours exactly, others' as the rules allow), conditions, what you have left, your attacks with their targets and exact odds, End turn, and this round's acts. When your turn ends, everyone else takes theirs in initiative order before the reply, so the narrator is told the round in order (who did what, the hits and damage, who is down) and then whose turn it is. With **NPC choices** on, the decision model may pick among their legal actions; otherwise they defend when hurt and attack the most threatening foe. It's all part of your turn's record, so swipes, Keep and Re-run treat a round like any other turn. A foe you can't see is "someone": never named, never a target. The GM view's **Fight** shows everyone, HP exact.
- **Dice or the policy.** Attacks and every other check in a fight roll, every time, whatever the world's adjudication policy says: a missed attack can be tried again next turn, and the people you fight have no judge to read their approach. Set **Attacks and other fight checks are settled by** to **policy** to have them follow the policy like any other check.

### Classifications, groups and kinship

**Classifications** are your own ways of sorting a world's people and things, in **Build → Classifications**. Each one (a *facet*: a story role, an allegiance, a disposition) has a label, says whether an entity holds one value or **several values**, an order and a description, and lists its **values**. A value has a label, a description and, if you like, a value it is **nested under** ("Villain" under "Antagonist"), so anything that asks for Antagonist also takes the villains. An entity's editor has a picker for each classification (one choice, or a toggle per value) beside its **Tags**, free-form labels shown as chips that suggest the tags already in use.

A classification is for you and the GM side unless you tick **Players can see this classification**. Until then its values never reach Play, so a "Villain" stays a secret; tags never show in Play at all. Cast groups and filters only by the classifications players can see.

**Groups** are entities too: factions, families, households, companies, or a kind of your own that extends **Group**. Someone joins with a **member of** relation, which can carry their **role**, **rank** and **since** date; a group can belong to a larger group (a household in a family), and membership counts through it. A group's regard toward someone, `faction_regard(group, who)`, is its own regard if it has one, else the mean of its members' (people and things, through member groups too). A schedule owned by a group runs for its members.

**Kinship** comes with the Relationships pack: **parent of** and **child of** are each other's inverse, and **sibling of**, **spouse of** and **partner of** are symmetric. The engine keeps both sides: a link written by an effect brings its other side with it (and an unlink takes it away) as one change, a spawned person's relations bring theirs, and a link you author on one side only is completed when a chat starts (lint warns, naming the missing side). The same holds for your own relation types with an inverse or symmetry. A link that would break its type's kinds or cardinality ("Betrothed to" one at a time, say) is refused with the reason.

### Selectors

A **selector** picks entities by rule, with one editor wherever you need one (a schedule's owner, an action parameter's candidates): **Kind** (or one inheriting from it), **Tier**, a value of each classification (or one nested under it), **Tag**, **Member of** (directly or through a member group) and **Only these entities**. An entity must pass every constraint you set, and within one constraint any of its values will do; a selector with nothing set matches everyone.

### Lore books

Each world has its own book, **"LumiRPEngine · *your world*"**, created for you. It holds only the engine's sections: their entries are stored switched off and only the engine turns them on, so a section the engine can't fill never leaks into the prompt. Lore entries an earlier version of LumiRPEngine copied into the book are removed the next time you commit or Upgrade the world, attach it to a chat, or play a turn in one of its chats.

The world's own lore lives in the world, not in a book: see [World lore](#world-lore). LumiRPEngine never edits your own lore books.

Secret truth never lives in a World Book. It stays in the world and enters a section only at the moment it's revealed.

### World lore

**Build → Lore** holds what the world knows. It is kept in the world and travels with it when you export it. The engine's own helpers read it ([Lore for the helpers](#lore-for-the-helpers)); the narrator doesn't get it yet. The list's search box finds entries by title, alias, topic, keyword or text, and badges secret entries, where an entry came from, and entries whose book has changed. The list also opens the lookup table and the two indexing tools.

**Entries.** Each entry has a title, its text, **keywords**, **aliases** (other names its subject goes by, such as *the old lighthouse*), **topics** it belongs under (*Harbor law*), **links** to the places and people it is about, and optionally a **group** and a **priority**. Aliases and topics are chips: type one and press Enter, or tap one to remove it; the topic field suggests the topics your other entries use. The text is kept exactly as you wrote it, macros included, as in any World Book; that is why a world from someone else is worth a look before you play it (see [Import and export](#import-and-export)).

The **Source** card says where an entry came from: written in Build (as is every entry made before sources existed), indexed from one of your World Info books (it names the book and the entry), saved from a chat (it names the message), or written by an indexing job from text you pasted. When an entry indexed from a book no longer matches its World Info entry because you edited the book since, the card says so and offers **Refresh from book**, which puts the book's new text in the form for you to **Save to draft**. An entry whose book entry was deleted says so and keeps its text.

**The lookup table.** **Lore → Lookup table** (also **World → Lore lookup table**) is the routing LumiRPEngine's own lore searches follow, whether you or an indexing job wrote it. **Terms** lead to entries: *the old lighthouse* → *Breakwater Lighthouse*. One term can lead to several entries (*the Okafors* → each of the family's entries). Terms are matched in lowercase with their spacing tidied, which is how the editor stores them. **Topics** are a table of contents: each has a label and its entries in order. Suggestions come from your entries: their titles, aliases and keywords as terms (**Add all aliases as terms** takes every alias at once), and the topics they name (**File them all**). Nothing is saved until **Save to draft**. Lint flags a term or topic that names an entry that doesn't exist, a blank term or one that leads nowhere, a term written in a way lookups won't match, and a term that is one entry's alias but leads somewhere else.

**Who may read it.** **Who may read it** is *public* (anyone) or *Known by*: read only once your character knows every person and place the entry links (lint warns about one that links nothing). Tick **Secret** to keep an entry hidden. A secret entry may hold the secret itself, and it needs a **gate**: a formula, revealed once it holds (lint refuses a secret without one). Until then, only the helpers you tick under **Helpers that may read it before the gate holds** may see it: NPC choices, the contradiction check, puzzle answers and so on, one by one, and none by default. The scene brief, the prose outline, suggested choices and extraction write what the narrator or you see, so they never read a secret before its gate holds, even when ticked; ticking one shows a note, and lint warns too. A public entry never holds a secret's truth; lint refuses one that repeats a quest's or secret's truth.

**Indexing jobs.** Two tools turn text you already have into lore. Both are in the world's tools and in the Lore list:

- **Index a World Info book**: pick one of your books. Each entry with text that is switched on becomes a proposed lore entry with a title, aliases, topics, links to the world's people and places, and lookup terms. The entry keeps the book's own text and keywords, and its source remembers the book entry, so a later edit to the book shows up as described above. Entries already in the world's lore are skipped, so running it again reads only what's new; one run reads up to 72 entries. The world's own engine book can't be indexed.
- **Index this text**: paste a setting document, a history or your notes. The helper splits it into entries in the text's own words; each is marked as written by the AI and counts as reviewed once you apply it. One run reads about 72,000 characters.

Both work like [Import from lore](#import-from-lore). A proposal that cites no entry of the book, repeats a title the world's lore already has, or has no text is dropped, links to anything that isn't one of the world's people or places are removed with a note, and a reply with nothing usable is asked once more. You review the proposals: each shows its title, where it came from, its aliases, topics and links, and the lookup terms it adds. **Apply n to the draft** adds the ticked entries and files their terms and topics in the lookup table; your books are never edited. **Commit** when you are happy with the result. Like the other tools, each job keeps its last run.

**Save to lore.** In **Play → Journal**, **Save to lore** keeps the latest reply as a lore entry in the world's draft. To keep only part of the chat, select it and tap **Use selected text**, or paste it, then **Save the excerpt**. The entry's source names the message it came from (the latest message holding the excerpt, or the latest reply if the excerpt isn't in the chat word for word), and its form opens in Build so you can give it a title, aliases and topics before you commit.

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

### Describe a map

**Describe a map** draws a map from your own words. Pick the place it maps, give the map an id if you like, and describe the inside ("A small inn: the taproom at the front, the kitchen behind it through a door, and a corridor down the side to the stable yard."), then tap **Draw the map**. The AI writes an lre-map-v1 map, and the engine checks it as the map editor would; if it has problems, the AI gets one more try with the list of them. You get one proposal with a preview of the map, ticked when it came back clean and unticked, with what's still wrong, when it didn't. Applying it puts the map in your draft like any other, where the map editor can fix the rest; nothing reaches your chats until you commit. Like the other tools, it remembers its last run.

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

The **Build** tab's world list gives each world an **Export** and a **Delete** button, and **Import an lre-world-v1 file…** brings one in. Worlds export in the published **`lre-world-v1`** format and import from the same; the world's own lore travels inside the file, and your World Books stay separate. A world is one document, so it can be copied, shared and read by other tools: its JSON Schema is `schemas/lre-world-v1.schema.json`, and [STUDIO.md](STUDIO.md) is the contract for tools that author worlds outside Lumiverse. It carries its own **currency** (a code, symbol, minor unit, number of decimals and display format), which is why a fantasy town can count in *bits* and the mystery manor in pence (*12d*); every amount in the panels and chips is written with it. Importing never changes your settings.

**Imported worlds list any macros in their lore for your review.** After an import, a **Review before playing** card appears above the list of worlds if the file's lore, section templates or step templates contain macros, control characters or `<user>`, `<char>` or `<bot>` shorthands (all things Lumiverse's macro engine acts on): "“*name*” came from a file. Its lore and templates contain macros that Lumiverse runs when it builds a prompt; open each one and check it before you play." Each row names the macro, control character or shorthand and where it is, and **Open** takes you to that lore entry, section or step; **Done reviewing** puts the card away (it is not kept, so open the Lore list and look for double braces if you come back later). The toast says how many items there are to review. Nothing is changed for you: macros in lore you write yourself are kept as written, just as in any World Book.

### Revisions and Upgrade

You edit a world as a draft: the world bar in **Build** shows **unsaved draft** and a **Commit** button that carries its warning count, and **Discard** throws away every uncommitted change once you confirm. When you **commit**, the draft becomes a new revision; revisions that a chat depends on are never deleted automatically. A chat stays on the revision it was started on. When you have a newer revision (yours, from an import, or one that ships newer tables with an extension update), **Settings → Pins and upgrade** shows the chat's revision and its pinned generators and tables, and offers **Upgrade to the latest revision**.

#### Upgrade

Upgrade moves a chat to the newer revision from the next turn forward. It is recorded like any other change, so it works with swipes, branches and Re-narrate. Detail that has already been shown stays as it was; the new tables and generators apply to anything not yet shown. Nothing ever changes silently.

**Upgrade to the latest revision** first shows what the revision brings into the chat, entity by entity: people and things that are new, ones the revision no longer has, and each change to the rest. That covers fields such as appointments, home or employer, plus name, tier, classes, relations and an account's opening balance. Each change shows the chat's value, the revision's, and why it is set the way it is:

- **Unchanged in play:** nothing in the chat has touched it, so it's set to **Take**.
- **Changed in play:** a turn, a fix or a GM edit changed it, so it's set to **Keep**. That holds even if it later changed back.

Flip any change with its **Take**/**Keep** toggle. **Take all unchanged** resets the untouched ones to Take; **Review changed in play** lists only the touched ones. Someone the revision no longer has stays in the chat unless you pick **Remove**. **Upgrade with these picks** applies it.

A quest sitting at a stage the revision removed goes back to its first stage, with a Journal note. If an earlier Upgrade moved the chat without bringing these changes in, Pins and upgrade says so and offers the Upgrade even at the latest revision.

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

---
description: world_apply as the model is told it - what the tool does, and what each of its arguments is.
family: state
arguments:
  operations: The operations, applied in order. A later one may name what an earlier one made.
  operations.op: "The operation: move, place, give, wear, store, pay, pass_time, set, fact, quest, relate, spawn or horizon."
  operations.who: "move: who or what goes. wear: who wears it. pay: who pays. relate: whose regard changes."
  operations.what: "place, give, wear, store: the thing (or, for place and store, the person)."
  operations.to: "move: the place. give: who receives it. pay: who is paid; leave it out for no one in the world. relate: whom they regard."
  operations.from: "give: who gives it."
  operations.at: "place: the place. spawn: the place it is made at; for a place, the place it is inside. set: someone, something, a place, or world for the time."
  operations.on: "place, spawn: the thing it is set on, a table or a shelf."
  operations.by: "place: who picks it up."
  operations.in: "store: the bag, drawer, vehicle or room it goes into. spawn: the place it is made in, or who or what holds it."
  operations.with: "move: others who go along."
  operations.how: "give: handed (to hold), lent, returned, given, sold, traded or stolen. Given, sold and traded change whose it is."
  operations.until: "give: when a loan ends. pass_time: the time to pass until. A date and time (YYYY-MM-DD HH:MM) or words (two days, until dawn)."
  operations.off: "wear: true to take it off."
  operations.slot: "wear: where it goes: ready for in hand, or a slot such as holster, sheath or back."
  operations.away: "store: true to put it back where it is kept."
  operations.driving: "store: true when the person put into a vehicle takes the driver's place."
  operations.amount: "pay: how much, in the world's main coin (12.5 is twelve and a half)."
  operations.for: "pay: what the payment was for. pass_time: how long, in words (two hours)."
  operations.goods: "pay: what was bought, so the money and the goods change hands as one change."
  operations.qty: "pay, spawn: how many."
  operations.reason: "pay: the kind of payment: a purchase, a gift, a bribe, a fine, a loss, a wage, a debt."
  operations.method: "pay: how it was paid: cash, card, or an account by name."
  operations.minutes: "pass_time: how many minutes pass."
  operations.about: "fact: who, what or which place the statement is about."
  operations.key: "set: the value's name (hp, mood, curfew; time on the world). fact: a key of your choosing; the same key replaces."
  operations.value: "set: the new value. fact: the statement in words."
  operations.replaces: "fact: the id of a standing fact this one replaces, whatever its key."
  operations.add: "set: a number to add (negative to take away)."
  operations.quest: "quest: the quest, secret, puzzle or agenda."
  operations.stage: "quest: the stage it moves to."
  operations.outcome: "quest: met or failed."
  operations.reveal: "quest: true to show the player the stage."
  operations.axis: "relate: the regard that changes (trust, liking); leave it out for all of them."
  operations.change: "relate: how much it changes, up or down."
  operations.list: "horizon: the whole list of places, people and things the next turn is expected to need."
  operations.name: "spawn: its name."
  operations.kind: "spawn: its kind: person (or the world's own kind of person), item, container, a vehicle kind, a group's kind. Or a place: place needs only its name, and is inside the place at names or in none, as the first place of an empty world is; room, spot or venue needs at, the place it is inside."
  operations.tier: "spawn: its tier."
  operations.fields: "spawn: its sheet values, as field: value."
  operations.bestiary: "spawn: a row of the world's bestiary to take the sheet from."
  operations.type: "spawn: a thing's type in the world's catalogs."
  operations.class: "spawn: a vehicle's class."
  operations.owner: "spawn: whose it is."
  operations.description: "spawn: what it looks like."
  operations.square: "move, place: the square on the place's map, as [column, row], counted from 1 at the top left as the map prints it."
  operations.near: "move, place: someone or something to stand beside on the place's map."
  operations.zone: "move, place: a zone of the place's map."
  operations.why: "move, place, give, store, quest, relate: the reason, kept with the change."
  operations.source: "Where it comes from: from is prose, lore, author, gm, character, player, default or invented; lore, message and roll cite an entry, a message or a roll by id; an invention cites its gap_check and consent."
  operations.precision: "How exact: exact, approximate, vague or unknown."
  operations.standing: "How it stands: established, proposed or assumed."
---
Applies a list of operations to the world's recorded state, in order, each on the state the ones before it left, and answers with each operation's lane, what changed (each touched thing as it was and as it is now), how each touched thing now stands, and reports of anything that does not add up. Move, place, give, wear, store, pay, pass_time, set, fact, quest and spawn write the engine lane; relate and horizon the story lane. A name that is not there, or a value that is none of the choices, answers the whole call with what would work, and nothing is recorded.

- move: someone or something goes to a place, with others along.
- place: a thing set down or picked up; a person set down out of what holds them.
- give: a thing passes from one person to another, by a way of passing.
- wear: a thing put on, readied or taken off.
- store: a thing or person put into something, or a thing put back where it is kept.
- pay: money from one party to another, with the goods bought.
- pass_time: the clock moves on; the answer lists what the span brings due and applies none of it.
- set: a value on someone, something, a place or the world's time.
- fact: a statement in words about someone, something or a place.
- quest: a quest moves to a stage, or a stage is shown.
- relate: how someone regards another changes.
- spawn: someone, something or a place comes into the world.
- horizon: the list of what the next turn is expected to need.

A scene set from nothing in one call (an island, a kitchen on it, two people there, a lamp):
{"operations":[{"op":"spawn","kind":"place","name":"Gull Skerry","source":{"from":"prose","message":"m-1"}},{"op":"spawn","kind":"place","name":"Keeper's kitchen","at":"Gull Skerry","source":{"from":"prose","message":"m-1"}},{"op":"spawn","kind":"person","name":"Ada Lorne","at":"Keeper's kitchen","source":{"from":"prose","message":"m-1"}},{"op":"spawn","kind":"person","name":"Tobin Lorne","at":"Keeper's kitchen","source":{"from":"prose","message":"m-1"}},{"op":"spawn","name":"Oil lamp","at":"Keeper's kitchen","source":{"from":"prose","message":"m-1"}}]}

---
description: vehicle_refuel as the model is told it - what the tool does, and what each of its arguments is.
doing: refuelling a vehicle
arguments:
  vehicle: "The vehicle, by name."
  fuel_pct: "How full the tank is after, in percent."
  payer: "Who pays; left out, no one is charged."
  cost: "What it cost, in the world's main coin; with a payer, this is what is paid."
  source: "Where it comes from: from is prose, lore, author, gm, character, player, default or invented; lore, message and roll cite an entry, a message or a roll by id; an invention cites its gap_check and consent."
  precision: "How exact: exact, approximate, vague or unknown."
  standing: "How it stands: established, proposed or assumed."
---
Records a vehicle refuelled to the fill the call gives. Nothing is charged unless a payer is named, and then only the sum the call gives; what the world's tables would price it at is given as data and never charged by the tool.

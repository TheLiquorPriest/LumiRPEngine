---
description: vehicle_service as the model is told it - what the tool does, and what each of its arguments is.
doing: servicing a vehicle
arguments:
  vehicle: "The vehicle, by name."
  work: "service or repair."
  status: "Its status after: ok, needs_service or broken."
  condition: "Its condition after, as the world counts it."
  payer: "Who pays; left out, no one is charged."
  cost: "What it cost, in the world's main coin."
  serviced: "true when a service was done, so the next one is counted from now."
  source: "Where it comes from: from is prose, lore, author, gm, character, player, default or invented; lore, message and roll cite an entry, a message or a roll by id; an invention cites its gap_check and consent."
  precision: "How exact: exact, approximate, vague or unknown."
  standing: "How it stands: established, proposed or assumed."
---
Records a vehicle serviced or repaired: its status, its condition and that a service was done are the call's. Nothing is charged unless a payer is named, and then only the sum the call gives.

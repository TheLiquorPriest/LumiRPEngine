// Preview fixtures: a modern slice-of-life world in play. Shapes follow the contracts
// (`StateView`, `WorldDoc`, `UserSettings`) and the panel view models of the UI packs.

import { featureOn, FINANCE_FEATURES, payeeKey, type AccountView, type CardView, type FinanceView, type Flow, type FlowView, type JournalLine } from "../../src/shared/finance";
import { DOMAINS, INTERRUPT_CLASSES } from "../../src/shared/ids";
import type { DomainId, InterruptClass, InterruptPolicy } from "../../src/shared/ids";
import type { JsonValue } from "../../src/shared/json";
import type { ExtractionModeView, UpgradePreview } from "../../src/shared/protocol";
import type { StudioOffer } from "../../src/shared/studio-bridge";
import type { ExtractionType, UserSettings } from "../../src/shared/settings";
import { SETTINGS_DEFAULTS_REV } from "../../src/shared/settings";
import { defaultMindsSettings } from "../../src/shared/minds";
import { defaultTimeouts } from "../../src/shared/timeouts";
import type { MindCommitment, MindNote, MindPlan, MindsGmCharacter, MindsGmView, WitnessEntry } from "../../src/shared/minds";
import { calendarOf, formatClock } from "../../src/engine/calendar";
import { faded, salienceNow } from "../../src/packs/minds/core/state";
import type { GmEntity, GmField, GmView, StateView } from "../../src/shared/state-view";
import type { MapDisplay, WorldDoc, WorldIndex } from "../../src/shared/world";
import { compileMaps } from "../../src/shared/maps";
import { presetAdjudication } from "../../src/shared/adjudication";
import { inferredDefaults } from "../../src/shared/inferred";
import { blankWorld, migrateWorld } from "../../src/engine/authoring";
import { buildGmWorld } from "../../src/engine/gm-view";
import { createRegistry } from "../../src/engine/registry-impl";
import { initialState } from "../../src/engine/world-state";
import { materializeAll } from "../../src/engine/materialize";
import { runTimelapse } from "../../src/engine/time";
import { Working } from "../../src/engine/working";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { buildMapView } from "../../src/packs/space/core/view";

const interrupts = Object.fromEntries(INTERRUPT_CLASSES.map((cls) => [cls, ["invitation", "decline", "incident", "quest", "arrival"].includes(cls) ? "stop" : cls === "bill" ? "note" : "ignore"])) as Record<InterruptClass, InterruptPolicy>;

/** The purchase `c-decline` declined at Rosie's: more than the Visa's room ($787.45), which Pay another way takes from savings. */
export const DECLINED_PURCHASE = { name: "Catering order", cents: 85000 };

export function stateFixture(chatId: string): StateView {
  return {
    v: 1,
    chatId,
    worldId: "w-maple",
    revision: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    status: "idle",
    hud: {
      clock: { minutes: 1902, label: "Tue 07:42", dayPart: "Morning", paused: false, scale: 1 },
      place: { id: "diner", name: "Rosie's Diner" },
      weather: "Rain, 12 °C",
      cash: { cents: 4600 },
      fixes: {
        time: { type: "time", value: "2026-10-20 07:42", gregorian: true, months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((name, i) => ({ name, days: [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][i] ?? 30 })) },
        place: { entity: "pov", field: "place", type: "ref", value: "diner", options: [{ value: "diner", label: "Rosie's Diner" }, { value: "apartment", label: "Apartment 4B" }, { value: "garage", label: "Kim's Garage" }] },
        cash: { entity: "pov", field: "cash", type: "money", value: 4600, min: 0 },
        weather: { entity: "region_maple", field: "weather", type: "text", value: "rain", options: [{ value: "clear", label: "Clear" }, { value: "cloudy", label: "Overcast" }, { value: "rain", label: "Rain" }, { value: "storm", label: "A storm" }, { value: "fog", label: "Fog" }, { value: "snow", label: "Snow" }] },
        scene: { entity: "pov", field: "scene", type: "text", value: "", options: [{ value: "", label: "Place default (Conversation)" }, { value: "conversation", label: "Conversation" }, { value: "action", label: "Action" }, { value: "exploration", label: "Exploration" }, { value: "downtime", label: "Downtime" }] },
      },
    },
    scene: {
      placeId: "diner",
      sceneType: "conversation",
      present: [
        { id: "npc_rosie", name: "Rosie Alvarez", label: "your boss · wiping the counter" },
        { id: "npc_dev", name: "Dev Patel", label: "roommate · eating pancakes" },
      ],
      elapsed: 12,
    },
    chips: [
      { id: "c-retry", kind: "retry", messageId: "m1", label: "The reply came back empty", actions: [{ id: "regenerate", label: "Retry", style: "primary" }], expires: "next_send" },
      { id: "c-elapsed", kind: "elapsed", messageId: "m2", label: "+12 min", detail: "07:30 → 07:42", actions: [], expires: "never" },
      { id: "c-roll", kind: "roll", messageId: "m2", label: "Persuade Rosie: 2d6+1 = 9", detail: "needed 8 · 58.3% · success", actions: [], expires: "never" },
      { id: "c-price", kind: "price", messageId: "m2", label: "Coffee $3.25", detail: "Visa ··4421", actions: [], expires: "never" },
      { id: "c-confirm", kind: "confirm", messageId: "m2", label: "Dev gives you his car keys?", actions: [{ id: "confirm", label: "Yes", style: "primary" }, { id: "reject", label: "No" }], expires: "next_send" },
      { id: "c-mode", kind: "mode_change", messageId: "m2", label: "Purchases now apply automatically", detail: "28 of 30 kept on DeepSeek", actions: [{ id: "undo", label: "Undo" }], expires: "never" },
      { id: "c-swipe", kind: "swipe_option", messageId: "m2", label: "Swipe:", actions: [{ id: "renarrate", label: "Re-narrate" }, { id: "rerun", label: "Re-run" }], expires: "next_send" },
      // As the engine words a payment it declines (DESIGN §9.5): "with my card" over the Visa's room, with Pay another way.
      { id: "c-decline", kind: "decline", messageId: "m4", label: `Couldn't pay for ${DECLINED_PURCHASE.name}`, detail: "Sam Rivera's card was declined. It stays unowned, and the next reply is told so.", actions: [{ id: "other", label: "Pay another way", style: "primary" }, { id: "remove", label: "Remove it" }, { id: "accept", label: "Accept" }], expires: "next_send" },
      { id: "c-unpriced", kind: "decline", messageId: "m4", label: "Didn't apply: Buy a used bike", detail: "no price for a used bike. Nothing changed, and the next reply is told so.", actions: [{ id: "price", label: "Set price", style: "primary", input: { type: "money", label: "Price of a used bike" } }, { id: "item", label: "Pick item", input: { type: "choice", label: "Priced as", options: [{ value: "bike_used", label: "Used bike · $120.00" }, { value: "bike_new", label: "New bike · $450.00" }] } }, { id: "remove", label: "Remove it" }, { id: "accept", label: "Accept" }], expires: "next_send" },
      { id: "c-undo", kind: "undo", messageId: "m4", label: "Paid Dev $20", actions: [{ id: "undo", label: "Undo" }], expires: "next_send" },
      { id: "c-tl", kind: "timelapse_offer", messageId: "m4", label: "Sleep until 07:00?", detail: "8 h 20 min", actions: [{ id: "start", label: "Timelapse", style: "primary" }], expires: "next_send" },
      { id: "c-notaction", kind: "not_action", messageId: "m3", label: "Read as: Ask Rosie for a raise", actions: [{ id: "not_action", label: "Not an action?" }], expires: "next_send" },
      { id: "c-overdue", kind: "overdue", messageId: "m4", label: "Dev still has your drill", detail: "due yesterday 18:00", actions: [{ id: "retrieve", label: "Ask for it" }], expires: "never" },
    ],
    journal: [
      { kind: "note", messageId: "m2", ref: null, text: "Montage (Mon 22:00 → Tue 07:00): slept 8 h; payroll $612.40 to Checking; rent autopay $850.00." },
      { kind: "dropped", messageId: "m3", ref: { in: "post", seq: 14, index: 0 }, text: "Paid Mara $15 — dropped: you no longer had the cash on this branch." },
      { kind: "inert", messageId: "m3", ref: { marker: 9 }, text: "Realism change made on another branch (Money → Detailed)." },
    ],
    keepReport: [],
    pending: [{ panel: "castlife.cast", entity: "npc_mara" }],
    panels: {
      "sheets.you": {
        name: "Sam Rivera",
        tier: "Leads",
        place: "Rosie's Diner",
        activity: "on shift",
        conditions: ["tired", "caffeinated"],
        sections: [
          { title: "Stats", rows: [{ label: "Strength", value: "Average" }, { label: "Charm", value: "Good", detail: "+1 to persuade" }, { label: "Wits", value: "Sharp" }] },
          { title: "Status", rows: [{ label: "Energy", value: "62%", fix: { entity: "pov", field: "energy", type: "number", value: 62, min: 0, max: 100 } }, { label: "Hunger", value: "Peckish" }, { label: "Job", value: "Server at Rosie's" }] },
        ],
      },
      "economy.money": samMoney() as unknown as JsonValue,
      "vehicles.garage": {
        level: 3,
        vehicles: [
          { id: "car1", name: "2011 Civic", kind: "Sedan · gasoline", status: "Runs fine", place: "Diner lot", fuelPct: 38, rangeLabel: "~140 mi", odometerLabel: "142,318 mi", condition: 62, home: "Apartment lot", service: [{ label: "Oil change", due: "in 300 mi", overdue: false }] },
          { id: "boat1", name: "Dev's jon boat", kind: "Boat · outboard", status: "Needs work", place: "Garage", fuelPct: 10, odometerLabel: "212 h", assignedTo: { name: "You", until: "Sun 18:00", overdue: false }, service: [{ label: "Registration", due: "expired Sep 30", overdue: true }] },
        ],
      },
      "gear.gear": {
        level: 3,
        owned: [{ id: "drill", name: "Cordless drill", condition: 80, lent: { to: "Dev", until: "Mon 18:00", overdue: true }, children: [] }],
        worn: [
          { id: "apron", name: "Server apron", slot: "Waist", children: [{ id: "pad", name: "Order pad", children: [] }, { id: "pen", name: "Pen", qty: 3, children: [] }] },
          { id: "jacket", name: "Rain jacket", slot: "Outer", condition: 45, children: [] },
        ],
        carried: [
          { id: "backpack", name: "Backpack", load: { used: 4.2, capacity: 10, unit: "kg" }, children: [{ id: "wallet", name: "Wallet", children: [{ id: "cashstack", name: "Cash", qty: 46, children: [] }] }, { id: "phone", name: "Phone", condition: 30, children: [] }, { id: "kit", name: "Mechanic toolbox", kit: { complete: false, present: 43, total: 45, missing: ["10 mm socket", "torque wrench"] }, children: [] }] },
          { id: "keys", name: "Car keys", children: [] },
        ],
        stored: [{ id: "tent", name: "2-person tent", condition: 90, children: [] }],
      },
      "castlife.cast": {
        level: 3,
        people: [
          {
            id: "npc_rosie",
            name: "Rosie Alvarez",
            role: "Boss · owns the diner",
            here: true,
            activity: "Working",
            place: "Rosie's Diner",
            regard: [{ axis: "Respect", band: "Warm", value: 2 }],
            timeline: [
              { start: "00:00", end: "05:30", label: "Sleep", kind: "sleep" },
              { start: "05:30", end: "14:00", label: "Diner", kind: "work" },
              { start: "14:00", end: "22:00", label: "Home", kind: "free" },
              { start: "22:00", end: "24:00", label: "Sleep", kind: "sleep" },
            ],
            next: { at: "14:00", label: "Hands the shift to Mara" },
            tier: "principal",
            classes: { story_role: ["mentor"] },
            groups: [{ id: "diner_crew", role: "Owner" }],
          },
          {
            id: "npc_dev",
            name: "Dev Patel",
            role: "Roommate",
            here: true,
            activity: "Eating",
            regard: [{ axis: "Trust", band: "Close", value: 3 }, { axis: "Affection", band: "Fond", value: 2 }],
            timeline: [
              { start: "00:00", end: "08:00", label: "Sleep", kind: "sleep", reasons: ["night"] },
              { start: "08:30", end: "09:00", label: "Commute", kind: "travel", reasons: ["trip"] },
              { start: "09:00", end: "17:00", label: "Garage", kind: "work", reasons: ["work"] },
              { start: "17:00", end: "18:30", label: "See friends", kind: "free", reasons: ["company", "a close friend", "utility 3.1"] },
              { start: "18:30", end: "19:30", label: "Dinner", kind: "free", reasons: ["evening meal", "hungry (hunger 62)", "utility 7.6", "close call"] },
              { start: "19:30", end: "24:00", label: "Free", kind: "free", reasons: [] },
            ],
            agenda: [{ label: "Fix up the jon boat", stage: "Needs a part" }],
            tier: "regulars",
            classes: { story_role: ["best_friend"] },
            groups: [{ id: "apt_4b", role: "Tenant" }],
          },
          // Away: only where and when the player last saw her (the Drifter, whom the player doesn't know, isn't listed).
          { id: "npc_mara", name: "Mara Kim", role: "Neighbor · coworker", here: false, lastSeen: { place: "Rosie's Diner", at: "Mon 21:40" }, regard: [{ axis: "Affection", band: "Friendly" }], tier: "supporting", classes: { story_role: ["rival"] }, groups: [{ id: "diner_crew", role: "Cook" }] },
          { id: "npc_okafor", name: "Mr. Okafor", role: "Regular · retired teacher", here: true, activity: "Reading the paper", tier: "regulars", classes: {}, groups: [] },
        ],
        facets: [
          {
            id: "story_role",
            label: "Story role",
            multiple: false,
            values: [
              { id: "lead", label: "Lead" },
              { id: "ally", label: "Ally" },
              { id: "best_friend", label: "Best friend", parent: "ally" },
              { id: "mentor", label: "Mentor", parent: "ally" },
              { id: "rival", label: "Rival" },
              { id: "love_interest", label: "Love interest" },
            ],
          },
        ],
        tiers: [
          { id: "principal", label: "Leads" },
          { id: "regulars", label: "Regulars" },
          { id: "supporting", label: "Supporting" },
        ],
        groups: [
          { id: "apt_4b", name: "Apartment 4B", kind: "Household" },
          { id: "diner_crew", name: "Rosie's Diner crew", kind: "Company" },
        ],
        mine: [
          { id: "apt_4b", name: "Apartment 4B", kind: "Household", role: "Tenant", since: "2025-06-01" },
          { id: "diner_crew", name: "Rosie's Diner crew", kind: "Company", role: "Server", rank: 2 },
        ],
      },
      "calendar.calendar": {
        date: "October 20, 2026",
        weekday: "Tuesday",
        dayPart: "Morning",
        holidays: [],
        upcoming: [
          { at: "Today 14:00", label: "Shift ends", kind: "work" },
          { at: "Fri 09:00", label: "Payday", kind: "money" },
          { at: "Sat 19:00", label: "Mara's birthday dinner", kind: "invitation" },
          { at: "Oct 31", label: "Halloween", kind: "observance" },
        ],
      },
      "story.quests": {
        active: [
          { id: "q_raise", label: "Ask for a raise", kind: "quest", stage: "Build the case", cue: "Rosie respects people who show up early and cover shifts.", truths: ["Rosie gave the last raise to whoever covered the holiday shifts."], objectives: [{ label: "Cover two extra shifts", done: true }, { label: "Get a regular to vouch for you", done: false }, { label: "Ask Rosie after the rush", done: false }], hints: ["Mr. Okafor tips well and talks to Rosie every morning.", "Ask after 10:00, when the rush is over."], status: "active" },
          { id: "q_boat", label: "Dev's boat", kind: "agenda", stage: "Find a carburetor", cue: null, truths: [], objectives: [{ label: "Check Kim's Garage", done: false }], hints: [], status: "active" },
        ],
        done: [{ id: "q_lease", label: "Renew the lease", kind: "quest", stage: "Signed", cue: null, truths: [], objectives: [{ label: "Sign by Oct 1", done: true }], hints: [], status: "done" }],
        failed: [],
      },
      "space.map": {
        level: 3,
        here: "diner",
        path: ["maple", "diner"],
        scope: "maple",
        scopes: [
          { id: null, name: "World", trail: [], frame: { width: 100, height: 100 }, places: [{ id: "maple", name: "Maple Falls", x: 83.3, y: 50, known: true }], routes: [] },
          {
            id: "maple",
            name: "Maple Falls",
            trail: [{ id: null, name: "World" }],
            frame: { width: 1000, height: 700 },
            places: [
              { id: "apartment", name: "Apartment 4B", x: 120, y: 140, known: true },
              { id: "diner", name: "Rosie's Diner", x: 470, y: 260, known: true },
              { id: "garage", name: "Kim's Garage", x: 760, y: 140, known: true },
              { id: "shell", name: "Shell Route 9", x: 820, y: 520, known: true },
              { id: "lake", name: "Maple Lake", x: 260, y: 560, known: false },
            ],
            routes: [
              { from: "apartment", to: "diner", modes: { walk: { minutes: 18 }, road: { minutes: 5 } } },
              { from: "diner", to: "garage", modes: { walk: { minutes: 22 }, road: { minutes: 6 } } },
              { from: "garage", to: "shell", modes: { road: { minutes: 8 } } },
              { from: "diner", to: "lake", modes: { road: { minutes: 14 }, offroad: { minutes: 20 } } },
            ],
          },
        ],
        travel: [
          { to: "apartment", label: "Walk home", mode: "walk", minutes: 18, action: "space.walk", params: { to: "apartment" } },
          { to: "apartment", label: "Drive home", mode: "road", minutes: 5, vehicle: "2011 Civic", cents: 41, action: "space.drive", params: { to: "apartment", vehicle: "car1" } },
          { to: "garage", label: "Walk to Kim's Garage", mode: "walk", minutes: 22, action: "space.walk", params: { to: "garage" } },
          { to: "garage", label: "Drive to Kim's Garage", mode: "road", minutes: 6, vehicle: "2011 Civic", cents: 52, action: "space.drive", params: { to: "garage", vehicle: "car1" } },
          { to: "shell", label: "Drive to Shell Route 9", mode: "road", minutes: 14, vehicle: "2011 Civic", cents: 118, action: "space.drive", params: { to: "shell", vehicle: "car1" } },
          { to: "lake", label: "Drive to Maple Lake", mode: "road", minutes: 14, vehicle: "2011 Civic", action: "space.drive", params: { to: "lake", vehicle: "car1" }, disabled: "Not enough fuel for the round trip" },
        ],
      },
      "core.context": {
        warnings: [],
        generations: [
          {
            id: "g41",
            at: "Tue 07:42 · reply to “I ask Rosie about the raise”",
            activation: "confirmed",
            sections: [
              { slot: "outcome", label: "Outcome", tokens: 64, clipped: false },
              { slot: "scene", label: "Scene", tokens: 142, clipped: false },
              { slot: "cast", label: "Cast", tokens: 210, clipped: false },
              { slot: "montage", label: "Montage", tokens: 0, clipped: false },
              { slot: "minds", label: "Minds", tokens: 96, clipped: false, cut: 1 },
            ],
            budget: { sections: 600, used: 416 },
            minds: [
              { purpose: "mind", phase: "pre", who: "Rosie Alvarez", level: "live", outcome: "recorded", ms: 2140, tokens: 812, prompt: "default" },
              { purpose: "mind", phase: "pre", who: "Dev Patel", level: "near", outcome: "failed", ms: 6020, tokens: 0, prompt: "override" },
              { purpose: "skip", phase: "skip", who: "", level: null, outcome: "recorded", ms: 1480, tokens: 390, prompt: "world" },
              { purpose: "memory", phase: "post", who: "Rosie Alvarez", level: "live", outcome: "recorded", ms: 1720, tokens: 540, prompt: "default" },
            ],
            lore: [
              {
                step: "interpret",
                phase: "pre",
                policy: "prefetch+lookup",
                transport: "tools",
                queries: [
                  { kind: "prefetch", text: "I ask Rosie about the raise", matched: 3 },
                  { kind: "search", text: "staff pay rules", matched: 1 },
                ],
                entries: [
                  { title: "Daybreak Café", tokens: 46, cut: false },
                  { title: "Rosie Alvarez", tokens: 58, cut: false },
                  { title: "Café staff handbook", tokens: 112, cut: true },
                ],
                lookups: 1,
                notes: [],
              },
              {
                step: "npc.choose",
                phase: "pre",
                policy: "prefetch+lookup",
                transport: "need",
                queries: [
                  { kind: "prefetch", text: "Rosie's choice" },
                  { kind: "search", text: "" },
                ],
                entries: [],
                private: true,
                lookups: 1,
                notes: ["The connection refused the lore tools, so the step asked in the need form."],
              },
              {
                step: "extract",
                phase: "post",
                policy: "prefetch+lookup",
                transport: "none",
                queries: [{ kind: "prefetch", text: "Rosie sighs and says she'll think about it…", matched: 1 }],
                entries: [{ title: "Rosie Alvarez", tokens: 58, cut: false }],
                lookups: 0,
                notes: ["No lookup: the phase's lookup budget was spent or its time was up, so the step used its prefetch."],
              },
            ],
          },
        ],
      },
    },
    palette: {
      entries: [
        {
          action: "sheets.persuade",
          label: "Persuade",
          group: "action",
          options: [
            { label: "Rosie Alvarez", params: { target: "npc_rosie" }, detail: "2d6+1 vs 8", minutes: 5, odds: [{ outcome: "success", p: 0.583 }, { outcome: "partial", p: 0.278 }, { outcome: "fail", p: 0.139 }] },
            { label: "Dev Patel", params: { target: "npc_dev" }, detail: "2d6+2 vs 8", minutes: 5, odds: [{ outcome: "success", p: 0.722 }, { outcome: "partial", p: 0.194 }, { outcome: "fail", p: 0.084 }] },
            { label: "Mia Chen", params: { target: "npc_mia" }, detail: "No roll needed", minutes: 5 },
          ],
        },
        {
          action: "story.pick_lock",
          label: "Pick the office lock",
          group: "action",
          options: [
            { label: "With a hairpin", params: { tool: "hairpin" }, detail: "Retry needs a change", minutes: 15 },
            { label: "With the lock picks", params: { tool: "picks" }, detail: "The story decides (odds 35%)", minutes: 15, odds: [{ outcome: "failure", p: 0.65 }, { outcome: "success", p: 0.35 }] },
            { label: "Kick the door in", params: { tool: "boot" }, detail: "Too hard to try", minutes: 1 },
          ],
        },
        { action: "castlife.ask_raise", label: "Ask for a raise", group: "action", options: [{ label: "Rosie Alvarez", params: { target: "npc_rosie" }, minutes: 10, odds: [{ outcome: "yes", p: 0.41 }, { outcome: "later", p: 0.39 }, { outcome: "no", p: 0.2 }] }] },
        { action: "castlife.work", label: "Work the counter", group: "action", options: [{ label: "Until the rush ends", params: { until: "10:00" }, minutes: 138, detail: "tips likely" }] },
        {
          action: "economy.buy",
          label: "Buy at Rosie's",
          group: "buy",
          options: [
            { label: "Coffee", params: { item: "coffee" }, cents: 325 },
            { label: "Pancake stack", params: { item: "pancakes" }, cents: 899 },
            { label: "Club sandwich", params: { item: "club" }, cents: 1249, disabled: "Kitchen opens at 11:00" },
          ],
        },
        { action: "economy.pay", label: "Pay someone", group: "pay", options: [{ label: "Dev Patel", params: { to: "npc_dev" } }, { label: "Rosie Alvarez", params: { to: "npc_rosie" } }], amount: { param: "cents", min: 1, max: 4600 } },
        { action: "economy.transfer", label: "Transfer", group: "transfer", options: [{ label: "Checking → Savings", params: { from: "chk", to: "sav" } }, { label: "Checking → Visa", params: { from: "chk", to: "visa" } }], amount: { param: "cents", min: 1, max: 124018 } },
        {
          action: "vehicles.drive",
          label: "Drive",
          group: "drive",
          options: [
            {
              label: "Your car",
              params: { vehicle: "car1" },
              next: {
                param: "destination",
                label: "Destination",
                options: [
                  { label: "Kim's Garage", params: { destination: "garage" }, minutes: 6, cents: 52 },
                  { label: "Apartment 4B", params: { destination: "apartment" }, minutes: 5, cents: 41 },
                  { label: "Lakeshore Park", params: { destination: "park" }, disabled: "Not possible here and now" },
                ],
              },
            },
          ],
        },
        { action: "gear.lend", label: "Lend", group: "lend", options: [{ label: "Car keys", params: { item: "keys" }, next: { param: "to", label: "To", options: [{ label: "Dev Patel", params: { to: "npc_dev" } }, { label: "Mara Kim", params: { to: "npc_mara" } }] } }], number: { param: "days", label: "days", min: 1, max: null, default: 1 } },
      ],
      timelapse: {
        action: "calendar.timelapse",
        blocked: null,
        durations: [30, 60, 240, 480, 1440, 10080],
        until: [
          { label: "Until your shift ends", detail: "14:00 · in 6 h 18 min", target: { type: "shift" } },
          { label: "Until tomorrow morning", detail: "Wed 07:00", target: { type: "day_part", dayPart: "morning" } },
          { label: "Until Mara's birthday dinner", detail: "Sat 19:00", target: { type: "commitment" } },
          { label: "Until something happens", target: { type: "interrupt" } },
        ],
        interrupts,
        dayParts: false,
        followRoutine: false,
      },
    },
    controls: {
      realism: { preset: "story", levels: { money: 3, gear: 3, vehicles: 3, castlife: 3, relationships: 2, space: 3, calendar: 3, weather: 2, sheets: 2 }, tierCaps: { principal: {}, supporting: {}, background: { money: 1, castlife: 1 } }, bandTiers: { principal: ["Leads"], supporting: ["Regulars", "Supporting"], background: ["Background"] }, floors: { sheets: 3 }, claims: { mode: "real", capped: false } },
      adjudication: presetAdjudication("balanced"),
      inferred: inferredDefaults("story", 3),
      skills: [
        { id: "athletics", label: "Athletics" },
        { id: "insight", label: "Read People" },
        { id: "persuasion", label: "Persuasion" },
        { id: "stealth", label: "Stealth" },
      ],
      time: {
        sceneType: "conversation",
        sceneTicks: { conversation: 2, action: 0.5, exploration: 10, downtime: 30 },
        scale: 1,
        paused: false,
        interrupts,
        speedThrough: { sleep: { mode: "offer", thresholdMinutes: 30 }, work_shift: { mode: "auto", thresholdMinutes: 60 } },
        montage: "key",
        unitCap: { agentDays: 600, events: 5000 },
      },
    },
    meter: { turn: { calls: 3, tokens: 2140, ms: 6200, lookups: 1 }, average: { calls: 2.4, tokens: 1890, ms: 5100, lookups: 0.4 }, p95: { calls: 5, tokens: 3900, ms: 11800, lookups: 2 } },
    currency: { code: "USD", symbol: "$", minorUnit: "cent", decimals: 2, format: "{sign}{symbol}{amount}" },
    packs: { calendar: 1, space: 1, economy: 1, gear: 1, vehicles: 1, castlife: 1, relationships: 1, sheets: 1, story: 1, weather: 1 },
  };
}

/** Starter maps, as each starter's space view builds them for a new chat (`?map=…`); `grid` is the grid system's inn. */
export const STARTER_MAPS: Record<string, string> = { ring: "modern_slice_of_life", manor: "mystery_manor", square: "fantasy_town", grid: "grid_inn" };

/**
 * A small inn with the grid system on (`?map=grid`): a taproom, a kitchen and a hall behind doors, a
 * lantern lying in the taproom, and a market and docks in town that the POV has only heard of.
 */
function gridInn(): WorldDoc {
  const w = blankWorld("preview", "Grid inn");
  w.realism.levels.space = 3;
  w.mapSettings = { display: "knowledge", grid: { movement: true, sightRadius: 3 } };
  w.places = {
    town: { id: "town", name: "Saltmarsh", fields: {} },
    inn: { id: "inn", name: "The Gull Inn", parent: "town", fields: {} },
    market: { id: "market", name: "Fish market", parent: "town", fields: {} },
    docks: { id: "docks", name: "Docks", parent: "town", fields: {} },
  };
  w.entities.lantern = { id: "lantern", kind: "item", name: "Brass lantern", tier: "background", fields: {}, relations: [] };
  w.maps = {
    inn_ground: {
      id: "inn_ground",
      scope: "inn",
      title: "Ground floor",
      cellMeters: 2,
      layout: ["############", "#ttttt#kkkk#", "#ttttt+kkkk#", "#tttLt#kkkk#", "##+#########", "#hhhhhhhhhh#", "#####+######"],
      legend: { t: { place: "taproom" }, k: { place: "kitchen" }, h: { place: "hall" }, L: { item: "lantern" } },
      places: [
        { id: "taproom", name: "Taproom" },
        { id: "kitchen", name: "Kitchen" },
        { id: "hall", name: "Back hall" },
      ],
    },
  };
  w.start = { place: "taproom", at: w.start.at };
  w.entities.you!.fields.place = "taproom";
  return migrateWorld(w);
}

/** Effective levels per domain in `DOMAINS` order, with the overrides set on the entity. */
function gmLevels(levels: number[], overrides: Partial<Record<DomainId, number>> = {}): GmEntity["levels"] {
  return DOMAINS.map((domain, i) => ({ domain, level: overrides[domain] ?? levels[i] ?? 0, override: overrides[domain] ?? null }));
}

function personFields(cash: number, energy: number, mood: string, job: string): GmField[] {
  return [
    { id: "cash", label: "Cash", type: "money", value: cash, min: 0 },
    { id: "energy", label: "Energy", type: "number", value: energy, min: 0, max: 100 },
    { id: "mood", label: "Mood", type: "enum", value: mood, values: ["calm", "happy", "tense"] },
    { id: "job", label: "Job", type: "text", value: job },
  ];
}

function npcFields(cash: number, energy: number, mood: string, job: string, motive: string): GmField[] {
  return [
    ...personFields(cash, energy, mood, job),
    { id: "wariness", label: "wariness", type: "number", value: 100 - energy, derived: true },
    { id: "motive", label: "Motive", type: "text", value: motive, locked: true },
  ];
}

const LEADS = [3, 3, 3, 3, 3, 3, 3, 2, 3];
const SUPPORTING = [2, 2, 2, 2, 2, 2, 3, 2, 2];
const BACKGROUND = [1, 1, 1, 1, 1, 1, 3, 2, 1];

/** The GM view (`lre.gm`): everyone, the secret and the removed included, and every track's truths. */

/** A party's money in the GM view: one checking account, its recent lines and notes, with the books and features the engine gives its level. */
function gmMoney(party: string, name: string, level: number, opened: boolean, account: string, accountName: string, cents: number, recent: { at: string; memo: string; cents: number }[], notes: { at: string; text: string }[]): FinanceView {
  const lines: JournalLine[] = recent.map((r, i) => ({ id: `${account}:${i}`, ...r, account: accountName, accountId: account, kind: null, category: null, counterparty: null, card: null, status: "posted" }));
  return {
    party,
    name,
    partyKind: "person",
    level,
    detail: level >= 4,
    features: FINANCE_FEATURES.filter((f) => featureOn(level, f)),
    band: "modest",
    opened,
    cash: null,
    overview: { netWorth: cents, assets: cents, liabilities: 0, breakdown: [], cashFlow: null, upcoming: [], alerts: [] },
    accounts: [{ id: account, name: accountName, class: "checking", classLabel: "Checking", product: { id: "checking", label: "Checking" }, institution: null, status: "open", cents, available: cents, owners: [], role: "owner", manages: true, spends: true, autopayFrom: [], fallbacks: [], limit: null, aprPct: null, apyPct: null, terms: [], autopay: null, due: null, statements: [], cards: [], pending: [], holds: [], transactions: lines, securedBy: null, loan: null }],
    cards: [],
    flows: [],
    jobs: [],
    businesses: [],
    investments: null,
    properties: [],
    credit: null,
    household: null,
    recent: lines,
    notes,
    payPrefs: [],
    paysFor: [],
    ownKeys: [payeeKey(party), payeeKey(name)],
  };
}

/** Sam's money at Money 3 as Play → Money draws it: cash, checking with its debit card, savings and a Visa, the flows that move it, and how Sam pays. */
function samMoney(): FinanceView {
  const line = (id: string, at: string, memo: string, cents: number, accountId: string, account: string, category: string): JournalLine => ({ id, at, memo, cents, account, accountId, kind: cents > 0 ? "income" : "purchase", category, counterparty: null, card: null, status: "posted" });
  const account = (id: string, name: string, cls: AccountView["class"], classLabel: string, cents: number, rest: Partial<AccountView> = {}): AccountView => ({ id, name, class: cls, classLabel, product: { id: cls, label: classLabel }, institution: cls === "cash" ? null : "Maple Credit Union", status: "open", cents, available: cents, owners: [{ party: "pov", name: "Sam Rivera", role: "owner", share: 1 }], role: "owner", manages: true, spends: true, autopayFrom: [], fallbacks: [], limit: null, aprPct: null, apyPct: null, terms: [], autopay: null, due: null, statements: [], cards: [], pending: [], holds: [], transactions: [], securedBy: null, loan: null, ...rest });
  const card = (id: string, name: string, network: CardView["network"], accountId: string, last4: string): CardView => ({ id, name, network, state: "active", holder: "Sam Rivera", holderId: "pov", account: accountId, last4, item: null, dailyPurchaseLimit: null, dailyAtmLimit: network === "debit" ? 50000 : null, spentToday: 325 });
  const flow = (spec: Flow, amount: string, cents: number, schedule: string, next: string, from: string, to: string): FlowView => ({ id: spec.id, label: spec.label, kind: spec.kind, from, to, amount, cents, schedule, next, shortfall: spec.shortfall, status: spec.status, category: spec.category ?? null, link: null, payer: spec.from, editable: spec.source === "entity", source: spec.source, done: 3, missed: 0, deferred: 0, spec });
  const recent = [
    line("v:1", "Tue 07:40", "Rosie's · coffee", -325, "visa", "Visa ··4421", "food"),
    line("v:0", "Mon 18:12", "Shell Route 9 · 9.2 gal", -3211, "visa", "Visa ··4421", "fuel"),
    line("c:1", "Mon 09:00", "Payroll · Rosie's (net)", 61240, "chk", "Checking", "income"),
    line("c:0", "Mon 09:00", "Rent", -85000, "chk", "Checking", "housing"),
  ];
  const debit = card("chk_card", "Debit card ··1180", "debit", "chk", "1180");
  const visaCard = card("visa_card", "Visa ··4421", "credit", "visa", "4421");
  const accounts = [
    account("cash", "Wallet cash", "cash", "Cash", 4600),
    // Sam spends from all of them: each bank account backs the other, and the Visa's autopay draws on either.
    account("chk", "Checking", "checking", "Checking", 124018, { cards: [debit], fallbacks: ["sav"], transactions: recent.filter((r) => r.accountId === "chk") }),
    account("sav", "Savings", "savings", "Savings", 350000, { fallbacks: ["chk"] }),
    account("visa", "Visa ··4421", "credit_card", "Credit card", -41255, { available: 78745, limit: 120000, autopay: { mode: "minimum", from: "chk", fromName: "Checking", cents: null }, autopayFrom: ["chk", "sav"], cards: [visaCard], transactions: recent.filter((r) => r.accountId === "visa") }),
  ];
  const rent: Flow = { id: "flow_rent", label: "Rent", kind: "rent", from: "chk", to: "Maple Street Properties", amount: { fixed: 85000 }, schedule: { every: "month", days: [1] }, shortfall: "retry", retry_days: 3, retries: 2, category: "housing", status: "active", source: "entity" };
  const phone: Flow = { id: "flow_phone", label: "Phone", kind: "subscription", from: "visa", to: "Northwind Mobile", amount: { fixed: 4500 }, schedule: { every: "month", days: [1] }, shortfall: "skip", category: "utilities", status: "active", source: "entity" };
  const payday: Flow = { id: "job_server:pay", label: "Payday · Rosie's", kind: "payroll", from: "npc_rosie", to: "chk", amount: { provider: "economy.payroll" }, schedule: { every: "week", weekdays: [5] }, shortfall: "skip", category: "income", status: "active", source: "job" };
  return {
    party: "pov",
    name: "Sam Rivera",
    partyKind: "person",
    level: 3,
    detail: false,
    features: ["flows", "cards", "payment_prefs"],
    band: null,
    opened: true,
    cash: { cents: 4600 },
    overview: {
      netWorth: 437363,
      assets: 478618,
      liabilities: 41255,
      breakdown: [
        { label: "Cash", cents: 4600 },
        { label: "Deposits", cents: 474018 },
        { label: "Debts", cents: -41255 },
      ],
      cashFlow: { period: "the last 30 days", in: 244960, out: 197436, byCategory: [{ category: "housing", cents: -85000 }, { category: "food", cents: -6200 }, { category: "fuel", cents: -3211 }], nextIn: 122480, nextOut: 89500 },
      upcoming: [
        { at: "Fri 09:00", clock: 6300, label: "Payday · Rosie's", cents: 61240, flow: payday.id, account: null },
        { at: "Sun 1 Nov, 09:00", clock: 9180, label: "Rent", cents: -85000, flow: rent.id, account: "chk" },
        { at: "Sun 1 Nov, 09:00", clock: 9180, label: "Phone", cents: -4500, flow: phone.id, account: "visa" },
      ],
      alerts: [{ tone: "warn", text: "Visa ··4421: autopay pays the minimum from Checking on the 28th.", account: "visa" }],
    },
    accounts,
    cards: [debit, visaCard],
    flows: [flow(payday, "$612.40 after tax", 61240, "every Friday", "Fri 09:00", "Rosie Alvarez", "Checking"), flow(rent, "$850.00", 85000, "monthly on the 1st", "Sun 1 Nov, 09:00", "Checking", "Maple Street Properties"), flow(phone, "$45.00", 4500, "monthly on the 1st", "Sun 1 Nov, 09:00", "Visa ··4421", "Northwind Mobile")],
    jobs: [],
    businesses: [],
    investments: null,
    properties: [],
    credit: null,
    household: null,
    recent,
    notes: [],
    payPrefs: [{ use: "cash", max: 2000 }, { use: "visa_card" }],
    paysFor: [],
    ownKeys: ["pov", payeeKey("Sam Rivera")],
  };
}

/** A starter world's Play → Money in a new chat, built by the engine itself (as `starterMap` builds its map). */
function starterMoney(template: string): JsonValue {
  const world = STARTER_WORLDS[template]?.("preview", template);
  if (!world) return null;
  const registry = createRegistry(ALL_PACKS);
  const def = registry.views.find((v) => v.panel === "economy.money");
  return def ? def.build(registry.context(world, initialState(world, "preview", registry)), { mapDisplay: null }) : null;
}

/**
 * Port Alder's money as the engine keeps it nine days into a chat (`?money=<party>`): Play → Me →
 * Money shows that party's own, as they see it, and the GM view is Port Alder's as the engine
 * builds it, so GM → Money shows everyone with money, each at their own Money level, and its pages
 * read Port Alder's entities, kinds and places. 114 Harbor Street is put up for sale, so whoever
 * doesn't own it sees its listing. Marcus Delgado (`marcus_delgado`) has a business, a mortgaged
 * house and a credit score; Helen Kowalczyk (`helen_kowalczyk`) a household and a let house; the
 * POV (`pov`) a job, investments and a credit score. Null for a party the world doesn't have.
 */
export function portAlderMoney(party: string): { play: JsonValue; gm: Omit<GmView, "edits" | "refused" | "minds"> } | null {
  const world = STARTER_WORLDS.modern_slice_of_life?.("preview", "modern_slice_of_life");
  const harbor = world?.entities.prop_harbor_114;
  if (!world || !harbor || !Object.hasOwn(world.entities, party)) return null;
  world.pov = party;
  harbor.fields.asking_price = 54900000;
  const registry = createRegistry(ALL_PACKS);
  const w = new Working(registry, world, initialState(world, "preview", registry));
  materializeAll(registry, w, party, "preview");
  // Nothing stops the nine days: what would interrupt a player's timelapse only goes in its montage.
  const lapse = runTimelapse(registry, w, { type: "duration", minutes: 9 * 24 * 60 }, { runSeed: "preview", overrides: { invitation: "note", decline: "note", incident: "note", quest: "note", arrival: "note" } });
  if ("code" in lapse) return null;
  return { play: w.ctx.query("economy.finance")(w.ctx, party, true) as unknown as JsonValue, gm: buildGmWorld(registry, w.world, w.state) };
}

/**
 * GM → Minds as the minds pack builds it (DESIGN §24.9) at the state fixture's clock, Tue 07:42: everyone
 * but Sam, closest on the ladder first, scored with the default weights. Rosie is the author's Always
 * Live and Mara the GM's pin; Teo has no mind yet and a refresh asked for; Mr. Haskell's last mind, at a
 * beat of Monday afternoon's skip, named him (so the narrator got none of it) and interrupted the skip;
 * Vic is out of the world. Notes fade as in a world with a half-day half-life, so a faded one shows.
 */
function gmMinds(): MindsGmView {
  const now = 1902;
  const cal = calendarOf(worldFixture());
  const clock = (at: number): string => formatClock(cal, at);
  const memory = { salience: { halfLifeDays: 0.5, floor: 0.5 } };
  const names: Record<string, string> = { pov: "Sam Rivera", npc_rosie: "Rosie Alvarez", npc_dev: "Dev Patel", npc_mara: "Mara Lopez" };
  const plan = (p: MindPlan): MindsGmCharacter["plans"][number] => ({ ...p, fromText: clock(p.when.from), toText: clock(p.when.to) });
  const note = (n: MindNote): MindsGmCharacter["notes"][number] => ({ ...n, now: Math.round(salienceNow(n, now, memory) * 100) / 100, faded: faded(n, now, memory), clock: clock(n.at) });
  const commitment = (x: MindCommitment): MindsGmCharacter["commitments"][number] => ({ ...x, withNames: x.with.map((w) => names[w] ?? w), dueText: x.due === null ? null : clock(x.due) });
  const witness = (w: WitnessEntry): MindsGmCharacter["witness"][number] => ({ ...w, clock: clock(w.at) });
  const rosieBroker: MindPlan = { id: "pl_rosie_broker", what: "Call the broker about the listing", kind: "errand", when: { from: 2310, to: 2340 }, where: "back_office", with: [], priority: 4, status: "open", made: 1890, source: "memory", closed: null, reason: null };
  const devBracket: MindPlan = { id: "pl_dev_bracket", what: "Pick up the transom bracket at Kim's Garage", kind: "errand", when: { from: 2460, to: 2490 }, where: "garage", with: [], priority: 3, status: "open", made: 1890, source: "memory", closed: null, reason: null };
  const maraBanner: MindPlan = { id: "pl_mara_banner", what: "Hang the banner and the lights", kind: "other", when: { from: 7800, to: 7920 }, where: "apartment", with: ["npc_dev"], priority: 5, status: "open", made: 1890, source: "memory", closed: null, reason: null };
  const haskellBroker: MindPlan = { id: "pl_haskell_broker", what: "Meet the broker about the diner", kind: "meet", when: { from: 3540, to: 3600 }, where: null, with: [], priority: 4, status: "open", made: 960, source: "memory", closed: null, reason: null };
  return {
    enabled: true,
    secrecy: "brief",
    now,
    nowText: clock(now),
    characters: [
      {
        entity: "npc_dev",
        name: "Dev Patel",
        fidelity: {
          entity: "npc_dev",
          level: "live",
          score: 147.9,
          reasons: [
            { label: "In the scene", points: 45 },
            { label: "Named this turn", points: 40 },
            { label: "Knows you", points: 10 },
            { label: "Owns a story track", points: 15 },
            { label: "In 1 story track", points: 8 },
            { label: "1 pending with you", points: 15 },
            { label: "Supporting", points: 5 },
            { label: "Seen with you lately", points: 9.9 },
          ],
          pin: { gm: null, author: null },
        },
        refreshQueued: false,
        intent: { text: "Get Jordan to cover Friday's shift without letting on why he needs the night off.", approach: "proactive" },
        mind: {
          at: 1890,
          round: 6,
          level: "live",
          place: "diner",
          moment: "turn",
          reason: "live",
          monologue: "Sam's going to ask about the drill again, and I still need it for the boat's transom: two more evenings at most. Handing over the Civic keys buys some goodwill, and it keeps Sam away from the apartment while Mara sorts out Saturday.",
          depiction: "Dev pushes the last of his pancakes around the plate and offers his car keys a little too quickly.",
          intent: "Keep Sam busy and away from the apartment until Saturday; return the drill by Thursday.",
          reactions: ["If Sam asks about Saturday, he changes the subject to the boat.", "If Sam is short of cash, he offers to cover breakfast."],
          plans: [],
          mood: "jittery",
          interrupt: null,
          withheld: false,
          clock: clock(1890),
        },
        plans: [
          plan(devBracket),
          // A plan his mind made in an older chat: the GM still sees it, as a thought that drives nothing.
          plan({ id: "pl_dev_rent", what: "Pay Sam back his half of the gas bill", kind: "pay", when: { from: 2520, to: 2550 }, where: null, with: ["pov"], priority: 3, status: "open", made: 1890, source: "mind", closed: null, reason: null, cents: 3150 }),
          plan({ id: "pl_dev_banner", what: "Help Mara hang the banner and the lights", kind: "meet", when: { from: 7800, to: 7920 }, where: "apartment", with: ["npc_mara"], priority: 5, status: "open", made: 1350, source: "memory", closed: null, reason: null }),
          plan({ id: "pl_dev_drill", what: "Bring Sam's drill back", kind: "errand", when: { from: 1080, to: 1110 }, where: "apartment", with: ["pov"], priority: 2, status: "dropped", made: 600, source: "gm", closed: 1110, reason: "Stayed late at the garage" }),
        ],
        notes: [
          note({ id: "n_dev_drill", text: "Sam asked about the drill again; I said Thursday.", salience: 3, at: 1890 }),
          note({ id: "n_dev_banner", text: "Mara wants the banner up before Sam's shift ends on Saturday.", salience: 4, at: 1350 }),
          note({ id: "n_dev_counter", text: "Rosie gave the counter shift to the new guy.", salience: 1, at: 600 }),
        ],
        commitments: [
          commitment({ id: "c_dev_party", kind: "plan", with: ["npc_mara"], text: "Keep Sam away from the apartment on Saturday afternoon", due: 8160, status: "open", made: 1350, closed: null }),
          commitment({ id: "c_dev_drill", kind: "promise", with: ["pov"], text: "Give Sam's drill back by Thursday", due: 5400, status: "open", made: 1890, closed: null }),
          commitment({ id: "c_dev_dishes", kind: "favour", with: ["pov"], text: "Cover Sam's Monday dish shift", due: null, status: "kept", made: 430, closed: 1000 }),
        ],
        witness: [
          witness({ at: 1890, what: "Sam asked Rosie for a raise at the counter.", how: "saw", by: null, place: "diner" }),
          witness({ at: 1350, what: "Mara said the party is at the apartment, Saturday at four.", how: "told", by: "npc_mara", place: "apartment" }),
        ],
        summary: "",
      },
      {
        entity: "npc_rosie",
        name: "Rosie Alvarez",
        fidelity: {
          entity: "npc_rosie",
          level: "live",
          score: 146.1,
          reasons: [
            { label: "In the scene", points: 45 },
            { label: "Named this turn", points: 40 },
            { label: "Regard with you", points: 3.2 },
            { label: "Knows you", points: 10 },
            { label: "In 1 story track", points: 8 },
            { label: "1 pending with you", points: 15 },
            { label: "Lead", points: 15 },
            { label: "Seen with you lately", points: 9.9 },
            { label: "The author: always Live", points: 0 },
          ],
          pin: { gm: null, author: "live" },
        },
        refreshQueued: false,
        intent: null,
        mind: {
          at: 1890,
          round: 6,
          level: "live",
          place: "diner",
          moment: "turn",
          reason: "live",
          monologue: 'Another ask for more money, and in front of the regulars. Sam does cover the holiday shifts; I can\'t pretend otherwise. But if the Main Street offer goes through before winter, a raise is a promise I can\'t keep. Saying "later" is kinder than saying no.',
          depiction: "Rosie keeps wiping the same stretch of counter, slower than it needs, and answers without quite meeting Sam's eyes.",
          intent: "Put Sam off without a flat no, and keep the sale quiet until the papers are signed.",
          reactions: ["If Sam brings up Main Street, she changes the subject.", "If Dev backs Sam up, she softens and offers an extra shift."],
          plans: [],
          mood: "guarded",
          interrupt: null,
          withheld: false,
          clock: clock(1890),
        },
        plans: [plan(rosieBroker), plan({ id: "pl_rosie_order", what: "Place the weekly order with the supplier", kind: "work", when: { from: 900, to: 960 }, where: "back_office", with: [], priority: 3, status: "done", made: 480, source: "memory", closed: 960, reason: null })],
        notes: [note({ id: "n_rosie_raise", text: "Sam asked for a raise again, in front of the regulars.", salience: 4, at: 1890 }), note({ id: "n_rosie_offer", text: "The Main Street offer stands until the first of November.", salience: 5, at: 900 })],
        commitments: [commitment({ id: "c_rosie_answer", kind: "promise", with: ["pov"], text: "Give Sam an answer about the raise by Friday", due: 6600, status: "open", made: 1890, closed: null })],
        witness: [
          witness({ at: 1890, what: "Sam asked for a raise at the counter, in front of the regulars.", how: "saw", by: null, place: "diner" }),
          witness({ at: 960, what: "The broker called: the Main Street buyer wants an answer by November.", how: "told", by: null, place: "back_office" }),
        ],
        summary: "Rosie has run the diner for twenty-two years and trusts Sam with the morning rush. She is weighing an offer for the building and has told no one on the crew.",
      },
      {
        entity: "npc_mara",
        name: "Mara Lopez",
        fidelity: {
          entity: "npc_mara",
          level: "live",
          score: 43.8,
          reasons: [
            { label: "Knows you", points: 10 },
            { label: "In 1 story track", points: 8 },
            { label: "1 pending with you", points: 15 },
            { label: "Supporting", points: 5 },
            { label: "Seen with you lately", points: 5.8 },
            { label: "Pinned at live by the GM", points: 0 },
          ],
          pin: { gm: "live", author: null },
        },
        refreshQueued: false,
        intent: null,
        mind: {
          at: 1890,
          round: 6,
          level: "live",
          place: "apartment",
          moment: "turn",
          reason: "live",
          monologue: "Four days to go. The balloons are in the hall closet and the cake is ordered under Dev's name. If Sam comes home early on Saturday it's all ruined, so Dev has to keep Sam out until four.",
          depiction: "Mara answers Sam's text with three exclamation marks and no actual news.",
          intent: "Finish the decorations by Saturday noon, and make sure Sam suspects nothing.",
          reactions: ["If Sam mentions Saturday, she says she's working a double."],
          plans: [],
          mood: "excited",
          interrupt: null,
          withheld: false,
          clock: clock(1890),
        },
        plans: [plan(maraBanner)],
        notes: [note({ id: "n_mara_closet", text: "Sam almost saw the balloons in the hall closet.", salience: 3, at: 1290 })],
        commitments: [commitment({ id: "c_mara_party", kind: "plan", with: ["npc_dev"], text: "Throw Sam a surprise party on Saturday at four", due: 8160, status: "open", made: 1350, closed: null })],
        witness: [witness({ at: 1290, what: "Sam came home early from the diner.", how: "saw", by: null, place: "apartment" })],
        summary: "",
      },
      {
        entity: "npc_teo",
        name: "Teo Brandt",
        fidelity: {
          entity: "npc_teo",
          level: "near",
          score: 54.9,
          reasons: [
            { label: "In the scene", points: 45 },
            { label: "Seen with you lately", points: 9.9 },
          ],
          pin: { gm: null, author: null },
        },
        refreshQueued: true,
        intent: { text: "", approach: "reactive" },
        mind: null,
        plans: [],
        notes: [],
        commitments: [],
        witness: [witness({ at: 1890, what: "Sam asked Rosie for a raise at the counter.", how: "saw", by: null, place: "diner" })],
        summary: "",
      },
      {
        entity: "npc_haskell",
        name: "Mr. Haskell",
        fidelity: {
          entity: "npc_haskell",
          level: "far",
          score: 30,
          reasons: [
            { label: "Story role", points: 20 },
            { label: "Named by a world rule", points: 5 },
            { label: "Supporting", points: 5 },
          ],
          pin: { gm: null, author: null },
        },
        refreshQueued: false,
        intent: null,
        mind: {
          at: 960,
          round: 3,
          level: "far",
          place: null,
          moment: "beat",
          reason: "the broker returns his call",
          monologue: "Rosie hasn't said no, which means she's counting. Two more weeks of slow winter trade and she'll take the shell company's number. Better that nobody on Main Street learns who is behind it.",
          depiction: "Mr. Haskell leaves Rosie a polite voicemail from an unlisted number.",
          intent: "Get Rosie's signature before the first of November through the broker, without showing his hand.",
          reactions: [],
          plans: [],
          mood: "patient",
          interrupt: "He wants Rosie's answer before she closes up tonight.",
          withheld: true,
          clock: clock(960),
        },
        plans: [plan(haskellBroker)],
        notes: [],
        commitments: [],
        witness: [],
        summary: "",
      },
      {
        entity: "npc_vic",
        name: "Vic Moreau",
        fidelity: { entity: "npc_vic", level: "background", score: 0, reasons: [{ label: "Removed", points: 0 }], pin: { gm: null, author: null } },
        refreshQueued: false,
        intent: null,
        mind: null,
        plans: [],
        notes: [],
        commitments: [],
        witness: [],
        summary: "",
      },
    ],
  };
}

export function gmFixture(): GmView {
  const entity = (id: string, name: string, kind: string, tier: string, place: string | null, rest: Partial<GmEntity> = {}): GmEntity => ({ id, name, kind, tier, agent: false, pov: false, gone: false, spawned: false, visibility: "public", place, holder: null, claimed: false, fields: [], relations: [], levels: gmLevels(tier === "principal" ? LEADS : tier === "supporting" ? SUPPORTING : BACKGROUND), class: {}, tags: [], sheet: null, life: { state: "alive", label: "Alive", acts: true, everyone: true, aware: [], unaware: [] }, ...rest });
  return {
    entities: [
      entity("pov", "Sam Rivera", "person", "principal", "diner", {
        pov: true,
        fields: personFields(4600, 62, "calm", "Server at Rosie's"),
        relations: [
          { type: "knows", to: "npc_rosie", toName: "Rosie Alvarez" },
          { type: "knows", to: "npc_dev", toName: "Dev Patel" },
          { type: "member_of", to: "diner_crew", toName: "Rosie's crew", fields: { role: "server", rank: 3 } },
          { type: "owns", to: "civic", toName: "Honda Civic" },
        ],
        sheet: [
          { title: "Vitals", rows: [{ label: "Stamina", value: "6 / 10", pool: { current: 6, min: 0, max: 10 } }, { label: "Level", value: "2", detail: "340 XP, 600 for level 3", progress: { level: 2, xp: 340, from: 200, next: 600 } }] },
          { title: "Skills", rows: [{ label: "Barista", value: "+3" }, { label: "Persuade", value: "+1", detail: "from Charm" }] },
        ],
      }),
      entity("npc_rosie", "Rosie Alvarez", "npc", "principal", "diner", {
        agent: true,
        fields: [...npcFields(128500, 70, "tense", "Owner", "Wants to sell the diner before winter"), { id: "last_raise", label: "last_raise", type: "text", value: "two years ago", extra: true }],
        relations: [
          { type: "regard", to: "pov", toName: "Sam Rivera", fields: { warmth: 20, trust: 35, respect: 40 }, value: 32 },
          { type: "member_of", to: "diner_crew", toName: "Rosie's crew", fields: { role: "owner", rank: 1 } },
          { type: "knows", to: "npc_dev", toName: "Dev Patel" },
        ],
        sheet: [{ title: "Vitals", rows: [{ label: "Stamina", value: "8 / 10", pool: { current: 8, min: 0, max: 10 } }] }],
      }),
      entity("npc_dev", "Dev Patel", "npc", "supporting", "diner", {
        agent: true,
        fields: npcFields(2000, 35, "happy", "Mechanic", "Owes Kim's Garage for the jon boat parts"),
        relations: [
          { type: "knows", to: "pov", toName: "Sam Rivera" },
          { type: "regard", to: "npc_mara", toName: "Mara Lopez", fields: { warmth: 60, trust: 50, respect: 45 }, value: 55 },
        ],
        // Cast life 3: the planner lays his day (GM → Routines).
        levels: gmLevels(SUPPORTING, { money: 4, castlife: 3 }),
        class: { story_role: ["best_friend"] },
        tags: ["mechanic", "night_owl"],
      }),
      entity("npc_mara", "Mara Lopez", "npc", "supporting", "apartment", { fields: npcFields(0, 80, "calm", "Landlord", "Planning Sam's surprise party"), relations: [{ type: "knows", to: "pov", toName: "Sam Rivera" }] }),
      entity("npc_teo", "Teo Brandt", "npc", "background", "diner", { spawned: true, fields: npcFields(1200, 50, "calm", "Delivery driver", "") }),
      entity("npc_vic", "Vic Moreau", "npc", "background", "garage", { gone: true, fields: npcFields(800, 40, "tense", "Tow driver", "") }),
      entity("npc_haskell", "Mr. Haskell", "npc", "supporting", null, { agent: true, visibility: "secret", levels: gmLevels(SUPPORTING, { castlife: 3 }), fields: npcFields(0, 60, "calm", "Developer", "Buying up Main Street through a shell company") }),
      entity("diner_crew", "Rosie's crew", "group", "background", "diner"),
      entity("civic", "Honda Civic", "vehicle", "background", "apartment", { fields: [{ id: "fuel", label: "fuel", type: "number", value: 38, min: 0, max: 100 }, { id: "owner", label: "owner", type: "ref", value: "pov", ref: "person" }] }),
      entity("glovebox", "Glovebox", "container", "background", "apartment", { holder: "civic", visibility: "discoverable", fields: [{ id: "capacity_l", label: "capacity_l", type: "number", value: 4 }, { id: "stock", label: "stock", type: "text", value: "Registration, gum, $7 in quarters" }] }),
      entity("drill", "Cordless drill", "thing", "background", "diner", { holder: "npc_dev" }),
      // Things the player said they had: one in Sam's hands, one left lying in the diner, and a coffee drunk since (used up, so off the Claimed list).
      entity("item:claim_1f3a9c2e04b7", "Zippo lighter", "thing", "background", "diner", { holder: "pov", spawned: true, claimed: true, fields: [{ id: "claimed", label: "claimed", type: "bool", value: true, extra: true }] }),
      entity("item:claim_7d20e9a1c5f3", "Dog-eared paperback", "thing", "background", "diner", { spawned: true, claimed: true, fields: [{ id: "claimed", label: "claimed", type: "bool", value: true, extra: true }] }),
      entity("item:claim_b81c4f6d2a90", "Iced coffee", "thing", "background", "diner", { holder: "npc_rosie", spawned: true, claimed: true, gone: true, fields: [{ id: "claimed", label: "claimed", type: "bool", value: true, extra: true }] }),
      entity("dev_checking", "Dev's checking", "account", "background", null, { balance: 412650, fields: [{ id: "owner", label: "Owner", type: "ref", value: "npc_dev", ref: "person" }] }),
    ],
    kinds: [
      { id: "person", label: "Person", extends: "thing" },
      { id: "npc", label: "NPC", extends: "person" },
      { id: "group", label: "Group", extends: "thing" },
      { id: "vehicle", label: "Vehicle", extends: "container" },
      { id: "container", label: "Container", extends: "thing" },
      { id: "thing", label: "Thing", extends: null },
      { id: "account", label: "Account", extends: null },
    ],
    tiers: [
      { id: "principal", label: "Leads" },
      { id: "supporting", label: "Supporting cast" },
      { id: "background", label: "Background" },
    ],
    lifeStates: [
      { id: "alive", label: "Alive", acts: true },
      { id: "dying", label: "Dying", acts: false },
      { id: "dead", label: "Dead", acts: false },
    ],
    domains: DOMAINS.map((id) => ({ id, label: id === "castlife" ? "Cast life" : `${id.charAt(0).toUpperCase()}${id.slice(1)}` })),
    // The world fixture's facets, its GM-only one included.
    classifications: worldFixture().classifications,
    places: [
      { id: "diner", name: "Rosie's Diner", visibility: "public", parent: null, pins: 0 },
      { id: "back_office", name: "Rosie's back office", visibility: "secret", parent: "diner", pins: 0 },
      { id: "apartment", name: "Apartment 4B", visibility: "public", parent: null, pins: 0 },
      { id: "garage", name: "Kim's Garage", visibility: "public", parent: null, pins: 0 },
      { id: "quarry", name: "The old quarry", visibility: "discoverable", parent: null, pins: 0 },
    ],
    tracks: [
      { id: "q_raise", label: "Ask for a raise", kind: "quest", visibility: "public", owner: null, stage: "case", stages: [{ id: "idea", label: "Thinking about it" }, { id: "case", label: "Build the case", truth: "Rosie gave the last raise to whoever covered the holiday shifts." }, { id: "ask", label: "Ask Rosie" }, { id: "raise", label: "Got the raise" }] },
      { id: "party", label: "The surprise party", kind: "secret", visibility: "secret", owner: null, stage: "planning", stages: [{ id: "planning", label: "Planning", truth: "Mara and Dev are planning a surprise party for Sam on Saturday." }, { id: "revealed", label: "Revealed" }] },
      { id: "boat", label: "Fix up the jon boat", kind: "agenda", visibility: "hidden", owner: "Dev Patel", stage: "part", stages: [{ id: "part", label: "Needs a part" }, { id: "water", label: "On the water" }] },
    ],
    relationTypes: [
      { id: "in", label: "In", from: "*", to: "*", fields: [] },
      { id: "knows", label: "Knows", from: "*", to: "*", fields: [] },
      { id: "member_of", label: "Member of", from: "*", to: "group", fields: [{ id: "role", label: "Role", type: "text" }, { id: "rank", label: "Rank", type: "number", min: 1, max: 10 }] },
      { id: "owns", label: "Owns", from: "person", to: "*", fields: [] },
      { id: "regard", label: "Regard", from: "person", to: "person", fields: ["warmth", "trust", "respect"].map((id) => ({ id, label: id, type: "number" as const, min: -100, max: 100 })) },
    ],
    money: [
      gmMoney("npc_dev", "Dev Patel", 4, true, "dev_checking", "Dev's checking", 412650, [
        { at: "Mon 12 Oct 2026, 11:30", memo: "Living costs", cents: -19000 },
        { at: "Fri 9 Oct 2026, 11:30", memo: "Payroll: $1,060.00 gross, $204.58 withheld", cents: 85542 },
        { at: "Thu 1 Oct 2026, 11:30", memo: "Rent, Unit 3", cents: -97500 },
      ], [
        { at: "Fri 9 Oct 2026, 11:30", text: "Payday: $855.42 net ($1,060.00 gross)." },
        { at: "Thu 1 Oct 2026, 11:30", text: "Rent, Unit 3: $975.00 paid." },
      ]),
      gmMoney("npc_mara", "Mara Lopez", 2, false, "mara_checking", "Mara's checking", 1235000, [], []),
    ],
    encounter: null,
    edits: [
      { messageId: "m4", seq: 12, lines: ["Rosie Alvarez's mood: tense"] },
      { messageId: "m2", seq: 7, lines: ["Vic Moreau is gone"] },
    ],
    refused: [{ id: "w-17", reason: "Dev Patel's energy must be between 0 and 100." }],
    minds: gmMinds(),
  };
}

/**
 * A starter world's map in a new chat, built by the engine itself: Port Alder's town on a ring
 * (`?map=ring`, for checking label placement), Harrowmere's hall on its ground floor (`?map=manor`),
 * Brindlemere's market square (`?map=square`); in `display` when the chat picked one.
 */
export function starterMap(template: string, display: MapDisplay | null = null): JsonValue {
  const make = template === "grid_inn" ? gridInn : STARTER_WORLDS[template];
  if (!make) return null;
  const world = make("preview", template);
  const registry = createRegistry(ALL_PACKS);
  return buildMapView(registry.context(world, initialState(world, "preview", registry)), display) as unknown as JsonValue;
}

/**
 * A new chat before anything opened the POV's money: Money (level 4) and the HUD cash show the
 * authored opening balances, which is what opening the panel posts, so the figures don't move.
 */
export function freshFixture(chatId: string): StateView {
  const view = stateFixture(chatId);
  view.chips = [];
  view.journal = [];
  view.pending = [];
  if (view.hud) {
    view.hud.cash = { cents: 8500 };
    if (view.hud.fixes.cash) view.hud.fixes.cash.value = 8500;
  }
  view.panels["economy.money"] = starterMoney("modern_slice_of_life");
  return view;
}

/** The same chat after a user-message edit: paused on Keep / Discard. */
export function pausedFixture(chatId: string): StateView {
  const view = stateFixture(chatId);
  view.status = "paused";
  view.chips = [...view.chips.filter((chip) => chip.messageId !== "m3"), { id: "c-keep", kind: "keep_report", messageId: "m3", label: "You edited this message", detail: "Later turns don't change the world until you choose.", actions: [{ id: "keep", label: "Keep later turns", style: "primary" }, { id: "discard", label: "Discard them", style: "danger" }], expires: "never" }];
  view.keepReport = [
    { messageId: "m4", parentPath: "f".repeat(32), ref: { in: "events", index: 2 }, status: "dropped", text: "Paid Dev $20 — no longer valid here" },
    { messageId: "m4", parentPath: "f".repeat(32), ref: { in: "post", seq: 21, index: 0 }, status: "inert", text: "Lent Dev the drill" },
    { messageId: "m4", parentPath: "f".repeat(32), ref: { marker: 22 }, status: "inert", text: "Paused the clock" },
  ];
  return view;
}

export const WORLDS: WorldIndex[] = [
  { id: "w-maple", name: "Maple Falls", head: "c3d4e5f60718293a4b5c6d7e8f90a1b2", loreBookId: "book-engine", revisions: ["0f0f", "a1b2c3d4e5f60718293a4b5c6d7e8f90", "c3d4e5f60718293a4b5c6d7e8f90a1b2"] },
  { id: "w-manor", name: "Blackwood Manor", head: "77aa", loreBookId: null, revisions: ["77aa"] },
  // Wrapping and escaping checks: a very long name, an unbroken token and markup that must render as text.
  { id: "w-long", name: "The Exceptionally Long-Named Port Alder Lakeshore Simulation World With Ferries, Fishing Boats And A Lighthouse <b>bold?</b> & Co. Supercalifragilisticexpialidociousharborfront", head: "88bb", loreBookId: null, revisions: ["88bb"] },
];

/** What upgrading the preview chat to Maple Falls' head would bring in (DESIGN §4.3 `migrate`). */
export const UPGRADE_PREVIEW: UpgradePreview = {
  from: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
  to: "c3d4e5f60718293a4b5c6d7e8f90a1b2",
  entities: [
    { entity: "rosa", name: "Rosa Vance", kind: "Character", status: "new", changes: [{ id: "rosa:entity", label: "Add to the chat", from: "not in the chat", to: "Character, at Rosie's Diner", pick: "take", options: ["take", "keep"], why: "new", targets: [{ entity: "rosa", part: "entity" }] }] },
    { entity: "scooter", name: "Dev's scooter", kind: "Vehicle", status: "new", changes: [{ id: "scooter:entity", label: "Add to the chat", from: "not in the chat", to: "Vehicle, at 114 Harbor Street", pick: "take", options: ["take", "keep"], why: "new", targets: [{ entity: "scooter", part: "entity" }] }] },
    {
      entity: "dev",
      name: "Dev Okafor",
      kind: "Character",
      status: "changed",
      changes: [
        { id: "dev:field:appointments", label: "Appointments", from: "none", to: '1 × [{"at":20000,"minutes":60,"place":"clinic","label":"Dentist"}]', pick: "take", options: ["take", "keep"], why: "unchanged", targets: [{ entity: "dev", part: "field", field: "appointments" }] },
        { id: "dev:field:home", label: "Home", from: "114 Harbor Street", to: "Lakeview Apartments", pick: "take", options: ["take", "keep"], why: "unchanged", targets: [{ entity: "dev", part: "field", field: "home" }] },
        { id: "dev:field:employer", label: "Employer", from: "Alder Automotive", to: "Alder Harbor Marina", pick: "take", options: ["take", "keep"], why: "unchanged", targets: [{ entity: "dev", part: "field", field: "employer" }] },
        { id: "dev:field:mood", label: "Mood", from: "cheerful", to: "worried", pick: "keep", options: ["take", "keep"], why: "changed in play", targets: [{ entity: "dev", part: "field", field: "mood" }] },
        { id: "dev:rel:member_of:guild", label: "Member of: Harbor Guild", from: "not linked", to: "linked", pick: "take", options: ["take", "keep"], why: "unchanged", targets: [{ entity: "dev", part: "relation", rel: "member_of", to: "guild" }] },
      ],
    },
    { entity: "acct_pov_checking", name: "Checking", kind: "Account", status: "changed", changes: [{ id: "acct_pov_checking:field:opening", label: "Opening balance", from: "$1,842.17", to: "$2,400.00", pick: "keep", options: ["take", "keep"], why: "changed in play", targets: [{ entity: "acct_pov_checking", part: "field", field: "opening" }] }] },
    { entity: "old_boat", name: "The old skiff", kind: "Vehicle", status: "removed", changes: [{ id: "old_boat:entity", label: "Stay in the chat", from: "in the chat", to: "out of the world", pick: "keep", options: ["keep", "remove"], why: "removed", targets: [{ entity: "old_boat", part: "entity" }] }] },
  ],
  tracks: [{ text: "Raise the barn: back to Rumours; this revision has no stage “Old idea”" }],
};

export function worldFixture(): WorldDoc {
  const terrain: string[] = [];
  for (let y = 0; y < 12; y += 1) for (let x = 0; x < 16; x += 1) terrain.push(y === 6 || x === 7 ? "road" : x > 11 && y < 4 ? "water" : (x + y) % 7 === 0 ? "forest" : x < 4 && y > 8 ? "building" : "grass");
  return compileMaps({
    format: "lre-world-v1",
    id: "w-maple",
    name: "Maple Falls",
    engineVersion: "0.0.1",
    packs: { calendar: { version: 1, config: {} }, space: { version: 1, config: {} }, economy: { version: 1, config: { region: "us-oh" } }, story: { version: 1, config: {} } },
    pins: { generators: { "economy.wallet": 1, "gear.glovebox": 2 }, tables: { "economy.catalog": "9c1d0e7a55aa12bb", "economy.regions": "41aa88d0c3e2f1a9" } },
    kinds: {
      person: {
        id: "person",
        label: "Person",
        fields: {
          cash: { type: "money", label: "Cash", min: 0, domain: "money", level: 2 },
          energy: { type: "number", min: 0, max: 100, label: "Energy" },
          mood: { type: "enum", values: ["calm", "happy", "tense"] },
          job: { type: "text" },
          xp: { type: "number", label: "XP", min: 0, default: 0 },
          level: { type: "number", label: "Level", min: 1, default: 1 },
          might: { type: "number", label: "Might", default: 10 },
          might_mod: { type: "number", label: "Might mod", derived: "floor((self.might - 10) / 2)" },
          hp_max: { type: "number", label: "Max HP", derived: "10 + self.might_mod * 2" },
          hp: { type: "number", label: "Hit points", pool: { max: "hp_max" } },
        },
      },
      npc: { id: "npc", label: "NPC", extends: "person", fields: { schedule: { type: "ref", label: "Schedule" }, wariness: { type: "number", derived: "100 - energy" } } },
      vehicle: { id: "vehicle", label: "Vehicle", pack: "vehicles", fields: { fuel: { type: "number", min: 0, max: 100, domain: "vehicles", level: 2 }, owner: { type: "ref", ref: "person" } } },
    },
    relations: { roommate: { id: "roommate", label: "Roommate", from: "person", to: "person", cardinality: "many_many", symmetric: true, fields: {} } },
    entities: {
      pov: { id: "pov", kind: "person", name: "Sam Rivera", tier: "principal", fields: { cash: 4600, energy: 62, job: "Server", xp: 450, level: 2, might: 14, hp: 9 }, relations: [{ type: "roommate", to: "npc_dev" }, { type: "member_of", to: "apt_4b", fields: { role: "Tenant", since: "2025-06-01" } }, { type: "member_of", to: "diner_crew", fields: { role: "Server", rank: 2 } }], class: { story_role: ["lead"] } },
      npc_rosie: { id: "npc_rosie", kind: "npc", name: "Rosie Alvarez", tier: "principal", fields: { cash: 120000, mood: "calm" }, relations: [{ type: "member_of", to: "diner_crew", fields: { role: "Owner", rank: 1 } }], agent: true, class: { story_role: ["mentor"], secret: ["in_debt"] }, tags: ["early_riser"] },
      npc_dev: { id: "npc_dev", kind: "npc", name: "Dev Patel", tier: "regulars", fields: { mood: "happy" }, relations: [{ type: "owns", to: "boat1" }, { type: "member_of", to: "apt_4b", fields: { role: "Tenant" } }], agent: true, class: { story_role: ["best_friend"] }, tags: ["mechanic", "night_owl"] },
      npc_mara: { id: "npc_mara", kind: "npc", name: "Mara Kim", tier: "supporting", fields: { mood: "calm" }, relations: [{ type: "member_of", to: "diner_crew", fields: { role: "Cook", rank: 2 } }], class: { story_role: ["rival"], secret: ["informant"] }, tags: ["night_owl"] },
      npc_drifter: { id: "npc_drifter", kind: "npc", name: "The Drifter", tier: "background", fields: {}, relations: [], visibility: "known_by", knownBy: { memberOf: ["diner_crew"] } },
      apt_4b: { id: "apt_4b", kind: "household", name: "Apartment 4B", tier: "background", fields: {}, relations: [] },
      diner_crew: { id: "diner_crew", kind: "company", name: "Rosie's Diner crew", tier: "background", fields: {}, relations: [] },
      car1: { id: "car1", kind: "vehicle", name: "2011 Civic", tier: "supporting", fields: { fuel: 38, owner: "pov" }, relations: [] },
    },
    classifications: {
      story_role: {
        id: "story_role",
        label: "Story role",
        multiple: false,
        shown: true,
        order: 0,
        description: "Who someone is to your story.",
        values: { lead: { label: "Lead" }, ally: { label: "Ally" }, best_friend: { label: "Best friend", parent: "ally" }, mentor: { label: "Mentor", parent: "ally" }, rival: { label: "Rival" }, love_interest: { label: "Love interest" } },
      },
      secret: {
        id: "secret",
        label: "Hidden agenda",
        multiple: true,
        order: 1,
        description: "GM-only: what players must find out for themselves.",
        values: { in_debt: { label: "In debt", description: "Owes the wrong people." }, informant: { label: "Informant" }, police: { label: "Police informant", parent: "informant" } },
      },
    },
    places: {
      maple: { id: "maple", name: "Maple Falls", timeZone: "America/New_York", grid: "town", fields: {} },
      diner: { id: "diner", name: "Rosie's Diner", parent: "maple", sceneType: "conversation", cell: { x: 7, y: 5 }, fields: {} },
      apartment: { id: "apartment", name: "Apartment 4B", parent: "maple", sceneType: "downtime", cell: { x: 2, y: 9 }, fields: {} },
    },
    routes: { r1: { id: "r1", from: "apartment", to: "diner", modes: { walk: { minutes: 18 }, road: { minutes: 5, distanceKm: 2.4 } }, bidirectional: true } },
    grids: { town: { id: "town", width: 16, height: 12, cellMeters: 100, terrain, blocked: [20, 21, 36, 37], zones: { downtown: [87, 88, 89, 103, 104, 105] } } },
    maps: {
      diner_floor: {
        id: "diner_floor",
        scope: "diner",
        title: "Rosie's Diner",
        layout: ["###########", "#bbbb#kkkk#", "#bbbb+kkkk#", "#cccccccc.#", "####+######"],
        legend: { b: { place: "diner_booths" }, k: { place: "diner_kitchen" }, c: { place: "diner_counter" } },
        places: [
          { id: "diner_booths", name: "Booths" },
          { id: "diner_kitchen", name: "Kitchen" },
          { id: "diner_counter", name: "Counter" },
        ],
      },
    },
    rules: { payday: { id: "payday", on: { tick: "day" }, when: "weekday(now) == 5", do: [{ type: "economy.pay", args: { to: "pov", cents: "61240" } }], interrupt: false } },
    actions: { "sheets.persuade": { id: "sheets.persuade", label: "Persuade", params: { target: { type: "ref", ref: "person" } }, requires: ["present(target)"], check: "persuade", outcomes: { success: [], partial: [], fail: [] }, duration: "5", lexicon: ["persuade", "convince", "talk into"], observable: "talks earnestly" } },
    checks: { persuade: { id: "persuade", dice: "2d6", modifier: "charm(pov)", bands: [{ outcome: "fail", max: 5 }, { outcome: "partial", min: 6, max: 7 }, { outcome: "success", min: 8 }] } },
    calendar: { system: "gregorian", epoch: "2026-10-19T00:00", timeZone: "America/New_York", dayParts: [{ id: "morning", label: "Morning", start: "06:00" }, { id: "afternoon", label: "Afternoon", start: "12:00" }, { id: "evening", label: "Evening", start: "18:00" }, { id: "night", label: "Night", start: "22:00" }], holidays: [{ id: "halloween", label: "Halloween", rule: { type: "fixed", month: 10, day: 31 }, dayOff: false }, { id: "thanksgiving", label: "Thanksgiving", rule: { type: "nth_weekday", month: 11, weekday: 4, n: 4 }, dayOff: true }] },
    schedules: {
      rosie_shift: { id: "rosie_shift", owner: "npc_rosie", target: "place", recurrence: { every: "week", weekdays: [1, 2, 3, 4, 5, 6], except: ["thanksgiving"] }, slots: [{ start: "05:30", end: "14:00", value: "diner" }, { start: "14:00", end: "22:00", value: "home" }, { start: "22:00", end: "05:30", value: "home" }] },
      crew_breakfast: { id: "crew_breakfast", owner: { memberOf: ["diner_crew"], class: { story_role: ["ally"] }, tier: ["principal", "regulars"] }, target: "place", recurrence: { every: "week", weekdays: [0] }, slots: [{ start: "08:00", end: "09:00", value: "diner" }] },
      weather: { id: "weather", target: "weather", recurrence: { every: "day" }, slots: [{ start: "00:00", end: "12:00", weighted: [{ value: "clear", weight: 3 }, { value: "light_rain", weight: 2 }] }, { start: "12:00", end: "24:00", given: { clear: [{ value: "clear", weight: 4 }] }, weighted: [{ value: "clear", weight: 1 }] }] },
    },
    tracks: {
      q_raise: {
        id: "q_raise",
        kind: "quest",
        label: "Ask for a raise",
        owner: "pov",
        start: "start",
        visibility: "public",
        stages: {
          start: { label: "Thinking about it", next: [{ to: "case", when: "regard(npc_rosie, pov) >= 1" }] },
          case: { label: "Build the case", cue: "Rosie respects people who show up early.", objectives: ["shifts_covered >= 2"], next: [{ to: "ask", when: "vouched" }], fail: { when: "fired", to: "lost" }, hints: ["Mr. Okafor talks to Rosie every morning."] },
          ask: { label: "Ask Rosie", next: [{ to: "done", when: "outcome == 'yes'" }, { to: "case", when: "outcome == 'later'" }] },
          done: { label: "Raise granted", next: [], rewards: [{ type: "set", args: { entity: "pov", field: "wage", value: "wage + 150" } }] },
          lost: { label: "Lost the job", next: [] },
          orphan: { label: "Old idea", next: [] },
        },
      },
    },
    tables: {
      "economy.catalog": {
        id: "economy.catalog",
        pack: "economy",
        schema: "lre-table/economy.catalog/v1",
        revision: "9c1d0e7a55aa12bb3344556677889900",
        label: "Catalog",
        source: { dataPack: "modern-us", file: "us/prices.json", sourceSchema: "lre-data-src/us/prices/v1", reflectsPeriod: "2025", approximate: true, basis: "Typical US retail prices" },
        columns: { label: { type: "text" }, category: { type: "enum", values: ["food", "fuel", "household"] }, unit: { type: "text", optional: true }, price_cents: { type: "band", unit: "cents" } },
        rows: {
          coffee: { label: "Coffee", category: "food", unit: "cup", price_cents: { min: 200, typical: 325, max: 550 } },
          pancakes: { label: "Pancake stack", category: "food", price_cents: { min: 600, typical: 899, max: 1400 } },
          gas_regular: { label: "Gasoline (regular)", category: "fuel", unit: "gal", price_cents: { min: 280, typical: 349, max: 520 } },
          bad_row: { label: "Paper towels", category: "household", price_cents: { min: 900, typical: 400, max: 1200 } },
        },
      },
    },
    realism: { preset: "story", levels: { money: 1, gear: 1, vehicles: 1, castlife: 1, relationships: 1, space: 2, calendar: 2, weather: 1, sheets: 1 }, tierCaps: { principal: {}, supporting: {}, background: {} }, claims: { mode: "ask", capped: true } },
    time: { sceneTicks: { conversation: 2, action: 0.5, exploration: 10, downtime: 30 }, interrupts, speedThrough: { sleep: { mode: "offer", thresholdMinutes: 30 } }, montage: "key", unitCap: { agentDays: 600, events: 5000 } },
    sections: { scene: { id: "scene", label: "Scene", rank: 10, template: "Place: {place}. Present: {present}.", position: { type: "native" } } },
    lore: {
      harbor_history: { id: "harbor_history", title: "Harbor history", content: "Maple Street grew around the old cannery.", keys: ["cannery", "harbor"], links: [], aliases: ["the old cannery"], topics: ["Town history"] },
      rosies_diner: { id: "rosies_diner", title: "Rosie's Diner", content: "Rosie's opens at six and closes at three. The booths by the window go first; the counter is for regulars.", keys: ["diner"], links: ["diner", "npc_rosie"], aliases: ["Rosie's", "the diner"], topics: ["Town places"], source: { kind: "book", bookId: "book-town", entryId: "e-diner", hash: "stale" } },
      rosie_debt: { id: "rosie_debt", title: "Rosie's debt", content: "Rosie owes the bank for the diner's new fryer and hides it from the staff.", keys: [], links: ["npc_rosie"], topics: ["Rosie"], secret: true, gate: "stage.secret_debt == 'known'", audience: ["npc.choose", "brief"] },
      okafor_breakfast: { id: "okafor_breakfast", title: "Mr. Okafor's breakfast", content: "Mr. Okafor takes two eggs over easy and reads the paper front to back.", keys: [], links: [], source: { kind: "chat", chatId: "chat-1", messageId: "m-12" } },
    },
    // Build → Routines: the crew's opening shift and the regulars' lunch rest on lore, Dev's week on his sheet; night owls sleep late; Mara has no routine.
    routines: {
      crew_days: { id: "crew_days", label: "The diner crew's days", owner: "diner_crew", blocks: [{ id: "open_diner", label: "Opens the diner", activity: "work", kind: "fixed", at: "05:30", minutes: 570, priority: 5, place: { place: "diner" }, days: { off: "never" }, source: { type: "lore", entry: "rosies_diner", quote: "Rosie's opens at six and closes at three." } }] },
      regulars: { id: "regulars", label: "Regulars at the counter", owner: "npc", blocks: [{ id: "counter_lunch", label: "Lunch at the counter", activity: "lunch", kind: "optional", window: { from: "11:30", to: "13:30" }, minutes: 40, chance: 0.5, perWeek: 2, place: { place: "diner" }, source: { type: "lore", entry: "rosies_diner", quote: "the counter is for regulars" } }] },
      night_owls: { id: "night_owls", label: "Night owls", owner: { tag: ["night_owl"] }, blocks: [{ id: "sleep", label: "Sleep", activity: "sleep", kind: "flexible", window: { from: "01:00", to: "03:00" }, minutes: 450, priority: 5, place: "home" }] },
      dev_week: {
        id: "dev_week",
        label: "Dev's week",
        owner: "npc_dev",
        blocks: [
          { id: "boat", label: "Works on the boat", activity: "leisure", kind: "flexible", window: { from: "17:00", to: "20:00" }, minutes: 120, perWeek: 3, priority: 4, place: "here", company: { who: { ids: ["pov"] }, invite: true }, source: { type: "sheet", entity: "npc_dev", field: "job", quote: "Mechanic" } },
          { id: "breakfast", off: true },
        ],
      },
      mara_none: { id: "mara_none", owner: "npc_mara", inherit: false, blocks: [] },
    },
    loreIndex: { terms: { "the diner": ["rosies_diner"], cannery: ["harbor_history"] }, topics: { town_places: { label: "Town places", entries: ["rosies_diner"] } } },
    steps: { brief: { id: "brief", purpose: "brief", template: "Summarize the scene for the narrator.", output: "text", signals: ["scene_change"] } },
    suppressed: [],
    seedMode: "fresh",
    lenientPricing: false,
    currency: { code: "USD", symbol: "$", minorUnit: "cent", decimals: 2, format: "{sign}{symbol}{amount}" },
    pov: "pov",
    tiers: {
      principal: { label: "Leads", band: "principal", order: 0 },
      regulars: { label: "Regulars", band: "supporting", order: 1, agentDefault: true, description: "The diner's daily faces: they keep their own routines." },
      supporting: { label: "Supporting", band: "supporting", order: 2 },
      background: { label: "Background", band: "background", order: 3 },
    },
    ruleset: {
      adjudication: { ...presetAdjudication("balanced"), preset: "custom", checks: "risky", riskyAt: 0.8, description: { weight: "dc", max: 3, advantageAt: 2 } },
      minLevels: { sheets: 3 },
      progression: {
        character: { label: "Level", xpField: "xp", levelField: "level", thresholds: [0, 300, 900, 2700, 6500], maxLevel: 5, kind: "person", onLevel: [{ type: "add", args: { entity: "self", field: "might", delta: "=level % 2 == 0 ? 1 : 0" } }] },
      },
      sheet: {
        sections: [
          { id: "vitals", label: "Vitals", rows: [{ pool: "hp" }, { progression: "character" }, { field: "energy" }] },
          { id: "abilities", label: "Abilities", rows: [{ field: "might" }, { formula: "self.might_mod >= 0 ? \"+\" + self.might_mod : self.might_mod", label: "Might modifier" }, { field: "cash" }] },
        ],
      },
    },
    start: { place: "apartment", at: "2026-10-19T07:00" },
  });
}

/** What LumiRPEngine Studio has waiting in the preview (`?studio=`): nothing, a new world, a revision of Maple Falls (one taken before its head moved), or a world with an error. */
export type StudioCase = "none" | "new" | "revision" | "moved" | "errors";

/** Lore the Studio wrote with host macros in it, which Build lists for review before playing. */
const STUDIO_LORE: WorldDoc["lore"] = {
  foghorn: { id: "foghorn", title: "The foghorn", content: "{{user}} hears the foghorn from the breakwater before dawn; locals set their watches by it.", keys: ["foghorn"], links: [] },
  harbor_weather: { id: "harbor_weather", title: "Harbor weather", content: "Mornings on the lake start in {{random::fog,drizzle,a hard wind}} more often than not.", keys: ["weather", "fog"], links: [] },
};

/** The Studio's offer for a case, as its offer endpoint holds it (`StudioOffer`); null when nothing is waiting. */
export function studioOfferFixture(kind: StudioCase, chatId: string): StudioOffer | null {
  if (kind === "none") return null;
  const createdAt = Date.UTC(2026, 9, 19, 11, 20);
  if (kind === "revision" || kind === "moved") {
    const doc = worldFixture();
    doc.lore = { ...doc.lore, ...structuredClone(STUDIO_LORE) };
    doc.entities.npc_hale = { id: "npc_hale", kind: "npc", name: "Mrs. Hale", tier: "supporting", fields: { mood: "calm" }, relations: [] };
    // The Studio fixed what the preview's Maple Falls gets wrong: Rosie goes home to a real place, and Dev's boat isn't named.
    doc.places.rosie_house = { id: "rosie_house", name: "Rosie's house", parent: "maple", sceneType: "downtime", fields: {} };
    const shift = doc.schedules.rosie_shift;
    if (shift) shift.slots = shift.slots.map((slot) => (slot.value === "home" ? { ...slot, value: "rosie_house" } : slot));
    const dev = doc.entities.npc_dev;
    if (dev) dev.relations = dev.relations.filter((r) => r.to !== "boat1");
    const maple = WORLDS[0] as WorldIndex;
    return { offerId: `offer-${kind}`, doc: doc as unknown as JsonValue, mode: "revision", worldId: maple.id, baseRevision: kind === "moved" ? (maple.revisions[1] ?? maple.head) : maple.head, createdAt };
  }
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) return null;
  const doc = migrateWorld(make("w-studio", "Harbor Lights"));
  doc.lore = { ...doc.lore, ...structuredClone(STUDIO_LORE) };
  // A kind the Studio's draft named but never defined: an error, so the offer can't install as it is.
  if (kind === "errors") doc.entities.ghost = { id: "ghost", kind: "spectre", name: "The lighthouse ghost", tier: "background", fields: {}, relations: [] };
  return { offerId: `offer-${kind}`, doc: doc as unknown as JsonValue, mode: "new", attachChatId: chatId, createdAt };
}

export function settingsFixture(): UserSettings {
  return {
    v: 1,
    defaults: SETTINGS_DEFAULTS_REV,
    helper: { connectionId: "conn-ds", model: "deepseek-v4-flash", effort: "high", maxTokens: 8192, params: { temperature: 0.7 } },
    modelUse: {
      preset: "standard",
      steps: {
        interpret: { enabled: true, signals: ["typed_input"], route: { provider: "helper", connectionId: null, model: null }, maxTokens: 1500 },
        extract: { enabled: true, signals: ["reply"], maxTokens: 800 },
        "npc.choose": { enabled: true, signals: ["tie_zone", "invitation"] },
      },
      budgets: { pre: { calls: 2 }, post: { calls: 2 } },
      tokens: { sections: 600 },
    },
    realism: { preset: "story", levels: { money: 1, gear: 1, vehicles: 1, castlife: 1, relationships: 1, space: 2, calendar: 2, weather: 1, sheets: 1 }, tierCaps: { principal: {}, supporting: {}, background: {} }, claims: { mode: "real", capped: false } },
    time: { sceneTicks: { conversation: 2, action: 0.5, exploration: 10, downtime: 30 }, scale: 1, interrupts, speedThrough: { sleep: { mode: "offer", thresholdMinutes: 30 } }, montage: "key", unitCap: { agentDays: 600, events: 5000 } },
    overrideWorldDefaults: false,
    adjudication: presetAdjudication("crunchy"),
    overrideWorldAdjudication: false,
    inferred: null,
    extraction: { regard: { mode: "never" } },
    swipeDefault: "rerun",
    hideJsonBlocks: true,
    minds: defaultMindsSettings(),
    timeouts: { ...defaultTimeouts(), requestMs: 600_000, laneHeartbeatMs: "none" },
    jobs: { routineLoreTokens: 8000 },
  };
}

const DEFAULTS: Record<ExtractionType, ExtractionModeView["mode"]> = { time_advance: "auto", location: "auto", condition: "auto", routine: "auto", knows: "confirm", give: "confirm", purchase: "confirm", transfer: "confirm", regard: "confirm", quantity: "confirm", spawn: "confirm", life: "confirm" };

/** What the backend would derive: pins first, then learning on the connection, then D4 defaults. */
export function extractionView(settings: UserSettings): Record<ExtractionType, ExtractionModeView> {
  const out = {} as Record<ExtractionType, ExtractionModeView>;
  for (const type of Object.keys(DEFAULTS) as ExtractionType[]) {
    const pinned = settings.extraction[type];
    if (pinned) out[type] = { mode: pinned.mode, source: "pinned", connection: null, accepted: 4, rejected: 1 };
    else if (type === "purchase") out[type] = { mode: "auto", source: "learned", connection: { id: "conn-ds", name: "DeepSeek" }, accepted: 28, rejected: 2 };
    else if (type === "quantity" || type === "spawn") out[type] = { mode: "confirm", source: "bound", connection: null, accepted: 0, rejected: 0 };
    else out[type] = { mode: DEFAULTS[type], source: "default", connection: { id: "conn-ds", name: "DeepSeek" }, accepted: type === "give" ? 11 : 0, rejected: type === "give" ? 2 : 0 };
  }
  return out;
}

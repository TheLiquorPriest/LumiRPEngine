// What LumiRPEngine says to a model about playing an action through the rules, and a fight's rounds, on the harness engine: each tool's
// description and its arguments', and what those tools answer besides a result. Registry texts of the
// page "Harness engine", gathered by `harness-texts.ts`.

import { answerPrompt, HARNESS_FAMILY, type HarnessToolText, v } from "./harness-text-kit";
import type { PromptDef } from "./prompts";

/** The tools, by name. */
export const PLAY_TOOL = { actionPlay: "action_play", fightRead: "fight_read", fightStart: "fight_start", fightRound: "fight_round", fightEnd: "fight_end", mindFight: "mind_fight" } as const;

/** What these tools answer besides a result: ids, so code names each once. */
export const PLAY_NOTE = {
  author: "harness.note.play.author",
  inFight: "harness.note.play.in_fight",
  rejected: "harness.note.play.rejected",
  rolledOnly: "harness.note.play.rolled_only",
  undeclared: "harness.note.play.undeclared",
  takesNone: "harness.note.play.takes_none",
  played: "harness.note.play.played",
  playedNothing: "harness.note.play.played_nothing",
  retryOnce: "harness.note.play.retry_once",
  retryChanged: "harness.note.play.retry_changed",
  noCombat: "harness.note.fight.no_combat",
  noFight: "harness.note.fight.none",
  fightOn: "harness.note.fight.on",
  noStart: "harness.note.fight.no_start",
  needsAction: "harness.note.fight.needs_action",
  notUp: "harness.note.fight.not_up",
  undecided: "harness.note.fight.undecided",
  notDue: "harness.note.fight.not_due",
  badChoice: "harness.note.fight.bad_choice",
  badDecisions: "harness.note.fight.bad_decisions",
  nothing: "harness.note.fight.nothing",
  nextAction: "harness.note.fight.next_action",
  nextOthers: "harness.note.fight.next_others",
  nextOut: "harness.note.fight.next_out",
  ended: "harness.note.fight.ended",
  decided: "harness.note.fight.decided",
  mindNoTurn: "harness.note.fight.mind_no_turn",
  mindChoose: "harness.note.fight.mind_choose",
  mindDecided: "harness.note.fight.mind_decided",
} as const;

// An attempt's arguments, worded as `checks_stakes` words them: the same attempt is named the same way to the tool that reads it and to every tool that rolls it.
const action = "The action's id, or try for the player character's attempt that no action covers.";
const params =
  'The action\'s arguments by name, such as its target or where to, written as a JSON object: {"target": "an id or a name"}. For try: {"skill": "one of the world\'s skills", "difficulty": "how hard it looks: easy, moderate, hard", "against": ["whom it opposes"], "with": ["companions who join in"], "attempt": "what is attempted, in the player\'s words"}; a skill or difficulty the chat doesn\'t take is answered with those it does.';
const rating = "How well the described approach suits the attempt: a whole number from 0 (no particular approach, or one that works against them) to the top the world's policy gives. Leave it out when no approach was described.";
const reason = "Why you rate it so, in one plain line.";
const outcomes = 'Only where the policy leaves the outcome to the story: the odds you give each outcome, from 0 to 1, written as a JSON object: {"success": 0.6, "failure": 0.4}.';

/** The tools as shipped, in the order the Prompts page lists them. */
export const PLAY_TOOL_TEXTS: readonly HarnessToolText[] = [
  {
    name: PLAY_TOOL.actionPlay,
    family: HARNESS_FAMILY.checks,
    tier: "write",
    note: "Plays an action through the world's rules and records it as a turn's own action is recorded.",
    text: "Play an action for real: someone tries one of the world's actions (or, with action try, the player character tries what no action covers), the engine rolls its check with its own dice, once, and the roll is recorded with what the world's rules do on that outcome: what it costs or gives, what it moves or changes, and the attempt itself, so the chat's retry rule knows it was tried. Use it when the story turns on whether something works and the result should be the rules', not yours; checks_stakes reads the odds and what is at stake first, and rolls nothing. You never choose the result: the dice are drawn from the turn, who acts and how many rolls the turn has recorded for them, so no argument and no wording moves them. A roll once made stands: playing the attempt again is another attempt, and one that failed and is tried again before anything changed is not rolled again and fails the same way, as the chat's retry rule has it. Only the author plays an action, before the reply is written. It is refused, with what to put right, when the action can't be tried as things stand, or is given an argument it doesn't take. When the rules refuse part of what the outcome does, none of what it does is recorded; where the dice had fallen by then, the attempt and its roll are recorded alone. It is a change like any other: it lands when you commit, under the player's setting for what the author plays, which may ask them first or refuse it. The answer says the roll, the outcome, what was recorded and how many minutes the action takes: it passes no time, so pass the turn's time with time_pass, and commit when the reply should rest on it. Someone in a fight acts through fight_round.",
    args: [
      { path: "action", text: action },
      { path: "actor", text: "Who tries it: a person's id or name; leave it out for the player character. An open attempt (try) is always the player character's." },
      { path: "params", text: params },
      { path: "rating", text: rating },
      { path: "reason", text: reason },
      { path: "outcomes", text: outcomes },
    ],
  },
  {
    name: PLAY_TOOL.fightRead,
    family: HARNESS_FAMILY.fights,
    tier: "read",
    note: "Reads the fight under way: the encounter, and what each fighter may do on their next turn.",
    text: 'Read the fight under way. It says whether there is one, and if so: the encounter as the game master sees it (the round, the order of turns by initiative, whose turn it is, each fighter\'s side and health, who is down or out of it, and the last acts), what the player character can do on their turn (player.actions, each an action and its params for fight_round), and every other fighter\'s next turn (due) with the options they may choose from, each by the key fight_round and mind_fight take. In the answer "you" is the player character, party is their side and foes the other. A fight exists only in a world with combat rules. It is fought where the player character is, takes no clock time while it lasts, and is played a round at a time: fight_start starts one, fight_round plays a round, fight_end ends it. next says what the following call needs.',
    args: [{ path: "who", text: "Only this fighter's next turn and options: their id or name. Leave it out for everyone." }],
  },
  {
    name: PLAY_TOOL.fightStart,
    family: HARNESS_FAMILY.fights,
    tier: "write",
    note: "Starts a fight where the player character is, against the people named.",
    text: "Start a fight where the player character is, against the people named. The engine rolls everyone's initiative and sets the order of turns; whoever else is there and allied with a side, or hostile to the player character, joins as the world's combat rules say. Use it when the story comes to blows in a world that has combat rules; a world without them is answered so, and a clash there is played with action_play. It is refused, with why, when a fight is already under way, or when a foe is not where the player character is or cannot fight. Only the author starts a fight, before the reply. The answer shows the encounter as fight_read does and says what the first round needs: when someone acts before the player character, fight_round without action plays those turns first. Commit before you start the fighters' own agents: an agent you start reads only what is committed. Starting a fight takes no time of its own.",
    args: [{ path: "foes", text: "Whom the player character's side fights: ids or names of people who are where the player character is. Leave it out for everyone there who is hostile to the player character." }],
  },
  {
    name: PLAY_TOOL.fightRound,
    family: HARNESS_FAMILY.fights,
    tier: "write",
    note: "Plays one round of the fight: the player character's action, then the others' turns.",
    text: "Play one round of the fight under way, as a turn of the game plays one: the player character's action, rolled with the engine's dice as action_play rolls it, then every other fighter's turn until the player character's comes round again. It records who did what, who went down or got back up, and the fight's end when it ends. Every other fighter who has more than one option needs a choice before the round plays: give it in decisions, or let their own mind choose (a character agent calls mind_fight, and you commit), or say tactics: true to let the engine's own tactics choose for everyone still undecided. Otherwise the call is refused and names who still has to decide. When someone acts before the player character (fight_read says who is up), call it without action to play those turns, then again with the action; when the player character is out of the fight, call it without action for the others' round. A player character who still has something left to do on their turn stays up, and the others wait for the next call. While the fight goes on a round passes no time. The answer says what happened in order, who is down, whether the fight ended, and what the next round needs; where the rules refuse part of what the player character's action does, the round stands without that part, and refused says what. Only the author plays a round, before the reply. A round once played stands: its rolls are recorded as they fall, and no decision and no argument moves the dice. It lands when you commit, under the player's setting for what the author plays.",
    args: [
      { path: "action", text: "What the player character does on their turn: an action's id (fight_read lists what they can do; end_turn only ends their turn), or try for an attempt no action covers. Leave it out when it isn't their turn, or they are out of the fight." },
      { path: "params", text: params },
      { path: "rating", text: rating },
      { path: "reason", text: reason },
      { path: "outcomes", text: outcomes },
      { path: "decisions", text: 'What other fighters do on their next turn, written as a JSON object of each one\'s option key by their id or name: {"<who>": "<option key>"}. The keys are the ones fight_read lists for them. A choice is played if it is still possible when their turn comes; otherwise the engine\'s tactics choose.' },
      { path: "tactics", text: "true to let the engine's own tactics choose for every fighter who has more than one option and no choice yet: they defend when badly hurt and pressed, and otherwise attack the most dangerous foe they can reach." },
    ],
  },
  {
    name: PLAY_TOOL.fightEnd,
    family: HARNESS_FAMILY.fights,
    tier: "write",
    note: "Ends the fight under way, or breaks it off as the story moves on.",
    text: "End the fight under way. With no arguments it ends as things stand, and the side left standing, if only one is, has won. winner names the side that won when the story decides it: a surrender, a rout, a truce. break_off: true ends it because the story moves on past it, as a fight ends before time skips ahead. A fight that runs its course ends by itself in fight_round, so call this only when the story ends it. Afterwards time passes again: say how long the turn took with time_pass. Only the author ends a fight, before the reply.",
    args: [
      { path: "winner", text: "The side that won: party (the player character's side) or foes. Leave it out to let who is left standing say, or when no one won." },
      { path: "break_off", text: "true to end it because the story moves on past it. Who is left standing says who won, and winner is not read." },
    ],
  },
  {
    name: PLAY_TOOL.mindFight,
    family: HARNESS_FAMILY.mind,
    tier: "write",
    note: "A fighter's own mind reads the fight and decides what it does on its next turn.",
    text: 'Decide what you do on your next turn in the fight under way, as the fighter you are. Without choice it answers the fight as you perceive it and the options you may choose from, each by its key. In that answer "you" is you; party is the player character\'s side and foes the other; your own health is exact, and anyone else\'s only as far as you can tell. With choice it records your decision for that turn. It is played when the author plays the round, if it is still possible then; otherwise the engine\'s own tactics choose for you. Call it when your task says a fight is under way. With one option or none there is nothing to choose.',
    args: [{ path: "choice", text: "The key of the option you choose, as this tool lists them. Leave it out to read the fight and your options first." }],
  },
];

const tool = v("tool", "the tool that was called", true);
const minutes = v("minutes", "the minutes the action takes", true);
const fighter = v("name", "the fighter's name", true);

export const PLAY_NOTE_PROMPTS: readonly PromptDef[] = [
  answerPrompt(PLAY_NOTE.author, "The author's call", "A play or fight tool's answer to any agent but the author, or once the turn's reply is written.", "Only the author calls {{tool}}, and only before the turn's reply is written. Say in your answer what should be played, and the author decides.", [tool]),
  answerPrompt(PLAY_NOTE.inFight, "A fighter acts in the fight", "action_play's answer when whoever would act is in the fight under way.", "{{name}} is in the fight under way, where an action is played as part of a round: fight_round plays the player character's action with the others' turns around it, and takes the other fighters' choices in decisions. Nothing was played.", [v("name", "who would act", true)]),
  answerPrompt(PLAY_NOTE.rejected, "The rules refused it", "action_play's answer when the world's rules refuse part of what the action does and no dice had fallen for it, with the engine's reason.", "The world's rules refused part of what it does, so nothing was played or recorded: {{why}}. Put that right first (what they hold or can pay, where they are, who is there) and call again, or tell it in the reply as something that doesn't come off.", [v("why", "why, in the engine's words", true)]),
  answerPrompt(
    PLAY_NOTE.rolledOnly,
    "Rolled, and its outcome refused",
    "Ends action_play's answer when the dice fell and the world's rules then refused part of what the outcome does, with the engine's reason: the attempt and its roll are recorded alone.",
    "The dice fell, and the attempt and its roll are recorded: recorded says so, and lands says when it holds. The world's rules refused part of what that outcome does ({{why}}), so none of what it does was recorded. Tell it as it fell. What the story still needs of it, record with your other tools; playing it again is another attempt. The action takes {{minutes}} minutes, which this call did not pass: pass the turn's time with time_pass.",
    [v("why", "why, in the engine's words", true), minutes],
  ),
  answerPrompt(PLAY_NOTE.undeclared, "An argument it doesn't take", "An attempt's answer when params holds a name the action doesn't declare.", "{{action}} takes no argument called {{given}}. It takes: {{takes}}. Nothing was read or rolled: give it only those.", [v("action", "the action's id", true), v("given", "the names the call gave that it doesn't take", true), v("takes", "the names it takes", true)]),
  answerPrompt(PLAY_NOTE.takesNone, "It takes no arguments", "An attempt's answer when params holds anything for an action that declares no argument.", "{{action}} takes no arguments, and params gave it {{given}}. Nothing was read or rolled: leave params out.", [v("action", "the action's id", true), v("given", "the names the call gave", true)]),
  answerPrompt(PLAY_NOTE.played, "An action was played", "Ends action_play's answer: what was recorded, and that its time is still to pass.", "Played and recorded as a turn's own action is: recorded says what changed, and lands says when it holds. The action takes {{minutes}} minutes, which this call did not pass: pass the turn's time with time_pass.", [minutes]),
  answerPrompt(PLAY_NOTE.playedNothing, "Played, with nothing to record", "Ends action_play's answer when the action's rules change nothing on the outcome it came to.", "Played: on this outcome the action's rules change nothing, so there was nothing to record. Tell it as it fell. The action takes {{minutes}} minutes, which this call did not pass: pass the turn's time with time_pass.", [minutes]),
  answerPrompt(
    PLAY_NOTE.retryOnce,
    "A retry in the same scene",
    "Says a played attempt was not rolled again, in a chat whose retry rule gives a failed attempt one try a scene.",
    "Not rolled: {{name}} failed this same attempt in this scene, and this chat gives a failed attempt one try a scene. It failed again the same way, and what failing does was recorded again. It is rolled anew once the scene has changed: they are somewhere else, or left and came back. Another action, another target or other arguments make another attempt.",
    [v("name", "who tried again", true)],
  ),
  answerPrompt(
    PLAY_NOTE.retryChanged,
    "A retry with nothing changed",
    "Says a played attempt was not rolled again, in a chat whose retry rule asks for a change first.",
    "Not rolled: {{name}} failed this same attempt and nothing has changed since. It failed again the same way, and what failing does was recorded again. It is rolled anew once something has changed: they are somewhere else or left and came back, {{minutes}} minutes have passed since the failed roll, the odds are different, or a fight has reached a new round. Another action, another target or other arguments make another attempt.",
    [v("name", "who tried again", true), v("minutes", "the minutes the chat's retry rule waits")],
  ),
  answerPrompt(PLAY_NOTE.noCombat, "No combat rules", "A fight tool's answer in a world without combat rules.", "This world has no combat rules, so no fight runs here. Play a clash as contested actions instead (action_play; checks_stakes reads the odds first) and tell it in the reply."),
  answerPrompt(PLAY_NOTE.noFight, "No fight under way", "A fight tool's answer when no fight is under way.", "No fight is under way. fight_start starts one, against people who are where the player character is."),
  answerPrompt(PLAY_NOTE.fightOn, "A fight is already on", "fight_start's answer while a fight is under way.", "A fight is already under way: fight_read shows it, fight_round plays its next round, fight_end ends it."),
  answerPrompt(
    PLAY_NOTE.noStart,
    "The fight didn't start",
    "fight_start's answer when the combat rules refuse to start the fight, with the engine's reason.",
    "The fight didn't start: {{why}}. A fight is fought where the player character is, against people who are there and can fight: name them in foes (bring them there first if the story has them come), or leave foes out for everyone there who is hostile to the player character.",
    [v("why", "why, in the engine's words", true)],
  ),
  answerPrompt(PLAY_NOTE.needsAction, "The player character is up", "fight_round's answer when it is the player character's turn and the call gives no action.", "It is {{name}}'s turn: say what they do with action and params (fight_read lists what they can do; end_turn only ends their turn). If they do nothing this turn, leave the round unplayed.", [v("name", "the player character's name", true)]),
  answerPrompt(
    PLAY_NOTE.notUp,
    "Others act first",
    "fight_round's answer when the call gives the player character's action while someone else's turn is due before theirs.",
    "{{up}} acts before {{name}}. Call fight_round without action to play the turns due before theirs, then call it again with their action.",
    [v("up", "who is up now", true), v("name", "the player character's name", true)],
  ),
  answerPrompt(
    PLAY_NOTE.undecided,
    "Fighters still to decide",
    "fight_round's answer when a fighter with more than one option has no choice and the call doesn't leave it to the engine's tactics.",
    'Still to decide what they do on their next turn: {{who}}. Give each one\'s choice in decisions as {"<who>": "<option key>"} (fight_read lists the keys), or let their own minds choose (a character agent calls mind_fight, then you commit), or say tactics: true to let the engine\'s own tactics choose for everyone still undecided.',
    [v("who", "the fighters who have no choice yet, by name", true)],
  ),
  answerPrompt(PLAY_NOTE.notDue, "No turn to decide", "A fight tool's answer when a call names someone who has no turn coming in the fight.", "{{name}} has no turn to decide: they are not in the fight, or are out of it. fight_read lists who is due.", [fighter]),
  answerPrompt(PLAY_NOTE.badChoice, "Not one of their options", "A fight tool's answer when a choice isn't an option the fighter has on their next turn.", "{{choice}} isn't one of the options {{name}} has on their next turn. Their options: {{options}}.", [v("choice", "what the call gave"), fighter, v("options", "the fighter's option keys", true)]),
  answerPrompt(PLAY_NOTE.badDecisions, "Decisions it can't read", "fight_round's answer when decisions isn't a JSON object.", 'decisions is a JSON object of each fighter\'s option key by their id or name: {"<who>": "<option key>"}, with the keys fight_read lists.'),
  answerPrompt(PLAY_NOTE.nothing, "Nothing happened", "fight_round's answer when no one in the fight could act.", "Nothing happened: no one in the fight can act. fight_end ends it."),
  answerPrompt(
    PLAY_NOTE.nextAction,
    "Next: the player character's turn",
    "Ends a fight tool's answer when the player character is up.",
    'It is the player character\'s turn ("you"): fight_round with action and params plays it (player.actions lists what they can do), then the others\' turns. Each fighter in due with more than one option needs a choice by then: decisions, their own mind\'s (mind_fight, then commit), or tactics: true. While the fight goes on no time passes.',
  ),
  answerPrompt(
    PLAY_NOTE.nextOthers,
    "Next: the turns due first",
    "Ends a fight tool's answer when someone else acts before the player character.",
    "{{who}} acts before the player character: call fight_round without action to play the turns due before theirs (decisions or tactics: true for whoever has more than one option), then again with their action.",
    [v("who", "who is up now", true)],
  ),
  answerPrompt(PLAY_NOTE.nextOut, "Next: the others' round", "Ends a fight tool's answer when the player character is out of the fight.", "The player character is out of the fight (down, or no longer where it is fought): fight_round without action plays the others' round, or ends the fight if the player character has left; fight_end ends it."),
  answerPrompt(PLAY_NOTE.ended, "The fight is over", "Ends a fight tool's answer once the fight has ended.", "The fight is over. Time passes again: say how long the turn took with time_pass."),
  answerPrompt(PLAY_NOTE.decided, "A fighter's decision", "A fighter's recorded decision in plain words, for the review card and commit's answer.", "{{name}} decides for round {{round}} of the fight: {{choice}}.", [fighter, v("round", "the round the turn falls in", true), v("choice", "what they chose, in words", true)]),
  answerPrompt(PLAY_NOTE.mindNoTurn, "No turn of yours", "mind_fight's answer when the person the agent is has no turn coming in a fight.", "{{name}} has no turn to decide in a fight: no fight is under way that you can read, or they are not in it, or they are out of it. A fight the author has only just started shows once the author commits it. Say so in your answer, and go on without mind_fight.", [fighter]),
  answerPrompt(PLAY_NOTE.mindChoose, "How to choose", "Ends mind_fight's answer when it lists the fighter's options.", "Choose with mind_fight again, giving choice one of the option keys. With one option or none there is nothing to choose: the engine plays your turn."),
  answerPrompt(PLAY_NOTE.mindDecided, "A decision recorded", "Ends mind_fight's answer once the fighter's choice is recorded.", "Recorded for your next turn in the fight. It is played when the author plays the round, if it is still possible then; otherwise the engine's own tactics choose for you."),
];

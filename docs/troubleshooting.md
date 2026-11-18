# Troubleshooting

Start with `rpe status`. It says whether RPE answers, whether its service runs, which builds run, which Lumiverse it belongs to, and which keys are set. With RPE's service, its own log is `journalctl --user -u rpe-<name>.service`.

RPE's tab in Lumiverse's drawer also says, at the top, when its extension does not hold RPE's registration or lacks a permission, with **Check again** to read it afresh. Where a permission is missing, Lumiverse shows a window called "RPE needs permissions" that names each one.

## Chats on RPE's connection are not being played

The banner at the top of RPE's tab says so, with the reason under it. The extension is not installed or not switched on, or it lacks a permission, or RPE is not signed in to Lumiverse. Install the extension and switch it on ([the install page](install.md#the-extension-and-its-five-permissions)), have an admin approve its five permissions, and run `rpe up`. RPE tries its registration again by itself; **Check again** reads it afresh.

| The reason says | What it means |
|---|---|
| "RPE has not heard from its extension in Lumiverse since it started." | RPE is not registered. Install and switch on the extension, and run `rpe up`. |
| "RPE is not set up for a Lumiverse yet: give it Lumiverse's address and your Lumiverse user (rpe up)." | RPE does not know which Lumiverse it serves. Run `rpe up` with `--url` and `--user`, then restart RPE. |
| A permission named, with the extension's reason for it | Have an admin approve that permission for RPE's extension in Lumiverse's extension settings. |

## A reply fails before RPE plays it

These come back from RPE's connection, so Lumiverse shows them as the provider's error.

**Lumiverse cannot reach the provider at all.** RPE is not running, or not where RPE's connection points.
Run `rpe status`. Start RPE (`rpe serve`, or its service), and see that it answers at the address in RPE's connection in Lumiverse.

**"This connection's key is not RPE's."** (or "…is not the one RPE pairs with the model …")
The key in RPE's connection in Lumiverse is not RPE's provider key, or a newer one was made since. Run `rpe up` again, which brings the connection up to date, or make one with `rpe key provider` and put it in the connection as its API key. After the switch from the previous build the key is the one the previous build's connection holds, and none is made: do not change it.

**"RPE stopped this reply rather than send it without RPE: its extension may not add to a reply's request."**
The extension lacks `generation_parameters`. Grant it in Lumiverse's extension settings.

**"RPE stopped this reply: its extension could not tell whether this chat is one RPE plays …"**
Neither RPE's registration nor the connection's own record in Lumiverse could be read. Send the message again; RPE's log says what failed.

**"RPE stopped this reply: its extension could not pair this prompt with a generation it heard begin …"**
Lumiverse started the extension again while the generation was under way. Send the message again.

**"RPE could not read this reply's tag (…). Update the extension and RPE to the same build."**
The extension and RPE are different builds. `rpe status` shows both on its `Builds:` line. Update the extension in Lumiverse; RPE restarts onto the new build by itself (see [Updating](install.md#updating)).

**"The request could not be passed on: RPE has no connection to pass it on by …"**
A request on RPE's connection that is not a chat reply (Lumiverse's own small tasks) goes to RPE's default connection, or to the one `turn.passConnection` names. Add a model connection (`rpe connection add`), or name one in `turn.passConnection`.

**"The request was not sent, because something in it cannot be carried by the connection it goes to …"**
The request holds a part the connection's model does not take (an image, audio or a video). Nothing was sent with that part left out. Use a connection whose model takes it, or leave the part out.

**"A request with no tag arrived while a reply was waiting for its tag."**
The setting `lumiverse.untagged.whileAwaited` is `fail`, and a request Lumiverse made beside a reply (a title or a summary, say) reached RPE while the reply waited. Set it to `pass`, its default, to have such a request passed on.

## A turn waits before it starts

A turn begins when the run of the turn before it has ended: nothing cuts that wait short unless you set `limits.previousRunSeconds`, past which the earlier run is stopped. A swipe does not wait.

## A turn ends without a reply

RPE played the turn, and it ended with no reply. The chat shows one plain line, from `guidance/.prompts/reply-errors.md` (change the words there if you like). Where the turn had already shown progress lines in the message's thinking block, the same line is written there too: Lumiverse then keeps the message, empty but for its thinking, and the line in it says why. Where nothing was shown yet, Lumiverse keeps no message, and shows the line as the provider's error. The **Turns** page and the turn's own page show what each agent did.

| The line starts | What it means | What to do |
|---|---|---|
| "The Author ended this turn without writing a reply." | The lead agent ended its run with no reply. | Look at the turn's page. Swipe or send again. If it keeps happening, the model may not keep to the reply's form: see [A model that does not keep to the reply's tags](install.md#a-model-that-does-not-keep-to-the-replys-tags). |
| "The turn reached its limit of …" | A limit stopped the turn first, one you set (such as `limits.turn.calls`) or the one that guards against a loop: `limits.repeats`, the same call made that many times in a row (10). No limit on calls, tool rounds, tokens or time is set by default. | Raise or lift the limit in [Settings](settings.md#limits-on-a-turns-work), or swipe. |
| "The model's provider failed before a reply was written: …" | The provider refused or broke off. The rest of the line is its own words. | Check the connection's key and model (`rpe connection list`), the provider's status, and your account's credit. |
| "The turn was stopped before a reply was written." | You, or Lumiverse, stopped the generation. | Send again. |
| "The turn could not be played: …" | Anything else, in words after the colon: RPE is not set up for a Lumiverse, Lumiverse has no such chat for this RPE's user, no agent is named to lead the chat's turns (`turn.lead`), or an agent's `model:` names a connection RPE does not have, or there is none at all. | Add a connection with `rpe connection add`, or set the agent's `model:` to one you have, or name the lead in `turn.lead`. |

Lumiverse ends a generation that has shown nothing for ten minutes. RPE shows a progress line in the thinking block to keep a turn alive (`progress.silenceSeconds`); a reply asked for whole holds at `lumiverse.reply.holdSeconds`, under that cut.

RPE's log (`journalctl --user -u rpe-<name>.service`) says why for every run that ends without a reply, or fails after one: a `warn` line, "A turn's run ended failed: …" (or "at a limit", "with no reply", "stopped where it stood"), with the turn, the run, the chat, the kind and the generation, in the line the chat showed. A job that fails or reaches a limit gets a `warn` line of its own, with its id, its chat and its agent. A run that ended well leaves no line above `debug`.

## A turn shows as running after RPE was stopped

RPE stopped (a restart, a crash, the machine going down) while a turn's run was going on. At its next start RPE closes every run still kept as running: the Turns page and the turn's page then show it failed, in the words of `stopped_mid_run` in `guidance/.prompts/turn-errors.md` ("RPE stopped while this run was going on."). Where its reply had already been saved, the turn stays in the chat as it is. To have the agents record what the stopped run did not, use **Settle now** on the Turns page or on the Turn page of the chat's newest turn: it runs the Author on that turn against the chat as it reads now, writes no reply, and adds nothing to the chat.

## A connection's limits say "not known"

The **Connections** page shows each connection's limits, and where each comes from. With "Longest reply: not known", RPE sends that model no cap on a reply. With "Context window: not known", it cannot tell when a session nears the model's window, so a session's earlier turns are summarized only once the provider refuses a call as too long, which costs that call. A connection the migration carried may be like this: the migration gives it no limits of its own. Enter the model's **Context window** and **Longest reply** on the Connections page; **Test it** shows what the provider's list gives (see [A carried connection has no limits of its own](migration.md#a-carried-connection-has-no-limits-of-its-own)).

## A view will not load

**"This view could not be loaded", with "Lumiverse did not serve the extension's second file (it answered …)".** Play, Build, the world's sheets and the HUD load from the extension's second file, `dist/widget.js`. A Lumiverse that does not serve an extension's widget file answers with an error for it. Run a Lumiverse that serves it (the staging branch does), and reload the page.

## A panel on the Play page refuses

Its words come from `guidance/.prompts/play-answers.md` and `request-answers.md`. A tap that manages (taking a thing off, paying, moving the clock) is kept as your change at once; made while a turn of the chat runs, it is marked pending and takes effect before the next turn begins.

**"This chat does not play a world in RPE." / "The revision of the world this chat plays is not in RPE, so nothing can be changed in it."** The chat has no world (**Attach** gives it one on the Play page) or the world's revision is gone from RPE.

**"Nothing was undone: …"** An Undo is whole or not at all. "the turn this change was kept with is no longer part of this chat's story" (a swipe or a rewind took that turn away), "something has changed it since", or "this build keeps no undo for …" (the end of the line names what): nothing is undone, and the line says why.

**"… isn't anyone you know", "… isn't a place you know", "… it needs someone"** and the like. An action names a person, a place or a thing the player's character does not know of or the action does not take. Name one that is known.

## The web app

**It asks for a key.** Make one with `rpe key web` on the machine RPE runs on. The browser lets go of a key RPE no longer takes, and says so: a key stops when a new one is made, or when its days run out, where `auth.webKeyDays` gives it an end.

**"Not connected to RPE".** The page cannot reach RPE (**Try again** reads it afresh). From another device, RPE must be published at an address that device reaches, and that address listed in `server.origins` and `server.hosts` in `files/RPE-global.yml` (see [Install](install.md#the-web-app-and-its-key)).

## RPE holds more memory than you expect

To see what RPE's memory is made of as a chat is played, run `bun scripts/perf/memory.ts` from RPE's source folder. It starts RPE's own application on a scratch data folder, with a stand-in Lumiverse and a scripted model, plays turns of tens of thousands of tokens with tool calls, a delegate and jobs, and prints RPE's resident size, its heap and what its allocator holds every few turns, so you see what grows with the number of turns and what levels off. `--turns`, `--chats` (chats played at once), `--prompt` (tokens a prompt holds) and `--rest` (seconds to wait after the last turn before measuring again) change what it plays; the file's first lines list the rest.

## After an update

`rpe status`'s `Builds:` line says what RPE does about a new build: it is waiting for a turn or job to end, it is restarting, `update.restart` is off, it was started by hand, or the new file does not start. The same line is on the **Runtime** page.

Before RPE restarts onto a new build, the new build checks that it starts on RPE's data (`rpe check`: its config read, its changes to the database tried on a copy). A build that fails the check, or does not finish it within `update.checkWaitSeconds` seconds, is never restarted onto: RPE goes on with the build it runs, and the `Builds:` line says why. Update the extension again, or report it.

Should a build start and then keep failing all the same, RPE's service stops starting it after `update.startTries` starts within `update.startWindowSeconds` seconds, and `systemctl --user status rpe-<name>.service` says it failed. Its log says why (`journalctl --user -u rpe-<name>.service`).

## The migration and the switch

Every refusal of `rpe migrate` and `rpe up` is in the tables of [Moving from the previous build](migration.md): the rehearsal's, the real run's and the switch's, each with what to do. A switch that did not go through puts back what it did and says so; the previous build then plays as before.

**You want to go back.** See [Going back](migration.md#4-going-back).

## What is not in this build

The `lumirpengine` command line and MCP server for outside harnesses, and Talk, the GM assistant chat, come with a later build. Until then the `lumirpengine` commands that read or change worlds and chats answer that the command returns with a later build. See [the README](../README.md#what-is-not-in-this-build).

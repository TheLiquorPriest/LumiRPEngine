# Troubleshooting

Start with `rpe status`. It says whether RPE answers, which builds run, which Lumiverse it belongs to, and which keys are set. With RPE's service, its own log is `journalctl --user -u rpe-<name>.service`.

RPE's tab in Lumiverse's drawer also says, at the top, when its extension does not hold RPE's registration or lacks a permission, with **Check again** to read it afresh.

## A reply fails before RPE plays it

These come back from RPE's connection, so Lumiverse shows them as the provider's error.

**Lumiverse cannot reach the provider at all.** RPE is not running, or not where RPE's connection points.
Run `rpe status`. Start RPE (`rpe serve`, or its service), and see that it answers at the address in RPE's connection in Lumiverse.

**"RPE is not set up for a Lumiverse yet: give it Lumiverse's address and your Lumiverse user (rpe up)."**
RPE does not know which Lumiverse it serves. Run `rpe up` with `--url` and `--user`, then restart RPE.

**"This connection's key is not RPE's."**
The key in RPE's connection in Lumiverse is not RPE's provider key, or a newer one was made since. Run `rpe up` again, which brings the connection up to date, or make one with `rpe key provider` and put it in the connection as its API key.

**"RPE answered nothing: it cannot tell a chat reply from other requests on its connection now."** The rest of the line says why:

- *"RPE has not heard from its extension in Lumiverse since it started."* RPE is not registered. The extension is not installed, not switched on, or RPE has not signed in to Lumiverse. Install and switch on the extension, and run `rpe up`. RPE tries its registration again by itself.
- *"… lacks the “interceptor” permission …"* The extension cannot mark the replies RPE plays. Have an admin approve `interceptor` for RPE's extension in Lumiverse.
- Any other reason is the extension's own refusal of RPE's registration, in its words.

**"RPE stopped this reply rather than send it without RPE: its extension may not add to a reply's request."**
The extension lacks `generation_parameters`. Grant it in Lumiverse's extension settings.

**"RPE could not tell which generation this prompt belongs to, so it stopped the reply. Send it again."**
Send the message again.

**"RPE could not read this reply's tag (…). Update the extension and RPE to the same build."**
The extension and RPE are different builds. `rpe status` shows both on its `Builds:` line. Update the extension in Lumiverse; RPE restarts onto the new build by itself (see [Updating](install.md#updating)).

**"RPE has no connection to pass this request on to. Add one on RPE's Connections page."**
A request on RPE's connection that is not a chat reply (Lumiverse's own small tasks) goes to RPE's default connection, or to the one `turn.passConnection` names. Add a model connection (`rpe connection add`), or name one in `turn.passConnection`.

## A turn ends without a reply

RPE played the turn, and it ended with no reply. The chat shows one plain line, from `guidance/.prompts/reply-errors.md` (change the words there if you like). Where the turn had already shown progress lines in the message's thinking block, the same line is written there too: Lumiverse then keeps the message, empty but for its thinking, and the line in it says why. Where nothing was shown yet, Lumiverse keeps no message, and shows the line as the provider's error. The **Turns** page and the turn's own page show what each agent did.

| The line starts | What it means | What to do |
|---|---|---|
| "The Author ended this turn without writing a reply." | The lead agent ended its run with no reply. | Look at the turn's page. Swipe or send again. If it keeps happening, the model may not keep to the reply's form: set `connections.<connection>.reply.form` to `two-step` (see [Install](install.md#a-model-that-does-not-keep-to-the-replys-tags)). |
| "The turn reached its limit of …" | A limit you set stopped the turn first, such as `limits.turn.calls`. | Raise the limit in [Settings](settings.md#limits), or swipe. |
| "The model's provider failed before a reply was written: …" | The provider refused or broke off. The rest of the line is its own words. | Check the connection's key and model (`rpe connection list`), the provider's status, and your account's credit. |
| "The turn was stopped before a reply was written." | You, or Lumiverse, stopped the generation. | Send again. |
| "The turn could not be played: …" | Anything else, in words after the colon. A missing model connection is one: an agent's `model:` names a connection RPE does not have, or there is none at all. | Add a connection with `rpe connection add`, or set the agent's `model:` to one you have. |

## A turn shows as running after RPE was stopped

RPE stopped (a restart, a crash, the machine going down) while a turn's run was going on. At its next start RPE closes every run still kept as running: the Turns page and the turn's page then show it failed, in the words of `stopped_mid_run` in `guidance/.prompts/turn-errors.md` ("RPE stopped while this run was going on."). Where its reply had already been saved, the turn stays in the chat as it is. To have the agents record what the stopped run did not, use **Settle now** on the Turns page or on the Turn page of the chat's newest turn: it runs the Author on that turn against the chat as it reads now, writes no reply, and adds nothing to the chat.

## A connection's limits say "not known"

The **Connections** page shows each connection's limits, and where each comes from. With "Longest reply: not known", RPE sends that model no cap on a reply. With "Context window: not known", it cannot tell when a session nears the model's window, so a session's earlier turns are summarized only once the provider refuses a call as too long, which costs that call. A connection the migration carried may be like this: the migration gives it no limits of its own. Enter the model's **Context window** and **Longest reply** on the Connections page; **Test it** shows what the provider's list gives (see [A carried connection has no limits of its own](migration.md#a-carried-connection-has-no-limits-of-its-own)).

## A panel on the Play page refuses

Its words come from `guidance/.prompts/play-answers.md`.

**"A turn of this chat is running, and a change from a panel is kept only between turns: nothing was changed."** A tap, or an Undo, made while a turn of the chat runs is refused, and nothing is changed. Make it again once the turn is over.

**"Nothing was undone: this build keeps no undo for …"** An Undo is whole or not at all. Where a part of what the tap did cannot be taken back (the end of the line names what), nothing is undone.

**"… is not served by this build of RPE yet."** The page asked for something this build does not do: see [the README](../README.md#what-this-build-does-not-have-yet).

## The web app

**It asks for a key.** Make one with `rpe key web` on the machine RPE runs on. The browser lets go of a key RPE no longer takes, and says so: a key stops when a new one is made, or when its days run out, where `auth.webKeyDays` gives it an end.

**"Not connected to RPE".** The page cannot reach RPE. From another device, RPE must be published at an address that device reaches, and that address listed in `server.origins` and `server.hosts` in `files/RPE-global.yml` (see [Install](install.md#the-web-app-and-its-key)).

## After an update

`rpe status`'s `Builds:` line says what RPE does about a new build: it is waiting for a turn or job to end, it is restarting, `update.restart` is off, it was started by hand, or the new file does not start. The same line is on the **Settings** page.

Before RPE restarts onto a new build, the new build checks that it starts on RPE's data (`rpe check`: its config read, its changes to the database tried on a copy). A build that fails the check, or does not finish it within `update.checkWaitSeconds` seconds, is never restarted onto: RPE goes on with the build it runs, and the `Builds:` line says why. Update the extension again, or report it.

Should a build start and then keep failing all the same, RPE's service stops starting it after `update.startTries` starts within `update.startWindowSeconds` seconds, and `systemctl --user status rpe-<name>.service` says it failed. Its log says why (`journalctl --user -u rpe-<name>.service`).

## After the switch from the previous build

**The HUD inside the chat, the old command line and its MCP server are gone.** They are not in this build. The previous build's play panels are on the **Play** page. See [the README](../README.md#what-this-build-does-not-have-yet).

**You want to go back.** See [Going back](migration.md#4-going-back).

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
A request on RPE's connection that is not a chat reply (Lumiverse's own small tasks) goes to RPE's default connection, or to the one `passConnection` names. Add a model connection (`rpe connection add`), or name one in `passConnection`.

## A turn ends without a reply

RPE played the turn, and it ended with no reply. The chat shows one plain line, from `guidance/.prompts/reply-errors.md` (change the words there if you like). The **Turns** page and the turn's own page show what each agent did.

| The line starts | What it means | What to do |
|---|---|---|
| "The Author ended this turn without writing a reply." | The lead agent ended its run with no reply. | Look at the turn's page. Swipe or send again. If it keeps happening, the model may not keep to the reply's form: set `reply.forms.<connection>` to `two-step` (see [Install](install.md#a-model-that-does-not-keep-to-the-replys-tags)). |
| "The turn reached its limit of …" | A limit you set stopped the turn first, such as `limits.turn.calls`. | Raise the limit in [Settings](settings.md#limits-of-a-turn), or swipe. |
| "The model's provider failed before a reply was written: …" | The provider refused or broke off. The rest of the line is its own words. | Check the connection's key and model (`rpe connection list`), the provider's status, and your account's credit. |
| "The turn was stopped before a reply was written." | You, or Lumiverse, stopped the generation. | Send again. |
| "The turn could not be played: …" | Anything else, in words after the colon. A missing model connection is one: an agent's `model:` names a connection RPE does not have, or there is none at all. | Add a connection with `rpe connection add`, or set the agent's `model:` to one you have. |

## The web app

**It asks for a key.** Make one with `rpe key web` on the machine RPE runs on.

**"Not connected to RPE".** The page cannot reach RPE. From another device, RPE must be published at an address that device reaches, and that address listed in `origins` and `hosts` in `config.json` (see [Install](install.md#the-web-app-and-its-key)).

## After an update

`rpe status`'s `Builds:` line says what RPE does about a new build: it is waiting for a turn or job to end, it is restarting, `update.restart` is off, it was started by hand, or the new file does not start. In the last case RPE goes on with the build it runs. Update the extension again, or report it.

## After the switch from the previous build

**The play panels, the HUD, the old command line and its MCP server are gone.** They are not in this build. See [the README](../README.md#what-this-build-does-not-have-yet).

**You want to go back.** See [Going back](migration.md#4-going-back).

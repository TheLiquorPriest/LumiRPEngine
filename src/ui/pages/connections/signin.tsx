// A connection that signs in to its provider (plan §14): the page starts the flow, shows the address to open
// and RPH's note, takes back what he pastes (Anthropic's code, or the address OpenAI's sign-in sent the browser
// to), says how it stands and until when it holds, and signs out. The token is kept by the model layer and
// never shown. What the layer or the provider refuses is shown in its own words.

import type { SignInStart, SignInState } from "../../../shared/api";
import type { RpeClient } from "../../client";
import { Banner, Button } from "../../atoms";
import { errorWords, when } from "../../words";

/** What the page knows of one connection's sign-in: where it stands, the flow it opened, and what it is doing or why it could not. */
export interface SignInShown {
  state: SignInState | null;
  flow: SignInStart | null;
  /** What he has typed or pasted of what the provider gave back. */
  code: string;
  busy: boolean;
  problem: string | null;
}

export const NO_SIGNIN: SignInShown = { state: null, flow: null, code: "", busy: false, problem: null };

/** What a provider's sign-in gives back for the user to paste. */
const PASTE_WORDS: Readonly<Record<SignInState["provider"], string>> = {
  anthropic: "the code the provider shows after you sign in",
  openai: "the address your browser was sent to after you signed in",
};

export interface SignInCalls {
  read(id: string): Promise<SignInState>;
  start(id: string): Promise<SignInStart>;
  finish(id: string, flow: string, code: string): Promise<SignInState>;
  cancel(id: string, flow: string): Promise<void>;
  out(id: string): Promise<void>;
}

export function signInCalls(client: Pick<RpeClient, "call">): SignInCalls {
  return {
    read: (id) => client.call("GET /api/v1/connections/:id/signin", { id }),
    start: (id) => client.call("POST /api/v1/connections/:id/signin", { id }),
    finish: (id, flow, code) => client.call("POST /api/v1/connections/:id/signin/finish", { id }, { body: { flow, code } }),
    cancel: (id, flow) => client.call("POST /api/v1/connections/:id/signin/cancel", { id }, { body: { flow } }),
    out: (id) => client.call("DELETE /api/v1/connections/:id/signin", { id }),
  };
}

/** What each step of the flow does to what the page shows; every step reads the state again where it changed it. */
export interface SignInSteps {
  read(id: string): Promise<SignInShown>;
  start(id: string, was: SignInShown): Promise<SignInShown>;
  finish(id: string, was: SignInShown, code: string): Promise<SignInShown>;
  cancel(id: string, was: SignInShown): Promise<SignInShown>;
  out(id: string, was: SignInShown): Promise<SignInShown>;
}

export function signInSteps(calls: SignInCalls): SignInSteps {
  const failed = (was: SignInShown, error: unknown): SignInShown => ({ ...was, busy: false, problem: errorWords(error) });
  return {
    async read(id) {
      try {
        const state = await calls.read(id);
        return { state, flow: null, code: "", busy: false, problem: null };
      } catch (error) {
        return failed(NO_SIGNIN, error);
      }
    },
    async start(id, was) {
      try {
        const flow = await calls.start(id);
        return { ...was, flow, busy: false, problem: null };
      } catch (error) {
        return failed(was, error);
      }
    },
    async finish(id, was, code) {
      if (was.flow === null) return was;
      try {
        const state = await calls.finish(id, was.flow.flow, code);
        // A flow that ended without signing in says why in `ended`; one that signed in has no flow left.
        return { state, flow: state.signedIn ? null : was.flow, code: state.signedIn ? "" : was.code, busy: false, problem: state.signedIn ? null : (state.ended ?? "The sign-in did not hold.") };
      } catch (error) {
        return failed(was, error);
      }
    },
    async cancel(id, was) {
      try {
        if (was.flow !== null) await calls.cancel(id, was.flow.flow);
        return { ...was, flow: null, busy: false, problem: null };
      } catch (error) {
        return failed(was, error);
      }
    },
    async out(id, was) {
      try {
        await calls.out(id);
        return { state: await calls.read(id), flow: null, code: "", busy: false, problem: null };
      } catch (error) {
        return failed(was, error);
      }
    },
  };
}

/** How a sign-in stands, in words: signed in and until when, or not. */
export function signInWords(state: SignInState | null): string {
  if (state === null) return "Reading how its sign-in stands…";
  if (!state.signedIn) return state.flow === null ? "Not signed in to its provider." : "A sign-in is open: finish it with what the provider gives you.";
  return state.until === null ? "Signed in to its provider." : `Signed in to its provider until ${when(state.until)}; RPH renews it when a call needs it.`;
}

export interface SignInPanelProps {
  name: string;
  provider: SignInState["provider"];
  shown: SignInShown;
  onStart(): void;
  onCode(code: string): void;
  onFinish(code: string): void;
  onCancel(): void;
  onOut(): void;
}

/** The open flow: the address to open, RPH's note, and the field that takes what he pastes back. */
function FlowForm(props: { flow: SignInStart; provider: SignInState["provider"]; busy: boolean; code: string; onCode(code: string): void; onFinish(code: string): void; onCancel(): void }) {
  return (
    <div class="lre-stack" data-signin-flow>
      <p class="rpe-line">
        Open this address and sign in:{" "}
        <a href={props.flow.url} target="_blank" rel="noreferrer noopener">
          {props.flow.url}
        </a>
      </p>
      <p class="rpe-meta">{props.flow.note}</p>
      <label class="lre-field">
        <span>Paste {PASTE_WORDS[props.provider]}</span>
        <input class="lre-input" name="code" type="text" value={props.code} autoComplete="off" autoCapitalize="off" spellcheck={false} onInput={(event) => props.onCode((event.currentTarget as HTMLInputElement).value)} />
      </label>
      <div class="lre-inline rpe-wrap">
        <Button busy={props.busy} disabled={props.code.trim() === ""} onClick={() => props.onFinish(props.code.trim())}>
          Finish signing in
        </Button>
        <Button kind="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** The sign-in of one connection: its standing, the flow while it is open, and the buttons that start, finish, cancel and sign out. */
export function SignInPanel(props: SignInPanelProps) {
  const { shown } = props;
  const signedIn = shown.state?.signedIn === true;
  return (
    <div class="lre-stack" data-signin>
      <p class="rpe-line" data-signin-state>
        {signInWords(shown.state)}
      </p>
      {shown.problem === null ? null : (
        <Banner tone="warn" icon="alert" title="It did not sign in">
          <span>{shown.problem}</span>
        </Banner>
      )}
      {shown.flow === null ? null : <FlowForm flow={shown.flow} provider={props.provider} busy={shown.busy} code={shown.code} onCode={props.onCode} onFinish={props.onFinish} onCancel={props.onCancel} />}
      {shown.flow !== null ? null : (
        <div class="lre-inline rpe-wrap">
          <Button small busy={shown.busy} onClick={props.onStart}>
            {signedIn ? "Sign in again" : "Sign in to the provider"}
          </Button>
          {signedIn ? (
            <Button small kind="ghost" busy={shown.busy} onClick={props.onOut}>
              Sign out
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

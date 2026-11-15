// Connections (plan §14): the models RPE's agents call, as RPH's model layer keeps them: the list, which
// one is the default, adding one, changing one, removing one, and testing one. A key is typed once and
// sent to RPE; RPE never sends one back, and this page shows only whether one is set. Each connection's
// model shows its limits as RPH uses them and where each comes from, and the form sets the user's own in
// their place. What the layer or the provider refuses is shown in its own words.

import type { ConnectionAuth, Effort, ModelLimit, ModelLimits, ModelLimitsEntry, ProviderOffer } from "rp-harness/contract";
import { useEffect, useState } from "preact/hooks";
import type { ConnectionShown, ConnectionsShown, ConnectionTested, SaveConnection } from "../../shared/api";
import { useApp } from "../app";
import { Badge, Banner, Button, Empty, PageHeader } from "../atoms";
import type { RpeClient } from "../client";
import { duration, errorWords, num } from "../words";

const FROM_WORDS: Readonly<Record<ModelLimit["from"], string>> = { user: "yours", pi: "as pi lists it", connection: "as its server reported" };

/** A model's limits as RPH uses them, and where each comes from. */
export function limitsWords(limits: ModelLimits | null): string {
  const one = (label: string, limit: ModelLimit | null | undefined): string => (limit === null || limit === undefined ? `${label}: not known` : `${label}: ${num(limit.tokens)} tokens, ${FROM_WORDS[limit.from]}`);
  return `${one("Context window", limits?.contextWindow)} · ${one("Longest reply", limits?.maxTokens)}`;
}

/** Every effort a connection may think at, as RPH's contract names them. */
export const EFFORTS: readonly Effort[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const AUTH_WORDS: Readonly<Record<ConnectionAuth, string>> = { key: "With a key", signin: "By signing in to the provider", none: "With no key" };

/** How a connection signs its calls, and whether that is in place: never the key itself. */
function keyWords(view: ConnectionShown): string {
  if (view.auth === "none") return "Signs its calls with no key.";
  if (view.auth === "signin") return view.signedIn === true ? "Signed in to its provider." : "Not signed in to its provider.";
  return view.key?.set === true ? "A key is set." : "No key is set.";
}

/**
 * What saving the form sends: the connection whole, from what the form holds over the connection it
 * changes (a save replaces a connection whole, so what the form does not show goes as it was), and its
 * key: a key typed is sent, none typed keeps the one there is, and "take the key away" sends null.
 */
export function draftOf(form: Iterable<readonly [string, FormDataEntryValue]>, was: ConnectionShown | null): SaveConnection {
  const field = new Map<string, string>();
  for (const [name, value] of form) field.set(name, typeof value === "string" ? value.trim() : "");
  const text = (name: string): string | null => {
    const value = field.get(name) ?? "";
    return value === "" ? null : value;
  };
  const effort = text("effort");
  const connection = {
    name: field.get("name") ?? "",
    provider: field.get("provider") ?? "",
    auth: (field.get("auth") ?? "key") as ConnectionAuth,
    baseUrl: text("baseUrl"),
    api: text("api"),
    model: text("model"),
    effort: EFFORTS.find((e) => e === effort) ?? null,
    serialTools: was?.serialTools ?? null,
    messageThreads: was?.messageThreads ?? null,
    retries: was?.retries ?? null,
    limits: limitsOf(field, text("model"), was),
  };
  const key = field.get("key") ?? "";
  return { connection, ...(field.get("dropKey") === "on" ? { key: null } : key === "" ? {} : { key }) };
}

/**
 * The user's own limits as the form leaves them: those of the connection's model as typed (a field left
 * empty sets none), those of its other models as they were; null when none is set.
 */
function limitsOf(field: ReadonlyMap<string, string>, model: string | null, was: ConnectionShown | null): Record<string, ModelLimitsEntry> | null {
  const own: Record<string, ModelLimitsEntry> = { ...(was?.limits ?? {}) };
  if (model !== null) {
    const typed = (name: string): number | undefined => {
      const raw = field.get(name) ?? "";
      const value = Number(raw);
      return raw === "" || !Number.isFinite(value) ? undefined : value;
    };
    const contextWindow = typed("contextWindow");
    const maxTokens = typed("maxTokens");
    const entry: ModelLimitsEntry = { ...(contextWindow === undefined ? {} : { contextWindow }), ...(maxTokens === undefined ? {} : { maxTokens }) };
    if (entry.contextWindow === undefined && entry.maxTokens === undefined) delete own[model];
    else own[model] = entry;
  }
  return Object.keys(own).length === 0 ? null : own;
}

/** The limit fields' text for `model`: the user's own entry for it on the connection, else empty. */
export function limitFieldsFor(was: ConnectionShown | null, model: string): { contextWindow: string; maxTokens: string } {
  const entry = model === "" ? undefined : was?.limits?.[model];
  return { contextWindow: String(entry?.contextWindow ?? ""), maxTokens: String(entry?.maxTokens ?? "") };
}

/** The form that adds a connection (`was` null) or changes one. Its key field starts empty: RPE never sends a key back. `fill` starts the limit fields with figures a test found, for the player to save or not. */
function ConnectionForm(props: { was: ConnectionShown | null; fill?: ModelLimitsEntry; providers: readonly ProviderOffer[]; saving: boolean; refusal: string | null; onSave(save: SaveConnection): void; onCancel(): void }) {
  const { was, fill } = props;
  const start = limitFieldsFor(was, was?.model ?? "");
  return (
    <form
      class="lre-section lre-stack rpe-form"
      data-form={was?.id ?? "new"}
      onSubmit={(event) => {
        event.preventDefault();
        props.onSave(draftOf(new FormData(event.currentTarget), was));
      }}
    >
      <div class="lre-section-head">
        <h3 class="lre-section-title">{was === null ? "A new connection" : `Change ${was.name}`}</h3>
      </div>
      <div class="lre-section-body lre-stack">
        {props.refusal === null ? null : (
          <Banner tone="neg" icon="alert" title="RPE did not save it">
            <span>{props.refusal}</span>
          </Banner>
        )}
        <label class="lre-field">
          <span class="label">Name</span>
          <input name="name" class="lre-input" required defaultValue={was?.name ?? ""} autoComplete="off" />
        </label>
        <label class="lre-field">
          <span class="label">Provider</span>
          <select name="provider" class="lre-input">
            {props.providers.map((p, i) => (
              <option key={p.id} value={p.id} selected={was === null ? i === 0 : p.id === was.provider}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label class="lre-field">
          <span class="label">How its calls are signed</span>
          <select name="auth" class="lre-input">
            {(Object.keys(AUTH_WORDS) as ConnectionAuth[]).map((auth) => (
              <option key={auth} value={auth} selected={auth === (was?.auth ?? "key")}>
                {AUTH_WORDS[auth]}
              </option>
            ))}
          </select>
        </label>
        <label class="lre-field">
          <span class="label">Model</span>
          <input
            name="model"
            class="lre-input"
            defaultValue={was?.model ?? ""}
            autoComplete="off"
            spellcheck={false}
            onInput={(event) => {
              // The limit fields are for the model named here: another model's figures are not carried over to it.
              const input = event.currentTarget;
              const fields = limitFieldsFor(was, input.value.trim());
              for (const name of ["contextWindow", "maxTokens"] as const) {
                const field = input.form?.elements.namedItem(name) as HTMLInputElement | null | undefined;
                if (field != null) field.value = fields[name];
              }
            }}
          />
          <span class="lre-field-help">For an agent whose definition names none.</span>
        </label>
        <label class="lre-field">
          <span class="label">Thinking effort</span>
          {/* A select's starting choice is its option marked selected: Preact gives a select no defaultValue. */}
          <select name="effort" class="lre-input">
            <option value="" selected={was?.effort === undefined}>
              The model's own
            </option>
            {EFFORTS.map((effort) => (
              <option key={effort} value={effort} selected={effort === was?.effort}>
                {effort}
              </option>
            ))}
          </select>
          <span class="lre-field-help">For an agent whose definition names none.</span>
        </label>
        <label class="lre-field">
          <span class="label">Address</span>
          <input name="baseUrl" class="lre-input" type="url" defaultValue={was?.baseUrl ?? ""} autoComplete="off" spellcheck={false} />
          <span class="lre-field-help">Where its calls go instead of the provider's own address: a compatible server's, or a proxy's.</span>
        </label>
        <label class="lre-field">
          <span class="label">API</span>
          <input name="api" class="lre-input" defaultValue={was?.api ?? ""} autoComplete="off" spellcheck={false} />
          <span class="lre-field-help">The API a compatible server speaks, where it speaks more than one.</span>
        </label>
        <label class="lre-field">
          <span class="label">Context window</span>
          <input name="contextWindow" class="lre-input" type="number" inputMode="numeric" defaultValue={fill?.contextWindow === undefined ? start.contextWindow : String(fill.contextWindow)} autoComplete="off" />
          <span class="lre-field-help">In tokens, for its model, in place of the figure RPH would use. Leave it empty to use that figure.</span>
        </label>
        <label class="lre-field">
          <span class="label">Longest reply</span>
          <input name="maxTokens" class="lre-input" type="number" inputMode="numeric" defaultValue={fill?.maxTokens === undefined ? start.maxTokens : String(fill.maxTokens)} autoComplete="off" />
          <span class="lre-field-help">In tokens, for its model, in place of the figure RPH would use. Leave it empty to use that figure.</span>
        </label>
        {fill === undefined ? null : <p class="rpe-meta" data-filled="true">The two limits are filled in from the test. Save to take them as this connection's own; nothing is written until you do.</p>}
        <label class="lre-field">
          <span class="label">Key</span>
          <input name="key" class="lre-input" type="password" defaultValue="" autoComplete="off" spellcheck={false} />
          <span class="lre-field-help">{was === null ? "Sent to RPE once, and never shown again." : `${keyWords(was)} Type a new one to replace it, or leave it empty to keep it.`}</span>
        </label>
        {was?.key?.set === true ? (
          <label class="lre-inline">
            <input name="dropKey" type="checkbox" />
            <span>Take the key away</span>
          </label>
        ) : null}
        <div class="lre-inline">
          <button type="submit" class="lre-btn primary" disabled={props.saving} aria-busy={props.saving ? "true" : undefined}>
            Save
          </button>
          <Button kind="ghost" onClick={props.onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}

/** What the page is doing besides showing the list: a form open (adding when its id is null), a removal waiting for its yes. */
export type ConnectionsAction = { kind: "none" } | { kind: "form"; id: string | null; fill?: ModelLimitsEntry } | { kind: "remove"; id: string };

/** A connection's test: under way, what came of it, or RPE's refusal to make it, in its words. */
export type ConnectionTestShown = { busy: true } | { busy: false; tested: ConnectionTested; problem: null } | { busy: false; tested: null; problem: string };

/** Tests a connection with one small call. */
export async function testConnection(client: Pick<RpeClient, "call">, id: string): Promise<ConnectionTestShown> {
  try {
    return { busy: false, tested: await client.call("POST /api/v1/connections/:id/test", { id }), problem: null };
  } catch (error) {
    return { busy: false, tested: null, problem: errorWords(error) };
  }
}

export interface ConnectionsViewProps {
  list: ConnectionsShown | null;
  loading: boolean;
  /** Why the list could not be read, in RPE's words. */
  problem: string | null;
  action: ConnectionsAction;
  saving: boolean;
  /** RPE's refusal of the last change asked of it, in its words. */
  refusal: string | null;
  onAction(action: ConnectionsAction): void;
  onSave(save: SaveConnection, id: string | null): void;
  onRemove(id: string): void;
  onDefault(id: string): void;
  /** Each connection's last test, by its id. */
  tests: Readonly<Record<string, ConnectionTestShown>>;
  onTest(id: string): void;
}

/**
 * What came of a connection's test: the model that answered and its limits, or the provider's words.
 * Where the provider answered as another model than the connection names, and the catalogue lists
 * limits for it, it says so and offers them as the connection's own: `onTake` opens the form with them
 * filled in, and writes nothing.
 */
function TestShown(props: { test: ConnectionTestShown; view: ConnectionShown; onTake(fill: ModelLimitsEntry): void }) {
  const { test, view } = props;
  if (test.busy) return <p class="lre-muted rpe-line">Testing…</p>;
  if (test.problem !== null) {
    return (
      <Banner tone="neg" icon="alert" title="The test could not be made">
        <span>{test.problem}</span>
      </Banner>
    );
  }
  const tested = test.tested;
  if (!tested.ok) {
    return (
      <Banner tone="warn" icon="alert" title="It did not answer">
        <span>{`${tested.error} (${duration(tested.ms)})`}</span>
      </Banner>
    );
  }
  const limits = tested.limits;
  const fill: ModelLimitsEntry = { ...(limits?.contextWindow == null ? {} : { contextWindow: limits.contextWindow.tokens }), ...(limits?.maxTokens == null ? {} : { maxTokens: limits.maxTokens.tokens }) };
  const other = view.model !== undefined && view.model !== null && tested.model !== view.model && Object.keys(fill).length > 0;
  return (
    <div class="lre-stack">
      <p class="rpe-line" data-tested="ok">{`It answered in ${duration(tested.ms)}, as ${tested.model}. ${limitsWords(tested.limits)}.`}</p>
      {other ? (
        <div class="lre-inline rpe-wrap" data-offer="limits">
          <span class="rpe-meta">{`The provider answered as ${tested.model}, not ${view.model}, so RPH does not use these figures for this connection unless you take them as its own.`}</span>
          <Button small onClick={() => props.onTake(fill)}>
            Take these limits
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ConnectionRow(props: { view: ConnectionShown; action: ConnectionsAction; test: ConnectionTestShown | undefined; onAction(action: ConnectionsAction): void; onRemove(id: string): void; onDefault(id: string): void; onTest(id: string): void }) {
  const { view, action } = props;
  const said = [view.provider, view.model, view.effort === undefined ? null : `thinks at ${view.effort}`].filter((part) => part !== null && part !== undefined).join(" · ");
  return (
    <li class="lre-section" data-connection={view.id}>
      <div class="lre-section-head">
        <h3 class="lre-section-title">{view.name}</h3>
        {view.default ? <Badge tone="pos">default</Badge> : null}
      </div>
      <div class="lre-section-body lre-stack">
        <p class="rpe-line">{said}</p>
        <p class="rpe-meta">{keyWords(view)}</p>
        <p class="rpe-meta" data-limits={view.id}>{`${limitsWords(view.limitsInForce)}.`}</p>
        {action.kind === "remove" && action.id === view.id ? (
          <div class="lre-inline rpe-wrap">
            <span>Remove {view.name}?</span>
            <Button small kind="danger" onClick={() => props.onRemove(view.id)}>
              Remove it
            </Button>
            <Button small kind="ghost" onClick={() => props.onAction({ kind: "none" })}>
              Keep it
            </Button>
          </div>
        ) : (
          <div class="lre-inline rpe-wrap">
            {view.default ? null : (
              <Button small onClick={() => props.onDefault(view.id)}>
                Make it the default
              </Button>
            )}
            <Button small kind="ghost" onClick={() => props.onAction({ kind: "form", id: view.id })}>
              Change
            </Button>
            <Button small kind="ghost" onClick={() => props.onAction({ kind: "remove", id: view.id })}>
              Remove
            </Button>
            <Button small kind="ghost" busy={props.test?.busy === true} onClick={() => props.onTest(view.id)}>
              Test it
            </Button>
          </div>
        )}
        {props.test === undefined ? null : <TestShown test={props.test} view={view} onTake={(fill) => props.onAction({ kind: "form", id: view.id, fill })} />}
      </div>
    </li>
  );
}

export function ConnectionsView(props: ConnectionsViewProps) {
  const { list, action } = props;
  const editing = action.kind === "form" ? action : null;
  const was = editing === null || editing.id === null ? null : (list?.connections.find((c) => c.id === editing.id) ?? null);
  return (
    <div class="lre-stack rpe-page" data-page="connections">
      <PageHeader
        title="Connections"
        sub="The models RPE's agents call, and how each signs its calls."
        actions={
          editing === null && list !== null ? (
            <Button small onClick={() => props.onAction({ kind: "form", id: null })}>
              Add a connection
            </Button>
          ) : undefined
        }
      />
      {props.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The connections could not be read">
          <span>{props.problem}</span>
        </Banner>
      )}
      {props.refusal === null || editing !== null ? null : (
        <Banner tone="neg" icon="alert" title="RPE did not make that change">
          <span>{props.refusal}</span>
        </Banner>
      )}
      {editing === null || list === null ? null : <ConnectionForm key={`${editing.id ?? "new"}:${JSON.stringify(editing.fill ?? null)}`} was={was} fill={editing.fill} providers={list.providers} saving={props.saving} refusal={props.refusal} onSave={(save) => props.onSave(save, editing.id)} onCancel={() => props.onAction({ kind: "none" })} />}
      {list === null ? (
        props.loading ? (
          <p class="lre-muted rpe-line">Reading the connections…</p>
        ) : null
      ) : list.connections.length === 0 ? (
        <Empty icon="link" title="No connection yet">
          <span>RPE's agents call their models through a connection.</span>
        </Empty>
      ) : (
        <ul class="lre-stack rpe-plain">
          {list.connections.map((view) => (
            <ConnectionRow key={view.id} view={view} action={action} test={props.tests[view.id]} onAction={props.onAction} onRemove={props.onRemove} onDefault={props.onDefault} onTest={props.onTest} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Asks RPE for a change to the connections, then reads them again; RPE's refusal comes back in its words. */
async function changeThen(client: Pick<RpeClient, "call">, change: () => Promise<unknown>): Promise<{ list: ConnectionsShown | null; refusal: string | null }> {
  try {
    await change();
  } catch (error) {
    return { list: null, refusal: errorWords(error) };
  }
  return { list: await client.call("GET /api/v1/connections", {}), refusal: null };
}

export function ConnectionsPage() {
  const app = useApp();
  const [list, setList] = useState<ConnectionsShown | null>(null);
  const [read, setRead] = useState<{ loading: boolean; problem: string | null }>({ loading: true, problem: null });
  const [action, setAction] = useState<ConnectionsAction>({ kind: "none" });
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [tests, setTests] = useState<Readonly<Record<string, ConnectionTestShown>>>({});
  useEffect(() => {
    let alive = true;
    app.client.call("GET /api/v1/connections", {}).then(
      (got) => {
        if (!alive) return;
        setList(got);
        setRead({ loading: false, problem: null });
      },
      (error: unknown) => {
        if (alive) setRead({ loading: false, problem: errorWords(error) });
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  const ask = (change: () => Promise<unknown>, after: ConnectionsAction): void => {
    setSaving(true);
    setRefusal(null);
    changeThen(app.client, change).then(
      (done) => {
        setSaving(false);
        setRefusal(done.refusal);
        if (done.list !== null) {
          setList(done.list);
          setAction(after);
        }
      },
      (error: unknown) => {
        setSaving(false);
        setRead({ loading: false, problem: errorWords(error) });
      },
    );
  };
  return (
    <ConnectionsView
      list={list}
      loading={read.loading}
      problem={read.problem}
      action={action}
      saving={saving}
      refusal={refusal}
      onAction={(next) => {
        setRefusal(null);
        setAction(next);
      }}
      onSave={(save, id) => ask(() => (id === null ? app.client.call("POST /api/v1/connections", {}, { body: save }) : app.client.call("PUT /api/v1/connections/:id", { id }, { body: save })), { kind: "none" })}
      onRemove={(id) => ask(() => app.client.call("DELETE /api/v1/connections/:id", { id }), { kind: "none" })}
      onDefault={(id) => ask(() => app.client.call("PUT /api/v1/connections/:id/default", { id }), action)}
      tests={tests}
      onTest={(id) => {
        setTests((now) => ({ ...now, [id]: { busy: true } }));
        testConnection(app.client, id).then((test) => setTests((now) => ({ ...now, [id]: test })));
      }}
    />
  );
}

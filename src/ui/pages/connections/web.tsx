// The web search provider (plan R-71): where `web_search` goes, set here and nowhere else. Its address, and a key for it when it wants one; the key is
// never shown, only whether one is kept. Taking the address away switches web_search off. A kept key stays only while the address is the same.

import { useState } from "preact/hooks";
import { useApp } from "../../app";
import { Badge, Banner, Button, Section } from "../../atoms";
import { useRead } from "../../reading";
import { errorWords } from "../../words";

export function WebSearchSection() {
  const app = useApp();
  const shown = useRead(() => app.client.call("GET /api/v1/connections/web", {}), []);
  const [address, setAddress] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const now = shown.value;
  const typed = address ?? now?.address ?? "";
  const save = (to: string | null): void => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const body = { address: to === null ? null : to.trim() === "" ? null : to.trim(), ...(key !== "" ? { key } : removeKey ? { key: null } : {}) };
    app.client.call("PUT /api/v1/connections/web", {}, { body }).then(
      (answer) => {
        setBusy(false);
        setAddress(null);
        setKey("");
        setRemoveKey(false);
        setSaid(answer.address === null ? "Web search is off: no provider is set." : "Saved: web_search goes there.");
        shown.again();
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(errorWords(error));
      },
    );
  };
  return (
    <Section id="web-search" title="Web search">
      <p class="rpe-line">Where an agent's <code>web_search</code> goes. With no address it is off.</p>
      {shown.problem === null ? null : <p class="rpe-line">{shown.problem}</p>}
      {now === null ? null : (
        <p class="rpe-line" data-web-state>
          <Badge tone={now.address === null ? undefined : "pos"}>{now.address === null ? "off" : "on"}</Badge> {now.address === null ? "" : <code>{now.address}</code>} {now.key ? <Badge>a key is kept</Badge> : null}
        </p>
      )}
      <label class="lre-field">
        <span class="label">Address of the provider</span>
        <input class="lre-input" value={typed} spellcheck={false} placeholder="https://" onInput={(e) => setAddress((e.currentTarget as HTMLInputElement).value)} />
      </label>
      <label class="lre-field">
        <span class="label">Its key, where it wants one {now?.key ? "(leave empty to keep the one kept)" : ""}</span>
        <input class="lre-input" type="password" autoComplete="off" value={key} onInput={(e) => setKey((e.currentTarget as HTMLInputElement).value)} />
      </label>
      {now?.key ? (
        <label class="lre-inline">
          <input type="checkbox" checked={removeKey} onChange={(e) => setRemoveKey((e.currentTarget as HTMLInputElement).checked)} /> Take the kept key away
        </label>
      ) : null}
      <div class="lre-inline rpe-wrap">
        <Button busy={busy} onClick={() => save(typed)}>
          Save
        </Button>
        {now?.address === null || now === null ? null : (
          <Button kind="ghost" busy={busy} onClick={() => save(null)}>
            Switch web search off
          </Button>
        )}
      </div>
      {said === null ? null : <p class="rpe-line" data-said>{said}</p>}
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not saved">
          <span data-problem>{problem}</span>
        </Banner>
      )}
    </Section>
  );
}

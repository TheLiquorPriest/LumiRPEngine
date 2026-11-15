// The Build page (plan §14, "What happens to today's UI"): today's Build mode, the world builder, kept
// as it is and talking to RPE. It mounts today's own root component (`frontend/build/build.tsx`) in an
// App made for it (app.ts), over the page's client to RPE's Build route (transport.ts), with today's
// stylesheets (styles.ts) and the bridge the shell gives (host.ts). Leaving the page takes all of it
// away. Today's Build keeps its own place in its own pages, so the page's route is Build alone. Above
// whichever of Build's pages shows, RPE's own words for each tool it does not serve that the page asked
// for, once.

import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { AppContext as TodayContext } from "../../frontend/app";
import { Build } from "../../frontend/build/build";
import { Banner, IdsSurface, Toasts } from "../../frontend/components";
import { type Readable, useSelect } from "../store";
import type { ErrorMessage } from "../../shared/protocol";
import { useApp } from "../app";
import type { Timers } from "../roads";
import { keptApp } from "./app";
import type { KeptHost } from "./host";
import { KEPT_CSS } from "./styles";
import { type BuildTransport, buildTransport } from "./transport";

export interface BuildMount {
  transport: BuildTransport;
  host: KeptHost;
  timers: Timers;
}

/** RPE's own words, as it gave them, for each tool it does not serve that this page asked for. */
function Said(props: { said: Readable<readonly ErrorMessage[]> }) {
  const said = useSelect(props.said, (all) => all.filter((answer) => answer.message !== ""));
  if (said.length === 0) return null;
  return (
    <div class="lre-stack" data-rpe-said>
      {said.map((answer) => (
        <Banner key={answer.message} tone="info" icon="info">
          {answer.message}
        </Banner>
      ))}
    </div>
  );
}

/** Puts today's Build mode in `root`; the returned function takes it away with all it started. */
export function mountBuild(root: HTMLElement, mount: BuildMount): () => void {
  const removeStyle = mount.host.addStyle(KEPT_CSS);
  const kept = keptApp(mount);
  // Ids show here under Show ids, as in today's Build; a form sheet, while open, is all the body shows (`lre-mode-body`, FORMS_CSS).
  render(
    <TodayContext.Provider value={kept.app}>
      <div class="rpe-kept-body lre-mode-body">
        <Said said={kept.said} />
        <IdsSurface.Provider value={true}>
          <Build />
        </IdsSurface.Provider>
      </div>
      <Toasts surface="drawer" />
    </TodayContext.Provider>,
    root,
  );
  return () => {
    render(null, root);
    kept.stop();
    mount.transport.close();
    mount.host.dispose();
    removeStyle();
  };
}

export function BuildPage() {
  const app = useApp();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const at = root.current;
    if (at === null) return undefined;
    return mountBuild(at, { transport: buildTransport(app.client), host: app.keptHost(), timers: app.timers });
  }, []);
  return <div ref={root} class="rpe-kept" />;
}

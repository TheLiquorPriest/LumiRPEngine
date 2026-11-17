// "Map again" (plan §4.8, §13.5, R-27): he asks for his preset's prompt to be mapped afresh. RPE starts the mapper as his own job, tied to
// no turn; the page names the job, leads to its run on Live, and reads the map again when the job has ended, so what it learned shows
// and his own edits to the map, which RPH keeps with the preset, stay. Nothing here maps anything itself.

import { useEffect, useState } from "preact/hooks";
import type { JobState } from "../../../shared/api";
import { useApp } from "../../app";
import { Banner, Button } from "../../../frontend/components";
import { onChatChange } from "../../live-watch";
import { errorWords } from "../../words";

/** The mapper's own definition, which "Map again" starts. */
export const MAPPER = "mapper";

const ENDED: readonly JobState[] = ["done", "failed", "cancelled", "interrupted", "off-path"];

const STATE_WORDS: Readonly<Record<JobState, string>> = {
  queued: "is waiting to start",
  held: "is held back",
  running: "is mapping",
  asking: "is asking him something",
  done: "has ended: the map below is what it learned",
  failed: "failed; RPE's log, on Runtime, says why",
  cancelled: "was cancelled",
  "off-path": "ended off the path",
  interrupted: "was interrupted",
};

export function MapAgain(props: { chat: string; onLearned(): void }) {
  const app = useApp();
  const { chat } = props;
  const [job, setJob] = useState<{ id: string; state: JobState } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const start = (): void => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    app.client.call("POST /api/v1/chats/:chat/jobs", { chat }, { body: { definition: MAPPER, brief: "" } }).then(
      (answer) => {
        setBusy(false);
        setJob({ id: answer.job.id, state: answer.job.state });
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(errorWords(error));
      },
    );
  };
  // The job's state is read again whenever a run of the chat begins or ends, until it has ended; the map is read again once it has.
  const watching = job !== null && !ENDED.includes(job.state);
  useEffect(() => {
    if (!watching) return;
    const read = (): void => {
      app.client.call("GET /api/v1/jobs", {}, { query: { chat } }).then(
        (answer) => {
          const found = answer.items.find((j) => j.id === job?.id);
          if (found === undefined) return;
          setJob({ id: found.id, state: found.state });
          if (ENDED.includes(found.state)) props.onLearned();
        },
        () => undefined,
      );
    };
    read();
    return onChatChange(app.client, chat, read);
  }, [chat, watching, job?.id]);
  return (
    <div class="lre-stack" data-map-again>
      <Button size="sm" busy={busy || watching} onClick={start}>
        Map again
      </Button>
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not started">
          <span data-map-problem>{problem}</span>
        </Banner>
      )}
      {job === null ? null : (
        <p class="rpe-line" data-map-job>
          His own job {job.id} {STATE_WORDS[job.state]}.{" "}
          <Button size="sm" variant="ghost" onClick={() => app.go({ page: "live", chat })}>
            Watch its run on Live
          </Button>
        </p>
      )}
    </div>
  );
}

// "Map again" (plan §4.8, §13.5, R-27): he asks for his preset's prompt to be mapped afresh. RPE starts the mapper as his own job, tied to
// no turn; the page follows the job where it started it (running, what it has spent, how it ended), leads to its run on Live, and reads the map
// again when the job has ended, so what it learned shows and his own edits to the map, which RPH keeps with the preset, stay. Nothing here maps
// anything itself.

import { useState } from "preact/hooks";
import { useApp } from "../../app";
import { Banner, Button } from "../../../frontend/components";
import { jobEnded } from "../../job-watch";
import { errorWords } from "../../words";
import { type JobRef, JobFollowLine, useJobFollow } from "../jobs/follow";

/** The mapper's own definition, which "Map again" starts. */
export const MAPPER = "mapper";

export function MapAgain(props: { chat: string; onLearned(): void }) {
  const app = useApp();
  const { chat } = props;
  const [job, setJob] = useState<JobRef | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const watched = useJobFollow(job, props.onLearned);
  const going = job !== null && (watched?.job == null ? job.view === undefined || !jobEnded(job.view.state) : !jobEnded(watched.job.state));
  const start = (): void => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    app.client.call("POST /api/v1/chats/:chat/jobs", { chat }, { body: { definition: MAPPER, brief: "" } }).then(
      (answer) => {
        setBusy(false);
        setJob({ id: answer.job.id, chat, view: answer.job });
      },
      (error: unknown) => {
        setBusy(false);
        setProblem(errorWords(error));
      },
    );
  };
  return (
    <div class="lre-stack" data-map-again>
      <Button size="sm" busy={busy || going} onClick={start}>
        Map again
      </Button>
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not started">
          <span data-map-problem>{problem}</span>
        </Banner>
      )}
      {job === null ? null : (
        <div class="lre-stack" data-map-job>
          <JobFollowLine job={job} what="Your own mapping job" afterDone="The map below is what it learned." watched={watched} />
          <Button size="sm" variant="ghost" onClick={() => app.go({ page: "live", chat })}>
            Watch its run on Live
          </Button>
        </div>
      )}
    </div>
  );
}

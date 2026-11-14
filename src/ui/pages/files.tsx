// Files (plan §14, §5.2): the agents' files by level (shipped, yours, this chat's), which of them applies,
// each opened as text, edited or switched off. RPE serves the pages none of the agents' files yet, so the
// page says it cannot show them, and shows nothing it would have to guess.

import { Banner, PageHeader } from "../atoms";

export function FilesPage(props: { chat: string | null }) {
  return (
    <div class="lre-stack rpe-page" data-page="files" data-chat={props.chat ?? undefined}>
      <PageHeader title="Files" sub="The agents' files by level: shipped, yours, and this chat's." />
      <Banner tone="info" icon="info" title="Not available yet">
        <span>This page cannot list, open, change or switch off the agents' files yet.</span>
      </Banner>
    </div>
  );
}

// Settings (plan §14): the settings a turn runs under, each with its shipped default and the level that
// sets it, among them the two set per connection (the reply's form, the thinking effort). RPE serves the
// pages no settings yet, so the page says it cannot show them, and shows nothing it would have to guess.

import { Banner, PageHeader } from "../atoms";

export function SettingsPage() {
  return (
    <div class="lre-stack rpe-page" data-page="settings">
      <PageHeader title="Settings" sub="The settings RPE's agents run under, each with its shipped default." />
      <Banner tone="info" icon="info" title="Not available yet">
        <span>This page cannot show or change the settings yet.</span>
      </Banner>
    </div>
  );
}

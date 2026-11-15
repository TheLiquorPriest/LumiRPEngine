#!/usr/bin/env bash
# The rebuild's code installed on the bed from its mirrors, with no network (PlanScenarios-5 item 9; R-196). Run on the bed, after `feed.sh`:
#
#   checkout.sh <RPE commit> <destination>
#
# It clones RPE's checkout from its mirror (`$RPE_PROOF_ROOT/remotes/rpe.git`, `/tmp/rpe-proof` unless the environment names another root) at the commit under proof, and refuses a
# commit the mirror was not fed (`feed.sh` keeps each commit it feeds as the tag `rpe-proof-<commit>`). It writes the git settings file `$RPE_PROOF_ROOT/gitconfig`, which sends
# `https://rph.invalid/RPHarness.git` to RPH's mirror, and runs the install with `GIT_CONFIG_GLOBAL` set to that file alone, so the name the manifest gives RPH resolves to the mirror and
# nothing reaches GitHub. It then verifies what was installed: the manifest names one whole commit of RPH, `node_modules/rp-harness` is a real folder and not a link, and every file of
# that commit is in it with the same content (the check `build/pin.sh verify` makes; `RPE_PROOF_PIN_VERIFY`, a command run in the checkout with `RPH_MIRROR` and `RPH_COMMIT` set, takes its place
# where the bed has that script). `BUN` names the package manager (`bun` unless set). Each step (the checkout, the settings file, the install) is a kind of change the lead records in the
# environment's record in STATE.md before it is first made.
set -euo pipefail

ROOT=${RPE_PROOF_ROOT:-/tmp/rpe-proof}
BUN=${BUN:-bun}
[ $# -eq 2 ] || { sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
COMMIT=$1 DEST=$2
[[ $COMMIT =~ ^[0-9a-f]{40}$ ]] || { echo "checkout: the commit is not a whole commit (40 hex digits): $COMMIT" >&2; exit 2; }

RPE_MIRROR="$ROOT/remotes/rpe.git"
RPH_MIRROR="$ROOT/remotes/rph.git"
[ -d "$RPE_MIRROR" ] && [ -d "$RPH_MIRROR" ] || { echo "checkout: the mirrors under $ROOT/remotes are not there: run feed.sh first" >&2; exit 1; }
git -C "$RPE_MIRROR" rev-parse -q --verify "refs/tags/rpe-proof-$COMMIT^{commit}" >/dev/null \
  || { echo "checkout: $COMMIT is not a commit the mirror was fed: a checkout at another commit than the bundle's is refused" >&2; exit 1; }
[ ! -e "$DEST" ] || [ -z "$(ls -A "$DEST" 2>/dev/null)" ] || { echo "checkout: $DEST is not empty" >&2; exit 1; }

git clone -q --no-checkout "$RPE_MIRROR" "$DEST"
git -C "$DEST" checkout -q --detach "$COMMIT"
[ "$(git -C "$DEST" rev-parse HEAD)" = "$COMMIT" ] || { echo "checkout: the checkout is not at $COMMIT" >&2; exit 1; }

# The commit of RPH the manifest names, whole, under the name that is no host: the settings file sends that name to the mirror.
NAMED=$(grep -o '"rp-harness": *"[^"]*"' "$DEST/package.json" | sed -E 's/.*"(git\+https:\/\/rph\.invalid\/RPHarness\.git)#([0-9a-f]{40})".*/\2/' || true)
[[ $NAMED =~ ^[0-9a-f]{40}$ ]] || { echo "checkout: RPE's package.json names RPH by no whole commit at https://rph.invalid/RPHarness.git" >&2; exit 1; }
git -C "$RPH_MIRROR" rev-parse -q --verify "refs/tags/rpe-proof-$NAMED^{commit}" >/dev/null \
  || { echo "checkout: RPH's mirror was not fed the commit $NAMED that the manifest names" >&2; exit 1; }

printf '[url "%s"]\n\tinsteadOf = https://rph.invalid/RPHarness.git\n' "$RPH_MIRROR" > "$ROOT/gitconfig"
(cd "$DEST" && GIT_CONFIG_GLOBAL="$ROOT/gitconfig" GIT_CONFIG_NOSYSTEM=1 "$BUN" install --frozen-lockfile >/dev/null) \
  || { echo "checkout: the install failed" >&2; exit 1; }

# Verified as installed: a real folder, every file of the commit with the same content.
INSTALLED="$DEST/node_modules/rp-harness"
[ -d "$INSTALLED" ] && [ ! -L "$INSTALLED" ] || { echo "checkout: $INSTALLED is not a real folder" >&2; exit 1; }
if [ -n "${RPE_PROOF_PIN_VERIFY:-}" ]; then
  (cd "$DEST" && RPH_MIRROR="$RPH_MIRROR" RPH_COMMIT="$NAMED" bash -c "$RPE_PROOF_PIN_VERIFY") || { echo "checkout: the pin check refused what was installed" >&2; exit 1; }
else
  bad=0 n=0
  while IFS=$'\t' read -r meta path; do
    set -- $meta
    blob=$3
    n=$((n + 1))
    if [ ! -f "$INSTALLED/$path" ]; then echo "  missing: $path" >&2; bad=$((bad + 1)); continue; fi
    [ "$(git -C "$RPH_MIRROR" hash-object "$INSTALLED/$path")" = "$blob" ] || { echo "  differs: $path" >&2; bad=$((bad + 1)); }
  done < <(git -C "$RPH_MIRROR" ls-tree -r "$NAMED")
  echo "$n file(s) of RPH $NAMED checked against the installed folder; $bad wrong"
  [ "$bad" -eq 0 ] || { echo "checkout: what was installed is not the commit the manifest names" >&2; exit 1; }
fi
echo "RPE at $COMMIT is in $DEST, with RPH at $NAMED installed from the mirror"

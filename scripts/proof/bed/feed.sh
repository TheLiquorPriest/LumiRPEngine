#!/usr/bin/env bash
# The rebuild's code reaches the bed by bundle, never from GitHub, while nothing is pushed (PlanScenarios-5 item 9; R-196). Run on the Mac:
#
#   feed.sh <RPE repository> <RPE commit> <RPH repository> <RPH commit>
#
# It makes a `git bundle` of RPE and one of RPH at the two commits under proof (each commit whole, 40 hex digits, and a commit of its repository), copies both to the bed, and fetches
# each into the bare mirror the bed keeps of it, `rpe.git` and `rph.git` under `$RPE_PROOF_ROOT/remotes/` (`/tmp/rpe-proof` unless the environment names another root). The
# commit is kept in its mirror as the tag `rpe-proof-<commit>`, so a clone of the mirror holds it and a checkout at any other commit is refused (`checkout.sh`). The two ids are
# written to `$RPE_PROOF_ROOT/bundles.txt` as `rpe <id>` and `rph <id>` lines: the commit ids of the bundles, which the run's record names (`RPE_PROOF_BUNDLES`).
#
# `RPE_PROOF_BED_SSH` is the bed as ssh names it (`user@host`); with none, the bed is this machine and the files are copied in place. Each step (the bundles copied in, the mirrors
# fed) is a kind of change the lead records in the environment's record in STATE.md before it is first made. Nothing here reaches GitHub, and nothing is changed in either
# repository but a tag made for the bundle and taken away again.
set -euo pipefail

ROOT=${RPE_PROOF_ROOT:-/tmp/rpe-proof}
SSH=${RPE_PROOF_BED_SSH:-}
[ $# -eq 4 ] || { sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }
RPE_REPO=$1 RPE_COMMIT=$2 RPH_REPO=$3 RPH_COMMIT=$4

whole() { [[ $2 =~ ^[0-9a-f]{40}$ ]] || { echo "feed: the $1 commit is not a whole commit (40 hex digits): $2" >&2; exit 2; }; }
whole RPE "$RPE_COMMIT"; whole RPH "$RPH_COMMIT"
for pair in "RPE:$RPE_REPO:$RPE_COMMIT" "RPH:$RPH_REPO:$RPH_COMMIT"; do
  IFS=: read -r name repo commit <<<"$pair"
  git -C "$repo" cat-file -e "$commit^{commit}" 2>/dev/null || { echo "feed: $commit is not a commit of $name's repository $repo" >&2; exit 2; }
done

# What is run on the bed: through ssh where there is one, else here.
on_bed() { if [ -n "$SSH" ]; then ssh -o BatchMode=yes "$SSH" "$1"; else bash -c "$1"; fi; }
to_bed() { if [ -n "$SSH" ]; then scp -q -o BatchMode=yes "$1" "$SSH:$2"; else cp "$1" "$2"; fi; }

work=$(mktemp -d)
made=()
cleanup() { for made_ref in "${made[@]:-}"; do [ -n "$made_ref" ] && git -C "${made_ref%%|*}" update-ref -d "${made_ref#*|}" 2>/dev/null || true; done; rm -rf "$work"; }
trap cleanup EXIT

bundle() { # name repo commit: a bundle holding the commit, under the tag the mirror will keep it by
  local name=$1 repo=$2 commit=$3 tag="refs/tags/rpe-proof-$3"
  git -C "$repo" update-ref "$tag" "$commit"
  made+=("$repo|$tag")
  git -C "$repo" bundle create -q "$work/$name.bundle" "$tag" >/dev/null 2>&1 || { echo "feed: the bundle of $name at $commit could not be made" >&2; exit 1; }
}
bundle rpe "$RPE_REPO" "$RPE_COMMIT"
bundle rph "$RPH_REPO" "$RPH_COMMIT"

on_bed "mkdir -p '$ROOT/bundles' '$ROOT/remotes'"
to_bed "$work/rpe.bundle" "$ROOT/bundles/rpe.bundle"
to_bed "$work/rph.bundle" "$ROOT/bundles/rph.bundle"

feed() { # name commit: the mirror holds the commit by its tag, and nothing else is asked of the bundle
  local name=$1 commit=$2 mirror="$ROOT/remotes/$1.git" tag="refs/tags/rpe-proof-$2"
  on_bed "[ -d '$mirror' ] || git init -q --bare '$mirror'; git -C '$mirror' fetch -q '$ROOT/bundles/$name.bundle' '+$tag:$tag'; [ \"\$(git -C '$mirror' rev-parse '$tag^{commit}')\" = '$commit' ]" \
    || { echo "feed: the mirror $mirror does not hold $commit after the fetch" >&2; exit 1; }
  echo "fed $name at $commit into $mirror"
}
feed rpe "$RPE_COMMIT"
feed rph "$RPH_COMMIT"
on_bed "printf 'rpe %s\nrph %s\n' '$RPE_COMMIT' '$RPH_COMMIT' > '$ROOT/bundles.txt'"
echo "the bundles' commit ids are in $ROOT/bundles.txt"

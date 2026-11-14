#!/usr/bin/env bash
# Puts a built RPE beside a Lumiverse on a test server and runs it there as a user unit with a
# memory cap, so that a runaway build is the first thing the server gives up. Nothing here names a
# server: every name comes from the environment, and the script is run from the repository's root
# after a build.
#
#   rpe-bed.sh push            copy the built application (dist/) to the server
#   rpe-bed.sh ext             copy the extension's built files into Lumiverse's extension folder
#   rpe-bed.sh start           run `rpe serve` as a transient user unit
#   rpe-bed.sh stop
#   rpe-bed.sh status
#   rpe-bed.sh rpe <args…>     run the rpe command line on the server on the same data folder;
#                              a secret it asks for is read from this script's standard input
#
# BED_HOST      the server's ssh name
# BED_APP       folder for the build on the server
# BED_RPE_DATA  RPE's data folder on the server
# BED_BUN       bun on the server
# BED_EXT_REPO  (ext) the installed extension's folder inside Lumiverse's data
# BED_PORT      RPE's port there (default 7874)
# BED_UNIT      the unit's name (default rpe-testbed)
# BED_LOG       its log (default $BED_APP/rpe.log)
# BED_MEMORY    its memory cap (default 1536M)
# BED_LUMIVERSE (start) Lumiverse's address as RPE reaches it, when the config does not hold it
set -euo pipefail

need() { local name="$1"; [ -n "${!name:-}" ] || { echo "rpe-bed: set $name" >&2; exit 2; }; }
need BED_HOST; need BED_APP; need BED_RPE_DATA; need BED_BUN
BED_PORT="${BED_PORT:-7874}"
BED_UNIT="${BED_UNIT:-rpe-testbed}"
BED_LOG="${BED_LOG:-$BED_APP/rpe.log}"
BED_MEMORY="${BED_MEMORY:-1536M}"

# Single-quotes a word for the remote shell.
q() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
remote() { ssh -o BatchMode=yes "$BED_HOST" "$@"; }

case "${1:-}" in
  push)
    [ -f dist/rpe.js ] || { echo "rpe-bed: no dist/rpe.js here: build first" >&2; exit 1; }
    remote "mkdir -p $(q "$BED_APP") && chmod 700 $(q "$BED_APP")"
    rsync -a --delete --exclude 'rpe.log' dist "$BED_HOST:$BED_APP/"
    rsync -a package.json "$BED_HOST:$BED_APP/"
    remote "cd $(q "$BED_APP") && RPE_DATA=$(q "$BED_RPE_DATA") $(q "$BED_BUN") dist/rpe.js version"
    ;;
  ext)
    need BED_EXT_REPO
    for f in dist/backend.js dist/frontend.js spindle.json package.json; do
      [ -f "$f" ] || { echo "rpe-bed: no $f here: build first" >&2; exit 1; }
    done
    remote "mkdir -p $(q "$BED_EXT_REPO")/dist"
    rsync -a dist/backend.js dist/frontend.js "$BED_HOST:$BED_EXT_REPO/dist/"
    rsync -a spindle.json package.json "$BED_HOST:$BED_EXT_REPO/"
    ;;
  start)
    env_args="--setenv=RPE_DATA=$(q "$BED_RPE_DATA") --setenv=RPE_PORT=$(q "$BED_PORT")"
    [ -z "${BED_LUMIVERSE:-}" ] || env_args="$env_args --setenv=RPE_LUMIVERSE_URL=$(q "$BED_LUMIVERSE")"
    remote "mkdir -p $(q "$BED_RPE_DATA") && chmod 700 $(q "$BED_RPE_DATA") && systemd-run --user --unit=$(q "$BED_UNIT") --collect \
      -p MemoryMax=$(q "$BED_MEMORY") -p MemorySwapMax=0 -p OOMScoreAdjust=1000 \
      -p StandardOutput=append:$(q "$BED_LOG") -p StandardError=append:$(q "$BED_LOG") \
      -p WorkingDirectory=$(q "$BED_APP") $env_args \
      $(q "$BED_BUN") dist/rpe.js serve"
    ;;
  stop)
    remote "systemctl --user stop $(q "$BED_UNIT") 2>/dev/null; systemctl --user is-active $(q "$BED_UNIT") || true"
    ;;
  status)
    remote "systemctl --user is-active $(q "$BED_UNIT") || true; ss -ltnH 'sport = :$BED_PORT' | awk '{print \$4}'; cd $(q "$BED_APP") && RPE_DATA=$(q "$BED_RPE_DATA") RPE_PORT=$(q "$BED_PORT") $(q "$BED_BUN") dist/rpe.js status || true"
    ;;
  rpe)
    shift
    words=""
    for w in "$@"; do words="$words $(q "$w")"; done
    remote "cd $(q "$BED_APP") && RPE_DATA=$(q "$BED_RPE_DATA") RPE_PORT=$(q "$BED_PORT") $(q "$BED_BUN") dist/rpe.js$words"
    ;;
  *)
    echo "usage: rpe-bed.sh push|ext|start|stop|status|rpe <args…>" >&2
    exit 2
    ;;
esac

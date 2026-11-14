#!/usr/bin/env bash
# A whole-instance snapshot of a test bed, taken with everything stopped, and its restore.
#
#   golden.sh take    <archive.tar.zst>
#   golden.sh restore <archive.tar.zst>
#   golden.sh list    <archive.tar.zst>
#
# What it covers is given by the environment, so that nothing about a machine is written here:
#   BED_ROOT      the test bed's folder: Lumiverse's data folder and the instance's own files live under it
#   BED_SKIP      folders under BED_ROOT left out of the snapshot (code checkouts), space separated
#   RUNTIME_HOME  the home folder under which today's runtime keeps .config/lumiah and .local/share/lumiah
#   BED_UNITS     the systemd user units to stop before and start after, in stop order, space separated
#   BED_MARK      a file under BED_ROOT that must exist, as proof that BED_ROOT is the test bed
#   BED_LAST_UNIT   optional: one more unit, stopped last and started first (the application the others
#                   link to), for when it runs as a transient unit that is gone once stopped
#   BED_LAST_START  the whole command that starts BED_LAST_UNIT again
#
# Everything stopped is started again however the command ends.

set -u

usage() { sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

[ $# -eq 2 ] || usage
ACTION=$1
ARCHIVE=$2

for name in BED_ROOT RUNTIME_HOME BED_UNITS BED_MARK; do
  [ -n "${!name:-}" ] || { echo "golden: $name is not set" >&2; exit 2; }
done
BED_SKIP=${BED_SKIP:-}

case "$BED_ROOT" in
  /|/tmp|/srv|/home|"") echo "golden: BED_ROOT is not a test bed's own folder: $BED_ROOT" >&2; exit 2 ;;
esac
[ -f "$BED_ROOT/$BED_MARK" ] || { echo "golden: $BED_ROOT/$BED_MARK is not there; this is not the test bed" >&2; exit 2; }

BED_PARENT=$(dirname "$BED_ROOT")
BED_NAME=$(basename "$BED_ROOT")
RUNTIME_PARTS=".config/lumiah .local/share/lumiah"

stop_units() {
  for unit in $BED_UNITS ${BED_LAST_UNIT:-}; do
    systemctl --user stop "$unit" || echo "golden: could not stop $unit" >&2
  done
  for unit in $BED_UNITS ${BED_LAST_UNIT:-}; do
    if systemctl --user is-active --quiet "$unit"; then
      echo "golden: $unit is still running; nothing was read or written" >&2
      return 1
    fi
  done
}

start_units() {
  # Started in the reverse of the stop order: the application the runtimes link to comes up first.
  if [ -n "${BED_LAST_UNIT:-}" ] && ! systemctl --user is-active --quiet "$BED_LAST_UNIT"; then
    bash -c "$BED_LAST_START" || echo "golden: could not start $BED_LAST_UNIT" >&2
    sleep 5
  fi
  local reversed=""
  for unit in $BED_UNITS; do reversed="$unit $reversed"; done
  for unit in $reversed; do
    systemctl --user start "$unit" || echo "golden: could not start $unit" >&2
  done
}

if [ -n "${BED_LAST_UNIT:-}" ] && [ -z "${BED_LAST_START:-}" ]; then
  echo "golden: BED_LAST_UNIT is set and BED_LAST_START is not" >&2
  exit 2
fi

case "$ACTION" in
  list)
    tar --zstd -tf "$ARCHIVE" | head -200
    ;;

  take)
    [ ! -e "$ARCHIVE" ] || { echo "golden: $ARCHIVE exists already" >&2; exit 2; }
    excludes=()
    for skip in $BED_SKIP; do excludes+=("--exclude=$BED_NAME/$skip"); done
    stop_units || { start_units; exit 1; }
    trap start_units EXIT
    # The archive is the test bed's own data and nobody else's business.
    umask 077
    tar --zstd -cf "$ARCHIVE" "${excludes[@]}" -C "$BED_PARENT" "$BED_NAME" -C "$RUNTIME_HOME" $RUNTIME_PARTS || { echo "golden: the archive could not be written" >&2; exit 1; }
    sha256sum "$ARCHIVE"
    ls -l "$ARCHIVE"
    ;;

  restore)
    [ -f "$ARCHIVE" ] || { echo "golden: $ARCHIVE is not there" >&2; exit 2; }
    tar --zstd -tf "$ARCHIVE" >/dev/null || { echo "golden: $ARCHIVE cannot be read" >&2; exit 1; }
    stop_units || { start_units; exit 1; }
    trap start_units EXIT
    # What the archive holds replaces what is there now. What it left out (BED_SKIP) is left alone.
    for entry in "$BED_ROOT"/* "$BED_ROOT"/.[!.]*; do
      [ -e "$entry" ] || continue
      keep=0
      for skip in $BED_SKIP; do [ "$(basename "$entry")" = "$skip" ] && keep=1; done
      [ $keep -eq 1 ] || rm -rf -- "$entry"
    done
    for part in $RUNTIME_PARTS; do rm -rf -- "${RUNTIME_HOME:?}/$part"; done
    tar --zstd -xf "$ARCHIVE" -C "$BED_PARENT" "$BED_NAME" || { echo "golden: the test bed's folder could not be restored" >&2; exit 1; }
    tar --zstd -xf "$ARCHIVE" -C "$RUNTIME_HOME" $RUNTIME_PARTS || { echo "golden: the runtime's folders could not be restored" >&2; exit 1; }
    echo "golden: restored from $ARCHIVE"
    ;;

  *) usage ;;
esac

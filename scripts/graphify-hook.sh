#!/bin/sh
# Claude Code hooks for the graphify code map (graphify-out/, ignored by git).
#   start          SessionStart: build the map in the background if this
#                  checkout has no finished one, or refresh it if the code has
#                  moved on since (offline, code only, no LLM).
#   search|read|compact
#                  hand over to graphify's own hook-guard, which reminds the
#                  agent that `graphify query/explain/path` exist.
# Does nothing (and never fails) where graphify isn't installed, e.g. Replit
# or cloud sessions. Install: see docs/graphify.md.

G=$(command -v graphify 2>/dev/null || echo "$HOME/.local/bin/graphify")
[ -x "$G" ] || exit 0
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0

case "$1" in
  start)
    OUT=graphify-out
    HEAD=$(git rev-parse HEAD 2>/dev/null || echo none)
    # .complete holds the commit of the last build that finished every step.
    DONE=$(cat "$OUT/.complete" 2>/dev/null)
    [ "$DONE" = "$HEAD" ] && exit 0
    mkdir -p "$OUT"
    # .lock is an atomic lock (mkdir fails if it exists). One older than 10
    # minutes belongs to a build that died, so it is cleared. A failed build
    # leaves its lock behind, so a retry waits those 10 minutes.
    if [ -n "$(find "$OUT/.lock" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then
      rm -rf "$OUT/.lock"
    fi
    mkdir "$OUT/.lock" 2>/dev/null || exit 0
    if [ -n "$DONE" ] && [ -f "$OUT/graph.json" ]; then
      # Code has changed since the last build: incremental refresh (~30s).
      BUILD="GRAPHIFY_FORCE=1 \"$G\" update . && \"$G\" cluster-only . --no-label"
    else
      BUILD="\"$G\" extract . --code-only && \"$G\" cluster-only . --no-label"
    fi
    (
      if GRAPHIFY_BACKEND=none sh -c "$BUILD"; then
        echo "$HEAD" > "$OUT/.complete"
        rm -rf "$OUT/.lock"
      fi
    ) > "$OUT/build.log" 2>&1 &
    ;;
  search|read|compact)
    "$G" hook-guard "$1"
    ;;
esac
exit 0

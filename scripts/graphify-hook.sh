#!/bin/sh
# Claude Code hooks for the graphify code map (graphify-out/, ignored by git).
#   start          SessionStart: if this checkout has no map yet, build one in
#                  the background (code only, offline, no LLM, ~30s).
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
    # .building marks a build in progress; one older than 10 minutes is a
    # build that died, so a new one may start.
    if [ ! -f graphify-out/graph.json ] \
      && [ -z "$(find graphify-out/.building -mmin -10 2>/dev/null)" ]; then
      mkdir -p graphify-out
      : > graphify-out/.building
      (
        GRAPHIFY_BACKEND=none "$G" extract . --code-only \
          && GRAPHIFY_BACKEND=none "$G" cluster-only . --no-label
        rm -f graphify-out/.building
      ) > graphify-out/build.log 2>&1 &
    fi
    ;;
  search|read|compact)
    "$G" hook-guard "$1"
    ;;
esac
exit 0

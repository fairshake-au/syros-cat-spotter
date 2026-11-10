# Code map (graphify)

[graphify](https://github.com/Graphify-Labs/graphify) turns the repo into a map of files, functions, tables and the links between them, so Claude can answer "where does X live / what touches Y" without reading dozens of files.

## Install (once per Mac)

The package is `graphifyy` (double y). Other `graphify*` packages on PyPI are not the same project.

```bash
python3 -m venv ~/.local/share/graphify-venv
```

```bash
~/.local/share/graphify-venv/bin/pip install "graphifyy[sql]"
```

```bash
ln -sf ~/.local/share/graphify-venv/bin/graphify ~/.local/bin/graphify
```

```bash
graphify install --platform claude
```

The last step adds the `/graphify` skill. It also adds a short graphify section to `~/.claude/CLAUDE.md`, which you can delete; the skill works without it.

## What happens in this repo

- `.claude/settings.json` runs `scripts/graphify-hook.sh`:
  - when a session starts, it builds `graphify-out/` in the background if this checkout has none yet;
  - before searches and file reads, graphify's own guard reminds Claude that the map exists.
- Without graphify installed the script exits quietly, so Replit and cloud sessions are unaffected.

## What leaves the machine

- The map is built offline from the code (`--code-only`, `GRAPHIFY_BACKEND=none`). No code is sent anywhere.
- graphify says it collects no usage data. It keeps a log of queries on the Mac at `~/.cache/graphify-queries.log` (`GRAPHIFY_QUERY_LOG_DISABLE=1` turns it off).
- Optional: `graphify label . --backend=claude-cli --model=sonnet` names the groups by sending lists of function and table names (not file contents) through your `claude` CLI. It needs a signed-in CLI (`claude auth status`); with an expired login it falls back to file names without saying so.

## Useful commands

- `graphify query "how do vet batches reach the cats table?"`
- `graphify explain "lib/vetBatches.ts"`
- `graphify path "lib/vetBatches.ts" "catsTable"`
- `graphify update .` after code changes

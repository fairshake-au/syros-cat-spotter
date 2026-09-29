#!/usr/bin/env bash
# SYC-121, task B.4. Runs one db-ops command against Postgres 16, dispatched
# by .github/workflows/db-ops.yml. See docs/superpowers/plans/
# syc-121-neon-switchover.md, Part B.4, for the full table this implements.
#
# Hard rules (R0, R1, R4, and the plan's Global constraints):
#  - set -euo pipefail, never set -x.
#  - Never echo a variable that holds a URL. Only host names are logged
#    (via `switchover fingerprint`/`compare`'s own output, or `describeHost`).
#  - Every Replit connection this script opens is read-only at the session
#    level; only carry-back's --apply against a real Replit target writes,
#    and that needs CONFIRM=APPLY from the workflow input.
set -euo pipefail

COMMAND="${COMMAND:?COMMAND must be set}"
TARGET="${TARGET:?TARGET must be set}"

# The workflow installs postgresql-client-16 at this fixed path (Ubuntu
# doesn't put a versioned pg_dump on PATH). Overridable for a local dry run
# (D.4's step 2) against a differently-installed client.
PG_DUMP_BIN="${PG_DUMP_BIN:-/usr/lib/postgresql/16/bin/pg_dump}"
PG_RESTORE_BIN="${PG_RESTORE_BIN:-/usr/lib/postgresql/16/bin/pg_restore}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

log() { echo "[db-ops] $*"; }

# A guard, not a full secret-scanner: catches the common URL forms if a
# future change to this script accidentally lets one leak into stdout/stderr.
grep_no_urls() {
  if grep -Eq 'postgres(ql)?://' "$1"; then
    echo "db-ops: a connection string appeared in output — refusing to continue." >&2
    exit 1
  fi
}

require() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "db-ops: $name must be set for command '$COMMAND' target '$TARGET'." >&2
    exit 1
  fi
}

switchover_cli() {
  # SOURCE_DATABASE_URL / TARGET_DATABASE_URL are set by the caller before
  # invoking this.
  # --silent drops pnpm's "> @workspace/db switchover ..." banner, so a
  # fingerprint written to a file is pure JSON (mark --fingerprint-file
  # parses it). The CLI's own stdout and stderr are unchanged.
  (cd "$ROOT" && pnpm --silent --filter @workspace/db run switchover "$@")
}

migrate_cli() {
  (cd "$ROOT" && pnpm --filter @workspace/db run "$1")
}

# --- fail_after: the D.8 recovery drill only ---------------------------
FAIL_AFTER="${FAIL_AFTER:-}"
case "$FAIL_AFTER" in
  ""|restore|compare|fingerprint) ;;
  *)
    echo "db-ops: fail_after must be empty, restore, compare or fingerprint." >&2
    exit 1
    ;;
esac
if [ -n "$FAIL_AFTER" ] && [ "$TARGET" != "rehearsal" ]; then
  echo "db-ops: fail_after is refused unless target=rehearsal (it's a D.8 drill-only input)." >&2
  exit 1
fi
maybe_fail_after() {
  if [ "$FAIL_AFTER" = "$1" ]; then
    log "fail_after=$1: simulating a failure here (D.8 drill)."
    exit 1
  fi
}

# --- copy-rehearsal / copy-cutover --------------------------------------
run_copy() {
  local mode="$1" # rehearsal | cutover
  if [ "$mode" = "cutover" ] && [ "$TARGET" = "development" ]; then
    echo "db-ops: copy-cutover is refused for target=development." >&2
    exit 1
  fi
  require REPLIT_URL
  require NEON_URL

  export SOURCE_DATABASE_URL="$REPLIT_URL"
  export TARGET_DATABASE_URL="$NEON_URL"

  log "guard-target --mode $mode"
  switchover_cli guard-target --mode "$mode"

  log "fingerprint (before): source"
  switchover_cli fingerprint >"$WORKDIR/fp-before.json"
  grep_no_urls "$WORKDIR/fp-before.json"
  maybe_fail_after fingerprint

  local dump="$WORKDIR/dump.pgcustom"
  log "pg_dump (public only, no owner/privileges, read-only session)"
  PGOPTIONS='-c default_transaction_read_only=on' \
    "$PG_DUMP_BIN" \
      -Fc -n public --no-owner --no-privileges --no-publications --no-subscriptions \
      --dbname="$REPLIT_URL" \
      -f "$dump"

  # The restore leaves out "CREATE SCHEMA public": Neon's empty database
  # already has one. Build the table of contents without that line.
  local toc="$WORKDIR/toc.list"
  "$PG_RESTORE_BIN" -l "$dump" | grep -v 'SCHEMA - public ' >"$toc" || true
  log "restore table of contents (public objects only):"
  cat "$toc"

  maybe_fail_after restore
  log "pg_restore into Neon $TARGET"
  "$PG_RESTORE_BIN" \
    --no-owner --no-privileges --single-transaction --exit-on-error \
    -L "$toc" \
    --dbname="$NEON_URL" \
    "$dump"

  log "compare (source vs target)"
  if ! switchover_cli compare >"$WORKDIR/compare.log" 2>&1; then
    cat "$WORKDIR/compare.log"
    grep_no_urls "$WORKDIR/compare.log"
    exit 1
  fi
  grep_no_urls "$WORKDIR/compare.log"
  cat "$WORKDIR/compare.log"
  maybe_fail_after compare

  log "fingerprint (after): source must equal the before fingerprint"
  switchover_cli fingerprint >"$WORKDIR/fp-after.json"
  grep_no_urls "$WORKDIR/fp-after.json"
  if ! diff -q "$WORKDIR/fp-before.json" "$WORKDIR/fp-after.json" >/dev/null; then
    echo "db-ops: the source fingerprint changed during the copy — something wrote to Replit. Refusing to mark." >&2
    exit 1
  fi

  local source_fp
  source_fp="$(sha256sum "$WORKDIR/fp-after.json" | cut -d' ' -f1)"
  log "mark --mode $mode"
  # The full fingerprint goes with the marker, so a rollback's carry-back
  # can prove the old database is unchanged since this copy.
  switchover_cli mark --mode "$mode" --fingerprint "$source_fp" \
    --fingerprint-file "$WORKDIR/fp-after.json"

  # copy-rehearsal into production also restores the same dump into the
  # rehearsal branch, so D.5's stand-in for the old database starts from
  # exactly the same rows.
  if [ "$COMMAND" = "copy-rehearsal" ] && [ "$TARGET" = "production" ]; then
    require NEON_REHEARSAL_URL
    log "also restoring into the rehearsal branch (copy-rehearsal into production)"
    export TARGET_DATABASE_URL="$NEON_REHEARSAL_URL"
    switchover_cli guard-target --mode rehearsal
    "$PG_RESTORE_BIN" \
      --no-owner --no-privileges --single-transaction --exit-on-error \
      -L "$toc" \
      --dbname="$NEON_REHEARSAL_URL" \
      "$dump"
    switchover_cli mark --mode rehearsal --fingerprint "$source_fp" \
      --fingerprint-file "$WORKDIR/fp-after.json"
  fi

  # Q6: copy-cutover only, and only when a recipient is configured.
  if [ "$COMMAND" = "copy-cutover" ] && [ -n "${DUMP_AGE_RECIPIENT:-}" ]; then
    log "encrypting the dump for Samuel (age, public key only)"
    age -r "$DUMP_AGE_RECIPIENT" -o /tmp/db-ops-dump.age "$dump"
  fi

  log "$COMMAND ($TARGET): done."
}

# --- verify ---------------------------------------------------------------
run_verify() {
  require REPLIT_URL
  require NEON_URL
  export SOURCE_DATABASE_URL="$REPLIT_URL"
  export TARGET_DATABASE_URL="$NEON_URL"

  log "compare --projected (source vs target, baseline tables only)"
  if ! switchover_cli compare --projected >"$WORKDIR/compare.log" 2>&1; then
    cat "$WORKDIR/compare.log"
    grep_no_urls "$WORKDIR/compare.log"
    exit 1
  fi
  grep_no_urls "$WORKDIR/compare.log"
  cat "$WORKDIR/compare.log"

  log "migration history vs the journal"
  # Written inside lib/db (not $WORKDIR) so Node's module resolution finds
  # lib/db's own node_modules (for "pg") when this runs; removed on exit via
  # the trap below regardless of how the command ends.
  local check_script="$ROOT/lib/db/.db-ops-verify-history.mjs"
  trap 'rm -f "$check_script"' RETURN
  cat >"$check_script" <<'NODE'
import pg from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const url = process.argv[2];
const folder = path.resolve("migrations");
const journal = JSON.parse(
  fs.readFileSync(path.join(folder, "meta/_journal.json"), "utf8"),
);
const expected = journal.entries.map((e) => {
  const sql = fs.readFileSync(path.join(folder, `${e.tag}.sql`), "utf8");
  return crypto.createHash("sha256").update(sql).digest("hex");
});

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const r = await client.query(
    `select hash from drizzle.__drizzle_migrations order by created_at`,
  );
  const actual = r.rows.map((row) => row.hash);
  if (actual.length !== expected.length) {
    console.error(
      `migration history: ${actual.length} row(s) recorded, expected ${expected.length} (one per journal entry).`,
    );
    process.exit(1);
  }
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      console.error(
        `migration history: row ${i} (${journal.entries[i].tag}) hash does not match the journal.`,
      );
      process.exit(1);
    }
  }
  console.log(
    `migration history ok: ${actual.length} row(s), all matching the journal.`,
  );
} finally {
  await client.end();
}
NODE
  (cd "$ROOT/lib/db" && node "$check_script" "$NEON_URL")

  log "verify: done."
}

# --- main -------------------------------------------------------------------
case "$COMMAND" in
  fingerprint-source)
    require REPLIT_URL
    export SOURCE_DATABASE_URL="$REPLIT_URL"
    switchover_cli fingerprint | tee "$WORKDIR/fp.json"
    grep_no_urls "$WORKDIR/fp.json"
    ;;

  copy-rehearsal)
    run_copy rehearsal
    ;;

  copy-cutover)
    run_copy cutover
    ;;

  verify)
    run_verify
    ;;

  migrate)
    require NEON_URL
    DATABASE_URL="$NEON_URL" migrate_cli migrate
    ;;

  migrate-rollback)
    require NEON_URL
    DATABASE_URL="$NEON_URL" migrate_cli migrate:rollback
    ;;

  smoke)
    BASE_URL="${BASE_URL:-https://apptest.catspotters.com}"
    log "smoke against $BASE_URL"
    export PRELAUNCH_KEY="${PRELAUNCH_KEY:-}"
    (cd "$ROOT" && pnpm --filter @workspace/db run smoke "$BASE_URL")
    ;;

  carry-back-dry-run|carry-back-apply)
    require NEON_PROD_URL
    export SOURCE_DATABASE_URL="$NEON_PROD_URL"
    if [ "$TARGET" = "production" ]; then
      require REPLIT_URL
      export TARGET_DATABASE_URL="$REPLIT_URL"
    elif [ "$TARGET" = "rehearsal" ]; then
      require NEON_REHEARSAL_URL
      export TARGET_DATABASE_URL="$NEON_REHEARSAL_URL"
    else
      echo "db-ops: carry-back only runs against target=production or target=rehearsal." >&2
      exit 1
    fi
    args=()
    if [ "$COMMAND" = "carry-back-apply" ]; then
      if [ "${CONFIRM:-}" != "APPLY" ]; then
        echo "db-ops: carry-back-apply needs confirm=APPLY." >&2
        exit 1
      fi
      args+=(--apply)
    fi
    # ${args[@]+...}: an empty array under `set -u` aborts on bash < 4.4
    # (e.g. macOS's bash 3.2, for a local dry run).
    switchover_cli carry-back ${args[@]+"${args[@]}"}
    ;;

  *)
    echo "db-ops: unknown command '$COMMAND'." >&2
    exit 1
    ;;
esac

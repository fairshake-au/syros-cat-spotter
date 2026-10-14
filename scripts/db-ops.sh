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

# SYC-43: the people secrets are masked before anything else runs, so no
# later line (an error included) can print them. GitHub consumes these lines.
if [ -n "${PEOPLE_EMAIL:-}" ]; then echo "::add-mask::${PEOPLE_EMAIL}"; fi
if [ -n "${PEOPLE_NAME:-}" ]; then echo "::add-mask::${PEOPLE_NAME}"; fi
if [ -n "${PEOPLE_EMAIL_CONFIRM:-}" ]; then echo "::add-mask::${PEOPLE_EMAIL_CONFIRM}"; fi

COMMAND="${COMMAND:?COMMAND must be set}"
TARGET="${TARGET:?TARGET must be set}"

# The GitHub Environment's own DATABASE_TARGET must agree with the input,
# so a run can never act on one target with another Environment's secrets.
if [ "${DATABASE_TARGET:-}" != "$TARGET" ]; then
  echo "db-ops: DATABASE_TARGET ('${DATABASE_TARGET:-unset}') doesn't match target '$TARGET'. Refusing." >&2
  exit 1
fi

# Each branch's address comes only from its own variable. There's no
# fallback, so an empty secret can never resolve to another branch.
case "$TARGET" in
  production) NEON_URL="${NEON_PROD_URL:-}"; NEON_URL_NAME=NEON_PROD_URL ;;
  rehearsal) NEON_URL="${NEON_REHEARSAL_URL:-}"; NEON_URL_NAME=NEON_REHEARSAL_URL ;;
  development) NEON_URL="${NEON_DEV_URL:-}"; NEON_URL_NAME=NEON_DEV_URL ;;
  *)
    echo "db-ops: target must be development, rehearsal or production." >&2
    exit 1
    ;;
esac

require_neon_url() {
  if [ -z "$NEON_URL" ]; then
    echo "db-ops: $NEON_URL_NAME must be set for command '$COMMAND' target '$TARGET'." >&2
    exit 1
  fi
}

AGE_BIN="${AGE_BIN:-age}"
DUMP_AGE_OUT="${DUMP_AGE_OUT:-/tmp/db-ops-dump.age}"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1 # macOS, for a local dry run
  fi
}

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

# libpq (pg_dump, pg_restore) verifies the server certificate against
# ~/.postgresql/root.crt when sslmode=verify-full, and the runner has no such
# file, so the first rehearsal copy failed there. Node's pg client uses the
# system CA store instead. PGSSLROOTCERT=system (libpq 16+) makes libpq use the
# system store too. verify-full only: libpq rejects sslrootcert=system with
# verify-ca or anything weaker ("weak sslmode … may not be used"), and local
# test databases have no TLS. sslmode may come from the URL or PGSSLMODE.
with_libpq_ssl() {
  local url="$1"
  shift
  case "$url" in
    *sslmode=verify-full*)
      PGSSLROOTCERT="${PGSSLROOTCERT:-system}" "$@" ;;
    *sslmode=*)
      "$@" ;;
    *)
      if [ "${PGSSLMODE:-}" = "verify-full" ]; then
        PGSSLROOTCERT="${PGSSLROOTCERT:-system}" "$@"
      else
        "$@"
      fi ;;
  esac
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
  if [ "$TARGET" = "development" ]; then
    echo "db-ops: copy-$mode is refused for target=development." >&2
    exit 1
  fi
  require REPLIT_URL
  require_neon_url

  # Q6: copy-cutover encrypts its dump for Samuel. Check age can do it
  # before anything is wiped, so a missing or broken age fails the run
  # here, not after the copy.
  local encrypt=""
  if [ "$COMMAND" = "copy-cutover" ] && [ -n "${DUMP_AGE_RECIPIENT:-}" ]; then
    encrypt=yes
    if ! "$AGE_BIN" -r "$DUMP_AGE_RECIPIENT" -o /dev/null </dev/null >/dev/null 2>&1; then
      echo "db-ops: DUMP_AGE_RECIPIENT is set but age can't encrypt to it (is age installed, and the recipient valid?). Refusing before touching anything." >&2
      exit 1
    fi
  fi

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
    with_libpq_ssl "$REPLIT_URL" "$PG_DUMP_BIN" \
      -Fc -n public --no-owner --no-privileges --no-publications --no-subscriptions \
      --dbname="$REPLIT_URL" \
      -f "$dump"

  # Encrypt straight after the dump, before the restore and long before
  # mark: if it fails, Neon is left in S-failed-copy (plan F.1, E.6's row),
  # never S-cut.
  if [ -n "$encrypt" ]; then
    log "encrypting the dump for Samuel (age, public key only)"
    "$AGE_BIN" -r "$DUMP_AGE_RECIPIENT" -o "$DUMP_AGE_OUT" "$dump"
  fi

  # The restore leaves out "CREATE SCHEMA public": Neon's empty database
  # already has one. Build the table of contents without that line.
  local toc="$WORKDIR/toc.list"
  "$PG_RESTORE_BIN" -l "$dump" | grep -v 'SCHEMA - public ' >"$toc" || true
  log "restore table of contents (public objects only):"
  cat "$toc"

  maybe_fail_after restore
  log "pg_restore into Neon $TARGET"
  with_libpq_ssl "$NEON_URL" "$PG_RESTORE_BIN" \
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
  source_fp="$(sha256_of "$WORKDIR/fp-after.json")"
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
    with_libpq_ssl "$NEON_REHEARSAL_URL" "$PG_RESTORE_BIN" \
      --no-owner --no-privileges --single-transaction --exit-on-error \
      -L "$toc" \
      --dbname="$NEON_REHEARSAL_URL" \
      "$dump"
    switchover_cli mark --mode rehearsal --fingerprint "$source_fp" \
      --fingerprint-file "$WORKDIR/fp-after.json"
  fi

  log "$COMMAND ($TARGET): done."
}

# --- verify ---------------------------------------------------------------
run_verify() {
  require REPLIT_URL
  require_neon_url
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

# --- people-* (SYC-43 part 1; SYC-131; SYC-121 plan H.1(b)) ---------------
# The staff email and name arrive only as short-lived Environment secrets
# (PEOPLE_EMAIL, PEOPLE_NAME, PEOPLE_EMAIL_CONFIRM), never as workflow inputs.
# They're masked at the top of this script and never echoed. The people CLI
# checks DATABASE_TARGET against --target itself and picks NEON_*_URL by
# target, the same way this script does; it prints the person's id and role
# only.
#
# Every command that names a person needs the address twice (SYC-131):
# PEOPLE_EMAIL_CONFIRM must equal PEOPLE_EMAIL, compared the way the people
# CLI normalises addresses (trimmed, lower-case). This stands in for the CLI's
# interactive retype, which a workflow can't do; for mark-left and
# sign-out-everywhere the confirmation is also fed to that retype, so the CLI
# checks it a second time.

# Trimmed and lower-cased, as normaliseEmail() does.
normalise_email() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

run_people() {
  local sub="$1" # add | list | mark-left | sign-out-everywhere
  local out="$WORKDIR/people.log"
  local status=0
  local args=(--target "$TARGET")
  local confirm=""
  if [ "$sub" != "list" ]; then
    require PEOPLE_EMAIL
    require PEOPLE_EMAIL_CONFIRM
    if [ "$(normalise_email "$PEOPLE_EMAIL")" != "$(normalise_email "$PEOPLE_EMAIL_CONFIRM")" ]; then
      echo "db-ops: PEOPLE_EMAIL and PEOPLE_EMAIL_CONFIRM don't match. Nothing was changed." >&2
      exit 1
    fi
    confirm="$PEOPLE_EMAIL_CONFIRM"
  fi
  case "$sub" in
    add)
      require PEOPLE_NAME
      # A fixed list, validated here and again by the CLI and the database.
      case "${PEOPLE_ROLE:-}" in
        staff|guardian|volunteer|vet) ;;
        *)
          echo "db-ops: people_role must be staff, guardian, volunteer or vet." >&2
          exit 1
          ;;
      esac
      args+=(--role "$PEOPLE_ROLE" --by "db-ops:${GITHUB_ACTOR:-unknown}")
      ;;
    mark-left|sign-out-everywhere)
      args+=(--by "db-ops:${GITHUB_ACTOR:-unknown}")
      ;;
  esac
  # The CLI reads the address from PEOPLE_EMAIL itself; the confirmation goes
  # to its retype prompt on stdin (add and list don't ask).
  (cd "$ROOT" && printf '%s\n' "$confirm" \
    | pnpm --silent --filter @workspace/db run people -- "$sub" "${args[@]}") \
    >"$out" 2>&1 || status=$?
  # Check the output before showing it: no connection string, and no secret
  # (whatever GitHub's own masking does).
  grep_no_urls "$out"
  local secret
  for secret in "${PEOPLE_EMAIL:-}" "${PEOPLE_NAME:-}" "${PEOPLE_EMAIL_CONFIRM:-}"; do
    if [ -n "$secret" ] && grep -Fqi -- "$secret" "$out"; then
      echo "db-ops: a people secret appeared in output — refusing to show it." >&2
      exit 1
    fi
  done
  cat "$out"
  return "$status"
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
    require_neon_url
    DATABASE_URL="$NEON_URL" migrate_cli migrate
    ;;

  migrate-rollback)
    require_neon_url
    DATABASE_URL="$NEON_URL" migrate_cli migrate:rollback
    ;;

  smoke)
    BASE_URL="${BASE_URL:-https://apptest.catspotters.com}"
    log "smoke against $BASE_URL"
    export PRELAUNCH_KEY="${PRELAUNCH_KEY:-}"
    (cd "$ROOT" && pnpm --filter @workspace/db run smoke "$BASE_URL")
    ;;

  people-add|people-list|people-mark-left|people-sign-out-everywhere)
    if [ "$TARGET" = "rehearsal" ]; then
      echo "db-ops: $COMMAND only runs against target=development or target=production." >&2
      exit 1
    fi
    require_neon_url
    run_people "${COMMAND#people-}"
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

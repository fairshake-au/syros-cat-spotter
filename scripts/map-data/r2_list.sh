# Source this file. r2_list ARGS... runs `aws s3 ls ARGS...` and prints the listing.
# `aws s3 ls` exits 1 for an empty prefix (a normal case, prints nothing, returns 0 here);
# any other non-zero exit (network, auth) is an error and is returned to the caller.
# Do not call it inside a pipeline: use LISTING=$(r2_list ...) so a failure stops the job.
r2_list() {
  local out rc
  out=$(aws s3 ls "$@") && rc=0 || rc=$?
  case "$rc" in
    0) printf '%s\n' "$out" ;;
    1) ;;
    *) echo "aws s3 ls failed with exit code $rc" >&2; return "$rc" ;;
  esac
}

/**
 * SYC-42 review of #55: the mail-drain workflow's shell step, run for real
 * with a stand-in curl (and sleep) on PATH.
 *  - S6: on a connection error curl prints "000" itself AND exits non-zero,
 *    so `|| echo 000` made "000000", which never matched the retry case.
 *  - Nit: a manual run's base_url can only be apptest.catspotters.com or
 *    localhost, so the drain token is never sent anywhere else.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW = resolve(__dirname, "../../../../.github/workflows/mail-drain.yml");

/** The `run: |` block of the drain step, de-indented. */
function runScript(): string {
  const lines = readFileSync(WORKFLOW, "utf8").split("\n");
  const start = lines.findIndex((l) => /^\s+run: \|\s*$/.test(l));
  expect(start).toBeGreaterThan(-1);
  const indent = lines[start]!.search(/\S/) + 2;
  const body: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() && l.search(/\S/) < indent) break;
    body.push(l.slice(indent));
  }
  return body.join("\n");
}

/**
 * Runs the step. `responses` is what each curl call does in turn: "conn"
 * behaves like a real connection failure (prints 000 via -w, exits 7); a
 * number answers with that HTTP status.
 */
function drain(baseUrl: string, responses: Array<"conn" | number>) {
  const dir = mkdtempSync(join(tmpdir(), "mail-drain-"));
  const calls = join(dir, "calls");
  writeFileSync(join(dir, "responses"), responses.join("\n") + "\n");
  writeFileSync(
    join(dir, "curl"),
    `#!/usr/bin/env bash
out=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; esac
  shift
done
echo call >> "${calls}"
n=$(wc -l < "${calls}" | tr -d ' ')
r=$(sed -n "\${n}p" "${join(dir, "responses")}")
if [ "$r" = conn ]; then printf 000; exit 7; fi
[ -n "$out" ] && printf '{"ok":true}' > "$out"
printf '%s' "$r"
`,
  );
  writeFileSync(join(dir, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(join(dir, "curl"), 0o755);
  chmodSync(join(dir, "sleep"), 0o755);
  const script = join(dir, "step.sh");
  writeFileSync(script, runScript());
  let status = 0;
  let output = "";
  try {
    output = execFileSync("bash", [script], {
      env: { PATH: `${dir}:${process.env["PATH"]}`, MAIL_DRAIN_TOKEN: "test-token", BASE_URL: baseUrl },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    status = e.status;
    output = `${e.stdout}${e.stderr}`;
  }
  const curlCalls = existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").length : 0;
  return { status, output, curlCalls };
}

const PROD = "https://apptest.catspotters.com";

describe("mail-drain workflow step", () => {
  it("succeeds on a 200", () => {
    const r = drain(PROD, [200]);
    expect(r.status).toBe(0);
    expect(r.curlCalls).toBe(1);
    expect(r.output).toContain("HTTP 200");
  });

  it("S6: a connection error (a sleeping deployment) is retried once, and a 200 then passes", () => {
    const r = drain(PROD, ["conn", 200]);
    expect(r.curlCalls).toBe(2);
    expect(r.status).toBe(0);
    expect(r.output).toContain("HTTP 200");
  });

  it("S6: two connection errors fail the run, reporting HTTP 000 (not 000000)", () => {
    const r = drain(PROD, ["conn", "conn"]);
    expect(r.curlCalls).toBe(2);
    expect(r.status).not.toBe(0);
    expect(r.output).toMatch(/HTTP 000\b/);
    expect(r.output).not.toContain("000000");
  });

  it("a 503 from the platform is retried once too", () => {
    const r = drain(PROD, [503, 200]);
    expect(r.curlCalls).toBe(2);
    expect(r.status).toBe(0);
  });

  it("nit: a base_url on any other host is refused before the token is sent", () => {
    for (const url of [
      "https://evil.example.com",
      "https://apptest.catspotters.com.evil.example.com",
      "https://apptest.catspotters.com@evil.example.com",
      "http://apptest.catspotters.com",
    ]) {
      const r = drain(url, [200]);
      expect(r.status, url).not.toBe(0);
      expect(r.curlCalls, url).toBe(0);
    }
  });

  it("nit: localhost is allowed, and a trailing slash or path on the production host is fine", () => {
    expect(drain("http://localhost:8080", [200]).status).toBe(0);
    expect(drain("http://127.0.0.1:8080/", [200]).status).toBe(0);
    expect(drain(`${PROD}/`, [200]).status).toBe(0);
  });
});

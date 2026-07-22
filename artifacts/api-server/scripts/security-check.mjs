#!/usr/bin/env node
/**
 * API security checks for the nickname feature.
 *
 * Auth model: profiles are anonymous; the (unguessable, device-generated)
 * device id is the bearer credential. Therefore the invariants are:
 *  1. Public responses (leaderboard, cats, cat detail sightings) must never
 *     contain raw device ids — only opaque spotter codes.
 *  2. A caller who only knows public data (spotter code / nickname) cannot
 *     derive the device id needed to update someone else's nickname.
 *  3. Nickname moderation: length cap and sanitization enforced server-side.
 *
 * Usage: node scripts/security-check.mjs [baseUrl]  (default http://localhost:80/api)
 */
const base = process.argv[2] ?? "http://localhost:80/api";
const rnd = () => `sec-test-${Math.random().toString(36).slice(2)}-${Date.now()}`;

let failures = 0;
const assert = (cond, msg) => {
  if (cond) console.log(`  ok: ${msg}`);
  else {
    failures++;
    console.error(`  FAIL: ${msg}`);
  }
};

const deviceA = rnd();
const deviceB = rnd();

const patch = (deviceId, body) =>
  fetch(`${base}/profiles/${encodeURIComponent(deviceId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

console.log("1. Nickname update requires knowing the device credential");
let res = await patch(deviceA, { nickname: "Alpha Cat" });
assert(res.status === 200, "owner (who holds device id) can set nickname");
const profileA = await res.json();
assert(typeof profileA.spotterCode === "string" && profileA.spotterCode.length > 0, "profile exposes an opaque spotterCode");
assert(!profileA.spotterCode.includes(deviceA.slice(-4)), "spotterCode is not derived from visible device id characters");

// An attacker only knows the public spotter code — using it as the path id
// must not touch A's profile (it creates/points at a different, unrelated row).
res = await patch(profileA.spotterCode, { nickname: "Hacked" });
const afterAttack = await (await fetch(`${base}/profiles/${deviceA}`)).json();
assert(afterAttack.nickname === "Alpha Cat", "nickname unchanged when attacker only knows the public spotter code");

console.log("2. Leaderboard leaks no device ids");
await patch(deviceB, { nickname: "Beta Cat" });
const leaderboard = await (await fetch(`${base}/leaderboard`)).json();
const lbText = JSON.stringify(leaderboard);
assert(!lbText.includes(deviceA) && !lbText.includes(deviceB), "leaderboard contains no raw device ids");
assert(leaderboard.every((e) => e.deviceId === undefined), "leaderboard entries have no deviceId field");
assert(leaderboard.some((e) => e.nickname === "Alpha Cat"), "leaderboard shows nickname");

console.log("3. Cat catalog + detail leak no device ids");
const cats = await (await fetch(`${base}/cats`)).json();
assert(!JSON.stringify(cats).match(/deviceId/i), "cat list has no deviceId fields");
if (cats[0]) {
  const detail = await (await fetch(`${base}/cats/${cats[0].id}`)).json();
  assert(!JSON.stringify(detail).match(/"deviceId"/), "cat detail (incl. sightings) has no deviceId fields");
}

console.log("4. Resolve endpoint enforces sighting ownership");
{
  // Create a sighting owned by deviceA (1x1 px jpeg base64).
  const tinyJpeg =
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
  const createRes = await fetch(`${base}/sightings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: deviceA, photoBase64: tinyJpeg, lat: 37.44, lng: 24.94 }),
  });
  if (createRes.status === 201) {
    const { sightingId } = await createRes.json();
    // Attacker (deviceB) tries to resolve deviceA's sighting.
    const attack = await fetch(`${base}/sightings/${sightingId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: deviceB, newCatName: "Stolen Cat" }),
    });
    assert(attack.status === 403, "resolving someone else's sighting is rejected (403)");
    // Owner resolves successfully and response must not leak other credentials.
    const own = await fetch(`${base}/sightings/${sightingId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: deviceA, newCatName: "Sec Test Cat" }),
    });
    assert(own.status === 200, "owner can resolve their own sighting");
    const ownBody = await own.json();
    assert(ownBody.profile?.deviceId === deviceA, "resolve returns profile only to the verified owner");
  } else {
    console.log(`  skipped (createSighting returned ${createRes.status})`);
  }
}

console.log("5. Nickname moderation");
res = await patch(deviceA, { nickname: "a".repeat(25) });
assert(res.status === 400, "rejects nicknames over 24 chars");
res = await patch(deviceA, { nickname: "  Spaced \u0007 Out  " });
assert(res.status === 200 && (await res.json()).nickname === "Spaced Out", "trims, collapses whitespace, strips control chars");
res = await patch(deviceA, { nickname: null });
assert(res.status === 200 && (await res.json()).nickname === null, "null clears the nickname");

console.log(failures === 0 ? "\nAll security checks passed" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);

// Seeds a SCRATCH database for the browser check of SYC-705 Phase 2 (the
// dashboard's MapLibre maps), and prints a team session cookie for it. Never point it at a
// real database.
//
//   DATABASE_URL=postgres://…/a_browser_db TEAM_SESSION_KEYS=<32+ chars> \
//     pnpm --filter @workspace/db exec tsx <this file>
//
// Twenty cats: a tight group of twelve in Ermoupoli (a cluster when zoomed
// out), cats in Kini, Galissas and Posidonia on land, two just off the coast
// on the sea, all four sterilisation marks, one cat with a trail of three
// sightings, two feeding sites (one public, one private), and one staff
// member to sign in as.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addPerson,
  catsTable,
  db,
  feedingSitesTable,
  observationsTable,
  photosTable,
  pool,
  sightingsTable,
} from "../../../../lib/db/src/index";
import { issueSession, SESSION_COOKIE } from "../../../../artifacts/api-server/src/lib/teamAuth/session";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../../../artifacts/api-server/package.json"));
const sharp = require("sharp") as typeof import("sharp");

if (!/scratch|browser/.test(process.env["DATABASE_URL"] ?? "")) {
  throw new Error("refusing: DATABASE_URL doesn't look like a scratch database");
}

type Mark = "sterilised" | "probably" | "not_known" | "not_sterilised";
// name, lat, lng, mark, photo colour
const CATS: [string, number, number, Mark, string][] = [
  // Kini, Galissas, Posidonia: on land.
  ["Mavros", 37.4436, 24.8905, "not_sterilised", "#1d1d1b"],
  ["Portokali", 37.4228, 24.8838, "sterilised", "#d9822b"],
  ["Gata", 37.3893, 24.8881, "probably", "#8a8f94"],
  ["Tigris", 37.4106, 24.9575, "not_known", "#8b6b45"],
  // Just off the coast: on the sea.
  ["Thalassa", 37.4440, 24.9520, "sterilised", "#3b6e8f"],
  ["Kyma", 37.4180, 24.8700, "not_sterilised", "#5a7d8c"],
];
// The Ermoupoli group: twelve cats within about 60 m.
const MARKS: Mark[] = ["sterilised", "sterilised", "probably", "not_known", "not_sterilised", "sterilised"];
for (let i = 0; i < 12; i++) {
  CATS.push([`Ermou${"ABCDEFGHIJKL"[i]}`, 37.4447 + (i % 4) * 0.0001, 24.9417 + Math.floor(i / 4) * 0.0001, MARKS[i % MARKS.length]!, "#9c8a6b"]);
}

const colony = (
  await pool.query<{ id: number }>(
    "insert into colonies (name, normalised_name, lat, lng) values ('Harbour steps', 'harbour steps', 37.4445, 24.9420) returning id",
  )
).rows[0]!.id;

let at = Date.now() - 40 * 86_400_000;
const ids: number[] = [];
for (const [name, lat, lng, mark, colour] of CATS) {
  const jpeg = await sharp({ create: { width: 360, height: 360, channels: 3, background: colour } }).jpeg().toBuffer();
  const [p] = await db
    .insert(photosTable)
    .values({ data: jpeg.toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  const [c] = await db
    .insert(catsTable)
    .values({ name, primaryPhotoId: p!.id, lat, lng, discovererDeviceId: "browser-check" })
    .returning({ id: catsTable.id });
  ids.push(c!.id);
  const statements: [string, unknown, number | null][] = [["colony", { colonyId: colony }, null]];
  if (mark === "sterilised") statements.push(["sterilised", { sterilised: true }, null]);
  if (mark === "not_sterilised") statements.push(["sterilised", { sterilised: false }, null]);
  if (mark === "probably") statements.push(["ear_tip", { clipped: true }, p!.id]);
  for (const [kind, value, photoId] of statements) {
    at += 60_000;
    await db.insert(observationsTable).values({
      catId: c!.id,
      kind: kind as never,
      value: value as never,
      photoId,
      deviceId: "browser-check",
      roleAtTime: "staff",
      observedAt: new Date(at),
    });
  }
}

// Mavros was first found in Kini and has been seen twice since: Galissas, then Ermoupoli.
const mavros = ids[0]!;
const mp = (await pool.query<{ id: number }>("select primary_photo_id as id from cats where id = $1", [mavros])).rows;
for (const [lat, lng, days] of [
  [37.4228, 24.8840, 12],
  [37.4450, 24.9410, 2],
] as const) {
  await db.insert(sightingsTable).values({
    catId: mavros,
    deviceId: "browser-check",
    photoId: mp[0]!.id,
    lat,
    lng,
    status: "resolved",
    createdAt: new Date(Date.now() - days * 86_400_000),
  });
}

await db.insert(feedingSitesTable).values([
  {
    name: "Harbour steps",
    lat: 37.4443,
    lng: 24.9425,
    colonyId: colony,
    isPublic: true,
    publicLabel: "Harbour steps",
    publicId: "bcheckharbour1",
  },
  { name: "Behind the bakery", lat: 37.4432, lng: 24.8912, colonyId: colony, isPublic: false, positionApproximate: true },
]);
const siteRows = (await pool.query<{ id: number; name: string }>("select id, name from feeding_sites order by id")).rows;

async function cookieFor(email: string, name: string, language: "en" | "el") {
  const person = await addPerson({ email, name, addedBy: "cli:browser-check", roles: ["staff"] });
  if (language !== "en") await pool.query("update people set language = $2 where id = $1", [person.id, language]);
  let cookie = "";
  issueSession(
    { cookie: (_n: string, v: string) => void (cookie = v) } as never,
    { id: person.id, sessionVersion: person.sessionVersion },
    Math.floor(Date.now() / 1000),
  );
  return `${SESSION_COOKIE}=${cookie}`;
}
const cookie = await cookieFor("browser-check@example.com", "Browser check", "en");
const cookieEl = await cookieFor("browser-check-el@example.com", "Browser check Greek", "el");
const sightingId = (await pool.query<{ id: number }>("select id from sightings where cat_id = $1 order by id desc limit 1", [mavros])).rows[0]!.id;
console.log(
  JSON.stringify({
    cookie,
    cookieEl,
    mavros,
    colony,
    sightingId,
    publicSite: siteRows.find((r) => r.name === "Harbour steps")!.id,
    approxSite: siteRows.find((r) => r.name === "Behind the bakery")!.id,
  }),
);
await pool.end();

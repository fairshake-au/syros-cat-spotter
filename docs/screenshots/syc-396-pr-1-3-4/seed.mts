// Seeds a SCRATCH database for the browser check of SYC-396 PR 1.3.4, and
// prints a team session cookie for it. Never point it at a real database.
//
//   DATABASE_URL=postgres://…/a_scratch_db TEAM_SESSION_KEYS=<32+ chars> \
//     pnpm --filter @workspace/db exec tsx <this file>
//
// Eight cats in one colony, each with a real (tiny, generated) photo, a coat
// colour and a sterilisation statement, and one staff member to sign in as.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addPerson, catsTable, db, observationsTable, photosTable, pool } from "../../../lib/db/src/index";
import { issueSession, SESSION_COOKIE } from "../../../artifacts/api-server/src/lib/teamAuth/session";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../../artifacts/api-server/package.json"));
const sharp = require("sharp") as typeof import("sharp");

if (!/scratch|a3e8|browser/.test(process.env["DATABASE_URL"] ?? "")) {
  throw new Error("refusing: DATABASE_URL doesn't look like a scratch database");
}

const CATS: [string, string[], boolean, string][] = [
  ["Mavros", ["black"], false, "#1d1d1b"],
  ["Portokali", ["ginger"], true, "#d9822b"],
  ["Gata", ["grey"], true, "#8a8f94"],
  ["Tigris", ["tabby"], false, "#8b6b45"],
  ["Lefki", ["white"], true, "#f2f0ea"],
  ["Pita", ["black", "white"], true, "#4a4a48"],
  ["Kanela", ["ginger"], false, "#c96f1e"],
  ["Mikri", ["tortoiseshell"], true, "#6b4423"],
];

const colony = (
  await pool.query<{ id: number }>(
    "insert into colonies (name, normalised_name) values ('Harbour steps', 'harbour steps') returning id",
  )
).rows[0]!.id;

let at = Date.now() - 30 * 86_400_000;
for (const [name, colours, sterilised, colour] of CATS) {
  const jpeg = await sharp({ create: { width: 360, height: 360, channels: 3, background: colour } }).jpeg().toBuffer();
  const [p] = await db
    .insert(photosTable)
    .values({ data: jpeg.toString("base64"), mime: "image/jpeg" })
    .returning({ id: photosTable.id });
  const [c] = await db
    .insert(catsTable)
    .values({ name, primaryPhotoId: p!.id, lat: 37.4447, lng: 24.9417, discovererDeviceId: "browser-check" })
    .returning({ id: catsTable.id });
  for (const [kind, value] of [
    ["coat", { colours }],
    ["sterilised", { sterilised }],
    ["colony", { colonyId: colony }],
  ] as const) {
    at += 60_000;
    await db.insert(observationsTable).values({
      catId: c!.id,
      kind,
      value: value as never,
      deviceId: "browser-check",
      roleAtTime: "staff",
      observedAt: new Date(at),
    });
  }
}

const person = await addPerson({
  email: "browser-check@example.com",
  name: "Browser check",
  addedBy: "cli:browser-check",
  roles: ["staff"],
});
let cookie = "";
issueSession(
  { cookie: (_n: string, v: string) => void (cookie = v) } as never,
  { id: person.id, sessionVersion: person.sessionVersion },
  Math.floor(Date.now() / 1000),
);
console.log(`${SESSION_COOKIE}=${cookie}`);
await pool.end();

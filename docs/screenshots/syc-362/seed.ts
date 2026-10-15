// Run from inside artifacts/api-server (copied to src/__seed_tmp.ts), then delete the copy.
import fs from "node:fs";
import { eq } from "drizzle-orm";
import {
  addPerson, catsTable, db, feedingSitesTable, observationsTable, photosTable, pool, sightingsTable,
} from "@workspace/db";
import { createColony } from "./lib/teamColonies";
import { addSite } from "./lib/teamSiteWrites";
import { seedReport } from "./lib/teamAuth/__fixtures__/queueKit";
import { sessionCookieFor } from "./lib/teamAuth/__fixtures__/queueKit";

const OUT = process.env["OUT"]!;
const jpg = fs.readFileSync(process.env["PHOTO"]!);
const DEV = "device-preview-spotter";
const day = (n: number) => new Date(Date.now() - n * 86400_000);

const person = await addPerson({ email: "preview-susan@example.com", name: "Susan", addedBy: "cli:preview" });
const other = await addPerson({ email: "preview-maria@example.com", name: "Maria", addedBy: "cli:preview" });

async function photo(n: string) {
  const [p] = await db.insert(photosTable).values({ data: jpg.toString("base64"), mime: "image/jpeg" }).returning({ id: photosTable.id });
  return p!.id;
}
const cats: Record<string, number> = {};
async function cat(key: string, name: string, extra: Partial<typeof catsTable.$inferInsert> = {}, sightings = 2) {
  const pid = await photo(key);
  const [c] = await db.insert(catsTable).values({
    name, description: "", primaryPhotoId: pid, lat: 37.445 + Math.random() * 0.01, lng: 24.942 + Math.random() * 0.01,
    discovererDeviceId: DEV, ...extra,
  }).returning({ id: catsTable.id });
  cats[key] = c!.id;
  for (let i = 0; i < sightings; i++) {
    await db.insert(sightingsTable).values({
      catId: c!.id, deviceId: DEV, photoId: await photo(`${key}-s${i}`),
      lat: 37.446 + i * 0.001, lng: 24.943 + i * 0.001, status: "resolved", createdAt: day(10 - i * 3),
    });
  }
  return c!.id;
}
const obs = (catId: number, o: Partial<typeof observationsTable.$inferInsert> & { kind: string; value: unknown; createdAt: Date }) =>
  db.insert(observationsTable).values({
    catId, accountId: person.id, roleAtTime: "staff", observedAt: o.createdAt, ...o,
  } as typeof observationsTable.$inferInsert).returning({ id: observationsTable.id }).then((r) => r[0]!.id);

await cat("floka", "Φλόκα", { description: "Grey and white, loves the bakery steps" });
await cat("mimi", "Μιμή", { description: "Tabby with a notched ear", ownerDeviceId: "device-owner-mimi", ownerName: "Katerina P.", homeDescription: "Flat above the pharmacy" });
await cat("long", "Αικατερίνη-Μαρία-Ελισάβετ Παπαδοπούλου-Καραγιάννη της Ερμούπολης");
await cat("nosight", "Pepper", {}, 0);
await cat("tiger", "Tiger");
await cat("zafira", "Ζαφείρα");
await cat("longdesc", "Biscuit", { description: "Orange cat, very friendly, usually seen near the harbour fish stalls in the early morning and again at dusk near the churchyard wall where a cat guardian leaves food. ".repeat(4) });
await cat("pepper2", "Sooty");
const busy = await cat("busy", "Busy");
for (let i = 1; i <= 6; i++) await cat("own" + i, "Owned " + i, { ownerDeviceId: "device-owner-" + i, ownerName: "Owner " + i, homeDescription: "Flat " + i });

const c1 = await createColony(person.id, { name: "Vaporia — Eleni's", guardianName: "Eleni", notes: "Behind the old shipyard." });
const c2 = await createColony(person.id, { name: "Ερμούπολη, Πλατεία Μιαούλη — Ο Σύλλογος Φίλων των Αδέσποτων Ζώων της Σύρου", guardianName: "Αναστασία Παπαδοπούλου-Βλαχογιάννη", notes: null });
const c3 = await createColony(person.id, { name: "Galissas", guardianName: null, notes: null });
const col = [c1, c2, c3].map((c) => (c as { id: number }).id);

for (const k of ["own1","own2","own3","own4","own5","own6"]) await obs(cats[k]!, { kind: "colony", value: { colonyId: col[0] }, createdAt: day(20) });
const guardian = await addPerson({ email: "preview-eleni@example.com", name: "Eleni", addedBy: "cli:preview", roles: ["guardian"], colonyId: col[0]! });
fs.writeFileSync(`${OUT}/cookie-guardian.txt`, sessionCookieFor(guardian.id));
for (const [k, ci] of [["floka", 0], ["mimi", 0], ["tiger", 0], ["zafira", 1], ["long", 1], ["busy", 2]] as const) {
  await obs(cats[k]!, { kind: "colony", value: { colonyId: col[ci] }, createdAt: day(20) });
}

const mk = async (name: string, colonyId: number | null, lat: number, lng: number, notes: string | null, directions: string | null) => {
  const r = await addSite(person.id, { name, colonyId, directions, notes, lat, lng });
  if (r.kind !== "created") throw new Error(JSON.stringify(r));
  return r.id;
};
const s1 = await mk("Vaporia shipyard gate", col[0]!, 37.4412, 24.9391, "Dry food Mon/Thu", "Past the blue gate");
const s2 = await mk("Κήπος πίσω από το παλιό εργοστάσιο κοντά στην εκκλησία του Αγίου Νικολάου και το κτήριο του Δημαρχείου", col[1]!, 37.4455, 24.9420, "Water only", null);
const s3 = await mk("Galissas beach bins", null, 37.4040, 24.9250, null, null);
const s4 = await mk("Old quarry", col[2]!, 37.4300, 24.9500, "Closed down", null);
await db.update(feedingSitesTable).set({ isPublic: true, publicLabel: "Near the shipyard", publicId: "a".repeat(32), madePublicBy: person.id, madePublicAt: day(5) }).where(eq(feedingSitesTable.id, s1));
await db.update(feedingSitesTable).set({ retiredAt: day(2), retiredBy: person.id }).where(eq(feedingSitesTable.id, s4));

// Likely candidate: Mimi — a public spotter's photo-backed clipped ear.
const earPhoto = await photo("ear");
const [sg] = await db.select({ id: sightingsTable.id }).from(sightingsTable).where(eq(sightingsTable.catId, cats["mimi"]!)).limit(1);
await obs(cats["mimi"]!, { kind: "ear_tip", value: { clipped: true, side: "left" }, accountId: null, deviceId: DEV, roleAtTime: "public", photoId: earPhoto, sightingId: sg!.id, createdAt: day(4) } as never);

// Busy: 25 statements; the two the status rests on are the OLDEST (beyond the newest 20).
const oldLife = await obs(busy, { kind: "life_status", value: { status: "street", reason: "Seen daily at the harbour" }, createdAt: day(60) });
const oldSter = await obs(busy, { kind: "sterilised", value: { sterilised: true, reason: "Vet confirmed" }, createdAt: day(59) });
for (let i = 0; i < 23; i++) {
  await obs(busy, { kind: "note", value: { text: `Visit note ${i + 1}: fed, looks well.` }, accountId: i % 2 ? other.id : person.id, createdAt: day(50 - i * 2) });
}

// Welfare reports.
const photo2 = { mime: "image/jpeg", bytes: jpg };
const reports = [
  await seedReport({ severity: "urgent", note: "Injured leg, can't walk", photo: photo2, sentMinutesAgo: 8, catId: cats["floka"] }),
  await seedReport({ isLitter: true, note: "Four kittens under the boat", photo: photo2, sentMinutesAgo: 90 }),
  await seedReport({ state: "looking", stateChangedBy: person.id, note: "Thin grey cat by the bins", sentMinutesAgo: 300, teamNote: "Maria is going tonight." }),
  await seedReport({ state: "done", stateChangedBy: person.id, sentMinutesAgo: 2000, photo: photo2, note: "Eye infection, treated" }),
  await seedReport({ state: "nothing_needed", stateChangedBy: person.id, sentMinutesAgo: 3000, note: "Just a sleepy cat" }),
  await seedReport({ isDraft: true, note: null }),
  await seedReport({ tokenChecked: false, note: "Unchecked report from a script?", sentMinutesAgo: 40 }),
  await seedReport({ photo: "pending", sentMinutesAgo: 3, note: "Photo still uploading" }),
  await seedReport({ kind: "content", reason: "wrong_name", catId: cats["tiger"], note: "This is not Tiger, it's Tigger", sentMinutesAgo: 120 }),
];

const cookie = sessionCookieFor(person.id);
fs.writeFileSync(`${OUT}/cookie.txt`, cookie);
fs.writeFileSync(`${OUT}/ids.json`, JSON.stringify({ cats, colonies: col, sites: { s1, s2, s3, s4 }, person: person.id, other: other.id, busyBased: { oldLife, oldSter }, reports: reports.map((r) => r.id) }, null, 1));
await pool.end();
console.log("seeded", JSON.stringify({ cats, col, s: [s1, s2, s3, s4] }));

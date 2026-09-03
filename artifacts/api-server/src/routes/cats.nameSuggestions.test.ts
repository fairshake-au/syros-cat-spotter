import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db, pool, catsTable, photosTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const { createCompletion } = vi.hoisted(() => ({
  createCompletion: vi.fn(async () => ({
    choices: [
      {
        message: {
          content: JSON.stringify({
            names: ["TakenName", "takenname", "Fresh Name", "Another Name"],
          }),
        },
      },
    ],
  })),
}));

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: createCompletion,
      },
    },
  },
}));

vi.mock("../lib/matching", () => ({
  matchCatPhoto: vi.fn(async () => ({ isCatPhoto: true, matches: [] })),
}));

import app from "../app";

const CAT_NAME = "TakenName";
let catId: number;
let photoId: number;

beforeAll(async () => {
  const [photo] = await db
    .insert(photosTable)
    .values({ data: "dGVzdA==", mime: "image/jpeg" })
    .returning();
  photoId = photo!.id;
  const [cat] = await db
    .insert(catsTable)
    .values({
      name: CAT_NAME,
      description: "",
      primaryPhotoId: photoId,
      lat: 37.44,
      lng: 24.9,
      discovererDeviceId: "vitest-name-suggestions-device",
    })
    .returning();
  catId = cat!.id;
});

afterAll(async () => {
  await db.delete(catsTable).where(eq(catsTable.id, catId));
  await db.delete(photosTable).where(eq(photosTable.id, photoId));
  await pool.end();
});

describe("POST /api/cats/name-suggestions", () => {
  it("never returns catalog names even when the AI suggests different casing", async () => {
    const res = await request(app)
      .post("/api/cats/name-suggestions")
      .send({ language: "en" });

    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual(["Fresh Name", "Another Name"]);
    expect(
      res.body.suggestions.some(
        (name: string) => name.toLowerCase() === CAT_NAME.toLowerCase(),
      ),
    ).toBe(false);
  });

  it("never returns names excluded by the current naming session", async () => {
    const res = await request(app)
      .post("/api/cats/name-suggestions")
      .send({ language: "en", excludeNames: ["Fresh Name"] });

    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual(["Another Name"]);
  });
});

import { randomBytes } from "node:crypto";
import request from "supertest";
import type { Express, Response } from "express";
import {
  db,
  mailOutboxTable,
  welfareReportPhotosTable,
  welfareReportsTable,
} from "@workspace/db";
import { claimsFor, mint, type TestKey } from "./mint";
import { SESSION_COOKIE, issueSession } from "../session";

// Test-only helpers for the dashboard's queue tests (SYC-43 part 2, PR 1).
// API test files run one at a time against one throwaway database, so a test
// may clear the welfare tables for itself.

export const TEAM_ORIGIN = "https://team.catspotters.com";

/** Signs in through the real hand-off; returns the cookie pair to send. */
export async function signInThroughHandoff(
  app: Express,
  key: TestKey,
  personId: string,
  sv = 1,
): Promise<string> {
  const res = await request(app)
    .post("/api/team/handoff")
    .set("Origin", "https://admin.catspotters.com")
    .type("form")
    .send({ token: mint(key, claimsFor(personId, { sv })) });
  if (res.status !== 303) throw new Error(`hand-off gave ${res.status}`);
  return (res.headers["set-cookie"] as unknown as string[])[0]!.split(";")[0]!;
}

/**
 * A session cookie signed by the real issueSession, without the hand-off.
 * The hand-off only gives sessions to people who may enter (SYC-188), so
 * this stands for a session someone holds anyway: one issued before their
 * roles changed. Every route must still refuse them.
 */
export function sessionCookieFor(personId: string, sv = 1): string {
  let value: string | undefined;
  const res = {
    cookie: (_name: string, v: string) => {
      value = v;
    },
  } as unknown as Response;
  const now = Math.floor(Date.now() / 1000);
  if (!issueSession(res, { id: personId, sessionVersion: sv }, now)) {
    throw new Error("TEAM_SESSION_KEYS is not set");
  }
  return `${SESSION_COOKIE}=${value}`;
}

export async function clearWelfareTables(): Promise<void> {
  await db.delete(mailOutboxTable);
  await db.delete(welfareReportsTable); // photos and state events cascade
}

export const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

export interface SeedReport {
  publicId?: string;
  /**
   * SYC-44: "welfare" (default) is a "needs help" report; "content" is a
   * "Report an issue" row. A content row has no position, severity
   * "attention", photo state "none" (the database checks all three) and a
   * `reason` (default "other"); the welfare queue must never show it.
   */
  kind?: "welfare" | "content";
  /** Content rows only: one of the nine reason keys. Default "other". */
  reason?: string;
  /** Content rows only: the reported `photos.id`. */
  photoId?: number | null;
  /** The cat the row is tied to (`welfare_reports.cat_id`). */
  catId?: number | null;
  /** The app's own reference; default random. */
  clientRef?: string;
  severity?: "attention" | "urgent";
  state?: "new" | "looking" | "done" | "nothing_needed";
  isDraft?: boolean;
  isLitter?: boolean;
  note?: string | null;
  lat?: number;
  lng?: number;
  /** When it was sent (minutes ago). Drafts have no sent time. */
  sentMinutesAgo?: number;
  reporterDevice?: string | null;
  teamNote?: string | null;
  teamNoteBy?: string | null;
  stateChangedBy?: string | null;
  /** A photo's mime type; seeds a row in welfare_report_photos. */
  photo?: { mime: string; bytes: Buffer } | "pending" | "failed";
  /** SYC-170: null (before Turnstile), true (checked) or false (unchecked). */
  tokenChecked?: boolean | null;
  /** The alert email's state, and how long ago it was queued. */
  mail?: {
    state: "queued" | "sending" | "sent" | "failed";
    minutesAgo?: number;
  };
}

export async function seedReport(
  o: SeedReport = {},
): Promise<{ id: number; publicId: string; photoPublicId: string | null }> {
  const publicId = o.publicId ?? `vt-${randomBytes(6).toString("hex")}`;
  const kind = o.kind ?? "welfare";
  const content = kind === "content";
  const sentAt = o.isDraft ? null : minutesAgo(o.sentMinutesAgo ?? 5);
  const photoState = content
    ? "none"
    : typeof o.photo === "object"
      ? "attached"
      : o.photo === "pending"
        ? "pending"
        : o.photo === "failed"
          ? "failed"
          : "none";
  const [row] = await db
    .insert(welfareReportsTable)
    .values({
      publicId,
      kind,
      reason: content ? (o.reason ?? "other") : null,
      photoId: content ? (o.photoId ?? null) : null,
      catId: o.catId ?? null,
      severity: content ? "attention" : (o.severity ?? "attention"),
      state: o.state ?? "new",
      isDraft: o.isDraft ?? false,
      isLitter: content ? false : (o.isLitter ?? false),
      note: o.note === undefined ? "Thin grey cat by the bins" : o.note,
      lat: content ? null : (o.lat ?? 37.4441234),
      lng: content ? null : (o.lng ?? 24.9412345),
      reporterDevice:
        o.reporterDevice === undefined
          ? `device-${randomBytes(4).toString("hex")}`
          : o.reporterDevice,
      clientRef: o.clientRef ?? `ref-${randomBytes(6).toString("hex")}`,
      photoState,
      submittedAt: sentAt,
      createdAt: sentAt ?? minutesAgo(o.sentMinutesAgo ?? 5),
      teamNote: o.teamNote ?? null,
      teamNoteBy: o.teamNoteBy ?? null,
      teamNoteAt: o.teamNote ? new Date() : null,
      stateChangedBy: o.stateChangedBy ?? null,
      stateChangedAt: o.stateChangedBy ? new Date() : null,
      tokenChecked: o.tokenChecked ?? null,
    })
    .returning({ id: welfareReportsTable.id });
  let photoPublicId: string | null = null;
  if (typeof o.photo === "object") {
    photoPublicId = `ph-${randomBytes(6).toString("hex")}`;
    await db.insert(welfareReportPhotosTable).values({
      publicId: photoPublicId,
      reportId: row!.id,
      bytes: o.photo.bytes,
      mime: o.photo.mime,
    });
  }
  if (o.mail) {
    await db.insert(mailOutboxTable).values({
      purpose: content ? "issue_alert" : "welfare_alert",
      reportId: row!.id,
      recipientHash: "vitest",
      payload: { kind: "alert" },
      state: o.mail.state,
      createdAt: minutesAgo(o.mail.minutesAgo ?? 1),
    });
  }
  return { id: row!.id, publicId, photoPublicId };
}

import { describe, expect, it } from "vitest";
import type { WelfareReport } from "@workspace/db";
import { buildWelfareAlert, PHOTO_CONTENT_ID } from "./alertEmail";

// The alert's design (3 Oct 2026): severity first, the photo shown inline
// through its attachment (never a link), what the person saw, one-tap map
// buttons, the details, then what the reporter was told.

const base = {
  publicId: "9f3c2a71-4b1e-4c8a-9d2e-7a1b2c3d4e5f",
  lat: 37.44497,
  lng: 24.94271,
  reporterLanguage: "el",
  createdAt: new Date("2026-10-03T18:14:00Z"),
  submittedAt: new Date("2026-10-03T18:14:00Z"),
  photoState: "attached",
  severity: "urgent",
  isLitter: false,
  note: "Back leg looks broken",
} as unknown as WelfareReport;

const photo = { bytes: Buffer.from([0xff, 0xd8, 0xff]), mime: "image/jpeg" };

describe("welfare alert email", () => {
  it("shows the photo inline through the attachment's content id, never a link", () => {
    const out = buildWelfareAlert(base, photo, "alert", true);
    expect(out.attachments).toEqual([
      { filename: "cat-report-9f3c2a71.jpg", content: photo.bytes, contentId: PHOTO_CONTENT_ID },
    ]);
    expect(out.html).toContain(`<img src="cid:${PHOTO_CONTENT_ID}"`);
    const links = out.html.match(/https?:\/\/[^\s"<]+/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toMatch(/^https:\/\/(www\.google\.com\/maps|maps\.apple\.com)\//);
  });

  it("with no photo there's no image, and 'No photo was taken.' appears once", () => {
    const out = buildWelfareAlert({ ...base, photoState: "none" } as WelfareReport, null, "alert", true);
    expect(out.attachments).toBeUndefined();
    expect(out.html).not.toContain("cid:");
    expect(out.html.match(/No photo was taken\./g)).toHaveLength(1);
    expect(out.text).toContain("No photo was taken.");
  });

  it("a photo still uploading is said near the top", () => {
    const out = buildWelfareAlert({ ...base, photoState: "pending" } as WelfareReport, null, "alert", true);
    expect(out.html.indexOf("The photo is still uploading.")).toBeLessThan(out.html.indexOf("What they saw"));
  });

  it("leads with the severity, and urgent and needs-attention look different", () => {
    const urgent = buildWelfareAlert(base, null, "alert", true);
    const attention = buildWelfareAlert({ ...base, severity: "attention" } as WelfareReport, null, "alert", true);
    expect(urgent.text.split("\n")[0]).toBe("URGENT: Badly hurt, collapsed, or in danger right now.");
    expect(attention.text.split("\n")[0]).toBe("NEEDS ATTENTION: Thin, limping, sore eye, or just not right.");
    expect(urgent.html).toContain("#B42318");
    expect(attention.html).not.toContain("#B42318");
    expect(urgent.html.indexOf(">Urgent<")).toBeLessThan(urgent.html.indexOf("What they saw"));
  });

  it("marks kittens, names the language, and keeps the hidden preview line", () => {
    const out = buildWelfareAlert({ ...base, isLitter: true } as WelfareReport, photo, "alert", true);
    expect(out.html).toContain("Kittens, or a mother with kittens");
    expect(out.html).toContain("Greek");
    expect(out.html).toMatch(/<div style="display:none[^>]*>Urgent · kittens · Sat 3 Oct, 21:14 \(Athens time\) · photo attached<\/div>/);
  });

  it("escapes what the reporter typed and keeps their line breaks", () => {
    const out = buildWelfareAlert({ ...base, note: "<b>bleeding</b> &\nhiding" } as WelfareReport, null, "alert", true);
    expect(out.html).toContain("&lt;b&gt;bleeding&lt;/b&gt; &amp;\nhiding");
    expect(out.html).not.toContain("<b>bleeding</b>");
    expect(out.html).toContain("white-space:pre-wrap");
  });

  it("tells the team what the reporter was told, for each severity, and says no contact was left", () => {
    const urgent = buildWelfareAlert(base, null, "alert", true);
    const attention = buildWelfareAlert({ ...base, severity: "attention" } as WelfareReport, null, "alert", true);
    for (const part of [urgent.text, urgent.html]) {
      expect(part).toContain("private sanctuary, not an emergency service");
      expect(part).toContain("No contact details were left.");
    }
    for (const part of [attention.text, attention.html]) {
      expect(part).toContain("small charity, not a rescue service");
      expect(part).not.toContain("private sanctuary");
      expect(part).toContain("No contact details were left.");
    }
  });

  it("SYC-42 Slice 3: says the reporter left contact details, never the address", () => {
    const out = buildWelfareAlert({ ...base, reporterContactId: 7 } as WelfareReport, null, "alert", true);
    for (const part of [out.text, out.html]) {
      expect(part).toContain("The reporter left contact details — reply from the dashboard.");
      expect(part).not.toContain("No contact details were left.");
      expect(part).not.toMatch(/@(?!mail\.catspotters)/);
    }
  });

  it("the photo follow-up is short: the photo, the map buttons and the report id", () => {
    const out = buildWelfareAlert(base, photo, "photo", true);
    expect(out.subject).toBe("Urgent cat report: badly hurt or in danger (photo)");
    expect(out.html).toContain(`cid:${PHOTO_CONTENT_ID}`);
    expect(out.html).toContain("Open in Google Maps");
    expect(out.html).not.toContain("What they saw");
  });

  it("with withMapLinks false, both links and both buttons are left out, silently", () => {
    for (const kind of ["alert", "photo"] as const) {
      const out = buildWelfareAlert(base, photo, kind, false);
      const all = `${out.text}\n${out.html}`;
      expect(all).not.toMatch(/google\.com|maps\.apple|Google Maps|Apple Maps/i);
      expect(all).not.toMatch(/feeding/i);
      expect(all).toContain("37.44497, 24.94271");
    }
  });

  it("with withMapLinks true, both links are there", () => {
    const out = buildWelfareAlert(base, photo, "alert", true);
    expect(out.text).toContain("https://www.google.com/maps/search/?api=1&query=37.44497,24.94271");
    expect(out.text).toContain("https://maps.apple.com/?ll=37.44497,24.94271");
    expect(out.html).toContain("Open in Google Maps");
  });

  // SYC-44 (#170 review, finding 3): a "Report an issue" row has no position
  // and must never be built into a welfare alert.
  it("refuses a row with no position", () => {
    for (const row of [{ lat: null }, { lng: null }, { lat: null, lng: null }]) {
      expect(() => buildWelfareAlert({ ...base, ...row } as unknown as WelfareReport, null, "alert", true)).toThrow(
        /not a welfare report/,
      );
    }
  });
});

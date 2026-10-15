/**
 * SYC-42 Slice 3: the reporter's three emails are fixed copy (plan items
 * 3.3–3.4; tests 32 and 34).
 */
import { describe, expect, it } from "vitest";
import { publicVerify, reportAck, reportDate, reportOutcome, TEAM_SENTENCE_MAX } from "./reportTemplates";
import { PURPOSE_RULES } from "./send";

const confirmUrl = "https://apptest.catspotters.com/api/mail/confirm?t=abc";
const forgetUrl = "https://apptest.catspotters.com/api/mail/forget?t=def";
const deleteUrl = "https://apptest.catspotters.com/api/mail/forget?t=ghi";

/** Words that name a queue state, or promise a response (§5.3(h), §8.6 #9, §5.1). */
const FORBIDDEN = [
  /nothing[ _]needed/i,
  /looking at it/i,
  /\blooking\b/i,
  /not for us/i,
  /\bnew\b/i,
  /\bstate\b/i,
  /on duty/i,
  /standing by/i,
  /on call/i,
  /someone is coming/i,
  /we'll come/i,
  /alerted/i,
];

function all(r: { subject: string; text: string; html: string }) {
  return [r.subject, r.text, r.html];
}

describe("the 'is this you?' email (email-capture.md §4.1)", () => {
  it("is the fixed message, word for word, with nothing about a report or a cat", () => {
    const r = publicVerify({ confirmUrl, forgetUrl });
    expect(r.subject).toBe("Is this you? — Cat Spotters");
    expect(r.text).toContain("Someone using the Cat Spotters app on Syros asked us to send email to this address.");
    expect(r.text).toContain(
      "If it wasn't you, you don't need to do anything. We won't send anything else to this address, and we'll forget it in seven days.",
    );
    expect(r.text).toContain(confirmUrl);
    expect(r.html).toContain("Forget this address");
    for (const part of all(r)) expect(part).not.toMatch(/report|hurt|vet|kitten/i);
  });

  it("is the news identity's; the acknowledgement and outcome are mail.'s (test 32)", () => {
    expect(PURPOSE_RULES.public_verify.from).toContain("@news.catspotters.com");
    expect(PURPOSE_RULES.public_verify.recipient).toBe("unverified_public");
    for (const p of ["report_ack", "report_outcome"] as const) {
      expect(PURPOSE_RULES[p].from).toContain("@mail.catspotters.com");
      expect(PURPOSE_RULES[p].recipient).toBe("verified_public");
      expect(PURPOSE_RULES[p].replyTo).toBe("admin@syroscats.com");
    }
  });

  it("refuses a link that isn't one", () => {
    expect(() => publicVerify({ confirmUrl: "javascript:alert(1)", forgetUrl })).toThrow();
    expect(() => publicVerify({ confirmUrl: `${confirmUrl}"><script>`, forgetUrl })).toThrow();
  });
});

describe("the acknowledgement (§5.3(g))", () => {
  const params = { date: reportDate(new Date("2026-10-15T08:00:00Z")), litter: "no", photo: "yes", deleteUrl };

  it("says when it reached Syros Cats, lists the vets, and carries the delete link", () => {
    const r = reportAck(params);
    expect(r.subject).toBe("Your cat report reached Syros Cats");
    expect(r.text).toContain("reached Syros Cats on 15 October 2026");
    expect(r.text).toContain("+30 22810 77929");
    expect(r.text).toContain("Municipality of Syros-Ermoupoli (+30 22813 61000)");
    expect(r.text).toContain("€50–60 a cat");
    expect(r.text).toContain(deleteUrl);
    expect(r.html).toContain('href="tel:+302281077929"');
  });

  it("never says 'your photo' when no photo arrived (as SYC-180 on screen)", () => {
    expect(reportAck(params).text).toContain("Your report and your photo reached Syros Cats");
    const none = reportAck({ ...params, photo: "no" }).text;
    expect(none).toContain("Your report reached Syros Cats on 15 October 2026");
    expect(none).not.toContain("photo");
  });

  it("puts the cage before any handling (§10)", () => {
    const r = reportAck(params);
    expect(r.text.indexOf("borrow a carrying cage")).toBeLessThan(r.text.indexOf("a towel over it"));
  });

  it("adds the kittens paragraph only when the report was marked as kittens", () => {
    expect(reportAck(params).text).not.toContain("kittens");
    expect(reportAck({ ...params, litter: "yes" }).text).toContain("Please don't move the kittens");
  });

  it("never promises anybody is coming", () => {
    for (const part of all(reportAck({ ...params, litter: "yes" }))) {
      for (const bad of FORBIDDEN.slice(6)) expect(part).not.toMatch(bad);
    }
  });

  it("refuses a date that isn't one our code made", () => {
    expect(() => reportAck({ ...params, date: "<b>today</b>" })).toThrow();
  });
});

describe("the outcome (§5.3(h); test 34)", () => {
  it("is the same fixed copy for both closing states", () => {
    const done = reportOutcome({ outcome: "done", deleteUrl });
    const nothing = reportOutcome({ outcome: "nothing_needed", deleteUrl });
    expect(done.subject).toBe("About the cat you reported");
    expect(done.text).toBe(nothing.text);
    expect(done.text).toContain(
      "Syros Cats has looked into this and taken appropriate action in response to your report. Thank you for taking action to help the cats of Syros to thrive.",
    );
  });

  it("never contains an internal state name, with or without a team sentence", () => {
    for (const r of [
      reportOutcome({ outcome: "done", deleteUrl }),
      reportOutcome({ outcome: "nothing_needed", deleteUrl }),
      reportOutcome({ outcome: "done", deleteUrl, teamSentence: "The cat is at the vet in Manna." }),
    ]) {
      for (const part of all(r)) for (const bad of FORBIDDEN) expect(part).not.toMatch(bad);
    }
  });

  it("appends the team sentence on Done only, escaped, never replacing the fixed copy", () => {
    const done = reportOutcome({ outcome: "done", deleteUrl, teamSentence: "Took her to <b>Symviosis</b>.\r\nBcc: x@y.z" });
    expect(done.text).toContain(
      "taken appropriate action in response to your report. Took her to <b>Symviosis</b>. Bcc: x@y.z Thank you for taking action",
    );
    expect(done.html).toContain("Took her to &lt;b&gt;Symviosis&lt;/b&gt;.");
    expect(done.html).not.toContain("<b>Symviosis");
    const nothing = reportOutcome({ outcome: "nothing_needed", deleteUrl, teamSentence: "Took her in." });
    expect(nothing.text).not.toContain("Took her in.");
  });

  it("refuses a team sentence over the limit, and an unknown outcome", () => {
    expect(() => reportOutcome({ outcome: "done", deleteUrl, teamSentence: "x".repeat(TEAM_SENTENCE_MAX + 1) })).toThrow();
    expect(() => reportOutcome({ outcome: "looking", deleteUrl })).toThrow();
  });
});

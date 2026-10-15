import { getGuidance } from "@workspace/welfare-guidance";
import type { FixedTemplate } from "./send";

/**
 * The three emails a person who reported a cat can get (SYC-42 plan, Slice 3
 * items 3.3–3.4). Every word is fixed. No reporter text, no cat, no photo and
 * no place ever goes in. The parameters are links our own code builds from
 * PUBLIC_APP_ORIGIN and a fresh token, a date our own code formats, a yes/no,
 * a closing state, and (on *Done* only) the team's optional sentence, which is
 * checked and escaped here.
 *
 * - `public_verify`: email-capture.md §4.1, word for word. The ONE message an
 *   unconfirmed address can get (F7b), sent from news (§7.3).
 * - `report_ack`: team-access-and-welfare-queue.md §5.3(g).
 * - `report_outcome`: §5.3(h). Never names the internal state (§8.6 #9).
 *
 * English only, for every reporter, until the Greek and French are checked
 * by a native speaker (Samuel, 15 Oct 2026; SYC-283).
 */

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function url(params: Record<string, string>, name: string): string {
  const value = params[name];
  if (typeof value !== "string" || !/^https?:\/\/[^\s"'<>]+$/.test(value)) {
    throw new Error(`report template: missing or unsafe ${name}`);
  }
  return value;
}

function oneOf<T extends string>(params: Record<string, string>, name: string, allowed: readonly T[]): T {
  const value = params[name];
  if (!(allowed as readonly string[]).includes(value ?? "")) {
    throw new Error(`report template: missing or unknown ${name}`);
  }
  return value as T;
}

/** The longest team sentence the dashboard accepts (teamReports.ts). */
export const TEAM_SENTENCE_MAX = 280;

/** One line of plain text, or nothing. Anything else is refused, never trimmed into shape. */
export function cleanTeamSentence(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length > TEAM_SENTENCE_MAX) throw new Error("team sentence too long");
  return text;
}

/** "15 October 2026", in Athens time. */
export function reportDate(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Athens",
  }).format(at);
}

const PRIVACY_URL = "https://catspotters.com/privacy";
const SIGN_OFF = "Syros Cats · admin@syroscats.com";

function button(href: string, label: string): string {
  return (
    `<p><a href="${esc(href)}" style="display:inline-block;background:#1f6f5c;color:#fff;` +
    `padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${esc(label)}</a></p>`
  );
}

// ── The "is this you?" message (email-capture.md §4.1) ─────────────────────

/** Params: confirmUrl, forgetUrl. */
export const publicVerify: FixedTemplate = (params) => {
  const confirmUrl = url(params, "confirmUrl");
  const forgetUrl = url(params, "forgetUrl");
  const intro = "Someone using the Cat Spotters app on Syros asked us to send email to this address.";
  const notYou =
    "If it wasn't you, you don't need to do anything. We won't send anything else to this address, and we'll forget it in seven days.";
  const footer = "Cat Spotters is made for Syros Cats, a cat charity on Syros.";
  return {
    subject: "Is this you? — Cat Spotters",
    text: [
      intro,
      "",
      `Yes, that was me: ${confirmUrl}`,
      "",
      `${notYou} If you'd rather we forgot it right now: ${forgetUrl}`,
      "",
      `${footer} What we do with your email: ${PRIVACY_URL} · hello@catspotters.com`,
    ].join("\n"),
    html: [
      `<p>${esc(intro)}</p>`,
      button(confirmUrl, "Yes, that was me"),
      `<p>${esc(notYou)} If you'd rather we forgot it right now: <a href="${esc(forgetUrl)}">Forget this address</a>.</p>`,
      `<p style="color:#666;font-size:13px">${esc(footer)} <a href="${PRIVACY_URL}">What we do with your email</a> · hello@catspotters.com</p>`,
    ].join("\n"),
  };
};

// ── The vet list, from the same settings file the app shows (§5.7) ─────────

function vetLines(): { text: string; html: string } {
  const guidance = getGuidance("en");
  const kinds = guidance.copy.vetList.phoneKinds;
  const text: string[] = [];
  const html: string[] = [];
  for (const clinic of guidance.vets) {
    const phones = clinic.phones.map((p) => `${kinds[p.kind]}: ${p.display}`);
    text.push(`- ${clinic.name}, ${clinic.landmark.en}. ${phones.join(" · ")}. Map: ${clinic.googleMapsUrl}`);
    html.push(
      `<li><strong>${esc(clinic.name)}</strong>, ${esc(clinic.landmark.en)}<br>` +
        clinic.phones
          .map((p) => `${esc(kinds[p.kind])}: <a href="tel:${esc(p.tel)}">${esc(p.display)}</a>`)
          .join("<br>") +
        `<br><a href="${esc(clinic.googleMapsUrl)}">Map</a></li>`,
    );
  }
  return { text: text.join("\n"), html: `<ul>${html.join("")}</ul>` };
}

function deleteLine(deleteUrl: string): { text: string; html: string } {
  const what =
    "removes your address and takes your name off this report. The report itself stays, so the cat keeps its history.";
  return {
    text: `Delete my details (${deleteUrl}): ${what}`,
    html: `<p><a href="${esc(deleteUrl)}">Delete my details</a> — ${esc(what)}</p>`,
  };
}

// ── The acknowledgement (§5.3(g)) ──────────────────────────────────────────

/**
 * Params: date (from `reportDate`), litter ("yes" | "no"), photo ("yes" |
 * "no": whether a photo actually arrived; like SYC-180 on screen, it never
 * says "your photo" when there wasn't one), deleteUrl.
 */
export const reportAck: FixedTemplate = (params) => {
  const date = params["date"] ?? "";
  if (!/^\d{1,2} [A-Z][a-z]+ \d{4}$/.test(date)) throw new Error("report template: missing or unsafe date");
  const litter = oneOf(params, "litter", ["yes", "no"] as const) === "yes";
  const photo = oneOf(params, "photo", ["yes", "no"] as const) === "yes";
  const deleteUrl = url(params, "deleteUrl");
  const municipality = getGuidance("en").municipality;
  const vets = vetLines();
  const del = deleteLine(deleteUrl);

  const thanks = `Thank you for telling us about this cat. ${photo ? "Your report and your photo" : "Your report"} reached Syros Cats on ${date}, and it is in their list.`;
  const vetFirst =
    "If this cat is badly hurt, the fastest help is a vet, and it is worth doing without waiting for us.";
  const cageLead = "Phone the nearest clinic and ask to borrow a carrying cage";
  const cageRest =
    " — a \"trap\". Put sardines or wet food at the back of it, stand back, and let the cat walk in; then cover the cage and take it straight in. The vet will check the injuries and scan for a microchip, in case somebody is looking for this cat. Only if the cat will not go into the cage, and only if you feel safe: a towel over it, including its head, and into a box you can close.";
  const costLead = "They are likely to charge for the visit. If the cat turns out to need weeks of care rather than a single visit, the ";
  const costName = `${municipality.name.en} (${municipality.phone.display})`;
  const costRest = " is legally responsible for street animals and can sometimes help with the cost.";
  const kittens =
    "Please don't move the kittens or bring them anywhere — talk to Syros Cats first. Their mother is almost certainly nearby and is far better at this than any of us.";
  const record =
    "Every report goes into the record, and the record is what lets Syros Cats plan sterilisation where it does the most good — around €50–60 a cat, and the single most useful thing anybody can pay for on this island.";

  return {
    subject: "Your cat report reached Syros Cats",
    text: [
      "Hello,",
      "",
      thanks,
      "",
      vetFirst,
      vets.text,
      "",
      `${cageLead}${cageRest}`,
      "",
      `${costLead}${costName}${costRest}`,
      ...(litter ? ["", kittens] : []),
      "",
      record,
      "",
      del.text,
      "",
      SIGN_OFF,
    ].join("\n"),
    html: [
      "<p>Hello,</p>",
      `<p>${esc(thanks)}</p>`,
      `<p><strong>${esc(vetFirst)}</strong></p>`,
      vets.html,
      `<p><strong>${esc(cageLead)}</strong>${esc(cageRest)}</p>`,
      `<p>${esc(costLead)}<strong>${esc(costName)}</strong>${esc(costRest)}</p>`,
      ...(litter ? [`<p>${esc(kittens)}</p>`] : []),
      `<p>${esc(record)}</p>`,
      del.html,
      `<p>${esc(SIGN_OFF)}</p>`,
    ].join("\n"),
  };
};

// ── The outcome (§5.3(h)) ──────────────────────────────────────────────────

/** Params: outcome ("done" | "nothing_needed"), deleteUrl, and on done only, an optional teamSentence. */
export const reportOutcome: FixedTemplate = (params) => {
  const outcome = oneOf(params, "outcome", ["done", "nothing_needed"] as const);
  const deleteUrl = url(params, "deleteUrl");
  // The team's sentence goes on Done only, appended to the fixed copy and
  // never replacing it (§5.3(h)).
  const sentence = outcome === "done" ? cleanTeamSentence(params["teamSentence"]) : null;
  const lead = "Syros Cats has looked into this and taken appropriate action in response to your report.";
  const close = "Thank you for taking action to help the cats of Syros to thrive.";
  const del = deleteLine(deleteUrl);
  return {
    subject: "About the cat you reported",
    text: ["Hello,", "", [lead, sentence, close].filter(Boolean).join(" "), "", del.text, "", SIGN_OFF].join("\n"),
    html: [
      "<p>Hello,</p>",
      `<p>${[lead, sentence, close].filter(Boolean).map((s) => esc(s!)).join(" ")}</p>`,
      del.html,
      `<p>${esc(SIGN_OFF)}</p>`,
    ].join("\n"),
  };
};

export const REPORT_TEMPLATES: Record<string, FixedTemplate> = {
  public_verify: publicVerify,
  report_ack: reportAck,
  report_outcome: reportOutcome,
};

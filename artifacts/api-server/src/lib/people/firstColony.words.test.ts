import { describe, expect, it } from "vitest";
import type { ScreenPerson } from "@workspace/db";
import type { Language } from "../teamPages/strings";
import { el } from "../teamPages/strings/el";
import { fr } from "../teamPages/strings/fr";
import { renderAccessNotice, renderInvitation } from "../mail/personTemplates";
import { renderWelcomePage } from "../teamPages/welcomePage";
import { aboutYou } from "../teamPages/myPages";
import { buildView, describeEvent } from "./screen";

// SYC-439 (first-colony spec §2, §6): every place that describes a cat
// guardian with no colony yet says so. Never "nothing" (role.none), in
// English, Greek or French, and never a promise of positions she can't see.

const LIVE: readonly Language[] = ["en", "el", "fr"];
const NOTHING: Record<Language, string> = { en: "nothing", el: el["role.none"], fr: fr["role.none"] };
const STARTING: Record<Language, string> = {
  en: "a cat guardian, with no colony yet",
  el: el["role.guardianStarting"],
  fr: fr["role.guardianStarting"],
};
const LANGS: Language[] = ["en", "el", "fr"];
const words = (s: string) => ` ${s.toLowerCase()} `;

describe("no surface calls her nothing (SYC-439)", () => {
  for (const lang of LANGS) {
    it(`the invitation email, in ${lang}`, () => {
      const m = renderInvitation({ language: lang, roles: ["guardian"], colonies: [], starting: true }, LIVE);
      // Spec §2: what she'll do, not a role sentence (review R7).
      const body = { en: "Syros Cats has invited you to help as a cat guardian, to record a colony of cats you look after.", el: el["mail.invite.bodyStarting"], fr: fr["mail.invite.bodyStarting"] }[lang];
      expect(m.text).toContain(body);
      expect(words(m.text)).not.toContain(` ${NOTHING[lang]}.`);
    });

    it(`the managers' notice, invited and roles changed, in ${lang}`, () => {
      const invited = renderAccessNotice(
        {
          language: lang,
          actorName: "Maria",
          subjectName: "Eleni",
          change: { kind: "invited", roles: ["guardian"], colonyIds: [], starting: true },
          colonyNames: new Map(),
        },
        LIVE,
      );
      expect(invited.text).toContain(STARTING[lang]);
      const changed = renderAccessNotice(
        {
          language: lang,
          actorName: "Eleni",
          subjectName: "Eleni",
          change: { kind: "roles_changed", before: ["guardian:start"], after: ["guardian:9"] },
          colonyNames: new Map([[9, "Vaporia — Eleni's"]]),
        },
        LIVE,
      );
      expect(changed.text).toContain(STARTING[lang]);
      expect(changed.text).toContain("Vaporia — Eleni's");
      expect(words(changed.text)).not.toContain(` ${NOTHING[lang]}.`);
    });

    it(`the accept page promises no positions she can't see, in ${lang}`, () => {
      const html = renderWelcomePage(
        { name: "Eleni", language: lang, inviterName: "Maria", roles: ["guardian"], colonies: [], starting: true },
        LIVE,
      );
      // Spec §2: "…invited you as a cat guardian." (review R7)
      const plain = { en: "a cat guardian", el: el["role.guardianPlain"], fr: fr["role.guardianPlain"] }[lang];
      expect(html).toContain(`${plain}.`);
      expect(html).not.toContain(STARTING[lang]);
      const seeDo = { en: "Create a colony for the cats you look after.", el: el["welcome.seeDo.starting"], fr: fr["welcome.seeDo.starting"] }[lang];
      expect(html).toContain(seeDo.slice(0, 30));
      const guardianSeeDo = { en: "For your own colonies only", el: el["welcome.seeDo.guardianSee"], fr: fr["welcome.seeDo.guardianSee"] }[lang];
      expect(html).not.toContain(guardianSeeDo.slice(0, 20));
    });

    it(`My page, in ${lang}`, () => {
      const s = aboutYou(lang, { team: false, management: false, placements: [], starting: true }, LIVE);
      const want = { en: "You’re a cat guardian. You haven’t created a colony yet.", el: el["my.is.starting"], fr: fr["my.is.starting"] }[lang];
      expect(s).toBe(want);
    });
  }

  it("the People screen: her row, its placement list and her history (English: the team's screen)", () => {
    const p: ScreenPerson = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Eleni",
      email: "eleni@example.com",
      language: "en",
      addedAt: new Date("2026-10-01T10:00:00Z"),
      addedBy: null,
      leftAt: null,
      leftBy: null,
      acceptedAt: new Date("2026-10-02T10:00:00Z"),
      inviteSentAt: new Date("2026-10-01T10:00:00Z"),
      inviteExpiresAt: null,
      placements: [{ role: "guardian", colonyId: null, reach: "start", expiresAt: null, relationship: null, inForce: true }],
      history: [
        { kind: "invited", at: new Date("2026-10-01T10:00:00Z"), by: "cli:x", detail: { start: true, roles: ["guardian"], colonyIds: [] } },
      ],
    };
    const lk = { people: new Map<string, string>(), colonies: new Map<number, string>() };
    const v = buildView(p, new Date("2026-10-17T10:00:00Z"), lk, "someone-else");
    expect(v.roles).toBe("Cat guardian · no colony yet");
    expect(v.placements).toEqual([]);
    expect(v.starting).toBe(true);
    expect(describeEvent(p.history[0]!, lk)).toContain("invited them as a cat guardian, with no colony yet.");
    const later = describeEvent(
      { kind: "roles_changed", at: new Date(), by: p.id, detail: { before: ["guardian:start"], after: ["guardian:start"] } },
      lk,
    );
    expect(later).toContain("a cat guardian, with no colony yet");
    expect(later).not.toMatch(/\bnothing\b/);
  });
});

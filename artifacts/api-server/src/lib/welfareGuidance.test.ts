import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GUIDANCE_LANGUAGES,
  GUIDANCE_SCHEMA_VERSION,
  allCopyStrings,
  computeGuidanceVersion,
  getGuidance,
  guidanceVersion,
  urgentBlockCanonical,
  type GuidanceCopy,
  type GuidanceLanguage,
} from "@workspace/welfare-guidance";

// SYC-42 plan, Slice 0 item 0.2, tests 3–5 and 22, plus the Slice 0 review's
// fixes 4–8.

/**
 * THE URGENT-BLOCK LOCK (spec §5.4, plan Decision 6).
 *
 * The urgent block (§5.3(b)) is settled copy: Samuel line-edited the English
 * on 4 Sep 2026 and cut the out-of-hours paragraph on 27 Sep 2026. Unlike the
 * rest of §5.3 it is NOT a free copy swap. The hash covers the WHOLE `urgent`
 * object (every field, in a stable key order) except its `review` and
 * `locked` notes, so adding a field fails it as surely as changing a word.
 *
 * To change the ENGLISH: get Samuel's approval, then update its hash below
 * and add a line to the log saying who approved what, and when.
 * To change the GREEK or FRENCH: the change must come from the native-speaker
 * check (SYC-172, SYC-4) and be reflected in
 * docs/specs/source/safety-copy-translations.md first; then update the hash
 * and log it here as "native-check approved", with the checker and date.
 *
 * Approval log:
 * - 2026-10-01 en: pinned at spec §5.3(b) as approved by Samuel, 28 Sep 2026.
 * - 2026-10-01 el, fr: pinned at safety-copy-translations.md (drafts,
 *   awaiting the native check; not yet native-check approved).
 * - 2026-10-01 en: re-pinned after Samuel's edit of 1 Oct 2026, approved by
 *   Samuel: the opening "Send this…" paragraph removed; a closing capacity
 *   paragraph added, from Susan's standard reply.
 * - 2026-10-01 el, fr: re-pinned for the same edit; the new paragraph is a
 *   Fair Shake draft, not yet native-check approved (SYC-172, SYC-4).
 * - 2026-10-02 fr: re-pinned. Samuel 2 Oct 2026: register change to tu, no
 *   change of meaning. Still a draft, not yet native-check approved
 *   (SYC-154, SYC-172); safety-copy-translations.md §3 updated first.
 */
const URGENT_BLOCK_SHA256: Record<GuidanceLanguage, string> = {
  en: "d875bf006d2d474cb53692798913fa6d42759c8761cc4eff79ff88201b735c27",
  el: "6265028705b8e094c75aeca4daeadf7fa82319239805111d28b3d91a44a93028",
  fr: "0abbdb62bfc43623f293187c3ba00d1379fcb3eda92a62fcf2125e3a47a304ec",
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Lower-case and strip accents, so "Εφημερεύει" and "εφημερευει" match. */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const FORBIDDEN: Record<GuidanceLanguage, string[]> = {
  // spec §5.1 and §10: "nobody comes away believing somebody is standing by"
  en: [
    "on duty", "standing by", "on call", "someone is coming", "somebody is coming",
    "we'll come", "we will come", "will come", "alerted", "notified", "on our way",
    "on its way", "monitor", "in touch",
  ],
  el: [
    "σε βάρδια", "σε επιφυλακή", "επιφυλακ", "εφημερ", "έρχεται κάποιος",
    "θα έρθουμε", "ειδοποι",
  ],
  fr: [
    "de permanence", "de garde", "quelqu'un arrive", "quelqu'un va venir",
    "nous viendrons", "on viendra", "alerté", "prévenu", "surveill", "en route",
    // tu forms (Samuel, 2 Oct 2026: French uses tu throughout the app)
    "on te contacte", "nous te contacterons", "te recontact", "on te rappelle", "on vient te",
  ],
};

// The only sentences allowed to contain a forbidden phrase are the spec's own
// negations (§5.3(c): "Nobody is on duty."), and their translations.
const ALLOWED_NEGATIONS = [
  "Nobody is on duty.",
  "Κανείς δεν είναι σε βάρδια.",
  "Personne n'est de permanence.",
];

const AFTER_HOURS = ["697 005 5012", "6970055012", "6937 252802", "6937252802"];

/** Where the cage is offered, and where handling first appears, per language. */
const MARKERS: Record<GuidanceLanguage, { cage: string; handling: string; wontGoIn: string }> = {
  en: { cage: "will lend you a carrying cage", handling: "drop a towel, a jumper", wontGoIn: "If the cat will not go in." },
  el: { cage: "θα σου δανείσουν κλουβί μεταφοράς", handling: "ρίξε μια πετσέτα, ένα φούτερ", wontGoIn: "Αν η γάτα δεν μπαίνει με τίποτα." },
  fr: { cage: "te prêteront une cage de transport", handling: "laisse tomber une serviette", wontGoIn: "Si le chat refuse d'entrer." },
};

// ── The translations document is the source for the Greek and French block ──

const here = path.dirname(fileURLToPath(import.meta.url));
const translationsDoc = readFileSync(
  path.join(here, "../../../../docs/specs/source/safety-copy-translations.md"),
  "utf8",
);

/**
 * The capacity paragraph, word for word (the last paragraph of the urgent
 * block, from Susan's standard reply). Samuel approved the three-sentence
 * version on 1 Oct 2026 and cut it to these two sentences on 24 Oct 2026
 * (SYC-570, mockup option 1); SYC-171's liability check still has to see it.
 */
const APPROVED_CAPACITY_EN =
  "Syros Cats is a small private sanctuary, not an emergency service, and its team is at full capacity, so they can't rescue or collect a cat straight away. Your report still goes to them, and in some cases they may act on it.";

const DOC_KEYS: Record<string, (u: GuidanceCopy["urgent"]) => string> = {
  "injured.intro": (u) => u.intro,
  "injured.cage": (u) => u.cage,
  "injured.vetlist.heading": (u) => u.vetListHeading,
  "injured.disclosure": (u) => u.howToHeading,
  "injured.step1": (u) => u.steps[0]!,
  "injured.step2": (u) => u.steps[1]!,
  "injured.step3": (u) => u.steps[2]!,
  "injured.wontgoin": (u) => u.wontGoIn,
  "injured.vetdoes": (u) => u.vetDoes,
  "injured.cost": (u) => u.cost,
  "injured.decision": (u) => u.decision,
  "injured.municipality": (u) => u.municipality,
  "injured.capacity": (u) => u.capacity,
};

function docBlock(section: "## 2." | "## 3."): Record<string, string> {
  const start = translationsDoc.indexOf(`\n${section}`);
  const end = translationsDoc.indexOf("\n## ", start + 5);
  const lines = translationsDoc.slice(start, end).split("\n");
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    // A key line may carry a note after it ("— DRAFT, awaiting native review").
    const key = /^\*\*`(injured\.[a-z0-9.]+)`\*\*(?:\s+—.*)?$/.exec(lines[i]!.trim())?.[1];
    if (!key) continue;
    const quote = lines.slice(i + 1).find((l) => l.startsWith("> "))!;
    out[key] = quote
      .slice(2)
      .replace(/\s*\*\[[^\]]*\]\*\s*$/, "") // "*[list inserted here]*"
      .replace(/^\*\*▾\s*(.*)\*\*$/, "$1") // the expander label
      .replace(/^\*\*([^*]+)\*\*$/, (m, inner: string) => (key === "injured.vetlist.heading" ? inner : m))
      .trim();
  }
  return out;
}

describe("urgent-block lock (test 3, spec §5.4; review fix 4)", () => {
  for (const lang of GUIDANCE_LANGUAGES) {
    it(`${lang}: the whole urgent block matches the pinned text exactly`, () => {
      expect(sha256(urgentBlockCanonical(getGuidance(lang).copy))).toBe(URGENT_BLOCK_SHA256[lang]);
    });
  }

  it("the canonical form covers every field, so an added field changes it", () => {
    const copy = getGuidance("en").copy;
    const extra = {
      ...copy,
      urgent: { ...copy.urgent, outOfHours: "Call +30 697 005 5012" },
    } as unknown as GuidanceCopy;
    expect(urgentBlockCanonical(extra)).not.toBe(urgentBlockCanonical(copy));
    // ... and notes about the block don't.
    const noted = { ...copy, urgent: { ...copy.urgent, review: "draft", locked: "x" } } as GuidanceCopy;
    expect(urgentBlockCanonical(noted)).toBe(urgentBlockCanonical(copy));
  });
});

describe("the urgent block, in every language (review fix 5; tests 21–22)", () => {
  for (const lang of ["el", "fr"] as const) {
    it(`${lang}: matches safety-copy-translations.md line for line`, () => {
      const doc = docBlock(lang === "el" ? "## 2." : "## 3.");
      expect(Object.keys(doc).sort()).toEqual(Object.keys(DOC_KEYS).sort());
      const urgent = getGuidance(lang).copy.urgent;
      for (const [key, pick] of Object.entries(DOC_KEYS)) {
        expect(pick(urgent), `${lang} ${key}`).toBe(doc[key]);
      }
    });
  }

  for (const lang of GUIDANCE_LANGUAGES) {
    it(`${lang}: the lead is the vet route, never the discouraging half (spec §5.2)`, () => {
      const canonical = urgentBlockCanonical(getGuidance(lang).copy);
      const lead = canonical.split("\n")[0]!.replace(/\*\*/g, "");
      expect(lead).toBe(
        {
          en: "If this cat is badly hurt, please take it to a local vet if you can.",
          el: "Αν αυτή η γάτα είναι σοβαρά τραυματισμένη, πήγαινέ την σε έναν κτηνίατρο εδώ, αν μπορείς.",
          fr: "Si ce chat est gravement blessé, emmène-le chez un vétérinaire local si tu le peux.",
        }[lang],
      );
      expect(getGuidance(lang).copy.urgent).not.toHaveProperty("send");
    });

    it(`${lang}: the capacity paragraph ("not an emergency service") is the LAST thing in the block (Samuel, 1 Oct 2026)`, () => {
      const lines = urgentBlockCanonical(getGuidance(lang).copy).split("\n");
      expect(lines[lines.length - 1]).toBe(getGuidance(lang).copy.urgent.capacity);
      expect(lines.filter((l) => l === getGuidance(lang).copy.urgent.capacity)).toHaveLength(1);
    });

    it(`${lang}: the cage comes before any handling; handling is the fallback (spec §10)`, () => {
      const canonical = urgentBlockCanonical(getGuidance(lang).copy);
      const cage = canonical.indexOf(MARKERS[lang].cage);
      const handling = canonical.indexOf(MARKERS[lang].handling);
      expect(cage, "cage").toBeGreaterThan(-1);
      expect(handling, "handling").toBeGreaterThan(cage);
      expect(getGuidance(lang).copy.urgent.wontGoIn.replace(/\*\*/g, "").startsWith(MARKERS[lang].wontGoIn)).toBe(true);
    });

    it(`${lang}: no after-hours number anywhere in the copy (Part 2b)`, () => {
      const text = allCopyStrings(getGuidance(lang).copy).join("\n");
      for (const n of AFTER_HOURS) expect(text).not.toContain(n);
    });
  }
});

describe("the approved capacity paragraph (Samuel, 24 Oct 2026)", () => {
  it("English is word for word what Samuel approved", () => {
    expect(getGuidance("en").copy.urgent.capacity).toBe(APPROVED_CAPACITY_EN);
  });

  it("the block no longer says 'Send this' anywhere, in any language", () => {
    for (const lang of GUIDANCE_LANGUAGES) {
      expect(urgentBlockCanonical(getGuidance(lang).copy)).not.toMatch(/Send this|Στείλ' το|Envoyez-le\.|Envoie-le\./);
    }
  });
});

describe("vet list (test 4, spec §5.7, Decision 3)", () => {
  const { vets, municipality } = getGuidance("en");

  it("has the three clinics, with the names people ask for", () => {
    expect(vets.map((v) => v.id)).toEqual(["symviosis", "dermitzaki", "cyclades-vets"]);
    const cyclades = vets.find((v) => v.id === "cyclades-vets")!;
    expect(cyclades.name).toBe("Cyclades Vets (George Maragkos)");
    expect(cyclades.vet).toBe("George Maragkos");
  });

  it("every clinic has every §5.7 field", () => {
    for (const v of vets) {
      expect(v.name).toBeTruthy();
      expect(v.address).toBeTruthy();
      expect(v.area).toBeTruthy();
      for (const lang of GUIDANCE_LANGUAGES) expect(v.landmark[lang]).toBeTruthy();
      expect(v.phones.length).toBeGreaterThanOrEqual(2);
      expect(v.googleMapsUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
      expect(v.appleMapsUrl).toMatch(/^https:\/\/maps\.apple\.com\/\?/);
      expect(v).toHaveProperty("coordinates");
    }
  });

  it("every phone number is a valid tel: value that matches what is displayed", () => {
    const all = [...vets.flatMap((v) => v.phones), municipality.phone];
    for (const p of all) {
      expect(p.tel).toMatch(/^\+30\d{10}$/);
      expect(p.display.replace(/\s/g, "")).toBe(p.tel);
    }
  });

  it("carries all six verified numbers, after-hours labelled as such", () => {
    const tels = vets.flatMap((v) => v.phones.map((p) => `${p.tel}:${p.kind}`));
    expect(tels).toEqual([
      "+302281077929:clinic_hours",
      "+306970055012:after_hours",
      "+302281306720:landline",
      "+306986705837:mobile",
      "+302281079439:main",
      "+306937252802:emergency",
    ]);
  });

  it("landmark-anchored clinics have coordinates matching their map links", () => {
    for (const v of vets.filter((c) => c.pin === "landmark")) {
      expect(v.coordinates).not.toBeNull();
      const { lat, lng } = v.coordinates!;
      const latText = String(lat).slice(0, 7);
      const lngText = String(lng).slice(0, 7);
      expect(v.googleMapsUrl).toContain(`query=${latText}`);
      expect(v.googleMapsUrl).toContain(`,${lngText}`);
      expect(v.appleMapsUrl).toContain(`ll=${latText}`);
      expect(v.appleMapsUrl).toContain(`,${lngText}`);
      expect(Math.abs(lat - 37.43)).toBeLessThan(0.05);
      expect(Math.abs(lng - 24.93)).toBeLessThan(0.05);
    }
  });

  it("Dermitzaki has no coordinates and the interim search links, never the old Lazareta pin", () => {
    const d = vets.find((v) => v.id === "dermitzaki")!;
    expect(d.coordinates).toBeNull();
    expect(d.pin).toBe("search");
    expect(d.googleMapsUrl).toBe(
      "https://www.google.com/maps/search/?api=1&query=Dermitzaki%20vet%20Livadia%20Manna%20Syros",
    );
    expect(d.appleMapsUrl).toBe("https://maps.apple.com/?q=Dermitzaki%20Vet%20Livadia%20Manna%20Syros");
    expect(JSON.stringify(d)).not.toContain("37.43037");
    expect(JSON.stringify(d)).not.toMatch(/Lazaret/i);
  });

  it("the Municipality number in every language's copy is the configured one", () => {
    expect(municipality.phone.display).toBe("+30 22813 61000");
    for (const lang of GUIDANCE_LANGUAGES) {
      expect(getGuidance(lang).copy.urgent.municipality).toContain(municipality.phone.display);
    }
  });
});

describe("no promise anybody is coming (test 5, spec §5.1, §10; review fix 6)", () => {
  for (const lang of GUIDANCE_LANGUAGES) {
    it(`${lang}: no forbidden phrase anywhere in the copy (accents and case ignored)`, () => {
      let text = allCopyStrings(getGuidance(lang).copy).join("\n");
      for (const s of ALLOWED_NEGATIONS) text = text.split(s).join("");
      const folded = fold(text);
      for (const phrase of FORBIDDEN[lang]) {
        expect(folded, `"${phrase}" in ${lang}`).not.toContain(fold(phrase));
      }
    });
  }

  it("the litter block asks for no money (spec §5.3(d))", () => {
    for (const lang of GUIDANCE_LANGUAGES) {
      const litter = getGuidance(lang).copy.litter;
      const text = fold([litter.heading, ...litter.paragraphs].join(" "));
      expect(text).not.toMatch(/donat|δωρε|\bun don\b|€\s*\d+\s*(to|for) (help|support)/);
    }
  });

  it("the litter block names sterilisation at €50–60 in every language (canonical fact; review fix 8)", () => {
    for (const lang of GUIDANCE_LANGUAGES) {
      const litter = getGuidance(lang).copy.litter;
      expect([litter.heading, ...litter.paragraphs].join(" "), lang).toContain("50–60");
    }
  });

  it("kittens + Urgent (Samuel, 2 Oct 2026): one line says the urgent advice applies to a hurt kitten", () => {
    expect(getGuidance("en").copy.litter.withUrgent).toBe("If a kitten is hurt, the advice below applies to it.");
    for (const lang of GUIDANCE_LANGUAGES) {
      const line = getGuidance(lang).copy.litter.withUrgent;
      expect(line.trim().length, lang).toBeGreaterThan(10);
      // It never repeats the "don't move them" instruction.
      expect(getGuidance(lang).copy.litter.paragraphs.join(" "), lang).not.toContain(line);
    }
  });

  it("French uses tu throughout, every block (Samuel, 2 Oct 2026)", () => {
    const text = allCopyStrings(getGuidance("fr").copy).join("\n");
    expect(text).not.toMatch(/(^|[^\p{L}])(vous|votre|vos)([^\p{L}]|$)/iu);
    expect(text).not.toMatch(/(^|[^\p{L}])(appelez|dites|demandez|emmenez|laissez|placez|ouvrez|reculez|attendez|fermez|couvrez|partez|posez|allez|donnez|essayez|soulevez|mettez|prévenez|envoyez|sachez|déplacez|attirez)([^\p{L}]|$)/iu);
  });

  it("the confirmation screen's 'if an email was given' lines arrive with SYC-42 Slice 3 (item 3.7), §5.3(e) word for word", () => {
    for (const lang of GUIDANCE_LANGUAGES) {
      const c = getGuidance(lang).copy.confirmation as Record<string, unknown>;
      expect(Object.keys(c).sort()).toEqual(
        [
          "emailGiven",
          "emailGivenOffline",
          "hurt",
          "next",
          "offline",
          "review",
          "sentBody",
          "sentBodyNoPhoto",
          "sentHeading",
        ].sort(),
      );
    }
    const en = getGuidance("en").copy.confirmation;
    expect(en.emailGiven).toBe(
      "We've sent one message to that address to check it's right. Tap the link in it and we'll write to you when someone has looked at this report. Until you do, we won't send you anything at all.",
    );
    // email-capture.md §4.3: never "we've sent" while it's still on the phone.
    expect(en.emailGivenOffline).not.toMatch(/sent/i);
  });
});

describe("structure", () => {
  it("every language has the same keys and the same number of steps", () => {
    const shape = (c: GuidanceCopy) =>
      JSON.stringify(c, (k, v) =>
        k === "locked" ? undefined : typeof v === "string" ? "" : Array.isArray(v) ? v.map(() => "") : v,
      );
    const en = shape(getGuidance("en").copy);
    expect(shape(getGuidance("el").copy)).toBe(en);
    expect(shape(getGuidance("fr").copy)).toBe(en);
  });

  it("translations not yet checked by a native speaker are marked so", () => {
    for (const lang of ["el", "fr"] as const) {
      const c = getGuidance(lang).copy;
      for (const block of [c.urgent, c.attention, c.litter, c.confirmation, c.vetList]) {
        expect(block.review).toBe("pending-native-check");
      }
    }
  });

  it("the served payload carries schemaVersion 1 (review fix 7)", () => {
    expect(GUIDANCE_SCHEMA_VERSION).toBe(1);
    for (const lang of GUIDANCE_LANGUAGES) expect(getGuidance(lang).schemaVersion).toBe(1);
  });

  it("the version changes when any of the content changes, and is stable otherwise", () => {
    const g = getGuidance("en");
    const copies = Object.fromEntries(GUIDANCE_LANGUAGES.map((l) => [l, getGuidance(l).copy])) as Record<GuidanceLanguage, GuidanceCopy>;
    const base = computeGuidanceVersion(copies, g.vets, g.municipality);
    expect(base).toBe(guidanceVersion());
    expect(base).toMatch(/^[0-9a-f]{8}$/);
    const changedCopy = { ...copies, fr: { ...copies.fr, litter: { ...copies.fr.litter, heading: "x" } } };
    expect(computeGuidanceVersion(changedCopy, g.vets, g.municipality)).not.toBe(base);
    const changedVets = g.vets.map((v, i) => (i === 0 ? { ...v, phones: [] } : v));
    expect(computeGuidanceVersion(copies, changedVets, g.municipality)).not.toBe(base);
    expect(getGuidance("el").version).toBe(base);
  });
});

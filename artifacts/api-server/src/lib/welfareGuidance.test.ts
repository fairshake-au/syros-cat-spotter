import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GUIDANCE_LANGUAGES,
  getGuidance,
  guidanceVersion,
  urgentBlockCanonical,
  allCopyStrings,
  type GuidanceCopy,
} from "@workspace/welfare-guidance";

// SYC-42 plan, Slice 0 item 0.2, tests 3–5.

/**
 * THE URGENT-BLOCK LOCK (spec §5.4, plan Decision 6).
 *
 * The English urgent block (§5.3(b)) is settled copy: Samuel line-edited it on
 * 4 Sep 2026 and cut the out-of-hours paragraph on 27 Sep 2026. Unlike the
 * rest of §5.3 it is NOT a free copy swap. If this test fails, someone changed
 * the words people act on while holding a hurt cat.
 *
 * To change it: get Samuel's approval, then update the hash below AND add a
 * line to the log underneath saying who approved what, and when.
 *
 * Approval log:
 * - 2026-10-01: pinned at the text in spec §5.3(b) as approved by Samuel on
 *   28 Sep 2026 (SYC-42 Slice 0).
 */
const URGENT_BLOCK_SHA256_EN =
  "PIN_ME";

const FORBIDDEN: Record<string, string[]> = {
  // spec §5.1 and §10: "nobody comes away believing somebody is standing by"
  en: ["on duty", "standing by", "on call", "someone is coming", "we'll come", "alerted", "on our way"],
  el: ["σε βάρδια", "σε επιφυλακή", "έρχεται κάποιος", "θα έρθουμε", "ειδοποιήθηκ", "ειδοποιήσαμε"],
  fr: ["de permanence", "de garde", "quelqu'un arrive", "quelqu'un va venir", "nous viendrons", "on viendra", "alerté"],
};

// The only sentences allowed to contain a forbidden phrase are the spec's own
// negations (§5.3(c): "Nobody is on duty."), and their translations.
const ALLOWED_NEGATIONS = [
  "Nobody is on duty.",
  "Κανείς δεν είναι σε βάρδια.",
  "Personne n'est de permanence.",
];

function stripAllowed(text: string): string {
  return ALLOWED_NEGATIONS.reduce((t, s) => t.split(s).join(""), text);
}

describe("urgent-block lock (test 3, spec §5.4)", () => {
  it("the English §5.3(b) block matches the pinned text exactly", () => {
    const canonical = urgentBlockCanonical(getGuidance("en").copy);
    const hash = createHash("sha256").update(canonical, "utf8").digest("hex");
    expect(hash).toBe(URGENT_BLOCK_SHA256_EN);
  });

  it("leads with 'Send this…', never the discouraging half (spec §5.2)", () => {
    const urgent = getGuidance("en").copy.urgent;
    expect(urgent.send.replace(/\*\*/g, "")).toMatch(/^Send this\./);
  });

  it("the cage comes before any handling, and handling begins 'If the cat will not go in' (test 22, spec §10)", () => {
    const canonical = urgentBlockCanonical(getGuidance("en").copy);
    const cage = canonical.indexOf("will lend you a carrying cage");
    const handling = canonical.indexOf("drop a towel");
    expect(cage).toBeGreaterThan(-1);
    expect(handling).toBeGreaterThan(cage);
    expect(getGuidance("en").copy.urgent.wontGoIn.replace(/\*\*/g, "")).toMatch(
      /^If the cat will not go in\./,
    );
  });

  it("has no out-of-hours paragraph (removed by Samuel, 27 Sep 2026)", () => {
    for (const lang of GUIDANCE_LANGUAGES) {
      const canonical = urgentBlockCanonical(getGuidance(lang).copy);
      expect(canonical).not.toContain("697 005 5012");
      expect(canonical).not.toContain("6937 252802");
    }
  });
});

describe("vet list (test 4, spec §5.7, Decision 3)", () => {
  const { vets, municipality } = getGuidance("en");

  it("has the three clinics", () => {
    expect(vets.map((v) => v.id)).toEqual(["symviosis", "dermitzaki", "cyclades-vets"]);
    expect(vets.find((v) => v.id === "cyclades-vets")!.name).toBe(
      "Cyclades Vets (George Maragkos)",
    );
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
      expect(v.googleMapsUrl).toContain(`${lat.toFixed(4)}`);
      expect(v.appleMapsUrl).toContain(`ll=${lat.toFixed(4)}`);
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
    expect(d.appleMapsUrl).toBe(
      "https://maps.apple.com/?q=Dermitzaki%20Vet%20Livadia%20Manna%20Syros",
    );
    expect(JSON.stringify(d)).not.toContain("37.43037");
    expect(JSON.stringify(d)).not.toMatch(/Lazaret/i);
  });

  it("the Municipality number in every language's copy is the configured one", () => {
    expect(municipality.phone.display).toBe("+30 22813 61000");
    for (const lang of GUIDANCE_LANGUAGES) {
      expect(getGuidance(lang).copy.urgent.municipality).toContain(
        municipality.phone.display,
      );
    }
  });
});

describe("no promise anybody is coming (test 5, spec §5.1, §10)", () => {
  for (const lang of GUIDANCE_LANGUAGES) {
    it(`${lang}: no forbidden phrase anywhere in the copy`, () => {
      const text = stripAllowed(allCopyStrings(getGuidance(lang).copy).join("\n")).toLowerCase();
      for (const phrase of FORBIDDEN[lang]!) {
        expect(text, `"${phrase}" in ${lang}`).not.toContain(phrase.toLowerCase());
      }
    });
  }

  it("the litter block asks for no money (spec §5.3(d))", () => {
    for (const lang of GUIDANCE_LANGUAGES) {
      const litter = getGuidance(lang).copy.litter;
      const text = [litter.heading, ...litter.paragraphs].join(" ").toLowerCase();
      expect(text).not.toMatch(/donat|δωρε|don /);
    }
  });

  it("the confirmation screen has no 'if an email was given' line (Decision 4)", () => {
    for (const lang of GUIDANCE_LANGUAGES) {
      const c = getGuidance(lang).copy.confirmation as Record<string, unknown>;
      expect(Object.keys(c).sort()).toEqual(
        ["hurt", "next", "offline", "review", "sentBody", "sentHeading"].sort(),
      );
    }
  });
});

describe("structure", () => {
  it("every language has the same keys and the same number of steps", () => {
    const shape = (c: GuidanceCopy) =>
      JSON.stringify(c, (_k, v) =>
        typeof v === "string" ? "" : Array.isArray(v) ? v.map(() => "") : v,
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

  it("the version changes when any of the content changes, and is stable otherwise", () => {
    expect(guidanceVersion()).toMatch(/^[0-9a-f]{8}$/);
    expect(guidanceVersion()).toBe(guidanceVersion());
    expect(getGuidance("el").version).toBe(guidanceVersion());
  });
});

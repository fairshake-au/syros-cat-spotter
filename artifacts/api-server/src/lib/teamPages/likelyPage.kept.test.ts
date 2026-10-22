import { describe, expect, it } from "vitest";
import { NOT_A_CLIP_REASON, renderLikelyPage } from "./likelyPage";
import type { LikelyCat } from "../likelyReview";

// SYC-516 C3: "That's not a clip" filled in again after signing in.

const cat = (catId: number, reviewObservationId: number): LikelyCat => ({
  catId,
  name: `Cat ${catId}`,
  sterilisedAsOf: "2026-10-01T10:00:00.000Z",
  matchedByHand: false,
  reviewObservationId,
  evidence: [],
});

describe("Ear clips to check, kept typing", () => {
  it("fills in only that cat's reason, with the line at the top", () => {
    const html = renderLikelyPage([cat(1, 11), cat(2, 22)], "Susan", undefined, {
      formKey: "wrong:22",
      fields: { reason: "Torn <ear>, not a clip" },
    });
    expect(html).toContain('<p class="notice" role="status">You were signed out before this was saved.');
    expect(html).toContain('id="why-2" name="reason" value="Torn &lt;ear&gt;, not a clip"');
    expect(html).toContain(`id="why-1" name="reason" value="${NOT_A_CLIP_REASON}"`);
  });

  it("without kept typing, the done line still shows and nothing else changes", () => {
    const html = renderLikelyPage([cat(1, 11)], "Susan", "already");
    expect(html).toContain("Someone already dealt with that cat.");
    expect(html).not.toContain("We kept what you typed");
  });
});

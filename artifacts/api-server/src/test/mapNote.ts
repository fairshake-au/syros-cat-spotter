import { expect } from "vitest";

/**
 * The privacy note under a team map (design-review-fixes-oct22.md §1.5):
 * "This map is only for the team." is visible (outside any <details>), and the
 * reason sits inside a <details> labelled "Why does the map work like this?".
 */
export function expectMapNote(html: string): void {
  const outsideDetails = html.replace(/<details[\s\S]*?<\/details>/g, "");
  expect(outsideDetails).toContain('<p class="hint">This map is only for the team.</p>');
  expect(outsideDetails).not.toContain("never tells a map company");
  expect(html).toMatch(
    /<details class="hownote"><summary>Why does the map work like this\?<\/summary><p class="hint">Our server fetches the map pictures, so your browser never tells a map company where you are looking\.<\/p><\/details>/,
  );
  // The note is not repeated, and the old one-paragraph version is gone.
  expect(html.match(/This map is only for the team\./g)).toHaveLength(1);
  expect(html).not.toContain("only for the team. Our server");
}

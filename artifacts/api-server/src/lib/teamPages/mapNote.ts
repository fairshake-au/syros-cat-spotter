import { escapeHtml } from "./escape";
import { t } from "./words";

/**
 * The privacy note under every team map (design-review-fixes-oct22.md §1.5):
 * "This map is only for the team." stays visible, because it is a warning
 * people must see; the reason for how the map works goes behind a link, as it
 * is only for the few who wonder. One place for all three maps: the Feeding
 * sites map, the new-site map and the cats map.
 *
 * Fixed text from the catalogue, so it is drawn as it is (trusted HTML).
 */
export function mapPrivacyNote(lang?: string | null): string {
  const w = (key: "map.teamOnly" | "map.whyTitle" | "map.whyBody") => escapeHtml(t(key, lang));
  return (
    `<p class="hint">${w("map.teamOnly")}</p>` +
    `<details class="hownote"><summary>${w("map.whyTitle")}</summary>` +
    `<p class="hint">${w("map.whyBody")}</p></details>`
  );
}

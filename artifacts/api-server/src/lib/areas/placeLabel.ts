import { areaFor } from "./namedAreas";

// A place shown as words, never numbers (spec §3.2): the named area, plus a
// feeding site's PUBLIC label where one exists. The second argument is never a
// site's internal name, which usually contains a guardian's name;
// placeLabel.source.test.ts enforces that.
export function placeLabel(
  p: { lat: number; lng: number },
  publicSiteLabel?: string | null,
): string {
  const area = areaFor(p.lat, p.lng).name;
  const extra = publicSiteLabel?.trim();
  return extra ? `${area}, ${extra}` : area;
}

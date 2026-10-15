import { areaFor } from "./namedAreas";

// A place shown as words, never numbers (spec §3.2): the named area, plus a
// feeding site's PUBLIC label where one exists. A site's internal name usually
// holds a guardian's name, so the second argument is a branded PublicLabel
// that only publicLabelOf can make: passing a plain string (such as
// site.name) is a compile error. placeLabel.source.test.ts is the backstop.
export type PublicLabel = string & { readonly __publicLabel: unique symbol };

/** The label a viewer may see: only for a public, un-retired site with a non-blank label. */
export function publicLabelOf(site: {
  isPublic: boolean;
  publicLabel: string | null;
  retiredAt: Date | null;
}): PublicLabel | null {
  if (!site.isPublic || site.retiredAt !== null) return null;
  const label = site.publicLabel?.trim();
  return label ? (label as PublicLabel) : null;
}

export function placeLabel(p: { lat: number; lng: number }, label?: PublicLabel | null): string {
  const area = areaFor(p.lat, p.lng).name;
  return label ? `${area}, ${label}` : area;
}

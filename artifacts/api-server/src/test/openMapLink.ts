// D9 (SYC-395): the one address on a team page that may carry a position is
// the outbound "Open map" link that lib/teamPages/position.ts builds for an
// island-wide viewer. The K13 scans on pages the TEAM reads set it aside, and
// only in exactly position.ts's shape (5 decimal places, nothing else in the
// address). The guardian-view scan never does: a cat guardian's page must not
// hold one at all.
//
// `v` is the attribute value as written in the HTML, so `&` is `&amp;`.
const OPEN_MAP =
  /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=-?\d{1,3}\.\d{5}%2C-?\d{1,3}\.\d{5}$/;

export function isOpenMapLink(v: string): boolean {
  return OPEN_MAP.test(v);
}

// The addresses of the merge and undo screens (which-cat-is-which.md §4.1,
// §4.4; SYC-59 PR 4.2). Plain links, so every way in works with no script:
// "Same cat as…" on a cat page, the move screen's merge prompt, a History
// row's "Undo merge". Only cat and merge numbers travel in an address, never
// a position.

export const MERGE_SCREEN = "/api/team/cats/merge";
export const MERGE_FORM = "/api/team/cats/merge/form";
export const undoScreen = (mergeId: number) => `/api/team/cats/merge/${mergeId}/undo`;
export const undoForm = (mergeId: number) => `/api/team/cats/merge/${mergeId}/undo/form`;

export interface MergeAskLink {
  /** The cat the team opened the screen from. */
  a: number;
  /** The other cat, once chosen. */
  b?: number;
  /** The cat that stays, if switched. */
  survivor?: number;
  /** The search box's words. */
  q?: string;
}

/** The merge screen's address for this ask (no `&amp;`: the caller escapes it where it draws it). */
export function mergeHref(a: MergeAskLink): string {
  const p = new URLSearchParams();
  p.set("a", String(a.a));
  if (a.b !== undefined) p.set("b", String(a.b));
  if (a.survivor !== undefined) p.set("survivor", String(a.survivor));
  if (a.q) p.set("q", a.q);
  return `${MERGE_SCREEN}?${p.toString()}`;
}

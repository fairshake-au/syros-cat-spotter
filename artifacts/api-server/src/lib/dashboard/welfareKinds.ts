// The three kinds of welfare report on every chart and map (SYC-396 plan
// Decision 11; spec §9.3 report 4, §12.3). Built in PR 3.3b; PR 2.6's map
// layer reuses it, so a kind keeps its colour, word and pattern everywhere.
//
// Every report is in exactly one kind, so the kinds never overlap:
// - Litter: any report with kittens, whatever its urgency, so kitten counts
//   are never split;
// - Urgent: urgent, without kittens;
// - Needs attention: everything else.
//
// Never colour alone (§12.3): each kind has its word, and a fill pattern
// (solid, hatched, dotted), so a chart still reads when printed in black and
// white. Urgent's red and Litter's purple are close in grey; the patterns
// tell them apart.
//
// "Needs attention" is #a08000, not the plan's first #8a6d1d, which failed
// the colour-blind check beside Urgent's red (3.3a's session, 21 Oct 2026).
// The dataviz palette validator passed all three, every pair, on the page's
// #f6f4ef and the card's white (21 Oct 2026, PR 3.3b): worst colour-blind
// separation 10.8 (attention and urgent, deutan; 8 is the bar), normal
// vision 19.9, contrast 3:1 or more. Re-run it if a colour changes.

export type WelfareKind = "litter" | "urgent" | "attention";

/** The fixed order: bottom of a bar first, and the legend's order. */
export const WELFARE_ORDER: readonly WelfareKind[] = ["urgent", "attention", "litter"];

export const WELFARE_COLOUR: Record<WelfareKind, string> = {
  urgent: "#b42318",
  attention: "#a08000",
  litter: "#5b4b8a",
};

export const WELFARE_WORD: Record<WelfareKind, string> = {
  urgent: "Urgent",
  attention: "Needs attention",
  litter: "Litter",
};

/** The non-colour cue each kind is drawn with. */
export const WELFARE_PATTERN: Record<WelfareKind, "solid" | "hatch" | "dots"> = {
  urgent: "solid",
  attention: "hatch",
  litter: "dots",
};

export const kindOf = (r: { severity: "urgent" | "attention"; isLitter: boolean }): WelfareKind =>
  r.isLitter ? "litter" : r.severity === "urgent" ? "urgent" : "attention";

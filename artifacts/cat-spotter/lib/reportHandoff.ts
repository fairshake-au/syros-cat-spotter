/**
 * Hands a photo and a place to the report flow (SYC-42 plan item 1.8: "in
 * the spot flow after a photo is taken, which reuses that photo"). A photo is
 * far too big for a route parameter, so the screen that opens the flow leaves
 * it here, and the flow takes it once. In memory only: nothing is kept.
 */
export interface ReportHandoff {
  photo?: { uri: string; base64: string };
  coords?: { latitude: number; longitude: number };
}

let pending: ReportHandoff | null = null;

export function setReportHandoff(handoff: ReportHandoff): void {
  pending = handoff;
}

/** Returns what was left, and forgets it. */
export function takeReportHandoff(): ReportHandoff | null {
  const h = pending;
  pending = null;
  return h;
}

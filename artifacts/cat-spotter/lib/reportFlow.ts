/**
 * The screens of "This cat needs help" (SYC-42 Slice 1; Samuel, 2 Oct 2026:
 * no scrolling, so one page became three):
 *
 *   1. Where's the cat?  photo (optional) + the map pin   → Next
 *   2. How bad is it?    severity, kittens?, what you saw → Next
 *   3. Before you send   the advice for that severity     → Send report
 *
 * SYC-42 Slice 3 (Samuel, 15 Oct 2026): when the email question is offered,
 * it gets its own screen before "Before you send", so no screen scrolls:
 * Where → How bad → Shall we tell you what happens? → Before you send
 * ("1 of 4"). When it isn't offered, the flow is the three screens above.
 *
 * Next is blocked until there is a location (screen 1) and a severity
 * (screen 2): the server needs both, and the advice on screen 3 depends on
 * the severity. A photo is never required: nothing blocks a report.
 * Back never loses anything entered.
 *
 * Framework-free so the rules are unit-testable.
 */
import type { ReportSeverity } from './reportQueue';

export type ReportStep = 1 | 2 | 3 | 4;

export type ReportScreen = 'where' | 'howBad' | 'email' | 'beforeSend';

/** The screens in order: with the email question (Slice 3) or without. */
export function reportScreens(withEmail: boolean): ReportScreen[] {
  return withEmail ? ['where', 'howBad', 'email', 'beforeSend'] : ['where', 'howBad', 'beforeSend'];
}

/** Which screen a step is. A step past the end is the last screen. */
export function screenAt(step: ReportStep, withEmail = false): ReportScreen {
  const screens = reportScreens(withEmail);
  return screens[Math.min(step, screens.length) - 1]!;
}

export interface ReportFlow {
  step: ReportStep;
  photo: { uri: string; base64: string } | null;
  coords: { latitude: number; longitude: number } | null;
  severity: ReportSeverity | null;
  isLitter: boolean;
  note: string;
  /**
   * The pin is still on the Ermoupoli fallback (no GPS fix). Next waits until
   * the person moves it, like Spot, which never uses a location nobody chose
   * (review of #55, S4).
   */
  pinIsDefault?: boolean;
  /**
   * SYC-42 Slice 3, "Shall we tell you what happens?" (email-capture.md
   * §3.4): off unless they choose "Yes, keep me updated".
   */
  wantsUpdates?: boolean;
  email?: string;
}

export const INITIAL_FLOW: ReportFlow = {
  step: 1,
  photo: null,
  coords: null,
  severity: null,
  isLitter: false,
  note: '',
  pinIsDefault: false,
  wantsUpdates: false,
  email: '',
};

const SINGLE_ADDRESS = /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/;

/** Shaped like one email address (the server checks again). */
export function looksLikeEmail(value: string): boolean {
  const v = value.trim();
  return v.length <= 254 && SINGLE_ADDRESS.test(v);
}

/**
 * The address to send with the report: only when they chose "Yes, keep me
 * updated" and typed something shaped like an address. Anything else goes
 * anonymously; a typo never blocks the report (the screen says so).
 */
export function reporterEmail(flow: ReportFlow): string | null {
  if (!flow.wantsUpdates) return null;
  const v = (flow.email ?? '').trim();
  return looksLikeEmail(v) ? v : null;
}

export function canAdvance(flow: ReportFlow, withEmail = false): boolean {
  const screen = screenAt(flow.step, withEmail);
  if (screen === 'where') return flow.coords !== null && !flow.pinIsDefault;
  if (screen === 'howBad') return flow.severity !== null;
  // The email question never holds anyone up: "No" is the default.
  if (screen === 'email') return true;
  return false;
}

export function flowNext(flow: ReportFlow, withEmail = false): ReportFlow {
  if (!canAdvance(flow, withEmail)) return flow;
  return { ...flow, step: (flow.step + 1) as ReportStep };
}

export function flowBack(flow: ReportFlow): ReportFlow {
  if (flow.step === 1) return flow;
  return { ...flow, step: (flow.step - 1) as ReportStep };
}

/** Spec §4.2: the draft is written once severity and location are both set. */
export function draftReady(flow: ReportFlow): boolean {
  return flow.coords !== null && !flow.pinIsDefault && flow.severity !== null;
}

/**
 * Where the flow opens. From the Spot screen, which already has the photo and
 * the confirmed place, it opens on screen 2 (back still reaches screen 1 to
 * change either). Anywhere else it opens on screen 1.
 */
export function startFlow(
  handoff: { photo?: ReportFlow['photo']; coords?: ReportFlow['coords'] } | null,
): ReportFlow {
  const photo = handoff?.photo ?? null;
  const coords = handoff?.coords ?? null;
  return { ...INITIAL_FLOW, photo, coords, step: photo && coords ? 2 : 1 };
}

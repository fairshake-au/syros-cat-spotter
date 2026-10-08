import type { FixedTemplate } from "./send";

/**
 * The two "keep my spots safe" emails (SYC-3 plan, appendix; email-capture.md
 * §5.1, §8.3). Every word is fixed. The only parameters are links our own
 * code builds from PUBLIC_APP_ORIGIN and a fresh token (lib/keepSafe/links.ts):
 * nothing a sender chose, no username, no cat (plan test 14).
 *
 * English only for now: the Greek and French come from native speakers (SYC-4).
 */

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function param(params: Record<string, string>, name: string): string {
  const value = params[name];
  if (typeof value !== "string" || !/^https?:\/\/[^\s"'<>]+$/.test(value)) {
    throw new Error(`keep-safe template: missing or unsafe ${name}`);
  }
  return value;
}

const PRIVACY_URL = "https://catspotters.com/privacy";
const FOOTER_TEXT = `Cat Spotters is made for Syros Cats, a cat charity on Syros. What we do with your email: ${PRIVACY_URL} · hello@catspotters.com`;
const FOOTER_HTML =
  `<p style="color:#666;font-size:13px">Cat Spotters is made for Syros Cats, a cat charity on Syros. ` +
  `<a href="${PRIVACY_URL}">What we do with your email</a> · hello@catspotters.com</p>`;

function button(href: string, label: string): string {
  return (
    `<p><a href="${esc(href)}" style="display:inline-block;background:#1f6f5c;color:#fff;` +
    `padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${esc(label)}</a></p>`
  );
}

/** "Keep my spots safe: is this you?" Params: confirmUrl, forgetUrl. */
export const keepSafeVerify: FixedTemplate = (params) => {
  const confirmUrl = param(params, "confirmUrl");
  const forgetUrl = param(params, "forgetUrl");
  const intro =
    "Someone using the Cat Spotters app asked to use this address to keep their spots safe. " +
    "If they lose their phone, this inbox is how they get their spots back.";
  const notYou =
    "If it wasn't you, you don't need to do anything. We won't use this address, and we'll forget it in seven days.";
  return {
    subject: "Is this you? — Cat Spotters",
    text: [
      intro,
      "",
      `Yes, that was me: ${confirmUrl}`,
      "",
      `${notYou} To forget it now: ${forgetUrl}`,
      "",
      FOOTER_TEXT,
    ].join("\n"),
    html: [
      `<p>${esc(intro)}</p>`,
      button(confirmUrl, "Yes, that was me"),
      `<p>${esc(notYou)} To forget it now: <a href="${esc(forgetUrl)}">Forget this address</a>.</p>`,
      FOOTER_HTML,
    ].join("\n"),
  };
};

/** "Your restore link". Params: restoreUrl. */
export const restoreLink: FixedTemplate = (params) => {
  const restoreUrl = param(params, "restoreUrl");
  const intro = "Someone asked to move a Cat Spotters collection kept safe by this address to a new phone.";
  const open = "Open this on the phone that's getting the spots back";
  const rest = ", then press the button. The link works once and lasts 15 minutes.";
  const ignore =
    "If you didn't ask, ignore this. Nothing moves unless the button is pressed on the phone that asked. Please don't forward this email.";
  return {
    subject: "Get your spots back — Cat Spotters",
    text: [intro, "", `${open}${rest}`, "", `Get my spots back: ${restoreUrl}`, "", ignore].join("\n"),
    html: [
      `<p>${esc(intro)}</p>`,
      `<p><strong>${esc(open)}</strong>${esc(rest)}</p>`,
      button(restoreUrl, "Get my spots back"),
      `<p>${esc(ignore)}</p>`,
    ].join("\n"),
  };
};

export const KEEP_SAFE_TEMPLATES: Record<string, FixedTemplate> = {
  keep_safe_verify: keepSafeVerify,
  restore_link: restoreLink,
};

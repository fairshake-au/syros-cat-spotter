import { escapeHtml } from "./escape";

// The one page shell for the staff dashboard (SYC-43 part 2 plan, PR 1).
// Plain server-drawn HTML: no scripts, mobile first, styles in one <style>
// element (the CSP allows inline styles and nothing else). Every value that
// is not fixed text here goes through escapeHtml.

export type NavKey = "queue" | "cats" | "likely";

interface NavItem {
  key: NavKey;
  label: string;
  /** Null until that screen exists: shown as plain text, not a dead link. */
  href: string | null;
}

// Cats (PR 3) and Probably sterilised (PR 4) switch on by getting an href.
const NAV: NavItem[] = [
  { key: "queue", label: "Welfare queue", href: "/api/team" },
  { key: "cats", label: "Cats", href: null },
  { key: "likely", label: "Probably sterilised", href: null },
];

const STYLES = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#f6f4ef;color:#1d1d1b;font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:#0b5c6b}
.bar{background:#fff;border-bottom:1px solid #d9d5ca;padding:4px 12px;display:flex;flex-wrap:wrap;gap:0 14px;align-items:center}
.bar a,.bar span,.bar button{font:inherit;font-size:15px;padding:8px 2px;min-height:44px;display:inline-flex;align-items:center}
.bar .here{font-weight:700;color:#1d1d1b;border-bottom:3px solid #0b5c6b;text-decoration:none}
.bar .off{color:#6b685f}
.bar form{margin:0 0 0 auto}
.bar button{background:none;border:0;color:#0b5c6b;text-decoration:underline;cursor:pointer}
main{max-width:760px;margin:0 auto;padding:12px 12px 48px}
h1{font-size:22px;margin:12px 0 4px}
h2{font-size:18px;margin:28px 0 8px}
.who{margin:0 0 12px;color:#55524a;font-size:14px}
.banner{background:#fff3cd;border:1px solid #c9a227;border-radius:8px;padding:10px 12px;margin:12px 0}
.empty{color:#55524a;margin:8px 0}
.report{background:#fff;border:1px solid #d9d5ca;border-left:6px solid #c98a00;border-radius:8px;padding:12px;margin:10px 0;overflow-wrap:anywhere}
.report.urgent{border-left-color:#b3261e}
.report.closed{border-left-color:#8a877e;background:#faf9f6}
.report.draft{border-left-style:dashed}
.head{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;margin:0 0 8px}
.tag{display:inline-block;font-size:13px;font-weight:700;border-radius:999px;padding:2px 10px;background:#eee9da;color:#3b3930}
.tag.urgent{background:#b3261e;color:#fff}
.tag.kittens{background:#d9ecf0;color:#0b4553}
.tag.state{background:#fff;border:1px solid #8a877e}
.ago{color:#55524a;font-size:14px}
.photo{display:block;width:100%;max-width:100%;height:auto;max-height:420px;object-fit:contain;background:#ece8dc;border-radius:6px;margin:0 0 8px}
.nophoto{background:#ece8dc;border-radius:6px;padding:14px 10px;margin:0 0 8px;color:#55524a;font-size:14px}
dl{margin:8px 0 0;display:grid;grid-template-columns:1fr;gap:2px}
dt{font-size:13px;color:#55524a;margin-top:6px}
dd{margin:0}
.note{white-space:pre-wrap}
.bad{color:#8c1d18;font-weight:700}
@media (min-width:700px){
main{padding-top:20px}
.report.has-photo{display:grid;grid-template-columns:240px 1fr;gap:0 16px;align-items:start}
.report.has-photo .photo,.report.has-photo .nophoto{grid-column:1;grid-row:1 / span 2}
.report.has-photo>.head,.report.has-photo>dl{grid-column:2}
dl{grid-template-columns:150px 1fr;gap:4px 12px}
dt{margin-top:0}
}
`;

export interface PageOptions {
  title: string;
  active: NavKey;
  /** The signed-in person's name (escaped here). */
  personName: string;
  /** Trusted HTML: built only from fixed text and escapeHtml. */
  banner?: string;
  /** Trusted HTML: built only from fixed text and escapeHtml. */
  body: string;
}

export function renderPage(opts: PageOptions): string {
  const nav = NAV.map((n) => {
    const label = escapeHtml(n.label);
    if (!n.href) return `<span class="off">${label}</span>`;
    return n.key === opts.active
      ? `<a class="here" href="${n.href}" aria-current="page">${label}</a>`
      : `<a href="${n.href}">${label}</a>`;
  }).join("");
  return (
    "<!doctype html>" +
    '<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    `<title>${escapeHtml(opts.title)}</title>` +
    `<style>${STYLES}</style></head><body>` +
    `<nav class="bar">${nav}` +
    '<form method="post" action="/api/team/signout"><button type="submit">Sign out</button></form>' +
    "</nav><main>" +
    (opts.banner ?? "") +
    `<h1>${escapeHtml(opts.title)}</h1>` +
    `<p class="who">Signed in as ${escapeHtml(opts.personName)}</p>` +
    opts.body +
    "</main></body></html>"
  );
}

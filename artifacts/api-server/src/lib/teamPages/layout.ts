import { escapeHtml } from "./escape";

// The one page shell for the staff dashboard (SYC-43 part 2 plan, PR 1).
// Plain server-drawn HTML: no scripts, mobile first, styles in one <style>
// element (the CSP allows inline styles and nothing else). Every value that
// is not fixed text here goes through escapeHtml.

export type NavKey = "queue" | "cats" | "colonies" | "likely";

interface NavItem {
  key: NavKey;
  label: string;
  /** Null until that screen exists: shown as plain text, not a dead link. */
  href: string | null;
}

const NAV: NavItem[] = [
  { key: "queue", label: "Welfare queue", href: "/api/team" },
  { key: "cats", label: "Cats", href: "/api/team/cats" },
  { key: "colonies", label: "Colonies", href: "/api/team/colonies" },
  { key: "likely", label: "Probably sterilised", href: "/api/team/likely" },
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
.tag.unchecked{background:#fff;border:1px dashed #8a6d00;color:#5c4800}
details.unchecked-drafts summary{cursor:pointer;font-weight:700;margin:8px 0}
.tag.state{background:#fff;border:1px solid #8a877e}
.ago{color:#55524a;font-size:14px}
.photo{display:block;width:100%;max-width:100%;height:auto;max-height:420px;object-fit:contain;background:#ece8dc;border-radius:6px;margin:0 0 8px}
.nophoto{background:#ece8dc;border-radius:6px;padding:14px 10px;margin:0 0 8px;color:#55524a;font-size:14px}
dl{margin:8px 0 0;display:grid;grid-template-columns:1fr;gap:2px}
dt{font-size:13px;color:#55524a;margin-top:6px}
dd{margin:0}
.note{white-space:pre-wrap}
.bad{color:#8c1d18;font-weight:700}
.notice{background:#fff3cd;border:1px solid #c9a227;border-radius:6px;padding:8px 10px;margin:0 0 8px;font-weight:700}
.actions{margin-top:12px;border-top:1px solid #e6e2d6;padding-top:4px}
.actions form{margin:10px 0 0}
.label{display:block;font-size:14px;font-weight:700;margin:0 0 6px}
.hint{font-weight:400;color:#55524a}
.states{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.actions button{font:inherit;font-size:15px;min-height:44px;padding:8px 10px;border-radius:8px;border:1px solid #0b5c6b;background:#fff;color:#0b4553;cursor:pointer}
.actions button:hover{background:#e8f3f5}
.actions button.here{background:#eee9da;border-color:#c9c4b6;color:#3b3930;font-weight:700;cursor:default}
.actions button.save{margin-top:8px;background:#0b5c6b;color:#fff}
.actions button.save:hover{background:#0b4553}
textarea{display:block;width:100%;font:inherit;font-size:16px;padding:8px 10px;border:1px solid #8a877e;border-radius:8px;resize:vertical;min-height:84px}
h3{font-size:16px;margin:16px 0 4px}
.hint{color:#55524a;font-size:14px;margin:0 0 8px}
.search{margin:8px 0 16px}
.searchrow{display:flex;gap:8px}
.searchrow input{flex:1;min-width:0;font:inherit;font-size:16px;min-height:44px;padding:8px 10px;border:1px solid #8a877e;border-radius:8px}
button.primary{margin-top:8px}
button.primary,.searchrow button,.search button{font:inherit;font-size:15px;min-height:44px;padding:8px 16px;border-radius:8px;border:1px solid #0b5c6b;background:#0b5c6b;color:#fff;cursor:pointer}
ul.cats,ul.sightings,ol.history{list-style:none;margin:0;padding:0}
.catrow{display:flex;gap:12px;align-items:center;background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:8px;margin:8px 0;color:inherit;text-decoration:none;overflow-wrap:anywhere}
.catrow:hover{border-color:#0b5c6b}
form.takeout{margin:-4px 0 8px}
form.takeout button{font:inherit;font-size:15px;min-height:44px;padding:8px 16px;border-radius:8px;border:1px solid #0b5c6b;background:#fff;color:#0b4553;cursor:pointer}
.catrow input[type=checkbox]{width:24px;height:24px;margin:0;flex:none}
.catrow input[type=checkbox]:disabled+.thumb{opacity:.6}
.catrow strong{color:#0b5c6b;text-decoration:underline}
.syr{color:#55524a;font-size:14px;font-variant-numeric:tabular-nums}
.status{display:block;font-size:14px;color:#3b3930;margin-top:2px}
.thumb{flex:none;width:72px;height:72px;object-fit:cover;border-radius:6px;background:#ece8dc}
.nothumb{display:inline-flex;align-items:center;justify-content:center;font-size:12px;color:#55524a;text-align:center}
.public{background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:10px 12px;margin:0;font-weight:700}
ul.sightings li{display:flex;gap:12px;align-items:center;background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:8px;margin:8px 0;font-size:15px;overflow-wrap:anywhere}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px}
.gallery figure{margin:0;display:flex;flex-direction:column;gap:6px;scroll-margin-top:12px}
.gallery img{display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;background:#ece8dc}
.gallery figure.ishidden img{opacity:.55;outline:3px solid #8c1d18;outline-offset:-3px}
.gallery .notice{margin:0;font-size:14px}
.gallery form{margin:0}
.gallery button{font:inherit;font-size:15px;width:100%;min-height:44px;padding:8px 10px;border-radius:8px;border:1px solid #0b5c6b;background:#fff;color:#0b4553;cursor:pointer}
.gallery button.restore{background:#0b5c6b;color:#fff}
.hiddenby{margin:0;font-size:14px;color:#8c1d18;font-weight:700;overflow-wrap:anywhere}
.hiddenby .why{font-weight:400;color:#3b3930}
.statement{background:#fff;border:1px solid #d9d5ca;border-left:6px solid #0b5c6b;border-radius:8px;padding:10px 12px;margin:8px 0;overflow-wrap:anywhere}
.statement p{margin:2px 0}
.statement.replaced{border-left-color:#8a877e;background:#faf9f6}
.statement del{color:#6b685f}
.said{font-weight:700}
.sid{font-weight:400;color:#6b685f;font-size:13px}
.meta{color:#55524a;font-size:14px}
.why{font-size:15px}
.replacement{border-top:1px dashed #c9c4b6;margin-top:6px!important;padding-top:6px}
.back{margin:12px 0 0}
.back a,a.tap{display:inline-block;padding:8px 0}
.syrline{margin:0 0 4px;color:#55524a;font-size:15px;font-variant-numeric:tabular-nums}
.photo.catmain{width:auto;max-width:100%;max-height:240px}
.refs{margin:0;padding:0;list-style:none}
.refs li{margin:0 0 2px}
.refs a{display:inline-block;padding:4px 0}
.hintlist{margin:0 0 8px;padding-left:20px}
.hintlist li{margin:4px 0}
.evidence{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin:0 0 4px;max-width:520px}
.evidence figure{margin:0}
.evidence img{display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;background:#ece8dc}
.evidence figcaption{font-size:13px;color:#55524a;margin-top:2px}
.likelyactions form{margin:12px 0 0}
.likelyactions .save{width:100%}
input.text,input[type=date],select.text{display:block;width:100%;font:inherit;font-size:16px;min-height:44px;padding:8px 10px;border:1px solid #8a877e;border-radius:8px;margin:0 0 8px;background:#fff}
input[type=date]{max-width:220px}
.fixes details{background:#fff;border:1px solid #d9d5ca;border-radius:8px;margin:8px 0;padding:0 12px}
.fixes summary,.statement summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:700;color:#0b4553}
.fixes details[open]{padding-bottom:12px}
.fixes form,.statement form{margin:4px 0 0}
fieldset{border:0;margin:0 0 8px;padding:0}
legend{padding:0}
.choice{display:flex;align-items:center;gap:10px;min-height:44px;font-size:16px}
.choice input{width:22px;height:22px;margin:0;flex:none}
.warn{background:#fff3cd;border:1px solid #c9a227;border-radius:6px;padding:8px 10px;margin:8px 0}
.statement details{margin-top:6px;border-top:1px dashed #c9c4b6}
.statement summary{font-size:15px}
.fixes button,.statement button{font:inherit;font-size:15px;min-height:44px;padding:8px 16px;border-radius:8px;border:1px solid #0b5c6b;background:#0b5c6b;color:#fff;cursor:pointer}
.likelyactions button:not(.save){width:100%}
a.catlink{display:block;font-weight:700}
a.sublink{display:block;font-size:14px;padding-top:0}
.tiecard{margin:8px 0}
.tiecard .catrow{margin:0}
.tiecard form{margin:6px 0 0}
.tiecard .hint{margin:6px 0 0}
.tiecard button{font:inherit;font-size:15px;min-height:44px;padding:8px 16px;border-radius:8px;border:1px solid #0b5c6b;background:#0b5c6b;color:#fff;cursor:pointer;width:100%}
@media (min-width:700px){
main{padding-top:20px}
.tiecard button{width:auto}
.report.has-photo{display:grid;grid-template-columns:240px 1fr;gap:0 16px;align-items:start}
.report.has-photo .photo,.report.has-photo .nophoto{grid-column:1;grid-row:1 / span 2}
.report.has-photo>.head,.report.has-photo>dl,.report.has-photo>.actions,.report.has-photo>.notice{grid-column:2}
.states{grid-template-columns:repeat(4,1fr)}
dl{grid-template-columns:150px 1fr;gap:4px 12px}
dt{margin-top:0}
.thumb{width:96px;height:96px}
.photo.catmain{max-height:320px}
.gallery{grid-template-columns:repeat(auto-fill,minmax(170px,1fr))}
}
`;

export interface PageOptions {
  title: string;
  /** The highlighted menu item; null for a page that isn't one of them. */
  active: NavKey | null;
  /**
   * The team's menu (default true). A refusal page leaves it out: a cat
   * guardian shouldn't be offered links to pages that refuse her. Sign out
   * is always there.
   */
  nav?: boolean;
  /** The signed-in person's name (escaped here). */
  personName: string;
  /** Trusted HTML: built only from fixed text and escapeHtml. */
  banner?: string;
  /** Trusted HTML above the heading (a back link). Fixed text and escapeHtml only. */
  beforeTitle?: string;
  /** Trusted HTML right under the heading (a cat's SYR number). Same rule. */
  afterTitle?: string;
  /** Trusted HTML: built only from fixed text and escapeHtml. */
  body: string;
}

export function renderPage(opts: PageOptions): string {
  const nav = (opts.nav === false ? [] : NAV).map((n) => {
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
    (opts.beforeTitle ?? "") +
    `<h1>${escapeHtml(opts.title)}</h1>` +
    (opts.afterTitle ?? "") +
    `<p class="who">Signed in as ${escapeHtml(opts.personName)}</p>` +
    opts.body +
    "</main></body></html>"
  );
}

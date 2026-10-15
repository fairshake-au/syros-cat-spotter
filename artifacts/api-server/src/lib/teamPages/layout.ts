import { escapeHtml } from "./escape";
import { tr, pageLanguage, type Language } from "./strings";

// The one page shell for the staff dashboard (SYC-43 part 2 plan, PR 1).
// Plain server-drawn HTML: no scripts, mobile first, styles in one <style>
// element (the CSP allows inline styles and nothing else). Every value that
// is not fixed text here goes through escapeHtml.

export type NavKey = "queue" | "cats" | "colonies" | "sites" | "likely";

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
  { key: "sites", label: "Feeding sites", href: "/api/team/sites" },
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
.map{margin:0;line-height:0}
.mapband{display:none;position:relative;overflow:hidden;background:#e8e4d8}
.mapband.b144{display:block}
.mapband form{margin:0;padding:0}
.mapband img,.mapband input[type=image]{display:block;margin:0;padding:0;border:0;max-width:none;cursor:crosshair}
.mapband img{cursor:default}
.checkdetails{margin:0 0 8px;font-size:14px}
.checkdetails summary{cursor:pointer;color:#55524a}
.pin{position:absolute;display:block;width:22px;height:22px;margin:-11px 0 0 -11px;border:3px solid #b3261e;border-radius:50%;background:rgba(255,255,255,.45);box-shadow:0 0 0 2px #fff}
span.pin{pointer-events:none}
.pin.site-public{background:#b3261e}
.pin.site-private{background:rgba(255,255,255,.55)}
.pin.site-retired{border-color:#8a877e;background:#d9d5ca}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.attrib{margin:4px 0 8px;font-size:12px;color:#55524a}
.mapmove{margin:8px 0 0}
.mapmove .zoomrow,.mapmove .panrow,.mapmove .arearow{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px}
.mapmove button{font:inherit;font-size:15px;min-height:44px;padding:8px 14px;border-radius:8px;border:1px solid #0b5c6b;background:#fff;color:#0b4553;cursor:pointer}
.mapmove button:disabled{border-color:#c9c4b6;color:#8a877e;cursor:default}
.mapmove .zoomrow button{background:#0b5c6b;color:#fff}
.mapmove .zoomrow button:disabled{background:#eee9da;color:#8a877e}
.mapmove .label{margin:8px 0 6px}
form.addsite{margin:12px 0 0}
form.addsite button,form.typedpos button{font:inherit;font-size:15px;min-height:44px;padding:8px 16px;border-radius:8px;border:1px solid #0b5c6b;background:#0b5c6b;color:#fff;cursor:pointer}
/* "Move on the map" looks like the other actions' cards (.fixes summary). */
form.movesite{margin:8px 0}
.actions form.movesite button{display:flex;align-items:center;width:100%;text-align:left;font:inherit;font-weight:700;color:#0b4553;background:#fff;border:1px solid #d9d5ca;border-radius:8px;min-height:46px;padding:0 12px;cursor:pointer}
form.typedpos{margin:0 0 8px}
.tapped{background:#fff;border:1px solid #d9d5ca;border-left:6px solid #b3261e;border-radius:8px;padding:10px 12px;margin:8px 0;font-variant-numeric:tabular-nums}
main.mappage{line-height:22px}
main.mappage h1{line-height:28px}
main.mappage .who{line-height:20px}
@supports (margin-left:round(down,10.5px,1px)){main.mappage{margin-left:max(0px,round(down,(100% - 760px) / 2,1px));margin-right:0}}
@media (min-width:360px){.mapband.b144{display:none}.mapband.b164{display:block}}
@media (min-width:375px){.mapband.b164{display:none}.mapband.b171{display:block}}
@media (min-width:390px){.mapband.b171{display:none}.mapband.b179{display:block}}
@media (min-width:600px){.mapband.b179{display:none}.mapband.b256{display:block}}
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
  /**
   * The person's language, for guardian-facing pages only. Anything not live
   * yet is drawn in English (see strings/index.ts). Default English.
   */
  lang?: string | null;
  /** Test seam: which languages count as live. Production never passes it. */
  liveLanguages?: readonly Language[];
  /** Trusted HTML: built only from fixed text and escapeHtml. */
  banner?: string;
  /** Trusted HTML above the heading (a back link). Fixed text and escapeHtml only. */
  beforeTitle?: string;
  /** Trusted HTML right under the heading (a cat's SYR number). Same rule. */
  afterTitle?: string;
  /** Trusted HTML: built only from fixed text and escapeHtml. */
  body: string;
  /**
   * A class on <main>. `mappage`: everything above the map has a whole-pixel
   * height and the page sits on a whole pixel, so the map does too (SYC-209
   * PR 3.1; see lib/teamPages/map.ts).
   */
  mainClass?: "mappage";
}

export function renderPage(opts: PageOptions): string {
  // Team pages pass no language and stay English. A guardian-facing page
  // passes the person's language, which still falls back to English until
  // that language is live; `<html lang>` is the language actually used.
  const lang: Language = pageLanguage(opts.lang, opts.liveLanguages);
  const nav = (opts.nav === false ? [] : NAV).map((n) => {
    const label = escapeHtml(n.label);
    if (!n.href) return `<span class="off">${label}</span>`;
    return n.key === opts.active
      ? `<a class="here" href="${n.href}" aria-current="page">${label}</a>`
      : `<a href="${n.href}">${label}</a>`;
  }).join("");
  return (
    "<!doctype html>" +
    `<html lang="${lang}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    `<title>${escapeHtml(opts.title)}</title>` +
    `<style>${STYLES}</style></head><body>` +
    `<nav class="bar">${nav}` +
    '<form method="post" action="/api/team/signout"><button type="submit">' +
    escapeHtml(tr(lang, "shell.signOut", undefined, opts.liveLanguages)) +
    "</button></form>" +
    `</nav><main${opts.mainClass ? ` class="${opts.mainClass}"` : ""}>` +
    (opts.banner ?? "") +
    (opts.beforeTitle ?? "") +
    `<h1>${escapeHtml(opts.title)}</h1>` +
    (opts.afterTitle ?? "") +
    `<p class="who">${escapeHtml(tr(lang, "shell.signedInAs", { name: opts.personName }, opts.liveLanguages))}</p>` +
    opts.body +
    "</main></body></html>"
  );
}

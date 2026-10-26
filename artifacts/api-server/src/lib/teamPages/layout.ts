import { AsyncLocalStorage } from "node:async_hooks";
import { escapeHtml } from "./escape";
import { tr, pageLanguage, type Language } from "./strings";
import { MAP_MARK_CSS, MARK_CSS } from "./marks";
import { CAT_TABS_CSS } from "./catTabs";
import { CHART_CSS } from "../reports/chartCss";
import { WORKSPACE_PAGE } from "../teamAuth/config";
import { SETTINGS_PATH } from "./backLink";

// The one page shell for the staff dashboard (SYC-43 part 2 plan, PR 1).
// Plain server-drawn HTML: no scripts, mobile first, styles in one <style>
// element (the CSP allows inline styles and nothing else). Every value that
// is not fixed text here goes through escapeHtml.

export type NavKey = "home" | "queue" | "cats" | "map" | "colonies" | "reports" | "sites" | "likely" | "colour" | "newcats" | "people" | "settings" | "myPage" | "myColonies" | "workspace";

interface NavItem {
  key: NavKey;
  label: string;
  /** A shorter label for a phone, so the whole menu fits one row. */
  short?: string;
  /** Null until that screen exists: shown as plain text, not a dead link. */
  href: string | null;
}

// The menu names the team's jobs (SYC-396 spec §3.1): Home · Cats · Map ·
// Queue · Colonies · Reports · People, then Settings (SYC-694). Items appear as their screens ship
// (Reports came with PR 3.3a). Since Home (PR 2.1), the work lists live on Home:
// Ear clips to check and Colour check are linked from there, and Feeding
// sites from the Map and each colony (SYC-450).
const NAV: NavItem[] = [
  { key: "home", label: "Home", href: "/api/team/home" },
  { key: "cats", label: "Cats", href: "/api/team/cats" },
  // The Cats page's map view (SYC-396 PR 1.5). /api/team/map is the tap-check page.
  { key: "map", label: "Map", href: "/api/team/cats?view=map" },
  { key: "queue", label: "Queue", href: "/api/team" },
  { key: "colonies", label: "Colonies", href: "/api/team/colonies" },
  // /insights, because /api/team/reports is the welfare queue's (PR 3.3a).
  { key: "reports", label: "Reports", href: "/api/team/insights" },
];

/**
 * A page that has left the team's menu underlines its nearest parent there:
 * the two work lists sit under Home, Feeding sites under Colonies. A cat
 * guardian's own menu still has Feeding sites, so it's mapped for the team only.
 */
const TEAM_PARENT: Partial<Record<NavKey, NavKey>> = { likely: "home", colour: "home", newcats: "home", sites: "colonies" };

/** The People link: only for people who hold `manage_people` (SYC-53 PR 1.2). */
const PEOPLE_NAV: NavItem = { key: "people", label: "People", href: "/api/team/people" };

/**
 * Settings (SYC-694): Areas, Vet settings and App switches. Last of the team's
 * items, after People when that shows. All three are island-team pages, so
 * everyone who gets the team's menu may open them.
 */
const SETTINGS_NAV: NavItem = { key: "settings", label: "Settings", href: SETTINGS_PATH };

/**
 * The shared workspace, on the sign-in site: only for people the workspace
 * would let in (mayUseWorkspace), last in the menu, since it leaves the dashboard.
 */
const WORKSPACE_NAV: NavItem = { key: "workspace", label: "Workspace", href: WORKSPACE_PAGE };

/**
 * Set by requireTeam for the rest of a request, so every page drawn for a
 * management member carries the People link without each page passing it.
 */
export const navContext = new AsyncLocalStorage<{
  people: boolean;
  /** Holds an island row (the team): they get the team's menu. A cat guardian doesn't. */
  island?: boolean;
  /** Signed in: every page carries "My page" (SYC-53 PR 1.3). */
  mine?: boolean;
  /**
   * A cat guardian with no colony yet (SYC-439): her menu has Colonies and
   * her own pages, not Feeding sites, which would refuse her.
   */
  starting?: boolean;
  /** May use the shared workspace: the menu ends with a link to it. */
  workspace?: boolean;
}>();

export const MY_PAGE_PATH = "/api/team/my";
export const MY_COLONIES_PATH = "/api/team/my/colonies";

/**
 * A cat guardian's menu (SYC-209 PR 4.1): only the two screens she may open,
 * in her language. Every other item would answer her with the 403.
 */
const GUARDIAN_NAV: { key: NavKey; word: "nav.colonies" | "nav.sites"; href: string }[] = [
  { key: "colonies", word: "nav.colonies", href: "/api/team/colonies" },
  { key: "sites", word: "nav.sites", href: "/api/team/sites" },
];

const STYLES = `
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#f6f4ef;color:#1d1d1b;font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:#0b5c6b}
/* Skip to the page (SYC-366): off screen until a keyboard reaches it. */
.skip{position:absolute;left:8px;top:-80px;z-index:10;display:inline-flex;align-items:center;min-height:44px;padding:8px 14px;background:#fff;color:#0b5c6b;border:2px solid #0b5c6b;border-radius:8px;font-weight:700}
.skip:focus{top:8px}
/* A clear focus outline: the browser's own is faint on the beige (SYC-366). */
:focus-visible{outline:3px solid #0b5c6b;outline-offset:2px}
main:focus{outline:none}
/* A desktop bar is one row (53px). The person's name and Sign out sit at its
   end (SYC-396 spec §3.2). When there's more to scroll to, a soft shadow shows
   at that edge; the white "covers" scroll with the row and hide the shadow once
   you reach the end, so no text is ever dimmed (SYC-374). On a phone the menu is
   the .phonebar below (SYC-619 §2.1): the page's name and a "Menu" fold. */
.bar{border-bottom:1px solid #d9d5ca;padding:4px 12px;display:flex;flex-wrap:nowrap;gap:0 14px;align-items:center;overflow-x:auto;white-space:nowrap;scrollbar-width:none;
background:linear-gradient(to right,#fff 40%,rgba(255,255,255,0)) left/28px 100% no-repeat local,linear-gradient(to left,#fff 40%,rgba(255,255,255,0)) right/28px 100% no-repeat local,radial-gradient(farthest-side at 0 50%,rgba(29,29,27,.22),rgba(29,29,27,0)) left/12px 100% no-repeat scroll,radial-gradient(farthest-side at 100% 50%,rgba(29,29,27,.22),rgba(29,29,27,0)) right/12px 100% no-repeat scroll;background-color:#fff}
.bar :focus-visible{outline-offset:-3px}
.bar::-webkit-scrollbar{display:none}
/* One width on every page, so the menu never jumps sideways (SYC-577). */
.bar,.bar.wide{padding-inline:max(12px,calc((100% - 1120px) / 2 + 12px))}
.bar>a,.bar>span{font:inherit;font-size:15px;padding:8px 2px;min-height:44px;min-width:44px;justify-content:center;display:inline-flex;align-items:center;flex:none}
.bar .here{font-weight:700;color:#1d1d1b;border-bottom:3px solid #0b5c6b;text-decoration:none}
.bar .off{color:#6b685f}
.bar .short{display:none}
/* The name and Sign out: at the right on a desktop, at the end of the row on a phone. */
/* A very long name may still shorten with "…" on a desktop; the whole name is in its title. */
.bar>.who{margin-left:auto;padding:8px 2px 8px 10px;color:#55524a;font-size:14px;line-height:28px;max-width:260px;display:block;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;min-width:120px}
.bar>form{margin:0;flex:none}
.bar button{font:inherit;font-size:15px;min-height:44px;min-width:44px;padding:8px 2px;background:none;border:0;color:#0b5c6b;text-decoration:underline;cursor:pointer}
/* On a desktop Sign out stays at the screen's right edge and never scrolls
   away: if the menu is too long for the screen (768–1000px), it slides
   under Sign out (adversarial review of PR 1.6). */
@media (min-width:600px){.bar,.bar.wide{padding-right:0}.bar>form{position:sticky;right:0;z-index:1;background:#fff;padding:0 16px 0 10px;box-shadow:-8px 0 8px -6px rgba(29,29,27,.22)}.bar>.who{min-width:0}}
/* On a phone (SYC-619 §2.1) the bar is one row: the current page's name at the
   left and a "Menu" fold at the right. The fold holds every link as a full-width
   row, then the name and Sign out. One copy shows at a time; display:none also
   hides the other from screen readers. Needs no script. */
.phonebar{display:none}
/* A page with no links keeps its plain div bar on a phone: the name wraps, Sign out stays 44px. */
@media (max-width:599px){div.bar,div.bar.wide{gap:0 10px;padding-inline:10px;flex-wrap:wrap;overflow:visible;white-space:normal;background:#fff}div.bar>.who{max-width:none;flex:1 1 150px;min-width:0;margin-left:0;padding:8px 2px 8px 0;white-space:normal;overflow-wrap:anywhere}div.bar>form{margin-left:auto}}
@media (max-width:599px){nav.bar{display:none}.phonebar{display:grid;grid-template-columns:1fr;padding:4px 10px;background:#fff;border-bottom:1px solid #d9d5ca}
.phonebar>*{grid-area:1/1}
.phonehere{align-self:start;z-index:1;display:flex;align-items:center;min-height:44px;max-width:calc(100% - 110px);padding-right:8px;font-weight:700;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
.menufold>summary{display:flex;align-items:center;justify-content:center;width:fit-content;margin-left:auto;min-height:44px;min-width:44px;box-sizing:border-box;padding:0 14px;border:1px solid #0b5c6b;border-radius:8px;background:#fff;color:#0b4553;font-weight:700;font-size:16px;cursor:pointer;list-style:none}
.menufold>summary::-webkit-details-marker{display:none}
.menulinks a,.menulinks button{display:flex;align-items:center;min-height:44px;width:100%;box-sizing:border-box;padding:8px 2px;font:inherit;font-size:16px;background:none;border:0;text-align:left;cursor:pointer}
.menulinks button{color:#0b5c6b;text-decoration:underline}
.menulinks .here{font-weight:700;color:#1d1d1b;text-decoration:underline;text-decoration-thickness:3px;text-decoration-color:#0b5c6b}
.menulinks .off{display:flex;align-items:center;min-height:44px;color:#6b685f}
.menulinks form{margin:0}
.phonebar .who{display:block;padding:8px 2px;color:#55524a;font-size:14px;line-height:1.4;white-space:normal;overflow-wrap:anywhere}}
main{max-width:1120px;margin:0 auto;padding:12px 12px 48px}
.readcol{max-width:736px}
h1{font-size:22px;margin:12px 0 4px}
h2{font-size:18px;margin:28px 0 8px}
.banner{background:#fff3cd;border:1px solid #c9a227;border-radius:8px;padding:10px 12px;margin:12px 0}
.empty{color:#55524a;margin:8px 0}
.report{background:#fff;border:1px solid #d9d5ca;border-left:6px solid #a36b00;border-radius:8px;padding:12px;margin:10px 0;overflow-wrap:anywhere}
.report.urgent{border-left-color:#b3261e}
.report.closed{border-left-color:#8a877e;background:#faf9f6}
.head{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;margin:0 0 8px}
.tag{display:inline-block;font-size:13px;font-weight:700;border-radius:999px;padding:2px 10px;background:#eee9da;color:#3b3930}
.tag.urgent{background:#b3261e;color:#fff}
.tag.attention{background:#fbe7b5;color:#4d3800}
.tag.kittens{background:#d9ecf0;color:#0b4553}
.tag.unchecked{background:#fff;border:1px dashed #8a6d00;color:#5c4800}
.tag.state{background:#fff;border:1px solid #8a877e}
/* SYC-44 PR 7.1: the Issues section, in its own colour band, every row also labelled "Issue". */
.openreports{background:#fdf1d6;border:1px solid #c9a227;border-radius:6px;padding:0;margin:12px 0 0;font-weight:700}
.openreports a{display:block;padding:12px;color:#5c4800;min-height:44px;box-sizing:border-box}
.issues{background:#eef2f9;border-top:6px solid #2f5d9e;border-radius:8px;padding:2px 12px 12px;margin:28px 0 12px}
.issues h3{margin-top:20px}
.report.issue{border-left-color:#2f5d9e}
.tag.issue{background:#2f5d9e;color:#fff}
.tag.hiddennow{background:#8c1d18;color:#fff}
.issuelinks{display:flex;flex-wrap:wrap;gap:4px 16px;margin:8px 0}
.issueacts form{margin:0}
.issueacts button{width:100%}
.ago{color:#55524a;font-size:14px}
.said1{display:block;margin:0;color:#3b3930;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.report>details>summary.rowline{cursor:pointer;min-height:56px;display:flex;gap:10px;align-items:center;list-style:none}
.report>details>summary.rowline::-webkit-details-marker{display:none}
.report>details[open]>summary.rowline{margin-bottom:8px}
.rtext{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.rwhere{font-size:15px}
.rtags{flex:none}
.rwhere time{white-space:nowrap}
.rwhere .tag{margin-left:2px;padding:0 8px;font-size:12px}
.rbody .photolink{display:inline-block}
.rbody .photo{max-width:240px}
details.notebox{margin:10px 0 0}
details.notebox>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:700;color:#0b4553}
.more{margin:8px 0 0}
.photo{display:block;width:100%;max-width:100%;height:auto;max-height:420px;object-fit:contain;background:#ece8dc;border-radius:6px;margin:0 0 8px}
.nophoto{background:#ece8dc;border-radius:6px;padding:14px 10px;margin:0 0 8px;color:#55524a;font-size:14px}
dl{margin:8px 0 0;display:grid;grid-template-columns:minmax(88px,30%) 1fr;gap:6px 10px}
dt{font-size:13px;color:#55524a;padding-top:2px}
dd{margin:0}
.note{white-space:pre-wrap}
.bad{color:#8c1d18;font-weight:700}
.notice{background:#fff3cd;border:1px solid #c9a227;border-radius:6px;padding:8px 10px;margin:0 0 8px;font-weight:700}
.notice.down{background:#fde8e8;border-color:#b42318;color:#7a1810}
.notice form.undo{display:block;margin:6px 0 0}
.notice form.undo button{font:inherit;font-weight:700;min-height:44px;padding:8px 14px;border-radius:8px;border:1px solid #0b5c6b;background:#0b5c6b;color:#fff;cursor:pointer}
.gallery .notice form.undo button{width:100%}
.actions{margin-top:12px;border-top:1px solid #e6e2d6;padding-top:4px}
.actions form{margin:10px 0 0}
.label{display:block;font-size:14px;font-weight:700;margin:0 0 6px}
.hint{font-weight:400;color:#55524a}
.states{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.actions button{font:inherit;font-size:15px;min-height:44px;padding:8px 10px;border-radius:8px;border:1px solid #0b5c6b;background:#fff;color:#0b4553;cursor:pointer}
.actions button:hover{background:#e8f3f5}
.actions button.here{background:#eee9da;border-color:#c9c4b6;color:#3b3930;font-weight:700;cursor:default}
/* SYC-619 §6: Queue cards only */
article.report .actions button.go{background:#0b5c6b;color:#fff}
article.report .actions button.go:hover{background:#0b4553}
article.report .now{margin:0 0 6px;font-weight:700}
article.report .said1{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
article.report details[open] .said1{display:none}
article.report:not(.urgent):not(.issue):not(.closed):not(.likely){border-left-color:#d9d5ca}
/* end SYC-619 §6 */
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
ul.cats,ul.sightings,ol.history,ul.history.coatchanges{list-style:none;margin:0;padding:0}
.catrow{display:flex;gap:12px;align-items:center;background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:8px;margin:8px 0;color:inherit;text-decoration:none;overflow-wrap:anywhere}
.catrow:hover{border-color:#0b5c6b}
form.takeout{margin:-4px 0 8px}
form.takeout button{font:inherit;font-size:15px;min-height:44px;padding:8px 16px;border-radius:8px;border:1px solid #0b5c6b;background:#fff;color:#0b4553;cursor:pointer}
.catrow input[type=checkbox]{width:24px;height:24px;margin:0;flex:none}
.catrow input[type=checkbox]:disabled+.thumb{opacity:.6}
.catrow strong{color:#0b5c6b;text-decoration:underline}
/* A colony's cat row (SYC-619 §7.2): the <li> is the card, its link fills it, the "⋯" sits at the right. */
li.colonycat{position:relative;background:#fff;border:1px solid #d9d5ca;border-radius:8px;margin:8px 0}
li.colonycat:hover{border-color:#0b5c6b}
li.colonycat>a.catrow{border:0;margin:0;background:transparent;padding-right:56px}
.catinfo{display:block;flex:1;min-width:0}
.syr{color:#55524a;font-size:14px;font-variant-numeric:tabular-nums}
.status{display:block;font-size:14px;color:#3b3930;margin-top:2px}
.thumb{flex:none;width:72px;height:72px;object-fit:cover;border-radius:6px;background:#ece8dc}
.compare{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 8px}
.compare figure{margin:0;display:flex;flex-direction:column;gap:2px;font-size:13px;color:#55524a}
.compare img{width:72px;height:72px;object-fit:cover;border-radius:6px;background:#ece8dc}
.muted{color:#55524a;font-size:14px;margin:0}
.report .tiebtn{font:inherit;font-size:15px;min-height:44px;padding:8px 12px;border-radius:8px;border:1px solid #0b5c6b;background:#0b5c6b;color:#fff;cursor:pointer;margin:4px 0}
.nothumb{display:inline-flex;align-items:center;justify-content:center;font-size:12px;color:#55524a;text-align:center}
.public{background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:10px 12px;margin:0;font-weight:700}
form.sightact{margin:6px 0 0}
form.sightact button{font:inherit;font-size:15px;min-height:44px;padding:8px 12px;border-radius:8px;border:1px solid #0b5c6b;background:#fff;color:#0b4553;cursor:pointer}
/* The cat page's header card (SYC-655 spec §2): the facts grid; the card itself is further down. */
.catfacts{display:grid;grid-template-columns:minmax(0,1fr);gap:12px 18px;margin:12px 0 0}
.catfacts .fact{min-width:0}
.catfacts dt{margin:0 0 1px;font-size:14px;font-weight:600;color:#55524a}
.catfacts dd{margin:0;font-size:16px;overflow-wrap:anywhere;min-width:0}
.catfacts .wide{grid-column:1/-1;background:#faf8f3;border:1px solid #efece5;border-radius:8px;padding:8px 10px}
@media (min-width:700px){.catfacts{grid-template-columns:repeat(2,minmax(0,1fr))}}
.catfacts .mark{font-weight:400;align-items:flex-start}
.catfacts .mark-icon{margin-top:3px}
.catfacts .how{display:block;font-size:14px;color:#55524a}
.catfacts .why summary{font-size:14px;color:#0b4553;cursor:pointer;min-height:44px;display:flex;align-items:center}
.catfacts .why dl{margin:4px 0 8px;font-size:14px}
.catfacts .why dt{font-weight:700;margin-top:6px}
.catfacts .why dd{margin:0}
.colourchip{display:inline-block;font-size:14px;border:1px solid #8a877e;border-radius:999px;padding:1px 10px;margin:0 2px 2px 0;color:#1d1d1b;background:#fff}
.catfacts a:has(.colourchip){text-decoration:none}
.publicline{font-size:14px;color:#3b3930;margin:8px 0 16px}
.publicline .public{display:inline;background:none;border:0;padding:0;font-weight:400}
/* The cat page's header card (SYC-655 spec §2). Scoped to div.catcard: the Cats grid cards are li.catcard. One column on a phone, in the page's order; three areas from 1000px. */
div.catcard{background:#fff;border:1px solid #d9d5ca;border-radius:14px;padding:16px;display:grid;grid-template-columns:minmax(0,1fr);gap:16px;margin:12px 0 0}
div.catcard>*{min-width:0}
div.catcard .openreports{margin:0}
.cardphoto a.photo{position:relative;display:block;max-height:none;margin:0;background:none;text-decoration:none;color:inherit}
.cardphoto img.photo.catmain{display:block;width:100%;max-width:none;max-height:none;aspect-ratio:4/3;object-fit:cover;margin:0;border-radius:10px}
.cardphoto .nophoto{display:flex;align-items:center;justify-content:center;aspect-ratio:4/3;margin:0;border-radius:10px}
.cardphoto .ishidden{opacity:.45}
.photocount{position:absolute;right:8px;bottom:8px;display:inline-flex;align-items:center;min-height:44px;box-sizing:border-box;padding:0 14px;border-radius:999px;background:rgba(29,29,27,.88);color:#fff;font-size:14px;font-weight:600}
.nameline{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.nameline h1{margin:0}
.nameline .mark-icon{width:20px;height:20px}
.cardcat .syrline{margin:4px 0 0}
.cardcat .publicline{margin:8px 0 0}
/* The folds this page adds show which way they open. */
li.statement.routine>details>summary::before,.hownote>summary::before{content:"▸";flex:none;width:1.2em;color:#0b4553}
li.statement.routine>details>summary::-webkit-details-marker,.hownote>summary::-webkit-details-marker{display:none}
li.statement.routine>details[open]>summary::before,.hownote[open]>summary::before{content:"▾"}
/* Folds look like folds (SYC-619 §2.6): the same marker, with empty alternative text so a screen reader does not read the triangle. */
.fixes summary::before,.typedfold summary::before,details.hist>summary::before,details.notdescribed>summary::before,details.invitefold>summary::before,details.method>summary::before,details.planfold>summary::before{content:"▸" / "";flex:none;width:1.2em;color:#0b4553}
.fixes details[open]>summary::before,.typedfold[open]>summary::before,details.hist[open]>summary::before,details.notdescribed[open]>summary::before,details.invitefold[open]>summary::before,details.method[open]>summary::before,details.planfold[open]>summary::before{content:"▾" / ""}
.fixes summary,.typedfold summary,details.hist>summary,details.notdescribed>summary,details.invitefold>summary,details.method>summary,details.planfold>summary{display:flex;align-items:center;list-style:none}
.fixes summary::-webkit-details-marker,.typedfold summary::-webkit-details-marker,details.hist>summary::-webkit-details-marker,details.notdescribed>summary::-webkit-details-marker,details.invitefold>summary::-webkit-details-marker,details.method>summary::-webkit-details-marker,details.planfold>summary::-webkit-details-marker{display:none}
/* Buttons with their own look keep no marker (SYC-619 §2.6). */
.fixes details>summary.risky::before,.fixes details[open]>summary.risky::before,.fixes details.update>summary::before,.fixes details.update[open]>summary::before,.fixes details.addnote>summary::before,.fixes details.addnote[open]>summary::before{content:none}
details.method>summary{cursor:pointer;min-height:44px;font-weight:700;color:#0b4553}
details.invitefold>summary{display:inline-flex;width:fit-content}
${CAT_TABS_CSS}
.catmap{margin:8px 0}
.catmap .hint{margin:4px 0 0}
.catmap .mapcap{display:flex;justify-content:space-between;gap:8px;margin:4px 0 0;font-size:14px}
.hownote{margin:8px 0}
.hownote summary{cursor:pointer;min-height:44px;display:flex;align-items:center;color:#0b4553}
/* The cat page's Coat and markings section (SYC-602 PR 3, spec §3.7). */
details.changecoat{margin:12px 0 0}
details.changecoat>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:700;color:#0b4553}
.changepart{margin:0 0 16px}
/* The cat page's History (SYC-602 PR 2, spec §3.5): filters, then one list; a date column, the words, a ⋯ menu. */
.hfilters{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}
.hfilters a{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:999px;border:1px solid #d9d5ca;background:#fff;text-decoration:none;color:#1d1d1b;font-size:14px}
.hfilters a[aria-current]{border-color:#0b5c6b;background:#e4eef0;color:#0b4553;font-weight:700}
ol.tl{list-style:none;margin:0;padding:0;background:#fff;border:1px solid #d9d5ca;border-radius:10px}
ol.tl>li{border-top:1px solid #efece5}
ol.tl>li:first-child{border-top:0}
ol.tl [id],#vet-visits{scroll-margin-top:72px}
li.hrow{display:grid;grid-template-columns:62px minmax(0,1fr) auto;gap:12px;padding:12px;align-items:start;overflow-wrap:anywhere}
li.hrow .when,li.hgroup .when{font-size:14px;color:#55524a;line-height:1.25}
li.hrow .when b,li.hgroup .when b{display:block;color:#1d1d1b;font-size:15px}
li.hrow .what{min-width:0}
li.hrow .what p{margin:4px 0 0}
li.hrow .what .notice{margin:0 0 6px}
li.hrow .who{display:block;font-size:14px;color:#55524a}
li.hrow .vet-photos{display:flex;flex-wrap:wrap;gap:8px}
li.hrow .vet-photos a{display:block;width:64px;height:64px;min-height:64px;padding:0;margin:0}
li.hrow .vet-photos img{display:block;width:64px;height:64px;object-fit:cover;border-radius:6px}
li.hrow.vet{box-shadow:inset 4px 0 0 #0b5c6b}
li.hrow.replaced{background:#faf9f6}
li.hrow del{color:#6b685f}
li.hrow .tag{font-size:12px;padding:1px 8px;margin-left:4px;vertical-align:1px}
.tag.vet{background:#e4eef0;color:#0b4553}
.tag.note{background:#efe9dc;color:#5b4a22}
.tag.warn{background:#fdf1d6;color:#5c4800}
.hthumbs{display:flex;gap:4px;margin-top:6px}
li.hrow a.hthumbs{padding:0;width:max-content}
li.hgroup>details>summary{display:grid;grid-template-columns:62px minmax(0,1fr);gap:12px;padding:12px;cursor:pointer;list-style:none;min-height:44px}
li.hgroup>details>summary::-webkit-details-marker{display:none}
li.hgroup .runwords{color:#0b4553;font-weight:700}
li.hgroup .runwords::before{content:"▸ "}
li.hgroup>details[open] .runwords::before{content:"▾ "}
li.hgroup .hthumb{width:44px;height:44px}
li.hgroup ol.tl{border:0;border-top:1px solid #efece5;border-radius:0;background:#fbfaf7;margin:0 0 0 12px}
.rowmenu.dots{position:relative;margin:0}
.rowmenu.dots>summary{width:44px;height:44px;min-height:44px;padding:0;border:0;border-radius:8px;justify-content:center;font-size:22px;line-height:1;color:#55524a;background:transparent;list-style:none}
.rowmenu.dots>summary::-webkit-details-marker{display:none}
.rowmenu.dots[open]>summary{background:#efece5}
.rowmenu.dots>.rowmenuitems{position:absolute;right:0;top:46px;z-index:3;background:#fff;border:1px solid #d9d5ca;border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.12);padding:6px 12px 10px;width:min(320px,calc(100vw - 48px));box-sizing:border-box}
.rowmenu.dots .meta a{display:flex;align-items:center;min-height:44px;padding:0}
.rowmenu.dots form.sightact{margin:6px 0}
.rowmenu.dots form.sightact button{width:100%;text-align:left}
.rowmenu.dots .rowmenuitems>a.tap{display:flex}
.rowmenu.dots details{border-top:1px dashed #c9c4b6;margin-top:6px}
.rowmenu.dots details>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:700;color:#0b4553;font-size:15px}
.rowmenu.dots details>summary.risky{color:#8c1d18}
.rowmenu.dots details form{margin:4px 0 0}
.rowmenu.dots details button{font:inherit;font-size:15px;min-height:44px;padding:8px 16px;border-radius:8px;border:1px solid #0b5c6b;background:#0b5c6b;color:#fff;cursor:pointer}
.rowmenu.dots details button.risky{background:#fff;color:#8c1d18;border:2px solid #8c1d18}
/* One "More" menu per row: a sighting's actions, or taking a cat out of a colony. */
.rowmenu{margin:4px 0 0}
.rowmenu>summary{cursor:pointer;display:inline-flex;align-items:center;min-height:44px;padding:0 12px;border:1px solid #0b5c6b;border-radius:8px;color:#0b4553;font-weight:700;background:#fff}
.rowmenuitems{padding:6px 0 0}
.rowmenuitems .meta{margin:0 0 4px}
.rowmenu.compact{margin:0}
.rowmenu.compact>summary{position:absolute;top:8px;right:4px;width:44px;height:44px;min-height:44px;padding:0;border:0;border-radius:8px;justify-content:center;font-size:22px;line-height:1;color:#55524a;background:transparent;list-style:none}
.rowmenu.compact>summary::-webkit-details-marker{display:none}
.rowmenu.compact[open]>summary{background:#efece5}
.rowmenu.compact>.rowmenuitems{margin:0 8px;padding:4px 0 8px;border-top:1px dashed #c9c4b6}
.rowmenu.compact form.takeout{margin:4px 0 0}
li.statement.routine>details>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:700;color:#0b4553}
li.statement.routine ol.history{margin:4px 0 0}
ul.sightings li{display:flex;gap:12px;align-items:center;background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:8px;margin:8px 0;font-size:15px;overflow-wrap:anywhere}
.gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;max-width:640px}
.gallery figure{margin:0;display:flex;flex-direction:column;gap:6px}
.gallery img{display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;background:#ece8dc}
.gallery figure.ishidden img{opacity:.55;outline:3px solid #8c1d18;outline-offset:-3px}
.gallery .notice{margin:0;font-size:14px}
.gallery form{margin:0}
.gallery figcaption{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:14px;min-height:44px}
.gallery .capt{min-width:0;overflow-wrap:anywhere}
.gallery figure{position:relative}
.gallery .rowmenu.dots{position:static}
.gallery .rowmenu.dots>.rowmenuitems{top:calc(100% + 2px);left:0;right:auto}
.gallery figure:nth-child(even) .rowmenu.dots>.rowmenuitems{left:auto;right:0}
.gallery button{font:inherit;font-size:15px;width:100%;min-height:44px;padding:8px 10px;border-radius:8px;border:1px solid #0b5c6b;background:#fff;color:#0b4553;cursor:pointer}
.gallery button.restore{background:#0b5c6b;color:#fff}
.gallery .role{margin:0;font-size:14px;font-weight:700;color:#3b3930}
.mixed{display:inline-block;margin-top:4px;font-size:13px;font-weight:700;border-radius:999px;padding:2px 10px;background:#fff3cd;color:#5c4800}
.hiddenby{margin:0;font-size:14px;color:#8c1d18;font-weight:700;overflow-wrap:anywhere}
.hiddenby .why{font-weight:400;color:#3b3930}
.statement{background:#fff;border:1px solid #d9d5ca;border-left:6px solid #0b5c6b;border-radius:8px;padding:10px 12px;margin:8px 0;overflow-wrap:anywhere}
.statement p{margin:2px 0}
.join input{display:block;width:100%;font:inherit;font-size:16px;min-height:44px;padding:8px 10px;border:1px solid #8a877e;border-radius:8px;background:#fff}
.join button{width:100%}
.statement.replaced{border-left-color:#8a877e;background:#faf9f6}
.statement del{color:#6b685f}
.said{font-weight:700}
.sid{font-weight:400;color:#6b685f;font-size:13px}
.meta{color:#55524a;font-size:14px}
.why{font-size:15px}
.replacement{border-top:1px dashed #c9c4b6;margin-top:6px!important;padding-top:6px}
.back{margin:12px 0 0}
/* Links inside text keep their look but get a 44px-tall tap area: padding
   on an inline link doesn't move the text around it. Zero specificity, so
   any class rule below wins. */
:where(dd,li,p,span)>a{padding:12px 0}
.back a,a.tap{display:inline-flex;align-items:center;min-height:44px;padding:0}
ul.sightings li>a{padding:0}
.refs a{padding:8px 0}
a.catlink.tap,a.sublink.tap{display:flex}
.syrline{margin:0 0 4px;color:#55524a;font-size:15px;font-variant-numeric:tabular-nums}
.desc{font-size:15px;margin:8px 0}
.photo.catmain{width:auto;max-width:100%;max-height:240px}
.refs{margin:0;padding:0;list-style:none}
.refs li{margin:0 0 6px}
.hintlist{margin:0 0 8px;padding-left:20px}
.hintlist li{margin:4px 0}
div.evidence{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin:0 0 4px;max-width:520px}
div.evidence figure{margin:0}
div.evidence img{display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;background:#ece8dc}
div.evidence figcaption{font-size:13px;color:#55524a;margin-top:2px}
.likelyactions form{margin:12px 0 0}
.likelyactions .save{width:100%}
input.text,input[type=date],select.text{display:block;width:100%;font:inherit;font-size:16px;min-height:44px;padding:8px 10px;border:1px solid #8a877e;border-radius:8px;margin:0 0 8px;background:#fff}
input[type=date]{max-width:220px}
.fixes details{background:#fff;border:1px solid #d9d5ca;border-radius:8px;margin:8px 0;padding:0 12px}
.fixes summary,.statement summary,.typedfold summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:700;color:#0b4553}
.fixes details[open]{padding-bottom:12px}
.fixes form,.statement form{margin:4px 0 0}
.fixes details.update>summary{border:2px solid #0b5c6b;border-radius:8px;justify-content:center;margin:8px 0}
.fixes details.update{padding:0;border:0;background:none}
.fixes details.addnote{padding:0;border:0;background:none}
.fixes details.addnote>summary{border:2px solid #0b5c6b;border-radius:8px;justify-content:center;margin:8px 0}
.fixes details.addnote[open]>summary{margin-bottom:4px}
.fixes summary.risky{color:#8c1d18}
.fixes a.coatlink{display:flex;align-items:center;min-height:44px;font-weight:700;color:#0b4553}
.fixes form.diedform{margin:20px 0 4px}
.fixes form.diedform button{width:100%;background:#fff;color:#8c1d18;border:2px solid #8c1d18}
.fixes form.diedform button:hover{background:#fbeaea}
.photo.catmain.diedphoto{max-height:140px}
fieldset{border:0;margin:0 0 8px;padding:0}
legend{padding:0}
.choice{display:flex;align-items:center;gap:10px;min-height:44px;font-size:16px}
.choice input{width:22px;height:22px;margin:0;flex:none}
.batchcat{background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:10px 12px;margin:12px 0;overflow-wrap:anywhere}
.batchcat h3{margin:0 0 4px}
.batchstate{font-weight:700;margin:0 0 8px}
.thumbs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 8px}
.batchcat form{margin:0 0 10px}
.batchcat .batchremove{margin:12px 0 0}
.batchsuggest{list-style:none;margin:0 0 8px;padding:0}
.batchsuggest .catrow{flex-wrap:wrap}
.batchsuggest .catrow form{margin:0 0 0 auto}
.batchshared,#cats,#add,#save{margin:0 0 16px}
.batchabandon{margin-top:12px}
.batchundo button,.batchremove button,.batchabandon button{font:inherit;font-size:15px;min-height:44px;padding:8px 16px;border-radius:8px;cursor:pointer}
.batchundo button{border:1px solid #8a877e;background:#fff;color:#1d1d1b}
.warn{background:#fff3cd;border:1px solid #c9a227;border-radius:6px;padding:8px 10px;margin:8px 0}
.statement details{margin-top:6px;border-top:1px dashed #c9c4b6}
.statement summary{font-size:15px}
.fixes button,.statement button{font:inherit;font-size:15px;min-height:44px;padding:8px 16px;border-radius:8px;border:1px solid #0b5c6b;background:#0b5c6b;color:#fff;cursor:pointer}
.likelyactions button:not(.save){width:100%}
a.catlink{display:block;font-weight:700}
.muted a.catlink{display:inline}
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
/* A cat's own sightings on its page (SYC-396 PR 1.4): numbered dark-ink circles with a light ring. */
.pin.seen{width:24px;height:24px;margin:-12px 0 0 -12px;border:1px solid #1d1d1b;background:#1d1d1b;box-shadow:0 0 0 2px #fff;display:flex;align-items:center;justify-content:center;text-decoration:none}
/* A 44px tap area round each 24px marker (spec §12.4). */
.pin.seen::after{content:"";position:absolute;inset:-10px}
.pin.seen.multi{width:auto;min-width:24px;margin:0;padding:0 6px;border-radius:12px;white-space:nowrap;transform:translate(-50%,-50%)}
.pinnum{color:#fff;font-size:12px;font-weight:700;line-height:1}
.pin.sighting{border:3px dashed #1a56a6;border-radius:4px;background:transparent}
/* A colony's trapping planner (SYC-396 PR 2.3; spec §9.2, §12): feeding sites are squares on its small map. */
.planmap .pin.site-public,.planmap .pin.site-private{border-radius:3px}
.estimate{font-size:18px;margin:16px 0 4px}
details.planfold{margin:12px 0}
details.planfold>summary{min-height:44px;cursor:pointer;font-weight:600}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.attrib{margin:4px 0 8px;font-size:12px;color:#55524a}
.mapmove{margin:8px 0 0}
.mapmove .zoomrow,.mapmove .panrow,.mapmove .arearow{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 8px}
.mapmove button{font:inherit;font-size:15px;min-height:44px;padding:8px 14px;border-radius:8px;border:1px solid #0b5c6b;background:#fff;color:#0b4553;cursor:pointer}
.mapmove .zoomrow button{background:#0b5c6b;color:#fff}
.mapmove button:disabled,.mapmove .zoomrow button:disabled{background:transparent;border-style:dashed;color:#6b685f;cursor:not-allowed}
.mapmove .label{margin:8px 0 6px}
form.addsite{margin:12px 0 0}
form.addsite button,form.typedpos button{font:inherit;font-size:15px;min-height:44px;padding:8px 16px;border-radius:8px;border:1px solid #0b5c6b;background:#0b5c6b;color:#fff;cursor:pointer}
/* "Move on the map" looks like the other actions' cards (.fixes summary). */
form.movesite{margin:8px 0}
.actions form.movesite button{display:flex;align-items:center;width:100%;text-align:left;font:inherit;font-weight:700;color:#0b4553;background:#fff;border:1px solid #d9d5ca;border-radius:8px;min-height:46px;padding:0 12px;cursor:pointer}
form.typedpos{margin:0 0 8px}
.tapped{background:#fff;border:1px solid #d9d5ca;border-left:6px solid #b3261e;border-radius:8px;padding:10px 12px;margin:8px 0;font-variant-numeric:tabular-nums}
/* Hard-to-undo actions look different from Save (design review, 15 Oct 2026). */
button.risky,.actions button.risky,.fixes button.risky,.statement button.risky,.gallery button.risky,form.takeout button.risky{background:#fff;color:#8c1d18;border:2px solid #8c1d18}
button.risky:hover{background:#fbeaea}
/* "Are you sure?" (SYC-362): what will happen, then Yes or Cancel. */
ul.sure{background:#fff;border:1px solid #d9d5ca;border-left:6px solid #8c1d18;border-radius:8px;margin:12px 0 16px;padding:12px 12px 12px 32px}
ul.sure li{margin:4px 0}
ul.happens{background:#fff;border:1px solid #d9d5ca;border-radius:8px;margin:12px 0 16px;padding:12px 12px 12px 32px}
ul.happens li{margin:4px 0}
button.primary.wide{width:100%}
form.sureform{margin:0 0 4px}
form.sureform button{font:inherit;font-size:16px;font-weight:700;min-height:48px;padding:10px 18px;border-radius:8px;cursor:pointer}
/* A link that opens another page of actions looks like the action cards. */
a.cardlink{display:flex;align-items:center;min-height:46px;background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:0 12px;font-weight:700;color:#0b4553;text-decoration:none}
a.cardlink:hover{border-color:#0b5c6b}
main.mappage{line-height:22px}
main.mappage h1{line-height:28px}
@supports (margin-left:round(down,10.5px,1px)){main.mappage{margin-left:max(0px,round(down,(100% - 1120px) / 2,1px));margin-right:0}}
@media (min-width:360px){.mapband.b144{display:none}.mapband.b164{display:block}}
@media (min-width:375px){.mapband.b164{display:none}.mapband.b171{display:block}}
@media (min-width:390px){.mapband.b171{display:none}.mapband.b179{display:block}}
@media (min-width:600px){.mapband.b179{display:none}.mapband.b256{display:block}}
/* SYC-2 PR 3.1: the Appearance section's chip pickers and the Colour check list. */
.chips{display:grid;grid-template-columns:1fr;gap:0 12px}
.appfix form{margin:8px 0 0}
.appfix>form>.hint{margin:4px 0 0}
li.colourcheck{list-style:none}
li.colourcheck .catrow{border:0;padding:0;margin:0 0 6px}
details.notdescribed>summary{cursor:pointer;font-weight:700;padding:10px 0;color:#0b4553}
/* Home (SYC-396 PR 2.1; spec §4). */
ul.hlist,ul.hplain,ul.hfigs{list-style:none;margin:8px 0;padding:0}
ul.hplain li,ul.hfigs li{margin:4px 0}
a.hrow{display:flex;gap:10px;align-items:center;background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:8px;margin:8px 0;color:inherit;text-decoration:none;min-height:44px;overflow-wrap:anywhere}
a.hrow:hover{border-color:#0b5c6b}
.hthumb{flex:none;width:56px;height:56px;object-fit:cover;border-radius:6px;background:#ece8dc}
.hthumb.nothumb{display:inline-flex;align-items:center;justify-content:center;font-size:12px;color:#55524a;text-align:center}
.htext{display:flex;flex-direction:column;gap:2px;min-width:0}
.hwhere{font-size:15px}
.hwhere strong{color:#0b5c6b;text-decoration:underline}
.hnote{font-size:14px;color:#3b3930}
a.hlink{display:inline-flex;align-items:center;min-height:44px;padding:0;font-weight:700}
a.hrow.urgent{border-left:6px solid #b3261e}
.hgrid{display:grid;gap:0 32px}
.hgrid>*{min-width:0}
@media (min-width:1000px){.hgrid{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)}}
ul.htiles{list-style:none;margin:12px 0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
@media (min-width:560px){ul.htiles{grid-template-columns:repeat(4,minmax(0,1fr))}}
ul.htiles li.hwide{grid-column:1/-1}
ul.htiles li{display:flex}
ul.htiles li>a.htile{flex:1}
li.trow .cflag{align-self:flex-start}
a.htile{display:flex;flex-direction:column;gap:2px;min-height:44px;background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:8px 10px;color:#0b5c6b;font-size:14px;overflow-wrap:anywhere}
a.htile:hover{border-color:#0b5c6b}
a.htile .hn{font-size:24px;font-weight:700;line-height:1.1;color:#1d1d1b;font-variant-numeric:tabular-nums}
ul.trap{list-style:none;margin:8px 0;padding:0;display:grid;gap:8px}
li.trow{display:flex;flex-direction:column;gap:6px;background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:10px 12px;min-width:0}
li.trow .ttop{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;align-items:baseline}
li.trow .ttop a{display:inline-flex;align-items:center;min-height:44px;overflow-wrap:anywhere}
li.trow .tcost{font-weight:700;font-variant-numeric:tabular-nums}
li.trow .hint{margin:0}
.hbig{font-size:18px;margin:16px 0 8px}
.hbig strong{font-size:40px;line-height:1;margin-right:4px;font-variant-numeric:tabular-nums}
.hfig{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;margin-right:2px}
/* The Cats grid (SYC-396 PR 1.3). */
${MARK_CSS}
.catfilters{margin:8px 0 8px}
details.filters{margin:8px 0}
details.filters>summary{cursor:pointer;display:inline-flex;align-items:center;min-height:44px;padding:8px 14px;border:1px solid #0b5c6b;border-radius:8px;background:#fff;color:#0b4553;font-weight:700;font-size:16px}
.fpanel{background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:8px 12px;margin-top:8px}
.fpanel fieldset{border:0;padding:0;margin:8px 0 12px;min-width:0}
.fpanel legend{font-weight:700;font-size:14px;padding:0 0 4px}
.choices{display:flex;flex-wrap:wrap;gap:8px}
.choicechip{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:4px 12px;border:1px solid #8a877e;border-radius:999px;background:#fff;font-size:15px;cursor:pointer}
.choicechip input{width:20px;height:20px;margin:0}
.flabel{display:block;font-size:14px;font-weight:700;margin:6px 0 4px}
.fchips{list-style:none;margin:0 0 8px;padding:0;display:flex;flex-wrap:wrap;gap:8px}
a.fchip{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:4px 12px;border:1px solid #0b5c6b;border-radius:999px;background:#e6f1f3;color:#0b4553;text-decoration:none;font-size:15px}
.count{margin:8px 0;font-weight:700;display:flex;flex-wrap:wrap;align-items:center;gap:0 12px}
.count .meta{font-weight:400}
#catresults[aria-busy="true"]{opacity:.6;transition:opacity .2s}
.catgrid{list-style:none;margin:8px 0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.catcard{background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:8px;min-width:0;display:flex;flex-direction:column;gap:6px}
a.catcardlink{display:flex;flex-direction:column;align-items:stretch;gap:4px;text-align:left;font-weight:400;color:inherit;text-decoration:none;padding:0;overflow-wrap:anywhere}
.cardimg{display:block;width:100%;height:auto;aspect-ratio:1/1;object-fit:cover;border-radius:6px;background:#ece8dc}
.cardimg.nothumb{display:flex;align-items:center;justify-content:center}
.cardname strong{color:#0b5c6b;text-decoration:underline;font-size:16px}
.cardfact{display:block;font-size:14px;font-weight:400;text-align:left;color:#3b3930}
li.catcard .tag{align-self:flex-start;font-size:13px}
li.catcard form{margin:0}
li.catcard .hint{margin:0}
li.catcard .tiebtn{font:inherit;font-size:15px;min-height:44px;padding:8px 12px;border-radius:8px;border:1px solid #0b5c6b;background:#0b5c6b;color:#fff;cursor:pointer;width:100%}
.paging{margin:8px 0}
/* The Colonies list's progress and flags (SYC-396 PR 2.2). */
.colonylist .catrow>span{display:block;flex:1;min-width:0}
.colonylist .markbar{max-width:480px}
.cpct{font-weight:700;color:#1d1d1b}
.cflags{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.cflag{display:inline-flex;align-items:center;gap:5px;padding:2px 10px;border:1px solid rgba(29,29,27,.55);border-radius:999px;background:#f6f4ef;color:#1d1d1b;font-size:14px}
.cflag svg{flex:none}
.sortbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:8px 0;font-size:15px}
.sortbar a{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border:1px solid #0b5c6b;border-radius:999px;background:#fff;color:#0b4553;text-decoration:none}
.sortbar a[aria-current="true"]{background:#0b5c6b;color:#fff}
.figat{font-size:14px;color:#55524a;margin:4px 0}
/* Find from a photo (SYC-396 PR 2.5; spec §5.2). */
.findwhere fieldset{border:0;padding:0;margin:8px 0 12px;min-width:0}
.findwhere legend{font-weight:700;font-size:14px;padding:0 0 4px}
button.secondary{font:inherit;font-size:15px;min-height:44px;padding:8px 16px;border-radius:8px;border:1px solid #0b5c6b;background:#fff;color:#0b4553;cursor:pointer}
.viewrow{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:0 12px}
.viewrow .findentrylink{margin:8px 0}
a.findentrylink{display:inline-flex;align-items:center;min-height:44px;background:#fff;border:1px solid #0b5c6b;border-radius:8px;padding:0 16px;font-weight:700;color:#0b4553;text-decoration:none}
a.findentrylink:hover{background:#e6f1f3}
.findstep{margin:16px 0 0;padding-top:8px;border-top:1px solid #e6e2d6}
#find-photo{scroll-margin-top:6em}
input.filein{display:block;width:100%;font:inherit;font-size:16px;min-height:44px;padding:8px 0;margin:0 0 8px}
ul.findlist{list-style:none;margin:8px 0;padding:0;display:grid;grid-template-columns:1fr;gap:12px}
.findcard{background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:8px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;align-items:start;overflow-wrap:anywhere}
.findimg{display:block;width:100%;height:auto;aspect-ratio:1/1;object-fit:cover;border-radius:6px;background:#ece8dc}
.findfacts p{margin:0 0 4px}
.findfacts form{margin:8px 0 0}
.findfacts .tiebtn{font:inherit;font-size:15px;min-height:44px;padding:8px 12px;border-radius:8px;border:1px solid #0b5c6b;background:#0b5c6b;color:#fff;cursor:pointer;width:100%}
.findband{font-size:16px}
.findband.very_likely strong{color:#0b5c6b}
.findfacts .why{font-size:13px;color:#55524a}
details.unlikely>summary{cursor:pointer;display:inline-flex;align-items:center;min-height:44px;font-weight:700;color:#0b4553}
.findagain{display:flex;flex-wrap:wrap;gap:0 16px;margin:12px 0}
/* Your photo stays in view while the matches scroll (SYC-491). */
.findmine{position:sticky;top:0;z-index:2;background:#f6f4ef;padding:4px 0;border-bottom:1px solid #e6e2d6}
figure.yourphoto{display:flex;align-items:center;gap:10px;margin:0}
figure.yourphoto img{display:block;width:96px;height:96px;object-fit:cover;border-radius:6px;border:3px solid #0b5c6b;background:#ece8dc}
figure.yourphoto figcaption{font-size:14px;font-weight:700;color:#0b4553}
@media (min-width:700px){ul.findlist{grid-template-columns:repeat(auto-fill,minmax(420px,1fr))}}
@media (min-width:1000px){
.findcompare{display:grid;grid-template-columns:300px minmax(0,1fr);gap:0 24px;align-items:start}
.findmine{top:12px;border-bottom:0;padding:0}
figure.yourphoto{flex-direction:column;align-items:stretch}
figure.yourphoto img{width:300px;height:auto;aspect-ratio:1/1}
ul.findlist{grid-template-columns:1fr}
.findcard{grid-template-columns:300px minmax(0,1fr);gap:16px}
}
/* The island map (SYC-396 PR 1.5; spec §6, §12.4). */
${MAP_MARK_CSS}
${CHART_CSS}
.viewswitch{display:inline-flex;margin:8px 0;border:1px solid #0b5c6b;border-radius:8px;overflow:hidden}
.viewswitch a{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;background:#fff;color:#0b4553;font-weight:700;text-decoration:none}
.viewswitch a[aria-current="page"]{background:#0b5c6b;color:#fff}
.maplayers{display:flex;flex-wrap:wrap;gap:8px;border:0;padding:0;margin:8px 0;min-width:0}
.maplayers legend{font-weight:700;font-size:14px;padding:0 0 4px}
.mapwrap{position:relative;margin:8px 0}
#island-map{height:min(70vh,640px);min-height:320px;border:1px solid #d9d5ca;border-radius:8px;background:#e8e4d8;line-height:normal}
#island-map.tilesfailed{background:#d9e4e8}
.maplegend{position:absolute;top:8px;right:8px;z-index:1050;max-width:min(60%,240px);background:rgba(255,255,255,.96);border:1px solid #d9d5ca;border-radius:8px;padding:2px 10px;font-size:13px;line-height:1.3}
.maplegend>summary{cursor:pointer;font-weight:700;min-height:36px;display:flex;align-items:center}
.maplegend ul{list-style:none;margin:2px 0 6px;padding:0}
.maplegend li{display:flex;align-items:center;gap:8px;margin:5px 0}
.maplegend .catdot,.maplegend .sitesq{flex:none;margin:0 3px}
.maploading{position:absolute;top:8px;left:8px;max-width:40%;z-index:1050;margin:0;background:#fff;color:#1d1d1b;border:1px solid #d9d5ca;border-radius:8px;padding:6px 12px;font-size:14px;line-height:1.3;pointer-events:none}
.mapnote{position:absolute;left:8px;bottom:8px;z-index:1050;max-width:calc(100% - 16px);margin:0;background:#fff;border:1px solid #a6540a;border-radius:8px;padding:8px 10px;font-size:14px;line-height:1.3}
.catsheet{position:absolute;z-index:1100;left:8px;right:8px;bottom:8px;max-height:75%;overflow:auto;background:#fff;border:1px solid #d9d5ca;border-radius:12px;box-shadow:0 4px 18px rgba(0,0,0,.2);padding:12px;line-height:1.4}
.catsheet .sheethead{display:flex;gap:10px;align-items:flex-start}
.catsheet img{flex:none;width:72px;height:72px;object-fit:cover;border-radius:6px;background:#ece8dc}
.catsheet .sheetname{font-size:17px;font-weight:700;margin:0}
.catsheet .sheetname:focus{outline:none}
.catsheet p{margin:4px 0;font-size:14px}
.catsheet .sheetbtns{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.catsheet .sheetbtns a,.catsheet .sheetbtns button{font:inherit;font-size:15px;min-height:44px;display:inline-flex;align-items:center;padding:0 14px;border-radius:8px;border:1px solid #0b5c6b;background:#fff;color:#0b4553;font-weight:700;text-decoration:none;cursor:pointer}
.catsheet .sheetbtns a.primary{background:#0b5c6b;color:#fff}
.catsheet .sheetclose{margin-left:auto;flex:none;min-width:44px;min-height:44px;border:0;background:transparent;font-size:22px;line-height:1;cursor:pointer;color:#3b3930}
.catpinicon{display:flex;align-items:center;justify-content:center;background:transparent;border:0}
.catpinicon:focus-visible{outline:3px solid #1d1d1b;outline-offset:2px;border-radius:50%}
.trailpt{display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#1a56a6;color:#fff;font:700 12px/1 system-ui,sans-serif;box-shadow:0 0 0 2px #fff}
.mapfallback{margin:8px 0}
.pin.catpin{width:44px;height:44px;margin:-22px 0 0 -22px;border:0;background:transparent;box-shadow:none;display:flex;align-items:center;justify-content:center}
.pin.catpin.cluster .catcluster{width:30px;height:30px}
@media (min-width:700px){.catsheet{right:auto;bottom:auto;top:8px;width:320px;max-height:calc(100% - 16px)}}
@media (min-width:700px){
.chips{grid-template-columns:1fr 1fr}
main{padding-top:20px}
.tiecard button{width:auto}
.states{grid-template-columns:repeat(4,1fr)}
dl{grid-template-columns:150px 1fr;gap:4px 12px}
dt{margin-top:0}
.thumb{width:96px;height:96px}
.photo.catmain{max-height:320px}
.catgrid{grid-template-columns:repeat(auto-fill,minmax(176px,1fr))}
}
/* A wide screen shows the filters in the open, without the Filters button. */
@supports selector(::details-content){
@media (min-width:900px){
details.filters::details-content{content-visibility:visible;display:block}
details.filters>summary{display:none}
.fpanel{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0 24px;margin-top:0}
}
}
/* A big screen: the cat page's header card has the photo (200px square), the cat and the buttons side by side; the open-reports box spans the top. */
@media (min-width:1000px){
div.catcard{grid-template-columns:200px minmax(0,1fr) 260px;align-items:start;gap:16px 24px}
div.catcard.noactions{grid-template-columns:200px minmax(0,1fr)}
div.catcard>.openreports{grid-column:1/-1}
.cardphoto img.photo.catmain,.cardphoto .nophoto{width:200px;height:200px;aspect-ratio:1}
.catfacts{grid-template-columns:repeat(3,minmax(0,1fr))}
.cattabs{margin:32px 0 0;border-radius:0}
}
`;

export interface PageOptions {
  title: string;
  /** The highlighted menu item; null for a page that isn't one of them. */
  active: NavKey | null;
  /**
   * The team's menu (default true). A refusal page leaves it out: a cat
   * guardian shouldn't be offered links to pages that refuse her. The name
   * and Sign out are always there, in the bar. `"guardian"`: her own menu,
   * Colonies and Feeding sites only, in her language.
   */
  nav?: boolean | "guardian";
  /**
   * The signed-in person's name (escaped here). `null`: no person at all, so
   * no "Signed in as", no Sign out and no bar (the error page, which never
   * reads the session; SYC-516 C1).
   */
  personName: string | null;
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
  /**
   * Trusted HTML that replaces the plain <h1>title</h1> (a cat's header card
   * holds the <h1> itself). Fixed text and escapeHtml only, and it must carry
   * exactly one <h1>. `title` still names the browser tab.
   */
  heading?: string;
  /** Trusted HTML right under the heading (a cat's SYR number). Same rule. */
  afterTitle?: string;
  /** Trusted HTML: built only from fixed text and escapeHtml. */
  body: string;
  /**
   * A class on <main>. `mappage`: everything above the map has a whole-pixel
   * height and the page sits on a whole pixel, so the map does too (SYC-209
   * PR 3.1; see lib/teamPages/map.ts). `wide`: no 736px reading column
   * (`.readcol`), for a page laid out to use the whole 1120px frame.
   */
  mainClass?: "mappage" | "wide";
  /** Show the People link (default: whatever requireTeam set for this request). */
  showPeople?: boolean;
  /** The team (holds an island row) gets the team's menu (default: whatever requireTeam set; true without it). */
  island?: boolean;
  /** Carry the signed-in person's own links, "My page" (default: whatever requireTeam set; false without it). */
  mine?: boolean;
  /** End the menu with the Workspace link (default: whatever requireTeam set; false without it). */
  workspace?: boolean;
  /**
   * Our own script for this page, from lib/teamAssets.ts assetUrl() only,
   * never anything a request supplied. The page's route must also send the
   * wider security header (setTeamHeaders(res, { scripts: true })), or the
   * browser refuses it; and every page must still work without it. A list
   * runs in its order (the island map: Leaflet, then dashboard-map.js); a
   * null in it (a file that couldn't be read) is left out.
   */
  script?: string | null | (string | null)[];
  /**
   * Our own stylesheets for this page (the island map's leaflet.css), from
   * assetUrl() only, under the same wider header. Nulls are left out.
   */
  styles?: (string | null)[];
}

export function renderPage(opts: PageOptions): string {
  // Team pages pass no language and stay English. A guardian-facing page
  // passes the person's language, which still falls back to English until
  // that language is live; `<html lang>` is the language actually used.
  const lang: Language = pageLanguage(opts.lang, opts.liveLanguages);
  const ctx = navContext.getStore();
  const showPeople = opts.showPeople ?? ctx?.people ?? false;
  const island = opts.island ?? ctx?.island ?? true;
  const mine = opts.mine ?? ctx?.mine ?? false;
  // Not on a refusal page or a cat guardian's menu: only beside the team's own menu.
  const workspace = (opts.workspace ?? ctx?.workspace ?? false) && island && opts.nav !== false && opts.nav !== "guardian";
  // The team's menu for the team (not for a refusal page); a cat guardian's
  // own two links; "My page" for everyone signed in. SYC-53 PR 1.3.
  const own: NavItem[] = mine
    ? [
        ...(island ? [] : [{ key: "myColonies" as const, label: tr(lang, "nav.myColonies", undefined, opts.liveLanguages), href: MY_COLONIES_PATH }]),
        { key: "myPage" as const, label: tr(lang, "nav.myPage", undefined, opts.liveLanguages), href: MY_PAGE_PATH },
      ]
    : [];
  // A cat guardian on a Colonies or Feeding sites page (SYC-209 PR 4.1) gets
  // her own two links to those screens, in her language.
  const starting = ctx?.starting === true;
  const guardianNav: NavItem[] = GUARDIAN_NAV.filter((g) => !starting || g.key === "colonies").map((g) => ({
    key: g.key,
    label: tr(lang, g.word, undefined, opts.liveLanguages),
    href: g.href,
  }));
  const team: NavItem[] =
    opts.nav === false
      ? []
      : opts.nav === "guardian"
        ? guardianNav
        : !island
          ? []
          : [...NAV, ...(showPeople ? [PEOPLE_NAV] : []), SETTINGS_NAV];
  const teamActive = opts.active ? (TEAM_PARENT[opts.active] ?? opts.active) : null;
  const entries = [...team.map((n) => ({ n, active: opts.nav === "guardian" ? opts.active : teamActive })), ...own.map((n) => ({ n, active: opts.active })), ...(workspace ? [{ n: WORKSPACE_NAV, active: null }] : [])];
  // The same links twice: the desktop bar, and the phone's fold (SYC-619 §2.1).
  // On a phone "Feeding sites" shows as "Sites" in the bar (CSS picks one); the
  // fold has full-width rows, so it always uses the full word.
  const renderItems = (phone: boolean) =>
    entries
      .map(({ n, active }) => {
        const label =
          n.short && !phone
            ? `<span class="long">${escapeHtml(n.label)}</span><span class="short">${escapeHtml(n.short)}</span>`
            : escapeHtml(n.label);
        if (!n.href) return `<span class="off">${label}</span>`;
        return n.key === active
          ? `<a class="here" href="${n.href}" aria-current="page">${label}</a>`
          : `<a href="${n.href}">${label}</a>`;
      })
      .join("");
  const items = renderItems(false);
  const phoneItems = renderItems(true);
  // The current page's name, shown outside the fold; empty when none is current.
  const here = entries.find(({ n, active }) => n.href && n.key === active);
  const t = (key: "shell.signOut" | "shell.skip" | "shell.menu" | "shell.menuButton") => escapeHtml(tr(lang, key, undefined, opts.liveLanguages));
  // "Signed in as" and Sign out sit at the end of the bar (SYC-396 spec §3.2),
  // so the page's title comes first. A page with no links at all (the
  // welcome page) keeps the bar for them, but it's no <nav>: there's
  // nowhere to go.
  const who =
    opts.personName === null
      ? ""
      : `<span class="who" title="${escapeHtml(opts.personName)}">${escapeHtml(tr(lang, "shell.signedInAs", { name: opts.personName }, opts.liveLanguages))}</span>` +
    `<form method="post" action="/api/team/signout"><button type="submit">${t("shell.signOut")}</button></form>`;
  const barClass = `bar${opts.mainClass === "wide" ? " wide" : ""}`;
  return (
    "<!doctype html>" +
    `<html lang="${lang}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    `<title>${escapeHtml(opts.title)}</title>` +
    `<style>${STYLES}</style>` +
    (opts.styles ?? [])
      .filter((s): s is string => Boolean(s))
      .map((s) => `<link rel="stylesheet" href="${escapeHtml(s)}">`)
      .join("") +
    (Array.isArray(opts.script) ? opts.script : [opts.script])
      .filter((s): s is string => Boolean(s))
      .map((s) => `<script src="${escapeHtml(s)}" defer></script>`)
      .join("") +
    "</head><body>" +
    // The first thing a keyboard reaches (SYC-366).
    `<a class="skip" href="#main">${t("shell.skip")}</a>` +
    (items
      ? `<nav class="${barClass}" aria-label="${t("shell.menu")}">${items}${who}</nav>` +
        `<nav class="phonebar" aria-label="${t("shell.menu")}"><span class="phonehere">${here ? escapeHtml(here.n.label) : ""}</span>` +
        `<details class="menufold"><summary>${t("shell.menuButton")}</summary><div class="menulinks">${phoneItems}${who}</div></details></nav>`
      : who
        ? `<div class="${barClass}">${who}</div>`
        : "") +
    // tabindex=-1: the skip link moves keyboard focus here, not just the view.
    `<main id="main" tabindex="-1"${opts.mainClass ? ` class="${opts.mainClass}"` : ""}>` +
    // One left edge (SYC-619 §2.4): main is 1120px everywhere; a page that isn't
    // `wide` keeps a 736px reading column at the frame's left edge.
    (opts.mainClass === "wide" ? "" : '<div class="readcol">') +
    (opts.banner ?? "") +
    (opts.beforeTitle ?? "") +
    (opts.heading ?? `<h1>${escapeHtml(opts.title)}</h1>`) +
    (opts.afterTitle ?? "") +
    opts.body +
    (opts.mainClass === "wide" ? "" : "</div>") +
    "</main></body></html>"
  );
}

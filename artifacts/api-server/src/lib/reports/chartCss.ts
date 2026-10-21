// The reports' chart and table styles (SYC-396 PR 3.3a), apart from charts.ts
// so the page shell (layout.ts) can include them without loading the charts.

/** The width every chart is drawn at, in viewBox units. */
export const VIEW_W = 560;
export const INK = "#1d1d1b";

/** Styles for the charts; included in the page shell's stylesheet. */
export const CHART_CSS =
  ".chart{display:block;width:100%;max-width:" + VIEW_W + "px;height:auto;margin:8px 0}" +
  ".chartbox{max-width:" + (VIEW_W + 28) + "px;box-sizing:border-box;background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:8px 13px;margin:12px 0}" +
  ".chartlegend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:4px 0 0;padding:0;list-style:none;font-size:14px}" +
  ".chartlegend li{display:inline-flex;align-items:center;gap:6px}" +
  ".swatch{display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid " + INK + "}" +
  // A drawn swatch (barChart's legend) carries its own colour and pattern: no second outline.
  "svg.swatch{border:0;flex:none}" +
  "details.astable{margin:6px 0 12px}" +
  "details.astable>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:700;color:#0b4553}" +
  'details.astable>summary::before{content:"▸";flex:none;width:1.2em}' +
  'details.astable[open]>summary::before{content:"▾"}' +
  "details.astable>summary::-webkit-details-marker{display:none}" +
  ".tablewrap{overflow-x:auto}" +
  "table.rtable{border-collapse:collapse;width:100%;font-size:14px;background:#fff}" +
  "table.rtable caption{text-align:left;font-weight:700;padding:4px 0}" +
  "table.rtable th,table.rtable td{border-bottom:1px solid #d9d5ca;padding:6px 8px;text-align:left;vertical-align:top}" +
  "table.rtable .num{text-align:right;font-variant-numeric:tabular-nums}" +
  // On a phone a table never scrolls sideways (§12.1): each row becomes a
  // small card of label and value, and the header's sort links wrap above.
  "@media (max-width:599px){table.rtable,table.rtable thead,table.rtable tbody,table.rtable caption{display:block}" +
  "table.rtable thead tr{display:flex;flex-wrap:wrap;gap:0 14px}" +
  "table.rtable th{border:0;padding:0;min-height:44px;display:flex;align-items:center}" +
  "table.rtable tbody tr{display:block;border-bottom:1px solid #d9d5ca;padding:6px 8px}" +
  "table.rtable td{display:flex;justify-content:space-between;gap:12px;border:0;padding:2px 0;text-align:right}" +
  "table.rtable td::before{content:attr(data-label);font-weight:700;text-align:left}" +
  "table.rtable td:first-child{font-weight:700;font-size:16px}table.rtable td:first-child::before{content:none}}" +
  "ol.sbars{list-style:none;margin:8px 0;padding:0}" +
  "ol.sbars>li{background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:8px 12px;margin:0 0 8px}" +
  ".sbname{font-weight:700}" +
  // The Reports list, the time range and the method lines.
  "ul.reportlist{list-style:none;margin:12px 0;padding:0;display:grid;gap:10px}" +
  "ul.reportlist>li{background:#fff;border:1px solid #d9d5ca;border-radius:8px;padding:10px 14px}" +
  "ul.reportlist>li h2{margin:0 0 4px;font-size:18px}" +
  "ul.reportlist>li p{margin:4px 0}" +
  "nav.rangebar{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}" +
  "nav.rangebar a{display:inline-flex;align-items:center;min-height:44px;padding:0 12px;border:1px solid #0b5c6b;border-radius:22px;background:#fff}" +
  "nav.rangebar a.here{background:#0b5c6b;color:#fff;font-weight:700}" +
  "form.rangeform{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:end;margin:4px 0 8px}" +
  "form.rangeform label{display:flex;flex-direction:column;font-size:14px}" +
  "form.rangeform input{min-height:44px}" +
  ".method{margin:20px 0 0;border-top:1px solid #d9d5ca;padding-top:8px}" +
  ".method p{margin:2px 0}" +
  "@media print{nav.rangebar,details.astable>summary,form.rangeform,.bar,a.skip{display:none}details.astable{display:block}.chartbox,ol.sbars>li{break-inside:avoid}}";


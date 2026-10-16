// The Cats grid: filters apply as you tap (SYC-396 PR 1.3.4; spec §5.1).
//
// Plain ES2019, no build step, no libraries. The page is an ordinary GET
// form that works with no script at all; this only saves the tap on
// "Show cats". When a filter changes, it asks the server for the same page
// with the form's choices, and swaps in the part of the page that shows the
// results (the chips for the filters that are on, the "N cats match" count,
// the grid and "Show more"), plus the "Filters (n)" label. Then it puts the
// choices in the address, so the view can still be bookmarked.
//
// It never builds HTML from strings: the answer is parsed by DOMParser and
// its nodes are moved in with importNode/replaceWith. On any failure
// (signed out, offline, a slow answer overtaken by a newer one) it does
// nothing, and "Show cats" still works.
(function () {
  "use strict";

  var form = document.getElementById("catfilters");
  var region = document.getElementById("catresults");
  if (
    !form ||
    !region ||
    typeof window.fetch !== "function" ||
    typeof window.DOMParser !== "function" ||
    typeof window.AbortController !== "function" ||
    typeof window.URLSearchParams !== "function" ||
    typeof window.FormData !== "function" ||
    !window.history ||
    typeof window.history.replaceState !== "function"
  ) {
    return;
  }

  var path = new URL(form.action, window.location.href).pathname;
  var controller = null;
  var timer = 0;

  /** The form's choices as an address query, leaving out empty boxes. */
  function query() {
    var params = new URLSearchParams();
    new FormData(form).forEach(function (value, key) {
      if (typeof value === "string" && value !== "") params.append(key, value);
    });
    return params.toString();
  }

  var applied = query();

  function apply() {
    window.clearTimeout(timer);
    var qs = query();
    if (qs === applied) return;
    if (controller) controller.abort();
    var mine = new AbortController();
    controller = mine;
    var url = qs ? path + "?" + qs : path;
    region.setAttribute("aria-busy", "true");
    window
      .fetch(url, {
        method: "GET",
        headers: { Accept: "text/html" },
        credentials: "same-origin",
        cache: "no-store",
        signal: mine.signal,
      })
      .then(function (res) {
        var type = res.headers.get("Content-Type") || "";
        if (!res.ok || res.redirected || type.indexOf("text/html") !== 0) throw new Error("not the page");
        return res.text();
      })
      .then(function (text) {
        if (controller !== mine) return;
        var doc = new DOMParser().parseFromString(text, "text/html");
        var fresh = doc.getElementById("catresults");
        if (!fresh) throw new Error("no results in the answer");
        var moved = document.importNode(fresh, true);
        region.replaceWith(moved);
        region = moved;
        var label = form.querySelector("summary");
        var freshLabel = doc.querySelector("#catfilters summary");
        if (label && freshLabel) label.textContent = freshLabel.textContent;
        applied = qs;
        window.history.replaceState(window.history.state, "", url);
      })
      .catch(function () {
        // Nothing: the page stays as it was, and "Show cats" still works.
      })
      .then(function () {
        if (controller === mine) {
          controller = null;
          region.removeAttribute("aria-busy");
        }
      });
  }

  form.addEventListener("change", apply);
  // Typing in the name box: wait until the typing pauses.
  form.addEventListener("input", function (event) {
    var t = event.target;
    if (t && t.tagName === "INPUT" && (t.type === "search" || t.type === "text")) {
      window.clearTimeout(timer);
      timer = window.setTimeout(apply, 300);
    }
  });
})();

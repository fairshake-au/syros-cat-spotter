// A dashboard page's map of markers (SYC-705 Phase 2): a site, the Feeding
// sites list, a colony's plan, a cat's sightings. Runs after map-core.js.
//
// Plain ES2019, no build step. It reads each view map's data-map (written by
// the server's renderMap, lib/teamPages/map.ts), starts it with
// CatMap.start and puts one MapLibre marker per marker on it. Place mode
// (picking a spot) is not this file's.
//
// Rules this keeps:
// - **Never builds HTML from strings.** Every label goes in by textContent.
// - **Links stay ours.** A marker is a link only to one of our own pages
//   (/api/team/...) or a part of this page (#...); anything else is drawn
//   without a link.
// - **The page works without it**: the server's list and links are there
//   whether or not the map starts.
(function () {
  "use strict";

  var LOOKS = {
    public: "site-public",
    private: "site-private",
    retired: "site-retired",
    sighting: "sighting",
    sterilised: "catpin",
    probably: "catpin",
    not_known: "catpin",
    not_sterilised: "catpin",
    cluster: "catpin cluster",
    seen: "seen",
  };
  var MARKS = { sterilised: 1, probably: 1, not_known: 1, not_sterilised: 1 };

  function ownLink(href) {
    return typeof href === "string" && (/^\/api\/team\//.test(href) || /^#[\w-]+$/.test(href));
  }

  function span(cls, text) {
    var s = document.createElement("span");
    s.className = cls;
    if (text !== undefined) s.textContent = text;
    return s;
  }

  /** One marker's element, as the server's old pins looked (layout.ts .pin rules). */
  function pinFor(m) {
    var link = ownLink(m.href);
    var el = document.createElement(link ? "a" : "span");
    var look = Object.prototype.hasOwnProperty.call(LOOKS, m.look) ? m.look : null;
    el.className = "pin" + (look ? " " + LOOKS[look] : "") + (look === "seen" && m.text ? " multi" : "");
    if (link) el.setAttribute("href", m.href);
    var label = String(m.label || "");
    el.title = label;
    if (look && MARKS[look]) {
      var dot = span("catdot mark-" + look);
      dot.setAttribute("aria-hidden", "true");
      el.appendChild(dot);
    } else if (look === "cluster" && m.count !== undefined) {
      var ring = span("catcluster");
      ring.setAttribute("aria-hidden", "true");
      ring.appendChild(span("", String(Math.max(0, Math.floor(Number(m.count) || 0)))));
      el.appendChild(ring);
    } else if (look === "seen" && (m.text || typeof m.n === "number")) {
      var num = span("pinnum", m.text ? String(m.text) : String(m.n));
      num.setAttribute("aria-hidden", "true");
      el.appendChild(num);
    }
    el.appendChild(span("sr", label));
    return el;
  }

  function valid(p) {
    return p && p.length === 2 && isFinite(p[0]) && isFinite(p[1]);
  }

  function show(el) {
    var data = window.CatMap.readJson(el, "data-map");
    if (!data || data.mode !== "view") return;
    var fit = Array.isArray(data.fit) ? data.fit.filter(valid) : [];
    // One position: no box to fit, so open there at the closest fitting zoom.
    var centre = fit.length === 1 ? fit[0] : valid(data.centre) ? data.centre : null;
    var zoom = fit.length === 1 ? 17 : data.zoom;
    window.CatMap.start(el, { lang: data.lang, centre: centre, zoom: zoom }).then(
      function (map) {
        var lib = window.CatMap.lib();
        (Array.isArray(data.markers) ? data.markers : []).forEach(function (m) {
          if (!m || !isFinite(m.lat) || !isFinite(m.lng)) return;
          new lib.Marker({ element: pinFor(m), anchor: "center" }).setLngLat([m.lng, m.lat]).addTo(map);
        });
        if (fit.length < 2) return;
        var place = function () {
          var minLat = Infinity;
          var maxLat = -Infinity;
          var minLng = Infinity;
          var maxLng = -Infinity;
          fit.forEach(function (p) {
            minLat = Math.min(minLat, p[0]);
            maxLat = Math.max(maxLat, p[0]);
            minLng = Math.min(minLng, p[1]);
            maxLng = Math.max(maxLng, p[1]);
          });
          map.fitBounds(
            [
              [minLng, minLat],
              [maxLng, maxLat],
            ],
            { padding: 24, maxZoom: window.CatMap.toMapLibreZoom(17), animate: false },
          );
        };
        place();
        // A map in a hidden panel (the cat page's Map tab) has no size yet:
        // fit again once it is shown and MapLibre sees its size.
        if (!el.clientWidth || !el.clientHeight) map.once("resize", place);
      },
      function () {
        // map-core has put the page back as it was, with the no-map line.
      },
    );
  }

  if (!window.CatMap) return;
  Array.prototype.forEach.call(document.querySelectorAll(".map[data-map]"), show);
})();

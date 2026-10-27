// The island Map: every cat on one draggable map (SYC-396 PR 1.5; spec §6;
// SYC-705 Phase 2).
//
// Plain ES2019, no build step. It runs after map-core.js, which starts
// MapLibre GL JS on our own Syros map file (window.CatMap.start) and owns the
// map's loading line, its +/− buttons, and the "needs JavaScript" line when
// the map can't start. This file puts the cats, the feeding sites and a
// focused cat's trail on it. Without it, or when the map can't start, the
// page says so and links to the same cats as the grid.
//
// Rules this keeps:
// - **No position in any address.** Cats come from a signed-in POST with the
//   filters in the body. The page's address only ever gets the filter form's
//   own fields (history.replaceState). The map file is map-core's to fetch.
// - **Never builds HTML from strings.** Every name, place and word goes in by
//   textContent; elements are made with createElement.
// - **Never prints a position.** The card gives the place in words; positions
//   are only handed to MapLibre to place a marker.
(function () {
  "use strict";

  /**
   * Merge markers closer than minPx (screen pixels) until no two are. Each
   * marker is { x, y, cats }; a merged one sits at the average of its cats'
   * points (each marker's x, y weighted by how many cats it holds). Returns
   * new markers; the input is left alone. A grid of minPx squares means each
   * marker is only compared with its neighbours, so thousands stay fast.
   */
  function mergeClose(markers, minPx) {
    var cur = markers.map(function (m) {
      return { x: m.x, y: m.y, cats: m.cats.slice() };
    });
    var limit = minPx * minPx;
    for (;;) {
      // One pass: every chain of markers each closer than minPx to the next
      // becomes one (union-find over neighbours in a grid of minPx squares).
      var grid = {};
      var parent = cur.map(function (_m, i) {
        return i;
      });
      var root = function (i) {
        while (parent[i] !== i) {
          parent[i] = parent[parent[i]];
          i = parent[i];
        }
        return i;
      };
      cur.forEach(function (m, i) {
        var key = Math.floor(m.x / minPx) + ":" + Math.floor(m.y / minPx);
        (grid[key] || (grid[key] = [])).push(i);
      });
      var merged = false;
      cur.forEach(function (m, i) {
        var cx = Math.floor(m.x / minPx);
        var cy = Math.floor(m.y / minPx);
        for (var dx = -1; dx <= 1; dx++) {
          for (var dy = -1; dy <= 1; dy++) {
            var bucket = grid[cx + dx + ":" + (cy + dy)];
            if (!bucket) continue;
            for (var k = 0; k < bucket.length; k++) {
              var j = bucket[k];
              if (j <= i) continue;
              var ddx = cur[j].x - m.x;
              var ddy = cur[j].y - m.y;
              if (ddx * ddx + ddy * ddy >= limit) continue;
              var ri = root(i);
              var rj = root(j);
              if (ri !== rj) {
                parent[rj] = ri;
                merged = true;
              }
            }
          }
        }
      });
      if (!merged) return cur;
      var sums = {};
      var order = [];
      cur.forEach(function (m, i) {
        var r = root(i);
        var n = m.cats.length;
        var s = sums[r];
        if (!s) {
          s = sums[r] = { x: 0, y: 0, cats: [] };
          order.push(r);
        }
        s.x += m.x * n;
        s.y += m.y * n;
        s.cats = s.cats.concat(m.cats);
      });
      cur = order.map(function (r) {
        var s = sums[r];
        return { x: s.x / s.cats.length, y: s.y / s.cats.length, cats: s.cats };
      });
    }
  }

  /** The point the cats' grouping grid is measured from (Syros's north-west corner), so a pan never regroups. */
  var GRID_ORIGIN = [24.85, 37.53];
  if (window.__dashboardMapTest === true) window.__dashboardMapInternals = { mergeClose: mergeClose, gridOrigin: GRID_ORIGIN };

  var mapEl = document.getElementById("island-map");
  var form = document.getElementById("catfilters");
  if (!mapEl || !form) return;
  if (
    !window.CatMap ||
    typeof window.fetch !== "function" ||
    typeof window.AbortController !== "function" ||
    typeof window.URLSearchParams !== "function" ||
    typeof window.FormData !== "function" ||
    !window.JSON
  ) {
    // map-core.js, if it ran, has already put the no-map line in the box; the
    // grid link under it still works.
    return;
  }

  var CatMap = window.CatMap;

  /** The four marks, in legend order, and their words and colours (spec §12.2). */
  var MARKS = ["sterilised", "probably", "not_known", "not_sterilised"];
  var MARK_WORD = {
    sterilised: "Sterilised",
    probably: "Probably sterilised",
    not_known: "Sterilised: not known yet",
    not_sterilised: "Not sterilised",
  };
  var MARK_COLOUR = {
    sterilised: "#0f4a72",
    probably: "#1c77c3",
    not_known: "#2f92dc",
    not_sterilised: "#b8552f",
  };
  var isMark = function (m) {
    return MARKS.indexOf(m) !== -1;
  };

  /** Cats closer than this many screen pixels are drawn as one group (a marker is 44px). */
  var CELL = 44;
  /** The closest app zoom the cats fit may go to (SYC-573, as on the old picture map), a trail's fit, and the padding round both. */
  var FIT_MAX_ZOOM = 16;
  var TRAIL_MAX_ZOOM = 17;
  var FIT_PADDING = 40;
  /** A "Go to" area opens at this app zoom. */
  var AREA_ZOOM = 15;

  function make(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function postJson(url, body, signal) {
    return window
      .fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify(body),
        signal: signal,
      })
      .then(function (res) {
        var type = res.headers.get("Content-Type") || "";
        if (!res.ok || res.redirected || type.indexOf("application/json") !== 0) throw new Error("refused");
        return res.json();
      });
  }

  /** [[minLng, minLat], [maxLng, maxLat]] round these points ({ lat, lng }). */
  function boundsOf(points) {
    var minLat = Infinity;
    var maxLat = -Infinity;
    var minLng = Infinity;
    var maxLng = -Infinity;
    points.forEach(function (p) {
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
    });
    return [
      [minLng, minLat],
      [maxLng, maxLat],
    ];
  }

  // ── The map, and whose moves are whose ────────────────────────────────────

  var data = CatMap.readJson(mapEl, "data-map") || {};
  var map = null;
  /** "starting" until map-core answers, then "live" or "failed". */
  var mapState = "starting";

  // Moves this script makes itself, so a `movestart` can tell them from the
  // person dragging, zooming or pressing "Go to" (SYC-573: the first answer
  // fits the map to the cats only if the person hasn't moved it).
  var programmatic = 0;
  var userMoved = false;
  var fittedOrSkipped = false;
  var fitPending = false;

  /**
   * Run a map move of our own, so it isn't mistaken for the person's.
   * Defensive: today's fits come when no fit can follow, but it keeps a future one from counting as a user move.
   */
  function ownMove(fn) {
    programmatic++;
    try {
      fn();
    } finally {
      programmatic--;
    }
  }

  /**
   * Should the first positions answer fit the map to the cats? Only once, with
   * cats to fit, no focused cat (its trail fit wins) and no move by the person.
   */
  function shouldFitToCats(count, hasFocus, moved, alreadyDone) {
    return !alreadyDone && count > 0 && !hasFocus && !moved;
  }

  // The box is busy while the map starts (map-core's "Loading the map…") and,
  // once it is up, while the cats are being asked for. A map that can't start
  // is never busy.
  var controller = null;
  function syncBusy() {
    if (mapState === "starting" || (mapState === "live" && controller)) mapEl.setAttribute("aria-busy", "true");
    else mapEl.removeAttribute("aria-busy");
  }

  // ── The card (a sheet on a phone) ─────────────────────────────────────────

  var sheet = document.getElementById("catsheet");
  var lastFocus = null;
  var focus = CatMap.readJson(mapEl, "data-focus");
  var colonySelect = document.getElementById("f-colony");

  function colonyName(id) {
    if (id === null || id === undefined) return "No colony";
    if (colonySelect) {
      for (var i = 0; i < colonySelect.options.length; i++) {
        if (colonySelect.options[i].value === String(id)) return colonySelect.options[i].textContent;
      }
    }
    return "Colony";
  }

  function closeSheet() {
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    while (sheet.firstChild) sheet.removeChild(sheet.firstChild);
    if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
    lastFocus = null;
  }

  function openSheet(build, label) {
    if (!sheet) return;
    while (sheet.firstChild) sheet.removeChild(sheet.firstChild);
    lastFocus = document.activeElement;
    var close = make("button", "sheetclose", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", closeSheet);
    build(close);
    sheet.setAttribute("aria-label", label);
    sheet.hidden = false;
    var heading = sheet.querySelector(".sheetname");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }

  function badge(mark) {
    var b = make("span", "mark mark-" + mark);
    var dot = make("span", "catdot mark-" + mark);
    dot.setAttribute("aria-hidden", "true");
    b.appendChild(dot);
    b.appendChild(make("span", "mark-word", MARK_WORD[mark]));
    return b;
  }

  /** The address of this map with these filters, and optionally a cat in focus. */
  function mapAddress(focusId) {
    var qs = query();
    if (focusId !== undefined) qs += (qs ? "&" : "") + "focus=" + encodeURIComponent(String(focusId));
    return path + (qs ? "?" + qs : "");
  }

  function openCat(cat) {
    openSheet(function (close) {
      var head = make("div", "sheethead");
      if (cat.photo) {
        var img = document.createElement("img");
        img.src = cat.photo;
        img.alt = "Photo of " + cat.name;
        img.width = 72;
        img.height = 72;
        head.appendChild(img);
      }
      var words = make("div");
      words.appendChild(make("p", "sheetname", cat.name));
      var b = make("p");
      b.appendChild(badge(cat.mark));
      words.appendChild(b);
      head.appendChild(words);
      head.appendChild(close);
      sheet.appendChild(head);
      sheet.appendChild(make("p", "", colonyName(cat.colony)));
      sheet.appendChild(make("p", "", cat.seen + " · " + cat.place));
      var btns = make("div", "sheetbtns");
      var trail = make("a");
      var focused = focus && focus.id === cat.id;
      trail.href = focused ? mapAddress() : mapAddress(cat.id);
      trail.textContent = focused ? "Hide where else it's been seen" : "Show where else it's been seen";
      btns.appendChild(trail);
      var open = make("a", "primary", "Open the cat");
      open.href = "/api/team/cats/" + encodeURIComponent(String(cat.id));
      btns.appendChild(open);
      sheet.appendChild(btns);
    }, cat.name);
  }

  function openGroup(group) {
    openSheet(function (close) {
      var head = make("div", "sheethead");
      head.appendChild(make("p", "sheetname", group.length + " cats here"));
      head.appendChild(close);
      sheet.appendChild(head);
      var list = make("ul", "cats");
      group.forEach(function (cat) {
        var li = make("li");
        var a = make("a", "", cat.name);
        a.href = "/api/team/cats/" + encodeURIComponent(String(cat.id));
        li.appendChild(a);
        li.appendChild(document.createTextNode(" · "));
        li.appendChild(badge(cat.mark));
        list.appendChild(li);
      });
      sheet.appendChild(list);
    }, group.length + " cats here");
  }

  function openSite(site) {
    openSheet(function (close) {
      var head = make("div", "sheethead");
      head.appendChild(make("p", "sheetname", site.name));
      head.appendChild(close);
      sheet.appendChild(head);
      sheet.appendChild(make("p", "", site.look === "public" ? "Public feeding site" : "Private feeding site"));
      var btns = make("div", "sheetbtns");
      var a = make("a", "primary", "Open the site");
      a.href = "/api/team/sites/" + encodeURIComponent(String(site.id));
      btns.appendChild(a);
      sheet.appendChild(btns);
    }, site.name);
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeSheet();
  });

  // ── Markers ───────────────────────────────────────────────────────────────

  /** A tappable 44px marker: a button holding `inner`, named by `label`. */
  function pinButton(inner, label, onTap) {
    var b = make("button", "catpinicon");
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.appendChild(inner);
    b.addEventListener("click", function (e) {
      // Not the map's own click, which closes the card.
      e.stopPropagation();
      onTap();
    });
    return b;
  }

  /** A MapLibre marker for `el` at { lat, lng }, on the map. */
  function place(el, at) {
    var lib = CatMap.lib();
    return new lib.Marker({ element: el, anchor: "center" }).setLngLat([at.lng, at.lat]).addTo(map);
  }

  // ── Cats, grouped when close together ─────────────────────────────────────

  var cats = [];
  var catMarkers = [];
  var catsOn = true;

  function ring(group) {
    var counts = {};
    group.forEach(function (c) {
      counts[c.mark] = (counts[c.mark] || 0) + 1;
    });
    var at = 0;
    var stops = [];
    MARKS.forEach(function (m) {
      if (!counts[m]) return;
      var from = at;
      at += (counts[m] / group.length) * 100;
      stops.push(MARK_COLOUR[m] + " " + Math.round(from * 100) / 100 + "% " + Math.round(at * 100) / 100 + "%");
    });
    return "conic-gradient(" + stops.join(",") + ")";
  }

  function catMarker(cat) {
    var dot = make("span", "catdot mark-" + cat.mark);
    dot.setAttribute("aria-hidden", "true");
    return place(
      pinButton(dot, cat.name + ": " + MARK_WORD[cat.mark], function () {
        openCat(cat);
      }),
      cat,
    );
  }

  function groupMarker(group) {
    var sumLat = 0;
    var sumLng = 0;
    group.forEach(function (c) {
      sumLat += c.lat;
      sumLng += c.lng;
    });
    var at = { lat: sumLat / group.length, lng: sumLng / group.length };
    var outer = make("span", "catcluster");
    outer.setAttribute("aria-hidden", "true");
    outer.style.background = ring(group);
    outer.appendChild(make("span", "", String(group.length)));
    return place(
      pinButton(outer, group.length + " cats here. Zoom in to see each one.", function () {
        if (map.getZoom() >= map.getMaxZoom()) openGroup(group);
        else map.easeTo({ center: [at.lng, at.lat], zoom: Math.min(map.getZoom() + 2, map.getMaxZoom()) });
      }),
      at,
    );
  }

  /** Our own grouping: cats in the same CELL-pixel square at this zoom are one group, then groups closer than CELL are merged. */
  function drawCats() {
    catMarkers.forEach(function (m) {
      m.remove();
    });
    catMarkers = [];
    if (!map || !catsOn) return;
    var origin = map.project(GRID_ORIGIN);
    var cells = {};
    var order = [];
    cats.forEach(function (c) {
      var p = map.project([c.lng, c.lat]);
      var x = p.x - origin.x;
      var y = p.y - origin.y;
      var key = Math.floor(x / CELL) + ":" + Math.floor(y / CELL);
      if (!cells[key]) {
        cells[key] = { x: 0, y: 0, cats: [] };
        order.push(key);
      }
      var cell = cells[key];
      cell.x += x;
      cell.y += y;
      cell.cats.push(c);
    });
    var markers = order.map(function (key) {
      var cell = cells[key];
      return { x: cell.x / cell.cats.length, y: cell.y / cell.cats.length, cats: cell.cats };
    });
    // Cats either side of a grid line can land in two bubbles that nearly touch.
    mergeClose(markers, CELL).forEach(function (m) {
      var group = m.cats;
      catMarkers.push(group.length === 1 ? catMarker(group[0]) : groupMarker(group));
    });
  }

  /** A cat as the server sent it, or null if anything about it is odd. */
  function cleanCat(c) {
    if (!c || typeof c !== "object") return null;
    if (typeof c.id !== "number" || typeof c.name !== "string" || !isMark(c.mark)) return null;
    if (typeof c.lat !== "number" || typeof c.lng !== "number" || !isFinite(c.lat) || !isFinite(c.lng)) return null;
    return {
      id: c.id,
      name: c.name,
      mark: c.mark,
      lat: c.lat,
      lng: c.lng,
      place: typeof c.place === "string" ? c.place : "",
      seen: typeof c.seen === "string" ? c.seen : "",
      colony: typeof c.colony === "number" ? c.colony : null,
      photo: typeof c.photo === "string" && c.photo.indexOf("/api/team/photos/") === 0 ? c.photo : null,
    };
  }

  var focusOpened = false;

  /** Put what has arrived on the map, once both the map and the cats are here. */
  function render() {
    if (!map) return;
    if (fitPending) {
      fitPending = false;
      if (shouldFitToCats(cats.length, !!focus, userMoved, false)) {
        ownMove(function () {
          map.fitBounds(boundsOf(cats), { padding: FIT_PADDING, maxZoom: CatMap.toMapLibreZoom(FIT_MAX_ZOOM) });
        });
      }
    }
    drawCats();
    if (focus && !focusOpened) {
      var c = cats.filter(function (x) {
        return x.id === focus.id;
      })[0];
      if (c) {
        focusOpened = true;
        openCat(c);
      }
    }
  }

  // ── Filters: the form's own fields, sent in the body ──────────────────────

  var path = new URL(form.action, window.location.href).pathname;
  var count = document.getElementById("mapcount");
  var gridLink = document.getElementById("view-grid");
  var mapLink = document.getElementById("view-map");
  var asGridLink = document.getElementById("map-gridlink");
  var findLink = document.querySelector(".viewrow .findentrylink");
  var typing = 0;

  /** The form's choices as an address query (with view=map), leaving out empty boxes. */
  function query() {
    var params = new URLSearchParams();
    new FormData(form).forEach(function (value, key) {
      if (typeof value === "string" && value !== "") params.append(key, value);
    });
    return params.toString();
  }

  /** The form's choices as the positions request's body: repeats become lists. Never `view`. */
  function filterBody() {
    var body = {};
    new FormData(form).forEach(function (value, key) {
      if (typeof value !== "string" || value === "" || key === "view") return;
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        body[key] = [].concat(body[key], value);
      } else {
        body[key] = key === "colours" || key === "patterns" || key === "sterilised" || key === "lives" ? [value] : value;
      }
    });
    return body;
  }

  /** Is any filter on? The usual "Lives" choice and the sort order aren't filters (as on the server). */
  function isFiltered() {
    var b = filterBody();
    var lives = [].concat(b.lives || []).sort().join(",");
    return Object.keys(b).some(function (k) {
      if (k === "sort") return false;
      if (k === "lives") return lives !== "homed,in_care,street";
      return true;
    });
  }

  function setCount(n) {
    if (!count) return;
    while (count.firstChild) count.removeChild(count.firstChild);
    count.className = "count";
    count.appendChild(
      document.createTextNode(n === 0 ? "No cats match these filters" : n === 1 ? "1 cat on the map" : n + " cats on the map"),
    );
    if (isFiltered()) {
      count.appendChild(document.createTextNode(" "));
      var clear = make("a", "tap", "Clear filters");
      clear.href = path + "?view=map";
      count.appendChild(clear);
    }
  }

  // The filters the server drew the page (and its count line) for. Any answer
  // for other filters rewrites the count, whichever request it was.
  var asDrawn = query();
  var countRewritten = false;

  function loadCats() {
    if (controller) controller.abort();
    var mine = new AbortController();
    controller = mine;
    var asked = query();
    syncBusy();
    postJson("/api/team/cats/positions", filterBody(), mine.signal)
      .then(function (answer) {
        if (controller !== mine || mapState === "failed") return;
        var list = answer && Array.isArray(answer.cats) ? answer.cats : [];
        cats = list.map(cleanCat).filter(Boolean);
        // The first answer only: open on the cats, not the whole island. Never
        // again, so a filter change or typing doesn't jump the map.
        if (!fittedOrSkipped) {
          fittedOrSkipped = true;
          fitPending = true;
        }
        render();
        // Once rewritten, always rewritten (back to the drawn filters included).
        if (asked !== asDrawn || countRewritten) {
          countRewritten = true;
          setCount(cats.length);
        }
      })
      .catch(function () {
        // The cats stay as they were; the form's button still works.
      })
      .then(function () {
        if (controller === mine) {
          controller = null;
          syncBusy();
        }
      });
  }

  function applyFilters() {
    window.clearTimeout(typing);
    var qs = query();
    var gridQs = qs
      .split("&")
      .filter(function (p) {
        return p !== "view=map";
      })
      .join("&");
    if (gridLink) gridLink.href = path + (gridQs ? "?" + gridQs : "");
    if (asGridLink) asGridLink.href = path + (gridQs ? "?" + gridQs : "");
    if (mapLink) mapLink.href = path + (qs ? "?" + qs : "");
    // The photo link carries only the form's colours, area and colony (the
    // server's findAddress), never the rest and never a position.
    if (findLink) {
      var findParams = new URLSearchParams();
      ["colours", "area", "colony"].forEach(function (key) {
        new FormData(form).getAll(key).forEach(function (value) {
          if (typeof value === "string" && value !== "") findParams.append(key, value);
        });
      });
      var findQs = findParams.toString();
      findLink.href = "/api/team/cats/find" + (findQs ? "?" + findQs : "");
    }
    // The chips under the filters describe the page as it was drawn; once
    // the filters change, the count line says what is shown.
    var chips = document.querySelector("#mapresults .fchips");
    if (chips) chips.parentNode.removeChild(chips);
    if (window.history && typeof window.history.replaceState === "function") {
      window.history.replaceState(window.history.state, "", path + (qs ? "?" + qs : ""));
    }
    // With no map, the form sends itself as it would with no script.
    if (mapState !== "failed") loadCats();
  }

  form.addEventListener("change", function (e) {
    var t = e.target;
    if (t && (t.id === "layer-cats" || t.id === "layer-sites")) return; // not a filter
    applyFilters();
  });
  form.addEventListener("input", function (event) {
    var t = event.target;
    if (t && t.tagName === "INPUT" && (t.type === "search" || t.type === "text")) {
      window.clearTimeout(typing);
      typing = window.setTimeout(applyFilters, 300);
    }
  });
  form.addEventListener("submit", function (event) {
    if (mapState === "failed") return;
    event.preventDefault();
    applyFilters();
  });

  // ── Once the map is up ────────────────────────────────────────────────────

  var siteMarkers = [];

  function showSites(on) {
    siteMarkers.forEach(function (m) {
      m.remove();
    });
    siteMarkers = [];
    if (!on || !map) return;
    var sites = CatMap.readJson(mapEl, "data-sites");
    (Array.isArray(sites) ? sites : []).forEach(function (s) {
      if (!s || typeof s.lat !== "number" || typeof s.lng !== "number" || typeof s.name !== "string") return;
      var look = s.look === "public" ? "public" : "private";
      var sq = make("span", "sitesq site-" + look);
      sq.setAttribute("aria-hidden", "true");
      siteMarkers.push(
        place(
          pinButton(sq, s.name + (look === "public" ? ", public feeding site" : ", private feeding site"), function () {
            openSite({ id: s.id, name: s.name, look: look });
          }),
          s,
        ),
      );
    });
  }

  function layerBox(id, sync) {
    var box = document.getElementById(id);
    if (!box) return;
    box.addEventListener("change", function (e) {
      e.stopPropagation(); // not a filter: the cats aren't asked for again
      sync(box.checked);
    });
    sync(box.checked);
  }

  function goTo() {
    var areas = CatMap.readJson(mapEl, "data-areas");
    var row = document.getElementById("mapgoto");
    if (!row || !Array.isArray(areas)) return;
    row.addEventListener("click", function (e) {
      var key = e.target && e.target.getAttribute ? e.target.getAttribute("data-area") : null;
      if (!key) return;
      areas.forEach(function (a) {
        if (a && a.key === key && typeof a.lat === "number" && typeof a.lng === "number") {
          userMoved = true;
          map.easeTo({ center: [a.lng, a.lat], zoom: CatMap.toMapLibreZoom(AREA_ZOOM) });
        }
      });
    });
  }

  /** "Where else it's been seen": numbered dots in time order, joined by a dashed line. */
  function trail() {
    if (!focus || !Array.isArray(focus.points) || !focus.points.length) return;
    var pts = focus.points.filter(function (p) {
      return p && typeof p.lat === "number" && typeof p.lng === "number" && isFinite(p.lat) && isFinite(p.lng);
    });
    if (!pts.length) return;
    try {
      map.addSource("cattrail", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: pts.map(function (p) {
              return [p.lng, p.lat];
            }),
          },
        },
      });
      map.addLayer({
        id: "cattrail",
        type: "line",
        source: "cattrail",
        paint: { "line-color": "#1a56a6", "line-width": 2, "line-dasharray": [2, 2] },
      });
    } catch (e) {
      // The numbered dots still show the trail.
    }
    pts.forEach(function (p, i) {
      var n = make("span", "trailpt", String(i + 1));
      var when = "";
      try {
        when = new Date(p.at).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
          timeZone: "Europe/Athens",
        });
      } catch (e) {
        when = "";
      }
      n.title = i + 1 + ". " + (p.first ? "First recorded" : "Seen") + (when ? " " + when : "");
      place(n, p);
    });
    ownMove(function () {
      if (pts.length > 1) map.fitBounds(boundsOf(pts), { padding: FIT_PADDING, maxZoom: CatMap.toMapLibreZoom(TRAIL_MAX_ZOOM) });
      else map.jumpTo({ center: [pts[0].lng, pts[0].lat], zoom: CatMap.toMapLibreZoom(16) });
    });
  }

  /**
   * A movestart from MapLibre's own resize (a phone turned, a scrollbar
   * appearing) isn't the person moving the map. MapLibre 6 fires it with the
   * ResizeObserver's entries as the event data, copied onto the event by
   * index (map.ts resize(entries); evented.ts Event extends itself with data).
   */
  function fromResize(ev) {
    var first = ev && ev[0];
    return !!(first && typeof first === "object" && "contentRect" in first);
  }

  function live(m) {
    map = m;
    mapState = "live";
    ["maplayers", "mapmove"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.hidden = false;
    });
    map.on("movestart", function (ev) {
      if (programmatic === 0 && !fromResize(ev)) userMoved = true;
    });
    map.on("zoomend", drawCats);
    map.on("click", closeSheet);
    trail();
    layerBox("layer-cats", function (on) {
      catsOn = on;
      drawCats();
    });
    layerBox("layer-sites", showSites);
    goTo();
    render();
    syncBusy();
  }

  // A phone starts with the key folded, so it doesn't sit over the cats.
  var legendBox = document.getElementById("maplegend");
  if (legendBox && window.matchMedia && window.matchMedia("(max-width: 699px)").matches) legendBox.open = false;

  // The cats are asked for while the map file downloads; they go on the map once it is up.
  loadCats();
  CatMap.start(mapEl, { lang: data.lang, centre: data.centre, zoom: data.zoom, rotate: false }).then(live, function () {
    // map-core has put the no-map line in the box and left the grid link showing.
    mapState = "failed";
    syncBusy();
  });
})();

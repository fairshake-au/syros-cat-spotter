// The island Map: every cat on one draggable map (SYC-396 PR 1.5; spec §6).
//
// Plain ES2019, no build step. It runs on Leaflet 1.9.4 (leaflet.js, loaded
// just before this file), both served from our own server. The page works
// without either: the button map is in <noscript>, and if Leaflet is missing
// or anything here throws while starting, this puts that button map back.
//
// Rules this keeps:
// - **No position in any address.** Map pictures come by token: the squares
//   in view are asked for in a signed-in POST (square numbers in the body),
//   and each square is then fetched as /api/team/map-square/<token>. Cats come
//   from a signed-in POST with the filters in the body. The page's address
//   only ever gets the filter form's own fields (history.replaceState).
// - **Never builds HTML from strings.** Every name, place and word goes in by
//   textContent; elements are made with createElement.
// - **Never prints a position.** The card gives the place in words; positions
//   are only handed to Leaflet to place a marker.
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
  if (window.__dashboardMapTest === true) window.__dashboardMapInternals = { mergeClose: mergeClose };

  var mapEl = document.getElementById("island-map");
  var shell = document.getElementById("mapscripted");
  var form = document.getElementById("catfilters");
  if (!mapEl || !shell || !form) return;

  /** Put the button map back (from <noscript>) and leave the page as it would be with no script. */
  function fallBack() {
    try {
      shell.hidden = true;
      var ns = document.querySelector("noscript");
      if (!ns || document.querySelector(".mapfallback")) return;
      // With scripting on, a browser keeps <noscript> as raw, still-escaped
      // text, which is the only time re-reading it is safe. If it was parsed
      // as markup (children, already decoded), leave it alone.
      if (ns.children.length > 0) return;
      var doc = new DOMParser().parseFromString(ns.textContent || "", "text/html");
      var fb = doc.querySelector(".mapfallback");
      if (fb) ns.parentNode.insertBefore(document.importNode(fb, true), ns);
    } catch (e) {
      // Nothing more to try: the filters and the grid still work.
    }
  }

  if (
    !window.L ||
    typeof window.fetch !== "function" ||
    typeof window.AbortController !== "function" ||
    typeof window.URLSearchParams !== "function" ||
    typeof window.FormData !== "function" ||
    !window.JSON
  ) {
    fallBack();
    return;
  }

  var L = window.L;

  /** The four marks, in legend order, and their words and colours (spec §12.2). */
  var MARKS = ["sterilised", "probably", "not_known", "not_sterilised"];
  var MARK_WORD = {
    sterilised: "Sterilised",
    probably: "Probably sterilised",
    not_known: "Sterilised: not known yet",
    not_sterilised: "Not sterilised",
  };
  var MARK_COLOUR = {
    sterilised: "#0a4d59",
    probably: "#2f7884",
    not_known: "#6a949b",
    not_sterilised: "#a6540a",
  };
  var isMark = function (m) {
    return MARKS.indexOf(m) !== -1;
  };

  /** Syros, the island box the map stays over (lib/mapTiles/geometry.ts ISLAND_BOX). */
  var ISLAND = L.latLngBounds([37.36, 24.85], [37.53, 25.01]);
  var ROAM = ISLAND.pad(0.35);

  // A plain outline of the island, drawn only when map pictures fail (spec
  // §6.3). Rough on purpose: enough to show where the cats are on Syros.
  var OUTLINE = [
    [37.515, 24.925], [37.5, 24.945], [37.48, 24.965], [37.462, 24.96], [37.448, 24.95],
    [37.437, 24.948], [37.42, 24.965], [37.405, 24.962], [37.393, 24.95], [37.38, 24.925],
    [37.373, 24.905], [37.378, 24.885], [37.392, 24.872], [37.41, 24.868], [37.425, 24.871],
    [37.44, 24.888], [37.455, 24.893], [37.47, 24.898], [37.49, 24.905], [37.508, 24.91],
  ];

  /** Squares in one token request (routes/teamMap.ts MAX_SQUARES_PER_CALL). */
  var MAX_SQUARES = 64;
  /** Cats closer than this many screen pixels are drawn as one group. */
  var CELL = 44;

  function readData(name, fallback) {
    try {
      var raw = mapEl.getAttribute("data-" + name);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

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

  // Moves this script makes itself, so a `movestart` can tell them from the
  // person dragging, zooming or pressing "Go to" (SYC-573: the first answer
  // fits the map to the cats only if the person hasn't moved it).
  var programmatic = 0;
  var userMoved = false;
  var fittedOrSkipped = false;

  /** Run a map move of our own, so it isn't mistaken for the person's. */
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

  var map;
  try {
    shell.hidden = false;
    map = L.map(mapEl, {
      minZoom: Number(mapEl.getAttribute("data-minzoom")) || 12,
      maxZoom: Number(mapEl.getAttribute("data-maxzoom")) || 19,
      maxBounds: ROAM,
      maxBoundsViscosity: 0.9,
      zoomControl: false,
      attributionControl: false,
      keyboard: true,
    });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    programmatic++;
    try {
      map.fitBounds(ISLAND);
    } finally {
      programmatic--;
    }
  } catch (e) {
    fallBack();
    return;
  }

  // ── Map pictures, by token ────────────────────────────────────────────────

  var note = document.getElementById("mapnote");
  var loaded = 0;
  var failed = 0;
  var outline = null;

  // While the pictures load (spec §5.4): a light outline of Syros in a pane
  // below the picture pane (200), which the pictures cover as they arrive,
  // and a "Loading the map…" line at the top. Both are the script's own, so a
  // page whose script never runs shows neither. The points come from the page
  // (data-outline, one source: lib/geo syrosOutline.ts); missing or invalid,
  // there is just no outline.
  var loadingLine = null;
  function loadingDone() {
    if (loadingLine && loadingLine.parentNode) loadingLine.parentNode.removeChild(loadingLine);
    loadingLine = null;
  }
  try {
    var loadingPoints = JSON.parse(mapEl.getAttribute("data-outline"));
    var okPoints =
      Array.isArray(loadingPoints) &&
      loadingPoints.length >= 3 &&
      loadingPoints.every(function (pt) {
        return Array.isArray(pt) && pt.length === 2 && isFinite(pt[0]) && isFinite(pt[1]);
      });
    if (okPoints) {
      map.createPane("outlineBelow").style.zIndex = "150";
      L.polygon(loadingPoints, {
        pane: "outlineBelow",
        stroke: true,
        weight: 1,
        color: "#b8b3a6",
        fillColor: "#e3dfd3",
        fillOpacity: 1,
        interactive: false,
      }).addTo(map);
    }
  } catch (e) {
    // No loading outline; the pictures and the cats are unaffected.
  }
  if (mapEl.parentNode) {
    loadingLine = make("p", "maploading", "Loading the map\u2026");
    loadingLine.id = "maploading";
    loadingLine.setAttribute("role", "status");
    mapEl.parentNode.insertBefore(loadingLine, mapEl.nextSibling);
  }

  // Squares asked for and squares that have finished (loaded, failed for good,
  // or blank because they are off the island). Spec §5.4: the loading line goes
  // only with the first picture's onload or the failure note. So it can't stay
  // forever, once every square asked for has finished with nothing loaded, a
  // failure (even under 3) shows the note, and no failure at all (all off the
  // island) just removes the line.
  var requested = 0;
  var settled = 0;
  function settledOne() {
    settled++;
    if (settled >= requested && loaded === 0) {
      if (failed > 0) tilesFailing(true);
      else loadingDone();
    }
  }

  function tilesFailing(force) {
    if (!note) return;
    if ((force || failed >= 3) && failed > loaded) {
      loadingDone();
      note.hidden = false;
      mapEl.classList.add("tilesfailed");
      if (!outline) {
        outline = L.polygon(OUTLINE, {
          color: "#8a877e",
          weight: 1,
          fillColor: "#cfcac0",
          fillOpacity: 1,
          interactive: false,
        }).addTo(map);
        outline.bringToBack();
      }
    } else if (loaded > failed + 3) {
      note.hidden = true;
      mapEl.classList.remove("tilesfailed");
      if (outline) {
        map.removeLayer(outline);
        outline = null;
      }
    }
  }

  // "z/x/y" -> { t: token, at: when it was handed out }. A token works for at
  // least a day; one older than TOKEN_KEEP_MS is asked for again, so a map
  // left open overnight doesn't spend the person's squares on dead tokens.
  var TOKEN_KEEP_MS = 23 * 60 * 60 * 1000;
  var tokens = {};
  var waiting = {}; // z -> [{ coords, img, done, retried }]
  var flushTimer = 0;

  function freshToken(key) {
    var kept = Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : null;
    if (!kept) return null;
    if (Date.now() - kept.at > TOKEN_KEEP_MS) {
      delete tokens[key];
      return null;
    }
    return kept.t;
  }

  function wait(entry) {
    (waiting[entry.coords.z] = waiting[entry.coords.z] || []).push(entry);
    if (!flushTimer) flushTimer = window.setTimeout(flush, 0);
  }

  function show(entry, token) {
    var img = entry.img;
    if (!token) {
      entry.done(null, img); // off the island: a blank square
      settledOne();
      return;
    }
    img.onload = function () {
      loaded++;
      loadingDone();
      tilesFailing();
      entry.done(null, img);
      settled++;
    };
    img.onerror = function () {
      // The token may have died (a server key change, say): forget it and
      // ask for a new one, once. A second failure is a real one.
      delete tokens[entry.coords.z + "/" + entry.coords.x + "/" + entry.coords.y];
      if (!entry.retried) {
        entry.retried = true;
        img.onload = img.onerror = null;
        wait(entry);
        return;
      }
      failed++;
      tilesFailing();
      entry.done(new Error("map picture"), img);
      settledOne();
    };
    img.src = "/api/team/map-square/" + token;
  }

  function ask(z, xMin, xMax, yMin, yMax, entries) {
    postJson("/api/team/map-squares", { z: z, xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax })
      .then(function (answer) {
        var got = (answer && answer.tokens) || {};
        entries.forEach(function (e) {
          var key = z + "/" + e.coords.x + "/" + e.coords.y;
          var t = typeof got[key] === "string" && /^[A-Za-z0-9_-]{59}$/.test(got[key]) ? got[key] : "";
          if (t) tokens[key] = { t: t, at: Date.now() };
          show(e, t);
        });
      })
      .catch(function () {
        entries.forEach(function (e) {
          failed++;
        });
        tilesFailing();
        entries.forEach(function (e) {
          e.done(new Error("map picture"), e.img);
          settledOne();
        });
      });
  }

  /** Ask for every square waiting, in as few requests as the 64-square cap allows. */
  function flush() {
    flushTimer = 0;
    var all = waiting;
    waiting = {};
    Object.keys(all).forEach(function (zs) {
      var z = Number(zs);
      var entries = all[zs];
      var xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
      entries.forEach(function (e) {
        xMin = Math.min(xMin, e.coords.x);
        xMax = Math.max(xMax, e.coords.x);
        yMin = Math.min(yMin, e.coords.y);
        yMax = Math.max(yMax, e.coords.y);
      });
      var width = xMax - xMin + 1;
      var colsPer = Math.min(width, MAX_SQUARES);
      var rowsPer = Math.max(1, Math.floor(MAX_SQUARES / colsPer));
      for (var y0 = yMin; y0 <= yMax; y0 += rowsPer) {
        for (var x0 = xMin; x0 <= xMax; x0 += colsPer) {
          var y1 = Math.min(yMax, y0 + rowsPer - 1);
          var x1 = Math.min(xMax, x0 + colsPer - 1);
          var mine = entries.filter(function (e) {
            return e.coords.x >= x0 && e.coords.x <= x1 && e.coords.y >= y0 && e.coords.y <= y1;
          });
          if (mine.length) ask(z, x0, x1, y0, y1, mine);
        }
      }
    });
  }

  var TokenSquares = L.GridLayer.extend({
    createTile: function (coords, done) {
      var img = document.createElement("img");
      img.alt = "";
      img.setAttribute("role", "presentation");
      img.decoding = "async";
      var key = coords.z + "/" + coords.x + "/" + coords.y;
      var entry = { coords: coords, img: img, done: done, retried: false };
      requested++;
      var kept = freshToken(key);
      if (kept) {
        window.setTimeout(function () {
          show(entry, kept);
        }, 0);
        return img;
      }
      wait(entry);
      return img;
    },
  });

  new TokenSquares({
    tileSize: 256,
    bounds: ISLAND,
    minZoom: map.getMinZoom(),
    maxZoom: map.getMaxZoom(),
    updateWhenIdle: true,
    keepBuffer: 1,
  }).addTo(map);

  // ── The card (a sheet on a phone) ─────────────────────────────────────────

  var sheet = document.getElementById("catsheet");
  var lastFocus = null;
  var focus = readData("focus", null);
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
  map.on("click", closeSheet);

  // ── Cats, grouped when close together ─────────────────────────────────────

  var cats = [];
  var catsLayer = L.layerGroup().addTo(map);

  function iconFor(el, size) {
    return L.divIcon({ className: "catpinicon", html: el, iconSize: [size, size] });
  }

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
    var m = L.marker([cat.lat, cat.lng], {
      icon: iconFor(dot, 44),
      title: cat.name + ": " + MARK_WORD[cat.mark],
      keyboard: true,
      riseOnHover: true,
    });
    m.on("click", function (e) {
      L.DomEvent.stopPropagation(e);
      openCat(cat);
    });
    return m;
  }

  function groupMarker(group) {
    var lat = 0, lng = 0;
    group.forEach(function (c) {
      lat += c.lat;
      lng += c.lng;
    });
    var at = L.latLng(lat / group.length, lng / group.length);
    var outer = make("span", "catcluster");
    outer.style.background = ring(group);
    outer.appendChild(make("span", "", String(group.length)));
    var m = L.marker(at, {
      icon: iconFor(outer, 44),
      title: group.length + " cats here. Zoom in to see each one.",
      keyboard: true,
    });
    m.on("click", function (e) {
      L.DomEvent.stopPropagation(e);
      if (map.getZoom() >= map.getMaxZoom()) openGroup(group);
      else map.setView(at, Math.min(map.getZoom() + 2, map.getMaxZoom()));
    });
    return m;
  }

  /** Our own grouping: cats in the same CELL-pixel square at this zoom are one group, then groups closer than CELL are merged. */
  function drawCats() {
    catsLayer.clearLayers();
    var z = map.getZoom();
    var cells = {};
    var order = [];
    cats.forEach(function (c) {
      var p = map.project([c.lat, c.lng], z);
      var key = Math.floor(p.x / CELL) + ":" + Math.floor(p.y / CELL);
      if (!cells[key]) {
        cells[key] = { x: 0, y: 0, cats: [] };
        order.push(key);
      }
      var cell = cells[key];
      cell.x += p.x;
      cell.y += p.y;
      cell.cats.push(c);
    });
    var markers = order.map(function (key) {
      var cell = cells[key];
      return { x: cell.x / cell.cats.length, y: cell.y / cell.cats.length, cats: cell.cats };
    });
    // Cats either side of a grid line can land in two bubbles that nearly touch.
    mergeClose(markers, CELL).forEach(function (m) {
      var group = m.cats;
      catsLayer.addLayer(group.length === 1 ? catMarker(group[0]) : groupMarker(group));
    });
  }
  map.on("zoomend", drawCats);
  map.on("movestart", function () {
    if (programmatic === 0) userMoved = true;
  });

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

  // ── Filters: the form's own fields, sent in the body ──────────────────────

  var path = new URL(form.action, window.location.href).pathname;
  var count = document.getElementById("mapcount");
  var gridLink = document.getElementById("view-grid");
  var mapLink = document.getElementById("view-map");
  var findLink = document.querySelector(".viewrow .findentrylink");
  var controller = null;
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
        body[key] = key === "colours" || key === "sterilised" || key === "lives" ? [value] : value;
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
  var focusOpened = false;
  var countRewritten = false;

  function loadCats() {
    if (controller) controller.abort();
    var mine = new AbortController();
    controller = mine;
    var asked = query();
    mapEl.setAttribute("aria-busy", "true");
    postJson("/api/team/cats/positions", filterBody(), mine.signal)
      .then(function (answer) {
        if (controller !== mine) return;
        var list = answer && Array.isArray(answer.cats) ? answer.cats : [];
        cats = list.map(cleanCat).filter(Boolean);
        // The first answer only: open on the cats, not the whole island. Never
        // again, so a filter change or typing doesn't jump the map and pull a
        // new set of map pictures.
        var firstAnswer = !fittedOrSkipped;
        fittedOrSkipped = true;
        if (shouldFitToCats(cats.length, !!focus, userMoved, !firstAnswer)) {
          var catBounds = L.latLngBounds(
            cats.map(function (c) {
              return [c.lat, c.lng];
            }),
          );
          ownMove(function () {
            map.fitBounds(catBounds.pad(0.15), { maxZoom: 16 });
          });
        }
        drawCats();
        // Once rewritten, always rewritten (back to the drawn filters included).
        if (asked !== asDrawn || countRewritten) {
          countRewritten = true;
          setCount(cats.length);
        }
        if (focus && !focusOpened) {
          var c = cats.filter(function (x) {
            return x.id === focus.id;
          })[0];
          if (c) {
            focusOpened = true;
            openCat(c);
          }
        }
      })
      .catch(function () {
        // The cats stay as they were; the form's button still works.
      })
      .then(function () {
        if (controller === mine) {
          controller = null;
          mapEl.removeAttribute("aria-busy");
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
    loadCats();
  }

  form.addEventListener("change", applyFilters);
  form.addEventListener("input", function (event) {
    var t = event.target;
    if (t && t.tagName === "INPUT" && (t.type === "search" || t.type === "text")) {
      window.clearTimeout(typing);
      typing = window.setTimeout(applyFilters, 300);
    }
  });
  form.addEventListener("submit", function (event) {
    event.preventDefault();
    applyFilters();
  });

  // ── Layers: cats on, feeding sites off ────────────────────────────────────

  var sitesLayer = L.layerGroup();
  readData("sites", []).forEach(function (s) {
    if (!s || typeof s.lat !== "number" || typeof s.lng !== "number" || typeof s.name !== "string") return;
    var look = s.look === "public" ? "public" : "private";
    var sq = make("span", "sitesq site-" + look);
    var m = L.marker([s.lat, s.lng], {
      icon: iconFor(sq, 44),
      title: s.name + (look === "public" ? ", public feeding site" : ", private feeding site"),
      keyboard: true,
    });
    m.on("click", function (e) {
      L.DomEvent.stopPropagation(e);
      openSite({ id: s.id, name: s.name, look: look });
    });
    sitesLayer.addLayer(m);
  });

  function layerBox(id, layer) {
    var box = document.getElementById(id);
    if (!box) return;
    var sync = function () {
      if (box.checked) layer.addTo(map);
      else map.removeLayer(layer);
    };
    box.addEventListener("change", function (e) {
      e.stopPropagation(); // not a filter: the cats aren't asked for again
      sync();
    });
    sync();
  }
  layerBox("layer-cats", catsLayer);
  layerBox("layer-sites", sitesLayer);

  // ── "Go to" an area ───────────────────────────────────────────────────────

  var areas = readData("areas", []);
  var goto = document.getElementById("mapgoto");
  if (goto) {
    goto.addEventListener("click", function (e) {
      var key = e.target && e.target.getAttribute ? e.target.getAttribute("data-area") : null;
      if (!key) return;
      areas.forEach(function (a) {
        if (a && a.key === key && typeof a.lat === "number" && typeof a.lng === "number") {
          userMoved = true;
          map.setView([a.lat, a.lng], Math.min(Number(a.zoom) || 15, map.getMaxZoom()));
        }
      });
    });
  }

  // ── "Where else it's been seen": numbered dots in time order ─────────────

  if (focus && Array.isArray(focus.points) && focus.points.length) {
    var pts = focus.points.filter(function (p) {
      return p && typeof p.lat === "number" && typeof p.lng === "number";
    });
    var line = L.polyline(
      pts.map(function (p) {
        return [p.lat, p.lng];
      }),
      { color: "#1a56a6", weight: 2, dashArray: "4 4", interactive: false },
    ).addTo(map);
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
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: "catpinicon", html: n, iconSize: [30, 30] }),
        title: i + 1 + ". " + (p.first ? "First recorded" : "Seen") + (when ? " " + when : ""),
        keyboard: false,
        interactive: false,
      }).addTo(map);
    });
    ownMove(function () {
      if (pts.length > 1) map.fitBounds(line.getBounds().pad(0.3), { maxZoom: 17 });
      else map.setView([pts[0].lat, pts[0].lng], 16);
    });
  }

  // A phone starts with the key folded, so it doesn't sit over the cats.
  var legendBox = document.getElementById("maplegend");
  if (legendBox && window.matchMedia && window.matchMedia("(max-width: 699px)").matches) legendBox.open = false;

  loadCats();
})();

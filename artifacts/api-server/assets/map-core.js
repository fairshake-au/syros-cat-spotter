// The dashboard's map, started on our own Syros map file (SYC-705 Phase 2).
//
// A classic script with no build step, plain ES2019 except the one dynamic
// import() of MapLibre GL JS 6 (an ES module; a browser without import()
// gets the page's no-map line). It defines window.CatMap:
//
//   CatMap.start(el, opts) -> Promise<map>   start a map in the .map box el
//   CatMap.toMapLibreZoom(z), CatMap.fromMapLibreZoom(z)
//   CatMap.lib()                             the loaded MapLibre module, or null
//
// opts: { lang: "en"|"el", centre: [lat, lng], zoom (app zoom 12-19),
// rotate: false to turn rotation off }. The page scripts on top of it
// (dashboard-pin.js, the cats map) add markers.
//
// Rules this keeps:
// - **No position in any address.** It fetches four fixed addresses only,
//   with nothing but the map version in them: the version, the whole map
//   file, the style, and (through MapLibre) the style's fonts and symbols.
//   Never a Range header: the map file comes whole and is read in memory.
// - **Never builds HTML from strings.** createElement and textContent only.
// - **The page works without it.** Until the map starts, the box holds the
//   page's "needs JavaScript" line; on any failure that line stays.
(function () {
  "use strict";

  var DATA = "/api/team/map-data/";
  var CACHE = "syros-map";
  // Syros (lib/island.ts ISLAND_BOX), padded so a marker at the edge is not cut off.
  var BOX = { minLat: 37.36, maxLat: 37.53, minLng: 24.85, maxLng: 25.01 };
  var PAD = 0.03;
  var CENTRE = [37.445, 24.93];
  var START_ZOOM = 12;

  /** App zoom (12-19, the old picture maps' numbers) to MapLibre's (512 px tiles). */
  function toMapLibreZoom(z) {
    return z - 1;
  }
  function fromMapLibreZoom(z) {
    return z + 1;
  }

  var lib = null;
  var protocol = null;
  /** The map file's archive, once per page: version -> Promise. */
  var archives = {};

  function fail(what) {
    var e = new Error("map: " + what);
    e.mapFailure = true;
    return e;
  }

  // TEST-ONLY indirection: jsdom can't import a module from a URL, so the
  // tests set window.__catMapImport. In a browser it is never set.
  function importLibrary(url) {
    var hook = window.__catMapImport;
    if (typeof hook === "function") return hook(url);
    return import(url);
  }

  function readJson(el, name) {
    try {
      return JSON.parse(el.getAttribute(name) || "null");
    } catch (e) {
      return null;
    }
  }

  function get(path) {
    return window.fetch(path, { credentials: "same-origin" }).then(function (res) {
      if (!res.ok) throw fail(path + " answered " + res.status);
      return res;
    });
  }

  /** The whole map file of `version`, from the Cache API copy when there is one. */
  function mapFile(version) {
    var url = window.location.origin + DATA + "v" + version + "/syros.pmtiles";
    var plain = function () {
      return get(url).then(function (res) {
        return res.blob();
      });
    };
    var store;
    try {
      store = window.caches;
    } catch (e) {
      store = null;
    }
    if (!store || typeof store.open !== "function") return plain();
    var cached = store.open(CACHE).then(function (cache) {
      return cache
        .keys()
        .then(function (keys) {
          // Only this version is kept: an older copy is dead weight on a phone.
          return Promise.all(
            keys
              .filter(function (k) {
                return k.url !== url;
              })
              .map(function (k) {
                return cache.delete(k);
              }),
          );
        })
        .then(function () {
          return cache.match(url);
        })
        .then(function (hit) {
          if (hit) return hit.blob();
          return get(url).then(function (res) {
            var copy = res.clone();
            return res.blob().then(function (blob) {
              return cache.put(url, copy).then(
                function () {
                  return blob;
                },
                function () {
                  return blob;
                },
              );
            });
          });
        });
    });
    // A Cache API that won't work (private window, storage full) is no reason
    // to lose the map; an answer from our server that isn't 2xx is.
    return cached.catch(function (e) {
      if (e && e.mapFailure) throw e;
      return plain();
    });
  }

  function archive(version) {
    if (!archives[version]) {
      archives[version] = mapFile(version).then(function (blob) {
        var pm = window.pmtiles;
        if (!protocol) {
          protocol = new pm.Protocol();
          lib.addProtocol("pmtiles", protocol.tile);
        }
        // The style's source is pmtiles://syros-v<N>.pmtiles; a FileSource's key is its File's name.
        var file = new window.File([blob], "syros-v" + version + ".pmtiles");
        protocol.add(new pm.PMTiles(new pm.FileSource(file)));
      });
      archives[version].catch(function () {
        delete archives[version];
      });
    }
    return archives[version];
  }

  function absolute(u) {
    return typeof u === "string" && u.charAt(0) === "/" ? window.location.origin + u : u;
  }

  function style(version, lang) {
    return get(DATA + "v" + version + "/style-" + (lang === "el" ? "el" : "en") + ".json")
      .then(function (res) {
        return res.json();
      })
      .then(function (s) {
        if (!s || typeof s !== "object") throw fail("style");
        s.glyphs = absolute(s.glyphs);
        if (Array.isArray(s.sprite)) {
          s.sprite = s.sprite.map(function (sp) {
            return { id: sp.id, url: absolute(sp.url) };
          });
        } else {
          s.sprite = absolute(s.sprite);
        }
        return s;
      });
  }

  function button(label, text, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.title = label;
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }

  function controls(map, words, rotate) {
    var box = document.createElement("div");
    box.className = "mapctl";
    box.appendChild(
      button(words.zoomIn || "+", "+", function () {
        map.easeTo({ zoom: map.getZoom() + 1 });
      }),
    );
    box.appendChild(
      button(words.zoomOut || "−", "−", function () {
        map.easeTo({ zoom: map.getZoom() - 1 });
      }),
    );
    if (rotate) {
      box.appendChild(
        button(words.compass || "N", "↑", function () {
          map.resetNorth();
        }),
      );
    }
    return box;
  }

  /** The page as it was, with the "needs JavaScript" line in the box. */
  function showNoMap(el, words) {
    var kids = Array.prototype.slice.call(el.children);
    var line = null;
    kids.forEach(function (k) {
      if (!line && k.classList.contains("mapnojs")) line = k;
      else el.removeChild(k);
    });
    if (!line) {
      line = document.createElement("p");
      line.className = "mapnojs";
      el.appendChild(line);
    }
    if (words.needsJs) line.textContent = words.needsJs;
  }

  function lngLat(p) {
    return [Number(p[1]), Number(p[0])];
  }

  function start(el, opts) {
    opts = opts || {};
    var words = readJson(el, "data-words") || {};
    var canvas = null;
    var made = null;
    return Promise.resolve()
      .then(function () {
        if (typeof window.fetch !== "function") throw fail("no fetch");
        if (!window.pmtiles || typeof window.pmtiles.Protocol !== "function") throw fail("no pmtiles");
        if (typeof window.File !== "function") throw fail("no File");
        var libUrl = el.getAttribute("data-maplibre");
        var workerUrl = el.getAttribute("data-worker");
        if (!libUrl || !workerUrl) throw fail("no library address");
        return Promise.resolve(lib || importLibrary(libUrl)).then(function (m) {
          if (!m || typeof m.Map !== "function") throw fail("no library");
          if (!lib) {
            // Before the first map: a same-origin module worker, no blob: (CSP).
            m.setWorkerUrl(workerUrl);
            lib = m;
          }
        });
      })
      .then(function () {
        return get(DATA + "current");
      })
      .then(function (res) {
        return res.json();
      })
      .then(function (cur) {
        var version = cur && cur.version;
        if (typeof version !== "number" || !isFinite(version) || version < 1 || Math.floor(version) !== version) throw fail("version");
        return Promise.all([archive(version), style(version, opts.lang)]);
      })
      .then(function (got) {
        canvas = document.createElement("div");
        canvas.className = "mapcanvas";
        el.appendChild(canvas);
        var centre = opts.centre && opts.centre.length === 2 ? opts.centre : CENTRE;
        var zoom = typeof opts.zoom === "number" ? opts.zoom : START_ZOOM;
        // Throws without WebGL2 (MapLibre 6's GPUInitializationError): no map.
        made = new lib.Map({
          container: canvas,
          style: got[1],
          center: lngLat(centre),
          zoom: toMapLibreZoom(zoom),
          minZoom: 11,
          maxZoom: 18,
          maxPitch: 0,
          pitchWithRotate: false,
          // MapLibre's own controls and attribution draw data: icons the CSP
          // refuses; ours are below and the credit line is in the page.
          attributionControl: false,
          maxBounds: [
            [BOX.minLng - PAD, BOX.minLat - PAD],
            [BOX.maxLng + PAD, BOX.maxLat + PAD],
          ],
        });
        var rotate = opts.rotate !== false;
        if (!rotate) {
          made.dragRotate.disable();
          made.touchZoomRotate.disableRotation();
          if (made.keyboard && typeof made.keyboard.disableRotation === "function") made.keyboard.disableRotation();
        }
        el.appendChild(controls(made, words, rotate));
        var line = el.querySelector(".mapnojs");
        if (line) el.removeChild(line);
        Array.prototype.forEach.call(document.querySelectorAll(".mapfallback"), function (f) {
          f.classList.add("maplive");
        });
        el.classList.add("maplive");
        return made;
      })
      .catch(function (e) {
        if (made) {
          try {
            made.remove();
          } catch (ignored) {
            // already gone
          }
        }
        showNoMap(el, words);
        throw e;
      });
  }

  window.CatMap = {
    start: start,
    toMapLibreZoom: toMapLibreZoom,
    fromMapLibreZoom: fromMapLibreZoom,
    lib: function () {
      return lib;
    },
    readJson: readJson,
    lngLat: lngLat,
  };
})();

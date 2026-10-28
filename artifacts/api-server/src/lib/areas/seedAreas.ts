// Named areas (spec §3.3): each has one centre, and a place belongs to the
// area whose centre is nearest. This is version 1 of the list, approved on
// 15 Oct 2026. Since SYC-396 PR 2.4 the live list is the `named_areas` table,
// seeded from this one by migration `named_areas`, and the team edits it on
// the Areas page. This copy is the fallback before the first load and for any
// moment before 15 Oct 2026, and what the fixture tests use.

export interface NamedArea {
  key: string;
  name: string;
  lat: number;
  lng: number;
}

export const SEED_AREAS: readonly NamedArea[] = [
  // The first 7 are the town and village centres the old picture map used (namedAreas.test.ts pins them).
  { key: "ermoupoli", name: "Ermoupoli", lat: 37.4447, lng: 24.9417 },
  { key: "vaporia", name: "Vaporia", lat: 37.4447, lng: 24.9475 },
  { key: "kini", name: "Kini", lat: 37.4436, lng: 24.8889 },
  { key: "galissas", name: "Galissas", lat: 37.4226, lng: 24.8825 },
  { key: "finikas", name: "Finikas", lat: 37.3976, lng: 24.8783 },
  { key: "posidonia", name: "Posidonia", lat: 37.3889, lng: 24.8874 },
  { key: "azolimnos", name: "Azolimnos", lat: 37.4105, lng: 24.9594 },
  // Added villages: centres are the OpenStreetMap place nodes, looked up
  // through Nominatim on 15 Oct 2026 (never typed from memory).
  { key: "ano-syros", name: "Ano Syros", lat: 37.4501993, lng: 24.9357722 }, // OSM node 1844864373 (place=town)
  { key: "vari", name: "Vari", lat: 37.3983488, lng: 24.9467109 }, // OSM node 1846917012 (place=village)
  { key: "fabrika", name: "Fabrika", lat: 37.3919149, lng: 24.9528053 }, // OSM node 2684088129 (place=locality)
  { key: "manna", name: "Manna", lat: 37.4196393, lng: 24.947383 }, // OSM node 1846917017 (place=village)
  // Found under their Greek spellings (Χρούσα, Μέγας Γιαλός), checked 15 Oct 2026.
  { key: "mega-gialos", name: "Mega Gialos", lat: 37.3809687, lng: 24.9109853 }, // OSM node 2684084813 (place=village)
  { key: "chroussa", name: "Chroussa", lat: 37.4022955, lng: 24.9193522 }, // OSM node 1846917030 (place=village)
  // Added for coverage of the north and the inland west (adversarial review B1),
  // Nominatim 15 Oct 2026, Greek spellings. Guarded by namedAreas.coverage.test.ts.
  { key: "kampos", name: "Kampos", lat: 37.4938214, lng: 24.915293 }, // OSM node 2684101669 (place=hamlet)
  { key: "chalandriani", name: "Chalandriani", lat: 37.4847709, lng: 24.9357413 }, // OSM node 1846917029 (place=hamlet)
  { key: "syringas", name: "Syringas", lat: 37.4843924, lng: 24.9132138 }, // OSM node 2684101451 (place=hamlet)
  { key: "aetos", name: "Aetos", lat: 37.4727567, lng: 24.9021428 }, // OSM node 3434625183 (place=locality)
  { key: "lia", name: "Lia", lat: 37.489323, lng: 24.9019931 }, // OSM node 3434625179 (place=locality)
  { key: "grammata", name: "Grammata", lat: 37.4993396, lng: 24.8878902 }, // OSM node 2886089541 (place=locality)
  { key: "pagos", name: "Pagos", lat: 37.4166124, lng: 24.9052657 }, // OSM node 1846917022 (place=village)
  { key: "episkopio", name: "Episkopio", lat: 37.4367321, lng: 24.9179183 }, // OSM node 2684076935 (place=village)
];

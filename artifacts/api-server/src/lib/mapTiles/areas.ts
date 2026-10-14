import type { Position } from "./geometry";

// The island's main areas, as quick buttons under the team map (spec §3:
// "the list is configuration"). Town and village centres, the kind of
// position printed on any tourist map, never a feeding site. A button posts
// only the area's key; the server looks the position up here (plan K13).

export interface Area extends Position {
  key: string;
  label: string;
  zoom: number;
}

export const AREAS: readonly Area[] = [
  { key: "ermoupoli", label: "Ermoupoli", lat: 37.4447, lng: 24.9417, zoom: 15 },
  { key: "vaporia", label: "Vaporia", lat: 37.4447, lng: 24.9475, zoom: 16 },
  { key: "kini", label: "Kini", lat: 37.4436, lng: 24.8889, zoom: 15 },
  { key: "galissas", label: "Galissas", lat: 37.4226, lng: 24.8825, zoom: 15 },
  { key: "finikas", label: "Finikas", lat: 37.3976, lng: 24.8783, zoom: 15 },
  { key: "posidonia", label: "Posidonia", lat: 37.3889, lng: 24.8874, zoom: 15 },
  { key: "azolimnos", label: "Azolimnos", lat: 37.4105, lng: 24.9594, zoom: 15 },
];

export const areaByKey = (key: unknown): Area | undefined =>
  typeof key === "string" ? AREAS.find((a) => a.key === key) : undefined;

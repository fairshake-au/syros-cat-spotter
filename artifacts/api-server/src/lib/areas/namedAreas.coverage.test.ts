import { describe, expect, it } from "vitest";
import { areaFor, OFF_SYROS } from "./namedAreas";

// Spec §3.3: "every point on Syros falls into exactly one area". Real
// on-island points, looked up through Nominatim on 15 Oct 2026. If one of these
// comes out "Off Syros", a place on the island is being left out of every
// figure.
const POINTS: ReadonlyArray<[string, number, number]> = [
  ["Kampos (node 2684101669, place=hamlet)", 37.4938214, 24.915293],
  ["San Michalis church (way 321198272)", 37.451347, 24.935055],
  ["Chalandriani (node 1846917029, place=hamlet)", 37.4847709, 24.9357413],
  ["Kastri (node 3541480773, place=locality)", 37.4907357, 24.9340296],
  ["Syringas (node 2684101451, place=hamlet)", 37.4843924, 24.9132138],
  ["Aetos (node 3434625183, place=locality)", 37.4727567, 24.9021428],
  ["Lia (node 3434625179, place=locality)", 37.489323, 24.9019931],
  ["Grammata (node 2886089541, place=locality)", 37.4993396, 24.8878902],
  ["Varvarousa beach (way 339377739)", 37.4681758, 24.8964402],
  ["Island centroid (Nominatim relation 531999)", 37.4385, 24.9124],
];

describe("every real point on Syros is in a named area", () => {
  it.each(POINTS)("%s", (_label, lat, lng) => {
    expect(areaFor(lat, lng)).not.toBe(OFF_SYROS);
  });
});

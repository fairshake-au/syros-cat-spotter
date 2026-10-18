// Browser check for SYC-396 PR 1.5: loaded into the LOCAL server with
// `node --import`, so the server never reaches OpenStreetMap or anything else.
// Every outbound fetch is refused, except a map-tile fetch, which gets a
// stand-in 256px picture drawn here: sea blue, with the island's rough
// outline in land beige and a faint grid, so a dot can be checked on both.
// ST_FAIL=1 makes every map-tile fetch fail (the "pictures aren't loading" check).
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "../../../artifacts/api-server/package.json"));
const sharp = require("sharp");

const OUTLINE = [
  [37.515, 24.925], [37.5, 24.945], [37.48, 24.965], [37.462, 24.96], [37.448, 24.95],
  [37.437, 24.948], [37.42, 24.965], [37.405, 24.962], [37.393, 24.95], [37.38, 24.925],
  [37.373, 24.905], [37.378, 24.885], [37.392, 24.872], [37.41, 24.875], [37.425, 24.878],
  [37.44, 24.888], [37.455, 24.893], [37.47, 24.898], [37.49, 24.905], [37.508, 24.91],
];
const tx = (lng, z) => ((lng + 180) / 360) * 2 ** z;
const ty = (lat, z) => {
  const p = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(p) + 1 / Math.cos(p)) / Math.PI) / 2) * 2 ** z;
};

export const tileRequests = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  if (url.hostname === "tile.openstreetmap.org") {
    const [z, x, y] = url.pathname.replace(/\.png$/, "").split("/").filter(Boolean).map(Number);
    tileRequests.push(`${z}/${x}/${y}`);
    if (process.env.ST_FAIL === "1") return new Response("no", { status: 500 });
    const pts = OUTLINE.map(([lat, lng]) => `${((tx(lng, z) - x) * 256).toFixed(1)},${((ty(lat, z) - y) * 256).toFixed(1)}`).join(" ");
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">` +
      `<rect width="256" height="256" fill="#aad3df"/>` +
      `<polygon points="${pts}" fill="#f2efe9" stroke="#c9c2b0" stroke-width="2"/>` +
      `<path d="M0 0H256M0 0V256" stroke="#8fb8c4" stroke-width="1" fill="none" opacity="0.6"/>` +
      `</svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    return new Response(png, { status: 200, headers: { "content-type": "image/png", "content-length": String(png.length) } });
  }
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return realFetch(input, init);
  throw new Error(`browser check: outbound fetch refused (${url.hostname})`);
};

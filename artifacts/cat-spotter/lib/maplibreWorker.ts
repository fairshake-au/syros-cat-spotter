/**
 * SYC-705: where the website serves MapLibre's web worker.
 *
 * maplibre-gl 6 can't find its worker inside a Metro bundle (it looks next to
 * `import.meta.url`), so scripts/copy-maplibre-worker.js copies it into
 * public/maplibre/ and useMapLibre.web.ts points MapLibre at it with
 * setWorkerUrl(). The version in the name keeps a page and its worker on the
 * same release. The file name must match workerFileName() in that script
 * (lib/__tests__/maplibreWorker.test.ts checks).
 */

export function maplibreWorkerFile(version: string): string {
  return `maplibre-gl-worker-${version}.mjs`;
}

/** Site-root path of the worker for this MapLibre version. */
export function maplibreWorkerUrl(version: string): string {
  return `/maplibre/${maplibreWorkerFile(version)}`;
}

#!/usr/bin/env node
/**
 * SYC-133: write brotli (.br) and gzip (.gz) copies of the web export's text
 * files (the JS bundle, CSS, fonts...), so server/serve-web.js can send them
 * compressed without spending time compressing at request time. Brotli at
 * its best setting shrinks the 3.4 MB bundle to about 0.7 MB.
 *
 * Runs at the end of `build:web`, AFTER check-web-env.js has scanned dist/:
 * that check searches file contents, which it can't do inside compressed
 * copies. HTML is skipped: the server adds the loading screen to it per
 * request and compresses the result itself.
 *
 * Usage: node scripts/precompress-web.js [distDir]
 * Zero dependencies, Node.js built-ins only.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { COMPRESSIBLE_EXTENSIONS, MIN_COMPRESS_BYTES } = require('../server/serve-web');

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

/** Files to precompress: compressible types, big enough, not HTML. */
function candidates(distDir) {
  const out = [];
  for (const file of walk(distDir)) {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.html' || !COMPRESSIBLE_EXTENSIONS.has(ext)) continue;
    if (fs.statSync(file).size < MIN_COMPRESS_BYTES) continue;
    out.push(file);
  }
  return out;
}

async function precompress(distDir) {
  const files = candidates(distDir);
  let before = 0;
  let afterBr = 0;
  // zlib's async functions run on libuv's thread pool, so these overlap.
  await Promise.all(
    files.map(async (file) => {
      const data = fs.readFileSync(file);
      const [br, gz] = await Promise.all([
        brotli(data, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length,
          },
        }),
        gzip(data, { level: 9 }),
      ]);
      fs.writeFileSync(`${file}.br`, br);
      fs.writeFileSync(`${file}.gz`, gz);
      before += data.length;
      afterBr += br.length;
    }),
  );
  return { files: files.length, before, afterBr };
}

module.exports = { precompress, candidates };

if (require.main === module) {
  const distDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
  if (!fs.existsSync(distDir)) {
    console.error(`precompress-web: no ${distDir}; run expo export first.`);
    process.exit(1);
  }
  const started = Date.now();
  precompress(distDir)
    .then(({ files, before, afterBr }) => {
      const mb = (n) => (n / 1024 / 1024).toFixed(2);
      console.log(
        `precompress-web: ${files} files, ${mb(before)} MB -> ${mb(afterBr)} MB brotli (${((Date.now() - started) / 1000).toFixed(1)} s)`,
      );
    })
    .catch((error) => {
      console.error('precompress-web failed:', error);
      process.exit(1);
    });
}

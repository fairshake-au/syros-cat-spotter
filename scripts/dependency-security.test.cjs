const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const { test } = require('node:test');

// Resolve through actual consumer chains, so the tests exercise installed patches.
const mobile = createRequire(path.resolve(__dirname, '../artifacts/cat-spotter/package.json'));
const cli = createRequire(mobile.resolve('@expo/cli/package.json'));
const metro = createRequire(cli.resolve('@expo/metro/package.json'));
const fileMap = createRequire(metro.resolve('metro-file-map/package.json'));
const micromatch = createRequire(fileMap.resolve('micromatch/package.json'));
const braces = micromatch('braces');
const forge = cli('node-forge');

test('braces accepts ordinary patterns and ranges', () => {
  assert.deepEqual(braces.expand('cat-{a,b}-{1..3}'), [
    'cat-a-1', 'cat-a-2', 'cat-a-3', 'cat-b-1', 'cat-b-2', 'cat-b-3',
  ]);
  assert.equal(braces.compile('cat-{a,b}'), 'cat-(a|b)');
  assert.equal(braces.stringify(braces.parse('cat-{a,b}')), 'cat-{a,b}');
  assert.deepEqual(braces.expand('{'.repeat(20) + 'a,b' + '}'.repeat(20)), [
    '{'.repeat(19) + 'a' + '}'.repeat(19),
    '{'.repeat(19) + 'b' + '}'.repeat(19),
  ]);
});

test('braces rejects deeply nested balanced, unbalanced and parenthesis patterns', () => {
  const inputs = [
    '{'.repeat(3000) + 'a,b' + '}'.repeat(3000),
    '{'.repeat(3000) + 'a',
    '('.repeat(3000) + 'a' + ')'.repeat(3000),
  ];
  for (const input of inputs) {
    for (const operation of [braces, braces.parse, braces.compile, braces.expand, braces.stringify]) {
      assert.throws(() => operation(input), {
        name: 'SyntaxError', message: /maximum nesting depth/,
      });
    }
  }
});

test('all braces AST walkers reject deep or cyclic externally supplied ASTs', () => {
  let ast = { type: 'text', value: 'a' };
  for (let i = 0; i < 3000; i++) ast = { type: 'root', nodes: [ast] };
  const cycle = { type: 'root', nodes: [] };
  cycle.nodes.push(cycle);
  for (const operation of [braces.compile, braces.expand, braces.stringify]) {
    assert.throws(() => operation(ast), { name: 'SyntaxError', message: /maximum nesting depth/ });
    assert.throws(() => operation(cycle), { name: 'SyntaxError', message: /cyclic/ });
  }
});

test('forge rejects nested DigestAlgorithm garbage, with and without NULL parameters', () => {
  const { privateKey, publicKey } = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 3 });
  const md = forge.md.sha256.create().update('security regression');
  const digest = md.digest().getBytes();
  assert.equal(publicKey.verify(digest, privateKey.sign(md)), true);
  const { asn1 } = forge;
  const node = (type, constructed, value) =>
    asn1.create(asn1.Class.UNIVERSAL, type, constructed, value);
  for (const includeNull of [true, false]) {
    for (const includeGarbage of [false, true]) {
      const algorithm = [node(asn1.Type.OID, false, asn1.oidToDer(forge.oids.sha256).getBytes())];
      if (includeNull) algorithm.push(node(asn1.Type.NULL, false, ''));
      if (includeGarbage) algorithm.push(node(asn1.Type.OCTETSTRING, false, 'unconsumed garbage'));
      const info = node(asn1.Type.SEQUENCE, true, [
        node(asn1.Type.SEQUENCE, true, algorithm),
        node(asn1.Type.OCTETSTRING, false, digest),
      ]);
      const signature = privateKey.sign(asn1.toDer(info).getBytes(), 'NONE');
      if (includeGarbage) {
        assert.throws(() => publicKey.verify(digest, signature), /valid RSASSA-PKCS1-v1_5 DigestInfo/);
      } else {
        assert.equal(publicKey.verify(digest, signature), true);
      }
    }
  }
  const otherDigest = forge.md.sha256.create().update('different message').digest().getBytes();
  assert.equal(publicKey.verify(otherDigest, privateKey.sign(md)), false);
});

test('nyc YAML loading still works after removing argparse v1 and sprintf-js', async () => {
  const reactNative = createRequire(mobile.resolve('react-native/package.json'));
  const babelJest = createRequire(reactNative.resolve('babel-jest/package.json'));
  const istanbul = createRequire(babelJest.resolve('babel-plugin-istanbul/package.json'));
  const nyc = istanbul('@istanbuljs/load-nyc-config');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nyc-security-'));
  try {
    await writeFile(path.join(dir, '.nycrc.yaml'), 'all: true\ninclude:\n  - "src/**/*.js"\n');
    const config = await nyc.loadNycConfig({ cwd: dir });
    assert.equal(config.all, true);
    assert.deepEqual(config.include, ['src/**/*.js']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// SYC-527 piece 3: the looks-like model runs inside the API server.
// Resolve through the real consumer chain (api-server -> transformers -> ...).
// Several of these packages don't export ./package.json, so go by directory.
const fs = require('node:fs');
const apiDir = path.resolve(__dirname, '../artifacts/api-server');
const dirOf = (fromDir, name) => fs.realpathSync(path.join(fromDir, 'node_modules', name));
const pkgJson = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
// A package's own dependencies sit beside it in pnpm's store, not inside it.
const siblingDir = (dir, name) => {
  let up = dir;
  while (path.basename(path.dirname(up)) !== 'node_modules') up = path.dirname(up);
  return fs.realpathSync(path.join(path.dirname(up), name));
};

test('the model runtime is pinned exactly and onnxruntime-node is the version transformers asks for', () => {
  const own = pkgJson(apiDir);
  assert.equal(own.dependencies['@huggingface/transformers'], '3.7.5');
  assert.equal(own.dependencies['onnxruntime-node'], '1.21.0');
  const transformersDir = dirOf(apiDir, '@huggingface/transformers');
  const transformers = pkgJson(transformersDir);
  assert.equal(transformers.version, '3.7.5');
  assert.equal(transformers.dependencies['onnxruntime-node'], '1.21.0');
  // One copy of onnxruntime-node: transformers resolves the same folder we do.
  assert.equal(siblingDir(transformersDir, 'onnxruntime-node'), dirOf(apiDir, 'onnxruntime-node'));
  assert.equal(pkgJson(dirOf(apiDir, 'onnxruntime-node')).version, '1.21.0');
});

test('onnxruntime-node ships its compiled part, so its install script (a CUDA download) is not needed', () => {
  const dir = dirOf(apiDir, 'onnxruntime-node');
  for (const platform of ['linux/x64', 'darwin/arm64']) {
    assert.ok(
      fs.existsSync(path.join(dir, 'bin/napi-v3', platform, 'onnxruntime_binding.node')),
      `${platform} binary is inside the package`,
    );
  }
  // The workspace must not grant it a build step: the only thing it would do is fetch CUDA binaries.
  const workspace = fs.readFileSync(path.resolve(__dirname, '../pnpm-workspace.yaml'), 'utf8');
  const allowlist = workspace.split('onlyBuiltDependencies:')[1].split(/\n\S/)[0];
  assert.doesNotMatch(allowlist, /onnxruntime-node/);
});

test('transformers uses the app\'s own sharp (one libvips per process, no sharp 0.34 advisories)', () => {
  // transformers asks for sharp ^0.34; pnpm-workspace.yaml overrides it to the app's version.
  const ours = dirOf(apiDir, 'sharp');
  const theirs = siblingDir(dirOf(apiDir, '@huggingface/transformers'), 'sharp');
  assert.equal(theirs, ours);
  assert.equal(pkgJson(ours).version, '0.35.5');
});

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

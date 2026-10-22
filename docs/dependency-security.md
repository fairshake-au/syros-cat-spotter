# Dependency security fixes

## Published updates

Compatible security releases replace the affected versions of proxy-addr,
js-yaml, fast-uri, source-map-js, brace-expansion (all three major lines),
http-cache-semantics, undici (both major lines), sharp, compression, markdown-it,
ip-address, Vitest and its mocker, and fast-copy.

The existing workspace override map and platform exclusions are preserved.
The one-day minimum release age remains enabled.

`@istanbuljs/load-nyc-config` already calls `js-yaml.load()`, so it can use
js-yaml 4.3.2 without source changes. This removes its old argparse dependency
and the vulnerable sprintf-js dependency rather than masking the finding.

## Unreleased upstream fixes

Two advisories have no fixed release at the time of this change:

| Dependency | Advisory | Applied mitigation |
| --- | --- | --- |
| node-forge 1.4.0 | GHSA-86w9-cpqp-85rv | Reject extra children in the nested RSA DigestAlgorithm sequence. |
| braces 3.0.3 | GHSA-vfj7-8cjw-p6xm | Bound parser nesting and validate AST depth/cycles iteratively before recursive walkers. |

These are real source patches installed by pnpm's `patchedDependencies`, not
advisory ignores or renamed dependencies. The lockfile records their hashes.
Installations must use pnpm and retain the patch files.

The forge change follows the proposed upstream fix:
https://github.com/digitalbazaar/forge/pull/1152

The braces patch rejects patterns nested to 128 levels and rejects ASTs deeper
than 128 levels, using a deliberate SyntaxError before recursive processing.
Normal patterns and ranges are unchanged. Externally supplied ASTs with cyclic
or repeated child nodes are rejected; parent and previous-node links are not
traversed.

**Audit limitation:** an unfiltered `pnpm audit` still reports these two high
findings because it checks upstream package versions, not installed source
patches. No audit ignore is configured. All other 41 original findings are
removed. Replace each patch with an upstream fixed release when available.

## The looks-like model (SYC-527 piece 3)

`@huggingface/transformers` 3.7.5 and `onnxruntime-node` 1.21.0 run the
DINOv2 model inside the API server, both pinned exactly.

- **sharp:** transformers asks for sharp ^0.34, which carries three high
  advisories (libvips, libheif, librsvg). `pnpm-workspace.yaml` overrides
  `@huggingface/transformers>sharp` to the app's own 0.35.5, so the server has
  one sharp and one libvips per process and the advisories are gone.
- **onnxruntime-node build step:** not allowed on purpose. Its install script
  only downloads optional CUDA binaries on linux-x64; the linux-x64 and
  darwin-arm64 binaries we use ship inside the package.
- **Accepted, no fix released:**

| Dependency | Advisory | Path | Why it is not reachable at run time |
| --- | --- | --- | --- |
| sprintf-js 1.1.3 (moderate, unbounded precision DoS) | GHSA id 1241202 in `pnpm audit` | api-server > onnxruntime-node > global-agent > roarr > sprintf-js | Only onnxruntime-node's install script loads global-agent (proxy support for the CUDA download). The server never imports it, and no format string from a request reaches it. |

## Verification

Run `pnpm run test:dependency-security` after installs or dependency changes.
It resolves dependencies through their real Expo/Metro consumers and tests:

- Ordinary brace compilation, expansion, stringification and nesting.
- Balanced, unbalanced and parenthesis depth attacks.
- Deep and cyclic externally supplied ASTs for all three recursive walkers.
- Valid RSA signatures and malicious nested DigestAlgorithm sequences, with
  and without NULL parameters, using a low-exponent RSA key.
- Actual NYC YAML configuration loading after the js-yaml major update.
- The model runtime: exact pins, one onnxruntime-node, no build step for it,
  and transformers sharing the app's sharp.

Also run the API/mobile tests and typechecks, and a real Expo export to verify
that dependency changes preserve asset bundling.

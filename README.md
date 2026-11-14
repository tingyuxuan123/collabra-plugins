# Collabra Market

An independent, human-curated plugin market for [Collabra](https://github.com/tingyuxuan123/EnsoCode).
The repository contains original publisher code, plugin sources, a deterministic packager,
an Ed25519 signer and a static GitHub Pages catalog.

- Site: <https://tingyuxuan123.github.io/collabra-plugins/>
- Raw mirror: `https://raw.githubusercontent.com/tingyuxuan123/collabra-plugins/dist/v1/`
- Contract: [SPEC.md](SPEC.md)
- First plugin: [`collabra.paper`](plugins/collabra.paper) — a palette-only neutral theme

This is a source repository and CI pipeline. It is not a hosted account service, has no
upload backend, no ratings, no install counters and no automatic upstream mirroring.

## Trust model

- The signed index is UTF-8 JSON at `v1/index.json`; `v1/index.json.sig` is the base64
  Ed25519 signature over those exact bytes.
- The pinned public key is [market-public-key.pem](market-public-key.pem). Its SPKI
  SHA-256 fingerprint is `731611380199cd338bbb3fcde8ef6f8bf9d7085c56ebe45374af057591f55bd4`.
- `schemaVersion` is `2`, `marketId` is `collabra`, and every version carries a complete
  `compatibility` block for host `collabra`, market API `1`.
- `sequence` increases with each publication. Clients reject older indexes.
- A published `(plugin, version)` keeps its package bytes, permissions and compatibility
  forever. Repairs ship as a new version; delisting only removes the index entry.
- The private key is never in this repository. Pull-request jobs have read-only tokens and
  no secrets. Production signing happens in a dedicated job whose only secret-bearing step
  is the signing command.
- CI validates structure, packaging, signatures and history; it does **not** assign or
  enforce plugin `tier`. `official` is a curation decision requiring maintainer review.
  Enforcement depends on protecting `main` and requiring CODEOWNERS review, not on a CI
  check that could block a community plugin from setting its own tier.
- The root MIT license covers the market publisher code and the bundled `collabra.paper`
  theme. Each third-party plugin is governed by the license shown on its catalog entry.

## Layout

```text
plugins/<id>/
  market.json                 # listing metadata + compatibility per version
  versions/<version>/
    enso-plugin.json          # Collabra plugin manifest (schemaVersion 1)
    README.md                 # shipped inside the ZIP and mirrored per version
    LICENSE
    ...                       # self-contained plugin files, no node_modules
scripts/
  lib/                        # path/schema checks, ZIP writer+CRC32, Ed25519, publish logic
  build-market.mjs            # verify history, merge sources, deterministic packages, site
  sign-market.mjs             # re-verify history, then sign exact index bytes
  verify-build.mjs            # verify unsigned or signed output
  validate-source.mjs         # read-only source validation
  check-secrets.mjs           # reject committed private keys and verify the pinned key
  keygen.mjs                  # Ed25519 key pair, private key 0600, never printed
web/                          # static catalog (no framework, relative URLs)
.github/workflows/
  validate.yml                # pull_request: read-only, no secrets
  publish.yml                 # main: build -> sign -> dist branch + Pages
```

`dist` is a separate branch containing only `v1/`. It is the raw mirror; Pages deploys the
same generated tree from the workflow artifact. `build/` and `out/` are never committed.
Each signed generation also keeps `v1/history/<sequence>.json(+.sig)` index snapshots and
`v1/history/<sequence>.ledger.json(+.sig)` artifact ledgers, so delisted packages and old
version READMEs stay hash-protected.

## Local commands

Node.js 22 or newer is required. There are no runtime or development dependencies.

```bash
npm test                       # node --test: schema, ZIP, crypto, publication, site
npm run validate               # validate plugin sources without executing plugin code
npm run check:secrets          # reject committed private keys; verify pinned public key
npm run build                  # unsigned build into build/ (history from .dist-history)
node scripts/verify-build.mjs --out build
```

`npm run build` never reads a private key. To test the full signing path locally, generate
a throwaway key pair outside the repository and opt in explicitly:

```bash
node scripts/keygen.mjs --dir /tmp/collabra-test-keys
node scripts/build-market.mjs \
  --history /tmp/empty-history \
  --out /tmp/collabra-build \
  --public-key /tmp/collabra-test-keys/market-public-key.pem \
  --allow-test-key
node scripts/sign-market.mjs \
  --out /tmp/collabra-build \
  --history /tmp/empty-history \
  --key /tmp/collabra-test-keys/market-private-key.pem \
  --public-key /tmp/collabra-test-keys/market-public-key.pem \
  --allow-test-key
node scripts/verify-build.mjs --out /tmp/collabra-build --signed \
  --public-key /tmp/collabra-test-keys/market-public-key.pem --allow-test-key
```

Never point local builds at `build/`, `out/` or `.dist-history/` and commit the result.
`--allow-test-key` is never used by a production workflow.

## Add or update a plugin

1. Create `plugins/<reverse.domain.id>/market.json` and
   `plugins/<id>/versions/<x.y.z>/` with `enso-plugin.json`, `README.md` and a license.
2. Set `compatibility` in `market.json`:

```json
{
  "host": "collabra",
  "apiVersion": 1,
  "minAppVersion": "0.2.80",
  "platforms": ["darwin", "win32", "linux"],
  "testedSurfaces": []
}
```

`maxAppVersion` is optional and inclusive. `testedSurfaces` may contain only `code`, `bot`,
`image-studio`, `taskboard`, `design` and `settings`, and only when that surface was actually
verified. Palette support is not surface verification. Empty is honest.

3. Run `npm test` and `npm run validate`, then open a pull request. CI rebuilds against the
   signed `dist` history, so a changed file under an already-published version fails before
   review. To ship a fix, add a new version directory and a new `market.json` entry.
4. Do not execute plugin entry points during review. Packages are data; `npm install` and
   lifecycle scripts are never run.

Packages are bounded to 5000 files / 200MB. The publisher rejects symlinks, hard links,
native `.node` modules, other special files, hidden files, `node_modules`, nested ZIPs and
path escapes. ZIP timestamps, order and permissions are fixed, so identical input produces
identical bytes.

## Install

**Recommended: install from the in-app Collabra market.** A market install records the
`marketId` and can receive later market updates.

### Local ZIP installation

The ZIP download from this website is a **local ZIP source**. It requires manual updates and
does not receive market updates. The steps below are the local-ZIP path:

1. Download the version ZIP from the catalog.
2. In Collabra, open **扩展 / Extensions → 添加扩展 / Add extension → 从 ZIP 安装**.
3. Review the manifest, compatibility and permission summary; confirm to install and enable.
4. For a theme, open the theme picker and select the plugin theme.

Current Collabra does not support cross-source migration that preserves plugin data. Do not
treat uninstalling and reinstalling as a lossless migration path.

The catalog does not invent a URL scheme and does not bypass Collabra's install confirmation.
For an older compatible version, use that version's own README (`readmes/<id>/<version>.md`);
the index-level README is the newest version's README and must not be presented as if it
belonged to an older selected version.

## Delisting and rollback

Set `"delisted": true` in `plugins/<id>/market.json` and merge. The next generation stops
indexing the plugin for new installs/updates, while every historical ZIP and README remains
in `dist`. To roll back a bad new version, delist the plugin or publish a newer fixed version;
never rewrite or delete an old ZIP, and never decrement `sequence`.

## License

The market publisher and the bundled `collabra.paper` theme are original work released under
the root [MIT License](LICENSE). Third-party plugins require an explicit redistribution
license and reviewed vendored files; automated external downloads are out of scope for v1.

See [docs/PUBLISHING.md](docs/PUBLISHING.md) for the maintainer runbook.

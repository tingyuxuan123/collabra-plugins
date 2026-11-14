# Collabra curated market v1 — implementation contract

## Scope

An independent, public GitHub-PR curated registry, deterministic packages, signed index,
and a static GitHub Pages catalog. Reuse the desktop plugin runtime and ZIP installer;
do not copy upstream plugin code, artwork, branding or signing keys. No accounts,
payments, ratings, online upload backend, theme studio or automatic upstream mirroring
in v1. External plugins may be included only as reviewed vendored files with explicit
origin commit and redistribution license; automated external downloads are deferred.

Repository: `tingyuxuan123/collabra-plugins`, default branch `main`.
Pages base: `https://tingyuxuan123.github.io/collabra-plugins/`.
Client mirror bases are the Pages `v1/` and this repository's `dist/v1/` on GitHub raw
(optional jsDelivr mirror). These are mirrors of ONE market, not independent markets.

## Signed index

The index is UTF-8 JSON; the `.sig` file is a base64 Ed25519 signature over its exact
bytes. The pinned SPKI key is `market-public-key.pem`; private keys must never enter
this repository. Production signing secret: `COLLABRA_MARKET_PRIVATE_KEY`.

```json
{
  "schemaVersion": 2,
  "marketId": "collabra",
  "sequence": 1,
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "plugins": [{
    "id": "collabra.paper",
    "name": "Collabra Paper",
    "description": "Original neutral theme",
    "tier": "official",
    "category": "themes",
    "tags": ["theme"],
    "license": "MIT",
    "versions": [{
      "version": "1.0.0",
      "permissions": [],
      "path": "packages/collabra.paper/1.0.0.zip",
      "sha256": "<64 lowercase hex>",
      "size": 1234,
      "compatibility": {
        "host": "collabra",
        "apiVersion": 1,
        "minAppVersion": "0.2.80",
        "platforms": ["darwin", "win32", "linux"],
        "testedSurfaces": []
      }
    }]
  }]
}
```

`sequence` is a non-negative safe integer, incremented per publication; same-version
package bytes are immutable. A published version's compatibility cannot silently
change either. Optional `maxAppVersion` is inclusive; no arbitrary semver ranges in
this compatibility block. `apiVersion` must match the client's supported market API
(initially 1). App versions are strict three-integer release versions. Invalid or
missing v2 compatibility is rejected, not treated as compatible. The client selects
the newest compatible version, not blindly the newest published version.

`testedSurfaces` enumerates actual verified coverage only: `code`, `bot`,
`image-studio`, `taskboard`, `design`, `settings`. It does not grant capabilities.
An empty list is honest and allowed for an initial release. Palette support and
decorative coverage must not be conflated. Existing index fields (optional bounded
README path/hash/size, HTTPS homepage/screenshots) may be used unchanged.

Output layout: `v1/index.json`, `v1/index.json.sig`,
`v1/packages/<id>/<version>.zip`, optional versioned README and local media files.
Catalog may offer download and instructions for local ZIP installation; do not
invent unregistered app URL protocols.

## Client trust, identity and migration

The active/default market becomes `collabra`, trusting ONLY the new public key.
No silent fallback to the upstream market or upstream built-in index/public key.
Retain all signature, SHA-256, bounded download, HTTPS/DNS pinning and archive checks.
Cache, built-in index and anti-rollback sequence are scoped to market identity.
Changing a mirror URL must not change identity or erase anti-rollback state.

New market installs persist `{kind:'market', marketId:'collabra', id, version?}` in
Main's authoritative plugin source. Historic records without `marketId` mean the
old upstream market (`enso`), NOT the new active market. Unknown explicit IDs fail
closed for updates while installed plugins remain usable. Do not let local/ZIP/URL
plugins receive automatic updates merely because an ID exists in the new catalog.
Old market installs are retained without mutation or automatic cross-source update;
explain that a reviewed explicit reinstall is needed to adopt the Collabra source.

Client IPC remains typed and renderer never supplies arbitrary URLs or disk paths
for market installation. The market ID comes from Main's configured active registry.
Reinstall/update of an installed plugin from a different market/source must not
silently claim that installation or overwrite its source, even when permissions
are unchanged. Require explicit installation confirmation with source information,
and fail closed on unattended cross-source updates.

## Publication safety

PR validation runs without secrets and with read-only token permissions. Do not
execute submitted plugin entry points, lifecycle scripts or `npm install` in plugin
directories. Packages must be self-contained in v1. Limit entries/bytes; reject
symlinks, native `.node`, path escapes, bad IDs/versions and unknown compatibility.
Metadata tier changes and workflow/scripts/key changes need maintainer review.

Protected main merges trigger test/build/sign/publication; signing credentials are
present only in the signing step, never in PR jobs. Preserve previous immutable
packages and signed index history, increment sequence and serialize publication.
Deploy the static site and signed artifacts to Pages, with artifacts also committed
to `dist` for a separately readable mirror. Signatures and index must be from the
same generation. Revoking an index entry stops new installs/updates, not silently
deleting existing user installations. Never rewrite an old ZIP under its version.

## Acceptance

- RED/GREEN tests for parsing, compatibility, integrity, immutable publication,
  source identity, old-record migration and anti-rollback isolation.
- Publisher output verifies in the desktop client using only the production public key.
- A clean profile can list, download, install, disable and uninstall the original theme.
- Legacy installed plugins remain intact and cannot auto-update from the new market.
- Public Pages and raw mirrors serve matching index/signature; public repo contains
  no signing private key, token, unrelated app changes or copied unlicensed assets.

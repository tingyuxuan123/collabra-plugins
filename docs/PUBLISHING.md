# Publishing runbook

This runbook is for maintainers. It describes the production path only. Pull requests are
validated without secrets; do not add signing keys to PR jobs or repository files.

## One-time setup

1. The pinned public key must remain [market-public-key.pem](../market-public-key.pem).
   Verify its SPKI SHA-256 fingerprint:

   ```bash
   node -e "const {createPublicKey,createHash}=require('crypto');const fs=require('fs');const d=createPublicKey(fs.readFileSync('market-public-key.pem')).export({type:'spki',format:'der'});console.log(createHash('sha256').update(d).digest('hex'))"
   ```

   Expected: `731611380199cd338bbb3fcde8ef6f8bf9d7085c56ebe45374af057591f55bd4`.

2. Store the matching unencrypted Ed25519 PKCS#8 PEM private key only as the repository secret
   `COLLABRA_MARKET_PRIVATE_KEY`. Never paste it into an issue, log, commit or artifact.
   The `sign` job exposes it only to the `Sign index and re-verify history` step.

3. Pages is configured with **Source: GitHub Actions**. The workflow uses
   `actions/configure-pages`, `upload-pages-artifact` and `deploy-pages`, and requests only
   the `pages: write` and `id-token: write` permissions it needs in the publish job.

4. The `dist` branch is created automatically on the first publication. It contains only
   `v1/` so the raw mirror is
   `https://raw.githubusercontent.com/tingyuxuan123/collabra-plugins/dist/v1/`.
   Protect both `main` and `dist`: require review for `main`, and disallow force pushes and
   deletion for `dist`. `sequence` is the anti-rollback high-water mark, so a rewound `dist`
   branch would also rewind the publisher's view of history.

   **Tier approval is not a CI check.** CI validates schema, permissions, packaging,
   signatures and history, but it cannot know whether `official` is justified. Configure
   branch protection so `main` requires CODEOWNERS approval; CODEOWNERS only requests
   review. Without that branch protection, a PR could still merge with `"tier": "official"`.
   Maintainers must review every tier change and every plugin addition.

5. Every signed generation writes:
   - `v1/history/<sequence>.json` + `.json.sig` — exact signed index snapshot;
   - `v1/history/<sequence>.ledger.json` + `.ledger.json.sig` — signed ledger of every
     package/version/README ever published, including delisted artifacts.

   The next build verifies all snapshots and ledgers before copying anything. Missing
   snapshots, extra unverified files, changed delisted ZIPs or changed old READMEs stop the
   build. The signing step repeats the checks against the copied output and signs a new
   ledger. If history files are lost, restore them from the previous `dist` commit; do not
   delete files or fabricate a new generation.

   Deleting the entire `v1/` tree would look like a first publication to a local checkout.
   The anti-rollback guarantee therefore also depends on `dist` branch protection and on
   never force-pushing an older commit. The workflow's publish step additionally refuses to
   move a checked-out `dist` branch backwards by sequence.

## Normal publication

1. Merge a reviewed PR to `main`.
2. `publish.yml` runs serially under the `collabra-market-publish` concurrency group:
   - **build** (no secrets): tests, source validation, secret scan, fetch + verify `dist`,
     deterministic build, artifact upload;
   - **sign** (key only in one step): re-fetch and re-verify `dist`, rebuild from reviewed
     source and `diff` against the build artifact, verify that no historical version
     field/bytes changed, sign the exact `index.json` bytes, self-verify, upload;
   - **publish**: verify the signed artifact again, commit `v1/` to `dist`, deploy the same
     artifact to Pages.
3. Confirm:
   - Pages catalog loads and shows the signature state and new sequence;
   - `https://raw.githubusercontent.com/tingyuxuan123/collabra-plugins/dist/v1/index.json`
     and `.sig` match the Pages copies byte-for-byte;
   - a clean Collabra profile lists, downloads, installs, disables and uninstalls
     `collabra.paper` using only the production public key;
   - an older installed upstream-market plugin remains intact and does not auto-update from
     this market.

## First publication from an empty history

If no `dist` branch exists, the build starts at `sequence: 1`. The workflow creates an
orphan `dist` branch, commits the complete `v1/` tree, then deploys Pages. There is no need
to pre-create artifacts or a release tag.

## Add a version

1. Copy the previous version directory to `plugins/<id>/versions/<new-version>/`.
2. Update `enso-plugin.json` `version` and the plugin contents.
3. Add `versions.<new-version>.compatibility` in `plugins/<id>/market.json`.
4. Optionally update the README. The index README follows the newest version.
5. Run `npm test`, `npm run validate`, then merge.

The build compares every historical source version with the signed history. Any byte,
permission or compatibility change under an old version aborts the build before signing.
New versions must be strictly greater than the history's newest version.

## Delist

Set `"delisted": true` in `plugins/<id>/market.json` and merge. The plugin disappears from
the new index; all old packages and READMEs remain in `dist` and under Pages. Do not delete
the source history directories; they document what was reviewed. Reverting the flag restores
the listing in a later generation.

Delisting does not remove the version from the signed artifact ledger. The next generation
still verifies the old ZIP, compatibility, permissions and per-version README hashes, so a
later re-listing cannot silently change them.

## License scope

The root MIT license applies to the market publisher code and the bundled `collabra.paper`
theme. It is not a blanket license for third-party plugins; the license shown on each
catalog entry governs that plugin.

## Key rotation or compromise

Key rotation requires a client release that trusts the new public key; v1 has one pinned
production key. If the private key is suspected compromised:

1. Stop merging/publishing immediately.
2. Treat every later signature as untrusted until the client pin is updated.
3. Generate a new pair with `node scripts/keygen.mjs --dir <private-location>`, replace the
   pinned public key in a reviewed client release, and update the GitHub secret.
   Update `PRODUCTION_KEY_FINGERPRINT` in `scripts/lib/constants.mjs` and
   `MARKET_PUBLIC_KEY_SPKI_B64` in `web/catalog.js` in the same reviewed change.
4. Do not attempt to rewrite `dist` history or lower `sequence`.

## Failure handling

- **Signature or hash failure**: do not bypass it. Inspect whether `dist` was rewritten,
  whether a historical `market.json` entry changed, or whether an artifact is missing.
- **Sequence/concurrency failure**: do not rerun the same generation manually with a lower
  sequence. Re-dispatch the workflow; the concurrency group serializes and increments from
  the latest verified `dist`.
- **Pages deploy failure**: the `dist` commit may already have advanced. Verify the raw
  mirror, fix the Pages configuration, then rerun. Clients reject stale sequences, so never
  force-push an older `dist`.
- **Signing secret missing**: the `sign` job fails before writing a signature. Build output
  is never published unsigned.

# Security

## Reporting

Please report security issues privately to the repository maintainers rather than opening a
public issue with exploit details. Include the affected plugin ID/version, index sequence,
and whether the issue is in the publisher, the ZIP format, the catalog page or a plugin.

## Trust boundaries

- The Ed25519 private key is held only in the GitHub secret
  `COLLABRA_MARKET_PRIVATE_KEY` and is exposed only to the signing step.
- The pinned public key and its SPKI SHA-256 fingerprint are part of the client trust root.
  A changed key requires a reviewed client release.
- Pull-request validation runs with a read-only token and no secrets. It never executes
  submitted plugin entry points, lifecycle scripts or `npm install`.
- A valid signature proves that this publisher signed a generation. It does not prove that a
  plugin is safe to run: plugin code runs with the host's plugin privileges after the user
  installs it.
- Historical package bytes and compatibility are immutable. `sequence` prevents rollback;
  delisting stops new installs/updates but does not delete history.

## Out of scope for v1

Accounts, payments, ratings, install counters, online uploads, automatic external plugin
mirroring, theme studios and Cloudflare-backed services are intentionally absent.

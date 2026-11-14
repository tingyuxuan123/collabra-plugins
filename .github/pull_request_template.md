## What changed

<!-- Plugin ID(s), version(s), and the user-visible behavior. -->

## Checklist

- [ ] I did not add a private key, token or other secret to the repository or workflow.
- [ ] New plugin files are original or have a documented redistribution license and a
      reviewed origin commit.
- [ ] `npm test`, `npm run validate` and `npm run check:secrets` pass locally.
- [ ] A new version was added instead of modifying a published version or its compatibility.
- [ ] `compatibility` is complete (`host`, `apiVersion`, `minAppVersion`, `platforms`,
      `testedSurfaces`) and does not use arbitrary semver ranges.
- [ ] `testedSurfaces` lists only surfaces that were actually verified; empty is acceptable.
- [ ] The package is self-contained, executes no plugin JS during review, and contains no
      `node_modules`, `.node` files, symlinks, hard links, hidden files or nested ZIPs.
- [ ] README instructions say to install the downloaded ZIP from Collabra's Extensions page,
      without inventing a URL scheme.

## Review notes

<!-- Anything maintainers should check: tier change, permissions, new workflow/scripts. -->

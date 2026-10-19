# Releasing

Releases use [Changesets](https://github.com/changesets/changesets) and a manually triggered workflow, the same setup as `ryaninvents/compare-branch`.

## Day to day

Add a changeset with each user-facing change and merge it to `main`:

```sh
pnpm changeset
```

## Cutting a release

Run the **release** workflow from the Actions tab (`gh workflow run release.yml`). It:

1. Runs `pnpm changeset version`, which consumes pending changesets, bumps `package.json`, and updates `CHANGELOG.md`.
2. Commits and pushes the bump to `main` (skipped when there are no changesets, e.g. the first `v0.1.0` release).
3. Runs `scripts/release.sh v<version>`, which:
   - runs `pnpm check` and `pnpm build`;
   - packs the npm tarball and publishes that exact file to npm (with provenance in CI);
   - renders `scripts/formula/polymodel.rb.ejs` against the registry tarball URL and its sha256;
   - creates the GitHub release `v<version>` with the tarball, `SHA256SUMS`, and `polymodel.rb`;
   - triggers `ryaninvents/homebrew-tap`'s `update-formula` workflow (`project=polymodel`), which copies `polymodel.rb` from the release into the tap.

`scripts/release.sh` also runs locally (`scripts/release.sh v0.1.0`) with a logged-in `npm` and `gh`. `POLYMODEL_SKIP_NPM=1` skips publishing to npm; `POLYMODEL_SKIP_TAP=1` skips the tap trigger.

## One-time setup

- **`NPM_TOKEN` secret**: an npm automation token for the first publish. After that, you can configure [trusted publishing](https://docs.npmjs.com/trusted-publishers) for `ryaninvents/polymodel` / `release.yml` on npmjs.com and delete the secret.
- **`HOMEBREW_TAP_TOKEN` secret**: a PAT that can dispatch workflows on `ryaninvents/homebrew-tap` (fine-grained: `actions: write`; classic: `workflow`). It can be the same token compare-branch uses.
- **Tap registration**: in `ryaninvents/homebrew-tap`, add `polymodel` to `projects.json`:

  ```json
  "polymodel": { "repo": "ryaninvents/polymodel", "formula": "polymodel.rb", "asset": "polymodel.rb" }
  ```

  and add `polymodel` to the `project` input's `options` in `.github/workflows/update-formula.yml`.

Users then install with `brew install ryaninvents/tap/polymodel`, and can run it in the background with `brew services start polymodel`.

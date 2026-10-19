#!/usr/bin/env bash
# Check, build, and publish @ryaninvents/polymodel to npm, then cut a GitHub
# release carrying the rendered Homebrew formula and trigger the tap update.
# Manually triggered — locally (`scripts/release.sh v0.1.0`) or via the release
# workflow. Requires pnpm, npm (logged in, or NODE_AUTH_TOKEN / trusted
# publishing in CI), and an authenticated gh CLI (GH_TOKEN in CI).
#
# POLYMODEL_SKIP_NPM=1   skip `npm publish`; the formula then installs from the GitHub release tarball
# POLYMODEL_SKIP_TAP=1   skip triggering the Homebrew tap update
set -euo pipefail

TAG="${1:-}"
[ -n "$TAG" ] || { echo "usage: $0 <tag>   e.g. $0 v0.1.0"; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REPO="ryaninvents/polymodel"
TAP="${POLYMODEL_HOMEBREW_TAP:-ryaninvents/homebrew-tap}"
PACKAGE="$(node -p "require('./package.json').name")"
VERSION="$(node -p "require('./package.json').version")"
STAGE="$ROOT/release-assets"

[ "$TAG" = "v$VERSION" ] || { echo "tag $TAG does not match package.json version $VERSION"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "working tree is dirty; commit or stash first"; exit 1; }
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "GitHub release $TAG already exists"; exit 1
fi

# The npm tarball is published as-is, so its sha256 is exactly what Homebrew
# downloads from the registry URL below. Without an npm publish the registry
# URL would 404, so the formula builds from the GitHub release asset instead.
tarball_url() {
  if [ "${POLYMODEL_SKIP_NPM:-0}" = "1" ]; then
    echo "https://github.com/${REPO}/releases/download/${TAG}/$(basename "$TARBALL")"
  else
    echo "https://registry.npmjs.org/${PACKAGE}/-/${PACKAGE#*/}-${VERSION}.tgz"
  fi
}

# Ask the tap repo's own workflow to fetch this release's polymodel.rb asset
# and commit it. The default GITHUB_TOKEN can't dispatch workflows in another
# repo, so CI must provide HOMEBREW_TAP_TOKEN (PAT/App token with `actions:
# write` — classic PAT: `workflow` — on the tap repo).
trigger_tap_update() {
  GH_TOKEN="${HOMEBREW_TAP_TOKEN:?HOMEBREW_TAP_TOKEN is required to trigger the tap update}" \
    gh workflow run update-formula.yml --repo "$TAP" -f project=polymodel
}

echo ">> checking (typecheck, lint, tests)"
pnpm check

echo ">> building"
pnpm build

echo ">> packing"
rm -rf "$STAGE"; mkdir -p "$STAGE"
pnpm pack --pack-destination "$STAGE" >/dev/null
TARBALL="$(ls "$STAGE"/*.tgz)"
( cd "$STAGE" && { shasum -a 256 ./*.tgz 2>/dev/null || sha256sum ./*.tgz; } > SHA256SUMS )
SHA256="$(awk '{ print $1 }' "$STAGE/SHA256SUMS")"

if [ "${POLYMODEL_SKIP_NPM:-0}" = "1" ]; then
  echo ">> skipping npm publish (POLYMODEL_SKIP_NPM=1)"
else
  echo ">> publishing $PACKAGE@$VERSION to npm"
  PUBLISH_FLAGS=(--access public)
  # Provenance attestations need the GitHub Actions OIDC token.
  [ "${GITHUB_ACTIONS:-}" = "true" ] && PUBLISH_FLAGS+=(--provenance)
  npm publish "$TARBALL" "${PUBLISH_FLAGS[@]}"
fi

echo ">> rendering Homebrew formula"
POLYMODEL_FORMULA_REPO="$REPO" \
POLYMODEL_FORMULA_VERSION="$VERSION" \
POLYMODEL_FORMULA_URL="$(tarball_url)" \
POLYMODEL_FORMULA_SHA256="$SHA256" \
  node "$ROOT/scripts/render-formula.mjs" > "$STAGE/polymodel.rb"

echo ">> creating GitHub release $TAG"
# Use this version's CHANGELOG section as the notes when there is one.
NOTES="$(awk -v v="## $VERSION" '$0 == v { found = 1; next } found && /^## / { exit } found' CHANGELOG.md 2>/dev/null || true)"
gh release create "$TAG" \
  --repo "$REPO" \
  --target "$(git rev-parse HEAD)" \
  --title "$TAG" \
  --notes "${NOTES:-Install: \`npm install -g $PACKAGE\` or \`brew install ryaninvents/tap/polymodel\`.}" \
  "$TARBALL" "$STAGE/SHA256SUMS" "$STAGE/polymodel.rb"

if [ "${POLYMODEL_SKIP_TAP:-0}" = "1" ]; then
  echo ">> skipping Homebrew tap update trigger (POLYMODEL_SKIP_TAP=1)"
else
  echo ">> triggering Homebrew tap update ($TAP)"
  trigger_tap_update
fi

echo ">> done"

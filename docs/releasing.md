# Releasing

## npm

```sh
pnpm version <patch|minor|major>
pnpm publish --access public   # prepublishOnly runs check + build
git push --follow-tags
```

## Homebrew

The formula lives in a separate tap repo, `ryaninvents/homebrew-tap`, at `Formula/polymodel.rb`. `packaging/homebrew/polymodel.rb` is the template.

After publishing to npm:

```sh
VERSION=$(node -p "require('./package.json').version")
URL="https://registry.npmjs.org/@ryaninvents/polymodel/-/polymodel-${VERSION}.tgz"
curl -sL "$URL" | shasum -a 256
```

Update `url` and `sha256` in the tap's formula, then check it:

```sh
brew install --build-from-source ryaninvents/tap/polymodel
brew test polymodel
brew audit --strict ryaninvents/tap/polymodel
```

Users install with `brew install ryaninvents/tap/polymodel` and can run it in the background with `brew services start polymodel`.

# Polymodel — agent notes

OpenAI-compatible server (Fastify) that merges several upstream LLMs into one model. Upstream calls use the Vercel AI SDK (v7). Published as `@ryaninvents/polymodel` (npm) and `polymodel` (Homebrew tap). Single developer laptop; state is in-memory.

## Layout

Single package, layered folders under `src/`. Cross-layer imports use the `#layer` subpath imports in `package.json` (never relative `../layer/...` paths across layers); same-layer imports are relative with `.ts` extensions.

| Layer        | Contents                                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `types`      | Zod schemas (OpenAI request, config, planner session) and the plugin contract (`Polymodel`, `PolymodelEvent`, …)                       |
| `util`       | `assertNever`, `sha256Hex` (Web Crypto)                                                                                                |
| `infra`      | env access (`createEnv`, the only place that reads env), pino logger, AI SDK provider resolver, config file loader + module alias hook |
| `data`       | `createMemoryStore` (TTL/LRU state store)                                                                                              |
| `domain`     | `createPolymodelService`, `forwardStream`, `definePolymodel`/`defineConfig`, `planner-executor/` (default polymodel)                   |
| `controller` | Fastify routes, OpenAI↔polymodel mappers, SSE encoding, error→HTTP mapping                                                             |
| `app`        | `composition.ts` (the only place dependencies are instantiated), `cli.ts`, default config                                              |

Public entry points: `src/plugin.ts` (`@ryaninvents/polymodel/plugin`, for configs and plugin authors) and `src/index.ts` (programmatic server).

## Dependency rules (flag violations in review)

- `types`, `util`, `infra` are horizontal; flow is `data → domain → controller → app`.
- `domain` never imports `controller`, `app`, Fastify, or Node-only APIs. It does import the AI SDK (`ai`): that's the chosen model abstraction and is part of the plugin API.
- `controller` never imports `data`; `data` never imports `domain`.
- Errors: domain throws subclasses from `domain/errors.ts`; `controller/toHttpError.ts` maps them to HTTP status codes. Plugin/upstream failures are wrapped in `PolymodelRunError`.

## Conventions

- `#layer` imports resolve to `src` via the custom `polymodel-source` condition (tsconfig, vitest, `pnpm dev`) and to `dist` otherwise. Don't rename the condition to `source`: dependencies (e.g. `eventsource-parser`) use that name.
- TypeScript is pinned to 6.x because typescript-eslint doesn't support 7 yet. `erasableSyntaxOnly` is on (no parameter properties or enums) so Node can run `src/` directly.
- Node is pinned to `.nvmrc` (24.19.0) via `engines`, `devEngines`, and `use-node-version` in `.npmrc`.
- Tests are co-located (`*.test.ts`); mock models and context helpers are in `src/domain/testing/`.
- Run `pnpm check` before finishing work; `pnpm format` applies Prettier and ESLint fixes.

## Releases

Changesets + manual `release` workflow → `scripts/release.sh` (npm publish, GitHub release with rendered Homebrew formula, tap trigger). Add a changeset (`pnpm changeset`) for user-facing changes. The formula template is `scripts/formula/polymodel.rb.ejs`. Details are in `docs/releasing.md`.

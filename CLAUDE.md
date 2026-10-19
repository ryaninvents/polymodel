# Polymodel — agent notes

OpenAI-compatible server (Fastify) that merges several upstream LLMs into one model. Upstream calls use the Vercel AI SDK (v7). Published as `@ryaninvents/polymodel` (npm) and `polymodel` (Homebrew tap). Single developer laptop; state is in-memory.

## Layout

Single package, layered folders under `src/`. Cross-layer imports use the `#layer` subpath imports in `package.json` (never relative `../layer/...` paths across layers); same-layer imports are relative with `.ts` extensions.

| Layer        | Contents                                                                                                                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types`      | Zod schemas (OpenAI request, config, planner session) and the plugin contract (`Polymodel`, `PolymodelEvent`, …)                                                                                                                                |
| `util`       | `assertNever`, `sha256Hex` (Web Crypto)                                                                                                                                                                                                         |
| `infra`      | env access (`createEnv`/`loadEnv`, the only place that reads env; layers `credentials.env` under `process.env`), pino logger, provider catalog + model resolver, config file loader + module alias hook, OpenRouter OAuth login, browser opener |
| `data`       | `createMemoryStore` (TTL/LRU state store)                                                                                                                                                                                                       |
| `domain`     | `createPolymodelService`, `forwardStream`, `definePolymodel`/`defineConfig`, `worker-bee/` (default polymodel), `shared/` (turn keys, call logging, tool-call rewriting, stall guard)                                                           |
| `controller` | Fastify routes, OpenAI↔polymodel mappers, SSE encoding, error→HTTP mapping                                                                                                                                                                      |
| `app`        | `composition.ts` (the only place dependencies are instantiated), `cli.ts`, default config, `setup/` (interactive `polymodel setup`, built on `@clack/prompts`)                                                                                  |

Public entry points: `src/plugin.ts` (`@ryaninvents/polymodel/plugin`, for configs and plugin authors) and `src/index.ts` (programmatic server).

## Dependency rules (flag violations in review)

- `types`, `util`, `infra` are horizontal; flow is `data → domain → controller → app`.
- `domain` never imports `controller`, `app`, Fastify, or Node-only APIs. It does import the AI SDK (`ai`): that's the chosen model abstraction and is part of the plugin API.
- `controller` never imports `data`; `data` never imports `domain`.
- Errors: domain throws subclasses from `domain/errors.ts`; `controller/toHttpError.ts` maps them to HTTP status codes. Plugin/upstream failures are wrapped in `PolymodelRunError`.

## Conventions

- `#layer` imports resolve to `src` via the custom `polymodel-source` condition (tsconfig, vitest, `pnpm dev:watch`) and to `dist` otherwise. Don't rename the condition to `source`: dependencies (e.g. `eventsource-parser`) use that name.
- TypeScript is pinned to 6.x because typescript-eslint doesn't support 7 yet. `erasableSyntaxOnly` is on (no parameter properties or enums) so Node can run `src/` directly.
- Node is pinned to `.nvmrc` (24.19.0) via `engines`, `devEngines`, and `use-node-version` in `.npmrc`.
- Providers are defined once in `infra/providerCatalog.ts` (AI SDK factory, label, API-key variable, key page, suggested models). Adding a provider type means a schema variant in `types/config.ts`, a catalog entry, and a `createModelProvider` case; setup and the built-in default pick it up from the catalog.
- Prefer AI SDK provider packages over hand-rolled clients. The only custom auth code is OpenRouter's OAuth PKCE flow (`infra/openRouterLogin.ts`), because no AI SDK package implements it. Anthropic and OpenAI only support API keys for third-party tools.
- `polymodel setup` writes nothing until every prompt is answered, keeps secrets in `credentials.env` (mode 600, referenced from the config via `{ env }`), and backs up a config it rewrites to `.bak`. The generated config must stay valid as plain JS (no type annotations) so setup can rewrite `.mjs`/`.js` configs.
- Tests are co-located (`*.test.ts`); mock models and context helpers are in `src/domain/testing/`.
- Worker-bee routing tests double as its spec: `ownership.test.ts` (task-id prefixes, who owns a message), `views.test.ts` (what planner and worker are shown), `workerBee.routing.test.ts` (what each model receives), `workerBee.state.test.ts` (delegation endings, queue, budgets, lost state), `workerBee.walkthrough.test.ts` (one turn across several requests). Assert on `summarizeCall()` output so expectations stay readable, and keep these files in sync when routing changes.
- Worker-bee tells planner and worker messages apart by rewriting worker tool-call ids to `pmwb_<taskId>_<upstreamId>` (`ownership.ts`); `worker_bee` and `report_back` are virtual tools that never reach the client. A finished delegation is collapsed to one `worker_bee` call/result pair in the planner's view, anchored at the history index where its batch started.
- Run `pnpm check` before finishing work; `pnpm format` applies Prettier and ESLint fixes.

## Releases

Changesets + manual `release` workflow → `scripts/release.sh` (npm publish, GitHub release with rendered Homebrew formula, tap trigger). Add a changeset (`pnpm changeset`) for user-facing changes. The formula template is `scripts/formula/polymodel.rb.ejs`. Details are in `docs/releasing.md`.

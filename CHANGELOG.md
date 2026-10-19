# @ryaninvents/polymodel

## 0.2.0

### Minor Changes

- f450ffc: Turn on Anthropic prompt caching for the `anthropic` and `openrouter` (Anthropic models) providers. Configure with `promptCaching: false` or `{ ttl: "5m" | "1h" }` per provider. The planner's final-round note now trails the conversation instead of changing the system prompt, so the cached prefix stays valid. Debug logs gain `instructionsHash`/`toolsHash` and `cacheWriteTokens`.
- f450ffc: Replace `polymodel init` with `polymodel setup`, an interactive command that creates a new install or updates an existing one. It lets you pick one or more providers (Anthropic, OpenRouter, OpenAI, or any OpenAI-compatible endpoint such as LiteLLM), log in to OpenRouter in the browser or paste API keys, and choose the planner/executor models. Keys are stored in `~/.config/polymodel/credentials.env`, which `serve` reads, so background services work without shell exports.
  
  Adds an `openrouter` provider type (via `@openrouter/ai-sdk-provider`).
  
  Breaking: `LITELLM_BASE_URL` and `LITELLM_API_KEY` are no longer read. Without a config file, polymodel now serves a `worker-bee` model on the first provider with an API key (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`); otherwise it asks you to run `polymodel setup`.
- f450ffc: Add `workerBee`, a delegating planner, and make it the default polymodel (model id `worker-bee`). The planner stays in control of the whole turn and hands small, scoped tasks to cheap worker models through a virtual `worker_bee` tool. Each task carries a structured brief; workers use the client's tools and report back. A worker that runs out of rounds, stalls or hits its output limit comes back to the planner as a result it can act on. Finished worker stretches are collapsed in the planner's view so its prompt prefix stays cacheable. Tune with `workerLimits`, `maxPlannerSteps`, `maxDelegations`, `followUpPlanner` and `workerSettings`.
  
  Breaking: `plannerExecutor` is removed, along with `maxPlannerRounds`, `executorSettings` and `PlannerExecutorOptions`. Replace `plannerExecutor({ planner, executor })` with `workerBee({ planner, worker })`. `POLYMODEL_EXECUTOR_MODEL` is now `POLYMODEL_WORKER_MODEL`, and `polymodel setup` asks for a worker instead of an executor (existing configs using `plannerExecutor` must be updated).

### Patch Changes

- f450ffc: Requests' `reasoning_effort` is now passed to upstream models, including through OpenRouter, whose AI SDK provider previously ignored it.
- Accept any Node.js 24.x (previously ≥ 24.19.0). The Homebrew formula now depends on `node@24` and runs polymodel through a wrapper that uses it, instead of whichever `node` is on `PATH`.
- f450ffc: Add detailed logging at `POLYMODEL_LOG_LEVEL=debug` and `trace`: request summaries, planner/worker call lifecycle (timing to first event, usage, finish reason), client disconnects, and per-event traces. Upstream failures now log which stage and model failed, plus the full cause chain including the provider's error payload (status code, response body), which was previously lost. Plugin loggers gain a `trace` method.

# Polymodel

Merge several LLMs into one OpenAI-compatible model. The default polymodel, `worker-bee`, has a strong model (Opus) lead the work and delegate small, scoped tasks to a fast one (Haiku), but clients see a single model streaming a single response.

```
client ──▶ polymodel (:4100) ──▶ Anthropic / OpenRouter / OpenAI / any OpenAI-compatible endpoint (LiteLLM, vLLM, …)
                         │
                         ├─ planner (e.g. Opus): talks to the user, uses the client's tools, delegates
                         └─ workers (e.g. Haiku): carry out delegated tasks with the client's tools
```

## Install

```sh
npm install -g @ryaninvents/polymodel   # or: brew install ryaninvents/tap/polymodel
polymodel setup                         # pick providers, log in, choose models
polymodel                               # serves http://127.0.0.1:4100/v1
```

Requires Node.js 24.

## Setup

`polymodel setup` is interactive. It asks for:

1. **Providers** (at least one): Anthropic, OpenRouter, OpenAI, and/or any OpenAI-compatible endpoint (LiteLLM, vLLM, Ollama, …; you give it a name and base URL).
2. **Credentials** for each provider:
   - **OpenRouter**: log in with the browser. Setup runs OpenRouter's OAuth flow and receives a new API key.
   - **Anthropic / OpenAI**: paste an API key. Setup can open the provider's key page for you. These providers don't offer a browser login for third-party tools.
   - Or point at an environment variable you manage yourself.
3. **Models**: the model id clients request, plus the planner and worker references (`<provider>:<model>`), with suggestions for each provider.

Run it again to update an install. It detects the existing config and pre-fills your previous choices. You can either update credentials only (the config file isn't touched) or redo providers and models (the old config is saved as `config.ts.bak`). Nothing is written if you cancel partway through.

Setup writes two files in `~/.config/polymodel/` (or `$XDG_CONFIG_HOME/polymodel/`):

- `config.ts`: the config (see [Configuration](#configuration)). With `--config` or `$POLYMODEL_CONFIG`, setup updates that file instead.
- `credentials.env`: API keys, readable only by you. The config references keys by variable name (`apiKey: { env: "ANTHROPIC_API_KEY" }`). At startup, polymodel reads `credentials.env`, and variables set in the environment take precedence. This means `brew services`, which doesn't load your shell profile, still finds the keys.

Without a config file, polymodel serves one model, `worker-bee`, on the first provider whose key is available (`ANTHROPIC_API_KEY`, then `OPENROUTER_API_KEY`, then `OPENAI_API_KEY`). It uses that provider's suggested planner/worker models unless `$POLYMODEL_PLANNER_MODEL` / `$POLYMODEL_WORKER_MODEL` are set (bare model ids, e.g. `claude-sonnet-5-5`).

## Using it behind LiteLLM

Polymodel is an OpenAI-compatible upstream, so a LiteLLM proxy (or any other gateway) can expose it next to other models:

```yaml
model_list:
  - model_name: worker-bee
    litellm_params:
      model: openai/worker-bee
      api_base: http://127.0.0.1:4100/v1
      api_key: unused # or the value of server.apiKey
```

Polymodel can also call back into the same LiteLLM proxy for its upstream models: pick "OpenAI-compatible endpoint" in setup and use LiteLLM's model names (e.g. `litellm:claude-opus-5-5`).

## How the default polymodel behaves

`worker-bee` keeps the planner in control of the whole turn. The planner answers the user, uses the client's tools itself, and hands work to cheap workers through a `worker_bee` tool.

- **Delegations are small and scoped.** Each `worker_bee` call carries a structured brief: `goal`, `context`, `files`, `decisions` already made, `done_when`, optionally `out_of_scope` and `max_rounds`. An invalid brief never reaches a worker; the planner gets an error naming the bad fields.
- **Workers use the client's tools.** `worker_bee` is virtual: the client never sees it. A worker's tool calls are returned to the client under ids prefixed `pmwb_<taskId>_`, and the client echoes them back, which is how polymodel tells planner and worker messages apart without server state. A worker that needs five tool rounds spans five requests.
- **Workers see only their brief and their own tool rounds**, not the user's conversation. They stream as reasoning (`reasoning_content`) so you can follow progress; only the planner's text is the answer.
- **Workers report back** through a virtual `report_back` tool (`done`, `blocked` or `failed`, with a summary and changed files). Text without a `report_back` call counts as a `done` report.
- **Failures return to the planner as results.** A worker that runs out of rounds (`workerLimits.maxRounds`, default 8, or `max_rounds` in the brief), stalls (no text or tool call for `stallMs`, default 60 s: it is aborted), or hits its output limit produces a report the planner can act on: re-scope, add context, or do the step itself.
- **Workers act instead of deliberating.** They run at `low` reasoning effort regardless of the client's `reasoning_effort`, with output capped at `workerLimits.maxOutputTokens` (default 4,096). `workerSettings` overrides these.
- **The planner's context stays small and cacheable.** Finished worker stretches are replaced, in the planner's view, by one `worker_bee` call and its report, so its prompt prefix doesn't change as the turn grows.
- **Budgets.** `maxPlannerSteps` (default 40) and `maxDelegations` (default 12) per user turn; when either runs out the planner is told to answer now.
- `followUpPlanner` optionally uses a cheaper planner for every turn after the conversation's first.
- Turn state is kept in memory, keyed by a hash of the conversation up to the latest user message. After a restart a running worker continues from the history with a generic brief, and finished stretches whose reports were lost are shown to the planner as-is.
- Failures before the first streamed byte become HTTP errors (`502`, or `429` for upstream rate limits) so a proxy in front (e.g. LiteLLM) can retry or fall back.

## Configuration

`~/.config/polymodel/config.ts` (or `.mts`/`.mjs`/`.js`, `$POLYMODEL_CONFIG`, or `--config`):

```ts
import { defineConfig, workerBee } from "@ryaninvents/polymodel/plugin";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 4100 /*, apiKey: { env: 'POLYMODEL_API_KEY' } */,
  },
  // Reference upstream models as "<provider>:<model>".
  providers: {
    anthropic: { type: "anthropic", apiKey: { env: "ANTHROPIC_API_KEY" } },
    openrouter: { type: "openrouter", apiKey: { env: "OPENROUTER_API_KEY" } },
    openai: { type: "openai", apiKey: { env: "OPENAI_API_KEY" } },
    litellm: {
      type: "openai-compatible",
      baseURL: "http://127.0.0.1:4000/v1",
      apiKey: { env: "LITELLM_API_KEY" },
    },
  },
  models: {
    "opus-haiku": workerBee({
      planner: "anthropic:claude-opus-5-5",
      worker: "anthropic:claude-haiku-5-5",
    }),
    "opus-haiku-openrouter": workerBee({
      planner: "openrouter:anthropic/claude-opus-5.5",
      followUpPlanner: "openrouter:anthropic/claude-sonnet-5.5",
      worker: "openrouter:anthropic/claude-haiku-5.5",
      workerLimits: { maxRounds: 8, maxOutputTokens: 4096, stallMs: 60_000 },
      maxPlannerSteps: 40,
      maxDelegations: 12,
    }),
  },
});
```

Provider types are `anthropic`, `openai`, and `openrouter` (each with an optional `baseURL`), and `openai-compatible` (requires `baseURL`, optional `headers`). Each is backed by its [AI SDK](https://ai-sdk.dev) provider package. `apiKey` is either `{ env: "VAR" }` or an inline string. Setup moves inline keys into `credentials.env` when it rewrites the config.

Imports of `@ryaninvents/polymodel` inside the config resolve to the running copy, so the config directory needs no `node_modules`. (Install the package there as a dev dependency if you want editor types.)

Environment: `POLYMODEL_HOST`, `POLYMODEL_PORT`, `POLYMODEL_CONFIG`, `POLYMODEL_LOG_LEVEL`, `POLYMODEL_PLANNER_MODEL` / `POLYMODEL_WORKER_MODEL` (built-in default only), and any API-key variables your config references.

## Debugging

Set `POLYMODEL_LOG_LEVEL` (`trace`, `debug`, `info` (default), `warn`, `error`, `silent`):

```bash
POLYMODEL_LOG_LEVEL=debug polymodel
```

- `info`: startup, one line per finished delegation (goal, status, rounds), and upstream failures. A failed call logs the stage, model reference, timing, and the full cause chain, including the provider's status code and error payload.
- `debug`: adds request summaries, planner/worker call lifecycle (time to first event, usage, finish reason), and client disconnects.
- `trace`: adds a log line per stream event. Very verbose.

Plugin authors can log through the same logger, which has a `trace` method alongside the usual levels.

## Writing a polymodel

A polymodel is an object with an async-generator `run(request, context)` that yields events (`text-delta`, `reasoning-delta`, `tool-call`, `usage`, `finish`). Upstream calls use the [AI SDK](https://ai-sdk.dev); `forwardStream` converts an AI SDK stream into events and returns what the model produced.

```ts
import { streamText } from "ai";
import { definePolymodel, forwardStream } from "@ryaninvents/polymodel/plugin";

/** Drafts with a cheap model, then has a strong model revise the draft. */
export const draftAndRevise = definePolymodel({
  description: "Haiku drafts, Opus revises",
  async *run(request, { resolveModel, abortSignal }) {
    const common = { instructions: [...request.instructions], abortSignal };
    const draft = yield* forwardStream(
      streamText({
        ...common,
        model: resolveModel("anthropic:claude-haiku-5-5"),
        messages: [...request.messages],
      }).fullStream,
      { textAs: "reasoning" },
    );
    yield* forwardStream(
      streamText({
        ...common,
        model: resolveModel("anthropic:claude-opus-5-5"),
        messages: [
          ...request.messages,
          { role: "user", content: `Improve this draft:\n\n${draft.text}` },
        ],
      }).fullStream,
    );
  },
});
```

Register it under `models` in your config. `context.state` is a per-polymodel in-memory store for state that spans requests.

## API surface

- `POST /v1/chat/completions` (also `/chat/completions`): streaming and non-streaming, tools, `tool_choice`, `stream_options.include_usage`. Only `n: 1`.
- `GET /v1/models`, `GET /health`.
- System and developer messages anywhere in the conversation are lifted into the instructions.

## Development

```sh
pnpm install
pnpm build
pnpm dev       # runs the built dist/app/cli.js
pnpm dev:watch # runs src/ directly via Node type stripping, restarting on changes
pnpm check   # typecheck + lint + tests
pnpm build
```

See [docs/pi.md](docs/pi.md) for testing against the Pi coding agent, [CLAUDE.md](CLAUDE.md) for the architecture rules and [docs/releasing.md](docs/releasing.md) for publishing.

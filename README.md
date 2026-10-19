# Polymodel

Merge several LLMs into one OpenAI-compatible model. The default polymodel plans with a strong model (Opus) and executes with a fast one (Haiku), but clients — and the LiteLLM proxy in front — see a single model streaming a single response.

```
client ──▶ LiteLLM ──▶ polymodel (:4100) ──▶ LiteLLM / Anthropic / OpenAI
                         │
                         ├─ planner (e.g. Opus): investigates with the client's tools, writes a plan
                         └─ executor (e.g. Haiku): does the work with the plan injected
```

## Install

```sh
npm install -g @ryaninvents/polymodel   # or: brew install ryaninvents/tap/polymodel
polymodel init                          # writes ~/.config/polymodel/config.ts
polymodel                               # serves http://127.0.0.1:4100/v1
```

Requires Node.js ≥ 24.19.

Without a config file, polymodel serves one model, `opus-haiku`, which calls back into LiteLLM at `$LITELLM_BASE_URL` (default `http://127.0.0.1:4000/v1`) using `$POLYMODEL_PLANNER_MODEL` / `$POLYMODEL_EXECUTOR_MODEL` (defaults `claude-opus-5-5` / `claude-haiku-5-5`).

## Using it from LiteLLM

```yaml
model_list:
  - model_name: claude-opus-5-5
    litellm_params:
      {
        model: anthropic/claude-opus-5-5,
        api_key: os.environ/ANTHROPIC_API_KEY,
      }
  - model_name: claude-haiku-5-5
    litellm_params:
      {
        model: anthropic/claude-haiku-5-5,
        api_key: os.environ/ANTHROPIC_API_KEY,
      }

  # The polymodel itself, as an OpenAI-compatible upstream
  - model_name: opus-haiku
    litellm_params:
      model: openai/opus-haiku
      api_base: http://127.0.0.1:4100/v1
      api_key: unused # or the value of server.apiKey
```

## How the default polymodel behaves

- **Planning runs once per user turn.** When the newest message is from the user, the planner runs. It sees the client's tools and may call them (read files, run tests, …). Those calls are returned to the client like any tool call, and planning resumes when the results come back, up to `maxPlannerRounds` (default 8) round trips.
- **The plan streams as reasoning** (`reasoning_content`), so clients render it apart from the answer.
- **The executor gets the plan as its own prior work**: a synthetic `planning_finished` tool call/result pair is spliced into the conversation where planning ended.
- **Tool-result turns go straight to the executor.** Turn state (planning vs. executing, and the plan) is kept in memory, keyed by a hash of the conversation up to the latest user message. After a restart, an in-flight turn simply re-plans.
- Failures before the first streamed byte become HTTP errors (`502`, or `429` for upstream rate limits) so LiteLLM can retry or fall back.

## Configuration

`~/.config/polymodel/config.ts` (or `.mts`/`.mjs`/`.js`, `$POLYMODEL_CONFIG`, or `--config`):

```ts
import { defineConfig, plannerExecutor } from "@ryaninvents/polymodel/plugin";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 4100 /*, apiKey: { env: 'POLYMODEL_API_KEY' } */,
  },
  providers: {
    litellm: {
      type: "openai-compatible",
      baseURL: "http://127.0.0.1:4000/v1",
      apiKey: { env: "LITELLM_API_KEY" },
    },
    anthropic: { type: "anthropic", apiKey: { env: "ANTHROPIC_API_KEY" } },
  },
  models: {
    "opus-haiku": plannerExecutor({
      planner: "litellm:claude-opus-5-5",
      executor: "litellm:claude-haiku-5-5",
    }),
    "opus-haiku-direct": plannerExecutor({
      planner: "anthropic:claude-opus-5-5",
      executor: "anthropic:claude-haiku-5-5",
      maxPlannerRounds: 4,
    }),
  },
});
```

Imports of `@ryaninvents/polymodel` inside the config resolve to the running copy, so the config directory needs no `node_modules`. (Install the package there as a dev dependency if you want editor types.)

Environment: `POLYMODEL_HOST`, `POLYMODEL_PORT`, `POLYMODEL_CONFIG`, `POLYMODEL_LOG_LEVEL`, `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `POLYMODEL_PLANNER_MODEL`, `POLYMODEL_EXECUTOR_MODEL`.

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
        model: resolveModel("litellm:claude-haiku-5-5"),
        messages: [...request.messages],
      }).fullStream,
      { textAs: "reasoning" },
    );
    yield* forwardStream(
      streamText({
        ...common,
        model: resolveModel("litellm:claude-opus-5-5"),
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
pnpm dev     # runs src/ directly via Node type stripping
pnpm check   # typecheck + lint + tests
pnpm build
```

See [CLAUDE.md](CLAUDE.md) for the architecture rules and [docs/releasing.md](docs/releasing.md) for publishing.

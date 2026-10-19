# Testing polymodel with Pi

[Pi](https://github.com/earendil-works/pi) (`@earendil-works/pi-coding-agent`) is a terminal coding agent that can talk to any OpenAI-compatible endpoint, which makes it a good harness for exercising the worker-bee flow with real tool calls.

## Install

```sh
npm install -g @earendil-works/pi-coding-agent
pi --version
```

## Register polymodel as a provider

Create `~/.pi/agent/models.json` (Pi reloads it every time you open `/model`):

```json
{
  "providers": {
    "polymodel": {
      "baseUrl": "http://127.0.0.1:4100/v1",
      "api": "openai-completions",
      "apiKey": "polymodel",
      "compat": { "supportsReasoningEffort": false },
      "models": [
        {
          "id": "worker-bee",
          "name": "Polymodel (worker-bee)",
          "contextWindow": 200000,
          "maxTokens": 32000
        }
      ]
    }
  }
}
```

- Each `models[].id` must match a key in `models` of your polymodel config (`worker-bee` is the built-in default and what `polymodel setup` generates).
- `apiKey` is a placeholder unless you set `server.apiKey` in the polymodel config; Pi hides models without an `apiKey`, so keep a dummy value. If you set `server.apiKey`, use `"$POLYMODEL_API_KEY"` here.
- Polymodel does the reasoning itself, so Pi's `reasoning_effort` is disabled. Workers always run at low reasoning effort, and the planner uses its own settings, so Pi's thinking level has no effect either way.
- Adjust `baseUrl` if you changed `server.host`/`server.port`.

## Run

Terminal 1, from this repo (runs `src/` directly with `--watch`, so it restarts automatically when you edit files):

```sh
pnpm dev:watch
```

Terminal 2, in any project you want to point the agent at:

```sh
pi --model polymodel/worker-bee
```

To make it the default, set `defaultProvider` to `polymodel` and `defaultModel` to `worker-bee` in `~/.pi/agent/settings.json`.

## Checking that it works

- `curl http://127.0.0.1:4100/health` and `curl http://127.0.0.1:4100/v1/models` should respond before you start Pi.
- Ask Pi to do something that needs a tool (e.g. "list the files in this directory and summarize them"). The planner uses Pi's tools and delegates tasks to workers, which use them too. Run polymodel with `POLYMODEL_LOG_LEVEL=debug` to see which model handled each step.

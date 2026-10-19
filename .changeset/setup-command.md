---
"@ryaninvents/polymodel": minor
---

Replace `polymodel init` with `polymodel setup`, an interactive command that creates a new install or updates an existing one. It lets you pick one or more providers (Anthropic, OpenRouter, OpenAI, or any OpenAI-compatible endpoint such as LiteLLM), log in to OpenRouter in the browser or paste API keys, and choose the planner/executor models. Keys are stored in `~/.config/polymodel/credentials.env`, which `serve` reads, so background services work without shell exports.

Adds an `openrouter` provider type (via `@openrouter/ai-sdk-provider`).

Breaking: `LITELLM_BASE_URL` and `LITELLM_API_KEY` are no longer read. Without a config file, polymodel now serves a `worker-bee` model on the first provider with an API key (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`); otherwise it asks you to run `polymodel setup`.

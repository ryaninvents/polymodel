---
"@ryaninvents/polymodel": minor
---

Turn on Anthropic prompt caching for the `anthropic` and `openrouter` (Anthropic models) providers. Configure with `promptCaching: false` or `{ ttl: "5m" | "1h" }` per provider. The planner's final-round note now trails the conversation instead of changing the system prompt, so the cached prefix stays valid. Debug logs gain `instructionsHash`/`toolsHash` and `cacheWriteTokens`.

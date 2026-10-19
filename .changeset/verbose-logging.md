---
"@ryaninvents/polymodel": patch
---

Add detailed logging at `POLYMODEL_LOG_LEVEL=debug` and `trace`: request summaries, planner/worker call lifecycle (timing to first event, usage, finish reason), client disconnects, and per-event traces. Upstream failures now log which stage and model failed, plus the full cause chain including the provider's error payload (status code, response body), which was previously lost. Plugin loggers gain a `trace` method.

---
"@ryaninvents/polymodel": minor
---

Add `workerBee`, a delegating planner, and make it the default polymodel (model id `worker-bee`). The planner stays in control of the whole turn and hands small, scoped tasks to cheap worker models through a virtual `worker_bee` tool. Each task carries a structured brief; workers use the client's tools and report back. A worker that runs out of rounds, stalls or hits its output limit comes back to the planner as a result it can act on. Finished worker stretches are collapsed in the planner's view so its prompt prefix stays cacheable. Tune with `workerLimits`, `maxPlannerSteps`, `maxDelegations`, `followUpPlanner` and `workerSettings`.

Breaking: `plannerExecutor` is removed, along with `maxPlannerRounds`, `executorSettings` and `PlannerExecutorOptions`. Replace `plannerExecutor({ planner, executor })` with `workerBee({ planner, worker })`. `POLYMODEL_EXECUTOR_MODEL` is now `POLYMODEL_WORKER_MODEL`, and `polymodel setup` asks for a worker instead of an executor (existing configs using `plannerExecutor` must be updated).

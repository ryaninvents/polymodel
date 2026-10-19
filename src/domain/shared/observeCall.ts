import type { PolymodelEvent, PolymodelLogger, PolymodelUsage } from "#types";
import { describeErrorChain } from "#util";

export type CallLabel = {
  stage: "planner" | "worker";
  upstream: string;
  /** Set for worker calls: which delegation, and which of its tool rounds. */
  taskId?: string;
  round?: number;
};

/**
 * Logs one upstream call's lifecycle (debug: start, first event, completion;
 * trace: every event) and, on failure, which stage and upstream model failed.
 * The original error is rethrown untouched: `toHttpError` inspects its cause.
 */
export async function* observeCall<result>(
  logger: PolymodelLogger,
  label: CallLabel,
  call: AsyncGenerator<PolymodelEvent, result>,
  summarize: (result: result) => object,
  abortSignal: AbortSignal,
): AsyncGenerator<PolymodelEvent, result> {
  const startedAt = performance.now();
  function elapsedMs() {
    return Math.round(performance.now() - startedAt);
  }
  const eventCounts = new Map<PolymodelEvent["type"], number>();
  let usage: PolymodelUsage | undefined;
  logger.debug(label, "upstream call started");

  try {
    let next = await call.next();
    while (!next.done) {
      const event = next.value;
      if (eventCounts.size === 0)
        logger.debug(
          { ...label, firstEvent: event.type, timeToFirstEventMs: elapsedMs() },
          "upstream call produced first event",
        );
      eventCounts.set(event.type, (eventCounts.get(event.type) ?? 0) + 1);
      if (event.type === "usage") usage = event.usage;
      logger.trace({ ...label, event }, "upstream event");
      yield event;
      next = await call.next();
    }
    logger.debug(
      {
        ...label,
        durationMs: elapsedMs(),
        events: Object.fromEntries(eventCounts),
        usage,
        ...summarize(next.value),
      },
      "upstream call finished",
    );
    return next.value;
  } catch (error) {
    const context = {
      ...label,
      durationMs: elapsedMs(),
      events: Object.fromEntries(eventCounts),
      causes: describeErrorChain(error),
    };
    // A client disconnect aborts the upstream call; that isn't an upstream fault.
    if (abortSignal.aborted)
      logger.debug(context, "upstream call aborted by client");
    else logger.error(context, "upstream call failed");
    throw error;
  }
}

export type StallGuard = {
  /** Aborts when the parent aborts or when `stallMs` pass without `touch`. */
  signal: AbortSignal;
  /** Records progress, restarting the stall clock. */
  touch(): void;
  /** Passes parts through, counting text and tool calls (not reasoning) as progress. */
  watch<part extends { type: string }>(
    stream: AsyncIterable<part>,
  ): AsyncGenerator<part>;
  stalled(): boolean;
  dispose(): void;
};

/**
 * Small models sometimes reason indefinitely without acting. Callers `touch`
 * on output that shows progress (text, tool calls) but not on reasoning, so
 * a model stuck thinking is aborted instead of holding the request open.
 */
export function createStallGuard(
  parent: AbortSignal,
  stallMs: number,
): StallGuard {
  const controller = new AbortController();
  let didStall = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function arm() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      didStall = true;
      controller.abort();
    }, stallMs);
  }
  arm();

  async function* watch<part extends { type: string }>(
    stream: AsyncIterable<part>,
  ) {
    for await (const item of stream) {
      if (item.type === "text-delta" || item.type === "tool-call") arm();
      yield item;
    }
  }

  return {
    watch,
    signal: AbortSignal.any([parent, controller.signal]),
    touch: arm,
    stalled: () => didStall,
    dispose: () => clearTimeout(timer),
  };
}

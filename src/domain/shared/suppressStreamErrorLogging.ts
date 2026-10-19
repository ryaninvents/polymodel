/**
 * Passed as `onError` to `streamText`: `forwardStream` rethrows stream errors,
 * so the AI SDK's default console logging would duplicate them.
 */
export function suppressStreamErrorLogging(): void {}

export class UnknownPolymodelError extends Error {
  readonly code = "UNKNOWN_POLYMODEL" as const;
  readonly modelId: string;
  constructor(modelId: string, available: ReadonlyArray<string>) {
    super(
      `Unknown model "${modelId}". Available models: ${available.join(", ")}`,
    );
    this.name = "UnknownPolymodelError";
    this.modelId = modelId;
  }
}

export class InvalidPolymodelRequestError extends Error {
  readonly code = "INVALID_REQUEST" as const;
  constructor(message: string) {
    super(message);
    this.name = "InvalidPolymodelRequestError";
  }
}

/** Wraps anything a plugin (or the upstream model it called) throws. */
export class PolymodelRunError extends Error {
  readonly code = "POLYMODEL_RUN_FAILED" as const;
  constructor(modelId: string, cause: unknown) {
    super(
      `Polymodel "${modelId}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      {
        cause,
      },
    );
    this.name = "PolymodelRunError";
  }
}

export function createUnknownPolymodelError(
  modelId: string,
  available: ReadonlyArray<string>,
) {
  return new UnknownPolymodelError(modelId, available);
}

export function createInvalidPolymodelRequestError(message: string) {
  return new InvalidPolymodelRequestError(message);
}

export function createPolymodelRunError(modelId: string, cause: unknown) {
  return new PolymodelRunError(modelId, cause);
}

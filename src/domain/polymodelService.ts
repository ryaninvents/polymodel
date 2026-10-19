import type { LanguageModel } from "ai";
import type {
  Polymodel,
  PolymodelEvent,
  PolymodelLogger,
  PolymodelRequest,
  StateStore,
} from "#types";
import {
  createInvalidPolymodelRequestError,
  createPolymodelRunError,
  createUnknownPolymodelError,
} from "./errors.ts";

export type PolymodelServiceDependencies = {
  models: Readonly<Record<string, Polymodel>>;
  resolveModel: (reference: string) => LanguageModel;
  createStateStore: (modelId: string) => StateStore;
  logger: PolymodelLogger;
};

export type PolymodelSummary = { id: string; description: string | undefined };

function validateRequest(request: PolymodelRequest): void {
  if (request.messages.length === 0) {
    throw createInvalidPolymodelRequestError(
      "A request needs at least one non-system message",
    );
  }
}

export function createPolymodelService({
  models,
  resolveModel,
  createStateStore,
  logger,
}: PolymodelServiceDependencies) {
  const states = new Map(
    Object.keys(models).map((id) => [id, createStateStore(id)]),
  );

  async function* runAndWrap(
    modelId: string,
    events: AsyncIterable<PolymodelEvent>,
  ): AsyncGenerator<PolymodelEvent> {
    try {
      yield* events;
    } catch (error) {
      throw createPolymodelRunError(modelId, error);
    }
  }

  return {
    listModels(): ReadonlyArray<PolymodelSummary> {
      return Object.entries(models).map(([id, model]) => ({
        id,
        description: model.description,
      }));
    },

    /** Throws synchronously for unknown models or invalid requests, before any streaming starts. */
    run(
      request: PolymodelRequest,
      abortSignal: AbortSignal,
    ): AsyncIterable<PolymodelEvent> {
      const model = models[request.model];
      const state = states.get(request.model);
      if (!model || !state)
        throw createUnknownPolymodelError(request.model, Object.keys(models));
      validateRequest(request);
      const context = {
        resolveModel,
        state,
        abortSignal,
        logger: {
          trace: (obj: object, msg?: string) =>
            logger.trace({ model: request.model, ...obj }, msg),
          debug: (obj: object, msg?: string) =>
            logger.debug({ model: request.model, ...obj }, msg),
          info: (obj: object, msg?: string) =>
            logger.info({ model: request.model, ...obj }, msg),
          warn: (obj: object, msg?: string) =>
            logger.warn({ model: request.model, ...obj }, msg),
          error: (obj: object, msg?: string) =>
            logger.error({ model: request.model, ...obj }, msg),
        },
      };
      return runAndWrap(request.model, model.run(request, context));
    },
  };
}

export type PolymodelService = ReturnType<typeof createPolymodelService>;
